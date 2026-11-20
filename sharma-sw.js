/*! Sharma Bids (GitHub port) service worker — kit v1.4 shell worker
   adapted to this app's own scope (the kit's sharma-sw.js is the pattern,
   Bid Boards' per-app worker is the base-path pattern).
   - App shell (index): network first, saved copy if there is no signal
     or the network takes over 2.5 s. The shell contains NO bid data —
     bids live only in bids.enc.json, decrypted in the page after the
     passcode lock.
   - Kit files (vendored at kit/, passed in via ?kit= by SK.registerSW):
     served from the phone at once, refreshed in the background.
   - bids.enc.json is NETWORK-ONLY: explicitly bypassed below, never
     cached, so the encrypted flow stays exactly as-is.
   - Everything else (logos, assets, version.json): straight to network.
   Holds no data, passcodes or keys. */
var VERSION = "sk-shell-v1.4.1-bids1";
var DATA = "sk-data-v1";
var SCOPE = self.registration.scope;
var SHELL = new URL("index.html", SCOPE).href;
var KIT = new URL((new URL(self.location.href).searchParams.get("kit") || "kit").replace(/\/$/, ""), SCOPE).href.replace(/\/$/, "");
var KIT_FILES = [KIT + "/sharma-kit.css", KIT + "/sharma-kit.js", KIT + "/assets/logo-white-header.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    var page = fetch(SHELL, { credentials: "same-origin", cache: "no-store" }).then(function (r) {
      if (r.ok && (r.headers.get("content-type") || "").indexOf("text/html") === 0) return c.put(SHELL, r);
    }).catch(function () {});
    return Promise.all([page].concat(KIT_FILES.map(function (u) {
      return fetch(u, { mode: "cors", cache: "no-cache" }).then(function (r) { if (r.ok) return c.put(u, r); }).catch(function () {});
    })));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("sk-shell-") === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function shell(req) {
  var net = fetch(req).then(function (r) {
    if (r.ok && (r.headers.get("content-type") || "").indexOf("text/html") === 0) {
      var copy = r.clone(); caches.open(VERSION).then(function (c) { return c.put(SHELL, copy); });
    }
    return r;
  });
  var saved = caches.open(VERSION).then(function (c) { return c.match(SHELL); });
  return new Promise(function (resolve, reject) {
    var done = false;
    function give(r) { if (!done && r) { done = true; resolve(r); } }
    net.then(give, function () { saved.then(function (s) { if (s) give(s); else if (!done) { done = true; reject(new Error("offline")); } }); });
    setTimeout(function () { saved.then(give); }, 2500);
  });
}

function kitFile(e) {
  var req = e.request;
  return caches.open(VERSION).then(function (c) {
    return c.match(req.url).then(function (hit) {
      var fresh = fetch(req.url, { mode: "cors", cache: "no-cache" }).then(function (r) { if (r.ok) c.put(req.url, r.clone()); return r; });
      if (hit) { e.waitUntil(fresh.catch(function () {})); return hit; }
      return fresh.catch(function () { return fetch(req); });
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request; if (req.method !== "GET") return;
  var url = new URL(req.url);
  /* The encrypted bid data is network-only — never cached, never stored. */
  if (url.pathname.endsWith("/bids.enc.json")) return;
  if (req.url.indexOf(KIT + "/") === 0 && /\.(css|js|png|svg)$/.test(url.pathname)) { e.respondWith(kitFile(e)); return; }
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate" && (url.href === SCOPE || url.href === SHELL || url.pathname.endsWith("/index.html"))) { e.respondWith(shell(req)); return; }
    return; /* assets, logos, version.json: straight to the network */
  }
});
