/* ARGOS P15/P16: cache somente assets públicos; dados protegidos no Supabase QA. */
const CACHE="argos-pwa-v01913-p111-offline-config"; /* P111: configuração pública no cache para abrir sem internet */
const FILES=["./","./index.html","./manifest.webmanifest","./argos-public-config.json","./argos-auth.mjs","./argos-cloud.mjs?v=15b7d657fba5","./argos-photo-cloud.mjs?v=ec962071339f","./argos-legacy.mjs","./argos-admin.mjs","./argos-legacy-rescue.mjs","./argos-deploy-guard.mjs","./argos-tabs.mjs","./argos-history-csv.mjs","./icons/icon-192.png","./icons/icon-512.png","./icons/maskable-512.png","./icons/favicon-32.png","./icons/apple-touch-icon.png","./icons/icon.svg"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("argos-pwa-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{
 const request=event.request,url=new URL(request.url);if(request.method!=="GET"||url.origin!==self.location.origin)return;
 const asset=FILES.some(file=>new URL(file,self.registration.scope).pathname===url.pathname);
 if(!asset&&request.mode!=="navigate")return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);try{const response=await fetch(request);if(response.ok&&asset)await cache.put(request,response.clone());return response;}catch(error){const cached=await cache.match(request);if(cached)return cached;if(request.mode==="navigate")return await cache.match("./index.html")||Response.error();return Response.error();}})());
});
