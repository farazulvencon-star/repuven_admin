/* =====================================================================
   ChatKit: the shared look and behaviour of every chat on the site
   (Support, Live Chat, private chats, and the same chats in the admin panel).
   ===================================================================== */
var ChatKit = window.ChatKit = (function(){
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

  // web addresses in a message become links (the text is escaped first, so nothing else can sneak in)
  function linkify(escaped){
    return escaped.replace(/\bhttps?:\/\/(?:(?!&(?:lt|gt|quot|#39);)[^\s])+/g, u => {
      let tail = "";
      while(/[.,!?;:)\]]$/.test(u)){ tail = u.slice(-1) + tail; u = u.slice(0, -1); }
      return `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>${tail}`;
    });
  }

  const dayKey = d => { const x = new Date(d); return x.getFullYear() + "-" + x.getMonth() + "-" + x.getDate(); };
  function dayLabel(d){
    const x = new Date(d), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if(dayKey(x) === dayKey(now)) return "Today";
    if(dayKey(x) === dayKey(y)) return "Yesterday";
    return x.toLocaleDateString("en-US", x.getFullYear() === now.getFullYear() ? { weekday:"short", month:"short", day:"numeric" } : { month:"short", day:"numeric", year:"numeric" });
  }
  const timeLabel = d => new Date(d).toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit" });
  function ago(d){
    const t = new Date(d), s = (Date.now() - t.getTime()) / 1000;
    if(s < 60) return "now";
    if(s < 3600) return Math.floor(s / 60) + "m";
    if(dayKey(t) === dayKey(new Date())) return timeLabel(t);
    if(s < 6 * 86400) return dayLabel(t) === "Yesterday" ? "Yesterday" : t.toLocaleDateString("en-US", { weekday:"short" });
    return t.toLocaleDateString("en-US", { month:"short", day:"numeric" });
  }
  const initials = n => (String(n || "M").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("") || "M").toUpperCase();
  function tone(n){ let h = 0; for(const c of String(n || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 6; }
  function avatar(o){
    o = o || {};
    const cls = "ck-ava" + (o.size ? " ck-ava-" + o.size : "");
    if(o.logo !== undefined) return `<span class="${cls} ck-ava-logo">${o.logo ? `<img src="${esc(o.logo)}" alt="">` : "RV"}</span>`;
    if(o.url) return `<span class="${cls}"><img src="${esc(o.url)}" alt=""></span>`;
    return `<span class="${cls}" data-tone="${tone(o.name)}">${esc(initials(o.name))}</span>`;
  }

  const TICK1 = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.4 2.9 2.8 6-6.4"/></svg>';
  const TICK2 = '<svg viewBox="0 0 20 16" aria-hidden="true"><path d="M1.6 8.4 5 11.6l6.4-7"/><path d="m8.6 10.8.8.8 6.4-7"/></svg>';
  const CLOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 5.2V8l1.8 1.2"/></svg>';

  // one message; "last" shapes the corner next to the avatar
  function bubble(m, last){
    const tick = m.status === "seen" ? `<span class="ck-tick seen" title="Seen">${TICK2}</span>`
      : m.status === "sent" ? `<span class="ck-tick" title="Sent">${TICK1}</span>`
      : m.status === "sending" ? `<span class="ck-tick" title="Sending">${CLOCK}</span>` : "";
    const meta = `<span class="ck-meta">${m.edited ? "edited · " : ""}${esc(timeLabel(m.at))}${tick}</span>`;
    const tag = m.auto ? `<span class="ck-autotag">Instant answer</span>` : "";
    return `<div class="ck-row" data-mid="${esc(m.id || "")}"><div class="ck-bubble${last ? " is-last" : ""}">${tag}<span class="ck-text">${linkify(esc(m.text))}</span>${meta}</div>${m.tools || ""}</div>`;
  }

  // messages from one person in a row (within 5 minutes) sit together, under one name and one avatar
  function render(list, o){
    o = o || {};
    let html = "", lastDay = null, i = 0;
    while(i < list.length){
      const f = list[i], dk = dayKey(f.at);
      if(dk !== lastDay){ html += `<div class="ck-day"><span>${esc(dayLabel(f.at))}</span></div>`; lastDay = dk; }
      let j = i + 1;
      while(j < list.length && list[j].who === f.who && !!list[j].auto === !!f.auto && dayKey(list[j].at) === dk
            && new Date(list[j].at) - new Date(list[j - 1].at) < 5 * 60e3) j++;
      const g = list.slice(i, j);
      const name = !f.mine && o.names ? `<div class="ck-name">${esc(f.name)}${f.badge ? `<span class="ck-badge">${esc(f.badge)}</span>` : ""}</div>` : "";
      html += `<div class="ck-group ${f.mine ? "mine" : "theirs"}${f.auto ? " is-auto" : ""}">`
        + (f.mine ? "" : `<div class="ck-ava-col">${avatar(f.avatar || { name: f.name })}</div>`)
        + `<div class="ck-stack">${name}${g.map((m, k) => bubble(m, k === g.length - 1)).join("")}</div></div>`;
      i = j;
    }
    return html;
  }

  function typing(av){
    return `<div class="ck-group theirs is-typing"><div class="ck-ava-col">${avatar(av)}</div><div class="ck-stack"><div class="ck-row"><div class="ck-bubble is-last"><span class="ck-dots" aria-label="Typing"><i></i><i></i><i></i></span></div></div></div></div>`;
  }

  // repaint only when something changed, and keep the reader's place unless they were at the bottom
  function paint(box, html, opt){
    opt = opt || {};
    if(!box) return false;
    if(opt.key && box.dataset.ckKey === opt.key && !opt.force) return false;
    const first = !box.dataset.ckKey;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    box.innerHTML = html;
    box.dataset.ckKey = opt.key || String(Date.now());
    if(first || nearBottom || opt.bottom) box.scrollTop = box.scrollHeight;
    return true;
  }

  function empty(icon, title, text){
    return `<div class="ck-empty"><span class="ck-empty-ico"><svg class="icon-glyph" viewBox="0 0 24 24"><use href="#${esc(icon)}"/></svg></span><b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ""}</div>`;
  }

  // composer: grows with the text, Enter sends (Shift+Enter for a new line), send button off when empty
  function composer(form, onSend, o){
    o = o || {};
    if(!form || form.dataset.ckWired) return;
    form.dataset.ckWired = "1";
    const input = form.querySelector("textarea"), btn = form.querySelector("button[type=submit]");
    const count = form.querySelector(".ck-count"), max = o.max || 2000;
    const fit = () => {
      input.style.height = "auto";
      const h = input.scrollHeight;   // 0 while the form is hidden: keep the natural height then
      if(h) input.style.height = Math.min(Math.max(h, 38), o.maxHeight || 148) + "px";
      const n = input.value.length;
      if(btn) btn.disabled = !input.value.trim() || form.classList.contains("is-busy");
      if(count){ count.textContent = (max - n) + " left"; count.hidden = n < max - 300; }
    };
    input.addEventListener("input", fit);
    input.addEventListener("keydown", e => {
      if(e.key === "Enter" && !e.shiftKey && !e.isComposing && !(o.touchNewline && matchMedia("(hover: none)").matches)){
        e.preventDefault(); form.requestSubmit();
      }
    });
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const text = input.value.trim();
      if(!text || form.classList.contains("is-busy")) return;
      form.classList.add("is-busy"); fit();
      let ok = false;
      try{ ok = await onSend(text); }catch(err){ ok = false; }
      form.classList.remove("is-busy");
      if(ok !== false){ input.value = ""; }
      fit();
      if(ok !== false && !matchMedia("(hover: none)").matches) input.focus();
    });
    form.ckFit = fit;
    fit();
  }

  // the chat fills the screen: the page itself does not scroll, the messages do
  function fill(el, o){
    if(!el) return;
    const go = () => {
      if(!el.offsetParent){ return; }
      const top = el.getBoundingClientRect().top + window.scrollY;
      const h = Math.max(o && o.min || 420, window.innerHeight - top - (o && o.gap != null ? o.gap : 20));
      el.style.height = h + "px";
    };
    go();
    if(!el.dataset.ckFill){ el.dataset.ckFill = "1"; window.addEventListener("resize", go); }
    return go;
  }

  return { esc, linkify, render, typing, paint, empty, composer, avatar, ago, timeLabel, dayLabel, fill, initials };
})();
