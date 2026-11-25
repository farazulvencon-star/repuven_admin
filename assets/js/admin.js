/* ============================================================
   Repuven — admin app
   ============================================================ */
// window.supabase is our own self-contained client (see the script above this one) —
// no third-party CDN is loaded, so there is nothing to fail to load.
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------------- visible connection status (quick reachability check to the
   project's own domain — not a 3rd-party CDN, so a "couldn't connect" here means
   this device genuinely can't reach Supabase itself, not a blocked CDN) ---------------- */
(function(){
  // no badge while things work; a message shows only if the server truly can't be reached
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000));
  Promise.race([ fetch(SUPABASE_URL + "/rest/v1/", { headers: { apikey: SUPABASE_ANON_KEY } }), timeout ])
    .catch(() => showFatalLoadError());
})();

function showFatalLoadError(){
  // No banner. Wait quietly; if the app could not start, reload by itself once the server is reachable again.
  if(window.__srvWaiting) return; window.__srvWaiting = true;
  let tries = 0; try{ tries = Number(sessionStorage.getItem("srv-reload") || 0); }catch(_){}
  const check = () => fetch(SUPABASE_URL + "/rest/v1/", { headers: { apikey: SUPABASE_ANON_KEY } })
    .then(() => {
      window.__srvWaiting = false;
      if(window.__srvAppFailed && tries < 3){ try{ sessionStorage.setItem("srv-reload", String(tries + 1)); }catch(_){} location.reload(); }
    })
    .catch(() => setTimeout(check, 8000));
  setTimeout(check, 4000);
  window.addEventListener("online", () => setTimeout(check, 500), { once: true });
}

async function runApp(){

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function money(n){
  const v = Number(n || 0);
  return "$" + v.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function fmtDate(d){
  if(!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) + " · " +
         dt.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
}
function toast(msg, type){
  let stack = document.getElementById("toast-stack");
  if(!stack){ stack = document.createElement("div"); stack.id = "toast-stack"; document.body.appendChild(stack); }
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " err" : type === "success" ? " ok" : "");
  el.textContent = msg;
  stack.appendChild(el);
  makeSwipeable(el, 3800);
}
window.srvToast = toast;
/* Any notice can be swiped away (left, right or up), or closed with a tap on ×. */
function makeSwipeable(el, life){
  if(el.dataset.swipe) return; el.dataset.swipe = "1";
  el.classList.add("swipe-note");
  if(!el.querySelector(".swipe-x")){
    const x = document.createElement("button");
    x.type = "button"; x.className = "swipe-x"; x.setAttribute("aria-label", "Close"); x.textContent = "×";
    x.addEventListener("click", e => { e.stopPropagation(); gone(0, -1); });
    el.appendChild(x);
  }
  let timer = null, sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, drag = false, done = false;
  const start = () => { if(life) timer = setTimeout(() => gone(0, -1), life); };
  const stop = () => { clearTimeout(timer); timer = null; };
  function gone(dirX, dirY){
    if(done) return; done = true; stop();
    el.style.transition = "transform .22s ease, opacity .22s ease";
    el.style.transform = dirX ? `translateX(${dirX * 120}%)` : `translateY(${dirY * 60}px)`;
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 230);
  }
  el.addEventListener("pointerdown", e => {
    if(e.target.closest(".swipe-x, a, button:not(.swipe-x)")) return;
    drag = true; sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = Date.now(); stop();
    el.style.transition = "none";
    try{ el.setPointerCapture(e.pointerId); }catch(_){}
  });
  el.addEventListener("pointermove", e => {
    if(!drag) return;
    dx = e.clientX - sx; dy = Math.min(0, e.clientY - sy);
    const sideways = Math.abs(dx) >= Math.abs(dy);
    el.style.transform = sideways ? `translateX(${dx}px)` : `translateY(${dy}px)`;
    el.style.opacity = String(Math.max(0.25, 1 - Math.max(Math.abs(dx), -dy) / 260));
  });
  const end = () => {
    if(!drag) return; drag = false;
    const fast = Date.now() - t0 < 250;
    if(Math.abs(dx) > 80 || (fast && Math.abs(dx) > 30)) return gone(Math.sign(dx), 0);
    if(-dy > 40 || (fast && -dy > 20)) return gone(0, -1);
    el.style.transition = "transform .2s ease, opacity .2s ease";
    el.style.transform = ""; el.style.opacity = "";
    start();
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  start();
}
function applyTheme(){
  document.documentElement.setAttribute("data-theme","dark");
  document.documentElement.setAttribute("data-accent","green");
}

/* ---------------- session state (loaded once, refreshed on auth changes) ---------------- */
const AppState = { session:null, user:null, profile:null, wallet:null, roles:[], isAdmin:false, isStaff:false };

async function getProfile(id){ const {data,error}=await supabase.from("profiles").select("*").eq("id",id).maybeSingle(); if(error) throw error; return data; }
async function getWallet(id){ const {data,error}=await supabase.from("wallets").select("*").eq("user_id",id).maybeSingle(); if(error) throw error; return data; }
async function getRoles(id){ const {data,error}=await supabase.from("user_roles").select("role").eq("user_id",id); if(error) throw error; return (data||[]).map(r=>r.role); }
async function refreshWallet(){ if(!AppState.user) return; try{ AppState.wallet = await getWallet(AppState.user.id); }catch(e){ console.error(e); } }

async function loadAppState(){
  const { data:{ session } } = await supabase.auth.getSession();
  AppState.session = session;
  if(!session){ AppState.user=null; AppState.profile=null; AppState.wallet=null; AppState.roles=[]; AppState.isAdmin=false; AppState.isStaff=false; AppState.helper=null; document.documentElement.classList.remove("is-helper"); return false; }
  AppState.user = session.user;
  try{
    const [profile, roles] = await Promise.all([ getProfile(session.user.id), getRoles(session.user.id) ]);
    AppState.profile = profile;
    AppState.roles = roles;
    AppState.isAdmin = roles.includes("ADMIN") || roles.includes("SUPER_ADMIN");
    AppState.isStaff = AppState.isAdmin || roles.includes("MODERATOR") || roles.includes("FINANCE_ADMIN");
    AppState.helper = null;
    if(!AppState.isAdmin){   // a supportive admin (joined with a team link)
      try{ const { data: acc } = await supabase.rpc("get_my_helper_access"); if(acc && acc.member) AppState.helper = acc; }catch(e){}
    }
    document.documentElement.classList.toggle("is-helper", !AppState.isAdmin && !!AppState.helper);
    AppState.wallet = await getWallet(session.user.id);
    applyTheme(profile);
  }catch(e){ console.error(e); toast("Couldn't load your account. Please refresh.", "error"); }
  return true;
}

/** Returns a snapshot ctx object matching each page module's expected shape, or null if the
 *  page requires admin and the current user isn't one. */
function ctxFor(opts){
  opts = opts || {};
  if(opts.adminOnly && !AppState.isAdmin) return null;
  return { session:AppState.session, user:AppState.user, profile:AppState.profile, wallet:AppState.wallet, roles:AppState.roles, isAdmin:AppState.isAdmin, isStaff:AppState.isStaff };
}


async function refreshMailboxBadge(){
  if(!AppState.user) return;
  const {data,error}=await supabase.from("mailbox_messages").select("created_at").order("created_at",{ascending:false}).limit(100);
  if(error)return;
  const last=AppState.profile && AppState.profile.mailbox_last_read_at ? new Date(AppState.profile.mailbox_last_read_at).getTime() : 0;
  const has=(data||[]).some(x=>new Date(x.created_at).getTime()>last);
  const dot=document.getElementById("mail-nav-dot"); if(dot) dot.style.display=has?"block":"none";
}
async function signOut(){
  await supabase.auth.signOut();
  Router.go("");
}

/* ---------------- password change when two-step sign-in (Google Authenticator) is on ----------------
   Supabase only lets a member change their password from a session that passed the authenticator
   step (AAL2). A reset link or a normal login gives an AAL1 session, so we ask for the 6-digit code
   first, verify it, and then save the new password. */
function mfaCodeField(beforeEl, id){
  let input = document.getElementById(id);
  if(input) return input;
  const wrap = document.createElement("div");
  wrap.className = "field"; wrap.id = id + "-wrap";
  wrap.innerHTML = `<label for="${id}">Google Authenticator code</label>
    <input class="input" id="${id}" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code">
    <p class="hint" style="margin:6px 0 0;font-size:12.5px;opacity:.75;">Two-step sign-in is on for this account. Open Google Authenticator and type the Repuven code.</p>`;
  beforeEl.parentNode.insertBefore(wrap, beforeEl);
  input = wrap.querySelector("input");
  input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 6); });
  return input;
}
async function verifiedTotpFactor(){
  try{ const { data } = await supabase.auth.mfa.factors(); return (data || []).find(f => f.status === "verified") || null; }catch(_){ return null; }
}
async function updatePasswordWithMfa(password, beforeEl, codeId){
  const factor = await verifiedTotpFactor();
  if(factor){
    const input = mfaCodeField(beforeEl, codeId);
    const code = (input.value || "").replace(/\D/g, "");
    if(code.length !== 6){ input.focus(); return { error: { message: "Type the 6-digit code from Google Authenticator, then save again." } }; }
    const v = await supabase.auth.mfa.verifyCode(factor.id, code);
    if(v.error){ input.value = ""; input.focus(); return { error: { message: "That code didn't work. Type the newest code from Google Authenticator." } }; }
  }
  const res = await supabase.auth.updateUser({ password });
  if(res.error && /aal2|mfa/i.test(res.error.message || "")){
    mfaCodeField(beforeEl, codeId).focus();
    return { error: { message: "Two-step sign-in is on. Type the 6-digit code from Google Authenticator, then save again." } };
  }
  const w = document.getElementById(codeId + "-wrap"); if(!res.error && w) w.remove();
  return res;
}

/* ---------------- sidebar / topbar ---------------- */
const NAV_ITEMS = [];
/* A supportive admin opens only the parts the admin turned on for their link. */
const HELPER_TABS = { submissions: "surveys", deposits: "deposits", support: "support", members: "members" };
function canTab(tab){
  if(AppState.isAdmin) return true;
  const h = AppState.helper;
  return !!(h && h.active && HELPER_TABS[tab] && h[HELPER_TABS[tab]]);
}
function firstTab(){ return AppState.isAdmin ? "overview" : (["submissions", "deposits", "support", "members"].find(canTab) || "overview"); }
const ADMIN_NAV = [
  ["overview", "Overview", '<path d="M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z"/>'],
  ["announcements", "Announcements", '<path d="M3.5 8.5v3a1 1 0 0 0 1 1h2l5 3.5v-12l-5 3.5h-2a1 1 0 0 0-1 1Z"/><path d="M14.5 7.5a3.5 3.5 0 0 1 0 5M16.5 5a7 7 0 0 1 0 10"/><path d="M6.5 12.5 7.5 17h2"/>'],
  ["investors", "Investors Bank", '<path d="M3 8 10 4l7 4"/><path d="M5 8.5v6M8.7 8.5v6M11.3 8.5v6M15 8.5v6"/><path d="M3.5 16.5h13"/>'],
  ["leadership", "Leadership", '<path d="M3.5 7 6.6 14h6.8l3.1-7-4.2 2.6L10 4.5 7.7 9.6 3.5 7Z"/><path d="M6.5 16.5h7"/>'],
  ["members", "Members", '<circle cx="8" cy="7" r="3"/><path d="M2.5 16.5c.4-3 2.7-5 5.5-5s5.1 2 5.5 5"/><path d="M13 4.6a3 3 0 0 1 0 5.2M15.2 11.8c1.3.8 2.1 2.4 2.3 4.7"/>'],
  ["referrals", "Referrals", '<circle cx="10" cy="4.5" r="2"/><circle cx="4.5" cy="15" r="2"/><circle cx="15.5" cy="15" r="2"/><path d="M10 6.5v3.5M10 10H4.5v3M10 10h5.5v3"/>'],
  ["team", "Team", '<circle cx="7.5" cy="7" r="2.6"/><path d="M2.8 16c0-2.6 2.1-4.4 4.7-4.4s4.7 1.8 4.7 4.4"/><circle cx="14" cy="7.8" r="2.1"/><path d="M13.6 11.7c2.2 0 3.9 1.6 3.9 3.9"/>'],
  ["vip", "VIP Links", '<path d="M10 2.8l2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8l5-.7L10 2.8Z"/>'],
  ["transactions", "Transactions", '<path d="M4 7h11"/><path d="m12 4 3 3-3 3"/><path d="M16 13H5"/><path d="m8 10-3 3 3 3"/>'],
  ["withdrawals", "Withdrawals", '<path d="M10 3v10"/><path d="M6 9.5 10 13l4-3.5"/><path d="M4 15.5h12"/>'],
  ["deposits", "Deposits", '<path d="M10 14V4"/><path d="M6 7.5 10 4l4 3.5"/><path d="M4 16.5h12"/>'],
  ["social", "Social Links", '<circle cx="5" cy="10" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="15" cy="15" r="2"/><path d="m6.8 9 6.4-3M6.8 11l6.4 3"/>'],
  ["payments", "Payments", '<rect x="3" y="5.5" width="14" height="10" rx="2"/><path d="M3 8.5h14"/><path d="M6.5 12.5h3"/>'],
  ["submissions", "Submissions", '<path d="M5 3.5h7l3 3v10H5z"/><path d="M12 3.5v3h3"/><path d="m7.5 12 1.8 1.8 3.4-3.6"/>'],
  ["verifications", "Verifications", '<path d="M10 2.5 16 5v4.5c0 4-2.6 6.7-6 8-3.4-1.3-6-4-6-8V5l6-2.5Z"/><path d="m7.5 10 1.8 1.8 3.4-3.6"/>'],
  ["products", "Tasks & Sectors", '<rect x="3.5" y="6" width="13" height="10" rx="1.5"/><path d="M7 6V4.5a3 3 0 0 1 6 0V6"/>'],
  ["usertasks", "User Tasks", '<path d="M7 5.5h9M7 10h9M7 14.5h9"/><path d="M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01"/>'],
  ["articles", "Articles", '<path d="M4 4h12v12H4z"/><path d="M7 7.5h6M7 10h6M7 12.5h4"/>'],
  ["mailbox", "Mailbox", '<path d="M3 5.5h14v9H3z"/><path d="m3.5 6 6.5 5 6.5-5"/>'],
  ["support", "Support Chat", '<path d="M4 5.5h12v8H8l-4 3v-11Z"/><path d="M7 8.5h6M7 11h4"/>'],
  ["livechat", "Live Chat", '<path d="M4 5.5h12v8H8l-4 3v-11Z"/><circle cx="14.5" cy="8" r="1.2" fill="currentColor" stroke="none"/>'],
  ["leaderboard", "Leaderboard Prizes", '<path d="M5 17V9h3v8H5Zm4 0V5h3v12H9Zm4 0v-5h3v5h-3Z"/><path d="M4 17.5h12"/>'],
];

let __siteLogoSrc = null;
function getSiteLogoSrc(){
  if(__siteLogoSrc === null){
    const img = document.querySelector('#view-landing .brand-logo img');
    __siteLogoSrc = img ? img.src : "";
  }
  return __siteLogoSrc;
}

function hydrateSiteLogoAvatars(root=document){
  const src=getSiteLogoSrc();
  if(!src) return;
  root.querySelectorAll?.("[data-site-logo]").forEach(el=>{
    if(!el.querySelector("img")) el.innerHTML=`<img src="${src}" alt="Repuven">`;
  });
  root.querySelectorAll?.("[data-site-logo-avatar]").forEach(el=>{
    if(!el.querySelector("img")) el.innerHTML=`<img src="${src}" alt="Repuven">`;
  });
}
function prepareChatBackground(box){
  if(!box) return;
  const src=getSiteLogoSrc();
  if(src) box.style.setProperty("--chat-wa-logo-bg",`url("${src}")`);
}
function chatAvatarMarkup(name,avatarUrl,isAdmin=false,extraClass=""){
  const safeName=(name||"Member").trim() || "Member";
  const initial=escapeHtml(safeName.slice(0,1).toUpperCase());
  if(isAdmin) return `<span class="chat-wa-avatar chat-wa-avatar-logo ${extraClass}" data-site-logo-avatar aria-hidden="true"></span>`;
  if(avatarUrl) return `<span class="chat-wa-avatar has-photo ${extraClass}"><img src="${escapeHtml(avatarUrl)}" alt=""></span>`;
  return `<span class="chat-wa-avatar ${extraClass}">${initial}</span>`;
}
function fillChatAvatarElement(el,name,avatarUrl,isAdmin=false){
  if(!el) return;
  const safeName=(name||"Member").trim() || "Member";
  if(isAdmin){
    el.classList.add("chat-wa-avatar-logo");
    el.dataset.siteLogoAvatar="1";
    el.innerHTML="";
  }else if(avatarUrl){
    el.classList.add("has-photo");
    delete el.dataset.siteLogoAvatar;
    el.innerHTML=`<img src="${escapeHtml(avatarUrl)}" alt="">`;
  }else{
    el.classList.remove("has-photo","chat-wa-avatar-logo");
    delete el.dataset.siteLogoAvatar;
    el.textContent=safeName.slice(0,1).toUpperCase();
  }
  hydrateSiteLogoAvatars(el.parentElement||document);
}

function renderSidebar(){
  const mount = document.getElementById("app-sidebar");
  if(!mount) return;
  const profile = AppState.profile;
  const initials = ((profile && profile.full_name) || "A").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
  const logoSrc = getSiteLogoSrc();
  const brandMark = logoSrc ? `<img class="mark-logo" src="${logoSrc}" alt="">` : `<span class="mark">RV</span>`;
  const links = ADMIN_NAV.filter(([key]) => canTab(key)).map(([key, label, icon]) => `
    <a class="nav-link" data-navkey="${key}" href="#admin/${key}">
      <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
      <span>${label}</span>
    </a>`).join("");
  mount.innerHTML = `
    <a class="app-brand" href="#admin/${firstTab()}">
      ${brandMark}<span class="word"><img class="rv-word" src="assets/img/wordmark.svg" alt="Repuven"><small>${AppState.isAdmin ? "Admin" : "Team"}</small></span>
    </a>
    <nav style="display:flex;flex-direction:column;gap:2px;">${links}</nav>
    <div class="sidebar-foot">
      <div class="sidebar-user">
        <div class="av ${profile && profile.avatar_url ? "has-photo" : ""}">${profile && profile.avatar_url ? `<img src="${escapeHtml(profile.avatar_url)}" alt="">` : escapeHtml(initials || "A")}</div>
        <div class="meta">
          <div class="name">${escapeHtml((profile && profile.full_name) || "Admin")}</div>
          <div class="role">${AppState.isAdmin ? "Admin" : "Supportive admin"}</div>
        </div>
      </div>
      <button class="signout-btn" id="signout-btn">Sign out</button>
    </div>`;
  document.getElementById("signout-btn").addEventListener("click", signOut);
  setActiveNav();
}

function currentAdminTab(){
  const sub = parseHash().sub;
  return ADMIN_NAV.some(x => x[0] === sub) ? sub : "overview";
}
function setActiveNav(){
  const tab = currentAdminTab();
  document.querySelectorAll("#app-sidebar .nav-link").forEach(a => a.classList.toggle("active", a.dataset.navkey === tab));
}

const PAGE_META = {
  home:      { title:"Home",         sub:"What's happening on Repuven", actions:'<a href="#products" class="btn btn-primary btn-sm">Browse Survey <svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-arrow-right"/></svg></a>' },
  products:  { title:"Survey",     sub:"Review a Survey, submit proof, get paid" },
  profile:   { title:"Profile",      sub:"Account, verification and referrals" },
  wallet:    { title:"Wallet",       sub:"Your balance and earnings" },
  deposit:   { title:"Deposit",      sub:"Add money to post your own tasks" },
  withdraw:  { title:"Withdraw",     sub:"Cash out to Binance or bKash" },
  mailbox:   { title:"Mailbox",      sub:"Notices and messages from Repuven" },
  support:   { title:"Support Chat", sub:"Private chat with Repuven support" },
  livechat:  { title:"Live Chat", sub:"Group chat at set times" },
  leaderboard: { title:"Leaderboard", sub:"Top verified referral members" },
  leaderboard:{ title:"Leaderboard", sub:"Top members by verified referrals" },
  admin:     { title:"Admin Panel",  sub:"Manage Repuven" },
};
function setTopbar(){
  const item = ADMIN_NAV.find(x => x[0] === currentAdminTab());
  document.getElementById("topbar-title").textContent = item ? item[1] : "Admin";
  document.getElementById("topbar-sub").textContent = "Repuven admin panel";
  document.getElementById("topbar-actions").innerHTML = "";
}

function wireShellChrome(){
  const toggle = document.getElementById("menu-toggle");
  const sidebar = document.getElementById("app-sidebar");
  const scrim = document.getElementById("sidebar-scrim");
  if(toggle && sidebar && scrim){
    toggle.addEventListener("click", () => { sidebar.classList.add("open"); scrim.classList.add("show"); });
    scrim.addEventListener("click", () => { sidebar.classList.remove("open"); scrim.classList.remove("show"); });
  }
}

/* ---------------- router ---------------- */
const APP_PAGES = ["admin"];
const Modules = {}; // each page module registers itself here: { init(sub,params), onActivate(sub,params) }

function parseHash(){
  const raw = (location.hash || "").slice(1);
  if(!raw) return { page:"", sub:"", params:new URLSearchParams() };
  const qIdx = raw.indexOf("?");
  const pathPart = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const queryPart = qIdx === -1 ? "" : raw.slice(qIdx+1);
  const slashIdx = pathPart.indexOf("/");
  const page = slashIdx === -1 ? pathPart : pathPart.slice(0, slashIdx);
  const sub = slashIdx === -1 ? "" : pathPart.slice(slashIdx+1);
  return { page, sub, params: new URLSearchParams(queryPart) };
}
function isAuthCallbackHash(){
  const h = location.hash || "";
  const q = location.search || "";
  // Recovery links can arrive as a hash-token callback (implicit flow) or as a
  // query-string code callback (PKCE/OAuth). Keep the router from rendering the
  // landing page while the auth client is processing either form.
  return h.includes("access_token=") || h.includes("type=recovery") || h.includes("type=signup") || h.includes("error=") || h.includes("error_description=") || q.includes("code=") || q.includes("type=recovery");
}

function isRecoveryHash(){
  const h=(location.hash||"").slice(1);
  const params=new URLSearchParams(h);
  if(params.get("type")==="recovery" && (!!params.get("access_token") || !!params.get("refresh_token"))) return true;
  const qp=new URLSearchParams(location.search||"");
  if(qp.get("type")==="recovery" && !!qp.get("code")) return true;
  try{ if(qp.get("code") && localStorage.getItem("ss-recovery-pending")==="1") return true; }catch(e){}
  return false;
}

async function handlePasswordRecoveryHash(){
  if(!isRecoveryHash()) return false;
  if(!AppState.session) await loadAppState();
  if(!AppState.session) return false;
  const hashParams=new URLSearchParams((location.hash||"").slice(1));
  const queryParams=new URLSearchParams(location.search||"");
  const params=hashParams.get("type")==="recovery" ? hashParams : queryParams;
  // Handle recovery after the session exchange, even when PASSWORD_RECOVERY fired before boot listeners.
  showTopLevel("auth");
  AuthModule.activate("newpass", params);
  history.replaceState(null, "", location.pathname);
  try{ localStorage.removeItem("ss-recovery-pending"); }catch(e){}
  window.__ssRecoveryHandled=true;
  return true;
}
function restorePageScroll(){
  // The landing auth modal temporarily locks body scrolling. If auth state changes
  // directly from that modal, the modal can disappear before its close handler runs.
  // Always restore the normal document scroll state when leaving the auth layer.
  document.body.style.overflow = "";
  document.body.style.position = "";
  document.body.style.width = "";
  document.body.style.touchAction = "";
  document.documentElement.style.overflow = "";
}

function showTopLevel(which){
  document.getElementById("view-landing").style.display = which === "landing" ? "" : "none";
  document.getElementById("view-auth").style.display = which === "auth" ? "" : "none";
  document.getElementById("view-app").style.display = which === "app" ? "" : "none";
  if(which === "app"){
    restorePageScroll();
    applyTheme(AppState.profile);
  } else if(which === "landing"){
    const landingMode="dark";
    document.documentElement.setAttribute("data-theme",landingMode);
    document.documentElement.setAttribute("data-accent","green");
    applyLandingTheme(landingMode);
  } else {
    document.documentElement.setAttribute("data-theme","dark");
    document.documentElement.setAttribute("data-accent","green");
  }
  window.scrollTo(0,0);
}
function showPageSection(key, sub, params){
  APP_PAGES.forEach(p => { const el = document.getElementById("page-"+p); if(el) el.style.display = (p===key ? "" : "none"); });
  setTopbar(key);
  setActiveNav(key);
  const mod = Modules[key];
  if(mod){
    if(!mod.initialized){ mod.initialized = true; mod.init(sub, params); }
    else if(mod.onActivate){ mod.onActivate(sub, params); }
  }
  const sidebar = document.getElementById("app-sidebar"), scrim = document.getElementById("sidebar-scrim");
  if(sidebar) sidebar.classList.remove("open");
  if(scrim) scrim.classList.remove("show");
  restorePageScroll();
}

function embedNotice(msg){
  ["view-landing", "view-auth", "view-app"].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = "none"; });
  let box = document.getElementById("embed-notice");
  if(!box){ box = document.createElement("div"); box.id = "embed-notice"; document.body.appendChild(box); }
  box.textContent = msg;
  try{ window.parent.postMessage({ srvTeam: "noaccess", message: msg }, location.origin); }catch(e){}
}
async function route(){
  if(isAuthCallbackHash()) return;
  if(window.SRV_EMBED && !AppState.session){ embedNotice("Please refresh the page and sign in again."); return; }
  const { page, sub, params } = parseHash();

  if(!AppState.session){
    if(page === "auth" && (sub === "forgot" || sub === "newpass")){
      LandingAuth.close();
      showTopLevel("auth");
      AuthModule.activate(sub, params);
    } else {
      showTopLevel("landing");
      LandingAuth.activate("signin", params);
    }
    return;
  }
  // inside the main website's Team page: never show a login and never sign the site out
  if(window.SRV_EMBED && (!AppState.session || (!AppState.isAdmin && !(AppState.helper && AppState.helper.active && firstTab() !== "overview")))){
    embedNotice(AppState.session ? (AppState.helper ? "Your team access is turned off. Please ask the admin." : "This account has no team access.") : "Please refresh the page and sign in again.");
    return;
  }
  // this file is only for admins
  if(!AppState.isAdmin && !(AppState.helper && AppState.helper.active && firstTab() !== "overview")){
    toast(AppState.helper ? "Your team access is turned off. Please ask the admin." : "This account is not an admin account.", "error");
    await signOut();
    return;
  }
  if(page !== "admin"){ Router.go("admin/" + firstTab()); return; }
  if(!canTab(sub || "overview")){ Router.go("admin/" + firstTab()); return; }   // a team account opens only its own parts
  showTopLevel("app");
  showPageSection("admin", sub || "overview", params);
  if(window.SRV_EMBED){ const t = document.getElementById("embed-notice"); if(t) t.remove(); }
}
const Router = { go(hash){ if(location.hash.replace(/^#/, "") === hash) route(); else location.hash = hash; } };

// Defensive recovery for mobile browsers where a modal/body scroll lock can survive
// a fast auth-state transition. The app itself never needs body overflow hidden.
window.addEventListener("pageshow", () => {
  if(AppState.session && document.getElementById("view-app")?.style.display !== "none") restorePageScroll();
});

/* ---------------- Module: Auth (forgot-password / set-new-password only —
   sign in / sign up now live in the landing page's auth modal, see LandingAuth) ---------------- */
const AuthModule = (function(){
  const panels = ["forgot","newpass"];
  function showPanel(name){
    panels.forEach(p => document.getElementById("panel-"+p).classList.toggle("show", p===name));
    document.getElementById("panel-forgot-body").classList.toggle("show", name==="forgot");
    document.getElementById("panel-newpass-body").classList.toggle("show", name==="newpass");
    if(name==="newpass"){ resetRobotCheck(); setStep(2); }
  }
  function resetRobotCheck(){
    const box=document.getElementById("robot-check-wrap");
    const cb=document.getElementById("robot-check");
    const area=document.getElementById("form-newpass");
    const status=document.getElementById("robot-status");
    if(!box||!cb||!area) return;
    cb.checked=false; area.classList.remove("unlocked"); box.classList.remove("verified","verifying");
    if(status) status.textContent="Checking your browser…";
  }
  function passwordStrength(value){
    let score=0;
    if(value.length>=6) score+=25; if(value.length>=10) score+=25;
    if(/[A-Z]/.test(value)) score+=15; if(/[0-9]/.test(value)) score+=15; if(/[^A-Za-z0-9]/.test(value)) score+=20;
    return Math.min(score,100);
  }
  function setLoading(btn, loading, label){
    btn.disabled = loading;
    btn.querySelector(".btn-label").innerHTML = loading ? '<span class="spinner"></span>' : label;
  }
  function showErr(id, msg){ const el = document.getElementById(id); el.textContent = msg; el.style.display = msg ? "block" : "none"; }

  let codeEmail = "", resendTimer = null;
  function setStep(n){ document.querySelectorAll("#view-auth .recovery-step").forEach((s, i) => s.classList.toggle("active", i === n)); }
  function maskEmail(email){
    const at = email.indexOf("@");
    if(at < 1) return email;
    const user = email.slice(0, at), domain = email.slice(at);
    return (user.length <= 2 ? user.slice(0, 1) : user.slice(0, 2)) + "*".repeat(Math.max(2, Math.min(6, user.length - 2))) + domain;
  }
  function friendlyAuthError(msg){
    const m = String(msg || "");
    if(/expired|invalid/i.test(m) && /token|code|otp/i.test(m)) return "This code is wrong or too old. Check it, or send a new code.";
    const wait = m.match(/after (\d+) seconds?/i);
    if(wait) return "Please wait " + wait[1] + " seconds, then try again.";
    if(/rate limit/i.test(m)) return "Too many emails were sent. Please try again a little later.";
    return m;
  }
  function startResendTimer(){
    const b = document.getElementById("code-resend");
    let left = 60;
    clearInterval(resendTimer);
    b.disabled = true;
    b.textContent = "Send a new code (" + left + "s)";
    resendTimer = setInterval(() => {
      left -= 1;
      if(left <= 0){ clearInterval(resendTimer); b.disabled = false; b.textContent = "Send a new code"; }
      else b.textContent = "Send a new code (" + left + "s)";
    }, 1000);
  }
  function showCodeStep(email){
    codeEmail = email;
    document.getElementById("form-forgot").hidden = true;
    document.getElementById("form-code").hidden = false;
    document.getElementById("code-note").innerHTML = "We sent a code to <b>" + escapeHtml(maskEmail(email)) + "</b>. Type it below.";
    document.getElementById("fg-code").value = "";
    showErr("code-err", "");
    setStep(1);
    startResendTimer();
    setTimeout(() => document.getElementById("fg-code").focus(), 60);
  }
  function showEmailStep(){
    document.getElementById("form-forgot").hidden = false;
    document.getElementById("form-code").hidden = true;
    clearInterval(resendTimer);
    setStep(0);
  }

  let wired = false;
  function wireOnce(){
    if(wired) return;
    wired = true;
    document.getElementById("yr").textContent = new Date().getFullYear();

    document.getElementById("form-code").addEventListener("submit", async (e) => {
      e.preventDefault();
      showErr("code-err", "");
      const token = document.getElementById("fg-code").value.replace(/\D/g, "");
      if(token.length < 6){ showErr("code-err", "Type the code from the email."); return; }
      const btn = document.getElementById("code-submit");
      setLoading(btn, true);
      const { error } = await supabase.auth.verifyOtp({ email: codeEmail, token, type: "recovery" });
      setLoading(btn, false, "Continue");
      if(error){ showErr("code-err", friendlyAuthError(error.message) || "This code is wrong or too old."); return; }
      clearInterval(resendTimer);
      showPanel("newpass");
      toast("Code accepted. Now choose a new password.", "success");
    });
    document.getElementById("fg-code").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^0-9 ]/g, "").slice(0, 12); });
    document.getElementById("code-resend").addEventListener("click", async () => {
      if(!codeEmail) return;
      const b = document.getElementById("code-resend");
      b.disabled = true;
      const { error } = await supabase.auth.resetPasswordForEmail(codeEmail, { redirectTo: location.origin + location.pathname });
      if(error){ b.disabled = false; showErr("code-err", friendlyAuthError(error.message) || "Could not send a new code."); return; }
      showErr("code-err", "");
      toast("We sent a new code.", "success");
      startResendTimer();
    });
    document.getElementById("code-change").addEventListener("click", () => { showEmailStep(); document.getElementById("fg-email").focus(); });

    document.getElementById("form-forgot").addEventListener("submit", async (e) => {
      e.preventDefault();
      showErr("forgot-err","");
      const email = document.getElementById("fg-email").value.trim();
      const btn = document.getElementById("forgot-submit");
      setLoading(btn, true);
      const recoveryRedirect = location.origin + location.pathname; const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: recoveryRedirect });
      setLoading(btn, false, "Send code");
      if(error){ showErr("forgot-err", friendlyAuthError(error.message) || "Could not send the code."); return; }
      showCodeStep(email);
      toast("We sent a code to your email.", "success");
    });

    document.getElementById("robot-check").addEventListener("change", async (e) => {
      const box=document.getElementById("robot-check-wrap");
      const area=document.getElementById("form-newpass");
      const status=document.getElementById("robot-status");
      if(!e.target.checked){
        area.classList.remove("unlocked");
        box.classList.remove("verified","verifying");
        status.textContent="Ready for security verification";
        return;
      }
      box.classList.add("verifying");
      box.classList.remove("verified");
      area.classList.remove("unlocked");
      status.textContent="Checking browser signals…";
      await new Promise(r=>setTimeout(r,420));
      status.textContent="Validating secure session…";
      await new Promise(r=>setTimeout(r,420));
      status.textContent="Completing security handshake…";
      await new Promise(r=>setTimeout(r,420));
      box.classList.remove("verifying");
      box.classList.add("verified");
      status.textContent="✓ Verification complete · Secure session confirmed";
      area.classList.add("unlocked");
      if(await verifiedTotpFactor()) mfaCodeField(document.getElementById("newpass-err"), "np-mfa");
    });

    document.getElementById("np-pass").addEventListener("input", (e) => {
      const score=passwordStrength(e.target.value);
      document.getElementById("password-strength-bar").style.width=score+"%";
      document.getElementById("password-hint").textContent=score>=80?"Strong password":"Use at least 6 characters. Mix letters, numbers and symbols.";
    });

    document.getElementById("form-newpass").addEventListener("submit", async (e) => {
      e.preventDefault();
      showErr("newpass-err","");
      if(!document.getElementById("robot-check").checked){ showErr("newpass-err","Please complete the security check first."); return; }
      const password = document.getElementById("np-pass").value;
      const confirm = document.getElementById("np-pass-confirm").value;
      if(password.length < 6){ showErr("newpass-err","Password must be at least 6 characters."); return; }
      if(password !== confirm){ showErr("newpass-err","The passwords do not match."); return; }
      const btn = document.getElementById("newpass-submit");
      setLoading(btn, true);
      const { error } = await updatePasswordWithMfa(password, document.getElementById("newpass-err"), "np-mfa");
      setLoading(btn, false, "Save new password");
      if(error){ showErr("newpass-err", error.message || "Couldn't update your password."); return; }
      toast("Password updated successfully.", "success");
      try{ localStorage.removeItem("ss-recovery-pending"); localStorage.removeItem("ss-recovery-pkce-verifier"); }catch(e){}
      await loadAppState(); renderSidebar(); Router.go("admin/" + firstTab());
    });
  }

  /** Called by the router when we land on #auth/forgot or #auth/newpass while logged out. */
  function activate(sub){
    wireOnce();
    const name = panels.includes(sub) ? sub : "forgot";
    if(name === "forgot") showEmailStep();
    showPanel(name);
  }

  return { activate };
})();

