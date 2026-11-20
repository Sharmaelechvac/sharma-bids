/*! Bids — local data layer for the GitHub Pages port.
 *
 * Replaces the Bid Tracker worker's /api/* surface with an in-page data
 * layer over the SAME record array, using the branch's own pure functions
 * (assets/pure.js, extracted verbatim from src/index.js):
 *
 *   - The dataset ships only as bids.enc.json (sharma-enc-v1: AES-GCM-256,
 *     key from PBKDF2-HMAC-SHA256, 600k iterations — the Bid Boards scheme).
 *     The passcode is never stored; only the derived key is kept, in
 *     sessionStorage (this tab), exactly like the Bid Boards lock. A wrong
 *     code fails the GCM integrity check, which IS the auth.
 *   - Reads (stats, builders, filtered lists, detail) are computed from
 *     the in-memory array with computeStats/filterBids/listBuildersLocal.
 *   - Writes (create, edit, delete, notes, import, Start drafting) update
 *     the in-memory array AND a localStorage overlay
 *     (sharma-bids-overlay:v1), the Bid Boards pattern: edits live on this
 *     phone until a publish folds them into a new envelope. The overlay is
 *     pruned automatically once published data matches it.
 *   - "Changes to publish" (button appears when the overlay is non-empty)
 *     exports the diff in the Bid Boards publish format:
 *     bids | <row-id> | field=value   (one line per changed field).
 *   - CSV export / import template are generated client-side
 *     (toCsv / CSV_HEADER) and downloaded as the same filenames the
 *     worker used: sharma-bids.csv / bid-tracker-template.csv.
 */
