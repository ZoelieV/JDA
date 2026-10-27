// Service worker du site : sert seulement à rendre le site installable comme
// application (cf. /manifest.webmanifest, commun/appli.js). Aucun cache :
// tout passe par le réseau comme sur le site, donc jamais de vieille version.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
