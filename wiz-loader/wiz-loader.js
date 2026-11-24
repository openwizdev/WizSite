(()=>{
'use strict';
const D=document,S='<svg viewBox="28 15 456 456" aria-hidden="true"><path class="wl-f" d="M132 234Q132 210 158 210H354Q380 210 380 236V293C380 322 368 345 348 358H164C144 344 132 322 132 293Z"/><path class="wl-b" d="M148 325C151 362 164 390 186 410L207 391L228 438L247 405L264 461L283 405L304 438L325 391L346 410C368 388 379 358 380 325C351 346 324 353 294 353H220C192 353 167 345 148 325Z"/><g class="wl-k"><circle cx="219" cy="278" r="30"/><circle cx="291" cy="278" r="30"/><path d="M190 323Q190 312 202 312H310Q322 312 322 324V342Q322 354 310 354H202Q190 354 190 342Z"/></g><g class="wl-e"><circle cx="230" cy="273" r="8"/><circle cx="280" cy="284" r="8"/></g><path class="wl-m" d="M220 313V353H228V313ZM252 313V353H260V313ZM284 313V353H292V313Z"/><g class="wl-c"><path class="wl-h" d="M154 222L228 81C249 40 281 25 313 30C357 36 385 73 384 111C383 139 367 154 350 145C336 138 342 110 323 96C307 84 288 91 278 106L328 222Z"/><path class="wl-h" d="M96 210Q96 190 117 190H395Q416 190 416 210V228Q416 246 397 246H115Q96 246 96 228Z"/></g></svg>';
const L=['Wizes are brewing your specs','Herding agents','Checking every ticket','Reading your repo','Polishing the hats','Asking the reviewers nicely','Untangling the branches','Warming up the Ember','Combing the beards','Lining up the conga','Double-checking the diffs','Still here, still dancing'];
const M=new WeakMap(),q=(e,s)=>e.querySelector(s),sa=(e,a,v)=>e.setAttribute(a,v);
const wiz=i=>{const s=D.createElement('span');s.className='wl-w wl-'+i+(i?' wl-in':'');s.innerHTML=S;return s};
function markup(c){
  const d=D.createElement('div');
  d.className='wiz-loader'+(c?' wl-sm':'');
  sa(d,'data-wiz-loader',c?'compact':'');sa(d,'role','status');
  d.innerHTML='<span class="wl-sr">Loading</span><div class="wl-s" aria-hidden="true"><div class="wl-l"></div></div><p class="wiz-loader-line" aria-live="polite">Opening OpenWiz</p>';
  q(d,'.wl-l').append(wiz(0));return d;
}
function mount(el,o={}){
  if(!el)return{stop(){}};
  if(M.has(el))M.get(el).stop();
  const cl=el.classList,sm=o.compact!=null?!!o.compact:el.getAttribute('data-wiz-loader')==='compact'||cl.contains('wl-sm');
  cl.add('wiz-loader');if(sm)cl.add('wl-sm');
  if(!el.getAttribute('role'))sa(el,'role','status');
  if(!q(el,'.wl-l')){const p=q(el,'.wiz-loader-line'),t=p?p.textContent:'Opening OpenWiz';el.replaceChildren(...markup(sm).childNodes);q(el,'.wiz-loader-line').textContent=t}
  const st=q(el,'.wl-s'),rw=q(el,'.wl-l'),cp=q(el,'.wiz-loader-line'),ls=o.lines?.length?o.lines:L,rd=!!matchMedia?.('(prefers-reduced-motion:reduce)').matches,ts=new Set();
  let dead=0,ix=0;
  function stop(){if(dead)return;dead=1;ts.forEach(i=>{clearTimeout(i);clearInterval(i)});ts.clear();M.delete(el)}
  const at=(m,f)=>{const i=setTimeout(()=>{ts.delete(i);dead||!el.isConnected?stop():f()},m);ts.add(i)};
  const ev=(m,f)=>{ts.add(setInterval(()=>dead||!el.isConnected?stop():f(),m))};
  ev(rd?5e3:2500,()=>{if(!cp)return;cp.removeAttribute('aria-live');sa(cp,'aria-hidden','true');cp.classList.add('wl-fd');at(220,()=>{cp.textContent=ls[ix++%ls.length];cp.classList.remove('wl-fd')})});
  if(!rd){
    const n=sm?2:innerWidth>=640?4:3;
    for(let i=1;i<=n;i++)at(2400+i*1600,()=>rw.children.length<=i&&rw.append(wiz(i)));
    ev(12e3,()=>{rw.classList.toggle('wl-fl');st.classList.add('wl-t');at(440,()=>st.classList.remove('wl-t'))});
    ev(2e4,()=>{cl.add('wl-p');at(7e3,()=>cl.remove('wl-p'))});
    at(4e4,()=>cl.add('wl-g'));at(6e4,()=>cl.add('wl-x'));
  }
  const h={stop};M.set(el,h);return h;
}
const boot=()=>D.querySelectorAll('[data-wiz-loader]').forEach(e=>!M.has(e)&&mount(e));
window.WizLoader={mount,markup};
D.readyState==='loading'?D.addEventListener('DOMContentLoaded',boot):boot();
})();
