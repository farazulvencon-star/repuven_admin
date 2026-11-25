/* Cloudflare Turnstile: a fresh token for each Supabase Auth call.
   Most people see nothing. If Cloudflare wants a click, a small card shows in the middle of the screen. */
window.SrvCaptcha = (function(){
  const SITE_KEY = "0x4AAAAAAF-hTDUmHBuQzS0K";
  let loading = null, host = null;
  function load(){
    if(window.turnstile) return Promise.resolve();
    if(loading) return loading;
    loading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true; s.defer = true;
      s.onload = () => res();
      s.onerror = () => { loading = null; rej(new Error("The security check could not load. Check your internet and try again.")); };
      document.head.appendChild(s);
    });
    return loading;
  }
  function holder(){
    if(host && document.body.contains(host)) return host;
    host = document.createElement("div");
    host.className = "cf-host idle";
    host.innerHTML = '<div class="cf-scrim"></div><div class="cf-card" role="dialog" aria-modal="true" aria-label="Security check"><b>Quick security check</b><span>Please confirm you are a person.</span><div class="cf-slot"></div></div>';
    document.body.appendChild(host);
    return host;
  }
  /** a brand-new check: resolves with { token } or { error } — never throws */
  async function fresh(){
    try{ await load(); }catch(e){ return { error: e }; }
    const h = holder(), slot = h.querySelector(".cf-slot");
    const box = document.createElement("div");
    slot.appendChild(box);
    return new Promise(res => {
      let id = null, finished = false;
      const end = (out) => {
        if(finished) return; finished = true;
        clearTimeout(timer);
        h.classList.add("idle");
        setTimeout(() => { try{ if(id !== null) window.turnstile.remove(id); }catch(e){} box.remove(); }, 0);
        res(out);
      };
      const timer = setTimeout(() => end({ error: new Error("The security check took too long. Please try again.") }), 20000);
      try{
        id = window.turnstile.render(box, {
          sitekey: SITE_KEY,
          theme: "dark",
          appearance: "interaction-only",
          callback: t => end({ token: t }),
          retry: "never",
          "error-callback": code => {
            const c = String(code || "");
            end({ code: c, error: new Error(/^1102/.test(c) ? "This website address is not added in Cloudflare Turnstile yet (code " + c + ")." : "The security check failed (code " + (c || "?") + "). Please try again.") });
            return true;
          },
          "expired-callback": () => end({ error: new Error("The security check expired. Please try again.") }),
          "before-interactive-callback": () => { h.classList.remove("idle"); },
          "after-interactive-callback": () => { h.classList.add("idle"); }
        });
      }catch(e){ end({ error: new Error("The security check could not start. Please refresh the page.") }); }
    });
  }
  // a token made early (while the person types) — Cloudflare tokens last 5 minutes and work once
  let pre = null;
  function prefetch(){
    if(pre && Date.now() - pre.at < 240000) return;
    const p = fresh();
    pre = { p, at: Date.now() };
    p.then(r => { if(!r.token && pre && pre.p === p) pre = null; });
  }
  async function token(){
    if(pre && Date.now() - pre.at < 240000){
      const p = pre.p; pre = null;
      const r = await p;
      if(r.token) return r;
    }
    return fresh();
  }
  return { token, load, prefetch };
})();
// load Cloudflare with the page, start the check when someone taps an email or password box
window.addEventListener("load", () => setTimeout(() => { window.SrvCaptcha.load().catch(() => {}); }, 800));
document.addEventListener("focusin", e => {
  const t = e.target;
  if(t && t.matches && t.matches('input[type="email"], input[type="password"], #signinEmail, #signupEmail')) window.SrvCaptcha.prefetch();
});