/* ---------------- Module: Admin sign-in (this file has no member sign-up) ---------------- */
const LandingAuth = (function(){
  const modal = document.getElementById("authModal");
  let wired = false;

  function showMessage(message, type){ const el = document.getElementById("authStatus"); el.textContent = message; el.className = "auth-status " + (type||""); }
  function setBusy(busy){ modal.querySelector(".auth-main").classList.toggle("auth-loading", busy); }
  function open(){ modal.classList.add("is-open"); modal.setAttribute("aria-hidden","false"); showMessage("",""); }
  function close(){ modal.classList.remove("is-open"); modal.setAttribute("aria-hidden","true"); showMessage("",""); }

  function wireOnce(){
    if(wired) return;
    wired = true;
    modal.querySelectorAll("[data-toggle-pass]").forEach(btn => btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.togglePass);
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.textContent = showing ? "SHOW" : "HIDE";
    }));
    document.getElementById("forgotPassLink").addEventListener("click", () => Router.go("auth/forgot"));
    document.getElementById("signinForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      setBusy(true); showMessage("Signing in...", "success");
      const { error } = await supabase.auth.signInWithPassword({
        email: document.getElementById("signinEmail").value.trim(),
        password: document.getElementById("signinPassword").value
      });
      setBusy(false);
      if(error){ showMessage(error.message === "Invalid login credentials" ? "Wrong email or password." : (error.message || "Could not sign in.")); return; }
      document.getElementById("signinPassword").value = "";
      showMessage("Signed in.", "success");
      // boot()'s auth listener loads the account, then opens the panel (a non-admin account is signed out again)
    });
  }

  /** Called by the router when nobody is signed in. */
  function activate(){ wireOnce(); open(); }

  return { activate, close };
})();

/* ---------------- Public landing theme ---------------- */
function applyLandingTheme(){
  const landing=document.getElementById("view-landing");
  if(landing) landing.setAttribute("data-landing-theme","dark");
}
function initLandingTheme(){
  try{ localStorage.removeItem("ss_landing_theme"); }catch(e){}
  applyLandingTheme();
}

