/* ============================================================
   Minimal self-contained Supabase-compatible client.
   Talks ONLY to the project's own Supabase domain (no jsdelivr/
   unpkg/cdnjs dependency) via plain fetch(). Implements just the
   surface this app actually uses: auth (password + oauth +
   recovery), PostgREST queries, rpc(), and storage.
   ============================================================ */
(function(){
  function makeClient(projectUrl, anonKey){
    const AUTH_URL = projectUrl.replace(/\/$/,"") + "/auth/v1";
    const REST_URL = projectUrl.replace(/\/$/,"") + "/rest/v1";
    const STORAGE_URL = projectUrl.replace(/\/$/,"") + "/storage/v1";
    const STORAGE_KEY = "sb-" + (new URL(projectUrl).hostname.split(".")[0]) + "-auth-token";

    let session = null;
    let listeners = [];
    let initPromise = null;

    function persist(s){
      session = s;
      try{
        if(s) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        else window.localStorage.removeItem(STORAGE_KEY);
      }catch(e){ /* storage unavailable — session just won't survive a reload */ }
    }
    function readStored(){
      try{
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      }catch(e){ return null; }
    }
    function notify(event){
      listeners.forEach(fn => { try{ fn(event, session); }catch(e){ console.error(e); } });
    }
    function normalize(tok){
      return {
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at: Math.floor(Date.now()/1000) + (Number(tok.expires_in) || 3600),
        token_type: tok.token_type || "bearer",
        user: tok.user || null
      };
    }
    function base64Url(bytes){
      let bin="";
      for(const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
    }
    function randomVerifier(){
      const bytes=new Uint8Array(64);
      crypto.getRandomValues(bytes);
      return base64Url(bytes);
    }
    async function pkceChallenge(verifier){
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier));
      return base64Url(new Uint8Array(digest));
    }

    function authHeaders(extra){
      return Object.assign({
        "apikey": anonKey,
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (session ? session.access_token : anonKey)
      }, extra || {});
    }
    async function authRequest(path, opts){
      opts = opts || {};
      let res;
      try{
        res = await fetch(AUTH_URL + path, {
          method: opts.method || "GET",
          headers: authHeaders(opts.headers),
          body: opts.body
        });
      }catch(networkErr){
        return { data: null, error: { message: "Network error — couldn't reach the server." } };
      }
      let json = null;
      try{ json = await res.json(); }catch(e){ /* empty body, e.g. logout */ }
      if(!res.ok){
        const msg = (json && (json.error_description || json.msg || json.message || json.error)) || ("Request failed (" + res.status + ")");
        return { data: null, error: { message: msg, status: res.status } };
      }
      return { data: json, error: null };
    }

    async function ensureFreshSession(){
      // The site and its Team page share one login: always take the newest token another copy saved.
      const stored = readStored();
      if(stored && (!session || (stored.expires_at || 0) > (session.expires_at || 0))) session = stored;
      if(session && session.expires_at && session.expires_at * 1000 < Date.now() + 60000){
        const used = session.refresh_token;
        const { data, error } = await authRequest("/token?grant_type=refresh_token", {
          method: "POST", body: JSON.stringify({ refresh_token: used })
        });
        if(!error && data && data.access_token){
          persist(normalize(data));
        } else {
          const again = readStored();   // the other copy may have refreshed first
          if(again && again.refresh_token !== used && (again.expires_at || 0) * 1000 > Date.now()) session = again;
          else persist(null);
        }
      }
      return session;
    }

    function init(){
      if(initPromise) return initPromise;
      initPromise = (async () => {
        // OAuth / recovery callback: tokens can arrive in the URL hash (implicit-style)
        const hash = location.hash && location.hash.length > 1 ? location.hash.slice(1) : "";
        if(hash.indexOf("access_token=") !== -1){
          const params = new URLSearchParams(hash);
          const access_token = params.get("access_token");
          const refresh_token = params.get("refresh_token");
          const type = params.get("type");
          const expires_in = params.get("expires_in");
          if(access_token){
            const { data: userData } = await authRequest("/user", { headers: { Authorization: "Bearer " + access_token } });
            persist({ access_token, refresh_token, expires_at: Math.floor(Date.now()/1000) + (Number(expires_in)||3600), token_type: "bearer", user: userData });
            notify(type === "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN");
            return;
          }
        }
        // PKCE callback: Supabase may return a `code` query param for both OAuth and password recovery.
        // Recovery must also be exchanged here; otherwise the user lands on the site without a recovery session.
        const qp = new URLSearchParams(location.search);
        if(qp.get("code")){
          let verifier = null, pendingRecovery = false;
          try{ verifier = localStorage.getItem("ss-recovery-pkce-verifier"); pendingRecovery = localStorage.getItem("ss-recovery-pending") === "1"; }catch(e){}
          const exchangeBody = { auth_code: qp.get("code") };
          if(verifier) exchangeBody.code_verifier = verifier;
          const { data, error } = await authRequest("/token?grant_type=pkce", {
            method: "POST", body: JSON.stringify(exchangeBody)
          });
          if(!error && data && data.access_token){
            persist(normalize(data));
            try{ localStorage.removeItem("ss-recovery-pkce-verifier"); localStorage.removeItem("ss-recovery-pending"); }catch(e){}
            notify((qp.get("type") === "recovery" || pendingRecovery) ? "PASSWORD_RECOVERY" : "SIGNED_IN");
            return;
          }
        }
        await ensureFreshSession();
        notify("INITIAL_SESSION");
      })();
      return initPromise;
    }
    init();

    // ---------------- auth ----------------
    const auth = {
      async getSession(){
        await init();
        await ensureFreshSession();
        return { data: { session } };
      },
      onAuthStateChange(cb){
        listeners.push(cb);
        return { data: { subscription: { unsubscribe(){ listeners = listeners.filter(f => f !== cb); } } } };
      },
      async signInWithPassword({ email, password }){
        const cap = await window.SrvCaptcha.token();
        const pw = { email, password };
        if(cap.token) pw.gotrue_meta_security = { captcha_token: cap.token };
        let { data, error } = await authRequest("/token?grant_type=password", { method: "POST", body: JSON.stringify(pw) });
        if(error && cap.error && /captcha/i.test(error.message || "")) error = cap.error;
        if(error) return { data: null, error };
        const s = normalize(data);
        persist(s);
        notify("SIGNED_IN");
        return { data: { session: s, user: s.user }, error: null };
      },
      async signUp({ email, password, options }){
        const body = { email, password };
        if(options && options.data) body.data = options.data;
        const qs = options && options.emailRedirectTo ? ("?redirect_to=" + encodeURIComponent(options.emailRedirectTo)) : "";
        const cap = await window.SrvCaptcha.token();
        if(cap.token) body.gotrue_meta_security = { captcha_token: cap.token };
        let { data, error } = await authRequest("/signup" + qs, { method: "POST", body: JSON.stringify(body) });
        if(error && cap.error && /captcha/i.test(error.message || "")) error = cap.error;
        if(error) return { data: null, error };
        if(data && data.access_token){
          const s = normalize(data);
          persist(s);
          notify("SIGNED_IN");
          return { data: { session: s, user: s.user }, error: null };
        }
        return { data: { session: null, user: data }, error: null };
      },
      async signOut(){
        if(session){ await authRequest("/logout", { method: "POST" }).catch(() => {}); }
        persist(null);
        notify("SIGNED_OUT");
        return { error: null };
      },
      async updateUser(attrs){
        await ensureFreshSession();
        const { data, error } = await authRequest("/user", { method: "PUT", body: JSON.stringify(attrs) });
        if(error) return { data: null, error };
        if(session) persist(Object.assign({}, session, { user: data }));
        notify("USER_UPDATED");
        return { data: { user: data }, error: null };
      },
      async resetPasswordForEmail(email, opts){
        const redirectTo = (opts && opts.redirectTo) || (location.origin + location.pathname);
        // Password recovery intentionally uses the normal Supabase recovery flow
        // instead of browser-local PKCE. A reset email is often opened from Gmail
        // in a different browser/tab, so a verifier stored in localStorage can be
        // missing even though the recovery link itself is valid. Without that
        // verifier, a PKCE recovery code cannot be exchanged and the user never
        // reaches the password-change screen.
        try{
          localStorage.removeItem("ss-recovery-pkce-verifier");
          localStorage.removeItem("ss-recovery-pending");
        }catch(e){}
        const body = { email };
        const qs = "?redirect_to=" + encodeURIComponent(redirectTo);
        const cap = await window.SrvCaptcha.token();
        if(cap.token) body.gotrue_meta_security = { captcha_token: cap.token };
        let { error } = await authRequest("/recover" + qs, { method: "POST", body: JSON.stringify(body) });
        if(error && cap.error && /captcha/i.test(error.message || "")) error = cap.error;
        return { data: {}, error };
      },
      async verifyOtp({ email, token, type }){
        // a code sent by email (for example the password reset code)
        const { data, error } = await authRequest("/verify", { method: "POST", body: JSON.stringify({ email, token, type }) });
        if(error) return { data: null, error };
        if(!data || !data.access_token) return { data: null, error: { message: "This code is not valid." } };
        const s = normalize(data);
        persist(s);
        notify(type === "recovery" ? "PASSWORD_RECOVERY" : "SIGNED_IN");
        return { data: { session: s, user: s.user }, error: null };
      },
      // Google Authenticator (Supabase MFA, TOTP)
      mfa: {
        async factors(){
          await ensureFreshSession();
          const { data, error } = await authRequest("/user");
          if(error) return { data: null, error };
          return { data: ((data && data.factors) || []).filter(f => f.factor_type === "totp"), error: null };
        },
        async enroll(friendlyName){
          await ensureFreshSession();
          return authRequest("/factors", { method: "POST", body: JSON.stringify({ factor_type: "totp", friendly_name: friendlyName, issuer: "Repuven" }) });
        },
        async unenroll(id){
          await ensureFreshSession();
          return authRequest("/factors/" + encodeURIComponent(id), { method: "DELETE" });
        },
        async verifyCode(id, code){
          await ensureFreshSession();
          const c = await authRequest("/factors/" + encodeURIComponent(id) + "/challenge", { method: "POST", body: "{}" });
          if(c.error) return c;
          const v = await authRequest("/factors/" + encodeURIComponent(id) + "/verify", { method: "POST", body: JSON.stringify({ challenge_id: c.data && c.data.id, code }) });
          if(v.error) return v;
          if(v.data && v.data.access_token){ persist(normalize(v.data)); notify("TOKEN_REFRESHED"); }
          return { data: v.data, error: null };
        }
      },
      async signInWithOAuth({ provider, options }){
        const redirectTo = (options && options.redirectTo) || window.location.href;
        const authorizeUrl = AUTH_URL + "/authorize?provider=" + encodeURIComponent(provider) + "&redirect_to=" + encodeURIComponent(redirectTo);
        window.location.href = authorizeUrl;
        return { data: {}, error: null };
      }
    };

    // ---------------- postgrest query builder ----------------
    function QueryBuilder(table){
      this.table = table;
      this.qp = new URLSearchParams();
      this.method = "GET";
      this.body = null;
      this.prefer = [];
      this.wantSingle = false;
      this.wantCount = null;
    }
    QueryBuilder.prototype.select = function(cols, opts){
      this.qp.set("select", cols || "*");
      if(opts && opts.count){ this.wantCount = opts.count; this.prefer.push("count=" + opts.count); }
      if(opts && opts.head){ this.method = "HEAD"; }
      return this;
    };
    QueryBuilder.prototype.eq = function(col, val){ this.qp.append(col, "eq." + val); return this; };
    // Support the same .neq() filter used by Supabase's JavaScript client.
    // This custom client previously omitted it, which caused
    // the Admin > Survey loader to fail with ".neq is not a function".
    QueryBuilder.prototype.neq = function(col, val){ this.qp.append(col, "neq." + val); return this; };
    QueryBuilder.prototype.is = function(col, val){ this.qp.append(col, "is." + (val === null ? "null" : val)); return this; };
    // .order() can be chained: the first call sorts first, later calls break ties
    QueryBuilder.prototype.order = function(col, opts){ const o = col + ((opts && opts.ascending === false) ? ".desc" : ".asc"); const cur = this.qp.get("order"); this.qp.set("order", cur ? cur + "," + o : o); return this; };
    QueryBuilder.prototype.gt = function(col, val){ this.qp.append(col, "gt." + val); return this; };
    QueryBuilder.prototype.gte = function(col, val){ this.qp.append(col, "gte." + val); return this; };
    QueryBuilder.prototype.lt = function(col, val){ this.qp.append(col, "lt." + val); return this; };
    QueryBuilder.prototype.lte = function(col, val){ this.qp.append(col, "lte." + val); return this; };
    QueryBuilder.prototype.limit = function(n){ this.qp.set("limit", String(n)); return this; };
    QueryBuilder.prototype.maybeSingle = function(){ this.wantSingle = true; this.prefer.push("return=representation"); return this; };
    QueryBuilder.prototype.insert = function(obj){ this.method = "POST"; this.body = JSON.stringify(obj); this.prefer.push("return=representation"); return this; };
    QueryBuilder.prototype.update = function(obj){ this.method = "PATCH"; this.body = JSON.stringify(obj); this.prefer.push("return=representation"); return this; };
    QueryBuilder.prototype["delete"] = function(){ this.method = "DELETE"; return this; };
    QueryBuilder.prototype._run = async function(){
      await ensureFreshSession();
      const url = REST_URL + "/" + this.table + (this.qp.toString() ? "?" + this.qp.toString() : "");
      const headers = authHeaders();
      if(this.prefer.length) headers["Prefer"] = this.prefer.join(",");
      let res;
      try{
        res = await fetch(url, { method: this.method, headers, body: this.body });
      }catch(networkErr){
        return { data: null, error: { message: "Network error — couldn't reach the server." }, count: null };
      }
      let count = null;
      const cr = res.headers.get("content-range");
      if(cr && cr.indexOf("/") !== -1){ const total = cr.split("/")[1]; count = total === "*" ? null : Number(total); }
      let json = null;
      try{ json = this.method === "HEAD" ? null : await res.json(); }catch(e){ json = null; }
      if(!res.ok){
        const msg = (json && (json.message || json.hint || json.details)) || ("Request failed (" + res.status + ")");
        return { data: null, error: { message: msg }, count };
      }
      if(this.wantSingle){
        const row = Array.isArray(json) ? (json[0] || null) : json;
        return { data: row, error: null, count };
      }
      return { data: json, error: null, count };
    };
    QueryBuilder.prototype.then = function(resolve, reject){ return this._run().then(resolve, reject); };
    QueryBuilder.prototype["catch"] = function(reject){ return this._run().catch(reject); };

    // ---------------- storage ----------------
    const storage = {
      from(bucket){
        return {
          async upload(path, file, opts){
            await ensureFreshSession();
            let res;
            try{
              res = await fetch(STORAGE_URL + "/object/" + bucket + "/" + path, {
                method: "POST",
                headers: { "apikey": anonKey, "Authorization": "Bearer " + (session ? session.access_token : anonKey), "x-upsert": (opts && opts.upsert) ? "true" : "false" },
                body: file
              });
            }catch(e){ return { data: null, error: { message: "Network error uploading file." } }; }
            if(!res.ok){
              const t = await res.text().catch(() => "");
              return { data: null, error: { message: "Upload failed: " + (t || res.status) } };
            }
            return { data: { path }, error: null };
          },
          async createSignedUrl(path, expiresIn){
            await ensureFreshSession();
            let res;
            try{
              res = await fetch(STORAGE_URL + "/object/sign/" + bucket + "/" + path, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({ expiresIn })
              });
            }catch(e){ return { data: null, error: { message: "Network error signing URL." } }; }
            const json = await res.json().catch(() => null);
            if(!res.ok || !json || !json.signedURL) return { data: null, error: { message: "Could not create signed URL." } };
            return { data: { signedUrl: STORAGE_URL + json.signedURL }, error: null };
          },
          getPublicUrl(path){
            return { data: { publicUrl: STORAGE_URL + "/object/public/" + bucket + "/" + path } };
          }
        };
      }
    };

    // ---------------- rpc ----------------
    async function rpc(fnName, params){
      await ensureFreshSession();
      let res;
      try{
        res = await fetch(REST_URL + "/rpc/" + fnName, { method: "POST", headers: authHeaders(), body: JSON.stringify(params || {}) });
      }catch(e){ return { data: null, error: { message: "Network error — couldn't reach the server." } }; }
      const json = await res.json().catch(() => null);
      if(!res.ok){
        const msg = (json && (json.message || json.hint || json.details)) || ("Request failed (" + res.status + ")");
        return { data: null, error: { message: msg } };
      }
      return { data: json, error: null };
    }

    return {
      auth,
      from(table){ return new QueryBuilder(table); },
      rpc,
      storage
    };
  }

  window.supabase = { createClient: makeClient };
})();
