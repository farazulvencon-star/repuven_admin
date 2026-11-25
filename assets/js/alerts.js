/* Makes every error message easy to notice: when one appears it gets a short shake,
   is read out by screen readers, scrolls into view if it is off screen, and the
   input next to it is outlined in red. */
(function(){
  const SEL = ".field.error, .field .error, div.error, .auth-status.error, .pc-msg.is-bad";
  const shown = new WeakMap();
  function visible(el){ return el.textContent.trim() !== "" && el.style.display !== "none" && el.offsetParent !== null; }
  function relatedInput(el){
    const f = el.closest(".field"); if(f && !f.classList.contains("error")){ const i = f.querySelector("input,textarea,select"); if(i) return i; }
    const prev = el.previousElementSibling; if(prev && prev.matches && prev.matches("input,textarea,select")) return prev;
    return null;
  }
  function check(el){
    const text = el.textContent.trim();
    const on = visible(el);
    const was = shown.get(el);
    const inp = relatedInput(el);
    if(!on){ shown.delete(el); if(inp) inp.classList.remove("is-invalid"); return; }
    if(was === text) return;
    shown.set(el, text);
    el.setAttribute("role", "alert");
    el.classList.remove("err-shake"); void el.offsetWidth; el.classList.add("err-shake");
    if(inp){ inp.classList.add("is-invalid"); inp.addEventListener("input", () => inp.classList.remove("is-invalid"), { once:true }); }
    const r = el.getBoundingClientRect();
    if(r.top < 60 || r.bottom > window.innerHeight - 20) el.scrollIntoView({ behavior:"smooth", block:"center" });
  }
  let queued = false;
  function scan(){ queued = false; document.querySelectorAll(SEL).forEach(check); }
  const mo = new MutationObserver(() => { if(!queued){ queued = true; requestAnimationFrame(scan); } });
  function start(){ mo.observe(document.body, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:["style","class","hidden"] }); }
  if(document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