/* ---------------- Module: Admin ---------------- */
Modules.admin = (function(){
  const sb = supabase;

  // ---------- tabs ----------
  const tabs = ["overview","announcements","investors","leadership","members","referrals","team","vip","articles","products","usertasks","submissions","verifications","transactions","withdrawals","deposits","payments","social","mailbox","support","livechat","leaderboard"];
  function renderTab(name){
    if(!canTab(name)) name = firstTab();
    tabs.forEach(t => {
      document.getElementById("pane-"+t).classList.toggle("show", t===name);
      const btn = document.querySelector(`.atabs button[data-tab="${t}"]`);
      btn.classList.toggle("active", t===name);
      btn.hidden = !canTab(t);
    });
    loaders[name] && loaders[name]();
  }
  function wireTabsOnce(){
    document.querySelectorAll(".atabs button").forEach(b => b.addEventListener("click", () => Router.go("admin/"+b.dataset.tab)));
  }

  // ---------- modal helpers ----------
  const modal = document.getElementById("modal");
  function openModal(title, bodyHtml){
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-body").innerHTML = bodyHtml;
    modal.style.display = "flex";
  }
  function closeModal(){ modal.style.display = "none"; const m = modal.querySelector(".modal"); if(m) m.classList.remove("modal-wide"); }
  document.getElementById("modal-close").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if(e.target.id === "modal") closeModal(); });

  async function uploadPublicImage(file, prefix){
    if(!file) return null;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    const { error } = await sb.storage.from("super-survey-public").upload(path, file, { upsert:false });
    if(error) throw error;
    const { data } = sb.storage.from("super-survey-public").getPublicUrl(path);
    return data.publicUrl;
  }

  // ============ OVERVIEW ============
  async function loadOverview(){
    const [{count:total}, {count:verified}, {count:pendingSubs}, {count:pendingVerif}, {count:pendingWd}, {count:pendingTasks}, {count:pendingDep}, plat, vipRes] = await Promise.all([
      sb.from("profiles").select("id",{count:"exact",head:true}),
      sb.from("profiles").select("id",{count:"exact",head:true}).eq("is_verified",true).eq("is_vip",false),
      sb.from("survey_submissions").select("id",{count:"exact",head:true}).eq("status","PENDING"),
      sb.from("api_verification_requests").select("id",{count:"exact",head:true}).eq("status","PENDING"),
      sb.from("withdrawal_requests").select("id",{count:"exact",head:true}).eq("status","PENDING"),
      sb.from("survey_tasks").select("id",{count:"exact",head:true}).eq("status","PENDING_PRICING"),
      sb.from("deposit_requests").select("id",{count:"exact",head:true}).eq("status","PENDING"),
      sb.from("platform_commissions").select("amount").eq("commission_type","PLATFORM"),
      sb.from("profiles").select("id",{count:"exact",head:true}).eq("is_vip",true),
    ]);
    const platTotal = (plat.data || []).reduce((s,r) => s + Number(r.amount||0), 0);

    document.getElementById("ov-stats").innerHTML = `
      <div class="stat-card"><div class="label">Total members</div><div class="value">${total ?? 0}</div></div>
      <div class="stat-card"><div class="label">Verified members</div><div class="value">${verified ?? 0}</div><div style="margin-top:6px;font-size:12px;color:var(--muted);">VIP members (free): ${(vipRes && vipRes.count) || 0}</div></div>
      <div class="stat-card"><div class="label">Platform commission earned</div><div class="value">${money(platTotal)}</div></div>
      <div class="stat-card"><div class="label">Your wallet balance</div><div class="value">${money(AppState.wallet ? AppState.wallet.available_balance : 0)}</div></div>
    `;
    document.getElementById("ov-pending-subs").textContent = pendingSubs ?? 0;
    document.getElementById("ov-pending-verif").textContent = pendingVerif ?? 0;
    document.getElementById("ov-pending-wd").textContent = pendingWd ?? 0;
    document.getElementById("ov-pending-tasks").textContent = pendingTasks ?? 0;
    document.getElementById("ov-pending-dep").textContent = pendingDep ?? 0;
    loadOverviewSupport();
  }

  // ---- dashboard: support messages, with a quick reply ----
  function dhakaDayStart(){
    const now = new Date(), bd = new Date(now.getTime() + 6 * 3600000);
    return new Date(Date.UTC(bd.getUTCFullYear(), bd.getUTCMonth(), bd.getUTCDate()) - 6 * 3600000).toISOString();
  }
  function agoText(ts){
    const ms = Date.now() - new Date(ts).getTime(); if(!isFinite(ms)) return "";
    const m = Math.round(ms / 60000);
    if(m < 1) return "just now"; if(m < 60) return m + " min ago";
    const h = Math.round(m / 60); if(h < 24) return h + " h ago";
    const d = Math.round(h / 24); return d === 1 ? "yesterday" : d + " days ago";
  }
  async function loadOverviewSupport(){
    try{ await paintOverviewSupport(); }
    catch(e){ const box = document.getElementById("ov-sup"); if(box) box.innerHTML = `<div class="ov-sup-head"><h3>Support Chat</h3><button type="button" class="btn btn-secondary btn-sm" onclick="location.hash='#admin/support'">Open Support Chat</button></div><div class="ov-sup-empty">Couldn't load support messages here. Open Support Chat to see them.</div>`; console.error(e); }
  }
  async function paintOverviewSupport(){
    const box = document.getElementById("ov-sup"); if(!box) return;
    if(!canTab("support")){ box.hidden = true; return; }
    box.hidden = false;
    const [th, today] = await Promise.all([
      sb.rpc("admin_get_support_threads_v4"),
      sb.from("support_messages").select("id", { count: "exact", head: true }).eq("sender", "USER").gte("created_at", dhakaDayStart())
    ]);
    if(th.error){ box.innerHTML = `<div class="ov-sup-head"><h3>Support Chat</h3></div><div class="ov-sup-empty">Couldn't load support messages. ${escapeHtml(th.error.message || "")}</div>`; return; }
    const threads = Array.isArray(th.data) ? th.data : [];
    SUP.threads = threads; SUP.loaded = true; paintSupportBadge();
    const unread = threads.reduce((n, t) => n + (Number(t.unread_count) || 0), 0);
    const waiting = threads.filter(t => Number(t.unread_count) > 0 || t.sender === "USER");
    const todayN = today && !today.error ? (today.count || 0) : null;
    const shown = waiting.slice(0, 8);
    box.innerHTML = `
      <div class="ov-sup-head"><h3>Support Chat</h3><button type="button" class="btn btn-secondary btn-sm" id="ov-sup-all">Open Support Chat</button></div>
      <div class="ov-sup-nums">
        <div class="${unread ? "is-hot" : ""}"><small>New messages</small><b>${unread}</b></div>
        <div><small>Waiting for a reply</small><b>${waiting.length}</b></div>
        <div><small>Messages today</small><b>${todayN == null ? "—" : todayN}</b></div>
      </div>
      ${shown.length ? shown.map(t => `
        <div class="ov-sup-item" data-uid="${t.user_id}">
          <div class="ov-sup-top">${ChatKit.avatar({ name: t.full_name || "Member", url: t.avatar_url, size: "sm" })}
            <div class="grow"><div class="ov-sup-name">${escapeHtml(t.full_name || "Member")}${Number(t.unread_count) ? `<span class="nb">${Number(t.unread_count)} new</span>` : ""}</div></div>
            <span class="ov-sup-time">${agoText(t.created_at)}</span></div>
          <p class="ov-sup-msg">${escapeHtml(String(t.body || "").slice(0, 400))}</p>
          <form class="ov-sup-form"><textarea class="input" rows="1" maxlength="2000" placeholder="Write a reply to ${escapeHtml(t.full_name || "this member")}…"></textarea><button class="btn btn-primary btn-sm" type="submit">Send</button></form>
          <div class="ov-sup-more"><button type="button" class="btn btn-secondary btn-sm" data-open="${t.user_id}">Open full chat</button></div>
        </div>`).join("") + (waiting.length > shown.length ? `<div class="ov-sup-empty">${waiting.length - shown.length} more waiting in Support Chat.</div>` : "")
        : `<div class="ov-sup-empty">All caught up. No member is waiting for a reply.</div>`}`;
    document.getElementById("ov-sup-all").addEventListener("click", () => Router.go("admin/support"));
    box.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => {
      const uid = b.dataset.open; Router.go("admin/support");
      setTimeout(() => { try{ openThread(uid); }catch(e){} }, 350);
    }));
    box.querySelectorAll(".ov-sup-item").forEach(item => {
      const form = item.querySelector("form"), ta = form.querySelector("textarea"), btn = form.querySelector("button");
      ta.addEventListener("keydown", e => { if(e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const text = ta.value.trim(); if(!text){ ta.focus(); return; }
        btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
        const { error } = await sb.rpc("admin_send_support_message", { p_user_id: item.dataset.uid, p_body: text });
        btn.disabled = false; btn.textContent = "Send";
        if(error){ toast(supErr(error), "error"); return; }
        toast("Reply sent. It shows up in their Support Chat.", "success");
        loadOverviewSupport();
      });
    });
  }

  // ============ ARTICLES ============
  async function loadArticles(){
    const list = document.getElementById("articles-list");
    const { data, error } = await sb.from("articles").select("*").order("created_at",{ascending:false});
    if(error){ list.innerHTML = `<div class="empty-state"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-warning"/></svg> Couldn't load articles.</div>`; return; }
    if(!data.length){ list.innerHTML = `<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-newspaper"/></svg></div>No articles yet.</div>`; return; }
    list.innerHTML = data.map(a => `
      <div class="list-item">
        ${a.image_url ? `<img class="mini-thumb" src="${escapeHtml(a.image_url)}">` : `<div class="mini-thumb"></div>`}
        <div class="grow">
          <div class="ttl">${escapeHtml(a.title)} ${a.is_published ? '<span class="badge badge-green">Published</span>' : '<span class="badge badge-muted">Draft</span>'}</div>
          <div class="sub2">${fmtDate(a.created_at)}</div>
        </div>
        <div class="list-actions">
          <button class="btn btn-secondary btn-sm" data-edit="${a.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-del="${a.id}">Delete</button>
        </div>
      </div>`).join("");

    list.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openArticleForm(data.find(x=>x.id===b.dataset.edit))));
    list.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      if(!confirm("Delete this article?")) return;
      const { error } = await sb.from("articles").delete().eq("id", b.dataset.del);
      if(error){ toast("Couldn't delete.", "error"); return; }
      toast("Article deleted.", "success"); loadArticles();
    }));
  }
  document.getElementById("new-article-btn").addEventListener("click", () => openArticleForm(null));

  function openArticleForm(article){
    openModal(article ? "Edit article" : "New article", `
      <form id="article-form">
        <div class="field"><label>Title</label><input class="input" id="ar-title" required value="${article ? escapeHtml(article.title) : ""}"></div>
        <div class="field"><label>Body</label><textarea class="input" id="ar-body" required style="min-height:140px;">${article ? escapeHtml(article.body) : ""}</textarea></div>
        <div class="field">
          <label>Image (optional)</label>
          ${article && article.image_url ? `<img src="${escapeHtml(article.image_url)}" style="max-height:120px;border-radius:10px;margin-bottom:8px;">` : ""}
          <input class="input" id="ar-image" type="file" accept="image/*">
        </div>
        <div class="field" style="display:flex;align-items:center;gap:10px;">
          <label class="switch"><input type="checkbox" id="ar-published" ${!article || article.is_published ? "checked" : ""}><span class="track"></span></label>
          <label style="margin:0;">Published</label>
        </div>
        <div class="field error" id="ar-err" style="display:none;"></div>
        <button class="btn btn-primary btn-block" type="submit"><span class="btn-label">${article ? "Save changes" : "Create article"}</span></button>
      </form>`);

    document.getElementById("article-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("ar-err"); errEl.style.display="none";
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true; btn.querySelector(".btn-label").innerHTML = '<span class="spinner"></span>';
      try{
        const file = document.getElementById("ar-image").files[0];
        const image_url = file ? await uploadPublicImage(file, "articles") : (article ? article.image_url : null);
        const payload = {
          title: document.getElementById("ar-title").value.trim(),
          body: document.getElementById("ar-body").value.trim(),
          is_published: document.getElementById("ar-published").checked,
          image_url
        };
        if(article){
          const { error } = await sb.from("articles").update(payload).eq("id", article.id);
          if(error) throw error;
        } else {
          const { error } = await sb.from("articles").insert({ ...payload, created_by: AppState.user.id });
          if(error) throw error;
        }
        closeModal(); toast("Saved.", "success"); loadArticles();
      }catch(err){
        errEl.textContent = err.message || "Couldn't save."; errEl.style.display = "block";
      }finally{
        btn.disabled = false; btn.querySelector(".btn-label").textContent = article ? "Save changes" : "Create article";
      }
    });
  }

  // ============ SOCIAL LINKS: icons in the landing page footer ============
  const SOCIAL_FIELDS = [["facebook","Facebook","https://facebook.com/yourpage"],["instagram","Instagram","https://instagram.com/yourname"],["x","X (Twitter)","https://x.com/yourname"],["tiktok","TikTok","https://tiktok.com/@yourname"],["telegram","Telegram","https://t.me/yourchannel"],["youtube","YouTube","https://youtube.com/@yourchannel"],["whatsapp","WhatsApp","https://wa.me/8801XXXXXXXXX"]];
  async function loadSocialAdmin(){
    const box = document.getElementById("social-admin"); if(!box) return;
    const { data, error } = await sb.rpc("get_social_links");
    if(error){ box.innerHTML = `<div class="field error">Couldn't load the links. ${escapeHtml(error.message || "")}</div>`; return; }
    const v = data || {};
    box.innerHTML = `
      <form id="social-form" class="social-form" novalidate>
        ${SOCIAL_FIELDS.map(([k, label, ph]) => `<div class="field"><label for="soc-${k}">${label}</label><input class="input" id="soc-${k}" name="${k}" type="url" inputmode="url" placeholder="${ph}" value="${escapeHtml(v[k] || "")}"></div>`).join("")}
        <div class="field error" id="social-err" style="display:none;"></div>
        <div class="social-actions"><button class="btn btn-primary" type="submit"><span class="btn-label">Save links</span></button></div>
      </form>`;
    document.getElementById("social-form").addEventListener("submit", async e => {
      e.preventDefault();
      const err = document.getElementById("social-err"); err.style.display = "none";
      const links = {};
      for(const [k, label] of SOCIAL_FIELDS){
        let val = document.getElementById("soc-" + k).value.trim();
        if(val && !/^https?:\/\//i.test(val)) val = "https://" + val;
        if(val.startsWith("http://")) val = "https://" + val.slice(7);
        if(val && !/^https:\/\/[^\s<>"']+\.[^\s<>"']+/.test(val)){ err.textContent = label + ": this doesn't look like a link."; err.style.display = "block"; return; }
        links[k] = val;
      }
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      const { error } = await sb.rpc("admin_set_social_links", { p_links: links });
      btn.disabled = false;
      if(error){ err.textContent = error.message || "Couldn't save."; err.style.display = "block"; return; }
      toast("Saved. The icons show in the landing page footer now. Empty ones stay hidden.", "success");
      loadSocialAdmin();
    });
  }

  // ============ SECTORS: Survey and any other kind of work ============
  const SEC_ICONS = {
    clipboard:['Clipboard','<rect x="3.5" y="6" width="13" height="10" rx="1.5"/><path d="M7 6V4.5a3 3 0 0 1 6 0V6"/>'],
    star:['Star','<path d="m10 3.5 1.9 4 4.3.5-3.2 3 .9 4.3L10 13.1l-3.9 2.2.9-4.3-3.2-3 4.3-.5L10 3.5Z"/>'],
    phone:['Phone / app','<rect x="6" y="2.5" width="8" height="15" rx="2"/><path d="M9 15h2"/>'],
    video:['Video','<rect x="3" y="5.5" width="10" height="9" rx="2"/><path d="m13 9 4-2.5v7L13 11"/>'],
    chat:['Chat','<path d="M4 5.5h12v8H8l-4 3v-11Z"/>'],
    globe:['Website','<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2.2 2.8 4.5 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.5-2.8-7S8 5.2 10 3Z"/>'],
    pen:['Writing','<path d="m12.5 4.5 3 3L7 16H4v-3l8.5-8.5Z"/>'],
    cart:['Shopping','<path d="M3 4h2l1.6 8.5h8.2L16.5 7H6"/><circle cx="8" cy="15.5" r="1"/><circle cx="14" cy="15.5" r="1"/>'],
    megaphone:['Social media','<path d="M4 8.5v3h2.5L13 15V5L6.5 8.5H4Z"/><path d="M15.5 8a3 3 0 0 1 0 4"/>'],
    gift:['Gift','<rect x="3.5" y="8" width="13" height="8.5" rx="1"/><path d="M3 8h14M10 8v8.5M10 8C8.5 5 6 5 6 6.5S8 8 10 8Zm0 0c1.5-3 4-3 4-1.5S12 8 10 8Z"/>']
  };
  const secSvg = k => `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(SEC_ICONS[k] || SEC_ICONS.clipboard)[1]}</svg>`;
  const SEC = { list: [], cur: "all" };
  const secDefault = () => SEC.list.find(x => x.is_default) || SEC.list[0] || null;
  const secById = id => SEC.list.find(x => x.id === id) || null;
  async function loadSectorsAdmin(){
    const { data, error } = await sb.rpc("admin_get_work_sectors");
    if(!error) SEC.list = Array.isArray(data) ? data : [];
    if(SEC.cur !== "all" && !secById(SEC.cur)) SEC.cur = "all";
    paintSectorBar();
  }
  function paintSectorBar(){
    const bar = document.getElementById("sec-bar"); if(!bar) return;
    const all = SEC.list.reduce((n, x) => n + Number(x.tasks || 0), 0);
    bar.innerHTML = `<button type="button" class="sec-chip ${SEC.cur === "all" ? "on" : ""}" data-sec="all">All <span>${all}</span></button>` +
      SEC.list.map(x => `<button type="button" class="sec-chip ${SEC.cur === x.id ? "on" : ""} ${x.is_active ? "" : "is-off"}" data-sec="${x.id}" title="${x.is_active ? "Members see this sector" : "Hidden from members"}">${secSvg(x.icon)}${escapeHtml(x.name)} <span>${Number(x.tasks || 0)}</span>${Number(x.pending) ? `<em>${Number(x.pending)} to check</em>` : ""}</button>`).join("");
    bar.querySelectorAll("[data-sec]").forEach(b => b.addEventListener("click", () => { SEC.cur = b.dataset.sec; paintSectorBar(); loadProducts(); }));
    const nb = document.getElementById("new-product-btn");
    if(nb){ const cur = secById(SEC.cur); nb.textContent = cur ? `+ New ${cur.name} task` : "+ New task"; }
  }
  function sectorSelect(id, selected){
    const sel = selected || (SEC.cur !== "all" ? SEC.cur : (secDefault() || {}).id);
    return `<div class="field"><label for="${id}">Sector</label><select class="input" id="${id}">${SEC.list.map(x => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${escapeHtml(x.name)}${x.is_active ? "" : " (hidden)"}</option>`).join("")}</select></div>`;
  }
  const slugify = v => String(v || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "sector";
  function uniqueSlug(name, skipId){
    const base = slugify(name); let slug = base, n = 2;
    while(SEC.list.some(x => x.slug === slug && x.id !== skipId)) slug = base.slice(0, 33) + "-" + n++;
    return slug;
  }
  function openSectors(){
    const iconOpts = sel => Object.entries(SEC_ICONS).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v[0]}</option>`).join("");
    const rows = () => SEC.list.length ? SEC.list.map((x, i) => `
      <div class="sec-row ${x.is_active ? "" : "is-off"}" data-id="${x.id}">
        <span class="sec-ico">${secSvg(x.icon)}</span>
        <div class="grow"><div class="ttl">${escapeHtml(x.name)} ${x.is_default ? '<span class="badge badge-muted">Main</span>' : ""} ${x.is_active ? "" : '<span class="badge badge-gold">Hidden</span>'}</div>
          <div class="sub2">${escapeHtml(x.description || "No description")} · ${Number(x.live || 0)} live of ${Number(x.tasks || 0)} tasks</div></div>
        <div class="list-actions">
          <button class="btn btn-secondary btn-sm" type="button" data-up="${x.id}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
          <button class="btn btn-secondary btn-sm" type="button" data-down="${x.id}" ${i === SEC.list.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
          <button class="btn btn-secondary btn-sm" type="button" data-edit-sec="${x.id}">Edit</button>
          ${x.is_default ? "" : `<button class="btn btn-secondary btn-sm" type="button" data-toggle="${x.id}">${x.is_active ? "Hide" : "Show"}</button>
          <button class="btn btn-danger btn-sm" type="button" data-del-sec="${x.id}">Delete</button>`}
        </div>
      </div>`).join("") : `<div class="empty-state">No sectors yet.</div>`;
    openModal("Sectors", `
      <p class="sec-help">A sector is a kind of work, like Survey. Each sector gets its own page in the members' menu and shows only its own tasks.</p>
      <div id="sec-rows">${rows()}</div>
      <form id="sec-form" class="sec-form">
        <input type="hidden" id="sec-id">
        <div class="sec-sec" id="sec-form-title">Add a sector</div>
        <div class="grid grid-2">
          <div class="field"><label for="sec-name">Name</label><input class="input" id="sec-name" maxlength="40" required placeholder="App Testing"></div>
          <div class="field"><label for="sec-icon">Icon</label><select class="input" id="sec-icon">${iconOpts("clipboard")}</select></div>
        </div>
        <div class="field"><label for="sec-desc">Short line under the title (optional)</label><input class="input" id="sec-desc" maxlength="160" placeholder="Try apps and tell us what you think"></div>
        <label class="sec-check"><input type="checkbox" id="sec-active" checked> Show to members now</label>
        <div class="field error" id="sec-err" style="display:none;"></div>
        <div class="sec-actions"><button class="btn btn-secondary" type="button" id="sec-cancel" hidden>Cancel</button><button class="btn btn-primary" type="submit"><span class="btn-label">Add sector</span></button></div>
      </form>`);
    const err = m => { const e = document.getElementById("sec-err"); e.textContent = m; e.style.display = m ? "block" : "none"; };
    const resetForm = () => {
      document.getElementById("sec-id").value = ""; document.getElementById("sec-name").value = ""; document.getElementById("sec-desc").value = "";
      document.getElementById("sec-icon").value = "clipboard"; document.getElementById("sec-active").checked = true; document.getElementById("sec-active").disabled = false;
      document.getElementById("sec-form-title").textContent = "Add a sector"; document.querySelector("#sec-form .btn-label").textContent = "Add sector";
      document.getElementById("sec-cancel").hidden = true; err("");
    };
    const refresh = async () => { await loadSectorsAdmin(); document.getElementById("sec-rows").innerHTML = rows(); wire(); };
    function wire(){
      const box = document.getElementById("sec-rows");
      box.querySelectorAll("[data-edit-sec]").forEach(b => b.addEventListener("click", () => {
        const x = secById(b.dataset.editSec); if(!x) return;
        document.getElementById("sec-id").value = x.id; document.getElementById("sec-name").value = x.name; document.getElementById("sec-desc").value = x.description || "";
        document.getElementById("sec-icon").value = SEC_ICONS[x.icon] ? x.icon : "clipboard";
        document.getElementById("sec-active").checked = x.is_active; document.getElementById("sec-active").disabled = !!x.is_default;
        document.getElementById("sec-form-title").textContent = "Edit " + x.name; document.querySelector("#sec-form .btn-label").textContent = "Save changes";
        document.getElementById("sec-cancel").hidden = false; err("");
        document.getElementById("sec-name").focus();
      }));
      box.querySelectorAll("[data-toggle]").forEach(b => b.addEventListener("click", async () => {
        const x = secById(b.dataset.toggle); if(!x) return; b.disabled = true;
        const { error } = await sb.from("work_sectors").update({ is_active: !x.is_active }).eq("id", x.id);
        if(error){ toast(error.message || "Couldn't save.", "error"); b.disabled = false; return; }
        toast(x.is_active ? x.name + " is hidden from members." : x.name + " is shown to members.", "success"); refresh();
      }));
      box.querySelectorAll("[data-del-sec]").forEach(b => b.addEventListener("click", async () => {
        const x = secById(b.dataset.delSec); if(!x) return;
        if(!confirm(`Delete the sector "${x.name}"?`)) return;
        b.disabled = true;
        const { error } = await sb.from("work_sectors").delete().eq("id", x.id);
        if(error){ toast(error.message || "Couldn't delete.", "error"); b.disabled = false; return; }
        toast("Sector deleted.", "success"); if(SEC.cur === x.id) SEC.cur = "all"; refresh(); loadProducts();
      }));
      const move = async (id, dir) => {
        const i = SEC.list.findIndex(x => x.id === id), j = i + dir; if(i < 0 || j < 0 || j >= SEC.list.length) return;
        const order = SEC.list.slice(); [order[i], order[j]] = [order[j], order[i]];
        for(let k = 0; k < order.length; k++){
          if(Number(order[k].sort_order) !== (k + 1) * 10){ const { error } = await sb.from("work_sectors").update({ sort_order: (k + 1) * 10 }).eq("id", order[k].id); if(error){ toast(error.message || "Couldn't save.", "error"); return; } }
        }
        refresh();
      };
      box.querySelectorAll("[data-up]").forEach(b => b.addEventListener("click", () => move(b.dataset.up, -1)));
      box.querySelectorAll("[data-down]").forEach(b => b.addEventListener("click", () => move(b.dataset.down, 1)));
    }
    wire();
    document.getElementById("sec-cancel").addEventListener("click", resetForm);
    document.getElementById("sec-form").addEventListener("submit", async e => {
      e.preventDefault(); err("");
      const id = document.getElementById("sec-id").value;
      const name = document.getElementById("sec-name").value.trim().replace(/\s+/g, " ");
      if(!name){ err("Write a name for the sector."); return; }
      if(SEC.list.some(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== id)){ err("There is already a sector with this name."); return; }
      const payload = { name, description: document.getElementById("sec-desc").value.trim(), icon: document.getElementById("sec-icon").value };
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      let res;
      if(id){
        const x = secById(id);
        if(x && !x.is_default) payload.is_active = document.getElementById("sec-active").checked;
        res = await sb.from("work_sectors").update(payload).eq("id", id);
      }else{
        payload.slug = uniqueSlug(name); payload.is_active = document.getElementById("sec-active").checked;
        payload.sort_order = (SEC.list.length + 1) * 10;
        res = await sb.from("work_sectors").insert(payload);
      }
      btn.disabled = false;
      if(res.error){ err(res.error.message || "Couldn't save."); return; }
      toast(id ? "Sector saved." : `${name} added. Members will see it in their menu.`, "success");
      resetForm(); refresh(); loadProducts();
    });
  }
  document.getElementById("manage-sectors-btn")?.addEventListener("click", async () => { await loadSectorsAdmin(); openSectors(); });

  // ============ PRODUCTS ============
  async function loadProducts(){
    const list = document.getElementById("products-list");
    if(!list) return;
    list.innerHTML = `<div class="empty-state"><span class="spinner"></span> Loading Survey…</div>`;
    try{
      await loadSectorsAdmin();
      let query = sb.from("survey_tasks").select("*").neq("status","PENDING_PRICING").is("removed_at", null).order("created_at",{ascending:false});
      if(SEC.cur !== "all") query = query.eq("sector_id", SEC.cur);
      const result = await Promise.race([
        query,
        new Promise((_,reject)=>setTimeout(()=>reject(new Error("Survey list is taking too long to load. Please tap Refresh.")),10000))
      ]);
      const { data, error } = result || {};
      if(error) throw error;
      const rows = Array.isArray(data) ? data : [];
      if(!rows.length){ const cs = secById(SEC.cur); list.innerHTML = `<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-bag"/></svg></div>No ${cs ? escapeHtml(cs.name) + " " : ""}tasks yet.</div>`; return; }

    const statusBadge = s => s==="PUBLISHED"?'<span class="badge badge-green">Published</span>':s==="PAUSED"?'<span class="badge badge-gold">Paused</span>':s==="CLOSED"?'<span class="badge badge-muted">Closed</span>':s==="CANCELLED"?'<span class="badge badge-danger">Cancelled</span>':'<span class="badge badge-muted">Draft</span>';

    list.innerHTML = rows.map(t => `
      <div class="list-item">
        <div class="grow">
          <div class="ttl">${escapeHtml(t.title)} ${statusBadge(t.status)}</div>
          <div class="sub2">${SEC.cur === "all" && secById(t.sector_id) ? `<span class="sec-tag">${escapeHtml(secById(t.sector_id).name)}</span> ` : ""}${money(t.reward)} reward ${t.budget!=null ? "· budget " + money(t.budget) : "· no budget cap"}</div>
        </div>
        <div class="list-actions">
          <button class="btn btn-secondary btn-sm" data-edit="${t.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-del="${t.id}">Delete</button>
        </div>
      </div>`).join("");

    list.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openProductForm(rows.find(x=>x.id===b.dataset.edit))));
    list.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      if(!confirm("Delete this survey? Members will not see it any more.")) return;
      b.disabled = true;
      const { data: res, error } = await sb.rpc("admin_delete_survey_task", { p_task_id: b.dataset.del });
      b.disabled = false;
      if(error){ toast(error.message || "Couldn't delete.", "error"); return; }
      toast(res && res.mode === "HIDDEN" ? "Survey deleted. Members' past work and rewards for it are kept." : "Survey deleted.", "success"); loadProducts();
    }));
    }catch(err){
      console.error("loadProducts", err);
      list.innerHTML = `<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-warning"/></svg></div><b>Couldn't load Survey.</b><div style="margin-top:6px;color:var(--muted);font-size:12px;">${escapeHtml(err?.message||"Please try again.")}</div><button type="button" class="btn btn-secondary btn-sm" id="products-retry" style="margin-top:12px;">Retry</button></div>`;
      document.getElementById("products-retry")?.addEventListener("click", loadProducts);
    }
  }
  document.getElementById("new-product-btn")?.addEventListener("click", () => openProductForm(null));
  document.getElementById("bulk-product-btn")?.addEventListener("click", () => openBulkForm());

  function openProductForm(t){
    openModal(t ? "Edit task" : "New task", `
      <form id="product-form">
        ${sectorSelect("pr-sector", t && t.sector_id)}
        <div class="field"><label>Title</label><input class="input" id="pr-title" required value="${t ? escapeHtml(t.title) : ""}"></div>
        <div class="field"><label>Short description</label><textarea class="input" id="pr-desc">${t ? escapeHtml(t.description||"") : ""}</textarea></div>
        <div class="field"><label>Instructions for the user</label><textarea class="input" id="pr-instr">${t ? escapeHtml(t.instructions||"") : ""}</textarea></div>
        <div class="field"><label>Task link (optional)</label><input class="input" id="pr-url" value="${t ? escapeHtml(t.target_url||"") : ""}" placeholder="https://…"></div>
        <div class="grid grid-2">
          <div class="field"><label>Reward (USD)</label><input class="input" id="pr-reward" type="number" step="0.01" min="0" required value="${t ? t.reward : ""}"></div>
          <div class="field"><label>Budget cap (USD, optional)</label><input class="input" id="pr-budget" type="number" step="0.01" min="0" value="${t && t.budget!=null ? t.budget : ""}" placeholder="No cap"></div>
        </div>
        <div class="field">
          <label>Status</label>
          <select class="input" id="pr-status">
            ${["DRAFT","PUBLISHED","PAUSED","CLOSED"].map(s => `<option value="${s}" ${t && t.status===s ? "selected":""}>${s}</option>`).join("")}
          </select>
        </div>
        <div class="field error" id="pr-err" style="display:none;"></div>
        <button class="btn btn-primary btn-block" type="submit"><span class="btn-label">${t ? "Save changes" : "Create task"}</span></button>
      </form>`);

    document.getElementById("product-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("pr-err"); errEl.style.display="none";
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true; btn.querySelector(".btn-label").innerHTML = '<span class="spinner"></span>';
      try{
        const budgetVal = document.getElementById("pr-budget").value;
        const payload = {
          title: document.getElementById("pr-title").value.trim(),
          description: document.getElementById("pr-desc").value.trim(),
          instructions: document.getElementById("pr-instr").value.trim(),
          target_url: document.getElementById("pr-url").value.trim() || null,
          reward: parseFloat(document.getElementById("pr-reward").value),
          budget: budgetVal === "" ? null : parseFloat(budgetVal),
          status: document.getElementById("pr-status").value
        };
        const secEl = document.getElementById("pr-sector"); if(secEl && secEl.value) payload.sector_id = secEl.value;
        if(t){
          const { error } = await sb.from("survey_tasks").update(payload).eq("id", t.id);
          if(error) throw error;
        } else {
          const { error } = await sb.from("survey_tasks").insert({ ...payload, created_by: AppState.user.id });
          if(error) throw error;
        }
        closeModal(); toast("Saved.", "success"); loadProducts();
      }catch(err){
        errEl.textContent = err.message || "Couldn't save."; errEl.style.display = "block";
      }finally{
        btn.disabled = false; btn.querySelector(".btn-label").textContent = t ? "Save changes" : "Create task";
      }
    });
  }



  // ============ BULK ADD: many tasks at once, each saved as its own task ============
  function openBulkForm(){
    openModal("Add many tasks", `
      <form id="bulk-form" class="bk" novalidate>
        <div class="bk-sec">Same for every task</div>
        ${sectorSelect("bk-sector")}
        <div class="field"><label>Reward</label>
          <div class="bk-seg"><label><input type="radio" name="bk-rmode" value="random" checked> Random in a range</label><label><input type="radio" name="bk-rmode" value="fixed"> Same for all</label></div></div>
        <div class="grid grid-2" id="bk-rand">
          <div class="field"><label for="bk-min">Lowest (USD)</label><input class="input" id="bk-min" type="number" step="0.01" min="0.01" value="0.09"></div>
          <div class="field"><label for="bk-max">Highest (USD)</label><input class="input" id="bk-max" type="number" step="0.01" min="0.01" value="0.30"></div>
        </div>
        <p class="bk-hint" id="bk-rand-hint">Each task gets its own reward in this range. Small amounts come up more often than big ones.</p>
        <div class="grid grid-2">
          <div class="field" id="bk-fixed" hidden><label for="bk-reward">Reward per task (USD)</label><input class="input" id="bk-reward" type="number" step="0.01" min="0.01" placeholder="0.25"></div>
          <div class="field"><label for="bk-budget">Budget cap per task (USD, optional)</label><input class="input" id="bk-budget" type="number" step="0.01" min="0" placeholder="No cap"></div>
        </div>
        <div class="field"><label for="bk-instr">Instructions for the user (optional)</label><textarea class="input" id="bk-instr" rows="2" placeholder="What the member must do and send"></textarea></div>
        <div class="field"><label>When saved</label>
          <div class="bk-seg"><label><input type="radio" name="bk-status" value="PUBLISHED" checked> Publish now</label><label><input type="radio" name="bk-status" value="DRAFT"> Save as draft</label></div></div>

        <div class="bk-sec">Tasks <span id="bk-count" class="bk-count">0 ready</span></div>
        <details class="bk-paste">
          <summary>Paste a list (from Excel, Google Sheets or text)</summary>
          <p class="bk-hint">One task on each line: <b>Name</b>, <b>Link</b>, <b>Details</b>. Separate them with a Tab (copy from a sheet) or with <code>|</code>. Example:<br><code>Rate the Daraz app | https://example.com/a | Try the app for 5 minutes</code><br>Or a numbered list with the link on the next line:<br><code>249. Hostel Altair</code><br><code>https://www.google.com/maps/search/?api=1&amp;query=Hostel+Altair</code></p>
          <textarea class="input" id="bk-paste" rows="5" placeholder="Name | Link | Details"></textarea>
          <button class="btn btn-secondary btn-sm" type="button" id="bk-paste-go">Add these lines</button>
        </details>
        <div class="bk-tools" id="bk-tools"><button class="btn btn-secondary btn-sm" type="button" id="bk-shuffle">Shuffle rewards</button><span id="bk-total"></span></div>
        <label class="bk-keep"><input type="checkbox" id="bk-keepnum" checked> Keep the number in the name (249. Hostel Altair)</label>
        <div class="bk-head" aria-hidden="true"><span>#</span><span>Name</span><span>Link</span><span>Details</span><span class="bk-rh">Reward</span><span></span></div>
        <div id="bk-rows" class="bk-rows"></div>
        <button class="btn btn-secondary btn-sm" type="button" id="bk-add">+ Add a row</button>
        <div class="field error" id="bk-err" style="display:none;margin-top:14px;"></div>
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px;"><span class="btn-label">Add tasks</span></button>
      </form>`);
    modal.querySelector(".modal").classList.add("modal-wide");
    const rowsEl = document.getElementById("bk-rows");
    const isUrl = v => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(v);
    // reward: fixed, or random in a range where small amounts come up more often
    const mode = () => document.querySelector('input[name="bk-rmode"]:checked').value;
    function range(){
      let lo = parseFloat(document.getElementById("bk-min").value), hi = parseFloat(document.getElementById("bk-max").value);
      if(!(lo > 0)) lo = 0.09; if(!(hi > 0)) hi = 0.30; if(hi < lo) [lo, hi] = [hi, lo];
      return [lo, hi];
    }
    function pick(){
      const [lo, hi] = range();
      const u = Math.random();
      const v = lo + (hi - lo) * u * u;            // u² leans toward the low end
      return Math.min(hi, Math.max(lo, Math.round(v * 100) / 100));
    }
    function setReward(r, force){
      if(mode() === "fixed"){ const f = parseFloat(document.getElementById("bk-reward").value); r.dataset.reward = f > 0 ? f : ""; }
      else if(force || !r.dataset.rand){ r.dataset.rand = pick(); r.dataset.reward = r.dataset.rand; }
      else { const [lo, hi] = range(); const v = Number(r.dataset.rand); if(v < lo || v > hi) r.dataset.rand = pick(); r.dataset.reward = r.dataset.rand; }
      r.querySelector(".bk-rw").textContent = r.dataset.reward ? "$" + Number(r.dataset.reward).toFixed(2) : "—";
    }
    function refreshRewards(force){
      const rnd = mode() === "random";
      document.getElementById("bk-rand").hidden = !rnd; document.getElementById("bk-rand-hint").hidden = !rnd;
      document.getElementById("bk-fixed").hidden = rnd; document.getElementById("bk-shuffle").hidden = !rnd;
      [...rowsEl.children].forEach(r => setReward(r, force));
      count();
    }
    function renumber(){
      [...rowsEl.children].forEach((r, i) => r.querySelector(".bk-n").textContent = i + 1);
      count();
    }
    function addRow(name, link, details, focus){
      const r = document.createElement("div");
      r.className = "bk-row";
      r.innerHTML = `<span class="bk-n"></span>
        <input class="input" data-k="name" placeholder="Task name" maxlength="140" aria-label="Task name">
        <input class="input" data-k="link" placeholder="https://…" inputmode="url" aria-label="Link">
        <textarea class="input" data-k="details" rows="1" placeholder="Details (optional)" aria-label="Details"></textarea>
        <span class="bk-rw" title="Reward for this task"></span>
        <button type="button" class="bk-x" aria-label="Remove this row" title="Remove">×</button>`;
      r.querySelector('[data-k="name"]').value = name || "";
      r.querySelector('[data-k="link"]').value = link || "";
      r.querySelector('[data-k="details"]').value = details || "";
      rowsEl.appendChild(r);
      setReward(r);
      renumber();
      if(focus) r.querySelector('[data-k="name"]').focus();
    }
    function rows(){
      return [...rowsEl.children].map(r => ({
        el: r,
        name: r.querySelector('[data-k="name"]').value.trim(),
        link: r.querySelector('[data-k="link"]').value.trim(),
        details: r.querySelector('[data-k="details"]').value.trim()
      }));
    }
    function count(){
      const ready = rows().filter(x => x.name || x.link).length;
      document.getElementById("bk-count").textContent = ready + " ready";
      document.querySelector("#bulk-form .btn-label").textContent = ready > 1 ? `Add ${ready} tasks` : ready === 1 ? "Add 1 task" : "Add tasks";
      const used = rows().filter(x => x.name || x.link).map(x => Number(x.el.dataset.reward || 0));
      const sum = used.reduce((a, b) => a + b, 0);
      document.getElementById("bk-total").textContent = used.length ? `Total if each is done once: $${sum.toFixed(2)} · average $${(sum / used.length).toFixed(2)}` : "";
    }
    // a copied header row ("Name  Link  Details") is not a task
    const isHeader = l => !/https?:\/\//i.test(l) && /^\s*(name|title|task)\b/i.test(l) && /\b(link|url)\b/i.test(l);
    // split one pasted line into name, link, details (link can be in any column)
    function parseLine(line){
      let parts = line.includes("\t") ? line.split("\t") : line.includes("|") ? line.split("|") : [line];
      parts = parts.map(s => s.trim());
      const li = parts.findIndex(isUrl);
      let link = "";
      if(li >= 0){ link = parts[li]; parts.splice(li, 1); }
      else { const m = line.match(/https?:\/\/\S+/i); if(m){ link = m[0]; parts = parts.map(s => s.replace(m[0], "").trim()); } }
      parts = parts.filter(Boolean);
      let name = parts[0] || "";
      if(!document.getElementById("bk-keepnum").checked) name = name.replace(SERIAL, "");
      else name = name.replace(/^\s*(\d{1,6})\s*[.)\-:]\s+/, "$1. ");
      return [name, link, parts.slice(1).join(" — ")];
    }
    // Turn pasted text into tasks. Works with one task per line (Name | Link | Details, or Tab between)
    // and with blocks like:  249. Name  /  https://link  /  optional details  (blank line or a number starts the next one)
    const SERIAL = /^\s*\d{1,6}\s*[.)\-:]\s+/;
    const urlOnly = l => /^https?:\/\/\S+$/i.test(l.trim());
    function parseText(text){
      const lines = text.split(/\r?\n/).map(l => l.trim());
      if(lines.some(l => l && (l.includes("\t") || /\s\|\s|\|/.test(l)) && /https?:\/\//i.test(l))){
        return lines.filter(l => l && !isHeader(l)).map(parseLine).filter(t => t[0] || t[1]);
      }
      const out = []; let cur = null;
      const push = () => { if(cur && (cur.name || cur.link)) out.push([cur.name, cur.link, cur.det.join(" ")]); cur = null; };
      for(let i = 0; i < lines.length; i++){
        const l = lines[i];
        if(!l){ push(); continue; }
        if(isHeader(l)) continue;
        if(urlOnly(l)){
          if(!cur) cur = { name: "", link: "", det: [] };
          if(cur.link){ push(); cur = { name: "", link: "", det: [] }; }
          cur.link = l; continue;
        }
        // after a finished name + link, a plain line is a new task only if a link follows it; otherwise it is details
        const nextLink = (() => { for(let j = i + 1; j < lines.length; j++){ if(!lines[j]) return false; if(urlOnly(lines[j])) return true; if(SERIAL.test(lines[j])) return false; } return false; })();
        if(SERIAL.test(l) || !cur || (cur.link && cur.name && nextLink)){
          // a new task starts: a numbered line, or a plain line after a finished name + link
          push();
          const [nm, lk, dt] = parseLine(l);
          cur = { name: nm, link: lk, det: dt ? [dt] : [] };
          continue;
        }
        if(!cur.name) cur.name = parseLine(l)[0];
        else cur.det.push(l);
      }
      push();
      return out;
    }
    document.getElementById("bk-paste-go").addEventListener("click", () => {
      const box = document.getElementById("bk-paste");
      const tasks = parseText(box.value);
      if(!tasks.length) return;
      // drop the first empty row if nothing was typed in it
      const first = rows()[0];
      if(rows().length === 1 && first && !first.name && !first.link && !first.details) first.el.remove();
      let n = 0;
      tasks.forEach(([nm, lk, dt]) => { addRow(nm, lk, dt); n++; });
      box.value = "";
      box.closest("details").open = false;
      toast(n + (n === 1 ? " task added to the list." : " tasks added to the list."), "success");
    });
    document.getElementById("bk-add").addEventListener("click", () => addRow("", "", "", true));
    rowsEl.addEventListener("click", e => { const x = e.target.closest(".bk-x"); if(x){ x.closest(".bk-row").remove(); if(!rowsEl.children.length) addRow(); renumber(); } });
    rowsEl.addEventListener("input", e => { e.target.closest(".bk-row").classList.remove("bad"); count(); });
    // paste several lines straight into a row: spread them over new rows
    rowsEl.addEventListener("paste", e => {
      const t = (e.clipboardData || window.clipboardData).getData("text");
      if(!t || !/\n/.test(t.trim())) return;
      e.preventDefault();
      const row = e.target.closest(".bk-row");
      const tasks = parseText(t);
      if(!tasks.length) return;
      const cur = rows().find(x => x.el === row);
      if(cur && !cur.name && !cur.link && !cur.details) row.remove();
      tasks.forEach(([nm, lk, dt]) => addRow(nm, lk, dt));
      renumber();
    });
    document.querySelectorAll('input[name="bk-rmode"]').forEach(x => x.addEventListener("change", () => refreshRewards(false)));
    ["bk-min", "bk-max", "bk-reward"].forEach(id => document.getElementById(id).addEventListener("input", () => refreshRewards(false)));
    document.getElementById("bk-shuffle").addEventListener("click", () => refreshRewards(true));
    addRow();
    refreshRewards(false);

    document.getElementById("bulk-form").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("bk-err"); errEl.style.display = "none";
      const fail = msg => { errEl.textContent = msg; errEl.style.display = "block"; };
      const budgetVal = document.getElementById("bk-budget").value.trim();
      const budget = budgetVal === "" ? null : parseFloat(budgetVal);
      if(mode() === "fixed" && !(parseFloat(document.getElementById("bk-reward").value) > 0)) return fail("Enter the reward for each task.");
      if(mode() === "random"){ const lo = parseFloat(document.getElementById("bk-min").value), hi = parseFloat(document.getElementById("bk-max").value); if(!(lo > 0) || !(hi > 0)) return fail("Enter the lowest and highest reward."); }
      refreshRewards(false);
      const top = mode() === "fixed" ? parseFloat(document.getElementById("bk-reward").value) : range()[1];
      if(budget !== null && !(budget >= top)) return fail("The budget cap must be at least the highest reward, or leave it empty.");
      const list = rows().filter(x => x.name || x.link || x.details);
      list.forEach(x => x.el.classList.remove("bad"));
      if(!list.length) return fail("Add at least one task.");
      const bad = list.filter(x => !x.name || (x.link && !isUrl(x.link)));
      if(bad.length){
        bad.forEach(x => x.el.classList.add("bad"));
        const i = [...rowsEl.children].indexOf(bad[0].el) + 1;
        return fail(`Row ${i}: ${!bad[0].name ? "add a task name" : "the link must start with http:// or https://"}.` + (bad.length > 1 ? ` (${bad.length} rows need fixing, marked in red.)` : ""));
      }
      const seen = new Set(), dups = [];
      list.forEach(x => { if(x.link){ const k = x.link.toLowerCase(); if(seen.has(k)) dups.push(x); seen.add(k); } });
      if(dups.length && !confirm(dups.length + " link(s) appear more than once. Add them anyway?")) return;
      const status = document.querySelector('input[name="bk-status"]:checked').value;
      const instructions = document.getElementById("bk-instr").value.trim();
      // keep the order you pasted: the first row shows first in the lists (they show newest first)
      const base = Date.now();
      const payload = list.map((x, i) => ({
        created_at: new Date(base - i * 1000).toISOString(),
        title: x.name.slice(0, 140), description: x.details, instructions, target_url: x.link || null,
        reward: Number(x.el.dataset.reward), budget, status, created_by: AppState.user.id,
        ...(document.getElementById("bk-sector") && document.getElementById("bk-sector").value ? { sector_id: document.getElementById("bk-sector").value } : {})
      }));
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      let done = 0;
      try{
        for(let i = 0; i < payload.length; i += 100){
          btn.querySelector(".btn-label").innerHTML = `<span class="spinner"></span> Saving ${Math.min(i + 100, payload.length)} of ${payload.length}`;
          const { error } = await sb.from("survey_tasks").insert(payload.slice(i, i + 100));
          if(error) throw error;
          done += Math.min(100, payload.length - i);
        }
        closeModal();
        toast(`${done} task${done === 1 ? "" : "s"} added${status === "PUBLISHED" ? " and published" : " as drafts"}.`, "success");
        loadProducts();
      }catch(err){
        fail((done ? done + " task(s) were saved. The rest were not: " : "") + (err.message || "Couldn't save."));
        if(done){ list.slice(0, done).forEach(x => x.el.remove()); renumber(); loadProducts(); }
      }finally{
        btn.disabled = false; count();
      }
    });
  }

  // ============ REJECT SHEET (a reason the member will see) ============
  const RejectSheet = (function(){
    let root = null, resolver = null;
    function build(){
      root = document.createElement("div");
      root.className = "rjx"; root.hidden = true;
      root.innerHTML = `
        <div class="rjx-scrim" data-rjx-close></div>
        <div class="rjx-card" role="dialog" aria-modal="true" aria-labelledby="rjx-title">
          <div class="rjx-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg></div>
          <h3 id="rjx-title"></h3>
          <p class="rjx-lead" id="rjx-lead"></p>
          <div class="rjx-quick" id="rjx-quick"></div>
          <textarea class="input" id="rjx-text" maxlength="300" placeholder="Write the reason the member will see…"></textarea>
          <div class="rjx-hint"><span id="rjx-req"></span><span id="rjx-count">0/300</span></div>
          <div class="rjx-err" id="rjx-err" hidden></div>
          <div class="rjx-actions">
            <button type="button" class="btn btn-secondary" data-rjx-close>Cancel</button>
            <button type="button" class="btn btn-danger" id="rjx-ok">Reject</button>
          </div>
        </div>`;
      document.body.appendChild(root);
      root.querySelectorAll("[data-rjx-close]").forEach(el => el.addEventListener("click", () => close(null)));
      root.addEventListener("keydown", e => { if(e.key === "Escape") close(null); });
      const ta = root.querySelector("#rjx-text");
      ta.addEventListener("input", () => { root.querySelector("#rjx-count").textContent = ta.value.length + "/300"; root.querySelector("#rjx-err").hidden = true; });
      root.querySelector("#rjx-ok").addEventListener("click", () => {
        const v = ta.value.trim();
        if(root.dataset.required === "1" && v.length < 3){ const er = root.querySelector("#rjx-err"); er.textContent = "Please write a reason so the member knows what to fix."; er.hidden = false; ta.focus(); return; }
        close(v || "");
      });
    }
    function close(v){ if(!root) return; root.hidden = true; const r = resolver; resolver = null; if(r) r(v); }
    function open(o){
      if(!root) build();
      root.dataset.required = o.required ? "1" : "0";
      root.querySelector("#rjx-title").textContent = o.title || "Reject";
      root.querySelector("#rjx-lead").textContent = o.lead || "";
      root.querySelector("#rjx-req").textContent = o.required ? "Required — the member sees this reason." : "Optional — the member sees this reason.";
      root.querySelector("#rjx-ok").textContent = o.confirm || "Reject";
      const ta = root.querySelector("#rjx-text"); ta.value = ""; root.querySelector("#rjx-count").textContent = "0/300"; root.querySelector("#rjx-err").hidden = true;
      const q = root.querySelector("#rjx-quick");
      q.innerHTML = (o.quick || []).map(t => `<button type="button">${escapeHtml(t)}</button>`).join("");
      q.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
        q.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
        ta.value = b.textContent; ta.dispatchEvent(new Event("input")); ta.focus();
      }));
      root.hidden = false;
      setTimeout(() => ta.focus(), 80);
      return new Promise(res => { resolver = res; });
    }
    return { open };
  })();
  const ADX_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  function reviewChip(submittedAt){
    const due = new Date(submittedAt).getTime() + 4 * 3600 * 1000, left = due - Date.now();
    if(!isFinite(left)) return "";
    if(left <= 0) return `<span class="adx-chip is-late">${ADX_CLOCK}Over the 4-hour review time by ${Math.max(1, Math.round(-left / 60000))} min</span>`;
    const h = Math.floor(left / 3600000), m = Math.round((left % 3600000) / 60000);
    return `<span class="adx-chip ${left < 3600000 ? "is-soon" : ""}">${ADX_CLOCK}Review within ${h ? h + "h " : ""}${m}m (4-hour promise)</span>`;
  }
  function takaFmt(n){ return "৳" + Math.round(Number(n || 0)).toLocaleString("en-US"); }

  // ============ PAYMENT SETTINGS (bKash rate + email code) ============
  async function loadPaySettings(){
    const box = document.getElementById("pay-settings"); if(!box) return;
    const { data: r, error } = await sb.rpc("get_payout_rates");
    if(error || !r){ box.innerHTML = ""; return; }
    const upd = r.updated_at ? fmtDate(r.updated_at) : "—";
    box.innerHTML = `
      <div class="adx-card">
        <h4>bKash payout rate</h4>
        <div class="adx-rate"><b>৳${Number(r.bkash).toFixed(2)}</b><span>per $1</span></div>
        <p>Official rate now ৳${Number(r.official).toFixed(2)} (checked ${upd}). The bKash rate moves up and down with it automatically.</p>
        <form class="adx-form" id="adx-rate-form"><input class="input" id="adx-rate-input" type="number" step="0.01" min="50" max="300" placeholder="Set today's rate, e.g. 117"><button class="btn btn-primary" type="submit">Save</button></form>
      </div>
      <div class="adx-card">
        <h4>Email code for payments</h4>
        <div class="adx-toggle"><b>Withdrawals & transfers</b><span class="adx-state ${r.email_code ? "on" : "off"}">${r.email_code ? "On" : "Off"}</span></div>
        <p>${r.email_code ? "Members must enter a code sent to their email before a withdrawal or wallet transfer." : "Turn this on after the Magic Link email template shows the code ({{ .Token }})."}</p>
        <div class="adx-form"><button class="btn ${r.email_code ? "btn-secondary" : "btn-primary"}" type="button" id="adx-otp-btn" style="flex:1;">${r.email_code ? "Turn off" : "Turn on"}</button></div>
      </div>`;
    document.getElementById("adx-rate-form").addEventListener("submit", async e => {
      e.preventDefault();
      const v = parseFloat(document.getElementById("adx-rate-input").value);
      if(!(v >= 50 && v <= 300)){ toast("Enter a rate between 50 and 300 taka.", "error"); return; }
      const { error: er } = await sb.rpc("admin_set_bkash_rate", { p_rate: v });
      if(er){ toast(er.message || "Couldn't save the rate.", "error"); return; }
      toast("bKash rate saved: ৳" + v.toFixed(2) + " per dollar.", "success"); loadPaySettings();
    });
    document.getElementById("adx-otp-btn").addEventListener("click", async () => {
      const { error: er } = await sb.rpc("admin_set_payment_email_code", { p_on: !r.email_code });
      if(er){ toast(er.message || "Couldn't change it.", "error"); return; }
      toast(!r.email_code ? "Email code is on for payments." : "Email code is off.", "success"); loadPaySettings();
    });
  }

  // ============ SUBMISSIONS ============
  async function loadSubmissions(){
    const list = document.getElementById("submissions-list");
    const { data, error } = await sb.from("survey_submissions")
      .select("*, survey_tasks(title), profiles!survey_submissions_user_id_fkey(full_name)")
      .eq("status","PENDING").order("submitted_at",{ascending:true});
    if(error){ list.innerHTML = `<div class="empty-state"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-warning"/></svg> Couldn't load submissions.</div>`; return; }
    if(!data.length){ list.innerHTML = `<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-check-circle"/></svg></div>No pending submissions.</div>`; return; }

    const rows = await Promise.all(data.map(async s => {
      let shotUrl = "#";
      if(s.screenshot_path){
        try{
          const { data: signed } = await sb.storage.from("super-survey-submissions").createSignedUrl(s.screenshot_path, 3600);
          if(signed) shotUrl = signed.signedUrl;
        }catch(_e){}
      }
      return `
        <div class="list-item" style="align-items:flex-start;">
          <div class="grow">
            <div class="ttl">${escapeHtml(s.survey_tasks ? s.survey_tasks.title : "Survey")} — ${escapeHtml(s.profiles ? s.profiles.full_name : "Member")}</div>
            <div class="sub2">${money(s.reward)} · submitted ${fmtDate(s.submitted_at)}</div>
            <div class="adx">${reviewChip(s.submitted_at)}</div>
            <div class="review-block">${escapeHtml(s.review_text)}</div>
            ${s.screenshot_path ? `<a class="ss-link" href="${shotUrl}" target="_blank" rel="noopener">View screenshot <svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-arrow-up-right"/></svg></a>` : `<span class="adx adx-gone">${ADX_CLOCK}Screenshot deleted automatically (24-hour limit)</span>`}
          </div>
          <div class="list-actions">
            <button class="btn btn-primary btn-sm" data-approve="${s.id}">Approve</button>
            <button class="btn btn-danger btn-sm" data-reject="${s.id}">Reject</button>
          </div>
        </div>`;
    }));
    list.innerHTML = rows.join("");

    list.querySelectorAll("[data-approve]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true;
      const { error } = await sb.rpc("approve_super_survey_submission", { p_submission: b.dataset.approve });
      if(error){ toast(error.message || "Couldn't approve.", "error"); b.disabled = false; return; }
      toast("Approved and paid.", "success"); loadSubmissions();
    }));
    list.querySelectorAll("[data-reject]").forEach(b => b.addEventListener("click", async () => {
      const note = await RejectSheet.open({ title:"Reject this task?", lead:"Tell the member why. They see this reason on their Survey page.", required:true, confirm:"Reject task",
        quick:["Screenshot doesn't show the finished task","Review was not posted","Wrong app or link","Screenshot is not clear","Copied or fake review","Steps were not followed"] });
      if(note === null) return;
      b.disabled = true;
      const { error } = await sb.rpc("reject_super_survey_submission", { p_submission: b.dataset.reject, p_note: note });
      if(error){ toast(error.message || "Couldn't reject.", "error"); b.disabled = false; return; }
      toast("Submission rejected.", "success"); loadSubmissions();
    }));
  }

  // ============ VERIFICATIONS ============
  async function loadVerifications(){
    const list = document.getElementById("verif-list");
    const { data, error } = await sb.from("api_verification_requests")
      .select("*, profiles!api_verification_requests_user_id_fkey(full_name)")
      .eq("status","PENDING").order("submitted_at",{ascending:true});
    if(error){ list.innerHTML = `<div class="empty-state"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-warning"/></svg> Couldn't load requests.</div>`; return; }
    if(!data.length){ list.innerHTML = `<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-id-card"/></svg></div>No pending verification requests.</div>`; return; }

    list.innerHTML = data.map(v => `
      <div class="list-item" style="align-items:flex-start;">
        <div class="grow">
          <div class="ttl">${escapeHtml(v.profiles ? v.profiles.full_name : "Member")} <span class="badge ${v.tier===1?'badge-gold':'badge-green'}">Package ${v.tier||2}</span></div>
          <div class="sub2">Submitted ${fmtDate(v.submitted_at)}</div>
          <div class="review-block">API key: ${escapeHtml(v.api_key)}</div>
        </div>
        <div class="list-actions">
          <button class="btn btn-primary btn-sm" data-approve="${v.id}">Approve</button>
          <button class="btn btn-danger btn-sm" data-reject="${v.id}">Reject</button>
        </div>
      </div>`).join("");

    list.querySelectorAll("[data-approve]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true;
      const { error } = await sb.rpc("review_super_survey_api_request", { p_request: b.dataset.approve, p_approve: true, p_note: null });
      if(error){ toast(error.message || "Couldn't approve.", "error"); b.disabled = false; return; }
      toast("Member verified.", "success"); loadVerifications();
    }));
    list.querySelectorAll("[data-reject]").forEach(b => b.addEventListener("click", async () => {
      const note = prompt("Reason for rejecting (optional):") || null;
      b.disabled = true;
      const { error } = await sb.rpc("review_super_survey_api_request", { p_request: b.dataset.reject, p_approve: false, p_note: note });
      if(error){ toast(error.message || "Couldn't reject.", "error"); b.disabled = false; return; }
      toast("Request rejected.", "success"); loadVerifications();
    }));
  }

  // ============ WITHDRAWALS ============
  async function loadWithdrawals(){
    loadPaySettings();
    const list = document.getElementById("wd-list");
    const { data, error } = await sb.from("withdrawal_requests")
      .select("*, profiles!withdrawal_requests_user_id_fkey(full_name)")
      .eq("status","PENDING").order("requested_at",{ascending:true});
    if(error){ list.innerHTML = `<div class="empty-state"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-warning"/></svg> Couldn't load withdrawals.</div>`; return; }
    if(!data.length){ list.innerHTML = `<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-bank"/></svg></div>No pending withdrawals.</div>`; return; }

    list.innerHTML = data.map(w => `
      <div class="list-item" style="align-items:flex-start;">
        <div class="grow">
          <div class="ttl">${escapeHtml(w.profiles ? w.profiles.full_name : "Member")} — ${money(w.amount)} <span class="pay-cell"><span class="pay-logo ${w.payout_method === "BKASH" ? "pay-bkash-mark" : "pay-binance-mark"}" aria-hidden="true"></span>${w.payout_method === "BKASH" ? "bKash" : "Binance"}</span></div>
          <div class="sub2">Account: <b>${escapeHtml(w.binance_id)}</b> · requested ${fmtDate(w.requested_at)}</div>
          <div class="review-block">${Number(w.investor_fee) > 0 ? `Fee ${money(w.commission_amount)} (all to the Investors Bank)` : `Commission ${money(w.commission_amount)} (referral ${money(w.referral_commission)} + platform ${money(w.admin_commission)})`} — payout <b>${money(w.payout_amount)}</b></div>
          <div class="adx adx-pay">${w.payout_method === "BKASH" && w.payout_bdt != null
            ? `<div><small>Send on bKash</small><b>${takaFmt(w.payout_bdt)}</b></div><span>${money(w.payout_amount)} × ৳${Number(w.bdt_rate).toFixed(2)} · within 20 min – 2 h</span>`
            : `<div><small>Send on ${w.payout_method === "BKASH" ? "bKash" : "Binance"}</small><b>${money(w.payout_amount)}</b></div><span>${w.payout_method === "BKASH" ? "within 20 min – 2 h" : "within 4 – 48 hours"}</span>`}</div>
        </div>
        <div class="list-actions">
          <button class="btn btn-primary btn-sm" data-approve="${w.id}">Approve & sent</button>
          <button class="btn btn-danger btn-sm" data-reject="${w.id}">Reject</button>
        </div>
      </div>`).join("");

    list.querySelectorAll("[data-approve]").forEach(b => b.addEventListener("click", async () => {
      if(!confirm("Confirm you've sent the payout to this account?")) return;
      b.disabled = true;
      const { error } = await sb.rpc("approve_super_survey_withdrawal", { p_withdrawal: b.dataset.approve });
      if(error){ toast(error.message || "Couldn't approve.", "error"); b.disabled = false; return; }
      toast("Withdrawal approved.", "success"); loadWithdrawals();
    }));
    list.querySelectorAll("[data-reject]").forEach(b => b.addEventListener("click", async () => {
      const typed = await RejectSheet.open({ title:"Reject this withdrawal?", lead:"The money goes back to the member's balance. They see this reason.", required:false, confirm:"Reject withdrawal",
        quick:["Wrong account number","Account name doesn't match","Suspicious activity","Please contact Support"] });
      if(typed === null) return;
      const note = typed || null;
      b.disabled = true;
      const { error } = await sb.rpc("reject_super_survey_withdrawal", { p_withdrawal: b.dataset.reject, p_note: note });
      if(error){ toast(error.message || "Couldn't reject.", "error"); b.disabled = false; return; }
      toast("Withdrawal rejected, balance released.", "success"); loadWithdrawals();
    }));
  }

  // ============ USER TASKS (pending pricing) ============
  async function loadUserTasks(){
    const list = document.getElementById("usertasks-list");
    const { data, error } = await sb.from("survey_tasks")
      .select("*, profiles!survey_tasks_submitted_by_fkey(full_name)")
      .eq("status","PENDING_PRICING").order("created_at",{ascending:true});
    if(error){ list.innerHTML = `<div class="empty-state"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-warning"/></svg> Couldn't load user tasks.</div>`; return; }
    if(!data.length){ list.innerHTML = `<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-clipboard"/></svg></div>No pending user-submitted tasks.</div>`; return; }

    list.innerHTML = data.map(t => `
      <div class="list-item" style="align-items:flex-start;">
        <div class="grow">
          <div class="ttl">${escapeHtml(t.title)} <span class="sub2">by ${escapeHtml(t.profiles ? t.profiles.full_name : "Member")}</span></div>
          <div class="review-block">${escapeHtml(t.description)}${t.instructions ? "<br><br><b>Instructions:</b> "+escapeHtml(t.instructions) : ""}${t.target_url ? "<br><br>Link: "+escapeHtml(t.target_url) : ""}</div>
        </div>
        <div class="list-actions">
          <button class="btn btn-primary btn-sm" data-price="${t.id}">Set price & publish</button>
          <button class="btn btn-danger btn-sm" data-declinetask="${t.id}">Decline</button>
        </div>
      </div>`).join("");

    list.querySelectorAll("[data-price]").forEach(b => b.addEventListener("click", () => openPriceTaskModal(b.dataset.price)));
    list.querySelectorAll("[data-declinetask]").forEach(b => b.addEventListener("click", async () => {
      const note = prompt("Reason for declining (optional):") || null;
      b.disabled = true;
      const { error } = await sb.rpc("admin_reject_user_task", { p_task_id: b.dataset.declinetask, p_note: note });
      if(error){ toast(error.message || "Couldn't decline.", "error"); b.disabled = false; return; }
      toast("Task declined.", "success"); loadUserTasks();
    }));
  }

  function openPriceTaskModal(taskId){
    openModal("Set price & publish", `
      <form id="price-task-form">
        <div class="field"><label>Reward per completion (USD)</label><input class="input" id="pt-reward" type="number" step="0.01" min="0.01" required></div>
        <div class="field"><label>Total budget to charge the poster (USD)</label><input class="input" id="pt-budget" type="number" step="0.01" min="0.01" required>
          <div class="hint">Must be at least the reward. The poster's wallet needs this much available.</div>
        </div>
        <div class="field error" id="pt-err" style="display:none;"></div>
        <button class="btn btn-primary btn-block" type="submit"><span class="btn-label">Charge & publish</span></button>
      </form>`);
    document.getElementById("price-task-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("pt-err"); errEl.style.display = "none";
      const reward = parseFloat(document.getElementById("pt-reward").value);
      const budget = parseFloat(document.getElementById("pt-budget").value);
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true; btn.querySelector(".btn-label").innerHTML = '<span class="spinner"></span>';
      const { error } = await sb.rpc("admin_price_and_publish_task", { p_task_id: taskId, p_reward: reward, p_budget: budget });
      btn.disabled = false; btn.querySelector(".btn-label").textContent = "Charge & publish";
      if(error){ errEl.textContent = error.message || "Couldn't publish task."; errEl.style.display = "block"; return; }
      closeModal(); toast("Task priced and published.", "success"); loadUserTasks();
    });
  }

  // ============ DEPOSITS (bKash auto deposit + manual review) ============
  const BKA = { st: null, timer: null, rate: 126 };
  const BKA_ICO = {
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 19.5 6v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/></svg>',
    sms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>',
    anchor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.5"/><path d="M12 7.5V21"/><path d="M5 13a7 7 0 0 0 14 0"/><path d="M8.5 11h7"/></svg>'
  };
  const BKA_KIND = { RECEIVED: "Send Money received", RECEIVED_OTHER: "Received (other)", CASH_IN: "Cash in", SEND_MONEY: "Send Money sent", CASH_OUT: "Cash out", PAYMENT: "Payment", OUT_OTHER: "Paid out", OTHER: "Other", ANCHOR: "Balance set by admin" };
  function bkaAgo(t){
    if(!t) return "never";
    const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
    if(s < 45) return "just now";
    if(s < 3600) return Math.round(s / 60) + " min ago";
    if(s < 86400) return Math.round(s / 3600) + " h ago";
    return fmtDate(t);
  }
  function bkaTaka(n){ return "৳" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  async function bkaCopy(text, btn){
    try{ await navigator.clipboard.writeText(text); }
    catch(_e){ const t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); try{ document.execCommand("copy"); }catch(_e2){} t.remove(); }
    if(btn){ const o = btn.textContent; btn.textContent = "Copied"; btn.classList.add("is-done"); setTimeout(() => { btn.textContent = o; btn.classList.remove("is-done"); }, 1500); }
  }

  async function loadHelperRate(){   // the taka rate for the list, without the admin-only bKash settings
    try{ const { data } = await sb.rpc("get_bkash_deposit_config"); const c = Array.isArray(data) ? data[0] : data; if(c && Number(c.rate) > 0) BKA.rate = Number(c.rate); }catch(e){}
  }
  async function loadDeposits(){
    await Promise.all([AppState.isAdmin ? loadBkashAuto() : loadHelperRate(), loadDepositList()]);
    clearInterval(BKA.timer);
    BKA.timer = setInterval(() => {
      const pane = document.getElementById("pane-deposits");
      if(!pane || !pane.classList.contains("show")){ clearInterval(BKA.timer); return; }
      if(document.activeElement && document.activeElement.closest && document.activeElement.closest("#bka-form")) return;   // don't redraw while typing
      if(AppState.isAdmin) loadBkashAuto();
      loadDepositList();
    }, 30000);
  }

  async function loadBkashAuto(){
    const root = document.getElementById("bka-root"); if(!root) return;
    const [{ data: st, error }, { data: sms, error: e2 }] = await Promise.all([
      sb.rpc("admin_bkash_auto_status"),
      sb.from("bkash_sms").select("id,created_at,sms_from,kind,direction,amount,fee,balance,counterparty,trx_id,sms_time,trusted,trust_reason,match_state,deposit_id,deposit_requests(amount,status,profiles!deposit_requests_user_id_fkey(full_name))")
        .order("created_at", { ascending: false }).limit(40)
    ]);
    if(error || !st){ root.innerHTML = `<div class="bka-empty">Couldn't load bKash auto deposit. ${escapeHtml(error ? error.message : "")}</div>`; return; }
    BKA.st = st; BKA.rate = Number(st.rate) || 126;

    const lastSignal = [st.phone_seen, st.phone_beat, st.last_sms].filter(Boolean).map(t => new Date(t).getTime()).sort((a, b) => b - a)[0];
    const minsAgo = lastSignal ? (Date.now() - lastSignal) / 60000 : null;
    const phoneCls = minsAgo == null ? "bad" : minsAgo <= 20 ? "ok" : "warn";
    const meta = st.phone_meta || {};
    const extras = [meta.battery != null && meta.battery >= 0 ? "battery " + meta.battery + "%" : "", meta.power && meta.power !== "unknown" ? (meta.power === "unplugged" ? "not charging" : "charging") : "", meta.network && meta.network !== "none" ? meta.network : ""].filter(Boolean).join(" · ");
    const phoneText = minsAgo == null ? "Not connected yet. Follow the phone setup below."
      : (minsAgo <= 20 ? "Connected · last signal " : "No signal for ") + bkaAgo(lastSignal) + (extras ? " · " + extras : "");
    const chainOn = !!st.chain;
    const chainCls = !chainOn ? "warn" : st.anchor_balance != null ? (Number(st.unverified) > 0 ? "warn" : "ok") : "warn";
    const chainText = !chainOn ? "Off. Any SMS from bKash is trusted."
      : st.anchor_balance != null ? `Last trusted balance ${bkaTaka(st.anchor_balance)} · ${bkaAgo(st.anchor_at)}${Number(st.unverified) > 0 ? ` · ${st.unverified} message${st.unverified > 1 ? "s" : ""} not verified` : ""}`
      : "Starts with the first bKash SMS.";
    const test = st.last_test;
    const url = SUPABASE_URL + "/functions/v1/bkash-sms?k=" + (st.key || "");
    const hbUrl = url + "&hb=1";

    root.innerHTML = `
      <section class="bka-hero">
        <div class="bka-top">
          <div class="bka-title">
            <span class="bka-logo"><span class="pay-logo pay-bkash-mark" aria-hidden="true"></span></span>
            <div><h3>bKash auto deposit</h3><p>Send Money to <b>${escapeHtml(st.number || "—")}</b> is checked against the bKash SMS on your phone.</p></div>
          </div>
          <span class="bka-pill ${st.auto ? "on" : "off"}"><i></i>${st.auto ? "Auto confirm on" : "Auto confirm off"}</span>
        </div>
        <div class="bka-stats">
          <div class="is-ok"><small>Auto confirmed today</small><b>${Number(st.today_count || 0)}</b><span>${money(st.today_usd || 0)}</span></div>
          <div class="${Number(st.waiting) ? "is-warn" : ""}"><small>Waiting for SMS</small><b>${Number(st.waiting || 0)}</b><span>checked automatically</span></div>
          <div class="${Number(st.review) ? "is-bad" : ""}"><small>Needs your check</small><b>${Number(st.review || 0)}</b><span>see the list below</span></div>
        </div>
        <div class="bka-health">
          <div class="bka-h ${phoneCls}"><span class="bka-h-ico">${BKA_ICO.phone}</span><div class="bka-h-txt"><b>Phone</b><span>${escapeHtml(phoneText)}</span></div></div>
          <div class="bka-h ${chainCls}"><span class="bka-h-ico">${BKA_ICO.shield}</span><div class="bka-h-txt"><b>Balance check</b><span>${escapeHtml(chainText)}</span></div><button class="btn btn-secondary" type="button" id="bka-set-bal">Set balance</button></div>
          <div class="bka-h ${test ? "ok" : ""}"><span class="bka-h-ico">${BKA_ICO.sms}</span><div class="bka-h-txt"><b>Last test message</b><span>${test ? `“${escapeHtml(test.text || "")}” · ${bkaAgo(test.at)}` : "Press Test in the phone app to check the link."}</span></div></div>
        </div>
      </section>

      <div class="bka-grid">
        <form class="bka-card" id="bka-form" autocomplete="off">
          <h4>Settings</h4>
          <label class="bka-field"><span>Deposit rate (taka for $1)</span><input class="input" id="bka-rate" type="number" step="0.01" min="50" max="300" value="${Number(st.rate)}"></label>
          <label class="bka-field"><span>Auto limit ($)</span><input class="input" id="bka-cap" type="number" step="1" min="0" max="100000" value="${Number(st.cap)}"><small>Bigger deposits wait for you. 0 = no limit.</small></label>
          <label class="bka-sw"><input type="checkbox" id="bka-auto" ${st.auto ? "checked" : ""}><span class="bka-track" aria-hidden="true"></span><span><b>Auto confirm</b><small>Add the money to the wallet as soon as the SMS matches the TrxID, amount and number.</small></span></label>
          <label class="bka-sw"><input type="checkbox" id="bka-chain" ${st.chain ? "checked" : ""}><span class="bka-track" aria-hidden="true"></span><span><b>Balance check (blocks fake SMS)</b><small>Trust an SMS only when its balance follows the last real bKash balance.</small></span></label>
          <button class="btn btn-primary bka-save" type="submit">Save settings</button>
        </form>

        <div class="bka-card">
          <h4>Phone setup (one time)</h4>
          <ol class="bka-steps">
            <li>On the phone with the bKash SIM, install <b>SMS to URL Forwarder</b> (free, from F-Droid or GitHub). If the phone warns about it, choose <b>Install anyway</b>.</li>
            <li>Open it and tap <b>+</b>. Sender: <code>bKash</code> · Webhook URL: paste the link below · Text filter: <code>TrxID</code> · tick <b>Store failed messages for retry</b> · Save.</li>
            <li>Allow SMS permission. In phone settings, turn off battery saving for this app and keep internet on.</li>
            <li>In the app menu, open <b>Settings → Heartbeat</b>, paste the heartbeat link and set 15 minutes.</li>
            <li>Press <b>Test</b> in the app. “Last test message” above shows it in a few seconds.</li>
          </ol>
          ${st.key ? `
          <div class="bka-copy"><small>Webhook URL (keep it secret)</small><div class="bka-copy-row"><code>${escapeHtml(url)}</code><button class="btn btn-secondary" type="button" data-bka-copy="${escapeHtml(url)}">Copy</button></div></div>
          <div class="bka-copy"><small>Heartbeat URL</small><div class="bka-copy-row"><code>${escapeHtml(hbUrl)}</code><button class="btn btn-secondary" type="button" data-bka-copy="${escapeHtml(hbUrl)}">Copy</button></div></div>
          <div class="bka-keyrow"><span>Link leaked? Make a new one, then paste it in the phone app again.</span><button class="btn btn-secondary" type="button" id="bka-rotate">New link</button></div>`
          : `<div class="bka-empty">Only an Admin or Super Admin can see the secret link.</div>`}
        </div>
      </div>

      <section class="bka-inbox">
        <div class="bka-inbox-head"><h4>bKash messages from your phone</h4><button class="btn btn-secondary" type="button" id="bka-refresh">Refresh</button></div>
        <div class="bka-sms-list">${e2 ? `<div class="bka-empty">Couldn't load messages.</div>` : bkaSmsRows(sms || [])}</div>
      </section>
      <h3 class="bka-dep-title">Deposits to check</h3>`;

    root.querySelectorAll("[data-bka-copy]").forEach(b => b.addEventListener("click", () => bkaCopy(b.dataset.bkaCopy, b)));
    root.querySelector("#bka-refresh").addEventListener("click", () => { loadBkashAuto(); loadDepositList(); });
    root.querySelector("#bka-form").addEventListener("submit", async e => {
      e.preventDefault();
      const rate = parseFloat(root.querySelector("#bka-rate").value), cap = parseFloat(root.querySelector("#bka-cap").value);
      if(!(rate >= 50 && rate <= 300)){ toast("Enter a deposit rate between 50 and 300 taka.", "error"); return; }
      if(!(cap >= 0)){ toast("Enter an auto limit of 0 or more.", "error"); return; }
      const btn = e.submitter || root.querySelector(".bka-save"); btn.disabled = true;
      const { error: er } = await sb.rpc("admin_set_bkash_auto", { p_rate: rate, p_auto: root.querySelector("#bka-auto").checked, p_cap: cap, p_chain: root.querySelector("#bka-chain").checked });
      btn.disabled = false;
      if(er){ toast(er.message || "Couldn't save.", "error"); return; }
      toast("bKash auto deposit settings saved.", "success"); loadBkashAuto(); loadDepositList();
    });
    const rot = root.querySelector("#bka-rotate");
    if(rot) rot.addEventListener("click", async () => {
      if(!confirm("Make a new secret link? The old link stops working right away, so paste the new one in the phone app.")) return;
      const { error: er } = await sb.rpc("admin_rotate_bkash_key");
      if(er){ toast(er.message || "Couldn't make a new link.", "error"); return; }
      toast("New link made. Paste it in the phone app.", "success"); loadBkashAuto();
    });
    root.querySelector("#bka-set-bal").addEventListener("click", async () => {
      const v = prompt("Your bKash balance right now (open the bKash app and check). Example: 12520.50");
      if(v === null) return;
      const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
      if(!(n >= 0)){ toast("Enter the balance as a number.", "error"); return; }
      const { data: r, error: er } = await sb.rpc("admin_bkash_set_balance", { p_balance: n });
      if(er){ toast(er.message || "Couldn't save the balance.", "error"); return; }
      toast("Balance saved." + (r && r.confirmed ? ` ${r.confirmed} deposit(s) confirmed.` : ""), "success"); loadBkashAuto(); loadDepositList();
    });
    root.querySelectorAll("[data-sms-act]").forEach(b => b.addEventListener("click", async () => {
      const act = b.dataset.smsAct;
      if(act === "block" && !confirm("Block this message? It will never confirm a deposit. Use this for fake or wrong SMS.")) return;
      if(act === "trust" && !confirm("Trust this message? Only do this if you can see this payment in your bKash app.")) return;
      b.disabled = true;
      const { data: r, error: er } = await sb.rpc("admin_bkash_sms_action", { p_sms_id: b.dataset.id, p_action: act });
      if(er){ toast(er.message || "Couldn't change it.", "error"); b.disabled = false; return; }
      toast((act === "trust" ? "Message trusted." : "Message blocked.") + (r && r.confirmed ? ` ${r.confirmed} deposit(s) confirmed.` : ""), "success");
      loadBkashAuto(); loadDepositList();
    }));
  }

  function bkaSmsRows(list){
    if(!list.length) return `<div class="bka-empty">No bKash messages yet. When someone sends money to your bKash, the SMS shows up here and is matched automatically.</div>`;
    return list.map(s => {
      const dir = s.kind === "ANCHOR" ? "anchor" : s.direction === "IN" ? "in" : s.direction === "OUT" ? "out" : "";
      const amt = s.amount != null ? (s.direction === "OUT" ? "−" : s.direction === "IN" ? "+" : "") + bkaTaka(s.amount) : (s.kind === "ANCHOR" ? bkaTaka(s.balance) : "—");
      const when = s.sms_time || s.created_at;
      const parts = [];
      if(s.counterparty) parts.push((s.direction === "OUT" ? "to " : "from ") + s.counterparty);
      if(s.trx_id) parts.push("TrxID " + s.trx_id);
      parts.push(fmtDate(when));
      if(s.balance != null && s.kind !== "ANCHOR") parts.push("balance " + bkaTaka(s.balance));
      const dep = s.deposit_requests;
      const who = dep ? `${escapeHtml(dep.profiles ? dep.profiles.full_name : "Member")} · ${money(dep.amount)} · ${dep.status === "APPROVED" ? "credited" : dep.status === "REJECTED" ? "rejected" : "waiting"}` : "";
      const chip = s.match_state === "BLOCKED" ? '<span class="bka-chip bad">Blocked</span>'
        : s.kind === "ANCHOR" ? '<span class="bka-chip muted">Anchor</span>'
        : s.trusted ? '<span class="bka-chip ok">Verified</span>'
        : s.balance != null ? '<span class="bka-chip warn">Not verified</span>' : '<span class="bka-chip muted">No balance</span>';
      const match = s.kind === "ANCHOR" ? "" : dep ? `<span class="bka-match">→ <b>${who}</b></span>` : (s.direction === "IN" ? '<span class="bka-match">No deposit uses this TrxID yet</span>' : "");
      const acts = s.kind === "ANCHOR" ? "" : `<div class="bka-sms-act">${!s.trusted && s.match_state !== "BLOCKED" && s.balance != null ? `<button type="button" data-sms-act="trust" data-id="${s.id}">Trust</button>` : ""}${s.match_state !== "BLOCKED" ? `<button type="button" class="danger" data-sms-act="block" data-id="${s.id}">Block</button>` : `<button type="button" data-sms-act="trust" data-id="${s.id}">Unblock</button>`}</div>`;
      return `<div class="bka-sms ${dir}">
        <span class="bka-sms-ico">${dir === "in" ? BKA_ICO.down : dir === "out" ? BKA_ICO.up : dir === "anchor" ? BKA_ICO.anchor : BKA_ICO.sms}</span>
        <div class="bka-sms-main"><b>${amt}<em>${escapeHtml(BKA_KIND[s.kind] || s.kind)}</em></b><span>${escapeHtml(parts.join(" · "))}</span>${match}</div>
        <div class="bka-sms-side">${chip}${acts}</div>
      </div>`;
    }).join("");
  }

  async function loadDepositList(){
    const list = document.getElementById("deposits-list");
    const { data, error } = await sb.from("deposit_requests")
      .select("*, profiles!deposit_requests_user_id_fkey(full_name)")
      .eq("status", "PENDING").order("requested_at", { ascending: true });
    if(error){ list.innerHTML = `<div class="empty-state"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-warning"/></svg> Couldn't load deposits.</div>`; return; }
    if(!data.length){ list.innerHTML = `<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-banknote"/></svg></div>No deposits waiting. bKash payments that match are added automatically.</div>`; return; }

    const smsIds = data.map(d => d.sms_id).filter(Boolean);
    let smsById = {};
    if(smsIds.length){
      const { data: sms } = await sb.from("bkash_sms").select("id,kind,amount,counterparty,balance,trusted,match_state").in("id", smsIds);
      (sms || []).forEach(s => { smsById[s.id] = s; });
    }
    const rate = BKA.rate || 126;

    list.innerHTML = data.map(d => {
      const isBk = d.method === "BKASH", s = d.sms_id ? smsById[d.sms_id] : null;
      const name = escapeHtml(d.profiles ? d.profiles.full_name : "Member");
      let state = "";
      if(isBk && d.auto_state === "WAITING_SMS") state = `<span class="bka-state wait"><i></i>Waiting for the bKash SMS · ${bkaAgo(d.requested_at).replace(" ago", "")}</span>`;
      else if(isBk && d.auto_state === "WAIT_BALANCE") state = `<span class="bka-state wait"><i></i>SMS found, waiting for the balance check. Check your bKash app, then confirm or press Trust on the message.</span>`;
      else if(isBk && d.auto_state === "REVIEW") state = `<span class="bka-state review"><i></i>${escapeHtml(d.auto_note || "Needs your check.")}</span>`;
      else state = `<span class="bka-state manual"><i></i>Check this payment yourself</span>`;
      const meta = isBk && d.payer_number
        ? `<div class="bka-dep-meta"><span>${bkaTaka(d.taka_amount)}</span><span>from ${escapeHtml(d.payer_number)}</span><span>TrxID <b>${escapeHtml(d.reference)}</b></span><span>${fmtDate(d.requested_at)}</span></div>`
        : `<div class="sub2">Reference: <b>${escapeHtml(d.reference)}</b> · requested ${fmtDate(d.requested_at)}</div>`;
      const smsLine = s ? `<div class="bka-dep-sms">bKash SMS: <b>${escapeHtml(BKA_KIND[s.kind] || s.kind)}</b> ${s.amount != null ? bkaTaka(s.amount) : ""}${s.counterparty ? " from " + escapeHtml(s.counterparty) : ""}${s.balance != null ? " · balance " + bkaTaka(s.balance) : ""} · ${s.match_state === "BLOCKED" ? "blocked" : s.trusted ? "verified" : "not verified"}</div>` : "";
      let creditBtn = "";
      if(s && s.amount != null && d.taka_amount != null && Math.abs(Number(s.amount) - Number(d.taka_amount)) >= 0.01 && s.match_state !== "BLOCKED"){
        const usd = Math.round(Number(s.amount) / Number(d.bdt_rate || rate) * 100) / 100;
        if(usd > 0) creditBtn = `<button class="btn btn-sm bka-credit" data-credit="${d.id}" data-usd="${usd}" data-name="${name}">Credit ${money(usd)}</button>`;
      }
      return `
      <div class="list-item" style="align-items:flex-start;">
        <div class="grow">
          <div class="ttl">${name} — ${money(d.amount)} <span class="pay-cell"><span class="pay-logo ${isBk ? "pay-bkash-mark" : "pay-binance-mark"}" aria-hidden="true"></span>${isBk ? "bKash" : "Binance"}</span></div>
          ${meta}
          ${state}
          ${smsLine}
        </div>
        <div class="list-actions">
          <button class="btn btn-primary btn-sm" data-approve="${d.id}" data-name="${name}" data-amt="${money(d.amount)}" data-hint="${isBk && d.taka_amount ? escapeHtml(bkaTaka(d.taka_amount) + " from " + (d.payer_number || "") + ", TrxID " + d.reference) : escapeHtml(d.reference)}">Confirm & credit</button>
          ${creditBtn}
          <button class="btn btn-danger btn-sm" data-reject="${d.id}">Reject</button>
        </div>
      </div>`;
    }).join("");

    list.querySelectorAll("[data-approve]").forEach(b => b.addEventListener("click", async () => {
      if(!confirm(`Credit ${b.dataset.amt} to ${b.dataset.name}?\n\nFirst check in your bKash or Binance app that this payment arrived: ${b.dataset.hint}`)) return;
      b.disabled = true;
      const { error } = await sb.rpc("approve_deposit_request", { p_deposit_id: b.dataset.approve });
      if(error){ toast(error.message || "Couldn't approve.", "error"); b.disabled = false; return; }
      toast("Deposit confirmed and credited.", "success"); loadDeposits();
    }));
    list.querySelectorAll("[data-credit]").forEach(b => b.addEventListener("click", async () => {
      if(!confirm(`Credit ${money(b.dataset.usd)} to ${b.dataset.name} (the taka that actually arrived ÷ the rate)?`)) return;
      b.disabled = true;
      const { error } = await sb.rpc("admin_bkash_credit", { p_deposit_id: b.dataset.credit, p_amount: Number(b.dataset.usd) });
      if(error){ toast(error.message || "Couldn't credit.", "error"); b.disabled = false; return; }
      toast("Deposit credited.", "success"); loadDeposits();
    }));
    list.querySelectorAll("[data-reject]").forEach(b => b.addEventListener("click", async () => {
      const note = await RejectSheet.open({ title: "Reject this deposit?", lead: "The member sees this reason on their Deposit page.", required: false, confirm: "Reject deposit",
        quick: ["The TrxID was not found in bKash", "The amount does not match", "Sent from a different number", "Not Send Money (Cash Out or Payment)", "This TrxID was already used", "Please send again with the right details"] });
      if(note === null) return;
      b.disabled = true;
      const { error } = await sb.rpc("reject_deposit_request", { p_deposit_id: b.dataset.reject, p_note: note || null });
      if(error){ toast(error.message || "Couldn't reject.", "error"); b.disabled = false; return; }
      toast("Deposit rejected.", "success"); loadDeposits();
    }));
  }


  // ============ MAILBOX ============
  async function loadMailbox(){
    const list=document.getElementById("admin-mailbox-list");
    if(!list) return;
    const [{data:messages,error}, {data:users}] = await Promise.all([
      sb.from("mailbox_messages").select("*").order("created_at",{ascending:false}).limit(100),
      sb.from("profiles").select("id,full_name,user_code").order("full_name",{ascending:true})
    ]);
    if(error){list.innerHTML='<div class="empty-state"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-warning"/></svg> Could not load mailbox notices.</div>';return;}
    const select=document.getElementById("admin-mail-recipient");
    if(select && users){
      const current=select.value;
      select.innerHTML='<option value="">All users</option>'+users.map(u=>`<option value="${u.id}">${escapeHtml(u.full_name||"Member")} · ${escapeHtml(u.user_code||u.id)}</option>`).join("");
      select.value=current;
    }
    if(!messages||!messages.length){list.innerHTML='<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-mail-open"/></svg></div>No mailbox notices yet.</div>';return;}
    list.innerHTML=messages.map(m=>`<div class="list-item" style="align-items:flex-start;">
      <div class="grow"><div class="ttl">${escapeHtml(m.title)} <span class="badge badge-muted">${/^LEADER_/.test(m.kind||"")?'Auto · Leadership':(m.kind==="BKASH_DEPOSIT"?'Auto · Deposit':(m.recipient_user_id?'Direct':'All users'))}</span></div>
      <div class="sub2">${fmtDate(m.created_at)}</div><div class="review-block">${escapeHtml(m.body)}</div></div>
      <div class="list-actions"><button class="btn btn-danger btn-sm" data-mail-del="${m.id}">Delete</button></div>
    </div>`).join("");
    list.querySelectorAll("[data-mail-del]").forEach(b=>b.addEventListener("click",async()=>{
      if(!confirm("Delete this mailbox notice?"))return;
      const {error}=await sb.from("mailbox_messages").delete().eq("id",b.dataset.mailDel);
      if(error){toast(error.message||"Couldn't delete.","error");return;} loadMailbox();
    }));
  }

  function wireMailbox(){
    const form=document.getElementById("admin-mailbox-form"); if(!form||form.dataset.wired)return; form.dataset.wired="1";
    form.addEventListener("submit",async e=>{
      e.preventDefault();
      const err=document.getElementById("admin-mail-err");err.style.display="none";
      const payload={recipient_user_id:document.getElementById("admin-mail-recipient").value||null,title:document.getElementById("admin-mail-title").value.trim(),body:document.getElementById("admin-mail-body").value.trim(),created_by:AppState.user.id};
      if(!payload.title||!payload.body){err.textContent="Title and message are required.";err.style.display="block";return;}
      const btn=form.querySelector("button[type=submit]");btn.disabled=true;btn.querySelector(".btn-label").innerHTML='<span class="spinner"></span>';
      const {error}=await sb.from("mailbox_messages").insert(payload);
      btn.disabled=false;btn.querySelector(".btn-label").textContent="Send notice";
      if(error){err.textContent=error.message||"Couldn't send notice.";err.style.display="block";return;}
      form.reset();toast(payload.recipient_user_id?"Notice sent to the user.":"Notice sent to all users.","success");loadMailbox();
    });
  }

  // ============ LIVE CHAT: opening hours, the community room, members and private chats ============
  const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const LIVE = { schedule: [], msgs: [], members: [], invites: [], q: "", privateId: null, privateMsgs: [], timer: null };
  let adminPrivateInviteId = null;
  const lv$ = id => document.getElementById(id);
  const lvVisible = () => { const p = lv$("pane-livechat"); return !!p && p.classList.contains("show") && !document.hidden; };
  const lvErr = e => String((e && e.message) || "Something went wrong. Please try again.").replace(/^Postgres error:\s*/i, "");
  const PIN = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3.5h6l-1 4.5 3 3H5l3-3-1-4.5Z"/><path d="M10 11v5.5"/></svg>';
  const TRASH2 = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6"/></svg>';
  const INVITE = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg>';
  const t12 = hhmm => { const p = String(hhmm || "00:00").split(":").map(Number); if(!p[0] && !p[1]) return "midnight"; return ((p[0] % 12) || 12) + ":" + String(p[1] || 0).padStart(2, "0") + " " + (p[0] >= 12 ? "PM" : "AM"); };
  const toMin = hhmm => { const p = String(hhmm || "0:0").split(":").map(Number); return p[0] * 60 + (p[1] || 0); };
  function dhakaNow(){ const d = new Date(Date.now() + 6 * 3600e3); return { dow: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }

  // ---------- opening hours ----------
  function liveStatus(){
    const rows = LIVE.schedule, c = dhakaNow(), row = d => rows.find(x => Number(x.day_of_week) === d);
    const today = row(c.dow), y = row((c.dow + 6) % 7);
    let openUntil = null;
    if(y && y.enabled && toMin(y.open_time) > toMin(y.close_time) && c.min < toMin(y.close_time)) openUntil = y.close_time;
    if(!openUntil && today && today.enabled){
      const o = toMin(today.open_time), cl = toMin(today.close_time);
      if(o <= cl ? (c.min >= o && c.min < cl) : (c.min >= o)) openUntil = today.close_time;
    }
    if(openUntil) return { open: true, text: "Open until " + t12(String(openUntil).slice(0, 5)) };
    for(let k = 0; k < 8; k++){
      const d = (c.dow + k) % 7, r = row(d);
      if(!r || !r.enabled || (k === 0 && toMin(r.open_time) <= c.min)) continue;
      return { open: false, text: "Opens " + (k === 0 ? "today" : k === 1 ? "tomorrow" : DAYS[d]) + " at " + t12(String(r.open_time).slice(0, 5)) };
    }
    return { open: false, text: "No opening hours are set" };
  }
  function paintLiveState(){
    const s = liveStatus(), pill = lv$("al-state");
    if(pill){ pill.className = "ck-pill" + (s.open ? " is-live" : ""); pill.innerHTML = `<i></i><span>${s.open ? "Live now" : "Closed"}</span>`; }
    const t = lv$("al-state-title"); if(t) t.textContent = s.open ? "Live Chat is open" : "Live Chat is closed";
    const sub = lv$("al-state-sub"); if(sub) sub.textContent = s.text + " · Bangladesh time";
  }
  async function loadLivechatSchedule(){
    const grid = lv$("livechat-schedule-grid");
    const { data, error } = await sb.rpc("admin_get_live_chat_schedule");
    if(error){ if(grid) grid.innerHTML = `<div class="as-none"><b>Couldn't load the hours</b><span>${escapeHtml(lvErr(error))}</span></div>`; return; }
    LIVE.schedule = Array.isArray(data) ? data : [];
    paintLiveState();
    if(grid && !grid.contains(document.activeElement)){
      grid.innerHTML = [0,1,2,3,4,5,6].map(i => {
        const x = LIVE.schedule.find(r => Number(r.day_of_week) === i) || { enabled: false, open_time: "09:00", close_time: "18:00" };
        return `<div class="al-day${x.enabled ? "" : " is-off"}">
          <label class="al-switch"><input type="checkbox" data-live-day="${i}" data-live-enabled ${x.enabled ? "checked" : ""}><i aria-hidden="true"></i><b>${DAYS[i]}</b></label>
          <input class="al-time" type="time" data-live-day="${i}" data-live-start value="${escapeHtml(String(x.open_time || "09:00").slice(0, 5))}" aria-label="${DAYS[i]} opens">
          <span class="al-dash">to</span>
          <input class="al-time" type="time" data-live-day="${i}" data-live-end value="${escapeHtml(String(x.close_time || "18:00").slice(0, 5))}" aria-label="${DAYS[i]} closes">
        </div>`;
      }).join("");
    }
  }
  async function saveLivechatSchedule(){
    const rows = DAYS.map((_, i) => ({
      day_of_week: i,
      open_time: document.querySelector(`[data-live-day="${i}"][data-live-start]`)?.value || "09:00",
      close_time: document.querySelector(`[data-live-day="${i}"][data-live-end]`)?.value || "18:00",
      enabled: !!document.querySelector(`[data-live-day="${i}"][data-live-enabled]`)?.checked
    }));
    const btn = lv$("livechat-schedule-save"); if(btn){ btn.disabled = true; btn.textContent = "Saving…"; }
    const { data, error } = await sb.rpc("admin_save_live_chat_schedule", { p_rows: rows });
    if(btn){ btn.disabled = false; btn.textContent = "Save hours"; }
    if(error || !(data && data.ok)){ toast(error ? lvErr(error) : "Couldn't save the hours.", "error"); return; }
    toast("Opening hours saved.", "success");
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    await loadLivechatSchedule();
  }

  // ---------- the room ----------
  function roomItems(){
    return LIVE.msgs.filter(m => !m.is_deleted).map(m => {
      const team = m.sender_role === "ADMIN";
      const tools = `<div class="ck-tools">`
        + (team ? `<button type="button" class="ck-tool" data-al-pin="${escapeHtml(m.id)}" data-pinned="${m.is_pinned ? "1" : ""}" title="${m.is_pinned ? "Unpin" : "Pin to the top"}" aria-label="${m.is_pinned ? "Unpin" : "Pin"}">${PIN}</button>` : "")
        + (!team && m.user_id ? `<button type="button" class="ck-tool" data-al-invite="${escapeHtml(m.user_id)}" data-name="${escapeHtml(m.full_name || "Member")}" title="Invite to a private chat" aria-label="Invite to a private chat">${INVITE}</button>` : "")
        + `<button type="button" class="ck-tool is-danger" data-al-del="${escapeHtml(m.id)}" title="Remove for everyone" aria-label="Remove message">${TRASH2}</button></div>`;
      return {
        id: m.id, who: team ? "team" : (m.user_id || m.id), mine: team,
        name: team ? "Repuven" : (m.full_name || "Member"),
        avatar: { name: m.full_name || "Member", url: m.avatar_url },
        text: m.body, at: m.created_at, edited: !!m.edited_at, tools
      };
    });
  }
  function paintRoom(bottom){
    const box = lv$("al-scroll"); if(!box) return;
    const list = roomItems();
    const pinned = LIVE.msgs.filter(m => m.is_pinned && !m.is_deleted).pop();
    lv$("al-pin").hidden = !pinned;
    if(pinned){ lv$("al-pin-text").textContent = pinned.body; lv$("al-unpin").dataset.id = pinned.id; }
    const key = list.map(m => m.id + (m.edited ? "e" : "") + (LIVE.msgs.find(x => x.id === m.id).is_pinned ? "p" : "")).join("|");
    ChatKit.paint(box, list.length ? ChatKit.render(list, { names: true }) : ChatKit.empty("i-message", "The room is quiet", "Messages members write in Live Chat show up here."), { key, bottom });
  }
  async function loadPublicLivechatMessages(bottom){
    const { data, error } = await sb.rpc("get_live_chat_messages_v2", { p_limit: 500 });
    if(error){ if(!LIVE.msgs.length) ChatKit.paint(lv$("al-scroll"), ChatKit.empty("i-warning", "Couldn't load the room", lvErr(error)), { key: "err" }); return; }
    LIVE.msgs = Array.isArray(data) ? data : [];
    paintRoom(bottom);
  }
  async function setPin(id, on){
    if(on){
      for(const m of LIVE.msgs.filter(x => x.is_pinned && x.id !== id && !x.is_deleted)) await sb.rpc("admin_pin_live_chat_group_message", { p_message_id: m.id, p_pinned: false });
    }
    const { error } = await sb.rpc("admin_pin_live_chat_group_message", { p_message_id: id, p_pinned: on });
    if(error){ toast(lvErr(error), "error"); return; }
    toast(on ? "Pinned to the top of the room." : "Unpinned.", "success");
    await loadPublicLivechatMessages();
  }

  // ---------- members ----------
  function paintPeople(){
    const list = lv$("livechat-admin-members"); if(!list) return;
    const q = LIVE.q.trim().toLowerCase();
    const latest = new Map(); LIVE.invites.forEach(x => { if(!latest.has(x.user_id)) latest.set(x.user_id, x); });
    const rows = LIVE.members.filter(u => !q || String(u.full_name || "").toLowerCase().includes(q) || String(u.user_code || "").toLowerCase().includes(q));
    const cnt = lv$("al-people-count"); if(cnt) cnt.textContent = LIVE.members.length ? String(LIVE.members.length) : "";
    if(!rows.length){ list.innerHTML = `<div class="as-none"><b>${q ? "Nothing matches" : "No members yet"}</b><span>${q ? "Try another name or ID." : ""}</span></div>`; return; }
    list.innerHTML = rows.map(u => {
      const inv = latest.get(u.id), blocked = !!u.live_chat_blocked;
      const tags = (blocked ? `<span class="al-tag is-warn">Can't post</span>` : "")
        + (inv && inv.status === "ACCEPTED" ? `<span class="al-tag is-ok">Private chat</span>` : inv ? `<span class="al-tag">Invited</span>` : "");
      const talk = inv ? `<button type="button" class="al-mini" data-al-open="${escapeHtml(inv.id)}">${inv.status === "ACCEPTED" ? "Open chat" : "View invite"}</button>`
        : `<button type="button" class="al-mini" data-al-invite="${escapeHtml(u.id)}" data-name="${escapeHtml(u.full_name || "Member")}">Talk privately</button>`;
      return `<div class="al-person${LIVE.privateId && inv && inv.id === LIVE.privateId ? " is-on" : ""}">
        ${ChatKit.avatar({ name: u.full_name || "Member", url: u.avatar_url, size: "sm" })}
        <div class="al-person-copy"><b>${escapeHtml(u.full_name || "Member")}</b><small>${escapeHtml(u.user_code || "")}</small><span class="al-tags">${tags}</span></div>
        <div class="al-person-actions">${talk}<button type="button" class="al-mini${blocked ? "" : " is-danger"}" data-al-block="${escapeHtml(u.id)}" data-blocked="${blocked ? "1" : ""}">${blocked ? "Let post" : "Block"}</button></div>
      </div>`;
    }).join("");
  }
  async function loadLivechatUsers(){
    const [m, i] = await Promise.all([sb.rpc("admin_get_live_chat_members", { p_limit: 200 }), sb.rpc("admin_get_private_chat_invites", { p_limit: 200 })]);
    if(m.error){ const list = lv$("livechat-admin-members"); if(list && !LIVE.members.length) list.innerHTML = `<div class="as-none"><b>Couldn't load members</b><span>${escapeHtml(lvErr(m.error))}</span></div>`; return; }
    LIVE.members = Array.isArray(m.data) ? m.data : [];
    LIVE.invites = (Array.isArray(i.data) ? i.data : []).filter(x => x.status === "PENDING" || x.status === "ACCEPTED");
    paintPeople();
  }
  function inviteDialog(userId, name){
    const first = String(name || "there").trim().split(/\s+/)[0];
    openModal("Talk to " + (name || "this member") + " privately", `
      <p style="margin:0 0 12px;font-size:13.5px;line-height:1.55;color:var(--muted);">They'll see this note in Live Chat with a button to open the private chat. Only you and they can read it.</p>
      <textarea class="input" id="al-invite-note" rows="3" maxlength="300" style="width:100%;resize:vertical;">Hi ${escapeHtml(first)}, can we talk here for a minute?</textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;"><button type="button" class="btn btn-secondary" id="al-invite-cancel">Cancel</button><button type="button" class="btn btn-primary" id="al-invite-send">Send invite</button></div>`);
    const note = lv$("al-invite-note"); note.focus(); note.setSelectionRange(note.value.length, note.value.length);
    lv$("al-invite-cancel").onclick = closeModal;
    lv$("al-invite-send").onclick = async () => {
      const btn = lv$("al-invite-send"); btn.disabled = true; btn.textContent = "Sending…";
      const { data, error } = await sb.rpc("admin_invite_private_chat", { p_user_id: userId, p_message: note.value.trim() || "Can we talk here for a minute?" });
      if(error){ btn.disabled = false; btn.textContent = "Send invite"; toast(lvErr(error), "error"); return; }
      closeModal(); toast("Invite sent. The chat opens when they accept.", "success");
      await loadLivechatUsers();
      if(data) openPrivate(typeof data === "string" ? data : (data.id || data));
    };
  }
  function armed(btn, label, fn){
    if(!btn.classList.contains("is-armed")){
      const old = btn.innerHTML;
      btn.classList.add("is-armed"); btn.textContent = label;
      setTimeout(() => { if(btn.isConnected && btn.classList.contains("is-armed")){ btn.classList.remove("is-armed"); btn.innerHTML = old; } }, 3000);
      return;
    }
    btn.disabled = true; fn();
  }

  // ---------- private chat ----------
  async function openPrivate(inviteId){
    LIVE.privateId = inviteId; adminPrivateInviteId = inviteId;
    if(!LIVE.invites.find(x => x.id === inviteId)) await loadLivechatUsers();
    const inv = LIVE.invites.find(x => x.id === inviteId);
    if(!inv){ toast("That private chat has ended.", "error"); closePrivatePanel(); return; }
    const panel = lv$("al-private"); panel.hidden = false;
    lv$("al-p-ava").innerHTML = ChatKit.avatar({ name: inv.full_name || "Member" });
    lv$("al-p-name").textContent = inv.full_name || "Member";
    lv$("al-p-sub").textContent = inv.status === "ACCEPTED" ? "Private chat · only you and they can read it" : "Waiting for them to accept your invite";
    lv$("al-pform").hidden = inv.status !== "ACCEPTED";
    if(!lv$("al-pform").hidden && lv$("al-pform").ckFit) lv$("al-pform").ckFit();
    lv$("al-pscroll").dataset.ckKey = "";
    paintPeople();
    await loadPrivate(true);
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function closePrivatePanel(){ LIVE.privateId = null; adminPrivateInviteId = null; lv$("al-private").hidden = true; paintPeople(); }
  async function loadPrivate(bottom){
    const inv = LIVE.invites.find(x => x.id === LIVE.privateId);
    const box = lv$("al-pscroll"); if(!box || !inv) return;
    if(inv.status !== "ACCEPTED"){
      ChatKit.paint(box, ChatKit.empty("i-clock", "Invite sent", inv.message ? "Your note: “" + inv.message + "”" : "The chat opens here when they accept."), { key: "wait" + inv.id });
      return;
    }
    const { data, error } = await sb.rpc("get_private_chat_messages", { p_invite_id: inv.id, p_limit: 300 });
    if(error){ ChatKit.paint(box, ChatKit.empty("i-warning", "Couldn't load this chat", lvErr(error)), { key: "err" + inv.id }); return; }
    LIVE.privateMsgs = (Array.isArray(data) ? data : []).filter(m => !m.is_deleted);
    const items = LIVE.privateMsgs.map(m => {
      const team = m.sender_role === "ADMIN";
      return { id: m.id, who: team ? "team" : "member", mine: team, name: inv.full_name || "Member", avatar: { name: inv.full_name || "Member" }, text: m.body, at: m.created_at, edited: !!m.edited_at };
    });
    ChatKit.paint(box, items.length ? ChatKit.render(items) : ChatKit.empty("i-message", "Say hello", "They accepted. Write your first message below."), { key: inv.id + "|" + items.map(i => i.id).join("|"), bottom });
  }

  // ---------- wiring ----------
  function wireLivechatAdmin(){
    const root = lv$("pane-livechat");
    if(!root || root.dataset.wired) return;
    root.dataset.wired = "1";
    lv$("al-hours-toggle").addEventListener("click", () => {
      const h = lv$("al-hours"), open = h.hidden;
      h.hidden = !open; lv$("al-hours-toggle").setAttribute("aria-expanded", String(open));
      lv$("al-hours-toggle").classList.toggle("is-on", open);
      ChatKit.fill(lv$("al-room"), { gap: 24, min: 520 });
    });
    lv$("livechat-schedule-grid").addEventListener("change", e => {
      const t = e.target.closest("[data-live-enabled]"); if(t) t.closest(".al-day").classList.toggle("is-off", !t.checked);
    });
    lv$("livechat-schedule-save").addEventListener("click", saveLivechatSchedule);
    lv$("al-search").addEventListener("input", e => { LIVE.q = e.target.value; paintPeople(); });
    lv$("al-unpin").addEventListener("click", e => { if(e.currentTarget.dataset.id) setPin(e.currentTarget.dataset.id, false); });
    lv$("al-scroll").addEventListener("click", e => {
      const pin = e.target.closest("[data-al-pin]"); if(pin){ setPin(pin.dataset.alPin, !pin.dataset.pinned); return; }
      const inv = e.target.closest("[data-al-invite]"); if(inv){ inviteDialog(inv.dataset.alInvite, inv.dataset.name); return; }
      const del = e.target.closest("[data-al-del]");
      if(del) armed(del, "Remove?", async () => {
        const { error } = await sb.rpc("delete_live_chat_group_message", { p_message_id: del.dataset.alDel });
        if(error){ del.disabled = false; toast(lvErr(error), "error"); return; }
        toast("Message removed for everyone.", "success"); await loadPublicLivechatMessages();
      });
    });
    lv$("livechat-admin-members").addEventListener("click", e => {
      const op = e.target.closest("[data-al-open]"); if(op){ openPrivate(op.dataset.alOpen); return; }
      const inv = e.target.closest("[data-al-invite]"); if(inv){ inviteDialog(inv.dataset.alInvite, inv.dataset.name); return; }
      const bl = e.target.closest("[data-al-block]");
      if(bl){
        const blockIt = !bl.dataset.blocked;
        const go = async () => {
          const { error } = await sb.rpc("admin_set_live_chat_block", { p_user_id: bl.dataset.alBlock, p_blocked: blockIt });
          if(error){ bl.disabled = false; toast(lvErr(error), "error"); return; }
          toast(blockIt ? "They can read Live Chat but can't post." : "They can post in Live Chat again.", "success");
          await loadLivechatUsers();
        };
        if(blockIt) armed(bl, "Block?", go); else { bl.disabled = true; go(); }
      }
    });
    lv$("al-p-hide").addEventListener("click", closePrivatePanel);
    lv$("al-p-close").addEventListener("click", e => armed(e.currentTarget, "End chat?", async () => {
      const id = LIVE.privateId; if(!id) return;
      const { error } = await sb.rpc("admin_close_private_chat", { p_invite_id: id });
      lv$("al-p-close").disabled = false; lv$("al-p-close").classList.remove("is-armed"); lv$("al-p-close").textContent = "End chat";
      if(error){ toast(lvErr(error), "error"); return; }
      toast("Private chat ended.", "success"); closePrivatePanel(); loadLivechatUsers();
    }));
    ChatKit.composer(lv$("al-form"), async text => {
      const { error } = await sb.rpc("admin_send_live_chat_group_message", { p_body: text });
      if(error){ toast(lvErr(error), "error"); return false; }
      await loadPublicLivechatMessages(true); return true;
    });
    ChatKit.composer(lv$("al-pform"), async text => {
      if(!LIVE.privateId) return false;
      const { error } = await sb.rpc("send_private_chat_message", { p_invite_id: LIVE.privateId, p_body: text });
      if(error){ toast(lvErr(error), "error"); return false; }
      await loadPrivate(true); return true;
    });
    window.addEventListener("resize", () => { if(lvVisible()) ChatKit.fill(lv$("al-room"), { gap: 24, min: 520 }); });
  }
  function initPublicLivechatAdmin(){
    wireLivechatAdmin();
    ChatKit.fill(lv$("al-room"), { gap: 24, min: 520 });
    loadLivechatSchedule(); loadPublicLivechatMessages(true); loadLivechatUsers();
    if(LIVE.privateId) loadPrivate();
    if(!LIVE.timer) LIVE.timer = setInterval(async () => {
      if(!AppState.isAdmin || !lvVisible()) return;
      paintLiveState();
      await loadPublicLivechatMessages();
      await loadLivechatUsers();
      if(LIVE.privateId){
        const inv = LIVE.invites.find(x => x.id === LIVE.privateId);
        if(!inv){ closePrivatePanel(); return; }
        if(inv.status === "ACCEPTED" && lv$("al-pform").hidden){ openPrivate(inv.id); return; }
        await loadPrivate();
      }
    }, 4000);
  }

  async function loadPrizeCampaigns(){
    const box=document.getElementById("admin-prize-list");if(!box)return;
    const {data,error}=await sb.rpc("admin_get_referral_prize_campaigns",{p_limit:50});
    if(error){box.innerHTML=`<div class="empty-state"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-warning"/></svg> ${escapeHtml(error.message||"Could not load prize campaigns.")}</div>`;return;}
    if(!data?.length){box.innerHTML='<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-trophy"/></svg></div>No prize campaign created yet.</div>';return;}
    box.innerHTML=data.map(c=>{
      const active=c.status==="ACTIVE";
      return `<div class="prize-campaign-row"><div><div class="prize-campaign-title">${escapeHtml(c.title)}</div><div class="prize-campaign-meta">${escapeHtml(c.description||'Top 3 referral members receive prizes.')}<br>${escapeHtml(fmtDate(c.starts_at))} <svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-arrow-right"/></svg> ${escapeHtml(fmtDate(c.ends_at))}</div><div class="prize-campaign-pots"><span class="prize-pot"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-medal"/></svg> ${money(Number(c.first_prize)||0)}</span><span class="prize-pot"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-medal"/></svg> ${money(Number(c.second_prize)||0)}</span><span class="prize-pot"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-medal"/></svg> ${money(Number(c.third_prize)||0)}</span></div></div><div style="display:flex;align-items:center;gap:8px;"><span class="prize-status ${active?'active':c.status==='CANCELLED'?'cancelled':''}">${escapeHtml(c.status)}</span>${active?`<button class="btn btn-danger btn-sm" data-cancel-prize="${c.id}">Cancel</button>`:""}</div></div>`;
    }).join("");
    box.querySelectorAll("[data-cancel-prize]").forEach(btn=>btn.addEventListener("click",async()=>{if(!confirm("Cancel this prize campaign?"))return;btn.disabled=true;const {error}=await sb.rpc("admin_cancel_referral_prize_campaign",{p_campaign_id:btn.dataset.cancelPrize});if(error){toast(error.message||"Could not cancel campaign.","error");btn.disabled=false;return;}toast("Prize campaign cancelled.","success");loadPrizeCampaigns();}));
  }
  function wirePrizeAdmin(){
    if(window.__ssPrizeAdminWired)return;window.__ssPrizeAdminWired=true;
    document.getElementById("admin-prize-refresh")?.addEventListener("click",loadPrizeCampaigns);
    document.getElementById("admin-prize-form")?.addEventListener("submit",async e=>{
      e.preventDefault();
      const title=document.getElementById("prize-title").value.trim(),description=document.getElementById("prize-description").value.trim();
      const starts=document.getElementById("prize-starts").value,ends=document.getElementById("prize-ends").value;
      const first=Number(document.getElementById("prize-first").value||0),second=Number(document.getElementById("prize-second").value||0),third=Number(document.getElementById("prize-third").value||0);
      if(!title||!starts||!ends){toast("Title, start date and end date are required.","error");return;}
      if(new Date(ends)<=new Date(starts)){toast("End date must be after start date.","error");return;}
      const btn=document.getElementById("admin-prize-save");btn.disabled=true;btn.textContent="Creating…";
      const {error}=await sb.rpc("admin_create_referral_prize_campaign",{p_title:title,p_description:description,p_starts_at:new Date(starts).toISOString(),p_ends_at:new Date(ends).toISOString(),p_first_prize:first,p_second_prize:second,p_third_prize:third});
      btn.disabled=false;btn.textContent="Create Prize Campaign";
      if(error){toast(error.message||"Could not create prize campaign.","error");return;}
      toast("Prize campaign created.","success");e.target.reset();document.getElementById("prize-first").value="50";document.getElementById("prize-second").value="25";document.getElementById("prize-third").value="10";await loadPrizeCampaigns();
    });
  }
    // the top 10 partners, as members see them
  async function loadAdminTop10(){
    const box = document.getElementById("admin-top10"); if(!box) return;
    const { data, error } = await sb.rpc("get_referral_leaderboard_v2", { p_limit: 10 });
    if(error){ box.innerHTML = `<div class="as-none" style="grid-column:1/-1"><b>Couldn't load the list</b><span>${escapeHtml(error.message || "")}</span></div>`; return; }
    const rows = Array.isArray(data) ? data : [];
    box.innerHTML = Array.from({ length: 10 }, (_, i) => rows[i] || null).map((r, i) => r
      ? `<div class="adm-top-row"><span class="adm-top-n${i < 3 ? " r" + (i + 1) : ""}">${i + 1}</span>${ChatKit.avatar({ name: r.full_name || "Partner", size: "sm" })}<span class="adm-top-who"><b>${escapeHtml(r.full_name || "Partner")}${ldrChip(r.leader_level)}</b><small>${Number(r.qualified_referrals) || 0} verified · ${Number(r.total_referrals) || 0} invited</small></span><span class="adm-top-money">${money(Number(r.referral_earnings) || 0)}</span></div>`
      : `<div class="adm-top-row is-open"><span class="adm-top-n">${i + 1}</span><span class="ck-ava ck-ava-sm">?</span><span class="adm-top-who"><b>Open spot</b><small>No one here yet</small></span><span class="adm-top-money">—</span></div>`).join("");
  }
  function initPrizeAdmin(){
    wirePrizeAdmin(); loadPrizeCampaigns(); loadAdminTop10();
    const r = document.getElementById("admin-top10-refresh");
    if(r && !r.dataset.wired){ r.dataset.wired = "1"; r.addEventListener("click", loadAdminTop10); }
  }

  // ---------- Support inbox: read members' messages and reply ----------
  const SUP = { threads: [], filter: "all", q: "", open: null, msgs: [], loaded: false, timer: null, sending: null };
  let supportSelectedUser = null;
  const SAVED_REPLIES = [
    "Thanks for your message. We're looking into it now.",
    "Your withdrawal has been sent. Please check your account.",
    "Your deposit is in your wallet now.",
    "Could you send us a screenshot of the problem?",
    "Please refresh the page and try again.",
    "Glad it's sorted. Write to us any time."
  ];
  const TRASH = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6"/></svg>';
  const sup$ = id => document.getElementById(id);
  const supVisible = () => { const p = sup$("pane-support"); return !!p && p.classList.contains("show") && !document.hidden; };
  const supErr = e => String((e && e.message) || "Something went wrong. Please try again.").replace(/^Postgres error:\s*/i, "");

  function paintSupportBadge(){
    const n = SUP.threads.reduce((s, t) => s + (Number(t.unread_count) || 0), 0);
    const link = document.querySelector('#app-sidebar .nav-link[data-navkey="support"]');
    if(link){
      let b = link.querySelector(".nav-count");
      if(!b){ b = document.createElement("span"); b.className = "nav-count"; link.appendChild(b); }
      b.textContent = n > 99 ? "99+" : String(n); b.hidden = !n;
    }
    const tot = sup$("as-total"); if(tot) tot.textContent = n ? n + " unread" : "";
  }

  function paintThreads(){
    const list = sup$("as-list"); if(!list) return;
    const q = SUP.q.trim().toLowerCase();
    const rows = SUP.threads.filter(t => (SUP.filter !== "unread" || Number(t.unread_count) > 0)
      && (!q || String(t.full_name || "").toLowerCase().includes(q) || String(t.user_code || "").toLowerCase().includes(q)));
    if(!SUP.threads.length){
      list.innerHTML = `<div class="as-none"><b>No messages yet</b><span>When a member writes in Support Chat, it shows up here.</span></div>`;
      return;
    }
    if(!rows.length){
      list.innerHTML = `<div class="as-none"><b>${SUP.filter === "unread" && !q ? "You're all caught up" : "Nothing matches"}</b><span>${SUP.filter === "unread" && !q ? "Every message has been read." : "Try another name or ID."}</span></div>`;
      return;
    }
    list.innerHTML = rows.map(t => {
      const unread = Number(t.unread_count) || 0, name = t.full_name || "Member";
      return `<button type="button" class="as-thread${SUP.open === t.user_id ? " is-on" : ""}${unread ? " is-unread" : ""}" data-thread="${escapeHtml(t.user_id)}">
        ${ChatKit.avatar({ name, url: t.avatar_url })}
        <span class="as-thread-main">
          <span class="as-thread-top"><b>${escapeHtml(name)}</b><time>${escapeHtml(ChatKit.ago(t.created_at))}</time></span>
          <span class="as-thread-last">${t.sender === "ADMIN" ? "<em>You:</em> " : ""}${escapeHtml(String(t.body || "").slice(0, 120))}</span>
        </span>
        ${unread ? `<span class="as-unread">${unread > 9 ? "9+" : unread}</span>` : ""}
      </button>`;
    }).join("");
  }

  async function loadSupportThreads(){
    const { data, error } = await sb.rpc("admin_get_support_threads_v4");
    if(error){
      if(!SUP.loaded){ const list = sup$("as-list"); if(list) list.innerHTML = `<div class="as-none"><b>Couldn't load the inbox</b><span>${escapeHtml(supErr(error))}</span></div>`; }
      return;
    }
    SUP.loaded = true;
    SUP.threads = Array.isArray(data) ? data : [];
    if(SUP.open){ const t = SUP.threads.find(x => x.user_id === SUP.open); if(t && SUP.markedFor === SUP.open) t.unread_count = 0; }
    paintSupportBadge();
    paintThreads();
  }

  function paintThread(bottom){
    const box = sup$("as-scroll"); if(!box || !SUP.open) return;
    const t = SUP.threads.find(x => x.user_id === SUP.open) || SUP.openInfo || {};
    const name = t.full_name || "Member";
    const items = SUP.msgs.map(m => {
      const team = m.sender === "ADMIN";
      return {
        id: m.id, who: team ? "team" : "member", mine: team, name, avatar: { name, url: t.avatar_url },
        text: m.body, at: m.created_at, status: team ? (m.read_by_user ? "seen" : "sent") : null,
        tools: `<div class="ck-tools"><button type="button" class="ck-tool is-danger" data-as-del="${escapeHtml(m.id)}" title="Delete for both of you" aria-label="Delete message">${TRASH}</button></div>`
      };
    });
    if(SUP.sending) items.push({ id: "sending", who: "team", mine: true, text: SUP.sending.text, at: SUP.sending.at, status: "sending" });
    const key = SUP.open + "|" + items.map(i => i.id + (i.status || "")).join("|");
    ChatKit.paint(box, items.length ? ChatKit.render(items) : ChatKit.empty("i-message", "No messages yet", "Write the first message below."), { key, bottom });
  }

  async function loadSupportHistoryMessages(bottom){
    const uid = SUP.open; if(!uid) return;
    const { data, error } = await sb.rpc("admin_get_support_history_v4", { p_user_id: uid });
    if(uid !== SUP.open) return;
    if(error){ ChatKit.paint(sup$("as-scroll"), ChatKit.empty("i-warning", "Couldn't load this chat", supErr(error)), { key: "err" + uid }); return; }
    SUP.msgs = Array.isArray(data) ? data : [];
    paintThread(bottom);
    if(supVisible() && SUP.msgs.some(m => m.sender === "USER" && !m.read_by_admin)){
      const r = await sb.rpc("admin_mark_support_read", { p_user_id: uid });
      if(!r.error){
        SUP.msgs.forEach(m => { if(m.sender === "USER") m.read_by_admin = true; });
        SUP.markedFor = uid;
        const t = SUP.threads.find(x => x.user_id === uid); if(t) t.unread_count = 0;
        paintSupportBadge(); paintThreads();
      }
    }
  }

  async function openThread(uid){
    SUP.open = uid; supportSelectedUser = uid; SUP.msgs = []; SUP.markedFor = null;
    const t = SUP.threads.find(x => x.user_id === uid) || {};
    SUP.openInfo = t;
    sup$("as").classList.add("is-open");
    sup$("as-pick").hidden = true;
    ["as-head", "as-scroll", "as-saved", "as-form"].forEach(id => { sup$(id).hidden = false; });
    if(sup$("as-form").ckFit) sup$("as-form").ckFit();
    sup$("as-head-ava").innerHTML = ChatKit.avatar({ name: t.full_name || "Member", url: t.avatar_url, size: "lg" });
    sup$("as-head-name").textContent = t.full_name || "Member";
    sup$("as-head-sub").textContent = (t.user_code || uid) + " · replies show up in their Support Chat";
    sup$("as-scroll").dataset.ckKey = "";
    sup$("as-scroll").innerHTML = '<div class="skel" style="height:56px;width:60%;border-radius:16px;margin:8px 0;"></div><div class="skel" style="height:44px;width:44%;margin:8px 0 8px auto;border-radius:16px;"></div>';
    paintThreads();
    ChatKit.fill(sup$("as"), { gap: 24, min: 520 });
    await loadSupportHistoryMessages(true);
    if(!matchMedia("(hover: none)").matches) sup$("as-input").focus();
  }

  async function sendSupportReply(text){
    const uid = SUP.open; if(!uid) return false;
    SUP.sending = { text, at: new Date().toISOString() }; paintThread(true);
    const { error } = await sb.rpc("admin_send_support_message", { p_user_id: uid, p_body: text });
    SUP.sending = null;
    if(error){ paintThread(); toast(supErr(error), "error"); return false; }
    await loadSupportHistoryMessages(true);
    loadSupportThreads();
    return true;
  }

  function wireSupport(){
    const root = sup$("as");
    if(!root || root.dataset.wired) return;
    root.dataset.wired = "1";
    sup$("as-list").addEventListener("click", e => { const b = e.target.closest("[data-thread]"); if(b) openThread(b.dataset.thread); });
    sup$("as-search").addEventListener("input", e => { SUP.q = e.target.value; paintThreads(); });
    root.querySelectorAll("[data-as-filter]").forEach(b => b.addEventListener("click", () => {
      SUP.filter = b.dataset.asFilter;
      root.querySelectorAll("[data-as-filter]").forEach(x => x.classList.toggle("is-on", x === b));
      paintThreads();
    }));
    sup$("as-back").addEventListener("click", () => { root.classList.remove("is-open"); });
    sup$("as-copy").addEventListener("click", async () => {
      const t = SUP.threads.find(x => x.user_id === SUP.open) || SUP.openInfo || {};
      const v = t.user_code || SUP.open || "";
      try{ await navigator.clipboard.writeText(v); toast("Copied " + v, "success"); }catch(e){ toast(v, "success"); }
    });
    sup$("as-saved").innerHTML = SAVED_REPLIES.map(s => `<button type="button" class="ck-chip" data-saved="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("");
    sup$("as-saved").addEventListener("click", e => {
      const b = e.target.closest("[data-saved]"); if(!b) return;
      const input = sup$("as-input");
      input.value = input.value.trim() ? input.value.trim() + " " + b.dataset.saved : b.dataset.saved;
      input.dispatchEvent(new Event("input")); input.focus();
    });
    // delete a message: tap once to arm, tap again to delete
    sup$("as-scroll").addEventListener("click", async e => {
      const b = e.target.closest("[data-as-del]"); if(!b) return;
      if(!b.classList.contains("is-armed")){
        b.classList.add("is-armed"); b.textContent = "Delete?";
        setTimeout(() => { if(b.isConnected && b.classList.contains("is-armed")){ b.classList.remove("is-armed"); b.innerHTML = TRASH; } }, 3000);
        return;
      }
      b.disabled = true;
      const { error } = await sb.rpc("admin_delete_support_message", { p_message_id: b.dataset.asDel });
      if(error){ b.disabled = false; toast(supErr(error), "error"); return; }
      toast("Message deleted.", "success");
      await loadSupportHistoryMessages(); loadSupportThreads();
    });
    ChatKit.composer(sup$("as-form"), sendSupportReply);
    window.addEventListener("resize", () => { if(supVisible()) ChatKit.fill(sup$("as"), { gap: 24, min: 520 }); });
  }

  function initSupportAdmin(){
    wireSupport();
    ChatKit.fill(sup$("as"), { gap: 24, min: 520 });
    loadSupportThreads();
    if(SUP.open) loadSupportHistoryMessages();
    if(!SUP.timer) SUP.timer = setInterval(() => {
      if(!canTab("support") || !supVisible()) return;
      loadSupportThreads();
      if(SUP.open) loadSupportHistoryMessages();
    }, 5000);
  }


  // ---------- payment methods: open / close Binance and bKash, and set their numbers ----------
  const PAY_NAMES = { BINANCE: "Binance", BKASH: "bKash" };
  function payForms(){ return document.querySelectorAll("#pay-admin-list form[data-method]"); }
  function payError(msg){ const el = document.getElementById("pay-admin-err"); if(!el) return; el.textContent = msg || ""; el.style.display = msg ? "block" : "none"; }
  function paintPayState(f){
    const open = f.querySelector("[name=is_open]").checked;
    f.classList.toggle("is-closed", !open);
    f.querySelector(".pay-admin-state").textContent = open ? "Open" : "Closed";
  }
  function paintPaySaved(f, row){
    const u = f.querySelector(".pay-admin-updated");
    if(u) u.textContent = row && row.updated_at ? "Last saved " + fmtDate(row.updated_at) : "";
  }
  async function loadPaymentMethods(){
    payError("");
    const { data, error } = await sb.from("payment_methods").select("method,account,is_open,updated_at");
    if(error){ payError("Couldn't load payment methods. Run the payment-methods.sql file in Supabase once, then refresh. (" + error.message + ")"); return; }
    const rows = {}; (data || []).forEach(r => { rows[r.method] = r; });
    payForms().forEach(f => {
      const r = rows[f.dataset.method];
      if(r){ f.querySelector("[name=account]").value = r.account || ""; f.querySelector("[name=is_open]").checked = r.is_open !== false; }
      paintPayState(f); paintPaySaved(f, r);
    });
  }
  async function savePaymentMethod(f){
    payError("");
    const m = f.dataset.method;
    const account = f.querySelector("[name=account]").value.trim();
    const isOpen = f.querySelector("[name=is_open]").checked;
    if(!account){ payError("Please enter the " + PAY_NAMES[m] + " number."); return; }
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true; btn.querySelector(".btn-label").innerHTML = '<span class="spinner"></span>';
    const { data, error } = await sb.rpc("admin_set_payment_method", { p_method: m, p_account: account, p_is_open: isOpen });
    btn.disabled = false; btn.querySelector(".btn-label").textContent = "Save";
    if(error){ payError(error.message || "Couldn't save. Please try again."); loadPaymentMethods(); return; }
    paintPayState(f); paintPaySaved(f, Array.isArray(data) ? data[0] : data);
    toast(PAY_NAMES[m] + (isOpen ? " is open." : " is closed."), "success");
  }
  function wirePaymentsOnce(){
    const list = document.getElementById("pay-admin-list");
    if(!list || list.dataset.wired) return;
    list.dataset.wired = "1";
    payForms().forEach(f => {
      f.addEventListener("submit", e => { e.preventDefault(); savePaymentMethod(f); });
      f.querySelector("[name=is_open]").addEventListener("change", () => { paintPayState(f); savePaymentMethod(f); });
    });
  }

  // ---------- Members: new accounts, check list (not verified for 3+ days), verified ----------
  const MB_NOTE = {
    new: "Accounts made in the last 3 days that are not verified yet. After 3 days without verifying, they move to the check list by themselves.",
    check: "Accounts that have stayed unverified for 3 days or more. Good people to call or email.",
    verified: "Members who verified. They move here by themselves the moment they verify. Newest first.",
    all: "Every member account."
  };
  const MB = { list: "new", q: "", offset: 0, rows: [], total: 0, full: false, seq: 0 };
  function mbDays(v){ return v ? Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 86400000)) : 0; }
  function mbAgo(v){
    if(!v) return "";
    const m = Math.max(0, (Date.now() - new Date(v).getTime()) / 60000);
    if(m < 60) return Math.max(1, Math.floor(m)) + " min ago";
    if(m < 1440) return Math.floor(m / 60) + " h ago";
    const d = Math.floor(m / 1440);
    return d === 1 ? "yesterday" : d + " days ago";
  }
  function mbPhone(p){ const s = String(p || ""); return /^\+8801\d{9}$/.test(s) ? "0" + s.slice(4) : s; }
  function mbStat(label, value, sub, cls){
    return `<div class="mb-stat ${cls || ""}"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
  }
  async function loadMembersSummary(){
    const box = document.getElementById("mb-stats");
    const { data, error } = await sb.rpc("admin_get_members_summary");
    if(error){ box.innerHTML = ""; mbError("Couldn't load members. Run the v28 SQL in Supabase once, then refresh. (" + error.message + ")"); return; }
    const s = data || {};
    MB.full = !!s.full;
    box.innerHTML =
      mbStat("Accounts", Number(s.total || 0), `+${Number(s.today || 0)} today`) +
      mbStat("Verified", Number(s.verified || 0), `+${Number(s.verified_today || 0)} today`, "is-ok") +
      mbStat("New, not verified", Number(s.new || 0), "less than 3 days") +
      mbStat("Check list", Number(s.check || 0), "not verified for 3+ days", Number(s.check || 0) ? "is-warn" : "") +
      (s.full ? mbStat("In all wallets", money(s.wallets || 0), Number(s.no_phone || 0) ? `${Number(s.no_phone)} without a phone number` : "everyone has a phone number", "is-money")
              : mbStat("No phone number", Number(s.no_phone || 0), "members who have not added one"));
    document.querySelectorAll("[data-mb-count]").forEach(el => { const v = s[el.dataset.mbCount]; el.textContent = v == null ? "" : String(v); });
  }
  function mbError(msg){ const el = document.getElementById("mb-err"); if(!el) return; el.textContent = msg || ""; el.style.display = msg ? "block" : "none"; }
  function mbRow(r){
    const tags = [r.is_vip ? "VIP" : "", r.is_investor ? "Investor" : "", r.vip_free && !r.is_verified ? "Free link" : "", r.blocked ? "Blocked" : ""].filter(Boolean);
    const waited = mbDays(r.created_at);
    const when = MB.list === "verified" || (MB.list === "all" && r.is_verified)
      ? `<b>Verified</b><span>${r.verified_at ? fmtDate(r.verified_at) : "—"}</span>`
      : !r.is_verified && waited >= 3
        ? `<b class="is-warn">Waiting ${waited} days</b><span>Joined ${fmtDate(r.created_at)}</span>`
        : `<b>Joined ${escapeHtml(mbAgo(r.created_at))}</b><span>${fmtDate(r.created_at)}</span>`;
    const phone = r.phone
      ? `<a class="mb-phone" href="tel:${escapeHtml(r.phone)}">${escapeHtml(mbPhone(r.phone))}</a><button type="button" class="mb-copy" data-mb-copy="${escapeHtml(mbPhone(r.phone))}" aria-label="Copy number">Copy</button>`
      : `<span class="mb-none">No number</span>`;
    return `<div class="mb-row">
      <div class="mb-who"><div class="mb-av">${escapeHtml(((r.full_name || "M").trim()[0] || "M").toUpperCase())}</div>
        <div class="mb-name"><b>${escapeHtml(r.full_name || "Member")}</b><span>${escapeHtml(r.user_code || "")}${tags.map(t => ` <i class="mb-tag">${t}</i>`).join("")}</span></div></div>
      <div class="mb-cell mb-mail"><small>Email</small><a href="mailto:${escapeHtml(r.email || "")}">${escapeHtml(r.email || "—")}</a></div>
      <div class="mb-cell"><small>Phone</small><div class="mb-phone-line">${phone}</div></div>
      <div class="mb-cell mb-when"><small>${r.is_verified ? "Status" : "Joined"}</small>${when}</div>
      ${MB.full ? `<div class="mb-cell mb-bal"><small>Wallet</small><b>${money(r.balance || 0)}</b><button type="button" class="mb-reset" data-mb-reset="${escapeHtml(r.id)}" data-name="${escapeHtml(r.full_name || "this member")}" title="Use when a member lost their phone or forgot their PIN">Reset PIN & 2FA</button></div>` : ""}
    </div>`;
  }
  function paintMembers(){
    const list = document.getElementById("mb-list");
    list.classList.toggle("has-bal", MB.full);
    const head = `<div class="mb-head"><span>Member</span><span>Email</span><span>Phone</span><span>${MB.list === "verified" ? "Verified" : "Joined"}</span>${MB.full ? "<span>Wallet</span>" : ""}</div>`;
    list.innerHTML = MB.rows.length ? head + MB.rows.map(mbRow).join("")
      : `<div class="empty-state">${MB.q ? "No member matches your search." : MB.list === "check" ? "Nobody is on the check list. Everyone verified within 3 days." : MB.list === "new" ? "No new unverified accounts in the last 3 days." : "No members here yet."}</div>`;
    const more = document.getElementById("mb-more");
    more.hidden = MB.rows.length >= MB.total;
    more.textContent = `Show more (${Math.max(0, MB.total - MB.rows.length)} left)`;
  }
  async function loadMembers(reset){
    if(reset){ MB.offset = 0; MB.rows = []; loadMembersSummary(); document.getElementById("mb-list").innerHTML = '<div class="skel" style="height:220px;"></div>'; }
    document.getElementById("mb-note").textContent = MB_NOTE[MB.list];
    mbError("");
    const seq = ++MB.seq;
    const { data, error } = await sb.rpc("admin_get_members", { p_list: MB.list, p_search: MB.q || null, p_limit: 50, p_offset: MB.offset });
    if(seq !== MB.seq) return;
    if(error){ document.getElementById("mb-list").innerHTML = ""; mbError(error.message || "Couldn't load members."); return; }
    MB.full = !!(data && data.full);
    MB.total = Number((data && data.total) || 0);
    MB.rows = MB.rows.concat((data && data.rows) || []);
    MB.offset = MB.rows.length;
    paintMembers();
  }
  function wireMembersOnce(){
    const pane = document.getElementById("pane-members");
    if(!pane || pane.dataset.wired) return;
    pane.dataset.wired = "1";
    pane.querySelectorAll("[data-mb-list]").forEach(b => b.addEventListener("click", () => {
      MB.list = b.dataset.mbList;
      pane.querySelectorAll("[data-mb-list]").forEach(x => x.classList.toggle("active", x === b));
      loadMembers(true);
    }));
    let t = null;
    document.getElementById("mb-search").addEventListener("input", e => {
      clearTimeout(t);
      t = setTimeout(() => { MB.q = e.target.value.trim(); loadMembers(true); }, 300);
    });
    document.getElementById("mb-more").addEventListener("click", () => loadMembers(false));
    document.getElementById("mb-list").addEventListener("click", async e => {
      const rs = e.target.closest("[data-mb-reset]");
      if(rs){
        if(!confirm(`Reset the Pay PIN and Google Authenticator of ${rs.dataset.name}?\n\nDo this only after you checked it's really them (for example in Support Chat). They can set both up again from their Profile. Email codes keep working.`)) return;
        rs.disabled = true; const old = rs.textContent; rs.textContent = "Resetting…";
        const { data, error } = await sb.rpc("admin_reset_pay_security", { p_user: rs.dataset.mbReset });
        rs.disabled = false; rs.textContent = old;
        if(error){ toast(error.message || "Couldn't reset.", "error"); return; }
        const d = data || {};
        toast(Number(d.authenticators || 0) || d.pin ? `Done. Removed ${Number(d.authenticators || 0) ? "Google Authenticator" : ""}${Number(d.authenticators || 0) && d.pin ? " and " : ""}${d.pin ? "Pay PIN" : ""}.` : "This member had no Pay PIN or Authenticator.", "success");
        return;
      }
      const c = e.target.closest("[data-mb-copy]"); if(!c) return;
      vipCopy(c.dataset.mbCopy, c);
    });
  }

  // ---------- Referrals: who joined with whose link ----------
  const RF_KIND = { refer: "Refer link", free: "Free link", vip: "VIP link", investor: "Investor link", none: "No link" };
  const RF_NOTE = {
    all: "Every member and the person whose link they used. Click a name to see everyone that person brought in.",
    refer: "Members who joined with someone's normal refer link.",
    free: "Members who joined with a VIP member's free link. The VIP member is their inviter.",
    vip: "Members who joined with a VIP link. The admin who made the link is their inviter.",
    investor: "Members who joined with an investor link. The admin who made the link is their inviter."
  };
  const RF = { kind: "all", q: "", inviter: null, offset: 0, rows: [], total: 0, seq: 0 };
  function rfErr(msg){ const el = document.getElementById("rf-err"); if(!el) return; el.textContent = msg || ""; el.style.display = msg ? "block" : "none"; }
  function rfAv(name){ return `<div class="mb-av">${escapeHtml(((name || "M").trim()[0] || "M").toUpperCase())}</div>`; }
  function rfPeople(n, v, id){
    n = Number(n || 0); v = Number(v || 0);
    if(!n) return `<span class="mb-none">No one yet</span>`;
    return `<button type="button" class="rf-link" data-rf-open="${escapeHtml(id)}"><b>${n}</b> joined · <b class="rf-ok">${v}</b> verified</button>`;
  }
  async function loadRefsSummary(){
    const { data, error } = await sb.rpc("admin_get_referrals_summary");
    const box = document.getElementById("rf-stats");
    if(error){ box.innerHTML = ""; rfErr("Couldn't load referrals. Run the v30 SQL in Supabase once, then refresh. (" + error.message + ")"); return; }
    const s = data || {};
    box.innerHTML =
      mbStat("Accounts", Number(s.total || 0), Number(s.none || 0) ? `${Number(s.none)} with no inviter` : "everyone has an inviter") +
      mbStat("Refer link", Number(s.refer || 0), "a member's normal link") +
      mbStat("Free link", Number(s.free || 0), "a VIP member's free link") +
      mbStat("VIP link", Number(s.vip || 0), "made by an admin") +
      mbStat("Investor link", Number(s.investor || 0), "made by an admin");
    document.querySelectorAll("[data-rf-count]").forEach(el => { const v = s[el.dataset.rfCount]; el.textContent = v == null ? "" : String(v); });
    const top = s.top || [];
    document.getElementById("rf-top").innerHTML = top.length ? `<small>Top inviters</small><div class="rf-top-list">${top.map(t => `
      <button type="button" class="rf-chip" data-rf-open="${escapeHtml(t.id)}">${rfAv(t.full_name)}<span><b>${escapeHtml(t.full_name)}${t.is_vip ? ' <i class="mb-tag">VIP</i>' : ""}</b><em>${Number(t.invited)} joined · ${Number(t.invited_verified)} verified</em></span></button>`).join("")}</div>` : "";
  }
  function paintWho(data){
    const box = document.getElementById("rf-who");
    const p = data && data.inviter;
    if(!RF.inviter || !p){ box.hidden = true; box.innerHTML = ""; document.getElementById("rf-top").hidden = false; return; }
    const up = data.inviter_up;
    box.hidden = false;
    document.getElementById("rf-top").hidden = true;
    box.innerHTML = `
      <div class="rf-who-main">${rfAv(p.full_name)}
        <div class="mb-name"><small>People who joined with the link of</small><b>${escapeHtml(p.full_name)}${p.is_vip ? ' <i class="mb-tag">VIP</i>' : ""}</b>
          <span>${escapeHtml(p.user_code || "")} · refer code ${escapeHtml(p.referral_code || "—")}${p.email ? " · " + escapeHtml(p.email) : ""}</span></div></div>
      <div class="rf-who-nums"><div><small>Joined</small><b>${Number(p.invited || 0)}</b></div><div><small>Verified</small><b class="rf-ok">${Number(p.invited_verified || 0)}</b></div></div>
      <div class="rf-who-up">${up ? `<small>${escapeHtml(p.full_name)} joined with the link of</small><button type="button" class="rf-link" data-rf-open="${escapeHtml(up.id)}">${escapeHtml(up.full_name)} · ${escapeHtml(up.user_code || "")}</button>` : `<small>Inviter</small><span class="mb-none">${p.kind === "none" ? "Nobody. Joined without a link." : "—"}</span>`}
        <button type="button" class="btn btn-secondary btn-sm" data-rf-back>Back to everyone</button></div>`;
  }
  function rfRow(r){
    const tags = [r.is_vip ? "VIP" : "", r.is_investor ? "Investor" : "", r.blocked ? "Blocked" : ""].filter(Boolean);
    const by = r.by
      ? `<button type="button" class="rf-by" data-rf-open="${escapeHtml(r.by.id)}">${rfAv(r.by.full_name)}<span><b>${escapeHtml(r.by.full_name)}${r.by.is_vip ? ' <i class="mb-tag">VIP</i>' : ""}</b><em>${escapeHtml(r.by.user_code || "")}</em></span></button>`
      : `<span class="mb-none">Nobody</span>`;
    return `<div class="mb-row">
      <div class="mb-who">${rfAv(r.full_name)}
        <div class="mb-name"><b>${escapeHtml(r.full_name)}</b><span>${escapeHtml(r.user_code || "")}${tags.map(t => ` <i class="mb-tag">${t}</i>`).join("")}</span>${r.email ? `<span class="rf-mail">${escapeHtml(r.email)}</span>` : ""}</div></div>
      <div class="mb-cell"><small>Joined with</small><i class="rf-kind rf-kind-${escapeHtml(r.kind)}">${RF_KIND[r.kind] || "—"}</i></div>
      <div class="mb-cell"><small>Inviter</small>${by}</div>
      <div class="mb-cell"><small>Their people</small>${rfPeople(r.invited, r.invited_verified, r.id)}</div>
      <div class="mb-cell mb-when"><small>Joined</small><b>${fmtDate(r.created_at)}</b><span class="${r.is_verified ? "rf-ok" : ""}">${r.is_verified ? "Verified" : r.vip_free ? "Free member, not verified" : "Not verified"}</span></div>
    </div>`;
  }
  function paintRefs(){
    const list = document.getElementById("rf-list");
    const head = `<div class="mb-head"><span>Member</span><span>Joined with</span><span>Inviter</span><span>Their people</span><span>Joined</span></div>`;
    list.innerHTML = RF.rows.length ? head + RF.rows.map(rfRow).join("")
      : `<div class="empty-state">${RF.q ? "No one matches your search." : RF.inviter ? "Nobody has joined with this link yet." : "No members here yet."}</div>`;
    const more = document.getElementById("rf-more");
    more.hidden = RF.rows.length >= RF.total;
    more.textContent = `Show more (${Math.max(0, RF.total - RF.rows.length)} left)`;
  }
  async function loadRefs(reset){
    if(reset){
      RF.offset = 0; RF.rows = [];
      if(!document.getElementById("rf-stats").dataset.done || !RF.inviter){ loadRefsSummary(); document.getElementById("rf-stats").dataset.done = "1"; }
      document.getElementById("rf-list").innerHTML = '<div class="skel" style="height:220px;"></div>';
    }
    document.getElementById("rf-note").textContent = RF.inviter ? "Everyone who joined with this person's link. Click a name to go one step down or up." : RF_NOTE[RF.kind];
    rfErr("");
    const seq = ++RF.seq;
    const { data, error } = await sb.rpc("admin_get_referrals", { p_kind: RF.kind, p_search: RF.q || null, p_inviter: RF.inviter, p_limit: 50, p_offset: RF.offset });
    if(seq !== RF.seq) return;
    if(error){ document.getElementById("rf-list").innerHTML = ""; rfErr(error.message || "Couldn't load referrals."); return; }
    if(reset) paintWho(data);
    RF.total = Number((data && data.total) || 0);
    RF.rows = RF.rows.concat((data && data.rows) || []);
    RF.offset = RF.rows.length;
    paintRefs();
  }
  function rfOpen(id){
    RF.inviter = id || null;
    loadRefs(true);
    const pane = document.getElementById("pane-referrals");
    if(pane) pane.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function wireRefsOnce(){
    const pane = document.getElementById("pane-referrals");
    if(!pane || pane.dataset.wired) return;
    pane.dataset.wired = "1";
    pane.querySelectorAll("[data-rf-kind]").forEach(b => b.addEventListener("click", () => {
      RF.kind = b.dataset.rfKind;
      pane.querySelectorAll("[data-rf-kind]").forEach(x => x.classList.toggle("active", x === b));
      loadRefs(true);
    }));
    let t = null;
    document.getElementById("rf-search").addEventListener("input", e => {
      clearTimeout(t);
      t = setTimeout(() => { RF.q = e.target.value.trim(); loadRefs(true); }, 300);
    });
    document.getElementById("rf-more").addEventListener("click", () => loadRefs(false));
    pane.addEventListener("click", e => {
      const o = e.target.closest("[data-rf-open]"); if(o){ rfOpen(o.dataset.rfOpen); return; }
      if(e.target.closest("[data-rf-back]")) rfOpen(null);
    });
  }

  // ---------- Transactions: every money movement ----------
  const TX_LABEL = { DEPOSIT: "Deposit", TASK_REWARD: "Task reward", REFERRAL_COMMISSION: "Commission", VERIFICATION_PAYMENT: "Verification",
    WITHDRAWAL: "Withdrawal", WITHDRAWAL_FEE: "Withdraw fee", LEADERSHIP_BONUS: "Leadership bonus", LEADERSHIP_INCOME: "Leadership income",
    INVESTOR_INCOME: "Investor income", ADMIN_ADJUSTMENT: "Admin change", REFUND: "Refund", REVERSAL: "Reversal" };
  const TX = { group: "all", q: "", user: null, from: "", to: "", offset: 0, rows: [], total: 0, seq: 0 };
  function txErr(msg){ const el = document.getElementById("tx-err"); if(!el) return; el.textContent = msg || ""; el.style.display = msg ? "block" : "none"; }
  function txDay(offsetDays){ const d = new Date(Date.now() - offsetDays * 86400000); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function txLabel(r){ return r.type === "TRANSFER" ? (r.dir === "out" ? "Transfer sent" : "Transfer received") : (TX_LABEL[r.type] || String(r.type || "").replace(/_/g, " ").toLowerCase()); }
  function txStatus(s){
    s = String(s || "").toUpperCase();
    if(s === "COMPLETED" || s === "APPROVED") return `<i class="tx-st is-ok">${s === "APPROVED" ? "Approved" : "Done"}</i>`;
    if(s === "PENDING") return `<i class="tx-st is-warn">Pending</i>`;
    return `<i class="tx-st is-bad">${escapeHtml(s.charAt(0) + s.slice(1).toLowerCase())}</i>`;
  }
  function txFailed(s){ return ["REJECTED", "FAILED", "CANCELLED", "REVERSED"].includes(String(s || "").toUpperCase()); }
  async function loadTxSummary(){
    const { data, error } = await sb.rpc("admin_get_transactions_summary");
    const box = document.getElementById("tx-stats");
    if(error){ box.innerHTML = ""; txErr("Couldn't load transactions. Run the v31 SQL in Supabase once, then refresh. (" + error.message + ")"); return; }
    const s = data || {};
    box.innerHTML =
      mbStat("Transactions", Number(s.total || 0), `+${Number(s.today || 0)} today`) +
      mbStat("Money in today", money(s.today_in || 0), "deposits, rewards, bonuses", "is-ok") +
      mbStat("Money out today", money(s.today_out || 0), "withdrawals, verification") +
      mbStat("All deposits", money(s.deposits || 0), `${money(s.paid_out || 0)} paid to members`, "is-money") +
      mbStat("All withdrawals", money(s.withdrawn || 0), Number(s.pending_withdrawals || 0) ? `${Number(s.pending_withdrawals)} waiting` : "none waiting", Number(s.pending_withdrawals || 0) ? "is-warn" : "");
  }
  function paintTxMember(m){
    const box = document.getElementById("tx-member");
    if(!TX.user || !m){ box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = `
      <div class="rf-who-main"><div class="mb-av">${escapeHtml(((m.full_name || "M").trim()[0] || "M").toUpperCase())}</div>
        <div class="mb-name"><small>Transactions of</small><b>${escapeHtml(m.full_name)}</b><span>${escapeHtml(m.user_code || "")}${m.email ? " · " + escapeHtml(m.email) : ""}</span></div></div>
      <div class="rf-who-nums"><div><small>Wallet now</small><b class="rf-ok">${money(m.balance || 0)}</b></div><div><small>Earned in all</small><b>${money(m.lifetime || 0)}</b></div></div>
      <div class="rf-who-up"><button type="button" class="btn btn-secondary btn-sm" data-tx-all>Show everyone's transactions</button></div>`;
  }
  function txRow(r){
    const bad = txFailed(r.status);
    const sign = r.dir === "out" ? "−" : "+";
    let extra = "";
    if(r.other) extra = `<span class="tx-sub">${r.dir === "out" ? "to" : "from"} <button type="button" class="rf-link" data-tx-user="${escapeHtml(r.other.id)}">${escapeHtml(r.other.full_name)}</button> · ${escapeHtml(r.other.user_code || "")}</span>`;
    else if(r.type === "WITHDRAWAL" && r.fee != null) extra = `<span class="tx-sub">Fee ${money(r.fee)} · paid ${money(r.payout || 0)}</span>`;
    return `<div class="mb-row${bad ? " is-bad" : ""}">
      <div class="mb-cell tx-when"><small>When</small><b>${fmtDate(r.created_at)}</b><span>${escapeHtml(r.code || "")}</span></div>
      <div class="mb-cell"><small>Member</small><button type="button" class="rf-by" data-tx-user="${escapeHtml(r.user_id)}"><div class="mb-av">${escapeHtml(((r.full_name || "M").trim()[0] || "M").toUpperCase())}</div><span><b>${escapeHtml(r.full_name || "Member")}</b><em>${escapeHtml(r.user_code || "")}</em></span></button></div>
      <div class="mb-cell"><small>What</small><i class="rf-kind tx-k-${escapeHtml(r.group)}">${escapeHtml(txLabel(r))}</i></div>
      <div class="mb-cell tx-details"><small>Details</small><span>${escapeHtml(r.details || "—")}</span>${extra}</div>
      <div class="mb-cell tx-amt"><small>Amount</small><b class="${bad ? "" : r.dir === "out" ? "is-out" : "is-in"}">${sign}${money(r.amount)}</b></div>
      <div class="mb-cell"><small>Status</small>${txStatus(r.status)}</div>
    </div>`;
  }
  function paintTx(data){
    const list = document.getElementById("tx-list");
    const head = `<div class="mb-head"><span>When</span><span>Member</span><span>What</span><span>Details</span><span>Amount</span><span>Status</span></div>`;
    list.innerHTML = TX.rows.length ? head + TX.rows.map(txRow).join("")
      : `<div class="empty-state">${TX.q || TX.from || TX.to ? "No transaction matches these filters." : "No transactions here yet."}</div>`;
    const more = document.getElementById("tx-more");
    more.hidden = TX.rows.length >= TX.total;
    more.textContent = `Show more (${Math.max(0, TX.total - TX.rows.length)} left)`;
    if(data){
      document.getElementById("tx-sums").innerHTML = `<b>${Number(data.total || 0)}</b> transactions · in <b class="rf-ok">${money(data.sum_in || 0)}</b> · out <b>${money(data.sum_out || 0)}</b>${Number(data.pending || 0) ? ` · <b class="tx-warn">${Number(data.pending)} pending</b>` : ""}`;
      const g = data.groups || {};
      document.querySelectorAll("[data-tx-count]").forEach(el => { const v = g[el.dataset.txCount]; el.textContent = String(v || 0); });
      const other = document.querySelector('[data-tx-group="other"]'); other.hidden = !g.other && TX.group !== "other";
    }
  }
  function txArgs(limit, offset){ return { p_group: TX.group, p_search: TX.q || null, p_user: TX.user, p_from: TX.from || null, p_to: TX.to || null, p_limit: limit, p_offset: offset }; }
  async function loadTx(reset){
    if(reset){
      TX.offset = 0; TX.rows = [];
      if(!document.getElementById("tx-stats").dataset.done){ loadTxSummary(); document.getElementById("tx-stats").dataset.done = "1"; }
      document.getElementById("tx-list").innerHTML = '<div class="skel" style="height:220px;"></div>';
    }
    txErr("");
    const seq = ++TX.seq;
    const { data, error } = await sb.rpc("admin_get_transactions", txArgs(50, TX.offset));
    if(seq !== TX.seq) return;
    if(error){ document.getElementById("tx-list").innerHTML = ""; txErr(error.message || "Couldn't load transactions."); return; }
    if(reset) paintTxMember(data && data.member);
    TX.total = Number((data && data.total) || 0);
    TX.rows = TX.rows.concat((data && data.rows) || []);
    TX.offset = TX.rows.length;
    paintTx(reset ? data : null);
  }
  function txSetQuick(v){
    document.querySelectorAll("[data-tx-days]").forEach(b => b.classList.toggle("active", b.dataset.txDays === v));
  }
  async function txCsv(btn){
    btn.disabled = true; const old = btn.textContent; btn.textContent = "Preparing…";
    const { data, error } = await sb.rpc("admin_get_transactions", txArgs(5000, 0));
    btn.disabled = false; btn.textContent = old;
    if(error){ txErr(error.message || "Couldn't make the file."); return; }
    const cell = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [["Date", "Code", "Member", "Member code", "Email", "What", "In/Out", "Amount", "Fee", "Paid", "Status", "Details"].join(",")];
    ((data && data.rows) || []).forEach(r => lines.push([new Date(r.created_at).toISOString(), r.code, r.full_name, r.user_code, r.email, txLabel(r), r.dir === "out" ? "out" : "in",
      Number(r.amount || 0).toFixed(2), r.fee == null ? "" : Number(r.fee).toFixed(2), r.payout == null ? "" : Number(r.payout).toFixed(2), r.status,
      (r.details || "") + (r.other ? ` (${r.dir === "out" ? "to" : "from"} ${r.other.full_name} ${r.other.user_code || ""})` : "")].map(cell).join(",")));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "srv-transactions-" + txDay(0) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function wireTxOnce(){
    const pane = document.getElementById("pane-transactions");
    if(!pane || pane.dataset.wired) return;
    pane.dataset.wired = "1";
    pane.querySelectorAll("[data-tx-group]").forEach(b => b.addEventListener("click", () => {
      TX.group = b.dataset.txGroup;
      pane.querySelectorAll("[data-tx-group]").forEach(x => x.classList.toggle("active", x === b));
      loadTx(true);
    }));
    let t = null;
    document.getElementById("tx-search").addEventListener("input", e => {
      clearTimeout(t);
      t = setTimeout(() => { TX.q = e.target.value.trim(); loadTx(true); }, 300);
    });
    const from = document.getElementById("tx-from"), to = document.getElementById("tx-to");
    const onDate = () => { TX.from = from.value; TX.to = to.value; txSetQuick(""); loadTx(true); };
    from.addEventListener("change", onDate); to.addEventListener("change", onDate);
    pane.querySelectorAll("[data-tx-days]").forEach(b => b.addEventListener("click", () => {
      const v = b.dataset.txDays;
      if(v === "all"){ TX.from = ""; TX.to = ""; }
      else { TX.from = txDay(Number(v) === 0 ? 0 : Number(v) - 1); TX.to = txDay(0); }
      from.value = TX.from; to.value = TX.to;
      txSetQuick(v); loadTx(true);
    }));
    document.getElementById("tx-more").addEventListener("click", () => loadTx(false));
    document.getElementById("tx-csv").addEventListener("click", e => txCsv(e.currentTarget));
    pane.addEventListener("click", e => {
      const u = e.target.closest("[data-tx-user]");
      if(u){ TX.user = u.dataset.txUser; loadTx(true); pane.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
      if(e.target.closest("[data-tx-all]")){ TX.user = null; loadTx(true); }
    });
  }

  // ---------- Team: supportive admins (one link = one account, each with its own permissions) ----------
  const TEAM_PERMS = [["surveys", "Check survey tasks"], ["deposits", "Check deposits"], ["support", "Reply in Support Chat"], ["members", "See the members list (no balances)"]];
  let teamRows = [];
  function teamError(msg){ const el = document.getElementById("team-err"); if(!el) return; el.textContent = msg || ""; el.style.display = msg ? "block" : "none"; }
  function teamUrl(token){ return MAIN_SITE + "?sa=" + encodeURIComponent(token); }
  function teamAgo(v){
    if(!v) return "never";
    const m = Math.max(0, Date.now() - new Date(v).getTime()) / 60000;
    if(m < 2) return "just now";
    if(m < 60) return Math.floor(m) + " min ago";
    if(m < 1440) return Math.floor(m / 60) + " h ago";
    return fmtDate(v);
  }
  function teamCard(r){
    const joined = !!r.user_id;
    const state = !r.is_active ? ["Off", "is-off"] : r.banned ? ["Locked", "is-off"] : joined ? ["Active", ""] : ["Waiting for sign-up", "is-wait"];
    const sw = (key, on, label) => `<label class="pay-switch" title="${escapeHtml(label)}"><input type="checkbox" data-team-set="${key}" ${on ? "checked" : ""}><span class="pay-switch-track" aria-hidden="true"></span><span class="sr-only">${escapeHtml(label)}</span></label>`;
    return `<div class="team-card ${state[1]}" data-team-id="${escapeHtml(r.id)}">
      <div class="team-top">
        <div class="team-name"><strong>${escapeHtml(r.label || (joined ? r.full_name : "") || "Team link")}</strong><span class="team-state">${state[0]}</span></div>
        <div class="team-access"><span>Access</span>${sw("active", r.is_active, "Access on or off")}</div>
      </div>
      ${joined ? `<div class="team-person">
          <div class="team-av">${escapeHtml(((r.full_name || "S").trim()[0] || "S").toUpperCase())}</div>
          <div class="team-who"><b>${escapeHtml(r.full_name || "Supportive admin")}</b><small>${escapeHtml(r.email || "")}</small></div>
          <div class="team-stats"><span><b>${Number(r.surveys_checked || 0)}</b> tasks checked</span><span><b>${Number(r.deposits_checked || 0)}</b> deposits checked</span><span>Last sign-in ${escapeHtml(teamAgo(r.last_sign_in_at))}</span></div>
        </div>`
      : `<div class="vip-card-url"><code>${escapeHtml(teamUrl(r.token))}</code><button class="btn btn-primary btn-sm" type="button" data-team-copy="${escapeHtml(teamUrl(r.token))}">Copy link</button></div>`}
      <div class="team-perm-list">${TEAM_PERMS.map(([k, label]) => `<div class="team-perm-row"><span>${label}</span>${sw(k, r[k], label)}</div>`).join("")}</div>
      <div class="team-foot">
        <small>Made ${fmtDate(r.created_at)}${joined && r.joined_at ? " · joined " + fmtDate(r.joined_at) : ""}</small>
        <button class="btn btn-ghost btn-sm team-del" type="button" data-team-del="${escapeHtml(r.id)}">${joined ? "Delete account" : "Delete link"}</button>
      </div>
    </div>`;
  }
  async function loadTeam(){
    teamError("");
    const list = document.getElementById("team-list");
    const { data, error } = await sb.rpc("admin_get_helper_links");
    if(error){ list.innerHTML = ""; teamError("Couldn't load the team. Run the v27 SQL in Supabase once, then refresh. (" + error.message + ")"); return; }
    teamRows = Array.isArray(data) ? data : [];
    list.innerHTML = teamRows.length ? teamRows.map(teamCard).join("")
      : '<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-link"/></svg></div>No team links yet. Make one above.</div>';
  }
  async function saveTeam(card){
    const row = teamRows.find(x => x.id === card.dataset.teamId); if(!row) return;
    const val = k => !!card.querySelector(`[data-team-set="${k}"]`).checked;
    card.querySelectorAll("[data-team-set]").forEach(i => i.disabled = true);
    const { error } = await sb.rpc("admin_update_helper_link_v2", { p_link: row.id, p_label: row.label || null,
      p_surveys: val("surveys"), p_deposits: val("deposits"), p_support: val("support"), p_members: val("members"), p_active: val("active") });
    if(error){ toast(error.message || "Couldn't save.", "error"); }
    else toast("Saved. It works from their next page load.", "success");
    loadTeam();
  }
  function wireTeamOnce(){
    const pane = document.getElementById("pane-team");
    if(!pane || pane.dataset.wired) return;
    pane.dataset.wired = "1";
    document.getElementById("team-new-form").addEventListener("submit", async e => {
      e.preventDefault(); teamError("");
      const f = e.target, on = k => !!f.querySelector(`[name="${k}"]`).checked;
      if(!on("surveys") && !on("deposits") && !on("support") && !on("members")){ teamError("Turn on at least one thing they can do."); return; }
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true; btn.querySelector(".btn-label").innerHTML = '<span class="spinner"></span>';
      const { data, error } = await sb.rpc("admin_create_helper_link_v2", { p_label: document.getElementById("team-new-label").value.trim() || null,
        p_surveys: on("surveys"), p_deposits: on("deposits"), p_support: on("support"), p_members: on("members") });
      btn.disabled = false; btn.querySelector(".btn-label").textContent = "Make link";
      if(error){ teamError(error.message || "Couldn't make the link."); return; }
      document.getElementById("team-new-label").value = "";
      await loadTeam();
      if(data && data.token){ await vipCopy(teamUrl(data.token)); toast("Link made and copied. Send it to the person.", "success"); }
    });
    document.getElementById("team-list").addEventListener("change", e => {
      const input = e.target.closest("[data-team-set]"); if(!input) return;
      saveTeam(input.closest(".team-card"));
    });
    document.getElementById("team-list").addEventListener("click", async e => {
      const copy = e.target.closest("[data-team-copy]");
      if(copy){ vipCopy(copy.dataset.teamCopy, copy); return; }
      const del = e.target.closest("[data-team-del]"); if(!del) return;
      const row = teamRows.find(x => x.id === del.dataset.teamDel); if(!row) return;
      const ask = row.user_id
        ? `Delete ${row.full_name || "this person"}'s account? They will not be able to sign in again. This cannot be undone.`
        : "Delete this link? Nobody will be able to join with it.";
      if(!confirm(ask)) return;
      del.disabled = true;
      const { data, error } = await sb.rpc("admin_delete_helper", { p_link: row.id });
      if(error){ del.disabled = false; toast(error.message || "Couldn't delete.", "error"); return; }
      const res = data && data.result;
      toast(res === "deleted" ? "Account deleted." : res === "locked" ? "Account closed. It has checked tasks or deposits, so those records stay, but it can never sign in again." : "Link deleted.", "success");
      loadTeam();
    });
  }

  // ---------- VIP links: people who join with one get a VIP account (no verification, no tasks) ----------
  let vipFilter = null;      // show the people of one link only
  let vipLinks = [];
  function vipError(msg){ const el = document.getElementById("vip-admin-err"); if(!el) return; el.textContent = msg || ""; el.style.display = msg ? "block" : "none"; }
  // the main website for members: the admin runs on a sub-address of it (ops-xxxx.yourdomain.com)
  const MAIN_SITE = "https://www.repuven.com/";
  function vipSiteBase(){ return MAIN_SITE; }
  function vipUrl(token){ return vipSiteBase() + "?vip=" + encodeURIComponent(token); }
  async function vipCopy(text, btn){
    let ok = false;
    try{ await navigator.clipboard.writeText(text); ok = true; }
    catch(e){
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try{ ok = document.execCommand("copy"); }catch(_){}
      ta.remove();
    }
    if(btn){
      const label = btn.dataset.label || btn.textContent;
      btn.dataset.label = label;
      btn.textContent = ok ? "Copied!" : "Could not copy";
      setTimeout(() => { btn.textContent = label; }, 1500);
    }
  }
  function vipCard(l){
    const url = vipUrl(l.token);
    const used = Number(l.used_count || 0);
    const max = l.max_uses ? Number(l.max_uses) : null;
    const full = max !== null && used >= max;
    const on = !!l.is_active;
    const state = !on ? "Off" : full ? "Full" : "On";
    return `<div class="vip-card ${on && !full ? "" : "is-off"}">
      <div class="vip-card-top">
        <div class="vip-card-name"><strong>${escapeHtml(l.label || "VIP link")}</strong><span class="vip-state">${state}</span></div>
        <label class="pay-switch" title="Turn this link on or off">
          <input type="checkbox" data-vip-toggle="${escapeHtml(l.id)}" ${on ? "checked" : ""}>
          <span class="pay-switch-track" aria-hidden="true"></span>
          <span class="sr-only">Link is on</span>
        </label>
      </div>
      <div class="vip-card-url"><code>${escapeHtml(url)}</code><button class="btn btn-primary btn-sm" type="button" data-vip-copy="${escapeHtml(url)}">Copy link</button></div>
      <div class="vip-card-meta"><span>${used} joined${max !== null ? " of " + max : ""}</span><span>${Number(l.members || 0)} VIP now</span><span>Made ${fmtDate(l.created_at)}</span></div>
      <div class="vip-card-actions">
        <button class="btn btn-secondary btn-sm" type="button" data-vip-people="${escapeHtml(l.id)}">See people</button>
        <button class="btn btn-ghost btn-sm" type="button" data-vip-remove="${escapeHtml(l.id)}">Remove link</button>
      </div>
    </div>`;
  }
  async function loadVipLinks(){
    vipError("");
    const list = document.getElementById("vip-links-list");
    const { data, error } = await sb.rpc("admin_get_vip_links");
    if(error){
      list.innerHTML = "";
      vipError("Couldn't load VIP links. Run the vip-links.sql file in Supabase once, then refresh. (" + error.message + ")");
      return;
    }
    vipLinks = Array.isArray(data) ? data : [];
    list.innerHTML = vipLinks.length
      ? vipLinks.map(vipCard).join("")
      : '<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-link"/></svg></div>No VIP links yet. Make one above.</div>';
    if(vipFilter && !vipLinks.some(l => l.id === vipFilter)) vipFilter = null;
    loadVipMembers();
  }
  async function loadVipMembers(){
    const wrap = document.getElementById("vip-members-wrap");
    const title = document.getElementById("vip-members-title");
    const all = document.getElementById("vip-members-all");
    const link = vipFilter ? vipLinks.find(l => l.id === vipFilter) : null;
    title.textContent = link ? `People who joined with "${link.label || "VIP link"}"` : "All VIP members";
    all.hidden = !link;
    const { data, error } = await sb.rpc("admin_get_vip_members", { p_link: vipFilter });
    if(error){ wrap.innerHTML = `<div class="empty-state"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-warning"/></svg> ${escapeHtml(error.message || "Couldn't load VIP members.")}</div>`; return; }
    const rows = Array.isArray(data) ? data : [];
    if(!rows.length){ wrap.innerHTML = `<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-star"/></svg></div>${link ? "No one has joined with this link yet." : "No VIP members yet."}</div>`; return; }
    const day = v => { try{ return new Date(v).toLocaleDateString(undefined, { day:"numeric", month:"short", year:"numeric" }); }catch(e){ return fmtDate(v); } };
    wrap.innerHTML = `<table class="tbl vip-members-tbl"><thead><tr><th>Member</th><th>Joined</th><th>Invited</th><th>Verified</th><th>Earned</th><th>Balance</th><th>Link</th><th></th></tr></thead><tbody>${
      rows.map(m => `<tr>
        <td class="vip-member-cell"><b>${escapeHtml(m.full_name || "Member")}</b><small>${escapeHtml(m.email || "—")}</small></td>
        <td>${day(m.joined_at)}</td>
        <td>${Number(m.referrals || 0)}</td>
        <td>${Number(m.verified_referrals || 0)}</td>
        <td>${money(m.referral_earnings || 0)}</td>
        <td>${money(m.balance || 0)}</td>
        <td>${escapeHtml(m.link_label || (m.link_token ? "VIP link" : "—"))}</td>
        <td><button class="btn btn-ghost btn-sm" type="button" data-vip-unvip="${escapeHtml(m.id)}" data-name="${escapeHtml(m.full_name || "this member")}">Remove VIP</button></td>
      </tr>`).join("")
    }</tbody></table>`;
  }
  function wireVipOnce(){
    const pane = document.getElementById("pane-vip");
    if(!pane || pane.dataset.wired) return;
    pane.dataset.wired = "1";
    document.getElementById("vip-new-form").addEventListener("submit", async e => {
      e.preventDefault();
      vipError("");
      const label = document.getElementById("vip-new-label").value.trim();
      const maxRaw = document.getElementById("vip-new-max").value.trim();
      const max = maxRaw ? Math.floor(Number(maxRaw)) : null;
      if(maxRaw && (!max || max < 1)){ vipError("Enter a number of people (1 or more), or leave it empty for no limit."); return; }
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true; btn.querySelector(".btn-label").innerHTML = '<span class="spinner"></span>';
      const { error } = await sb.rpc("admin_create_vip_link", { p_label: label || null, p_max_uses: max });
      btn.disabled = false; btn.querySelector(".btn-label").textContent = "Make VIP link";
      if(error){ vipError(error.message || "Couldn't make the link. Please try again."); return; }
      e.target.reset();
      toast("VIP link made. Tap Copy link and send it.", "success");
      loadVipLinks();
    });
    document.getElementById("vip-members-all").addEventListener("click", () => { vipFilter = null; loadVipMembers(); });
    pane.addEventListener("click", async e => {
      const copyBtn = e.target.closest("[data-vip-copy]");
      if(copyBtn){ vipCopy(copyBtn.dataset.vipCopy, copyBtn); return; }
      const peopleBtn = e.target.closest("[data-vip-people]");
      if(peopleBtn){
        vipFilter = peopleBtn.dataset.vipPeople;
        await loadVipMembers();
        document.querySelector(".vip-admin-members-head")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const removeBtn = e.target.closest("[data-vip-remove]");
      if(removeBtn){
        if(!confirm("Remove this link? It will stop working. People who already joined stay VIP.")) return;
        removeBtn.disabled = true;
        const { error } = await sb.rpc("admin_remove_vip_link", { p_link: removeBtn.dataset.vipRemove });
        removeBtn.disabled = false;
        if(error){ toast(error.message || "Couldn't remove the link.", "error"); return; }
        toast("Link removed.", "success");
        loadVipLinks();
        return;
      }
      const unvipBtn = e.target.closest("[data-vip-unvip]");
      if(unvipBtn){
        if(!confirm(`Remove VIP from ${unvipBtn.dataset.name}? They become a normal member and lose the free verification, so they must verify ($20) before they can take tasks or withdraw.`)) return;
        unvipBtn.disabled = true;
        const { error } = await sb.rpc("admin_set_vip_member", { p_user: unvipBtn.dataset.vipUnvip, p_is_vip: false });
        unvipBtn.disabled = false;
        if(error){ toast(error.message || "Couldn't change this member.", "error"); return; }
        toast("VIP removed.", "success");
        loadVipLinks();
      }
    });
    pane.addEventListener("change", async e => {
      const t = e.target.closest("[data-vip-toggle]");
      if(!t) return;
      const on = t.checked;
      t.disabled = true;
      const { error } = await sb.rpc("admin_set_vip_link_active", { p_link: t.dataset.vipToggle, p_active: on });
      t.disabled = false;
      if(error){ t.checked = !on; toast(error.message || "Couldn't change the link.", "error"); return; }
      toast(on ? "Link is on." : "Link is off. It stops working right away.", "success");
      loadVipLinks();
    });
  }

  // ---------- Investor links: investor accounts and the monthly pool payout ----------
  function invUrl(token){ return vipSiteBase() + "?inv=" + encodeURIComponent(token); }
  function invError(msg){ const el = document.getElementById("inv-admin-err"); if(!el) return; el.textContent = msg || ""; el.style.display = msg ? "block" : "none"; }
  function invDay(s){
    const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { day:"numeric", month:"long", year:"numeric" }) : "—";
  }
  function invPct(n){ return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 3 }) + "%"; }
  function invCard(l){
    const url = invUrl(l.token);
    const used = Number(l.used_count || 0), max = l.max_uses ? Number(l.max_uses) : null;
    const full = max !== null && used >= max, on = !!l.is_active;
    const state = !on ? "Off" : full ? "Full" : "On";
    return `<div class="vip-card ${on && !full ? "" : "is-off"}">
      <div class="vip-card-top">
        <div class="vip-card-name"><strong>${escapeHtml(l.label || "Investor link")}</strong><span class="vip-state">${state}</span></div>
        <label class="pay-switch" title="Turn this link on or off">
          <input type="checkbox" data-inv-toggle="${escapeHtml(l.id)}" ${on ? "checked" : ""}>
          <span class="pay-switch-track" aria-hidden="true"></span>
          <span class="sr-only">Link is on</span>
        </label>
      </div>
      <div class="vip-card-url"><code>${escapeHtml(url)}</code><button class="btn btn-primary btn-sm" type="button" data-inv-copy="${escapeHtml(url)}">Copy link</button></div>
      <div class="vip-card-meta">${l.share_pct != null ? `<span class="inv-pct-tag">${invPct(l.share_pct)} share</span>` : ""}<span>${used} joined${max !== null ? " of " + max : ""}</span><span>${Number(l.members || 0)} investors now</span><span>Made ${fmtDate(l.created_at)}</span></div>
      <div class="vip-card-actions"><button class="btn btn-ghost btn-sm" type="button" data-inv-remove="${escapeHtml(l.id)}">Remove link</button></div>
    </div>`;
  }
  async function loadInvestorsAdmin(){
    const list = document.getElementById("inv-links-list");
    if(!list) return;
    invError("");
    const { data, error } = await sb.rpc("admin_get_investors_overview");
    if(error){ list.innerHTML = ""; invError("Couldn't load investors. (" + (error.message || "error") + ")"); return; }
    const d = data || {};
    document.getElementById("inv-a-pool").textContent = money(d.pool);
    document.getElementById("inv-a-next").textContent = invDay(d.next_payout);
    const given = Number(d.assigned || 0), free = Number(d.free || 0);
    document.getElementById("inv-a-count").textContent = invPct(given);
    document.getElementById("inv-a-count-sub").textContent = invPct(free) + " not given yet";
    document.getElementById("inv-a-each").textContent = money(d.company_now);
    document.getElementById("inv-a-each-sub").textContent = invPct(Math.max(0, 100 - given)) + " of the pool";
    const pctInput = document.getElementById("inv-new-pct");
    if(pctInput){ pctInput.max = String(free || 0); pctInput.placeholder = free > 0 ? "Up to " + invPct(free) : "No % left"; }
    const links = Array.isArray(d.links) ? d.links : [];
    list.innerHTML = links.length ? links.map(invCard).join("")
      : '<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-link"/></svg></div>No investor links yet. Make one above.</div>';
    const people = Array.isArray(d.people) ? d.people : [];
    const pendingLinks = links.filter(l => l.share_pct != null && l.is_active && !(l.max_uses && Number(l.used_count) >= Number(l.max_uses)));
    const segs = people.filter(x => Number(x.pct) > 0).map(x => ({ n: x.name, p: Number(x.pct), k: "" }))
      .concat(pendingLinks.map(l => ({ n: (l.label || "Link") + " (not joined)", p: Number(l.share_pct), k: " is-wait" })));
    document.getElementById("inv-sharebar").innerHTML = `<div class="inv-sb-top"><b>Who holds the 100%</b><span>${invPct(given)} given · ${invPct(free)} with Repuven</span></div>
      <div class="inv-sb-bar">${segs.map((x, i) => `<i class="c${i % 6}${x.k}" style="width:${x.p}%" title="${escapeHtml(x.n)} · ${invPct(x.p)}"></i>`).join("")}</div>
      <div class="inv-sb-keys">${segs.map((x, i) => `<span><i class="c${i % 6}${x.k}"></i>${escapeHtml(x.n)} <b>${invPct(x.p)}</b></span>`).join("")}<span><i class="free"></i>Repuven <b>${invPct(free)}</b></span></div>`;
    document.getElementById("inv-people-count").textContent = people.length ? people.length + (people.length === 1 ? " investor" : " investors") : "";
    const day = v => { try{ return new Date(v).toLocaleDateString("en-US", { day:"numeric", month:"short", year:"numeric" }); }catch(e){ return fmtDate(v); } };
    document.getElementById("inv-people").innerHTML = people.length
      ? `<table class="tbl"><thead><tr><th>Investor</th><th>Share</th><th>Gets now</th><th>Received</th></tr></thead><tbody>${
          people.map(x => `<tr><td class="inv-person"><b>${escapeHtml(x.name)}</b><small>${escapeHtml(x.email || x.code || "")} · joined ${day(x.joined)}</small></td>
            <td><form class="inv-pct-form" data-inv-pct="${escapeHtml(x.id)}"><input class="input" type="number" min="0" max="100" step="0.001" inputmode="decimal" value="${Number(x.pct || 0)}" aria-label="Share % for ${escapeHtml(x.name)}"><span>%</span><button class="btn btn-secondary btn-sm" type="submit">Save</button></form></td>
            <td>${money(x.estimate)}</td><td>${money(x.received)}</td></tr>`).join("")
        }</tbody></table>`
      : '<div class="empty-state">No investors yet. Send an investor link to someone.</div>';
    const pays = Array.isArray(d.payouts) ? d.payouts : [];
    document.getElementById("inv-payouts").innerHTML = pays.length
      ? `<table class="tbl"><thead><tr><th>Month</th><th>Pool</th><th>To investors</th><th>Company kept</th></tr></thead><tbody>${
          pays.map(x => `<tr><td>${escapeHtml(x.month)}</td><td>${money(x.pool)}</td><td>${money(x.paid)}<small class="ib-kind">${Number(x.investors || 0)} paid</small></td><td>${money(x.company)}</td></tr>`).join("")
        }</tbody></table>`
      : '<div class="empty-state">The first payout happens 2 days before this month ends.</div>';
  }
  function wireInvestorsOnce(){
    const box = document.getElementById("inv-admin");
    if(!box || box.dataset.wired) return;
    box.dataset.wired = "1";
    document.getElementById("inv-new-form").addEventListener("submit", async e => {
      e.preventDefault();
      invError("");
      const label = document.getElementById("inv-new-label").value.trim();
      const pct = Number(document.getElementById("inv-new-pct").value);
      if(!(pct > 0) || pct > 100){ invError("Enter the share % for this person, more than 0 and up to 100."); return; }
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true; btn.querySelector(".btn-label").innerHTML = '<span class="spinner"></span>';
      const { error } = await sb.rpc("admin_create_investor_link", { p_label: label || null, p_max_uses: 1, p_pct: pct });
      btn.disabled = false; btn.querySelector(".btn-label").textContent = "Make investor link";
      if(error){ invError(error.message || "Couldn't make the link. Please try again."); return; }
      e.target.reset();
      toast("Investor link made for " + invPct(pct) + ". Tap Copy link and send it to one person.", "success");
      loadInvestorsAdmin();
    });
    box.addEventListener("click", async e => {
      const copyBtn = e.target.closest("[data-inv-copy]");
      if(copyBtn){ vipCopy(copyBtn.dataset.invCopy, copyBtn); return; }
      const removeBtn = e.target.closest("[data-inv-remove]");
      if(removeBtn){
        if(!confirm("Remove this link? It will stop working. People who already joined stay investors.")) return;
        removeBtn.disabled = true;
        const { error } = await sb.rpc("admin_remove_investor_link", { p_link: removeBtn.dataset.invRemove });
        removeBtn.disabled = false;
        if(error){ toast(error.message || "Couldn't remove the link.", "error"); return; }
        toast("Link removed.", "success");
        loadInvestorsAdmin();
      }
    });
    box.addEventListener("submit", async e => {
      const f = e.target.closest("[data-inv-pct]");
      if(!f) return;
      e.preventDefault();
      const v = Number(f.querySelector("input").value);
      if(!(v >= 0) || v > 100){ toast("Enter a share between 0 and 100.", "error"); return; }
      const b = f.querySelector("button"); b.disabled = true;
      const { error } = await sb.rpc("admin_set_investor_share", { p_user: f.dataset.invPct, p_pct: v });
      b.disabled = false;
      if(error){ toast(error.message || "Couldn't save the share.", "error"); return; }
      toast("Share saved: " + invPct(v) + ".", "success");
      loadInvestorsAdmin();
    });
    box.addEventListener("change", async e => {
      const t = e.target.closest("[data-inv-toggle]");
      if(!t) return;
      const on = t.checked;
      t.disabled = true;
      const { error } = await sb.rpc("admin_set_investor_link_active", { p_link: t.dataset.invToggle, p_active: on });
      t.disabled = false;
      if(error){ t.checked = !on; toast(error.message || "Couldn't change the link.", "error"); return; }
      toast(on ? "Link is on." : "Link is off. It stops working right away.", "success");
      loadInvestorsAdmin();
    });
  }

  // ---------- Investors Bank: 16% of what is left from every $20 verification ----------
  async function loadInvestorBank(){
    const err = document.getElementById("ib-err");
    if(!err) return;
    err.style.display = "none";
    const { data, error } = await sb.rpc("admin_get_investor_bank", { p_limit: 500 });
    if(error){
      err.textContent = "Couldn't load the Investors Bank. (" + (error.message || "error") + ")";
      err.style.display = "block";
      document.getElementById("ib-months").innerHTML = "";
      document.getElementById("ib-entries").innerHTML = "";
      return;
    }
    const d = data || {};
    const total = Number(d.total || 0), count = Number(d.count || 0), monthCount = Number(d.month_count || 0);
    const plural = n => n + (n === 1 ? " member" : " members");
    document.getElementById("ib-total").textContent = money(total);
    let since = "";
    if(d.since){ const t = new Date(d.since); if(!isNaN(t)) since = " · counting since " + t.toLocaleDateString("en-US", { day:"numeric", month:"short", year:"numeric" }); }
    const split = (d.from_withdraw != null) ? ` · ${money(d.from_verify || 0)} from verifications, ${money(d.from_withdraw || 0)} from withdrawal fees${d.from_transfer != null ? `, ${money(d.from_transfer || 0)} from transfer fees` : ""}` : "";
    document.getElementById("ib-sub").textContent = "What is left of every $20 after member bonuses and " + money(d.mgmt != null ? d.mgmt : 4) + " website management, plus every withdrawal and transfer fee" + split + since;
    document.getElementById("ib-month").textContent = money(d.month_total);
    // withdrawal fees are their own lines: members and the average count verifications only
    const wdCount = Number(d.withdraw_count || 0) + Number(d.transfer_count || 0), vCount = Math.max(0, count - wdCount);
    const vTotal = d.from_verify != null ? Number(d.from_verify) : total;
    document.getElementById("ib-month-count").textContent = monthCount + (monthCount === 1 ? " payment" : " payments");
    document.getElementById("ib-count").textContent = vCount;
    document.getElementById("ib-avg").textContent = money(vCount ? vTotal / vCount : 0);

    const months = Array.isArray(d.months) ? d.months : [];
    const top = Math.max(0.01, ...months.map(m => Number(m.amount || 0)));
    document.getElementById("ib-months").innerHTML = months.length
      ? months.map(m => {
          const [y, mo] = String(m.month || "").split("-").map(Number);
          const name = y && mo ? new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month:"long", year:"numeric" }) : String(m.month || "");
          const pct = Math.max(4, Number(m.amount || 0) / top * 100);
          return `<div class="ib-month"><div class="ib-month-top"><span>${escapeHtml(name)}</span><b>${money(m.amount)}</b></div><div class="ib-month-bar"><i style="width:${pct.toFixed(1)}%"></i></div><small>${plural(Number(m.count || 0))}</small></div>`;
        }).join("")
      : `<div class="ib-empty">Nothing yet. The first verification or withdrawal fee will show here.</div>`;

    const rows = Array.isArray(d.entries) ? d.entries : [];
    document.getElementById("ib-entries-count").textContent = rows.length ? plural(rows.length) : "";
    document.getElementById("ib-entries").innerHTML = rows.length
      ? `<table class="tbl ib-tbl"><thead><tr><th>Date</th><th>Member</th><th>Paid</th><th>Inviter</th><th>Above inviter</th><th>Leaders</th><th>Left over</th><th>To pool</th></tr></thead><tbody>${
          rows.map(r => r.source === "WITHDRAWAL" || r.source === "TRANSFER" ? `<tr class="ib-wd">
            <td>${fmtDate(r.created_at)}</td>
            <td class="ib-member"><b>${escapeHtml(r.name || "Member")}</b><small>${escapeHtml(r.email || r.code || "")}</small></td>
            <td>${money(r.price)}<small class="ib-kind">${r.source === "TRANSFER" ? "Transfer fee (2%)" : "Withdrawal fee"}</small></td>
            <td class="ib-out">—</td>
            <td class="ib-out">—</td>
            <td class="ib-out">—</td>
            <td>${money(r.remainder)}</td>
            <td class="ib-in">+${money(r.amount)}</td>
          </tr>` : `<tr>
            <td>${fmtDate(r.created_at)}</td>
            <td class="ib-member"><b>${escapeHtml(r.name || "Member")}</b><small>${escapeHtml(r.email || r.code || "")}</small></td>
            <td>${money(r.price)}<small class="ib-kind">Verification</small></td>
            <td class="ib-out">${Number(r.direct_bonus) ? "−" + money(r.direct_bonus) : "—"}</td>
            <td class="ib-out">${Number(r.upline_bonus) ? "−" + money(r.upline_bonus) : "—"}</td>
            <td class="ib-out">${(Number(r.leader_bonus) || 0) + (Number(r.leader_pool) || 0) ? "−" + money((Number(r.leader_bonus) || 0) + (Number(r.leader_pool) || 0)) : "—"}</td>
            <td>${money(r.remainder)}</td>
            <td class="ib-in">+${money(r.amount)}</td>
          </tr>`).join("")
        }</tbody></table>`
      : `<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-bank"/></svg></div>Nothing yet. When a member verifies with $20 or a withdrawal is approved, the share shows here.</div>`;
  }

  // ---------- Leadership: leader levels and the monthly Leader Pool ----------
  const LDR_LEVELS = ["", "Bronze Leader", "Silver Leader", "Gold Leader", "Platinum Leader", "Diamond Leader"];
  function ldrBadge(lvl, cls, locked){
    const n = Math.max(1, Math.min(5, Number(lvl) || 1));
    return `<svg class="ldr-badge${cls ? " " + cls : ""}${locked ? " is-locked" : ""}" viewBox="0 0 48 48" role="img" aria-label="${LDR_LEVELS[n]}" focusable="false"><title>${LDR_LEVELS[n]}</title><use href="#ldr-b${n}"></use></svg>`;
  }
  const ldrChip = lvl => Number(lvl) >= 1 ? ldrBadge(lvl, "ldr-badge-sm") : "";
  function ldrDay(s, opts){
    const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(!m) return "—";
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", opts || { month: "short", day: "numeric" });
  }

  async function loadLeadershipAdmin(){
    const err = document.getElementById("lp-err");
    if(!err) return;
    err.style.display = "none";
    const { data, error } = await sb.rpc("admin_get_leadership");
    if(error){
      err.textContent = "Couldn't load Leadership. (" + (error.message || "error") + ")";
      err.style.display = "block";
      ["lp-leaders-list", "lp-rising", "lp-payouts"].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = ""; });
      return;
    }
    const d = data || {};
    const levels = Array.isArray(d.levels) ? d.levels : [];
    const leaders = Array.isArray(d.leaders) ? d.leaders : [];
    const rising = Array.isArray(d.rising) ? d.rising : [];
    const payouts = Array.isArray(d.payouts) ? d.payouts : [];
    const plural = (n, one, many) => n + " " + (Number(n) === 1 ? one : many);

    // the pool and the numbers next to it
    document.getElementById("lp-pool").textContent = money(d.pool);
    let since = "";
    if(d.since){ const t = new Date(d.since); if(!isNaN(t)) since = " Started " + t.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) + "."; }
    document.getElementById("lp-sub").textContent = "5% of every $20 verification. Shared among all leaders 2 days before each month ends." + since;
    document.getElementById("lp-next").textContent = ldrDay(d.payout_day);
    const left = (() => {
      const a = String(d.payout_day || "").match(/^(\d{4})-(\d{2})-(\d{2})/), b = String(d.today || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
      if(!a || !b) return null;
      return Math.round((Date.UTC(+a[1], +a[2] - 1, +a[3]) - Date.UTC(+b[1], +b[2] - 1, +b[3])) / 86400000);
    })();
    document.getElementById("lp-next-sub").textContent = left === null ? "Bangladesh time" : left <= 0 ? "Today, Bangladesh time" : left === 1 ? "Tomorrow, Bangladesh time" : "In " + left + " days, Bangladesh time";
    document.getElementById("lp-month").textContent = money(d.month_in);
    document.getElementById("lp-month-sub").textContent = plural(Number(d.month_count) || 0, "verification", "verifications");
    const shares = leaders.filter(x => !x.paused).reduce((s, x) => s + (Number(x.level) || 0), 0);
    document.getElementById("lp-leaders").textContent = leaders.length;
    document.getElementById("lp-leaders-sub").textContent = plural(shares, "share", "shares") + " in total";
    document.getElementById("lp-held").textContent = money(d.held_total);

    // the five levels
    document.getElementById("lp-levels").innerHTML = levels.map(l => `<div class="lp-level">
        ${ldrBadge(l.level, "", !Number(l.count))}
        <b>${escapeHtml(l.name)}</b>
        <small>${l.required} verified · ${plural(l.shares, "share", "shares")}</small>
        <em>${plural(Number(l.count) || 0, "member", "members")}</em>
      </div>`).join("");

    // leaders
    document.getElementById("lp-leaders-count").textContent = leaders.length ? plural(leaders.length, "leader", "leaders") : "";
    document.getElementById("lp-leaders-list").innerHTML = leaders.length
      ? `<table class="tbl lp-tbl"><thead><tr><th>Leader</th><th>Level</th><th>Verified</th><th>Bonus waiting</th><th>Leader income</th><th>Leader since</th></tr></thead><tbody>${
          leaders.map(x => `<tr>
            <td><div class="lp-who">${ldrBadge(x.level)}<div><b>${escapeHtml(x.name || "Member")}${x.is_vip ? ' <span class="lp-tag">VIP</span>' : ""}${x.paused ? ' <span class="lp-tag is-warn">Paused</span>' : ""}</b><small>${escapeHtml(x.code || "")}</small></div></div></td>
            <td>${escapeHtml(LDR_LEVELS[Number(x.level)] || "")}</td>
            <td>${Number(x.verified) || 0}</td>
            <td>${money(x.held)}</td>
            <td>${money(x.income_paid)}</td>
            <td>${x.level_since ? escapeHtml(new Date(x.level_since).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })) : "—"}</td>
          </tr>`).join("")
        }</tbody></table>`
      : `<div class="ib-empty">No leaders yet. A member becomes a Bronze Leader when 10 people they invited have verified.</div>`;

    // members getting close
    const firstReq = Number((levels[0] || {}).required) || 10;
    document.getElementById("lp-rising").innerHTML = rising.length
      ? rising.map(x => {
          const v = Number(x.verified) || 0, pct = Math.max(3, Math.min(100, v / firstReq * 100));
          return `<div class="lp-rise">
            ${ldrBadge(1, "", true)}
            <div class="lp-rise-main"><b>${escapeHtml(x.name || "Member")}</b><small>${escapeHtml(x.code || "")}</small><div class="lp-rise-bar"><i style="width:${pct.toFixed(1)}%"></i></div></div>
            <span><b>${v} / ${firstReq}</b>${money(x.held)} waiting</span>
          </div>`;
        }).join("")
      : `<div class="ib-empty">When members get people verified, they show up here.</div>`;

    // payouts
    const paidTotal = payouts.reduce((s, p) => s + (Number(p.paid) || 0), 0);
    document.getElementById("lp-paid-total").textContent = payouts.length ? money(paidTotal) + " paid so far" : "";
    document.getElementById("lp-payouts").innerHTML = payouts.length
      ? `<table class="tbl lp-tbl"><thead><tr><th>Month</th><th>Paid on</th><th>Pool</th><th>Paid out</th><th>Leaders</th><th>Shares</th><th>Carried over</th></tr></thead><tbody>${
          payouts.map(p => `<tr>
            <td><b>${escapeHtml(ldrDay(p.month, { month: "long", year: "numeric" }))}</b></td>
            <td>${p.paid_at ? fmtDate(p.paid_at) : "—"}</td>
            <td>${money(p.pool)}</td>
            <td class="ib-in">${money(p.paid)}</td>
            <td>${Number(p.leaders) || 0}</td>
            <td>${Number(p.shares) || 0}</td>
            <td>${money(p.carried_over)}</td>
          </tr>`).join("")
        }</tbody></table>`
      : `<div class="ib-empty">No payouts yet. The first one is on ${escapeHtml(ldrDay(d.payout_day, { month: "long", day: "numeric" }))}, and it happens by itself.</div>`;
  }

  // ---------- Announcements: a pop-up members see after they log in ----------
  let annWired = false, annFile = null, annMinutes = 1440, annPreviewUrl = null, annTick = null;
  function annError(msg){ const el = document.getElementById("an-err"); if(!el) return; el.textContent = msg || ""; el.style.display = msg ? "block" : "none"; }
  function annDuration(){
    if(annMinutes !== "custom") return annMinutes;
    const n = Math.floor(Number(document.getElementById("an-custom-n").value || 0));
    const u = Number(document.getElementById("an-custom-u").value || 60);
    return n > 0 ? n * u : 0;
  }
  function annWhen(d){ const t = new Date(d); return t.toLocaleDateString("en-US", { month:"short", day:"numeric" }) + ", " + t.toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit" }); }
  function annLeft(ends){
    const ms = new Date(ends) - Date.now();
    if(ms <= 0) return "Ending now";
    const m = Math.ceil(ms / 60000);
    if(m < 60) return m + " min left";
    const h = Math.floor(m / 60);
    if(h < 48) return h + "h " + (m % 60) + "m left";
    return Math.floor(h / 24) + " days " + (h % 24) + "h left";
  }
  function annPreview(){
    const title = document.getElementById("an-title").value.trim();
    const body = document.getElementById("an-body").value.trim();
    document.getElementById("an-title-count").textContent = document.getElementById("an-title").value.length;
    document.getElementById("an-pv-title").textContent = title || "Your title";
    document.getElementById("an-pv-body").textContent = body || "Your description shows here.";
    const mins = annDuration();
    document.getElementById("an-ends").textContent = mins ? "Shows until " + annWhen(Date.now() + mins * 60000) + ", then it disappears by itself." : "Enter how long it should stay.";
    document.getElementById("an-pv-until").textContent = mins ? "Until " + annWhen(Date.now() + mins * 60000) : "";
  }
  function annSetFile(file){
    annFile = file || null;
    if(annPreviewUrl){ URL.revokeObjectURL(annPreviewUrl); annPreviewUrl = null; }
    const img = document.getElementById("an-drop-img"), empty = document.getElementById("an-drop-empty");
    const pvMedia = document.getElementById("an-pv-media"), pvImg = document.getElementById("an-pv-img");
    if(annFile){
      annPreviewUrl = URL.createObjectURL(annFile);
      img.src = annPreviewUrl; img.hidden = false; empty.hidden = true;
      pvImg.src = annPreviewUrl; pvMedia.hidden = false;
    } else {
      img.removeAttribute("src"); img.hidden = true; empty.hidden = false;
      pvImg.removeAttribute("src"); pvMedia.hidden = true;
      document.getElementById("an-file").value = "";
    }
    document.getElementById("an-file-clear").hidden = !annFile;
  }
  function wireAnnouncementsOnce(){
    if(annWired) return;
    annWired = true;
    const fileInput = document.getElementById("an-file");
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      annError("");
      if(!f) return;
      if(!/^image\/(jpeg|png|webp)$/.test(f.type)){ annError("Please choose a JPG, PNG or WebP picture."); fileInput.value = ""; return; }
      if(f.size > 5 * 1024 * 1024){ annError("This picture is bigger than 5 MB. Please choose a smaller one."); fileInput.value = ""; return; }
      annSetFile(f);
    });
    document.getElementById("an-file-clear").addEventListener("click", () => annSetFile(null));
    ["an-title", "an-body", "an-custom-n", "an-custom-u"].forEach(id => document.getElementById(id).addEventListener("input", annPreview));
    document.getElementById("an-custom-u").addEventListener("change", annPreview);
    document.querySelectorAll("#an-chips .an-chip").forEach(chip => chip.addEventListener("click", () => {
      document.querySelectorAll("#an-chips .an-chip").forEach(c => { const on = c === chip; c.classList.toggle("is-on", on); c.setAttribute("aria-checked", on ? "true" : "false"); });
      annMinutes = chip.dataset.min === "custom" ? "custom" : Number(chip.dataset.min);
      document.getElementById("an-custom").hidden = annMinutes !== "custom";
      annPreview();
    }));
    document.getElementById("an-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      annError("");
      const title = document.getElementById("an-title").value.trim();
      const body = document.getElementById("an-body").value.trim();
      const mins = annDuration();
      if(!title){ annError("Please add a title."); document.getElementById("an-title").focus(); return; }
      if(!mins || mins < 5){ annError("It needs to stay for at least 5 minutes."); return; }
      if(mins > 129600){ annError("It can stay for up to 90 days."); return; }
      const btn = document.getElementById("an-submit");
      btn.disabled = true; btn.querySelector(".btn-label").innerHTML = '<span class="spinner"></span> Publishing…';
      try{
        let imageUrl = null;
        if(annFile) imageUrl = await uploadPublicImage(annFile, "announcements");
        const { error } = await sb.rpc("admin_create_announcement", { p_title: title, p_body: body, p_image_url: imageUrl, p_minutes: Math.round(mins) });
        if(error) throw error;
        document.getElementById("an-form").reset();
        annSetFile(null);
        annMinutes = 1440;
        document.querySelectorAll("#an-chips .an-chip").forEach(c => { const on = c.dataset.min === "1440"; c.classList.toggle("is-on", on); c.setAttribute("aria-checked", on ? "true" : "false"); });
        document.getElementById("an-custom").hidden = true;
        annPreview();
        toast("Announcement published. Members will see it after they log in.", "success");
        await loadAnnouncements();
      }catch(err){
        annError(String((err && err.message) || "Could not publish the announcement.").replace(/^Postgres error:\s*/i, ""));
      }finally{
        btn.disabled = false; btn.querySelector(".btn-label").textContent = "Publish announcement";
      }
    });
    annPreview();
  }
  async function loadAnnouncements(){
    const list = document.getElementById("an-list");
    if(!list) return;
    const { data, error } = await sb.rpc("admin_get_announcements", { p_limit: 50 });
    if(error){ list.innerHTML = ""; annError("Couldn't load announcements. (" + error.message + ")"); return; }
    const rows = Array.isArray(data) ? data : [];
    document.getElementById("an-list-count").textContent = rows.length ? rows.length + (rows.length === 1 ? " announcement" : " announcements") : "";
    list.innerHTML = rows.length ? rows.map(a => `
      <div class="an-item">
        <div class="an-item-media">${a.image_url ? `<img src="${escapeHtml(a.image_url)}" alt="" loading="lazy">` : `<svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-broadcast"/></svg>`}</div>
        <div class="an-item-main">
          <div class="an-item-top"><strong>${escapeHtml(a.title)}</strong><span class="an-live">Live</span></div>
          ${a.body ? `<p>${escapeHtml(a.body)}</p>` : ""}
          <div class="an-item-meta"><span data-an-left="${escapeHtml(a.ends_at)}">${annLeft(a.ends_at)}</span><span>Ends ${annWhen(a.ends_at)}</span></div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm an-remove" data-an-remove="${escapeHtml(a.id)}">Take down</button>
      </div>`).join("")
      : `<div class="empty-state"><div class="icon"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#i-broadcast"/></svg></div>Nothing is running. Publish an announcement above.</div>`;
    list.querySelectorAll("[data-an-remove]").forEach(b => b.addEventListener("click", async () => {
      if(!confirm("Take this announcement down now? Members will stop seeing it.")) return;
      b.disabled = true;
      const { error: err } = await sb.rpc("admin_remove_announcement", { p_id: b.dataset.anRemove });
      if(err){ b.disabled = false; toast(err.message || "Could not take it down.", "error"); return; }
      toast("Announcement taken down.", "success");
      await loadAnnouncements();
    }));
    clearInterval(annTick);
    annTick = setInterval(() => {
      if(!document.getElementById("pane-announcements") || !document.getElementById("pane-announcements").offsetParent){ clearInterval(annTick); return; }
      let ended = false;
      document.querySelectorAll("[data-an-left]").forEach(el => { el.textContent = annLeft(el.dataset.anLeft); if(new Date(el.dataset.anLeft) <= Date.now()) ended = true; });
      if(ended) loadAnnouncements();
      annPreview();
    }, 30000);
  }

  const loaders = {
    overview: loadOverview, articles: loadArticles, products: loadProducts, usertasks: loadUserTasks,
    submissions: loadSubmissions, verifications: loadVerifications, withdrawals: loadWithdrawals, deposits: loadDeposits,
    mailbox: loadMailbox,
    support: ()=>{initSupportAdmin();},
    livechat: ()=>{initPublicLivechatAdmin();},
    payments: ()=>{wirePaymentsOnce();loadPaymentMethods();},
    social: ()=>{loadSocialAdmin();},
    transactions: ()=>{wireTxOnce();loadTx(true);},
    vip: ()=>{wireVipOnce();loadVipLinks();},
    team: ()=>{wireTeamOnce();loadTeam();},
    members: ()=>{wireMembersOnce();loadMembers(true);},
    referrals: ()=>{wireRefsOnce();loadRefs(true);},
    investors: ()=>{loadInvestorBank(); wireInvestorsOnce(); loadInvestorsAdmin();},
    leadership: ()=>{loadLeadershipAdmin();},
    announcements: ()=>{wireAnnouncementsOnce();loadAnnouncements();},
    leaderboard: ()=>{initPrizeAdmin();}
  };

  wireTabsOnce();

  function init(sub){ wireMailbox(); wireSupport(); wireLivechatAdmin(); renderTab(tabs.includes(sub) ? sub : firstTab()); if(canTab("support")) loadSupportThreads(); if(!window.__ssAdminSupportTimer) window.__ssAdminSupportTimer=setInterval(()=>{ if(AppState.isAdmin && !supVisible()) loadSupportThreads(); },15000); }
  function onActivate(sub){ wireMailbox(); wireSupport(); wireLivechatAdmin(); renderTab(tabs.includes(sub) ? sub : firstTab()); }

  return { init, onActivate };
})();

