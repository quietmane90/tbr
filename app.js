/* TBR: a reading tracker that lives on your phone. Data stays in this browser (IndexedDB). */
(function(){
'use strict';
const VERSION='1.7.4';
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const FULL=['January','February','March','April','May','June','July','August','September','October','November','December'];
const MI=m=>MONTHS.indexOf(m);
const NOW=new Date(); const THISYEAR=String(NOW.getFullYear());
const pad2=n=>String(n).padStart(2,'0');
const isoOf=d=>`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const TODAY=isoOf(NOW);
function fromISO(d){const [y,m]=d.split('-');return {y,m:MONTHS[+m-1]};}
const niceDate=d=>{if(!d)return '';const p=d.split('-');if(p.length<3)return p[0];return `${MONTHS[+p[1]-1]} ${+p[2]}, ${p[0]}`;};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ---------- storage (IndexedDB) ---------- */
const IDB=(()=>{
  let dbp=null;
  function open(){if(dbp)return dbp;dbp=new Promise((res,rej)=>{const r=indexedDB.open('tbr',1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('kv'))d.createObjectStore('kv');if(!d.objectStoreNames.contains('covers'))d.createObjectStore('covers');};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return dbp;}
  async function tx(store,mode,fn){const d=await open();return new Promise((res,rej)=>{const t=d.transaction(store,mode);const s=t.objectStore(store);let out;const r=fn(s);if(r&&'onsuccess' in r)r.onsuccess=()=>{out=r.result;};t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error);});}
  return{
    get:(st,k)=>tx(st,'readonly',s=>s.get(k)),
    set:(st,k,v)=>tx(st,'readwrite',s=>s.put(v,k)),
    del:(st,k)=>tx(st,'readwrite',s=>s.delete(k)),
    clear:st=>tx(st,'readwrite',s=>s.clear()),
    async all(st){const d=await open();return new Promise((res,rej)=>{const t=d.transaction(st,'readonly');const s=t.objectStore(st);const out=new Map();const c=s.openCursor();c.onsuccess=()=>{const cur=c.result;if(cur){out.set(cur.key,cur.value);cur.continue();}};t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);});}
  };
})();

let D={books:[],queue:[],settings:{name:''},found:[],dismissed:[],lastCheck:''};
let books=D.books;
const coverURL=new Map(); // id -> object URL for stored blobs
let saveT=null;
function mark(){clearTimeout(saveT);saveT=setTimeout(persist,250);}
async function persist(){try{D.books=books;await IDB.set('kv','data',D);}catch(e){toast('Could not save. Is storage full?');}}
async function load(){
  try{const d=await IDB.get('kv','data');if(d&&Array.isArray(d.books))D=Object.assign(D,d);}catch(e){}
  books=D.books; D.settings=D.settings||{name:''}; D.found=D.found||[]; D.dismissed=D.dismissed||[];
  try{const all=await IDB.all('covers');for(const [k,blob] of all)coverURL.set(+k,URL.createObjectURL(blob));}catch(e){}
}
async function askPersist(){try{if(navigator.storage&&navigator.storage.persist&&!(await navigator.storage.persisted()))await navigator.storage.persist();}catch(e){}}

/* ---------- ui state (per device conveniences) ---------- */
const ui={tab:'home',ly:'',lm:undefined,st:'Unread',prio:'',q:'',open:{},size:'4x5',hideInstall:false};
try{const s=JSON.parse(localStorage.getItem('tbr-ui')||'null');if(s)Object.assign(ui,s,{q:''});}catch(e){}
const hsh=(location.hash||'').slice(1);if(['home','log','library'].includes(hsh))ui.tab=hsh;
function saveUi(){try{localStorage.setItem('tbr-ui',JSON.stringify({tab:ui.tab,ly:ui.ly,lm:ui.lm,st:ui.st,prio:ui.prio,open:ui.open,size:ui.size,rg:ui.rg,split:ui.split,theme:ui.theme,font:ui.font,hideInstall:ui.hideInstall}))}catch(e){}}

const byId=id=>books.find(b=>b.id===id);
const nextId=()=>Math.max(0,...books.map(x=>x.id))+1;
const fmtN=n=>(+n===0?'Prequel':'#'+n);
const author=a=>String(a||'').split(' & ').map(p=>p.split(',').reverse().map(x=>x.trim()).join(' ')).join(' & ');
function toLastFirst(a){a=String(a||'').trim();if(!a||a.includes(',')||a.includes('&'))return a;const p=a.split(/\s+/);if(p.length<2)return a;const last=p.pop();return `${last}, ${p.join(' ')}`;}
const lastName=a=>String(a||'').split('&')[0].split(',')[0].trim();
const appTitle=()=>{const n=(D.settings.name||'').trim();return n?`${n}${/s$/i.test(n)?"'":"'s"} TBR`:'My TBR';};
const HUES=[['#3B5B92','#1E2F4F'],['#7A3E48','#3E1D24'],['#2F6B5E','#16362F'],['#6A4C93','#33234A'],['#8A5A2B','#45290F'],['#40535F','#1E2930'],['#7B2E2E','#3A1313'],['#2E5A76','#13293A']];
function hue(s){let x=0;for(const c of String(s))x=(x*31+c.charCodeAt(0))>>>0;return HUES[x%HUES.length];}
const srcFor=b=>b.c==='idb'?(coverURL.get(b.id)||''):(b.c||'');

/* ---------- pieces ---------- */
const STAR='M12 2.5l2.9 6.2 6.6.7-5 4.5 1.4 6.6L12 17.2l-5.9 3.3 1.4-6.6-5-4.5 6.6-.7z';
function starRow(fill){let s='';for(let i=0;i<5;i++)s+=`<path transform="translate(${i*(24+1.6)} 0)" d="${STAR}" fill="${fill}"/>`;return `<svg viewBox="0 0 128 24" preserveAspectRatio="xMinYMid meet" aria-hidden="true">${s}</svg>`;}
function stars(r,size){if(r===''||r==null)return '';const w=Math.max(0,Math.min(5,+r))/5*100;return `<span class="stars" style="--s:${size||14}px;--w:${w}%" role="img" aria-label="${r} out of 5 stars">${starRow('var(--line)')}<span class="on">${starRow('var(--star)')}</span></span>`;}
function cover(b,cls,gcs){
  const [a,z]=hue(b.s+b.t);const src=srcFor(b);
  return `<div class="cv ${cls||''}" style="background:linear-gradient(160deg,${a},${z})"><div class="gc" style="--gcs:${gcs||'.9rem'}"><div><b>${esc(b.t)}</b><div class="rule"></div></div><i>${esc(author(b.a))}</i></div>${src?`<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}</div>`;
}
document.addEventListener('error',e=>{const t=e.target;if(t&&t.tagName==='IMG'&&t.parentElement&&(t.parentElement.classList.contains('cv')||t.parentElement.classList.contains('rcv')))t.remove();},true);
function stPill(b){if(b.av==='No'&&b.st!=='Read')return `<span class="st na">Not out</span>`;return `<span class="st ${b.st}">${b.st==='Unread'?'To read':b.st}</span>`;}
function toast(t){const el=$('toast');el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,3000);}
const ICON={
  ext:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
  x:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  share:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  chev:'<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>'
};
const X=`<button class="xbtn" data-act="close" aria-label="Close">${ICON.x}</button>`;

/* ---------- data helpers ---------- */
function bySeries(){const m=new Map();for(const b of books){if(!m.has(b.s))m.set(b.s,[]);m.get(b.s).push(b);}for(const a of m.values())a.sort((x,y)=>(+x.n)-(+y.n));return m;}
const qKey=b=>b.s==='Standalone'?b.t+'|':b.s;
function qBooks(q){return q.includes('|')?books.filter(b=>b.s==='Standalone'&&b.t===q.split('|')[0]):(bySeries().get(q)||[]);}
function nextUnread(list){return list.filter(b=>b.st==='Unread').sort((x,y)=>(+x.n)-(+y.n))[0];}
function nextOut(list){return list.filter(b=>b.st==='Unread'&&b.av!=='No').sort((x,y)=>(+x.n)-(+y.n))[0];}
const readBooks=()=>books.filter(b=>b.st==='Read'&&b.y);
function period(y,m){return readBooks().filter(b=>b.y===y&&(!m||b.m===m)).sort((a,b)=>MI(a.m)-MI(b.m)||((a.lo!=null&&b.lo!=null)?a.lo-b.lo:0)||((a.df&&b.df&&a.df!==b.df)?(a.df<b.df?-1:1):0)||(a.s===b.s?(+a.n)-(+b.n):(a.s==='Standalone'?1:b.s==='Standalone'?-1:a.s.localeCompare(b.s)))||a.t.localeCompare(b.t));}
function avg(list){const r=list.filter(b=>b.r!==''&&b.r!=null);return r.length?r.reduce((a,b)=>a+ +b.r,0)/r.length:0;}
const normT=s=>String(s).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
const baseTitle=s=>String(s).replace(/\s*\([^)]*\)\s*$/,'').replace(/\s*[:\-–]\s.*$/,'').trim();
function cleanQueue(){const keys=new Set(books.map(qKey));D.queue=D.queue.filter(k=>keys.has(k));}

