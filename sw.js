/* Offline support. Bump CACHE when you change any app file so phones pick up the update. */
const CACHE='tbr-v1.3.1';
const SHELL=['./','./index.html','./app.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k.startsWith('tbr-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  // App files: serve from cache, refresh in the background.
  if(url.origin===location.origin){
    e.respondWith(caches.open(CACHE).then(async c=>{
      const hit=await c.match(req,{ignoreSearch:true});
      const net=fetch(req).then(r=>{if(r&&r.ok)c.put(req,r.clone());return r;}).catch(()=>null);
      if(hit){e.waitUntil(net);return hit;}
      const r=await net;if(r)return r;
      if(req.mode==='navigate'){const idx=await c.match('./index.html');if(idx)return idx;}
      return new Response('Offline',{status:503});
    }));
    return;
  }
  // Fonts: cache after first load so the app looks right offline.
  if(url.hostname==='fonts.googleapis.com'||url.hostname==='fonts.gstatic.com'){
    e.respondWith(caches.open(CACHE+'-fonts').then(async c=>{const hit=await c.match(req);if(hit)return hit;try{const r=await fetch(req);c.put(req,r.clone());return r;}catch(err){return hit||Response.error();}}));
  }
});