(function () {
  "use strict";
  var P = window.BidsPure;
  var KEY_STORE = "sharma-bids-key:v1";
  var OVERLAY_KEY = "sharma-bids-overlay:v1";
  var ENVELOPE_URL = "bids.enc.json";

  var envelope = null;        // parsed bids.enc.json
  var envelopePromise = null; // resolves once the envelope is fetched
  var base = null;            // decrypted base array (as published)
  var bids = [];              // working array = base + overlay
  var overlay = freshOverlay();
  var started = false;

  function freshOverlay() { return { v: 1, created: [], updated: {}, deleted: [] }; }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint8Array(16); crypto.getRandomValues(a);
    a[6] = (a[6] & 15) | 64; a[8] = (a[8] & 63) | 128;
    var h = [].map.call(a, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  /* ---------------- envelope crypto (Bid Boards lock pattern) -------- */
  var subtle = window.crypto && window.crypto.subtle;
  var textEnc = new TextEncoder(), textDec = new TextDecoder();
  function b64(buf) { var s = "", a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function checkEnvelope(e) {
    if (!e || e.format !== "sharma-enc-v1" || e.kdf !== "PBKDF2-SHA256" || e.cipher !== "AES-GCM-256" ||
        typeof e.salt !== "string" || typeof e.iv !== "string" || typeof e.ciphertext !== "string" || !(e.iterations >= 600000)) {
      throw new Error("bids.enc.json is not in the expected format");
    }
    return e;
  }
  function deriveKey(code, e) {
    return subtle.importKey("raw", textEnc.encode(code), "PBKDF2", false, ["deriveKey"]).then(function (k0) {
      return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unb64(e.salt), iterations: e.iterations },
        k0, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
    });
  }
  function decryptWithKey(key, e) {
    return subtle.decrypt({ name: "AES-GCM", iv: unb64(e.iv) }, key, unb64(e.ciphertext))
      .then(function (pt) { return JSON.parse(textDec.decode(pt)); });
  }
  function savedKey(e) {
    try {
      var s = JSON.parse(sessionStorage.getItem(KEY_STORE) || "null");
      if (!s || s.salt !== e.salt || s.iterations !== e.iterations || !s.k) return Promise.resolve(null);
      return subtle.importKey("raw", unb64(s.k), { name: "AES-GCM" }, false, ["decrypt"])
        .then(function (k) { return k; }, function () { return null; });
    } catch (x) { return Promise.resolve(null); }
  }
  function rememberKey(key, e) {
    return subtle.exportKey("raw", key).then(function (raw) {
      try { sessionStorage.setItem(KEY_STORE, JSON.stringify({ salt: e.salt, iterations: e.iterations, k: b64(raw) })); } catch (x) {}
    });
  }

  /* ---------------- overlay ------------------------------------------ */
  function loadOverlay() {
    try {
      var o = JSON.parse(localStorage.getItem(OVERLAY_KEY) || "null");
      if (o && o.v === 1 && Array.isArray(o.created) && o.updated && Array.isArray(o.deleted)) overlay = o;
    } catch (x) {}
  }
  function saveOverlay() {
    try { localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay)); } catch (x) {}
    refreshPublishButton();
  }
  function overlayCount() {
    return overlay.created.length + Object.keys(overlay.updated).length + overlay.deleted.length;
  }
  function sameRecord(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function pruneOverlay() {
    if (!base) return;
    var baseById = new Map(base.map(function (b) { return [b.id, b]; }));
    var changed = false;
    overlay.created = overlay.created.filter(function (rec) {
      var hit = baseById.get(rec.id);
      if (hit && sameRecord(hit, rec)) { changed = true; return false; }
      return true;
    });
    for (var id of Object.keys(overlay.updated)) {
      var hit2 = baseById.get(id);
      if (hit2 && sameRecord(hit2, overlay.updated[id])) { delete overlay.updated[id]; changed = true; }
    }
    overlay.deleted = overlay.deleted.filter(function (id) {
      if (!baseById.has(id)) { changed = true; return false; }
      return true;
    });
    if (changed) { try { localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay)); } catch (x) {} }
  }
  function applyOverlay() {
    var deleted = new Set(overlay.deleted);
    bids = base.filter(function (b) { return !deleted.has(b.id); })
      .map(function (b) { return overlay.updated[b.id] || b; });
    for (var i = overlay.created.length - 1; i >= 0; i--) bids.unshift(overlay.created[i]);
  }
  function overlayCreate(rec) { overlay.created.unshift(rec); saveOverlay(); }
  function overlayUpdate(rec) {
    var i = overlay.created.findIndex(function (r) { return r.id === rec.id; });
    if (i >= 0) overlay.created[i] = rec; else overlay.updated[rec.id] = rec;
    saveOverlay();
  }
  function overlayDelete(id) {
    var i = overlay.created.findIndex(function (r) { return r.id === id; });
    if (i >= 0) overlay.created.splice(i, 1);
    else { delete overlay.updated[id]; if (!overlay.deleted.includes(id)) overlay.deleted.push(id); }
    saveOverlay();
  }

  /* ---------------- local API (mirrors the worker's handleApi) ------- */
  function notFound() { throw new Error("Bid not found"); }
  function dispatch(path, opts) {
    var q = path.indexOf("?");
    var pathname = q >= 0 ? path.slice(0, q) : path;
    var params = new URLSearchParams(q >= 0 ? path.slice(q + 1) : "");
    var method = (opts && opts.method) || "GET";
    var body = null;
    if (opts && opts.body && typeof opts.body === "string") {
      try { body = JSON.parse(opts.body); } catch (x) { throw new Error("Something went wrong. Try again."); }
    }

    if (pathname === "/api/stats" && method === "GET") return P.computeStats(bids);
    if (pathname === "/api/builders" && method === "GET") return { builders: P.listBuildersLocal(bids) };
    if (pathname === "/api/export.csv" && method === "GET") return { csv: P.toCsv(P.filterBids(bids, params)) };
    if (pathname === "/api/import-template.csv" && method === "GET") return { csv: P.CSV_HEADER + "\n" };
    if (pathname === "/api/bids" && method === "GET") return { bids: P.filterBids(bids, params) };
    if (pathname === "/api/bids" && method === "POST") {
      var now = new Date().toISOString();
      var bid = P.normalizeBid(Object.assign({}, body, { id: uuid(), notes: [], createdAt: now, updatedAt: now }), { strict: true });
      if (body.notes && String(body.notes).trim()) {
        bid.notes = [{ id: uuid(), at: now, text: String(body.notes).trim() }];
      }
      bids.unshift(bid);
      overlayCreate(bid);
      return { bid: bid };
    }
    var note = pathname.match(/^\/api\/bids\/([^/]+)\/notes$/);
    if (note && method === "POST") {
      var nbid = bids.find(function (b) { return b.id === decodeURIComponent(note[1]); });
      if (!nbid) notFound();
      var text = String((body && (body.text || body.note)) || "").trim();
      if (!text) throw new Error("Note text is required");
      nbid.notes = nbid.notes || [];
      nbid.notes.push({ id: uuid(), at: new Date().toISOString(), text: text });
      nbid.updatedAt = new Date().toISOString();
      overlayUpdate(nbid);
      return { bid: nbid };
    }
    var one = pathname.match(/^\/api\/bids\/([^/]+)$/);
    if (one) {
      var id = decodeURIComponent(one[1]);
      var idx = bids.findIndex(function (b) { return b.id === id; });
      if (idx === -1) notFound();
      if (method === "GET") return { bid: bids[idx] };
      if (method === "DELETE") {
        var removed = bids.splice(idx, 1)[0];
        overlayDelete(removed.id);
        return { ok: true, id: removed.id };
      }
      if (method === "PUT") {
        var prev = bids[idx];
        var merged = P.normalizeBid(Object.assign({}, prev, body, { id: prev.id, notes: prev.notes, createdAt: prev.createdAt }), { strict: true });
        if (merged.status === "Won" && !merged.wonDate) merged.wonDate = P.todayET();
        if (merged.status !== "Won") merged.wonDate = merged.status === prev.status ? prev.wonDate || "" : "";
        merged.updatedAt = new Date().toISOString();
        bids[idx] = merged;
        overlayUpdate(merged);
        return { bid: merged };
      }
    }
    throw new Error("Not found");
  }
  function importCsv(text) {
    var result = P.parseCsv(text);
    if (!result.rows.length && result.errors.length) throw new Error("Something went wrong. Try again.");
    var now = new Date().toISOString();
    for (var row of result.rows) {
      var rec = P.normalizeBid(Object.assign({}, row, { id: uuid(), createdAt: now, updatedAt: now }));
      bids.unshift(rec);
      overlayCreate(rec);
    }
    return { imported: result.rows.length, errors: result.errors, skipped: result.errors.length };
  }
  async function api(path, opts) {
    opts = opts || {};
    if (path === "/api/import" && opts.method === "POST") {
      var text = "";
      var body = opts.body;
      if (body instanceof FormData) {
        var file = body.get("file") || body.get("csv");
        if (file && typeof file === "object" && typeof file.text === "function") text = await file.text();
        else text = String(body.get("csv") || body.get("text") || "");
      } else if (typeof body === "string") text = body;
      return importCsv(text);
    }
    return dispatch(path, opts);
  }
  /* SK.data-compatible shim: data(path, render) -> Promise; render is
     called once with the computed result (local data is instant; no
     cache-storage copy of bid data is ever written). */
  function data(path, render) {
    return api(path).then(function (d) { render(d); return d; });
  }

  /* ---------------- downloads (export / template / lock) ------------- */
  function downloadBlob(name, text, type) {
    var blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function lockApp() {
    try { sessionStorage.removeItem(KEY_STORE); } catch (x) {}
    try { if (window.caches) caches.delete("sk-data-v1"); } catch (x) {}
    location.reload();
  }
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("[data-export],[data-template],[data-lock]") : null;
    if (!t) return;
    e.preventDefault();
    if (t.hasAttribute("data-export")) {
      var params = new URLSearchParams(t.dataset.params || "");
      downloadBlob("sharma-bids.csv", P.toCsv(P.filterBids(bids, params)), "text/csv;charset=utf-8");
    } else if (t.hasAttribute("data-template")) {
      downloadBlob("bid-tracker-template.csv", P.CSV_HEADER + "\n", "text/csv;charset=utf-8");
    } else if (t.hasAttribute("data-lock")) {
      lockApp();
    }
  });

  /* ---------------- changes to publish ------------------------------- */
  function fieldVal(v) { return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v); }
  function publishLines() {
    var lines = [];
    var baseById = new Map((base || []).map(function (b) { return [b.id, b]; }));
    for (var rec of overlay.created) {
      for (var k of Object.keys(rec)) {
        if (k === "id") continue;
        var v = rec[k];
        if (v === null || v === undefined || v === "") continue;
        lines.push("bids | " + rec.id + " | " + k + "=" + fieldVal(v));
      }
    }
    for (var id of Object.keys(overlay.updated)) {
      var next = overlay.updated[id], prev = baseById.get(id) || {};
      for (var k2 of Object.keys(next)) {
        if (k2 === "id") continue;
        if (JSON.stringify(next[k2]) !== JSON.stringify(prev[k2])) {
          lines.push("bids | " + id + " | " + k2 + "=" + fieldVal(next[k2]));
        }
      }
    }
    for (var id3 of overlay.deleted) lines.push("bids | " + id3 + " | deleted=true");
    return lines;
  }
  function refreshPublishButton() {
    var btn = document.getElementById("bt-publish-btn");
    var n = overlayCount();
    if (!n) { if (btn) btn.remove(); return; }
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "bt-publish-btn"; btn.type = "button"; btn.className = "sk-btn";
      btn.style.cssText = "position:fixed;right:16px;bottom:calc(var(--sk-tab-h,54px) + env(safe-area-inset-bottom,0px) + 14px);z-index:900;width:auto;padding:0 18px;box-shadow:0 6px 20px rgba(0,0,0,.25)";
      btn.addEventListener("click", openPublishSheet);
      document.body.appendChild(btn);
    }
    btn.textContent = "Publish " + n + " change" + (n === 1 ? "" : "s");
  }
  function openPublishSheet() {
    var sheet = document.getElementById("publish-sheet");
    if (!sheet) {
      sheet = document.createElement("section");
      sheet.className = "sk-sheet sk-sheet--full"; sheet.id = "publish-sheet";
      sheet.setAttribute("aria-labelledby", "publish-sheet-title");
      sheet.innerHTML =
        '<div class="sk-sheet__grab"></div>' +
        '<div class="sk-sheet__head"><button class="sk-btn sk-btn--text" type="button" data-sheet-close>Done</button>' +
        '<div class="sk-sheet__title" id="publish-sheet-title">Changes to publish</div><span></span></div>' +
        '<div class="sk-sheet__body">' +
        '<p class="sk-field-hint">These changes are saved on this phone only. Send the lines to Jarvis to publish them for everyone (Bid Boards format: board | row-id | field=value). After the new data is published, clear them here.</p>' +
        '<div class="sk-list"><label class="sk-field"><span class="sk-field__label">Changes</span>' +
        '<textarea class="sk-field__input" id="publish-text" rows="12" readonly></textarea></label></div>' +
        '<div class="sk-actions"><button class="sk-btn sk-btn--secondary" type="button" id="publish-copy">Copy lines</button>' +
        '<button class="sk-btn sk-btn--secondary" type="button" id="publish-download">Download .txt</button></div>' +
        '<div class="sk-actions"><button class="sk-btn sk-btn--danger" type="button" id="publish-clear">Clear published changes</button></div>' +
        '</div>';
      document.body.appendChild(sheet);
      sheet.querySelector("#publish-copy").addEventListener("click", function () {
        var ta = sheet.querySelector("#publish-text");
        ta.select();
        if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(function () {});
        if (window.SK) SK.toast("Copied");
      });
      sheet.querySelector("#publish-download").addEventListener("click", function () {
        downloadBlob("bids-changes.txt", sheet.querySelector("#publish-text").value + "\n");
      });
      sheet.querySelector("#publish-clear").addEventListener("click", function () {
        if (!confirm("Clear the changes saved on this phone? Do this only after Jarvis has published them.")) return;
        overlay = freshOverlay(); saveOverlay();
        if (window.SK) { SK.closeSheet("publish-sheet"); SK.toast("Changes cleared"); }
      });
    }
    sheet.querySelector("#publish-text").value = publishLines().join("\n");
    if (window.SK) SK.openSheet("publish-sheet");
  }

  /* ---------------- lock + boot -------------------------------------- */
  function startAppWhenReady() {
    if (started) return;
    if (window.SK && window.__startApp) { started = true; window.__startApp(); return; }
    document.addEventListener("DOMContentLoaded", function () {
      if (!started && window.__startApp) { started = true; window.__startApp(); }
    });
  }
  function onUnlocked(data) {
    base = (data && data.bids) || [];
    pruneOverlay();
    applyOverlay();
    document.documentElement.classList.remove("bt-locked");
    refreshPublishButton();
    startAppWhenReady();
  }
  function showLockError(msg) {
    var form = document.getElementById("bt-lock");
    var err = document.getElementById("lock-err");
    if (err) err.textContent = msg;
    if (form) {
      form.classList.remove("is-shake");
      void form.offsetWidth;
      form.classList.add("is-shake");
    }
    var input = document.getElementById("lock-code");
    if (input) { input.value = ""; input.focus(); }
  }
  function tryUnlock(code) {
    if (!envelopePromise) return;
    envelopePromise.then(function () {
      if (!envelope) { showLockError("Could not load the bid data. Check the connection and reload."); return; }
      return deriveKey(code, envelope).then(function (key) {
        return decryptWithKey(key, envelope).then(function (data) {
          return rememberKey(key, envelope).then(function () { onUnlocked(data); });
        });
      });
    }).catch(function () { showLockError("Wrong passcode. Try again."); });
  }
  var lockForm = document.getElementById("bt-lock");
  if (lockForm) {
    lockForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var code = document.getElementById("lock-code").value.trim();
      if (code) tryUnlock(code);
    });
  }
  function boot() {
    document.documentElement.classList.add("bt-locked");
    loadOverlay();
    if (!subtle) { showLockError("This browser can't unlock the data (needs HTTPS and WebCrypto)."); return; }
    envelopePromise = fetch(ENVELOPE_URL + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(ENVELOPE_URL + " returned " + r.status); return r.json(); })
      .then(function (raw) {
        envelope = checkEnvelope(raw);
        return savedKey(envelope).then(function (key) {
          if (!key) return null;
          return decryptWithKey(key, envelope).then(function (data) { return data; }, function () { return null; });
        });
      })
      .catch(function () { envelope = null; return null; });
    envelopePromise.then(function (data) { if (data) onUnlocked(data); });
  }

  window.BidsLocal = { api: api, data: data, boot: boot, lock: lockApp };
})();