/* ---------------- boot ---------------- */
async function boot(){
  await loadAppState();
  if(AppState.session){ renderSidebar(); }
  hydrateSiteLogoAvatars(document);
  wireShellChrome();
  initLandingTheme();
  const recoveryHandled = await handlePasswordRecoveryHash();

  supabase.auth.onAuthStateChange(async (event, session) => {
    if(event === "INITIAL_SESSION") return;
    if(event === "PASSWORD_RECOVERY"){
      if(window.__ssRecoveryHandled) return;
      await loadAppState();
      showTopLevel("auth");
      AuthModule.activate("newpass", new URLSearchParams());
      window.__ssRecoveryHandled=true;
      return;
    }
    const wasLoggedIn = !!AppState.session;
    await loadAppState();
    if(event === "SIGNED_IN" && !wasLoggedIn){
      try { await supabase.rpc("ensure_super_survey_profile"); } catch(e) {
        console.error("Repuven auth provisioning failed:", e);
        toast(e.message || "Account setup could not be completed.", "error");
        return;
      }
      await loadAppState();
      renderSidebar();
      if(!isAuthCallbackHash()) Router.go("admin/" + firstTab());
    }
    if(event === "SIGNED_OUT"){
      Router.go("");
    }
  });

  window.addEventListener("hashchange", route);
  if(!recoveryHandled) await route();
}
boot().catch(e => console.error(e)).finally(() => document.documentElement.classList.remove("rv-booting"));

} // end of runApp()

/* ---------------- entry point ---------------- */
runApp().then(() => { try{ sessionStorage.removeItem("srv-reload"); }catch(_){} }).catch((e) => { console.error("Repuven: runApp() crashed —", e); window.__srvAppFailed = true; showFatalLoadError(); });