/* ---------- tabs ---------- */
function setTab(t){ui.tab=t;saveUi();document.querySelectorAll('[data-view]').forEach(v=>v.hidden=v.dataset.view!==t);document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-current',b.dataset.tab===t?'page':'false'));try{history.replaceState(null,'','#'+t)}catch(e){}window.scrollTo(0,0);}

/* ---------- home ---------- */
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
function renderBanners(){
  const out=[];
  if(!isStandalone()&&!ui.hideInstall){
    out.push(`<div class="banner"><div><b>Put this on your home screen</b><span>${isIOS()?'In Safari, tap the Share button, then <b>Add to Home Screen</b>. It opens like an app after that.':'Open your browser menu and choose <b>Install app</b> or <b>Add to Home Screen</b>.'}</span></div><button class="xbtn" data-act="hideinstall" aria-label="Dismiss">${ICON.x}</button></div>`);
  }
  const nf=(D.found||[]).length;
  if(nf)out.push(`<button class="banner gold" data-act="found"><div><b>${nf} new book${nf===1?'':'s'} from authors you read</b><span>Tap to review and add them.</span></div></button>`);
  if(coverQ.total&&coverQ.done<coverQ.total)out.push(`<div class="banner"><div><b>Finding covers ${coverQ.done} of ${coverQ.total}</b><span>Keep the app open for a minute.</span></div></div>`);
  $('banners').innerHTML=out.join('');
}
function renderNow(){
  if(!books.length){
    $('now').innerHTML=`<div class="hero"><div class="empty-hero"><h2>Welcome to your TBR</h2><p class="muted" style="margin:0">Track what you are reading, what is next, and share monthly and yearly roundups. Everything stays on this device.</p><div class="actions"><button class="btn gold" data-act="add">Add your first book</button><button class="btn ghost" data-act="importsheet">Import from Goodreads, StoryGraph or Libby</button></div></div></div>`;
    return;
  }
  const cur=books.filter(b=>b.st==='Reading');
  if(!cur.length){
    const nq=D.queue.map(q=>nextOut(qBooks(q))).find(Boolean);
    $('now').innerHTML=`<div class="hero"><div class="empty-hero"><h2>Nothing on the go</h2><p class="muted" style="margin:0">${nq?`Next in your queue is <b>${esc(nq.t)}</b>.`:'Add something to Up next from the Library.'}</p>${nq?`<div><button class="btn gold" data-act="start" data-id="${nq.id}">Start ${esc(nq.t)}</button></div>`:''}</div></div>`;
    return;
  }
  $('now').innerHTML=`<div class="multi">${cur.map(b=>{const src=srcFor(b);return `<div class="hero">${src?`<div class="hero-bg" style="background-image:url('${esc(src)}')"></div>`:`<div class="hero-bg" style="background:linear-gradient(160deg,${hue(b.s+b.t).join(',')})"></div>`}
    <div class="hero-in">${cover(b,'','1.05rem')}<div class="hero-txt">
      <span class="kicker">${esc(b.s==='Standalone'?'Standalone':b.s+' '+fmtN(b.n))}</span>
      <div class="hero-t">${esc(b.t)}</div><div class="hero-a">${esc(author(b.a))}</div>
      <div class="hero-act"><button class="btn gold" data-act="finish" data-id="${b.id}">Finished it</button><button class="btn ghost small" data-act="book" data-id="${b.id}">More</button></div>
    </div></div></div>`;}).join('')}</div>`;
}
function queueInfo(q){
  const list=qBooks(q);const main=list.filter(b=>(Number.isInteger(+b.n)&&+b.n>0)||list.length===1);
  const reading=list.find(b=>b.st==='Reading');const nx=nextUnread(list);const shown=reading||nx||list[0];
  const done=main.filter(b=>b.st==='Read').length;let tag='';
  if(reading)tag='<span class="chip-s now">Reading</span>';
  else if(nx&&nx.av==='No')tag=`<span class="chip-s wait">${esc((nx.no||'Not out').replace(/^Releases /,'').replace(/, 20\d\d$/,''))}</span>`;
  else if(main.length&&done===main.length)tag='<span class="chip-s done">Done</span>';
  return{list,main,shown,done,tag,name:q.includes('|')?q.split('|')[0]:q};
}
function visQ(){return D.queue.map((q,i)=>i).filter(i=>{const I=queueInfo(D.queue[i]);return I.shown&&!I.list.some(b=>b.st==='Reading');});}
function qPos(i){const v=visQ();const k=v.indexOf(i);return k<0?null:k+1;}
function renderRail(){
  const items=visQ().map((i,k)=>{const q=D.queue[i];const I=queueInfo(q);
    return `<button class="qcard" data-act="queue" data-i="${i}" data-drag="q" data-slot="${i}"><div style="position:relative"><span class="qn">${k+1}</span>${cover(I.shown,'','.78rem')}</div><div class="qt">${esc(I.shown.t)}</div><div class="qm">${I.main.length>1?`${esc(I.name)} · ${I.done}/${I.main.length}`:esc(author(I.shown.a))}</div>${I.tag}</button>`;}).join('');
  $('rail').innerHTML=items||`<div class="emptybox" style="flex:1">Up next is empty. Open a book and tap Add to Up next, or hold a book in the Library and drag it down.</div>`;
}
function renderHomeStats(){
  const yr=period(THISYEAR,'');
  $('yrTitle').textContent=THISYEAR+' so far';
  $('tiles').innerHTML=[[yr.length,'books read'],[avg(yr).toFixed(1),'average rating'],[yr.filter(b=>+b.r===5).length,'five-star reads']].map(([v,l])=>`<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');
  const counts=MONTHS.map(m=>yr.filter(b=>b.m===m).length);const max=Math.max(1,...counts);
  const W=360,H=150,top=18,base=124,bw=W/12;
  const bars=counts.map((c,i)=>{const hh=c?Math.max(4,(base-top)*c/max):3;const x=i*bw+bw*0.18,w=bw*0.64;
    return `<g class="bar" data-act="month" data-m="${MONTHS[i]}" role="button" tabindex="0" aria-label="${FULL[i]}: ${c} books"><rect x="${i*bw}" y="0" width="${bw}" height="${H}" fill="transparent"/><rect class="b${c?'':' zero'}" x="${x}" y="${base-hh}" width="${w}" height="${hh}" rx="3"/>${c?`<text class="v" x="${x+w/2}" y="${base-hh-5}" text-anchor="middle">${c}</text>`:''}<text x="${x+w/2}" y="${base+18}" text-anchor="middle">${MONTHS[i][0]}</text></g>`;}).join('');
  $('chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Books finished each month in ${THISYEAR}">${bars}</svg>`;
}

/* ---------- log ---------- */
function renderLog(){
  const years=[...new Set(readBooks().map(b=>b.y))].sort().reverse();
  if(!years.includes(ui.ly))ui.ly=years[0]||THISYEAR;
  const yb=period(ui.ly,'');
  if(ui.lm===undefined){const ms=yb.map(b=>MI(b.m)).filter(i=>i>=0);ui.lm=ms.length?MONTHS[Math.max(...ms)]:'';}
  if(ui.lm&&!yb.some(b=>b.m===ui.lm))ui.lm='';
  $('years').innerHTML=years.map(y=>`<button class="pill" data-act="year" data-y="${y}" aria-pressed="${y===ui.ly}">${y}<span class="c">${period(y,'').length}</span></button>`).join('');
  $('months').innerHTML=`<button class="pill" data-act="lm" data-m="" aria-pressed="${!ui.lm}">Whole year</button>`+MONTHS.map(m=>{const n=yb.filter(b=>b.m===m).length;return `<button class="pill" data-act="lm" data-m="${m}" aria-pressed="${ui.lm===m}"${n?'':' disabled'}>${m}<span class="c">${n||''}</span></button>`;}).join('');
  const list=period(ui.ly,ui.lm);
  const label=ui.lm?`${FULL[MI(ui.lm)]} ${ui.ly}`:ui.ly;
  $('logsum').innerHTML=`<div style="display:grid;gap:2px"><span class="big">${esc(label)}</span><span class="muted" style="font-size:.85rem">${list.length} book${list.length===1?'':'s'} · ${avg(list).toFixed(1)} average · ${list.filter(b=>+b.r===5).length} five-star</span></div><button class="btn gold small" data-act="share" ${list.length?'':'disabled'}>${ICON.share}Share ${ui.lm?'month':'year'}</button>`;
  $('loggrid').innerHTML=list.length?`${ui.lm&&list.length>1?'<p class="draghint" style="margin:0 0 12px">Hold and drag to set the order you read them.</p>':''}<div class="grid">${list.map(b=>`<button class="gitem" data-act="book" data-id="${b.id}" ${ui.lm?`data-drag="l" data-slot="${b.id}"`:`data-drag="b"`}>${cover(b,'','.72rem')}${b.r!==''?`<span class="rrow">${stars(b.r,15)}<b>${rateStr(b.r)}</b></span>`:''}<span class="t">${esc(b.t)}</span><span class="m">${b.s==='Standalone'?esc(author(b.a)):esc(b.s)+' '+fmtN(b.n)}${ui.lm?'':' · '+b.m}</span></button>`).join('')}</div>`:`<div class="emptybox">No finished books logged here yet. When you finish a book, tap Finished it on the Reading tab.</div>`;
}

/* ---------- library ---------- */
function counts(){const c={Unread:0,Reading:0,Read:0,DNF:0,All:books.length};for(const b of books)c[b.st]=(c[b.st]||0)+1;return c;}
function matches(b){if(ui.st!=='All'&&b.st!==ui.st)return false;if(ui.prio&&b.p!==ui.prio)return false;if(ui.q){const q=ui.q.toLowerCase();if(!(b.t+' '+b.s+' '+author(b.a)).toLowerCase().includes(q))return false;}return true;}
function renderLib(){
  const c=counts();
  $('stchips').innerHTML=['Unread','Reading','Read','DNF','All'].map(s=>`<button class="pill" data-act="st" data-s="${s}" aria-pressed="${ui.st===s}">${s==='Unread'?'To read':s}<span class="c">${c[s]||0}</span></button>`).join('');
  const S=bySeries();const qOrder=D.queue;
  const SA=new Map();for(const b of (S.get('Standalone')||[]))SA.set(b.t+'|',[b]);S.delete('Standalone');for(const [k,v] of SA)S.set(k,v);
  const PO={'High':0,'Medium':1,'Test First':2,'Low':3};
  const grp=n=>{const all=S.get(n);if(qOrder.includes(n))return -1;const open=all.filter(b=>b.st==='Unread'||b.st==='Reading');if(!open.length)return 4;return Math.min(...open.map(b=>PO[b.p]??1));};
  const names=[...S.keys()].sort((a,b)=>{const ga=grp(a),gb=grp(b);if(ga!==gb)return ga-gb;if(ga===-1)return qOrder.indexOf(a)-qOrder.indexOf(b);return a.replace(/\|$/,'').localeCompare(b.replace(/\|$/,''));});
  const GL={'-1':'In Up next','0':'High priority','1':'Medium priority','2':'Sample first','3':'Low priority','4':'Finished'};let lastG=null;
  const out=[];
  for(const n of names){
    const all=S.get(n);const vis=all.filter(matches);if(!vis.length)continue;
    const g=grp(n);if(g!==lastG){out.push(`<div class="lgh">${GL[g]}</div>`);lastG=g;}
    if(n.endsWith('|')){const b=all[0];out.push(`<div class="series"><button class="brow solo" data-act="book" data-id="${b.id}" data-drag="b">${cover(b,'','.36rem')}<span class="bt"><b class="series-n">${esc(b.t)}</b><span>${esc(author(b.a))} · Standalone${b.st==='Read'&&b.m?` · ${b.m} ${b.y}`:''}${b.no&&b.st!=='Read'?` · ${esc(b.no)}`:''}</span></span><span class="bright">${stPill(b)}${b.r!==''?stars(b.r,11):''}</span></button></div>`);continue;}
    const done=all.filter(b=>b.st==='Read').length;const open=ui.q||ui.open[n];
    const stackB=[...all].sort((a,b)=>(srcFor(b)?1:0)-(srcFor(a)?1:0)||(+a.n)-(+b.n)).slice(0,3).sort((a,b)=>(+a.n)-(+b.n));
    out.push(`<div class="series" data-open="${open?1:0}"><button class="series-h" data-act="series" data-s="${esc(n)}" data-drag="s" aria-expanded="${!!open}"><span class="stack">${stackB.map(b=>cover(b,'','.42rem')).join('')}</span><span class="series-t"><span class="series-n">${esc(n)}</span><span class="series-a">${esc([...new Set(all.map(b=>author(b.a)))].join(' · '))}</span><span class="prog"><i style="width:${Math.round(done/all.length*100)}%"></i></span></span><span class="series-c">${done}/${all.length}<br>${ICON.chev}</span></button>${open?`<div class="blist">${vis.map(b=>`<button class="brow" data-act="book" data-id="${b.id}" data-drag="b">${cover(b,'','.3rem')}<span class="bt"><b>${esc(b.t)}</b><span>${fmtN(b.n)}${b.st==='Read'&&b.m?` · ${b.m} ${b.y}`:''}${b.no&&b.st!=='Read'?` · ${esc(b.no)}`:''}</span></span><span class="bright">${stPill(b)}${b.r!==''?stars(b.r,11):''}</span></button>`).join('')}<button class="brow addrow" data-act="addto" data-s="${esc(n)}"><span class="plus">+</span><span class="bt"><b>Add a book to ${esc(n)}</b></span><span></span></button></div>`:''}</div>`);
  }
  $('libList').innerHTML=out.join('')||(books.length?`<div class="emptybox">Nothing matches. Try another filter.</div>`:`<div class="emptybox">Your library is empty. Tap Add a book, or import from Goodreads, StoryGraph or Libby from the menu.</div>`);
}
function renderAll(){document.title=appTitle();$('brandName').textContent=appTitle();renderBanners();renderNow();renderRail();renderHomeStats();renderLog();renderLib();}

/* ---------- sheets ---------- */
const sheet=$('sheet');
function openSheet(html){$('sheetIn').innerHTML=`<div class="grab" aria-hidden="true"></div>`+html;if(!sheet.open){try{sheet.showModal()}catch(e){sheet.setAttribute('open','')}}$('sheetIn').scrollTop=0;}
function closeSheet(){try{sheet.close()}catch(e){sheet.removeAttribute('open')}sheetBook=null;}
sheet.addEventListener('click',e=>{if(e.target===sheet)closeSheet();});
const fmtRate=v=>{v=+v;return (Number.isInteger(v*4)&&!Number.isInteger(v*2))?v.toFixed(2):v.toFixed(1);};
function rateInput(v,id){
  let s='';for(let i=0;i<5;i++){const f=Math.max(0,Math.min(1,(+v||0)-i));s+=`<span class="rs"><svg viewBox="0 0 24 24"><defs><clipPath id="c${id}${i}"><rect x="0" y="0" width="${24*f}" height="24"/></clipPath></defs><path d="${STAR}" fill="var(--line)"/><path d="${STAR}" fill="var(--star)" clip-path="url(#c${id}${i})"/></svg>${[.25,.5,.75,1].map((f,k)=>`<button class="q q${k}" data-act="rate" data-v="${i+f}" aria-label="${i+f} stars"></button>`).join('')}</span>`;}
  return `<div class="rate"><div class="rate-stars" data-rid="${id}">${s}</div><span class="rate-v">${v!==''&&v!=null?fmtRate(v):'–'}</span>${v!==''&&v!=null?`<button class="link" data-act="rate" data-v="">Clear</button>`:''}</div><span class="hint" style="display:block;margin-top:4px">Tap further across a star for quarter, half and three-quarter stars.</span>`;
}
let sheetBook=null,pendingRate='';
function seriesOptions(){return [...bySeries().keys()].filter(s=>s!=='Standalone').sort();}
function bookSheet(id){
  const b=byId(id);if(!b)return;sheetBook=id;const k=qKey(b);const qi=D.queue.indexOf(k);
  const seg=(f,opts,lab)=>`<div class="seg" role="group" aria-label="${lab}">${opts.map(([v,t])=>`<button data-act="set" data-f="${f}" data-v="${esc(v)}" aria-pressed="${String(b[f])===v}">${t}</button>`).join('')}</div>`;
  const years=[...new Set([THISYEAR,String(+THISYEAR-1),...readBooks().map(x=>x.y),b.y].filter(Boolean))].sort().reverse();
  openSheet(`<div class="sh-head">${cover(b,'','.62rem')}<div style="display:grid;gap:4px;min-width:0"><span class="kicker">${esc(b.s==='Standalone'?'Standalone':b.s+' '+fmtN(b.n))}</span><h3>${esc(b.t)}</h3><span class="muted">${esc(author(b.a))}</span>${b.av==='No'&&b.st!=='Read'&&b.no?`<span class="chip-s wait" style="justify-self:start">${esc(b.no)}</span>`:''}</div>${X}</div>
    <div class="field"><span class="lab">Status</span>${seg('st',[['Unread','To read'],['Reading','Reading'],['Read','Read'],['DNF','DNF']],'Status')}</div>
    ${b.st==='Read'?`<div class="field"><span class="lab">Your rating</span>${rateInput(b.r,'b'+b.id)}</div>
    <div class="row2"><div class="field"><label for="fds">Started</label><input class="inp" type="date" id="fds" data-act="setdate" data-f="ds" value="${esc(b.ds||'')}"></div><div class="field"><label for="fdf">Finished</label><input class="inp" type="date" id="fdf" data-act="setdate" data-f="df" value="${esc(b.df||'')}"></div></div>
    <div class="row2"><div class="field"><label for="fm">Month finished</label><select class="inp" id="fm" data-act="setsel" data-f="m"><option value="">Month</option>${MONTHS.map((m,i)=>`<option value="${m}"${b.m===m?' selected':''}>${FULL[i]}</option>`).join('')}</select></div><div class="field"><label for="fy">Year</label><select class="inp" id="fy" data-act="setsel" data-f="y"><option value="">Year</option>${years.map(y=>`<option${b.y===y?' selected':''}>${y}</option>`).join('')}</select></div></div>`:''}
    ${b.st==='Reading'?`<div class="field"><label for="fds2">Started</label><input class="inp" type="date" id="fds2" data-act="setdate" data-f="ds" value="${esc(b.ds||'')}"></div>`:''}
    <div class="field"><span class="lab">Up next</span><div class="actions">${qi>-1?`<span class="muted" style="align-self:center;font-weight:700">${b.s==='Standalone'?'This book':'This series'} is #${qPos(qi)||qi+1}</span>${qi>0?`<button class="btn ghost small" data-act="qtop" data-id="${b.id}">Move to top</button>`:''}<button class="btn ghost small" data-act="qremove" data-id="${b.id}">Remove</button>`:`<button class="btn ghost small" data-act="qadd" data-id="${b.id}">Add to Up next</button><button class="btn ghost small" data-act="qtop" data-id="${b.id}">Read this next</button>`}${b.st==='Unread'?`<button class="btn gold small" data-act="start" data-id="${b.id}">Start reading</button>`:''}</div></div>
    <div class="field"><span class="lab">Find on</span>${openLinks(b)}</div>
    <div class="field"><span class="lab">Priority</span>${seg('p',[['High','High'],['Medium','Medium'],['Test First','Sample'],['Low','Low']],'Priority')}</div>
    <div class="field"><span class="lab">Released</span>${seg('av',[['Yes','Out now'],['No','Not out yet']],'Released')}</div>
    <div class="field"><label for="fno">Notes</label><input class="inp" id="fno" data-act="setinp" data-f="no" value="${esc(b.no)}" placeholder="Anything to remember"></div>
    <div class="field"><span class="lab">Cover</span><div class="actions"><button class="btn ghost small" data-act="pickcover">${b.c?'Change cover':'Find a cover'}</button><label class="btn ghost small" for="fcov">Use a photo</label><input type="file" id="fcov" accept="image/*" hidden>${b.c?`<button class="btn ghost small" data-act="rmcover">Remove cover</button>`:''}</div></div>
    <details class="field edit"><summary class="lab">Edit details</summary>
      <div style="display:grid;gap:12px;margin-top:10px">
      <div class="field"><label for="e-t">Title</label><input class="inp" id="e-t" data-act="setinp" data-f="t" value="${esc(b.t)}"></div>
      <div class="field"><label for="e-a">Author</label><input class="inp" id="e-a" data-act="setauthor" value="${esc(author(b.a))}"></div>
      <div class="row2"><div class="field"><label for="e-s">Series</label><input class="inp" id="e-s" data-act="setseries" list="dl-es" value="${esc(b.s==='Standalone'?'':b.s)}" placeholder="Blank = standalone"><datalist id="dl-es">${seriesOptions().map(x=>`<option value="${esc(x)}">`).join('')}</datalist></div><div class="field"><label for="e-n">Book #</label><input class="inp" id="e-n" data-act="setnum" inputmode="decimal" value="${esc(b.n)}"></div></div>
      <button class="btn ghost small danger" data-act="delbook" data-id="${b.id}" style="justify-self:start">Delete this book</button>
      </div></details>`);
}
function finishSheet(id){
  const b=byId(id);sheetBook=id;pendingRate=b.r||'';
  openSheet(`<div class="sh-head">${cover(b,'','.62rem')}<div style="display:grid;gap:4px"><span class="kicker">Finished</span><h3>${esc(b.t)}</h3><span class="muted">${esc(author(b.a))}</span></div>${X}</div>
    <div class="field"><span class="lab">How was it?</span><div id="frate">${rateInput(pendingRate,'f'+b.id)}</div></div>
    <div class="actions"><button class="btn gold" data-act="dofinish" data-id="${b.id}">Log it for ${FULL[NOW.getMonth()]}</button><button class="btn ghost" data-act="dodnf" data-id="${b.id}">Did not finish</button><button class="btn ghost" data-act="pause" data-id="${b.id}">Put it back</button></div>`);
}
function queueSheet(i){
  const q=D.queue[i];const I=queueInfo(q);const nx=nextOut(I.list);const reading=I.list.find(b=>b.st==='Reading');
  openSheet(`<div class="sh-head">${cover(I.shown,'','.62rem')}<div style="display:grid;gap:4px;min-width:0"><span class="kicker">#${qPos(i)||i+1} in Up next</span><h3>${esc(I.name)}</h3><span class="muted">${esc(author(I.shown.a))}${I.main.length>1?` · ${I.done} of ${I.main.length} read`:''}</span>${I.tag}</div>${X}</div>
    ${I.list.length>1?`<div class="field"><span class="lab">Books</span><div style="display:grid;gap:6px">${I.list.map(b=>`<button class="brow" style="border:1px solid var(--line);border-radius:10px" data-act="book" data-id="${b.id}">${cover(b,'','.3rem')}<span class="bt"><b>${esc(b.t)}</b><span>${fmtN(b.n)}</span></span><span class="bright">${stPill(b)}${b.r!==''?stars(b.r,11):''}</span></button>`).join('')}</div></div>`:''}
    <div class="actions">${!reading&&nx?`<button class="btn gold" data-act="start" data-id="${nx.id}">Start ${esc(nx.t)}</button>`:''}<button class="btn ghost" data-act="qmove" data-i="${i}" data-d="-1" ${i===0?'disabled':''}>Move up</button><button class="btn ghost" data-act="qmove" data-i="${i}" data-d="1" ${i===D.queue.length-1?'disabled':''}>Move down</button><button class="btn ghost" data-act="qrmi" data-i="${i}">Remove</button></div>`);
}

/* ---------- add books: type, scan a cover, or a whole series ---------- */
let addState={mode:'book',st:'Unread',p:'Medium',r:'',pick:null,cand:null};
function parseSeriesTitle(t){
  const m=String(t).match(/^(.*?)\s*\(([^()]+?)(?:,|\s)\s*(?:#|book\s*)\s*(\d+(?:\.\d+)?)[^()]*\)\s*$/i);
  if(m){const s=m[2].split(';')[0].replace(/,\s*$/,'').trim();return{t:m[1].trim(),s,n:parseFloat(m[3])};}
  return{t:String(t).replace(/\s*\([^)]*\)\s*$/,'').trim(),s:'',n:null};
}
const segH=(f,opts)=>`<div class="seg">${opts.map(([v,l])=>`<button type="button" data-act="aset" data-f="${f}" data-v="${esc(v)}" aria-pressed="${addState[f]===v}">${l}</button>`).join('')}</div>`;
const PRIO=[['High','High'],['Medium','Medium'],['Test First','Sample'],['Low','Low']];
function addSheet(pre){
  pre=pre||{};addState={mode:pre.mode||'book',st:'Unread',p:'Medium',r:'',pick:null,cand:null,series:pre.s||''};
  openSheet(`<div class="sh-head" style="grid-template-columns:1fr auto"><div style="display:grid;gap:4px"><span class="kicker">Library</span><h3>Add books</h3></div>${X}</div>
  ${segH('mode',[['book','One book'],['series','A whole series']])}
  <div id="addBody"></div>
  <button class="link" data-act="importsheet" style="justify-self:start">Import from Goodreads, StoryGraph or Libby</button>`);
  addBody(pre);
}
function addBody(pre){
  pre=pre||{};const box=$('addBody');if(!box)return;
  if(addState.mode==='series'){
    box.innerHTML=`<div class="field"><label for="ser-q">Series name</label><div class="qrow"><input class="inp" id="ser-q" placeholder="e.g. Earthsea, or Red Rising Pierce Brown" value="${esc(pre.s||addState.series||'')}" enterkeyhint="search"><button type="button" class="btn gold" data-act="sersearch">Find</button></div><span class="hint">Add the author's name if the series name is common.</span></div><div id="ser-res"></div>`;
    if(pre.s||addState.series)seriesSearch();
    return;
  }
  box.innerHTML=`<div class="field"><label for="a-q">Title and author</label><div class="qrow"><input class="inp" id="a-q" placeholder="e.g. wolves of war gwynne" value="${esc(pre.t?(pre.t+' '+(pre.a?author(pre.a):'')).trim():'')}" enterkeyhint="search" autocomplete="off"><label class="btn ghost camb" for="a-cam" aria-label="Scan a cover"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></label><input type="file" id="a-cam" accept="image/*" capture="environment" hidden></div><span class="hint" id="a-hint">Type a title (and author if you know it), or tap the camera to scan a cover.</span></div><div id="a-res" class="results"></div><div id="a-conf"></div>`;
  if(pre.t){if(pre.direct)showConfirm({t:pre.t,a:author(pre.a),s:pre.s||'',n:pre.n||'',date:pre.date||'',img:pre.img||''});else liveSearch($('a-q').value);}
}
let searchT=null,searchSeq=0;
async function liveSearch(q){
  const seq=++searchSeq;const box=$('a-res');if(!box)return;q=String(q||'').trim();
  if(q.length<3){box.innerHTML='';return;}
  box.innerHTML='<div class="hint">Searching…</div>';$('a-conf')&&($('a-conf').innerHTML='');
  const [gb,ol]=await Promise.all([gbSearch(q,10,'&langRestrict=en').catch(()=>[]),olSearch(q,'',10).catch(()=>[])]);
  if(seq!==searchSeq||!$('a-res'))return;
  const seen=new Map();const items=[];
  for(const r of [...ol,...gb]){if(!r.t||!r.a||BAD.test(r.t)||BAD.test(r.sub||''))continue;const k=normT(baseTitle(parseSeriesTitle(r.t).t))+'|'+normT(lastName(toLastFirst(r.a)));
    if(seen.has(k)){const e=seen.get(k);e.series=e.series||r.series;e.n=e.n||r.n;e.img=e.img||r.img;e.big=e.big||r.big;if(r.date&&(!e.date||r.date<e.date||e.date.length<r.date.length))e.date=r.date;continue;}
    const it=Object.assign({},r);seen.set(k,it);items.push(it);}
  // rank: words of the query found in title or author
  const qw=normWords(q);items.forEach(r=>{const hay=' '+normWords(r.t+' '+r.a).join(' ')+' ';r.score=qw.filter(w=>hay.includes(' '+w+' ')).length+(r.img?0.3:0)+(r.series?0.2:0);});
  items.sort((a,b)=>b.score-a.score);
  liveSearch.items=items.slice(0,6);
  box.innerHTML=liveSearch.items.length?liveSearch.items.map((r,i)=>`<button type="button" class="res" data-act="pickres" data-i="${i}"><span class="rcv">${r.img?`<img src="${esc(r.img)}" alt="" referrerpolicy="no-referrer">`:''}</span><span class="bt"><b>${esc(parseSeriesTitle(r.t).t)}</b><span>${esc(r.a)}${r.series?' · '+esc(r.series)+(r.n?' #'+r.n:''):''}${r.year?' · '+esc(r.year):''}</span></span><span class="go">Add</span></button>`).join('')+`<button type="button" class="link" data-act="manual">Not here? Enter it yourself</button>`:`<div class="hint">No matches.</div><button type="button" class="link" data-act="manual">Enter it yourself</button>`;
}
/* Wikidata: free, open, knows the series and reading order for most published series */
const WD='https://query.wikidata.org/sparql?format=json&query=';
const sq=s=>String(s).replace(/["\\]/g,' ');
async function wdQuery(q){const j=await getJSON(WD+encodeURIComponent(q),15000);return (j.results&&j.results.bindings)||[];}
const wv=(r,k)=>(r[k]&&r[k].value)||'';
async function wdSeriesOfBook(t,a){
  const rows=await wdQuery(`SELECT ?book ?sLabel ?ord ?aLabel WHERE { SERVICE wikibase:mwapi { bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch"; mwapi:search "${sq(baseTitle(t))}"; mwapi:language "en". ?book wikibase:apiOutputItem mwapi:item. } ?book p:P179 ?st . ?st ps:P179 ?s . OPTIONAL { ?st pq:P1545 ?ord } OPTIONAL { ?book wdt:P50 ?a } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 20`);
  for(const r of rows){if(a&&wv(r,'aLabel')&&!amatch(toLastFirst(a),wv(r,'aLabel')))continue;const s=wv(r,'sLabel');if(s&&!/^Q\d+$/.test(s))return{s:s.replace(/\s+series$/i,''),n:parseFloat(wv(r,'ord'))||null};}
  return null;
}
async function wdSeriesBooks(q){
  const rows=await wdQuery(`SELECT ?series ?sLabel ?book ?bookLabel ?ord ?date ?aLabel WHERE { SERVICE wikibase:mwapi { bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch"; mwapi:search "${sq(q)}"; mwapi:language "en". ?series wikibase:apiOutputItem mwapi:item. } ?book p:P179 ?st . ?st ps:P179 ?series . OPTIONAL { ?st pq:P1545 ?ord } OPTIONAL { ?book wdt:P577 ?date } ?book wdt:P50 ?a . SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 200`);
  const by=new Map();
  for(const r of rows){const sid=wv(r,'series');if(!by.has(sid))by.set(sid,{name:wv(r,'sLabel').replace(/\s+series$/i,''),books:new Map()});const g=by.get(sid);const id=wv(r,'book');const t=wv(r,'bookLabel');if(!t||/^Q\d+$/.test(t))continue;
    const e=g.books.get(id)||{t,a:wv(r,'aLabel'),n:null,date:''};const n=parseFloat(wv(r,'ord'));if(!isNaN(n))e.n=n;const d=wv(r,'date').slice(0,10);if(d&&(!e.date||d<e.date))e.date=d;g.books.set(id,e);}
  return [...by.values()].map(g=>({name:g.name,books:[...g.books.values()]})).filter(g=>g.books.length);
}
async function seriesFor(t,a){
  try{const w=await wdSeriesOfBook(t,a);if(w)return w;}catch(e){}
  // Open Library knows series for many books; ask for this exact title and author.
  try{const p=new URLSearchParams({title:baseTitle(t),author:lastName(toLastFirst(a)),limit:'5',fields:'title,series_name,series_position,first_publish_year'});const j=await getJSON('https://openlibrary.org/search.json?'+p,8000);
    for(const d of j.docs||[]){if(d.series_name&&d.series_name[0]&&tmatch(t,d.title))return{s:d.series_name[0],n:parseFloat((d.series_position||[])[0])||null};}}catch(e){}
  return null;
}
async function pickResult(i){
  const r=(liveSearch.items||[])[i];if(!r)return;
  $('a-res').innerHTML='<div class="hint">Filling in the details…</div>';
  const p=parseSeriesTitle(r.t);let s=r.series||p.s,n=r.n||p.n;
  if(!s){const f=await seriesFor(p.t,r.a);if(f){s=f.s;n=n||f.n;}}
  if(!s){// same author already has one series in the library and this title is not a standalone we know of: leave blank
  }
  if(!s&&addState.series)s=addState.series;
  const exS=s?(seriesOptions().find(x=>normT(x)===normT(s))||seriesOptions().find(x=>normT(x).includes(normT(s))||normT(s).includes(normT(x)))||s):'';
  showConfirm({t:p.t,a:r.a,s:exS,n:n||'',date:r.date||'',img:r.big||r.img||''});
}
function showConfirm(c){
  addState.cand=c;addState.pick=c.img||null;
  const future=c.date&&c.date.length>=7&&c.date>TODAY.slice(0,c.date.length);
  if(future)c.av='No';
  $('a-res')&&($('a-res').innerHTML='');
  const fake={t:c.t,a:toLastFirst(c.a),s:c.s||'Standalone',c:c.img||''};
  $('a-conf').innerHTML=`<div class="conf">
    <div class="sh-head" style="grid-template-columns:72px 1fr">${cover(fake,'','.5rem')}<div style="display:grid;gap:3px;min-width:0"><span class="kicker">${c.s?esc(c.s)+(c.n?' #'+esc(c.n):''):'Standalone'}</span><h3 style="font-size:1.15rem">${esc(c.t)}</h3><span class="muted">${esc(author(toLastFirst(c.a)))}</span>${future?`<span class="chip-s wait" style="justify-self:start">Not out yet · ${esc(niceDate(c.date))}</span>`:''}</div></div>
    <div class="field"><span class="lab">Priority</span>${segH('p',PRIO)}</div>
    <div class="field"><span class="lab">Status</span>${segH('st',[['Unread','To read'],['Reading','Reading'],['Read','Read'],['DNF','DNF']])}</div>
    <div class="field" id="a-ratef" hidden><span class="lab">Rating</span><div id="a-rate">${rateInput(addState.r,'a')}</div></div>
    <div class="field" id="a-dff" hidden><label for="a-df">Finished</label><input class="inp" type="date" id="a-df" value="${TODAY}"></div>
    <details class="field edit"><summary class="lab">Fix the details</summary><div style="display:grid;gap:12px;margin-top:10px">
      <div class="field"><label for="c-t">Title</label><input class="inp" id="c-t" value="${esc(c.t)}"></div>
      <div class="field"><label for="c-a">Author</label><input class="inp" id="c-a" value="${esc(author(toLastFirst(c.a)))}"></div>
      <div class="row2"><div class="field"><label for="c-s">Series</label><input class="inp" id="c-s" list="dl-cs" value="${esc(c.s||'')}" placeholder="Blank = standalone"><datalist id="dl-cs">${seriesOptions().map(x=>`<option value="${esc(x)}">`).join('')}</datalist></div><div class="field"><label for="c-n">Book #</label><input class="inp" id="c-n" inputmode="decimal" value="${esc(c.n||'')}"></div></div>
      <label class="chk"><input type="checkbox" id="c-av" ${future||c.av==='No'?'':'checked'}> Already released</label>
    </div></details>
    <button class="btn gold" data-act="confirmadd" style="width:100%">Add to library</button></div>`;
  addVis();
}
function addVis(){const st=addState.st;if($('a-ratef'))$('a-ratef').hidden=st!=='Read';if($('a-dff'))$('a-dff').hidden=!(st==='Read'||st==='DNF');}
function confirmAdd(){
  const t=($('c-t').value||'').trim();if(!t)return;
  const a=toLastFirst($('c-a').value);const sIn=$('c-s').value.trim();
  const exS=seriesOptions().find(x=>normT(x)===normT(sIn));
  const dup=books.find(b=>normT(b.t)===normT(t)&&normT(lastName(b.a))===normT(lastName(a)));
  if(dup){toast('Already in your library. Opening it.');bookSheet(dup.id);return;}
  const st=addState.st;
  let n=parseFloat($('c-n').value);if(isNaN(n)){if(exS){const S=bySeries().get(exS);n=Math.floor(Math.max(...S.map(b=>+b.n||0)))+1;}else n=1;}
  const b={id:nextId(),a,s:exS||sIn||'Standalone',t,n,st,m:'',y:'',p:addState.p,r:st==='Read'?addState.r:'',av:$('c-av').checked?'Yes':'No',no:''};
  if(b.av==='No'&&addState.cand&&addState.cand.date)b.no='Releases '+niceDate(addState.cand.date);
  if(st==='Reading')b.ds=TODAY;
  if(st==='Read'||st==='DNF'){b.df=($('a-df')&&$('a-df').value)||TODAY;if(st==='Read'){const d=fromISO(b.df);b.m=d.m;b.y=d.y;}}
  books.push(b);mark();askPersist();
  if(addState.photo&&!addState.pick){storeBlob(b,addState.photo).then(()=>{mark();renderAll();});addState.photo=null;}
  else{const pick=addState.pick;if(pick)saveCoverFrom(b,pick).then(ok=>{if(!ok)queueCovers([b.id]);});else queueCovers([b.id]);}
  addState.photo=null;renderAll();toast(`Added ${t}`);
  // stay open for the next one
  addState.cand=null;addState.r='';const q=$('a-q');if(q){q.value='';q.focus();}$('a-conf').innerHTML='';$('a-hint').textContent=`Added ${t}. Add another, or close.`;
}
function manualEntry(){const q=($('a-q')&&$('a-q').value)||'';showConfirm({t:q,a:'',s:addState.series||'',n:'',date:'',img:''});const d=document.querySelector('#a-conf details');if(d)d.open=true;}

/* scan a cover: read the text on the photo, then search */
let tessP=null;
function loadTess(){if(tessP)return tessP;tessP=new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';s.onload=()=>res(window.Tesseract);s.onerror=()=>{tessP=null;rej(new Error('load'));};document.head.appendChild(s);});return tessP;}
async function scanCover(file){
  const hint=$('a-hint');hint.textContent='Reading the cover… this takes a few seconds the first time.';
  let text='';
  try{const T=await loadTess();const r=await T.recognize(file,'eng');
    const lines=(r.data.lines||[]).filter(l=>l.confidence>45).map(l=>({t:l.text.replace(/[^A-Za-z0-9'&:\- ]/g,' ').replace(/\s+/g,' ').trim(),h:(l.bbox.y1-l.bbox.y0)})).filter(l=>l.t.length>1&&!/bestsell|author of|new york times|praise|novel$/i.test(l.t));
    lines.sort((a,b)=>b.h-a.h);text=lines.slice(0,4).map(l=>l.t).join(' ');
  }catch(e){hint.textContent='Could not read the cover here. Type the title instead.';return;}
  if(!text){hint.textContent='Could not make out the title. Type it instead.';return;}
  $('a-q').value=text;hint.textContent='Pick the right book below. If it is not there, edit the search.';
  addState.photo=file;
  liveSearch(text);
}

/* a whole series */
async function seriesSearch(){
  const q=($('ser-q').value||'').trim();const box=$('ser-res');if(!q||!box)return;
  box.innerHTML='<div class="hint">Looking up the series…</div>';
  const words=normWords(q);
  try{
    const groups=await wdSeriesBooks(q.replace(/\b(series|saga|books?)\b/ig,'').trim());
    const qa=words;const g=groups.map(x=>({x,sc:normWords(x.name).filter(w=>qa.includes(w)).length+(x.books.some(b=>qa.includes(normT(lastName(toLastFirst(b.a)))))?2:0)+Math.min(x.books.length,10)/100})).sort((a,b)=>b.sc-a.sc)[0];
    if(g&&g.sc>=1){const list=g.x.books.map(b=>({t:b.t,a:b.a,n:b.n,year:(b.date||'').slice(0,4),date:b.date,img:'',big:''}));
      const known=list.filter(r=>r.n!=null).length;if(known<list.length/2)list.forEach(r=>r.n=null);
      return showSeriesList(list,g.x.name);}
  }catch(e){}
  const [gb,ol1,ol2]=await Promise.all([gbSearch(q,40,'&langRestrict=en').catch(()=>[]),olSeries(`series_name:"${q}"`).catch(()=>[]),olSeries(q).catch(()=>[])]);
  const all=[...ol1,...ol2,...gb].filter(r=>r.t&&r.a&&!BAD.test(r.t)&&!BAD.test(r.sub||''));
  // most common author among results that mention the series
  const mention=r=>{const hay=' '+normWords([r.t,r.sub||'',r.series||''].join(' ')).join(' ')+' ';return words.filter(w=>hay.includes(' '+w+' ')).length;};
  const tally=new Map();for(const r of all){const k=lastName(toLastFirst(r.a));if(!k)continue;tally.set(k,(tally.get(k)||0)+mention(r)+(r.series?2:0));}
  const qAuthor=[...tally.keys()].find(k=>words.includes(normT(k)));
  const top=qAuthor||[...tally.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
  if(!top){box.innerHTML='<div class="hint">Could not find that series. Try adding the author, or add the books one at a time.</div>';return;}
  // pull more from that author, keep the ones tied to the series
  const more=await olSeries(`author:"${top}"`,100).catch(()=>[]);
  const pool=[...all,...more].filter(r=>amatch(top,r.a));
  const sName=(pool.find(r=>r.series&&words.some(w=>normT(r.series).includes(w)))||{}).series||q.replace(new RegExp('\\b'+top+'\\b','i'),'').trim();
  const inSeries=r=>(r.series&&normT(r.series)===normT(sName))||mention(r)>=Math.max(1,Math.ceil(words.filter(w=>w!==normT(top)).length*0.6));
  const seen=new Map();
  for(const r of pool){if(!inSeries(r))continue;const p=parseSeriesTitle(r.t);const title=baseTitle(p.t)||p.t;const k=normT(title.replace(/^(the|a|an)\s+/i,''));if(!k||normT(title)===normT(sName))continue;
    const n=r.n||p.n||null;const e=seen.get(k);
    if(e){e.n=e.n||n;e.year=Math.min(+e.year||9999,+r.year||9999)||'';e.img=e.img||r.img;e.big=e.big||r.big;continue;}
    seen.set(k,{t:p.t,a:r.a,n,year:r.year||'',date:r.date||'',img:r.img,big:r.big});}
  let list=[...seen.values()].filter(r=>!SERBAD.test(r.t)&&!/ & /.test(r.t));
  if(list.filter(r=>r.n!=null).length<list.length/2)list.forEach(r=>r.n=null);
  if(!list.length){box.innerHTML='<div class="hint">Found the author but not the books in that series. Add them one at a time.</div>';return;}
  showSeriesList(list,sName);
}
const SERBAD=/\b(trilogy|quartet|quintet|omnibus|revisioned|companion|guide|world of|art of|collection|boxed|stories from|novels)\b/i;
function showSeriesList(list,sName){
  const box=$('ser-res');if(!box)return;
  list=list.filter(r=>!SERBAD.test(r.t)||/\b(book|part)\b/i.test(r.t));
  list.sort((a,b)=>(a.n??999)-(b.n??999)||String(a.date||a.year||'9999').localeCompare(String(b.date||b.year||'9999')));
  if(list.every(r=>r.n==null))list.forEach((r,i)=>r.n=i+1);
  else{let k=0;list.forEach(r=>{if(r.n==null)r.n=Math.floor(Math.max(k,...list.filter(x=>x.n!=null).map(x=>x.n)))+1;k=Math.max(k,r.n);});}
  const have=new Set(books.map(b=>normT(b.t)));
  seriesSearch.list=list;
  const exS=seriesOptions().find(x=>normT(x)===normT(sName));
  box.innerHTML=`<div class="field"><label for="ser-name">Series</label><input class="inp" id="ser-name" value="${esc(exS||titleCase(sName))}"></div>
  <span class="hint">By ${esc(author(toLastFirst(list[0].a)))}. Untick anything that does not belong, and check the order.</span>
  <div style="display:grid;gap:6px">${list.map((r,i)=>`<label class="frow"><span class="rcv">${r.img?`<img src="${esc(r.img)}" alt="" referrerpolicy="no-referrer">`:''}</span><span class="bt"><b>${esc(r.t)}</b><span>#<input class="numin" data-i="${i}" value="${esc(r.n)}" inputmode="decimal" aria-label="Book number">${r.year?' · '+esc(r.year):''}${have.has(normT(r.t))?' · already added':''}</span></span><input type="checkbox" class="sercb" data-i="${i}" ${have.has(normT(r.t))?'':'checked'}></label>`).join('')}</div>
  <div class="field"><span class="lab">Priority</span>${segH('p',PRIO)}</div>
  <button class="btn gold" data-act="seradd" style="width:100%">Add these books</button>`;
}
const titleCase=s=>String(s).replace(/\b([a-z])/g,(m,c)=>c.toUpperCase());
async function olSeries(q,limit){const p=new URLSearchParams({q,limit:String(limit||40),fields:'title,author_name,first_publish_year,cover_i,series_name,series_position,language'});const j=await getJSON('https://openlibrary.org/search.json?'+p);
  return (j.docs||[]).filter(d=>!d.language||d.language.includes('eng')).map(d=>({t:d.title,a:(d.author_name||[])[0]||'',year:d.first_publish_year?String(d.first_publish_year):'',img:d.cover_i?`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`:'',big:d.cover_i?`https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg?default=false`:'',series:(d.series_name||[])[0]||'',n:parseFloat((d.series_position||[])[0])||null}));}
function seriesAdd(){
  const list=seriesSearch.list||[];const name=($('ser-name').value||'').trim();if(!name)return;
  const exS=seriesOptions().find(x=>normT(x)===normT(name));
  document.querySelectorAll('.numin').forEach(inp=>{const r=list[+inp.dataset.i];if(r)r.n=parseFloat(inp.value)||r.n;});
  const picked=[...document.querySelectorAll('.sercb')].filter(c=>c.checked).map(c=>list[+c.dataset.i]);
  if(!picked.length){toast('Tick at least one book.');return;}
  const added=[];
  for(const r of picked){if(books.some(b=>normT(b.t)===normT(r.t)&&normT(lastName(b.a))===normT(lastName(toLastFirst(r.a)))))continue;
    const fut=r.date&&r.date>TODAY;const b={id:nextId(),a:toLastFirst(r.a),s:exS||name,t:r.t,n:r.n,st:'Unread',m:'',y:'',p:addState.p,r:'',av:fut?'No':'Yes',no:fut?'Releases '+niceDate(r.date):''};books.push(b);added.push([b,r.big]);}
  mark();askPersist();
  (async()=>{for(const [b,u] of added){if(!(u&&await saveCoverFrom(b,u)))queueCovers([b.id]);}})();
  closeSheet();renderAll();toast(`Added ${added.length} book${added.length===1?'':'s'} to ${exS||name}`);
}
document.addEventListener('input',e=>{if(e.target.id==='a-q'){clearTimeout(searchT);const v=e.target.value;searchT=setTimeout(()=>liveSearch(v),450);}});
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  if(e.target.id==='a-q'){e.preventDefault();clearTimeout(searchT);liveSearch(e.target.value);}
  if(e.target.id==='ser-q'){e.preventDefault();seriesSearch();}
});

/* ---------- online lookups ---------- */
const BAD=/box(ed)?\s*set|boxset|collection|omnibus|\bbundle\b|books?\s*\d+\s*[-–]\s*\d+|\bset of\b|summary|study guide|workbook|sparknotes|cliffs|coloring book|calendar|\bjournal\b|trilogy\s*\(|complete series/i;
function tmatch(want,got){const w=normWords(baseTitle(want));const g=' '+normWords(got).join(' ')+' ';if(!w.length)return false;return w.filter(x=>g.includes(' '+x+' ')).length>=Math.max(1,Math.ceil(w.length*0.7));}
function normWords(s){return String(s).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(x=>x.length>1&&!['the','of','an','and','a'].includes(x));}
function amatch(a,got){const ln=lastName(a).toLowerCase();if(!ln)return true;return new RegExp('\\b'+ln.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b').test(String(got).toLowerCase());}
async function getJSON(u,ms){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms||12000);try{const r=await fetch(u,{signal:c.signal});if(!r.ok)throw new Error(r.status);return await r.json();}finally{clearTimeout(t);}}
async function olSearch(title,auth,limit){
  const p=new URLSearchParams({limit:String(limit||5),fields:'key,title,author_name,cover_i,first_publish_year,language,series_name,series_position'});
  if(auth){p.set('title',title);p.set('author',auth);}else p.set('q',title);
  const j=await getJSON('https://openlibrary.org/search.json?'+p);
  return (j.docs||[]).map(d=>({t:d.title,a:(d.author_name||[])[0]||'',year:d.first_publish_year?String(d.first_publish_year):'',img:d.cover_i?`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`:'',big:d.cover_i?`https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg?default=false`:'',series:(d.series_name||[])[0]||'',n:parseFloat((d.series_position||[])[0])||null,src:'Open Library'}));
}
function gbItem(v){const i=v.volumeInfo||{};let img=(i.imageLinks&&(i.imageLinks.thumbnail||i.imageLinks.smallThumbnail))||'';img=img.replace(/^http:/,'https:').replace(/&edge=curl/,'');
  let series='',n=null;const st=(i.subtitle||'');const m=st.match(/book\s+(\d+(?:\.\d+)?)\s+(?:of|in)\s+(?:the\s+)?(.+?)(?:\s+series|\s+saga|\s+trilogy)?$/i);if(m){n=parseFloat(m[1]);series=m[2];}
  return{t:i.title||'',a:(i.authors||[])[0]||'',year:(i.publishedDate||'').slice(0,4),date:(i.publishedDate||''),img,big:img,series,n,lang:i.language,src:'Google Books',sub:i.subtitle||''};}
async function gbSearch(q,limit,extra){const j=await getJSON(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=${limit||10}&printType=books${extra||''}`);return (j.items||[]).map(gbItem);}
async function itSearch(t,a){const j=await getJSON(`https://itunes.apple.com/search?entity=ebook&limit=10&term=${encodeURIComponent(baseTitle(t)+' '+lastName(a))}`);return (j.results||[]).map(x=>({t:x.trackName||'',a:x.artistName||'',img:(x.artworkUrl100||'').replace('100x100bb','200x300bb'),big:(x.artworkUrl100||'').replace('100x100bb','600x900bb'),year:(x.releaseDate||'').slice(0,4),src:'Apple Books'}));}
async function coverCandidates(b){
  const out=[];const t=baseTitle(b.t),a=b.a;
  const ok=r=>r.big&&amatch(a,r.a)&&tmatch(b.t,r.t)&&!(BAD.test(r.t)&&!BAD.test(b.t));
  const tasks=[itSearch(t,a).catch(()=>[]),olSearch(t,lastName(a),8).catch(()=>[]),gbSearch(`intitle:${t} inauthor:${lastName(a)}`,10,'&langRestrict=en').catch(()=>[])];
  const [it,ol,gb]=await Promise.all(tasks);
  for(const r of [...it,...ol,...gb])if(ok(r)&&!out.some(x=>x.big===r.big))out.push(r);
  return out;
}
function imgOK(url){return new Promise(res=>{const i=new Image();i.referrerPolicy='no-referrer';i.onload=()=>{const w=i.naturalWidth,h=i.naturalHeight;res(w>=60&&h>=80&&w/h<0.9&&w/h>0.45);};i.onerror=()=>res(false);i.src=url;});}
async function storeBlob(b,blob){await IDB.set('covers',b.id,blob);const old=coverURL.get(b.id);if(old)URL.revokeObjectURL(old);coverURL.set(b.id,URL.createObjectURL(blob));b.c='idb';}
async function saveCoverFrom(b,url){
  if(!url)return false;
  try{const r=await fetch(url,{referrerPolicy:'no-referrer'});if(r.ok){const blob=await r.blob();if(blob.size>2500&&/^image\//.test(blob.type)){const u=URL.createObjectURL(blob);const good=await imgOK(u);URL.revokeObjectURL(u);if(good){await storeBlob(b,blob);delete b.nc;mark();renderAll();return true;}return false;}}}catch(e){}
  if(await imgOK(url)){b.c=url;delete b.nc;mark();renderAll();return true;}
  return false;
}
async function autoCover(b){
  let cands=[];try{cands=await coverCandidates(b);}catch(e){}
  for(const c of cands.slice(0,5)){if(await saveCoverFrom(b,c.big))return true;}
  return false;
}
const coverQ={list:[],running:false,done:0,total:0};
function queueCovers(ids){for(const id of ids)if(!coverQ.list.includes(id)){coverQ.list.push(id);coverQ.total++;const b=byId(id);if(b)b.nc=1;}mark();runCovers();}
async function runCovers(){
  if(coverQ.running)return;coverQ.running=true;renderBanners();
  while(coverQ.list.length){
    if(!navigator.onLine){await sleep(5000);continue;}
    const id=coverQ.list.shift();const b=byId(id);
    if(b&&!b.c){const ok=await autoCover(b);if(!ok){b.nc=0;mark();}}
    coverQ.done++;renderBanners();await sleep(350);
  }
  coverQ.running=false;coverQ.done=coverQ.total=0;renderBanners();
}
async function coverPicker(b){
  openSheet(`<div class="sh-head" style="grid-template-columns:1fr auto"><div style="display:grid;gap:4px"><span class="kicker">Cover</span><h3>${esc(b.t)}</h3></div>${X}</div><div id="cpick" class="cgrid"><div class="hint">Looking for covers…</div></div><div class="actions"><label class="btn ghost" for="fcov">Use a photo instead</label><input type="file" id="fcov" accept="image/*" hidden><button class="btn ghost" data-act="book" data-id="${b.id}">Back</button></div>`);
  sheetBook=b.id;
  let c=[];try{c=await coverCandidates(b);}catch(e){}
  if(!$('cpick'))return;
  coverPicker.items=c;
  $('cpick').innerHTML=c.length?c.slice(0,12).map((r,i)=>`<button class="cpk" data-act="usecover" data-i="${i}"><div class="cv"><img src="${esc(r.img||r.big)}" alt="" referrerpolicy="no-referrer"></div><span>${esc(r.src)}</span></button>`).join(''):`<div class="hint">${navigator.onLine?'No covers found. Use a photo of the book instead.':'You are offline. Try again when you have a connection.'}</div>`;
}

/* ---------- new books and releases ---------- */
function followedAuthors(){
  const S=bySeries();const out=new Map();
  for(const [s,list] of S){if(s==='Standalone')continue;if(list.every(b=>b.st==='DNF'))continue;for(const b of list){const k=lastName(b.a);if(k&&!out.has(k))out.set(k,b.a);}}
  for(const b of books)if(b.av==='No'){const k=lastName(b.a);if(k&&!out.has(k))out.set(k,b.a);}
  return [...out.values()];
}
let checking=false;
async function checkNew(manual){
  if(checking)return;if(!navigator.onLine){if(manual)toast('You are offline.');return;}
  checking=true;if(manual)toast('Checking for new books…');
  const authors=followedAuthors().slice(0,60);const have=new Set(books.map(b=>normT(baseTitle(b.t))));
  const dismissed=new Set(D.dismissed||[]);const found=[];const released=[];const minYear=+THISYEAR-2;
  for(const a of authors){
    let items=[];
    try{items=await gbSearch(`inauthor:"${author(a)}"`,30,'&orderBy=newest&langRestrict=en');}catch(e){items=[];}
    for(const r of items){
      if(!r.t||!amatch(a,r.a)||BAD.test(r.t)||BAD.test(r.sub||''))continue;
      if(r.lang&&r.lang!=='en')continue;
      const p=parseSeriesTitle(r.t);const key=normT(baseTitle(p.t));if(!key)continue;
      // unreleased book in library now out?
      const mine=books.find(b=>b.av==='No'&&normT(baseTitle(b.t))===key&&lastName(b.a)===lastName(a));
      if(mine&&r.date){if(r.date.length>=10&&r.date<=TODAY){mine.av='Yes';mine.no='Released '+niceDate(r.date);released.push(mine);if(!mine.c)queueCovers([mine.id]);}else if(r.date>TODAY&&!/^Releases/.test(mine.no||'')){mine.no='Releases '+niceDate(r.date);}continue;}
      if(have.has(key)||dismissed.has(key+'|'+lastName(a))||found.some(f=>f.key===key))continue;
      const y=+(r.year||0);if(!y||y<minYear)continue;
      const mySeries=[...new Set(books.filter(b=>lastName(b.a)===lastName(a)&&b.s!=='Standalone').map(b=>b.s))];
      const sGuess=(r.series||p.s)?(mySeries.find(s=>normT(s)===normT(r.series||p.s))||r.series||p.s):(mySeries.length===1?mySeries[0]:'');
      found.push({key,t:p.t,a,date:r.date||r.year,s:sGuess,n:r.n||p.n||'',img:r.img,big:r.big,future:(r.date||'')>TODAY});
    }
    await sleep(250);
  }
  D.found=found;D.lastCheck=TODAY;mark();checking=false;renderAll();
  if(released.length)toast(`${released.map(b=>b.t).join(', ')} ${released.length===1?'is':'are'} out now.`);
  else if(manual)toast(found.length?`Found ${found.length} new book${found.length===1?'':'s'}.`:'No new books right now.');
  if(manual&&found.length)foundSheet();
}
function foundSheet(){
  const f=D.found||[];
  openSheet(`<div class="sh-head" style="grid-template-columns:1fr auto"><div style="display:grid;gap:4px"><span class="kicker">From authors you read</span><h3>New and upcoming books</h3></div>${X}</div>
  ${f.length?`<p class="hint" style="margin:0">Pulled from Google Books. Double check series and order before adding.</p><div style="display:grid;gap:8px">${f.map((r,i)=>`<div class="frow"><span class="rcv">${r.img?`<img src="${esc(r.img)}" alt="" referrerpolicy="no-referrer">`:''}</span><span class="bt"><b>${esc(r.t)}</b><span>${esc(author(r.a))} · ${r.future?'Coming '+esc(niceDate(r.date)):'Out '+esc(niceDate(r.date))}${r.s?' · '+esc(r.s)+(r.n?' #'+r.n:''):''}</span></span><span class="factions"><button class="btn gold small" data-act="addfound" data-i="${i}">Add</button><button class="btn ghost small" data-act="skipfound" data-i="${i}">Skip</button></span></div>`).join('')}</div>`:'<div class="emptybox">Nothing new right now.</div>'}
  <div class="actions"><button class="btn ghost" data-act="checknew">Check again</button></div>`);
}
function addFound(i){const r=D.found[i];if(!r)return;D.found.splice(i,1);mark();addSheet({t:r.t,a:r.a,s:r.s,n:r.n,date:r.date,img:r.big||'',direct:true});}
function skipFound(i){const r=D.found[i];if(!r)return;D.dismissed.push(r.key+'|'+lastName(r.a));D.found.splice(i,1);mark();renderAll();foundSheet();}

/* ---------- settings, import, export ---------- */
function settingsSheet(){
  const missing=books.filter(b=>!b.c).length;
  openSheet(`<div class="sh-head" style="grid-template-columns:1fr auto"><div style="display:grid;gap:4px"><span class="kicker">Settings</span><h3>${esc(appTitle())}</h3></div>${X}</div>
  <div class="field"><label for="s-name">Your name</label><input class="inp" id="s-name" value="${esc(D.settings.name||'')}" placeholder="Shows as Your Name's TBR"></div>
  <div class="field"><span class="lab">Books</span><div class="actions"><button class="btn ghost small" data-act="importsheet">Import from Goodreads, StoryGraph or Libby</button><button class="btn ghost small" data-act="checknew">Check for new books</button>${missing?`<button class="btn ghost small" data-act="allcovers">Find ${missing} missing cover${missing===1?'':'s'}</button>`:''}</div><span class="hint">${D.lastCheck?'Last checked for new books '+esc(niceDate(D.lastCheck))+'. ':''}New books are checked automatically about once a week when you open the app.</span></div>
  <div class="field"><span class="lab">Backup</span><div class="actions"><button class="btn ghost small" data-act="export">Save a backup</button><label class="btn ghost small" for="f-restore">Restore a backup</label><input type="file" id="f-restore" accept=".json,application/json" hidden></div><span class="hint">Your library lives only on this device. Save a backup now and then, and use it to move to a new phone.</span></div>
  <div class="field"><span class="lab">Start over</span><div class="actions"><button class="btn ghost small danger" data-act="wipe">Erase everything</button></div></div>
  <p class="hint" style="margin:0">Version ${VERSION}. Covers and book info come from Open Library, Apple Books and Google Books.</p>`);
}
async function exportBackup(){
  const covers={};
  for(const b of books){if(b.c==='idb'){try{const blob=await IDB.get('covers',b.id);if(blob)covers[b.id]=await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(blob);});}catch(e){}}}
  const data=JSON.stringify({app:'tbr',version:1,saved:new Date().toISOString(),data:D,covers});
  const name=`tbr-backup-${TODAY}.json`;const file=new File([data],name,{type:'application/json'});
  try{if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:name});return;}}catch(e){if(e&&e.name==='AbortError')return;}
  const a=document.createElement('a');a.href=URL.createObjectURL(file);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
}
async function restoreBackup(file){
  try{const j=JSON.parse(await file.text());if(!j||j.app!=='tbr'||!j.data||!Array.isArray(j.data.books))throw new Error('bad');
    if(books.length&&!confirm(`Replace the ${books.length} books on this device with the ${j.data.books.length} in this backup?`))return;
    await IDB.clear('covers');for(const u of coverURL.values())URL.revokeObjectURL(u);coverURL.clear();
    D=Object.assign({books:[],queue:[],settings:{name:''},found:[],dismissed:[],lastCheck:''},j.data);books=D.books;
    for(const [id,durl] of Object.entries(j.covers||{})){try{const blob=await (await fetch(durl)).blob();await IDB.set('covers',+id,blob);coverURL.set(+id,URL.createObjectURL(blob));}catch(e){}}
    await persist();askPersist();closeSheet();renderAll();toast(`Restored ${books.length} books.`);
  }catch(e){toast('That file is not a TBR backup.');}
}


/* ---------- import: Goodreads, StoryGraph, Libby (shared) ---------- */
const IMP={items:[],src:'',p:'Medium',shotSt:''};
const impLast=a=>String(a||'').split('&')[0].split(',')[0].trim();
function impCSV(text){
  const rows=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++;}else q=false;}else f+=c;}
    else if(c==='"')q=true;else if(c===','){row.push(f);f='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(f);rows.push(row);row=[];f='';}else f+=c;}
  if(f||row.length){row.push(f);rows.push(row);}
  return rows.filter(r=>r.some(x=>String(x).trim()!==''));
}
function impSeriesTitle(t){
  const m=String(t).match(/^(.*?)\s*\(([^()]+?)(?:,|\s)\s*#\s*(\d+(?:\.\d+)?)[^()]*\)\s*$/);
  if(m)return{t:m[1].trim(),s:m[2].split(';')[0].replace(/,\s*$/,'').trim(),n:parseFloat(m[3])};
  return{t:String(t).replace(/\s*\((?:[^()]*?#[^()]*)\)\s*$/,'').trim(),s:'',n:null};
}
function impLF(a){a=String(a||'').trim();if(!a||a.includes(','))return a;const p=a.split(/\s+/);if(p.length<2)return a;const last=p.pop();return `${last}, ${p.join(' ')}`;}
function impDate(s){s=String(s||'').trim();if(!s)return '';if(/^\d{10,13}$/.test(s)){const d=new Date(+s<1e12?+s*1000:+s);return isNaN(d)?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  let m=s.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m=s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);if(m)return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  const d=new Date(s);return isNaN(d)?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function impParse(text,name){
  text=String(text).replace(/^﻿/,'');
  // Libby JSON
  if(/^\s*[\[{]/.test(text)){
    let j;try{j=JSON.parse(text);}catch(e){throw new Error('format');}
    const arr=Array.isArray(j)?j:(j.timeline||j.data||Object.values(j).find(v=>Array.isArray(v))||[]);
    return{src:'Libby',items:impLibby(arr.map(e=>({title:e.title&&e.title.text||e.title,author:e.author&&e.author.text||e.author,activity:e.activity,timestamp:e.timestamp||e.date,format:e.cover&&e.cover.format||e.format})))};
  }
  const rows=impCSV(text);if(rows.length<2)throw new Error('format');
  const H=rows[0].map(h=>h.trim().toLowerCase());const col=(...n)=>{for(const x of n){const i=H.indexOf(x);if(i>-1)return i;}return -1;};
  const iT=col('title'),iA=col('author l-f','author','authors');
  const known=H.includes('activity')||H.includes('exclusive shelf')||H.includes('read status');
  if(!known)return{src:'Spreadsheet',map:true,H:rows[0].map(h=>h.trim()),rows:rows.slice(1)};
  if(iT<0||iA<0)throw new Error('format');
  const v=(r,i)=>i>-1?String(r[i]||'').trim():'';
  if(H.includes('activity')){
    const iAc=col('activity'),iTs=col('timestamp','date'),iF=col('format');
    return{src:'Libby',items:impLibby(rows.slice(1).map(r=>({title:v(r,iT),author:v(r,iA),activity:v(r,iAc),timestamp:v(r,iTs),format:v(r,iF)})))};
  }
  const gr=H.includes('exclusive shelf');const sg=H.includes('read status');
  const iR=col('my rating','star rating'),iD=col('date read','last date read'),iSh=col('exclusive shelf','read status'),iShs=col('bookshelves'),iDS=col('date started','dates read');
  const items=[];
  for(const r of rows.slice(1)){
    const raw=v(r,iT);if(!raw)continue;
    let a=v(r,iA);if(sg)a=a.split(',')[0].trim();
    const A=H[iA]==='author l-f'?a:impLF(a);
    const p=impSeriesTitle(raw);
    const shelf=(v(r,iSh)+' '+v(r,iShs)).toLowerCase();
    let st='Unread';
    if(/currently-reading/.test(shelf))st='Reading';
    else if(/did-not-finish|\bdnf\b|abandon/.test(shelf))st='DNF';
    else if(/(^|\s)read(\s|$)/.test(v(r,iSh).toLowerCase()))st='Read';
    let rating=v(r,iR);if(/^0(\.0)?$/.test(rating))rating='';
    const df=st==='Read'?impDate(v(r,iD)):'';
    let ds='';if(iDS>-1){const m=v(r,iDS).match(/\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/);if(m)ds=impDate(m[0]);}
    items.push({t:p.t,a:A,s:p.s,n:p.n,st,r:st==='Read'?rating:'',df,ds,known:gr});
  }
  return{src:gr?'Goodreads':sg?'StoryGraph':'CSV',items};
}
function impLibby(events){
  const by=new Map();
  for(const e of events){const t=String(e.title||'').trim();if(!t)continue;const k=t.toLowerCase();
    const ts=impDate(e.timestamp);const act=String(e.activity||'').toLowerCase();
    const g=by.get(k)||{t,a:impLF(String(e.author||'').split(',')[0]),borrowed:'',returned:'',hold:false,fmt:e.format||''};
    if(/borrow/.test(act)&&(!g.borrowed||ts<g.borrowed))g.borrowed=ts;
    if(/return/.test(act)&&(!g.returned||ts>g.returned))g.returned=ts;
    if(/hold/.test(act))g.hold=true;
    by.set(k,g);}
  return [...by.values()].map(g=>{const p=impSeriesTitle(g.t);const st=g.returned?'Read':g.borrowed?'Reading':'Unread';
    return{t:p.t,a:g.a,s:p.s,n:p.n,st,r:'',df:st==='Read'?g.returned:'',ds:g.borrowed||'',fmt:g.fmt};});
}
const impHave=it=>books.some(b=>normT(b.t)===normT(it.t)&&normT(impLast(b.a))===normT(impLast(it.a)));
function importStart(){
  if(!IMP.shotSt)IMP.shotSt=SHOT_ST()[0][0];
  openSheet(`<div class="sh-head" style="grid-template-columns:1fr auto"><div style="display:grid;gap:4px"><span class="kicker">Import</span><h3>Bring your books over</h3></div>${X}</div>
  <div class="imp-src"><b>Goodreads</b><span>On goodreads.com in a browser: My Books, then Import and export (left side), then Export Library. Download the file when it is ready.</span></div>
  <div class="imp-src"><b>StoryGraph</b><span>In StoryGraph: your profile, then Manage Account, then Export StoryGraph Library. Download the file when it is ready.</span></div>
  <div class="imp-src"><b>Libby</b><span>In Libby: Shelf, then Timeline, then Actions, then Export Timeline, then Spreadsheet. Save the file.</span></div>
  <div class="imp-src shots"><b>Screenshots (Kindle, Apple Books, Audible, anywhere)</b><span>Take screenshots of your library and add them all at once. List view works best because the titles and authors show as text. Photos of your shelf work too.</span>
    <div class="seg" style="margin-top:6px">${SHOT_ST().map(([v,l])=>`<button type="button" data-act="shotst" data-v="${v}" aria-pressed="${IMP.shotSt===v}">${l}</button>`).join('')}</div>
    <div class="actions" style="margin-top:6px"><label class="btn ghost" for="imp-shots">Choose screenshots</label><input type="file" id="imp-shots" accept="image/*" multiple hidden></div></div>
  <div class="imp-src"><b>Your own spreadsheet</b><span>Any CSV with a header row works, from Excel, Numbers or Google Sheets. You match the columns on the next screen. <button class="link" data-act="imptpl" style="padding:0">Get a blank template</button></span></div>
  <div class="imp-src"><b>Kindle, Audible, Apple Books</b><span>These do not offer an export. Add those books with the + button instead.</span></div>
  <div class="actions"><label class="btn gold" for="imp-file">Choose a file</label><input type="file" id="imp-file" accept=".csv,.json,.txt,text/csv,application/json" hidden></div>
  <div class="field"><label for="gs-url">Or paste a Google Sheets link</label><div class="gsrow" style="display:flex;gap:8px"><input class="inp" id="gs-url" placeholder="https://docs.google.com/spreadsheets/d/…" style="flex:1;min-width:0" autocapitalize="off"><button class="btn ghost" data-act="impgs">Import</button></div><span class="hint">The sheet needs sharing set to Anyone with the link.</span></div>
  <span class="hint" id="imp-msg">You will see every book before anything is added.</span>`);
}
async function importFile(file){
  let text='';try{text=await file.text();}catch(e){}
  importText(text);
}
function importText(text){
  let parsed;try{parsed=impParse(text,'');}catch(e){$('imp-msg').textContent='Could not read that file. It needs to be a CSV with a header row.';return;}
  if(parsed.map){IMP.map=parsed;return importMap();}
  importItems(parsed);
}
function importItems(parsed){
  IMP.src=parsed.src;IMP.items=parsed.items.map(it=>Object.assign(it,{have:impHave(it),on:!impHave(it)}));
  if(!IMP.items.length){$('imp-msg').textContent='No books found in that file.';return;}
  importReview();
  if(typeof impFillSeries==='function')impFillSeries();
}
const IMP_FIELDS=[['t','Title',/^(book\s*)?(title|name)$|^book$/i],['a','Author',/author|writer/i],['s','Series',/^series(\s*name)?$|^series$/i],['n','Book #',/^(#|no\.?|num(ber)?|book\s*#|book\s*(no|number)|series\s*(#|no|number|order|position)|order|position|vol(ume)?)$/i],['st','Status',/status|shelf|state|^read\??$/i],['r','Rating',/rating|stars?|score/i],['df','Date finished',/finish|date\s*read|completed|end(ed)?\s*date|read\s*on|date\s*completed/i],['m','Month finished',/^month/i],['y','Year finished',/^year/i],['ds','Date started',/start/i],['p','Priority',/priority/i],['av','Released',/avail|released|out\??$/i],['no','Notes',/note|comment/i]];
function importMap(){
  const M=IMP.map;const H=M.H;const used=new Set();
  M.sel={};for(const [k,,re] of IMP_FIELDS){let i=H.findIndex((h,j)=>!used.has(j)&&re.test(h));if(k==='s')i=H.findIndex((h,j)=>!used.has(j)&&/series/i.test(h)&&!/#|no|num|order|position/i.test(h));if(i>-1){used.add(i);M.sel[k]=i;}else M.sel[k]=-1;}
  const ex=M.rows.find(r=>r.some(x=>x.trim()))||[];
  openSheet(`<div class="sh-head" style="grid-template-columns:1fr auto"><div style="display:grid;gap:4px"><span class="kicker">Import a spreadsheet</span><h3>Match your columns</h3></div>${X}</div>
  <p class="hint" style="margin:0">${M.rows.length} rows found. I matched what I could. Fix anything that is wrong, then tap Next. Only Title and Author are required.</p>
  <div class="imp-map">${IMP_FIELDS.map(([k,l])=>`<label class="imp-mrow"><span>${l}${k==='t'||k==='a'?' *':''}</span><select class="imp-msel" data-k="${k}"><option value="-1">Not in my sheet</option>${H.map((h,i)=>`<option value="${i}"${M.sel[k]===i?' selected':''}>${esc(h||'Column '+(i+1))}${ex[i]?' (e.g. '+esc(String(ex[i]).slice(0,24))+')':''}</option>`).join('')}</select></label>`).join('')}</div>
  <button class="btn gold" data-act="impmapgo" style="width:100%">Next</button>`);
}
function impStatus(v,hasDone){v=String(v||'').toLowerCase();
  if(/dnf|did.?not|abandon|gave up|quit/.test(v))return 'DNF';
  if(/currently|reading|in progress|started|current/.test(v))return 'Reading';
  if(/^(read|finished|done|completed|yes|y|true|x|✓|✔)$|finished|completed|^read\b/.test(v))return 'Read';
  if(/to.?read|want|tbr|unread|not started|next|queue|wishlist|^no$/.test(v))return 'Unread';
  return hasDone?'Read':'Unread';}
function impPrio(v){v=String(v||'').toLowerCase();if(/high|top|must|^1$/.test(v))return 'High';if(/low|maybe|^3$/.test(v))return 'Low';if(/sample|test|try/.test(v))return 'Test First';if(/med|^2$/.test(v))return 'Medium';return '';}
function impRating(v){v=String(v||'').trim();if(!v)return '';const st=(v.match(/★/g)||[]).length+((v.match(/½/g)||[]).length?0.5:0);if(st)return String(st);const n=parseFloat(v.replace(',','.'));if(isNaN(n)||n<=0)return '';return String(n>5?Math.round(n/2*10)/10:n);}
function impMonth(v){v=String(v||'').trim();if(!v)return '';if(/^\d{1,2}$/.test(v)){const i=+v-1;return MONTHS[i]||'';}const k=v.slice(0,3).toLowerCase();return MONTHS.find(m=>m.toLowerCase()===k)||'';}
function importMapGo(){
  const M=IMP.map;document.querySelectorAll('.imp-msel').forEach(s=>M.sel[s.dataset.k]=+s.value);
  if(M.sel.t<0||M.sel.a<0){toast('Pick the Title and Author columns.');return;}
  const g=(r,k)=>M.sel[k]>-1?String(r[M.sel[k]]||'').trim():'';
  const items=[];
  for(const r of M.rows){
    const raw=g(r,'t');if(!raw)continue;
    const p=impSeriesTitle(raw);
    let s=g(r,'s')||p.s;let n=parseFloat(g(r,'n'));if(isNaN(n))n=p.n;
    const rating=impRating(g(r,'r'));let df=impDate(g(r,'df'));
    const m=impMonth(g(r,'m'));const y=(g(r,'y').match(/\d{4}/)||[''])[0];
    const st=M.sel.st>-1?impStatus(g(r,'st'),!!(df||rating||(m&&y))):((df||rating||(m&&y))?'Read':'Unread');
    const avv=g(r,'av').toLowerCase();
    items.push({t:p.t,a:impLF(g(r,'a')),s,n:n==null||isNaN(n)?null:n,st,r:st==='Read'?rating:'',df:st==='Read'?df:'',m:st==='Read'&&!df?m:'',y:st==='Read'&&!df?y:'',ds:impDate(g(r,'ds')),pr:impPrio(g(r,'p')),av:/^(no|n|false|not yet|unreleased)$/.test(avv)?'No':'Yes',no:g(r,'no')});
  }
  if(!items.length){toast('No rows with a title found.');return;}
  importItems({src:'your spreadsheet',items});
}
async function importSheetLink(){
  const u=($('gs-url').value||'').trim();const msg=$('imp-msg');
  const m=u.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);if(!m){msg.textContent='That does not look like a Google Sheets link.';return;}
  const gid=(u.match(/[#&?]gid=(\d+)/)||[])[1]||'0';
  msg.textContent='Opening your sheet…';
  try{const r=await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&gid=${gid}`);if(!r.ok)throw new Error(r.status);const text=await r.text();if(/^\s*</.test(text))throw new Error('private');importText(text);}
  catch(e){msg.innerHTML='Could not open that sheet. In Google Sheets tap <b>Share</b> and set General access to <b>Anyone with the link</b>, then try again. Or use <b>File, Download, CSV</b> and choose that file above.';}
}
function impTemplate(){
  const csv='Title,Author,Series,Book #,Status,Rating,Date Finished,Priority,Notes\n"Red Rising","Pierce Brown","Red Rising Saga",1,Read,5,2025-07-04,High,\n"Golden Son","Pierce Brown","Red Rising Saga",2,To read,,,High,\n';
  const blob=new Blob([csv],{type:'text/csv'});
  if(typeof dl!=='undefined'&&dl){dl.save({filename:'tbr-template.csv',data:blob}).catch(()=>{});return;}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='tbr-template.csv';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
}

/* ---------- screenshots: read titles from pictures of a library ---------- */
async function importShots(files){
  files=[...files].filter(f=>/^image\//.test(f.type)||/\.(png|jpe?g|heic|webp)$/i.test(f.name));if(!files.length)return;
  const msg=$('imp-msg');const prog=(i,n,extra)=>{if(msg)msg.textContent=`Reading screenshot ${Math.min(i+1,n)} of ${n}…${extra?' '+extra:''}`;};
  let items=[];
  try{items=await shotsToItems(files,IMP.shotSt||'Read',prog);}
  catch(e){if(msg)msg.textContent=e&&e.message==='offline'?'You are offline. Try again with a connection.':'Could not read those screenshots. Try clearer ones, or list view.';return;}
  const seen=new Set();items=items.filter(it=>{const k=normT(it.t)+'|'+normT(impLast(it.a));if(!it.t||seen.has(k))return false;seen.add(k);return true;});
  if(!items.length){if(msg)msg.textContent='Could not find any books in those screenshots. List view with titles showing works best.';return;}
  importItems({src:'your screenshots',items});
}
async function shrinkImage(file,max){
  try{const bmp=await createImageBitmap(file);const sc=Math.min(1,max/Math.max(bmp.width,bmp.height));if(sc>=1&&file.size<1.5e6)return file;
    const c=document.createElement('canvas');c.width=Math.round(bmp.width*sc);c.height=Math.round(bmp.height*sc);c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    return await new Promise(r=>c.toBlob(b=>r(b||file),'image/jpeg',0.86));}catch(e){return file;}
}

const SHOT_ST=()=>[['Read','All read'],['Reading','Reading'],['Unread','Want to read']];
const SHOT_NOISE=/^(library|all|books?|audiobooks?|samples?|finished|want to read|reading now|currently reading|collections?|downloaded|downloads|sort|sort by|filter|edit|select|search|home|store|book store|read|unread|kindle|apple books|audible|libby|shelf|list|grid|recent|title|author|more|done|cancel|see all|view all|new|sample|pdfs?|my books|loans|holds|tags|notes|highlights)$/i;
async function shotsToItems(files,defSt,prog){
  if(!navigator.onLine)throw new Error('offline');
  const T=await loadTess();const lines=[];
  for(let i=0;i<files.length;i++){
    prog(i,files.length,'(the first one takes longest)');
    try{const img=await shrinkImage(files[i],2400);const r=await T.recognize(img,'eng');
      for(const l of r.data.lines||[]){if(l.confidence<55)continue;const t=l.text.replace(/[|_~^*<>{}\[\]]/g,' ').replace(/\s+/g,' ').trim();if(t)lines.push(t);}}catch(e){}
  }
  const cand=[];const seen=new Set();
  for(const raw of lines){
    let t=raw.replace(/^by\s+/i,'').replace(/\s*\d{1,3}\s*%.*$/,'').replace(/\s*[·•]\s*.*$/,'').trim();
    if(t.length<3||SHOT_NOISE.test(t)||/^\d+([:.,]\d+)*\s*(h|hr|hrs|m|min|mins|left|pages?)?\b/i.test(t)||!/[a-z]{2}/i.test(t))continue;
    const k=normT(t);if(seen.has(k))continue;seen.add(k);cand.push(t);
  }
  const out=[];const authors=new Set();
  for(let i=0;i<cand.length&&i<150;i++){
    const t=cand[i];if(authors.has(normT(t)))continue;
    prog(files.length-1,files.length,`Matching ${i+1} of ${Math.min(cand.length,150)}…`);
    let hits=[];try{hits=await olSearch(t,'',5);}catch(e){}
    if(!hits.length){try{hits=await gbSearch(`intitle:${t}`,5);}catch(e){}}
    const nt=normT(t.replace(/^(the|a|an)\s+/i,''));
    const hit=hits.find(h=>{const ht=normT(baseTitle(parseSeriesTitle(h.t).t).replace(/^(the|a|an)\s+/i,''));return ht&&h.a&&(ht===nt||(nt.length>=8&&(ht.startsWith(nt)||nt.startsWith(ht))));});
    if(hit){const p=parseSeriesTitle(hit.t);out.push({t:p.t,a:toLastFirst(hit.a),s:hit.series||p.s||'',n:hit.n||p.n||null,st:defSt,r:'',df:'',ds:''});authors.add(normT(hit.a));}
    await sleep(200);
  }
  return out;
}
const IMP_ST=[['Unread','To read'],['Reading','Reading'],['Read','Read'],['DNF','DNF']];
function importReview(){
  const L=IMP.items;const fresh=L.filter(x=>!x.have).length;
  openSheet(`<div class="sh-head" style="grid-template-columns:1fr auto"><div style="display:grid;gap:4px"><span class="kicker">Import from ${esc(IMP.src)}</span><h3>${fresh} new book${fresh===1?'':'s'}</h3></div>${X}</div>
  ${IMP.src==='Libby'?'<p class="hint" style="margin:0">Libby does not record whether you finished a book. Returned books are marked Read and loans still out are marked Reading. Change any that are wrong.</p>':''}
  <div class="actions"><button class="btn ghost small" data-act="impall" data-v="1">Select all new</button><button class="btn ghost small" data-act="impall" data-v="0">Select none</button></div>
  <div class="field"><span class="lab">Priority for books you have not read</span><div class="seg">${[['High','High'],['Medium','Medium'],['Test First','Sample'],['Low','Low']].map(([v,l])=>`<button type="button" data-act="impp" data-v="${v}" aria-pressed="${IMP.p===v}">${l}</button>`).join('')}</div></div>
  <span class="hint" id="imp-series"></span>
  <div class="imp-list">${L.map((it,i)=>`<div class="imp-row${it.have?' have':''}"><input type="checkbox" class="imp-cb" data-i="${i}" ${it.on?'checked':''} ${it.have?'disabled':''} aria-label="Import ${esc(it.t)}"><span class="bt"><b>${esc(it.t)}</b><span>${esc(author(it.a))}${it.s?' · '+esc(it.s)+(it.n!=null?' #'+it.n:''):''}${it.df?' · '+esc(it.df):''}${it.r?' · '+esc(it.r)+'★':''}${it.have?' · already in your library':''}</span></span><select class="imp-st" data-i="${i}" ${it.have?'disabled':''}>${IMP_ST.map(([v,l])=>`<option value="${v}"${it.st===v?' selected':''}>${l}</option>`).join('')}</select></div>`).join('')}</div>
  <button class="btn gold" data-act="impgo" style="width:100%">Import selected books</button>`);
}
function importCommit(){
  const picked=IMP.items.filter(it=>it.on&&!it.have);
  if(!picked.length){toast('Nothing selected.');return;}
  const S=[...new Set(books.map(b=>b.s))];let id=Math.max(0,...books.map(x=>x.id));const added=[];
  for(const it of picked){
    const sName=it.s?(S.find(x=>normT(x)===normT(it.s))||it.s):'Standalone';
    const b={id:++id,a:it.a,s:sName,t:it.t,n:it.n!=null?it.n:1,st:it.st,m:'',y:'',p:it.pr||(it.st==='Unread'?IMP.p:'Medium'),r:it.st==='Read'?(it.r||''):'',av:it.av||'Yes',no:it.no||''};
    if(it.st==='Read'&&!it.df&&it.m&&it.y){b.m=it.m;b.y=it.y;}
    if(it.ds&&it.st!=='Unread')b.ds=it.ds;
    if(it.st==='Read'&&it.df){b.df=it.df;const d=fromISO(it.df);b.m=d.m;b.y=d.y;}
    books.push(b);added.push(b);
  }
  importDone(added);
}
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.id==='imp-file'){const f=t.files&&t.files[0];if(f)importFile(f);}
  if(t.id==='imp-shots'){const f=t.files;if(f&&f.length)importShots(f);}
  if(t.classList&&t.classList.contains('imp-cb')){const it=IMP.items[+t.dataset.i];if(it)it.on=t.checked;}
  if(t.classList&&t.classList.contains('imp-st')){const it=IMP.items[+t.dataset.i];if(it)it.st=t.value;}
});
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-act]');if(!t)return;const a=t.dataset.act;
  if(a==='impstart'){importStart();}
  else if(a==='impgo'){importCommit();}
  else if(a==='impmapgo'){importMapGo();}
  else if(a==='impgs'){importSheetLink();}
  else if(a==='imptpl'){impTemplate();}
  else if(a==='shotst'){IMP.shotSt=t.dataset.v;t.parentElement.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===t));}
  else if(a==='impp'){IMP.p=t.dataset.v;t.parentElement.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===t));}
  else if(a==='impall'){const on=t.dataset.v==='1';IMP.items.forEach(it=>{if(!it.have)it.on=on;});document.querySelectorAll('.imp-cb:not(:disabled)').forEach(c=>c.checked=on);}
});

/* ---------- find on (shared) ---------- */
const EXT='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>';
function openLinks(b){
  const full=b.t+' '+author(b.a);const q=encodeURIComponent(full);
  const L=(n,u)=>`<a class="btn ghost small" href="${u}" target="_blank" rel="noopener">${n} ${EXT}</a>`;
  const row=(lab,items)=>`<div class="fo"><span class="fo-l">${lab}</span><div class="actions">${items.join('')}</div></div>`;
  const lib=(getLibby()||'').trim();
  const libby=lib?`https://libbyapp.com/search/${encodeURIComponent(lib)}/search/query-${encodeURIComponent(full)}/page-1`:'https://libbyapp.com/';
  const apple=b.ab||`https://www.google.com/search?q=${encodeURIComponent('site:books.apple.com '+full)}`;
  setTimeout(()=>resolveApple(b),0);setTimeout(()=>resolveAsin(b),0);
  const asin=b.asin||'';
  const kd=asin?`<a class="btn small" id="kdlink" href="kindle://book?action=open&asin=${esc(asin)}">Kindle app ${EXT}</a>`:b.amzs?`<a class="btn small" id="kdlink" href="${esc(b.amzs)}" target="_blank" rel="noopener">Kindle app ${EXT}</a>`:`<button class="btn small" id="kdlink" data-act="kdlink">Kindle app ${EXT}</button>`;
  const amz=`<a class="btn ghost small" id="amzlink" href="${asin?`https://www.amazon.com/dp/${esc(asin)}`:b.amzs?esc(b.amzs):`https://www.amazon.com/s?k=${q}&i=digital-text`}" target="_blank" rel="noopener">Amazon ${EXT}</a>`;
  return `<div class="fo-wrap">${row('Buy',[kd,amz,`<a class="btn ghost small" id="ablink" href="${esc(apple)}" target="_blank" rel="noopener">Apple Books ${EXT}</a>`,L('Kobo',`https://www.kobo.com/us/en/search?query=${q}`)])}
  <div id="kdset" hidden style="grid-template-columns:minmax(0,1fr);gap:6px;margin:2px 0 6px;min-width:0;max-width:100%"><span class="hint">To open this book in Kindle, the app needs its Amazon link once. Tap Amazon above, open the book, tap Share, then Copy Link, and paste it here. Kindle+ books use the same link as the store page.</span><div style="display:flex;gap:8px"><input class="inp" id="kdkey" placeholder="Paste Amazon link" autocapitalize="off" autocorrect="off" style="flex:1 1 0;width:auto;min-width:0"><button class="btn small" data-act="kdsave" style="flex:none">Save</button></div><span class="hint" id="kdmsg" style="color:var(--accent,#B4532A)"></span></div>
  ${row('Listen',[L('Audible',`https://www.audible.com/search?keywords=${q}`),L('Spotify',`https://open.spotify.com/search/${q}/audiobooks`)])}
  ${row('Borrow',[L('Libby',libby)])}
  ${lib?'':`<details class="libset"><summary class="hint">Set your library so Libby opens straight to this book</summary><div style="display:grid;gap:6px;margin-top:8px"><span class="hint">In Libby, open your library. The web address ends in its code, like libbyapp.com/library/<b>hcpl</b>. Type that code here.</span><input class="inp" id="libkey" placeholder="Library code" autocapitalize="off" autocorrect="off"></div></details>`}
  ${row('Track',[L('Goodreads',`https://www.goodreads.com/search?q=${q}`),L('StoryGraph',`https://app.thestorygraph.com/browse?search_term=${q}`)])}</div>`;
}
const asinTried=new Set();
function showAsin(b){if(sheetBook!==b.id)return;const k=document.getElementById('kdlink'),a=document.getElementById('amzlink'),d=document.getElementById('kdset');if(k)k.outerHTML=`<a class="btn small" id="kdlink" href="kindle://book?action=open&asin=${b.asin}">Kindle app ${EXT}</a>`;if(a)a.href=`https://www.amazon.com/dp/${b.asin}`;if(d){d.hidden=true;d.style.display='none';}}
document.addEventListener('click',e=>{const t=e.target.closest&&e.target.closest('[data-act="kdlink"]');if(!t)return;e.preventDefault();e.stopPropagation();const d=document.getElementById('kdset');if(d){d.hidden=!d.hidden;d.style.display=d.hidden?'none':'grid';if(!d.hidden){const i=document.getElementById('kdkey');i&&i.focus();}}},true);
async function resolveAsin(b){
  if(b.asin||asinTried.has(b.id))return;asinTried.add(b.id);
  try{const c=new AbortController();setTimeout(()=>c.abort(),7000);
    const ln=String(b.a||'').split('&')[0].split(',')[0].trim();
    const r=await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(String(b.t).replace(/\s*\(.*\)\s*$/,''))}&author=${encodeURIComponent(ln)}&fields=title,id_amazon&limit=5`,{signal:c.signal});
    const j=await r.json();const tw=normT(String(b.t).replace(/^(the|a|an)\s+/i,'')).slice(0,18);
    for(const d of (j.docs||[])){if(!normT(String(d.title||'').replace(/^(the|a|an)\s+/i,'')).startsWith(tw))continue;const hit=(d.id_amazon||[]).map(x=>String(x).trim().toUpperCase()).find(x=>/^B0[A-Z0-9]{8}$/.test(x));if(hit){b.asin=hit;showAsin(b);if(typeof IDB!=='undefined')mark();break;}}
  }catch(e){}
}
function parseAsin(v){v=String(v||'').trim();const m=v.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|[?&]asin=)([A-Z0-9]{10})/i)||v.match(/^([A-Z0-9]{10})$/i);return m?m[1].toUpperCase():'';}
function kdApply(v,quiet){if(sheetBook==null)return;const b=byId(sheetBook);if(!b)return;v=String(v||'').trim();if(!v){if(!quiet)toast('Paste the Amazon link first');return;}const id=parseAsin(v);
  const msg=t=>{const m=document.getElementById('kdmsg');if(m)m.textContent=t;toast(t);};
  const sh=v.match(/https?:\/\/a\.co\/[^\s]+/i);
  if(!id&&sh){b.amzs=sh[0];mark();if(typeof IDB==='undefined')setTimeout(()=>{const s=document.getElementById('saveBtn');if(s&&!s.hidden)s.click();},400);const k=document.getElementById('kdlink'),a=document.getElementById('amzlink'),d=document.getElementById('kdset');if(k)k.outerHTML=`<a class="btn small" id="kdlink" href="${esc(b.amzs)}" target="_blank" rel="noopener">Kindle app ${EXT}</a>`;if(a)a.href=b.amzs;if(d){d.hidden=true;d.style.display='none';}toast('Saved. Kindle app opens the book in Amazon, then tap Read for free.');return;}
  if(!id){if(quiet)return;msg(/a\.co\//i.test(v)?'That short a.co link hides the book ID. Open it in Safari, then copy the full amazon.com address.':'No Amazon book ID in that link');return;}
  b.asin=id;showAsin(b);mark();if(typeof IDB==='undefined')setTimeout(()=>{const s=document.getElementById('saveBtn');if(s&&!s.hidden)s.click();},400);toast('Kindle book linked');}
let kdT;document.addEventListener('input',e=>{if(e.target.id!=='kdkey')return;clearTimeout(kdT);const v=e.target.value;kdT=setTimeout(()=>kdApply(v,true),300);});
document.addEventListener('change',e=>{if(e.target.id==='kdkey')kdApply(e.target.value,true);});
document.addEventListener('click',e=>{const t=e.target.closest&&e.target.closest('[data-act="kdsave"]');if(!t)return;e.preventDefault();e.stopPropagation();const i=document.getElementById('kdkey');kdApply(i&&i.value,false);},true);
const appleTried=new Set();
async function resolveApple(b){
  if(b.ab||appleTried.has(b.id))return;appleTried.add(b.id);
  try{const c=new AbortController();setTimeout(()=>c.abort(),6000);
    const ln=String(b.a||'').split('&')[0].split(',')[0].trim().toLowerCase();
    const r=await fetch(`https://itunes.apple.com/search?entity=ebook&country=us&limit=10&term=${encodeURIComponent(String(b.t).replace(/\s*\(.*\)\s*$/,'')+' '+ln)}`,{signal:c.signal});
    const j=await r.json();const tw=normT(String(b.t).replace(/^(the|a|an)\s+/i,'')).slice(0,18);
    const hit=(j.results||[]).find(x=>String(x.artistName||'').toLowerCase().includes(ln)&&normT(String(x.trackName||'').replace(/^(the|a|an)\s+/i,'')).startsWith(tw))||(j.results||[]).find(x=>String(x.artistName||'').toLowerCase().includes(ln));
    if(hit&&hit.trackId){b.ab=`https://books.apple.com/us/book/id${hit.trackId}`;const el=document.getElementById('ablink');if(el&&sheetBook===b.id)el.href=b.ab;if(typeof IDB!=='undefined')mark();}
  }catch(e){}
}
document.addEventListener('change',e=>{const t=e.target;if(t.id==='libkey'){const v=t.value.trim().replace(/^.*\/library\//,'').replace(/[\/?#].*$/,'');if(v){setLibby(v);toast('Libby library saved');if(typeof sheetBook!=='undefined'&&sheetBook!=null)bookSheet(sheetBook);}}});
function getLibby(){return D.settings&&D.settings.libby||'';}
function setLibby(v){D.settings.libby=v;mark();}

function importDone(added){
  mark();askPersist();closeSheet();renderAll();
  toast(`Imported ${added.length} book${added.length===1?'':'s'}. Covers and series are loading in the background.`);
  queueCovers(added.map(b=>b.id));
  if(IMP.src!=='Goodreads')fillSeries(added.filter(b=>b.s==='Standalone'));
}
async function fillSeries(list){
  for(const b of list){if(!navigator.onLine)break;try{const f=await seriesFor(b.t,author(b.a));if(f&&f.s){const ex=seriesOptions().find(x=>normT(x)===normT(f.s));b.s=ex||f.s;if(f.n)b.n=f.n;mark();renderAll();}}catch(e){}await sleep(400);}
}

/* ---------- drag and drop ---------- */
const DR={t:null,on:false,src:null,kind:'',ghost:null,target:null,x:0,y:0,sx:0,sy:0,skip:false};
function qInsert(key,to){const from=D.queue.indexOf(key);if(from>-1){D.queue.splice(from,1);if(from<to)to--;}D.queue.splice(Math.max(0,Math.min(to,D.queue.length)),0,key);}
function dockRender(){const v=visQ();$('dockrow').innerHTML=v.length?v.map(i=>{const I=queueInfo(D.queue[i]);return `<div data-slot="${i}">${cover(I.shown,'','.3rem')}</div>`;}).join(''):`<div class="empty">Drop here to start your queue</div>`;}
function slotsFor(kind){if(kind==='q')return [...$('rail').querySelectorAll('[data-slot]')];if(kind==='l')return [...$('loggrid').querySelectorAll('[data-slot]')];return [...$('dockrow').querySelectorAll('[data-slot]')];}
function findGap(kind,x,y){const els=slotsFor(kind).filter(e=>e!==DR.src);if(!els.length)return null;let best=null,bd=1e9;for(const e of els){const r=e.getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2;const d=Math.hypot((x-cx),(y-cy)*1.4);if(d<bd){bd=d;best={e,r,cx};}}return{slot:+best.e.dataset.slot,after:x>best.cx,r:best.r,el:best.e};}
function showBar(g){const bar=$('dropbar');if(!g){bar.hidden=true;return;}const r=g.r;bar.hidden=false;bar.style.left=((g.after?r.right+5:r.left-7))+'px';bar.style.top=r.top+'px';bar.style.height=r.height+'px';}
function dragStart(){if(DR.on||!DR.src||!document.body.contains(DR.src)){DR.src=null;return;}dragCleanup();const el=DR.src;DR.on=true;document.body.classList.add('is-dragging');el.classList.add('dragging-src');try{navigator.vibrate&&navigator.vibrate(12)}catch(e){}const cv=el.querySelector('.cv');const g=document.createElement('div');g.className='dragghost';if(cv)g.appendChild(cv.cloneNode(true));document.body.appendChild(g);DR.ghost=g;if(DR.kind==='b'||DR.kind==='s'){dockRender();$('dock').hidden=false;}dragMove(DR.x,DR.y);}
function dragMove(x,y){
  DR.x=x;DR.y=y;if(DR.ghost){DR.ghost.style.left=x+'px';DR.ghost.style.top=y+'px';}
  if(DR.kind==='q'){const rail=$('rail');const rr=rail.getBoundingClientRect();if(x<rr.left+40)rail.scrollLeft-=10;else if(x>rr.right-40)rail.scrollLeft+=10;}
  if(DR.kind==='b'||DR.kind==='s'){const dr=$('dock').getBoundingClientRect();const over=y>dr.top-30;$('dock').classList.toggle('over',over);DR.target=over?(findGap('d',x,y)||{slot:D.queue.length,after:false,r:null}):null;showBar(DR.target&&DR.target.r?DR.target:null);return;}
  DR.target=findGap(DR.kind,x,y);showBar(DR.target);
}
function dragCleanup(){document.querySelectorAll('.dragghost').forEach(g=>g.remove());document.querySelectorAll('.dragging-src').forEach(x=>x.classList.remove('dragging-src'));document.body.classList.remove('is-dragging');const bar=$('dropbar');if(bar)bar.hidden=true;const dk=$('dock');if(dk){dk.hidden=true;dk.classList.remove('over');}DR.ghost=null;}
function dragEnd(commit){
  clearTimeout(DR.t);const was=DR.on;DR.t=null;
  if(was){
    document.body.classList.remove('is-dragging');DR.src&&DR.src.classList.remove('dragging-src');DR.ghost&&DR.ghost.remove();DR.ghost=null;$('dropbar').hidden=true;$('dock').hidden=true;$('dock').classList.remove('over');
    DR.skip=true;setTimeout(()=>DR.skip=false,400);const T=DR.target;
    if(commit&&T){
      if(DR.kind==='q'){const from=+DR.src.dataset.slot;const key=D.queue[from];qInsert(key,T.slot+(T.after?1:0));mark();renderAll();}
      else if(DR.kind==='l'){const list=period(ui.ly,ui.lm);const id=+DR.src.dataset.slot;const mv=list.find(b=>b.id===id);const rest=list.filter(b=>b.id!==id);let k=rest.findIndex(b=>b.id===T.slot);if(k<0)k=rest.length;if(T.after)k++;rest.splice(k,0,mv);rest.forEach((b,i)=>b.lo=i);mark();renderAll();toast('Order updated');}
      else{let key;if(DR.kind==='s')key=DR.src.dataset.s;else key=qKey(byId(+DR.src.dataset.id));
        if(key){const to=T.r?T.slot+(T.after?1:0):D.queue.length;qInsert(key,to);mark();renderAll();toast(`Added to Up next at #${qPos(D.queue.indexOf(key))||D.queue.indexOf(key)+1}`);}}
    }
  }
  DR.on=false;DR.src=null;DR.target=null;dragCleanup();
}
document.addEventListener('pointerdown',e=>{if(DR.on){dragEnd(false);return;}const el=e.target.closest('[data-drag]');if(!el||e.button>0)return;DR.src=el;DR.kind=el.dataset.drag;DR.sx=DR.x=e.clientX;DR.sy=DR.y=e.clientY;clearTimeout(DR.t);DR.t=setTimeout(dragStart,e.pointerType==='mouse'?180:380);});
document.addEventListener('pointermove',e=>{if(!DR.src)return;if(!DR.on){if(Math.hypot(e.clientX-DR.sx,e.clientY-DR.sy)>9){clearTimeout(DR.t);DR.src=null;}return;}e.preventDefault();dragMove(e.clientX,e.clientY);},{passive:false});
document.addEventListener('touchmove',e=>{if(!DR.on)return;e.preventDefault();const t=e.touches[0];if(t)dragMove(t.clientX,t.clientY);},{passive:false});
document.addEventListener('pointerup',()=>{if(DR.src)dragEnd(true);});
document.addEventListener('pointercancel',()=>{if(DR.on)return;if(DR.src)dragEnd(false);});
document.addEventListener('touchcancel',()=>{if(DR.on||DR.src)dragEnd(DR.on);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(DR.on||DR.src))dragEnd(false);});
window.addEventListener('blur',()=>{if(DR.on)dragEnd(false);});
setInterval(()=>{if(!DR.on&&document.querySelector('.dragghost'))dragCleanup();},1000);
document.addEventListener('touchend',()=>{if(DR.on)dragEnd(true);});
document.addEventListener('contextmenu',e=>{if(e.target.closest('[data-drag]'))e.preventDefault();});
document.addEventListener('click',e=>{if(DR.skip){e.stopPropagation();e.preventDefault();DR.skip=false;}},true);
document.addEventListener('dragstart',e=>{if(e.target.closest&&e.target.closest('[data-drag]'))e.preventDefault();});

/* ---------- actions ---------- */
function start(id){const b=byId(id);b.st='Reading';b.m='';b.y='';b.df='';if(!b.ds)b.ds=TODAY;mark();}
function settle(b){const k=qKey(b);const qi=D.queue.indexOf(k);if(qi>-1&&qBooks(k).every(x=>x.st==='Read'||x.st==='DNF'))D.queue.splice(qi,1);}
async function deleteBook(id){const b=byId(id);if(!b||!confirm(`Delete ${b.t}?`))return;const oldKey=qKey(b);books.splice(books.indexOf(b),1);try{await IDB.del('covers',id);}catch(e){}const u=coverURL.get(id);if(u){URL.revokeObjectURL(u);coverURL.delete(id);}if(!books.some(x=>qKey(x)===oldKey))D.queue=D.queue.filter(k=>k!==oldKey);mark();closeSheet();renderAll();toast('Deleted');}
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-act],[data-tab],[data-go]');if(!t)return;
  if(t.dataset.tab){setTab(t.dataset.tab);return;}
  if(t.dataset.go){setTab(t.dataset.go);return;}
  const a=t.dataset.act,id=+t.dataset.id;
  switch(a){
    case 'close':closeSheet();return;
    case 'finish':finishSheet(id);return;
    case 'book':bookSheet(id);return;
    case 'queue':queueSheet(+t.dataset.i);return;
    case 'start':start(id);closeSheet();toast('Moved to Currently reading');setTab('home');break;
    case 'dofinish':{const b=byId(id);b.st='Read';b.df=TODAY;b.m=MONTHS[NOW.getMonth()];b.y=THISYEAR;b.r=pendingRate;settle(b);mark();closeSheet();toast(`Logged ${b.t}`);break;}
    case 'dodnf':{const b=byId(id);b.st='DNF';b.m='';b.y='';settle(b);mark();closeSheet();break;}
    case 'pause':{byId(id).st='Unread';mark();closeSheet();break;}
    case 'rate':{const v=t.dataset.v;const rid=t.closest('.rate')?t.closest('.rate').querySelector('.rate-stars').dataset.rid:'';
      if(rid.startsWith('f')){pendingRate=v;$('frate').innerHTML=rateInput(v,rid);return;}
      if(rid==='a'){addState.r=v;$('a-rate').innerHTML=rateInput(v,'a');return;}
      const b=byId(sheetBook);b.r=v;mark();renderAll();bookSheet(sheetBook);return;}
    case 'set':{const b=byId(sheetBook);const f=t.dataset.f,v=t.dataset.v;b[f]=v;
      if(f==='st'){if(v==='Read'&&!b.m){b.df=b.df||TODAY;const d=fromISO(b.df);b.m=d.m;b.y=d.y;}if(v==='Reading'&&!b.ds)b.ds=TODAY;if(v!=='Read'){b.m='';b.y='';b.df='';}if(v==='Read'||v==='DNF')settle(b);}
      mark();renderAll();bookSheet(sheetBook);return;}
    case 'qadd':{const k=qKey(byId(id));if(!D.queue.includes(k))D.queue.push(k);mark();renderAll();bookSheet(id);toast('Added to Up next');return;}
    case 'qtop':{const k=qKey(byId(id));D.queue=D.queue.filter(x=>x!==k);D.queue.unshift(k);mark();renderAll();bookSheet(id);toast('Moved to the top of Up next');return;}
    case 'qremove':{const k=qKey(byId(id));D.queue=D.queue.filter(x=>x!==k);mark();renderAll();bookSheet(id);return;}
    case 'qmove':{const i=+t.dataset.i,d=+t.dataset.d,j=i+d;if(j<0||j>=D.queue.length)return;[D.queue[i],D.queue[j]]=[D.queue[j],D.queue[i]];mark();renderAll();queueSheet(j);return;}
    case 'qrmi':{D.queue.splice(+t.dataset.i,1);mark();closeSheet();break;}
    case 'rmcover':{const b=byId(sheetBook);delete b.c;IDB.del('covers',b.id).catch(()=>{});const u=coverURL.get(b.id);if(u){URL.revokeObjectURL(u);coverURL.delete(b.id);}mark();renderAll();bookSheet(sheetBook);return;}
    case 'pickcover':coverPicker(byId(sheetBook));return;
    case 'usecover':{const r=(coverPicker.items||[])[+t.dataset.i];const b=byId(sheetBook);if(!r||!b)return;t.disabled=true;saveCoverFrom(b,r.big).then(ok=>{if(ok){toast('Cover updated');bookSheet(b.id);}else{t.disabled=false;toast('That image did not load. Try another.');}});return;}
    case 'delbook':deleteBook(id);return;
    case 'month':ui.ly=THISYEAR;ui.lm=t.dataset.m;saveUi();renderLog();setTab('log');return;
    case 'year':ui.ly=t.dataset.y;ui.lm=undefined;saveUi();renderLog();return;
    case 'lm':if(t.disabled)return;ui.lm=t.dataset.m;saveUi();renderLog();return;
    case 'st':ui.st=t.dataset.s;saveUi();renderLib();return;
    case 'series':{const n=t.dataset.s;ui.open[n]=!ui.open[n];saveUi();renderLib();return;}
    case 'share':makeShare();return;
    case 'add':addSheet();return;
    case 'addto':addSheet({s:t.dataset.s,mode:'book'});return;
    case 'pickres':pickResult(+t.dataset.i);return;
    case 'confirmadd':confirmAdd();return;
    case 'manual':manualEntry();return;
    case 'sersearch':seriesSearch();return;
    case 'seradd':seriesAdd();return;
    case 'aset':{const f=t.dataset.f;addState[f]=t.dataset.v;t.parentElement.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===t));if(f==='st')addVis();if(f==='mode')addBody({s:addState.series});return;}
    case 'size':ui.size=t.dataset.s;saveUi();makeShare(lastKind);return;
    case 'kind':makeShare(t.dataset.k);return;
    case 'saveimg':saveImg();return;
    case 'settings':settingsSheet();return;
    case 'importsheet':importStart();return;
    case 'checknew':checkNew(true);return;
    case 'found':foundSheet();return;
    case 'addfound':addFound(+t.dataset.i);return;
    case 'skipfound':skipFound(+t.dataset.i);return;
    case 'allcovers':queueCovers(books.filter(b=>!b.c).map(b=>b.id));closeSheet();toast('Looking for covers. Keep the app open for a bit.');return;
    case 'export':exportBackup();return;
    case 'wipe':(async()=>{if(!confirm('Erase every book on this device? Save a backup first if you might want them back.'))return;D={books:[],queue:[],settings:{name:D.settings.name||''},found:[],dismissed:[],lastCheck:''};books=D.books;await IDB.clear('covers');for(const u of coverURL.values())URL.revokeObjectURL(u);coverURL.clear();await persist();closeSheet();renderAll();toast('Erased.');})();return;
    case 'hideinstall':ui.hideInstall=true;saveUi();renderBanners();return;
    default:return;
  }
  renderAll();
});
document.addEventListener('keydown',e=>{const g=e.target.closest&&e.target.closest('g[data-act]');if(g&&(e.key==='Enter'||e.key===' ')){e.preventDefault();g.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
document.addEventListener('change',async e=>{
  const t=e.target;
  if(t.id==='fcov'){const f=t.files&&t.files[0];const b=byId(sheetBook);if(f&&b){await storeBlob(b,f);delete b.nc;mark();renderAll();bookSheet(b.id);toast('Cover added');}return;}
  if(t.id==='a-cam'){const f=t.files&&t.files[0];if(f)scanCover(f);return;}
  if(t.id==='f-restore'){const f=t.files&&t.files[0];if(f)restoreBackup(f);return;}
  if(t.id==='s-name'){D.settings.name=t.value.trim();mark();renderAll();return;}
  const b=sheetBook!=null?byId(sheetBook):null;
  if(b&&(t.dataset.act==='setsel'||t.dataset.act==='setinp')){const f=t.dataset.f;const old=qKey(b);b[f]=t.value.trim();if(f==='t'){const k=qKey(b);D.queue=D.queue.map(x=>x===old?k:x);}mark();renderAll();return;}
  if(b&&t.dataset.act==='setauthor'){b.a=toLastFirst(t.value);mark();renderAll();return;}
  if(b&&t.dataset.act==='setseries'){const old=qKey(b);const v=t.value.trim();const ex=seriesOptions().find(x=>normT(x)===normT(v));b.s=ex||v||'Standalone';const k=qKey(b);if(D.queue.includes(old)&&!books.some(x=>x!==b&&qKey(x)===old))D.queue=D.queue.map(x=>x===old?k:x);cleanQueue();mark();renderAll();return;}
  if(b&&t.dataset.act==='setnum'){b.n=parseFloat(t.value)||0;mark();renderAll();return;}
  if(b&&t.dataset.act==='setdate'){b[t.dataset.f]=t.value;if(t.dataset.f==='df'&&t.value){const d=fromISO(t.value);b.m=d.m;b.y=d.y;}mark();renderAll();bookSheet(sheetBook);return;}
  if(t.id==='prio'){ui.prio=t.value;saveUi();renderLib();}
});
$('q').addEventListener('input',e=>{ui.q=e.target.value.trim();renderLib();});

/* ---------- roundup image ---------- */
const THEMES={
  night:{name:'Night',bg:'#0E1117',bg2:'#161B25',grad:true,glow:'rgba(237,181,78,.22)',ink:'#F1F2F5',muted:'#9AA1AF',faint:'#5B6271',accent:'#EDB54E',empty:'#2B313E',line:'#262C38',star:'#FFA41C',shadow:'rgba(0,0,0,.55)'},
  paper:{name:'Paper',bg:'#F3EDE2',bg2:'#E9E1D3',ink:'#1E1B16',muted:'#6E665A',faint:'#A39A8B',accent:'#B4532A',empty:'#DDD3C2',line:'#D9CFBD',star:'#E87400',shadow:'rgba(60,40,10,.28)'},
  forest:{name:'Forest',bg:'#1E3A2F',bg2:'#24453A',ink:'#F3EBDD',muted:'#B9C4B6',faint:'#7F9488',accent:'#E2B65C',empty:'#2F5245',line:'#2F5245',star:'#FFA41C',shadow:'rgba(0,0,0,.45)'},
  cobalt:{name:'Cobalt',bg:'#2340D0',bg2:'#2C4BDF',ink:'#FFFFFF',muted:'#C9D2FF',faint:'#93A3F5',accent:'#FFD34D',empty:'#3D57E0',line:'#3D57E0',star:'#FFA41C',shadow:'rgba(5,10,60,.45)'},
  blush:{name:'Blush',bg:'#F4D9D0',bg2:'#EDCBC0',ink:'#3B1E1A',muted:'#7A5149',faint:'#B08A80',accent:'#A3352B',empty:'#E3BFB4',line:'#E3BFB4',star:'#E87400',shadow:'rgba(80,30,20,.25)'},
  ink:{name:'Ink',bg:'#FAFAF7',bg2:'#F0F0EA',ink:'#111111',muted:'#5F5F5A',faint:'#A0A09A',accent:'#111111',empty:'#DCDCD5',line:'#111111',star:'#E87400',shadow:'rgba(0,0,0,.18)'}
};
const FONTS={
  modern:{name:'Modern',df:'"Bricolage Grotesque", sans-serif',bf:'Manrope, sans-serif'},
  serif:{name:'Serif',df:'Fraunces, Georgia, serif',bf:'Manrope, sans-serif'},
  elegant:{name:'Elegant',df:'"Playfair Display", Georgia, serif',bf:'"DM Sans", system-ui, sans-serif'},
  clean:{name:'Clean',df:'"DM Sans", system-ui, sans-serif',bf:'"DM Sans", system-ui, sans-serif'},
  typewriter:{name:'Typewriter',df:'"Space Mono", ui-monospace, monospace',bf:'"Space Mono", ui-monospace, monospace'}
};
let C=Object.assign({},THEMES.night,FONTS.modern);
let lastImg=null,lastImgs=[],lastKind='month';
function starPath(ctx,cx,cy,R){const r=R*0.47;ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r:R;ctx.lineTo(cx+rr*Math.cos(a),cy+rr*Math.sin(a));}ctx.closePath();}
const rateStr=r=>{const v=Math.round((+r)*100)/100;return String(v);};
function drawStars(ctx,x,y,size,rating){const gap=size*0.16;for(let i=0;i<5;i++){const cx=x+i*(size+gap)+size/2,cy=y+size/2,f=Math.max(0,Math.min(1,rating-i));starPath(ctx,cx,cy,size/2);ctx.fillStyle=C.empty;ctx.fill();if(f>0){ctx.save();ctx.beginPath();ctx.rect(cx-size/2,cy-size/2,size*f,size);ctx.clip();starPath(ctx,cx,cy,size/2);ctx.fillStyle=C.star;ctx.fill();ctx.restore();}}return 5*size+4*gap;}
function rr(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function splitW(ctx,ws,maxW){const o=[];for(const w of ws){if(ctx.measureText(w).width<=maxW||w.length<4){o.push(w);continue;}const cs=[...w];let k=2,parts;for(;k<=cs.length;k++){const n=Math.ceil(cs.length/k);parts=[];for(let i=0;i<cs.length;i+=n)parts.push(cs.slice(i,i+n).join(''));if(parts.every((pt,j)=>ctx.measureText(pt+(j<parts.length-1?'-':'')).width<=maxW))break;}parts.forEach((pt,j)=>o.push(pt+(j<parts.length-1?'-':'')));}return o;}
function wrapG(ctx,ws,maxW){ws=splitW(ctx,ws,maxW);const ls=[];let cur='';for(const w of ws){const t=cur?cur+' '+w:w;if(ctx.measureText(t).width<=maxW||!cur)cur=t;else{ls.push(cur);cur=w;}}if(cur)ls.push(cur);return ls;}
function wrap(ctx,text,maxW,maxL){const ws=String(text).trim().split(/\s+/);let ls=wrapG(ctx,ws,maxW);if(ls.length>1&&ls.length<=maxL){const n=ls.length;let lo=Math.min(maxW,Math.max(...ws.map(w=>ctx.measureText(w).width))),hi=maxW;for(let k=0;k<14&&hi-lo>0.5;k++){const mid=(lo+hi)/2;if(wrapG(ctx,ws,mid).length<=n)hi=mid;else lo=mid;}ls=wrapG(ctx,ws,hi);}if(ls.length>maxL){ls.length=maxL;let l=ls[maxL-1];while(ctx.measureText(l+'…').width>maxW&&l.length>1)l=l.slice(0,-1);ls[maxL-1]=l.trimEnd()+'…';}return ls;}
function loadImg(src,cors){return new Promise(res=>{const i=new Image();if(cors)i.crossOrigin='anonymous';i.referrerPolicy='no-referrer';i.onload=()=>res(i);i.onerror=()=>res(null);i.src=src;});}
let noRemote=false;
async function imgForCanvas(b){const s=srcFor(b);if(!s)return null;if(b.c==='idb')return loadImg(s,false);if(noRemote)return null;return loadImg(s,true);}
function drawCover(ctx,b,img,x,y,w,h){
  const rad=Math.max(4,w*0.035);
  ctx.save();ctx.shadowColor=C.shadow;ctx.shadowBlur=w*0.18;ctx.shadowOffsetY=w*0.06;ctx.fillStyle='#000';rr(ctx,x,y,w,h,rad);ctx.fill();ctx.restore();
  ctx.save();rr(ctx,x,y,w,h,rad);ctx.clip();
  if(img){const s=Math.max(w/img.width,h/img.height),iw=img.width*s,ih=img.height*s;ctx.imageSmoothingQuality='high';ctx.drawImage(img,x+(w-iw)/2,y+(h-ih)/2,iw,ih);}
  else{const [a,z]=hue(b.s+b.t);const g=ctx.createLinearGradient(x,y,x+w*.6,y+h);g.addColorStop(0,a);g.addColorStop(1,z);ctx.fillStyle=g;ctx.fillRect(x,y,w,h);
    ctx.fillStyle='rgba(255,255,255,.16)';ctx.fillRect(x+w*0.07,y,Math.max(2,w*0.012),h);
    const pad=w*0.14;let fs=w*0.16,ls;for(;fs>8;fs-=1){ctx.font=`800 ${fs}px ${C.df}`;ls=wrap(ctx,b.t,w-pad*1.6,5);if(ls.length*fs*1.05<=h*0.55&&String(b.t).split(/\s+/).every(q=>ctx.measureText(q).width<=w-pad*1.6))break;}
    ctx.fillStyle='#fff';ctx.textAlign='left';ctx.textBaseline='top';ls.forEach((l,i)=>ctx.fillText(l,x+pad,y+h*0.12+i*fs*1.05));
    ctx.fillStyle='rgba(255,255,255,.5)';ctx.fillRect(x+pad,y+h*0.12+ls.length*fs*1.05+fs*0.4,w*0.25,Math.max(2,w*0.012));
    ctx.font=`600 ${Math.max(8,w*0.075)}px ${C.bf}`;ctx.fillStyle='rgba(255,255,255,.8)';ctx.textBaseline='alphabetic';ctx.fillText(wrap(ctx,author(b.a),w-pad*1.6,1)[0]||'',x+pad,y+h*0.9);}
  ctx.restore();ctx.save();rr(ctx,x,y,w,h,rad);ctx.strokeStyle='rgba(255,255,255,.08)';ctx.lineWidth=1.5;ctx.stroke();ctx.restore();
}
const SIZES={'1x1':[1080,1080,'Square post'],'4x5':[1080,1350,'Portrait post'],'3x4':[1080,1440,'Grid post'],'9x16':[1080,1920,'Story']};
function fm(ctx,font,sample){ctx.font=font;const m=ctx.measureText(sample);return {a:m.actualBoundingBoxAscent,d:m.actualBoundingBoxDescent};}
function plan(n,W,H,minText){
  let best=null;
  for(let cols=1;cols<=Math.min(n,12);cols++){
    const rows=Math.ceil(n/cols);const gap=cols<=3?40:cols<=5?26:cols<=8?16:12;
    const chOf=cw=>{const st=Math.max(8,Math.min(40,cw*0.12));const tf=Math.min(32,Math.max(16,cw*0.12)),tl=cw<130?3:2;return cw*1.5+cw*0.08+st+10+(cw>=minText?tf*1.2*tl+8:0);};
    let cw=Math.min(n===1?380:340,(W-gap*(cols-1))/cols);
    while(cw>=54&&rows*chOf(cw)+(rows-1)*gap*1.1>H)cw-=2;
    if(cw<54)continue;
    if(!best||cw>best.cw+1){const st=Math.max(8,Math.min(40,cw*0.12));best={cols:Math.ceil(n/rows),gap,cw,text:cw>=minText,st,ch:chOf(cw),rows,tot:rows*chOf(cw)+(rows-1)*gap*1.1};}
  }
  return best;
}
async function render(kind,y,m,size,pg){
  if(ui.theme==='typewriter'){ui.theme='ink';if(!ui.font)ui.font='typewriter';}
  C=Object.assign({},THEMES[ui.theme]||THEMES.night,FONTS[ui.font]||FONTS.modern);
  const RG=kind==='range'?rangeInfo():null;
  const full=RG?RG.list:period(y,m);if(!full.length)return null;const list=pg?pg.list:full;
  try{await Promise.all([`800 120px ${C.df}`,`700 32px ${C.bf}`,`600 30px ${C.bf}`,`800 30px ${C.bf}`,`400 30px ${C.df}`].map(f=>document.fonts.load(f)));}catch(e){}
  const [W,H]=SIZES[size]||SIZES['4x5'];const story=size==='9x16',square=size==='1x1';
  const P=80,top=story?210:72,bot=story?250:0,footH=square?84:96;
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;const ctx=cv.getContext('2d');
  if(C.grad){const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,C.bg2);bg.addColorStop(1,C.bg);ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);}else{ctx.fillStyle=C.bg;ctx.fillRect(0,0,W,H);}
  if(C.glow){const glow=ctx.createRadialGradient(W*0.85,-80,10,W*0.85,-80,W*0.9);glow.addColorStop(0,C.glow);glow.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);}
  ctx.textBaseline='alphabetic';ctx.textAlign='left';
  const yl=RG?RG.yl:(kind==='month'?y:'');
  const kick=(RG?RG.kick:(kind==='month'?'MONTHLY ROUNDUP':'YEAR IN BOOKS'))+(yl?'  ·  '+yl:'');
  const ks=square?22:26;let kfs=ks;const pgw=(pg&&pg.total>1)?(ctx.font=`700 ${ks}px ${C.bf}`,ctx.measureText(`${pg.no} / ${pg.total}`).width+28):0;const trk=ch=>ch===' '?1:5;for(;kfs>14;kfs--){ctx.font=`800 ${kfs}px ${C.bf}`;let tw=0;for(const chh of kick)tw+=ctx.measureText(chh).width+trk(chh);if(tw<=W-P*2-pgw)break;}ctx.fillStyle=C.accent;ctx.font=`800 ${kfs}px ${C.bf}`;let kx=P;for(const chh of kick){ctx.fillText(chh,kx,top+ks);kx+=ctx.measureText(chh).width+(chh===' '?1:5);}
  if(pg&&pg.total>1){ctx.textAlign='right';ctx.fillStyle=C.muted;ctx.font=`700 ${ks}px ${C.bf}`;ctx.fillText(`${pg.no} / ${pg.total}`,W-P,top+ks);ctx.textAlign='left';}
  const title=RG?RG.title:(kind==='month'?FULL[MI(m)]:y);
  const compact=!!(pg&&pg.compact);
  let fs=compact?(square?84:104):(square?118:(story?164:148));ctx.font=`800 ${fs}px ${C.df}`;
  while(ctx.measureText(title).width>W-P*2&&fs>60){fs-=4;ctx.font=`800 ${fs}px ${C.df}`;}
  const TM=fm(ctx,`800 ${fs}px ${C.df}`,'HdlJ0123456789'),TD=fm(ctx,`800 ${fs}px ${C.df}`,'gjpqy').d;ctx.font=`800 ${fs}px ${C.df}`;const tb=top+ks+26+TM.a;ctx.fillStyle=C.ink;ctx.fillText(title,P-4,tb);
  const av=avg(full),five=full.filter(b=>+b.r===5).length;
  const stats=[[String(full.length),full.length===1?'book read':'books read'],[av.toFixed(1),'average rating'],[String(five),'five-star reads']];
  let lineY;
  if(!compact){
    const sy=tb+TD+(square?34:46);const colW=(W-P*2)/3;const vf0=square?44:(story?60:54),lf0=square?16:(story?21:19);const inset=square?22:30;
    const capT=vf0*0.72;const nfam=(fm(ctx,`800 60px ${C.df}`,'2').a<fm(ctx,`800 60px ${C.df}`,'H').a*0.82)?C.bf:C.df;let vf=vf0,NM=fm(ctx,`800 ${vf}px ${nfam}`,'0123456789');vf=Math.max(vf0*0.8,Math.min(vf0*1.5,vf0*capT/Math.max(1,NM.a)));NM=fm(ctx,`800 ${vf}px ${nfam}`,'0123456789.');
    const base=sy+NM.a;
    let lf=lf0;const lab=ls=>{ctx.font=`700 ${lf}px ${C.bf}`;let w=0;for(const chh of ls.toUpperCase())w+=ctx.measureText(chh).width+1.5;return w;};while(lf>11&&stats.some(([v,l],i)=>lab(l)>colW-(i>0?inset:0)-14))lf--;
    const LM=fm(ctx,`700 ${lf}px ${C.bf}`,'ABCDEFHIKR');const lb=base+Math.max(NM.d,0)+Math.round(lf*0.85)+LM.a;
    ctx.textBaseline='alphabetic';
    stats.forEach(([v,l],i)=>{const x=P+i*colW;if(i>0){ctx.fillStyle=C.line;ctx.fillRect(x,sy-2,2,lb-sy+8);}const vx=i>0?x+inset:x;
      ctx.fillStyle=C.ink;ctx.font=`800 ${vf}px ${nfam}`;ctx.fillText(v,vx,base);const vw=ctx.measureText(v).width;
      if(i===1){let ss=vf0*0.4;const room=x+colW-14-(vx+vw+14);while(ss>10&&5*ss+4*ss*0.16>room)ss-=1;drawStars(ctx,vx+vw+14,base-NM.a/2-ss/2,ss,av);}
      ctx.fillStyle=C.muted;ctx.font=`700 ${lf}px ${C.bf}`;let lx=vx;for(const chh of l.toUpperCase()){ctx.fillText(chh,lx,lb);lx+=ctx.measureText(chh).width+1.5;}});
    lineY=lb+(square?30:42);
  }else lineY=tb+TD+(square?24:32);
  ctx.fillStyle=C.line;ctx.fillRect(P,lineY,W-P*2,2);
  const gy0=lineY+(square?32:44),footY=H-bot-footH,gridH=footY-gy0-(square?24:34);
  let p=plan(list.length,W-P*2,gridH,150),shown=list,extra=0;
  if(!p){for(let k=list.length-1;k>=2;k--){p=plan(k,W-P*2,gridH,150);if(p){shown=list.slice(0,k-1);extra=list.length-shown.length;break;}}}
  if(!p)return null;
  const imgs=await Promise.all(shown.map(imgForCanvas));
  const slots=shown.length+(extra?1:0);const gy=gy0+Math.max(0,(gridH-p.tot)*0.4);
  const pos=i=>{const r=Math.floor(i/p.cols),c=i%p.cols;const inRow=Math.min(p.cols,slots-r*p.cols);const rowW=inRow*p.cw+(inRow-1)*p.gap;return [P+(W-P*2-rowW)/2+c*(p.cw+p.gap),gy+r*(p.ch+p.gap*1.1)];};
  let tfsG=Math.round(Math.min(32,Math.max(16,p.cw*0.12)));const tW=p.cw+Math.min(p.gap*0.6,14);for(;tfsG>12;tfsG--){ctx.font=`700 ${tfsG}px ${C.bf}`;if(!shown.some(b=>String(b.t).split(/\s+/).some(w=>ctx.measureText(w).width>tW)))break;}
  shown.forEach((b,i)=>{const [x,yy]=pos(i),ch=p.cw*1.5;drawCover(ctx,b,imgs[i],x,yy,p.cw,ch);
    let ty=yy+ch+p.cw*0.08;
    if(b.r!==''){const rs=rateStr(b.r);let st=p.st,nf;
      for(;;){nf=Math.max(9,Math.round(st*0.92));ctx.font=`800 ${nf}px ${C.bf}`;const tot=st*5.64+st*0.4+ctx.measureText(rs).width;if(tot<=p.cw||st<=6)break;st-=1;}
      const sw=drawStars(ctx,x,ty+(p.st-st)/2,st,+b.r);ctx.fillStyle=C.star;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(rs,x+sw+st*0.4,ty+p.st/2+1);ctx.textBaseline='alphabetic';}
    ty+=p.st+10;
    if(p.text){const tfs=tfsG;ctx.fillStyle=C.ink;ctx.font=`700 ${tfs}px ${C.bf}`;ctx.textAlign='left';ctx.textBaseline='top';wrap(ctx,b.t,tW,p.cw<130?3:2).forEach((l,k)=>ctx.fillText(l,x,ty+k*tfs*1.2));ctx.textBaseline='alphabetic';}});
  if(extra){const [x,yy]=pos(shown.length),ch=p.cw*1.5;ctx.save();rr(ctx,x,yy,p.cw,ch,Math.max(4,p.cw*0.035));ctx.fillStyle=C.bg2;ctx.fill();ctx.strokeStyle=C.line;ctx.lineWidth=2;ctx.stroke();ctx.restore();
    ctx.fillStyle=C.accent;ctx.textAlign='center';ctx.font=`800 ${Math.round(p.cw*0.32)}px ${C.df}`;ctx.fillText('+'+extra,x+p.cw/2,yy+ch/2+p.cw*0.08);
    ctx.fillStyle=C.muted;ctx.font=`700 ${Math.round(p.cw*0.11)}px ${C.bf}`;ctx.fillText('more',x+p.cw/2,yy+ch/2+p.cw*0.24);ctx.textAlign='left';}
  ctx.fillStyle=C.line;ctx.fillRect(P,footY,W-P*2,2);
  ctx.fillStyle=C.ink;ctx.font=`800 28px ${C.df}`;ctx.textAlign='left';ctx.fillText(appTitle(),P,footY+56);
  ctx.fillStyle=C.muted;ctx.font=`600 24px ${C.bf}`;ctx.textAlign='right';ctx.fillText(RG?RG.foot:(kind==='month'?`Read in ${FULL[MI(m)]} ${y}`:`Read in ${y}`),W-P,footY+56);
  let url;try{url=cv.toDataURL('image/png');}catch(e){if(noRemote)return null;return render2(kind,y,m,size);}
  return{cv,url,name:`roundup-${RG?RG.tag:kind==='month'?`${y}-${pad2(MI(m)+1)}`:y}-${size}${pg&&pg.total>1?'-'+pg.no:''}.png`,shown:shown.length,extra};
}
// If a cover from another site blocks drawing, redraw with only stored covers.
async function render2(kind,y,m,size){noRemote=true;try{return await render(kind,y,m,size);}finally{noRemote=false;}}
function rangeKey(y,m){return (+y)*12+MI(m);}
function rangeInit(){
  if(ui.rg&&ui.rg.y1)return;
  const end=ui.lm?{y:ui.ly,m:ui.lm}:(()=>{const yb=period(ui.ly||THISYEAR,'');const ms=yb.map(b=>MI(b.m)).filter(i=>i>=0);return{y:ui.ly||THISYEAR,m:MONTHS[ms.length?Math.max(...ms):NOW.getMonth()]};})();
  rangeLast(3,end);
}
function rangeLast(n,end){
  if(!end){const all=readBooks().filter(b=>MI(b.m)>=0);const k=all.length?Math.max(...all.map(b=>rangeKey(b.y,b.m))):rangeKey(THISYEAR,MONTHS[NOW.getMonth()]);end={y:String(Math.floor(k/12)),m:MONTHS[k%12]};}
  const k2=rangeKey(end.y,end.m),k1=k2-(n-1);
  ui.rg={y1:String(Math.floor(k1/12)),m1:MONTHS[((k1%12)+12)%12],y2:String(end.y),m2:end.m};saveUi();
}
function rangeInfo(){
  const r=ui.rg||{};let k1=rangeKey(r.y1,r.m1),k2=rangeKey(r.y2,r.m2);if(k1>k2)[k1,k2]=[k2,k1];
  const y1=String(Math.floor(k1/12)),m1=MONTHS[k1%12],y2=String(Math.floor(k2/12)),m2=MONTHS[k2%12];const n=k2-k1+1;
  const years=[];for(let y=+y1;y<=+y2;y++)years.push(String(y));
  const list=[].concat(...years.map(y=>period(y,''))).filter(b=>{const k=rangeKey(b.y,b.m);return k>=k1&&k<=k2;});
  const same=y1===y2;
  return{list,n,title:n===1?FULL[MI(m1)]:`${m1} to ${m2}`,yl:same?y1:`${y1} to ${y2}`,kick:n===1?'MONTHLY ROUNDUP':`${n}-MONTH ROUNDUP`,
    foot:n===1?`Read in ${FULL[MI(m1)]} ${y1}`:`Read ${m1}${same?'':' '+y1} to ${m2} ${y2}`,head:n===1?`${FULL[MI(m1)]} ${y1}`:`${m1}${same?'':' '+y1} to ${m2} ${y2}`,tag:`${y1}-${String(MI(m1)+1).padStart(2,'0')}-to-${y2}-${String(MI(m2)+1).padStart(2,'0')}`};
}
function rangeControls(){
  const r=ui.rg;const years=[...new Set([...readBooks().map(b=>b.y),THISYEAR])].sort();
  const sel=(f,opts,v)=>`<select class="inp rg-sel" data-f="${f}">${opts.map(([val,l])=>`<option value="${val}"${String(v)===String(val)?' selected':''}>${l}</option>`).join('')}</select>`;
  const M=MONTHS.map(m=>[m,m]),Y=years.map(y=>[y,y]);
  return `<div class="pills">${[2,3,6,9].map(n=>`<button class="pill" data-act="rgq" data-n="${n}">Last ${n} months</button>`).join('')}</div>
  <div class="row2"><div class="field"><span class="lab">From</span><div class="row2">${sel('m1',M,r.m1)}${sel('y1',Y,r.y1)}</div></div><div class="field"><span class="lab">To</span><div class="row2">${sel('m2',M,r.m2)}${sel('y2',Y,r.y2)}</div></div></div>
  <span class="hint">${rangeInfo().list.length} books in this range.</span>`;
}
document.addEventListener('change',e=>{const t=e.target;if(t.classList&&t.classList.contains('rg-sel')){ui.rg[t.dataset.f]=t.value;saveUi();makeShare('range');}});
document.addEventListener('click',e=>{const t=e.target.closest('[data-act="rgq"]');if(t){rangeLast(+t.dataset.n);makeShare('range');}});
async function renderPages(kind){
  const y=ui.ly,m=kind==='month'?ui.lm:'';const split=kind==='month'?'one':(ui.split||'one');
  if(split==='one'){const r=await render(kind,y,m,ui.size);return r?[r]:[];}
  let months=[];
  if(kind==='range'){const R=rangeInfo();const seen=new Set();for(const b of R.list){const k=b.y+'|'+b.m;if(!seen.has(k)){seen.add(k);months.push([b.y,b.m]);}}}
  else{for(const mm of MONTHS)if(period(y,mm).length)months.push([y,mm]);}
  months=months.slice(0,split==='overview'?19:20);
  const total=months.length+(split==='overview'?1:0);const out=[];let no=0;
  if(split==='overview'){const r=await render(kind,y,m,ui.size,{list:kind==='range'?rangeInfo().list:period(y,''),no:++no,total});if(r)out.push(r);}
  for(const [yy,mm] of months){const r=await render('month',yy,mm,ui.size,{list:period(yy,mm),no:++no,total});if(r)out.push(r);}
  return out;
}
document.addEventListener('click',e=>{const t=e.target.closest('[data-act="font"]');if(t){ui.font=t.dataset.v;saveUi();makeShare(lastKind);}});
document.addEventListener('click',e=>{const t=e.target.closest('[data-act="theme"]');if(t){ui.theme=t.dataset.v;saveUi();makeShare(lastKind);}});
document.addEventListener('click',e=>{const t=e.target.closest('[data-act="split"]');if(t){ui.split=t.dataset.v;saveUi();makeShare(lastKind);}});
async function makeShare(kind){
  kind=kind||(ui.lm?'month':'year');if(kind==='range')rangeInit();lastKind=kind;if(!SIZES[ui.size])ui.size='4x5';
  const sz=Object.entries(SIZES).map(([k,[w,hh,l]])=>`<button data-act="size" data-s="${k}" aria-pressed="${ui.size===k}"><span class="shape" style="width:${Math.round(22*w/hh)}px;height:22px"></span><b>${k.replace('x',':')}</b><span>${l}</span></button>`).join('');
  openSheet(`<div class="sh-head" style="grid-template-columns:1fr auto"><div style="display:grid;gap:4px"><span class="kicker">Share</span><h3>${kind==='range'?rangeInfo().head:kind==='month'?`${FULL[MI(ui.lm)]} ${ui.ly}`:ui.ly} roundup</h3></div>${X}</div>
   <div class="seg">${ui.lm?`<button data-act="kind" data-k="month" aria-pressed="${kind==='month'}">Month</button>`:''}<button data-act="kind" data-k="range" aria-pressed="${kind==='range'}">Pick months</button><button data-act="kind" data-k="year" aria-pressed="${kind==='year'}">Whole year</button></div>
   ${kind==='range'?rangeControls():''}
   <div class="sizes" role="group" aria-label="Image size">${sz}</div>
   <div class="field"><span class="lab">Colors</span><div class="themes">${Object.entries(THEMES).map(([k,t])=>`<button data-act="theme" data-v="${k}" aria-pressed="${(ui.theme||'night')===k}" aria-label="${t.name}"><span class="sw" style="background:${t.bg};border-color:${t.line}"><i style="background:${t.accent}"></i><em style="background:${t.ink}"></em></span><span class="tn">${t.name}</span></button>`).join('')}</div></div>
   <div class="field"><span class="lab">Font</span><div class="fonts">${Object.entries(FONTS).map(([k,f])=>`<button data-act="font" data-v="${k}" aria-pressed="${(ui.font||'modern')===k}"><b style="font-family:${f.df.replace(/"/g,"'")}">Aa</b><span>${f.name}</span></button>`).join('')}</div></div>
   ${kind!=='month'?`<div class="field"><span class="lab">Slides</span><div class="seg">${[['one','One image'],['months','By month'],['overview','Recap + months']].map(([v,l])=>`<button data-act="split" data-v="${v}" aria-pressed="${(ui.split||'one')===v}">${l}</button>`).join('')}</div><span class="hint">Multiple slides post together as an Instagram carousel.</span></div>`:''}
   <div class="share-prev" id="sprev"><div class="emptybox">Drawing your roundup…</div></div>
   <div class="actions"><button class="btn gold" data-act="saveimg">${navigator.canShare?'Share or save':'Save image'}</button></div><span class="hint" id="smsg"></span>`);
  const rs=await renderPages(kind);if(!rs.length||!$('sprev'))return;const r=rs[0];
  lastImg=r;lastImgs=rs;$('sprev').innerHTML=rs.length===1?`<img alt="Roundup image" src="${r.url}">`:`<div class="sprev-strip">${rs.map((x,i)=>`<img alt="Roundup image ${i+1} of ${rs.length}" src="${x.url}">`).join('')}</div>`;
  const [w,hh,l]=SIZES[ui.size];
  $('smsg').textContent=`${w} × ${hh} px, Instagram ${l.toLowerCase()} size.${r.extra?` Showing ${r.shown} of ${r.shown+r.extra} books; pick a taller size or a slide per month to fit them all.`:''}${rs.length>1?` ${rs.length} images, swipe to see them all.`:''} You can also press and hold the image to save it.`;
}
async function saveImg(){
  const list=lastImgs&&lastImgs.length?lastImgs:(lastImg?[lastImg]:[]);if(!list.length)return;
  const files=[];for(const im of list){const blob=await new Promise(r=>im.cv.toBlob(r,'image/png'));files.push(new File([blob],im.name,{type:'image/png'}));}
  try{if(navigator.canShare&&navigator.canShare({files})){await navigator.share({files});return;}}catch(e){if(e&&e.name==='AbortError')return;}
  for(const f of files){const a=document.createElement('a');a.href=URL.createObjectURL(f);a.download=f.name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);await sleep(400);}
}

/* ---------- boot ---------- */
async function boot(){
  await load();
  $('prio').value=ui.prio||'';
  setTab(ui.tab);renderAll();
  const pending=books.filter(b=>b.nc===1&&!b.c).map(b=>b.id);if(pending.length)queueCovers(pending);
  const last=D.lastCheck?new Date(D.lastCheck):null;
  if(books.length&&navigator.onLine&&(!last||(NOW-last)/864e5>=6))setTimeout(()=>checkNew(false),4000);
  if('serviceWorker' in navigator&&location.protocol==='https:'){
    navigator.serviceWorker.register('sw.js').then(reg=>{
      reg.addEventListener('updatefound',()=>{const nw=reg.installing;if(!nw)return;nw.addEventListener('statechange',()=>{if(nw.state==='installed'&&navigator.serviceWorker.controller)toast('An update is ready. Close and reopen the app to get it.');});});
    }).catch(()=>{});
  }
}
window.addEventListener('online',()=>{if(coverQ.list.length)runCovers();});
boot();
})();
