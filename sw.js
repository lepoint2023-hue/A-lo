// Aïlo — service worker : l'app s'ouvre même hors connexion.
// Change VERSION à chaque mise en ligne pour forcer la mise à jour.
const VERSION = "ailo-v0.4.4";
const SHELL = ["./", "index.html", "css/styles.css", "js/app.js", "js/store.js", "js/data.js", "js/ui.js", "js/geo.js", "js/config.js", "data/places.json", "vendor/supabase-2.119.2.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Réseau d'abord (pour toujours avoir la dernière version), cache en secours.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== location.origin) return; // API Supabase, IA, polices : toujours en direct
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then((res) => { // revalide toujours : jamais de mélange d'anciennes et nouvelles versions
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
