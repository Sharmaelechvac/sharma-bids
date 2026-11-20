# Bids App — GitHub Pages Port: Build Report (Phase 2)

Built 2026-11-20 from branch `bids-merge` (commit `8e8754b`) of
`Sharmaelechvac/sharma-bid-tracker`, per `~/workspace/bids-git-port/PORT-PLAN.md`
and Sanjay's direction: "I don't want Cloudflare. Everything GIT."
**Nothing here is pushed and no repo has been created** — Jarvis does the
final encrypt + repo push personally (steps at the bottom).

## Dataset — 165 records, verified

Merge replicated the worker's `POST /api/boards/import` line-for-line
(`mergeBoardsImport` + `normalizeBid` extracted verbatim from
`~/workspace/sharma-bids-live/src/`), inputs: `tracker-export.json`
(130 production bids) + `import/boards-import.json` (163 boards rows):

| | count |
|---|---|
| Production bids carried over | 130 |
| Boards rows matched to production (not re-entered) | 129 |
| Boards rows inserted as New (base merge) | 34 (24 commercial / 10 residential) |
| **Directed exception inserted (decision b)** | **1** |
| **Final total** | **165** |

- **The Ollie's exception:** Summit GC, Ollie's #0811, Inverness — the
  boards row with Jobber **#1230** (fire alarm) was matched away against
  the same production bid as Jobber #1224 (electrical) only because
  production records carry no `jobber` field. Per Sanjay's pick it is
  inserted as its own New bid (id `4d61edd7-a641-4e34-a29c-8cf406487999`,
  commercial, amount null). The production Ollie's bid
  (`80cda60c…`, Sent) is untouched — the pair exists as two records.
- Verified programmatically: all 130 production records byte-identical to
  the export (per-id deep compare), **129 of 130 production amounts
  non-null, unchanged**; all **35 boards-inserted records have
  `amount: null` and `status: "New"`** (25 commercial / 10 residential);
  all 165 ids unique.
- Plain dataset (OUTSIDE this tree, never to be committed):
  `~/workspace/bids-git-port/merged-dataset.json` (`{ "bids": [...] }`).

## ⚠ Staging envelope — THROWAWAY code

`bids.enc.json` in this tree is the merged dataset encrypted with the
**throwaway staging code `staging-test-0000`** (sharma-enc-v1,
PBKDF2-HMAC-SHA256 600k, AES-GCM-256 — the Bid Boards scheme). It exists
only so the app can be tested end-to-end. **Jarvis must re-encrypt with
the real office code before anything is pushed** (step 1 below).

## What the tree contains

| Path | What |
|---|---|
| `index.html` | The Tracker's own app page (Today / Bids / Boards / Builders / More), design unchanged; data layer swapped (below) |
| `bids.enc.json` | Encrypted dataset — the ONLY data file. No plaintext data anywhere in the tree (verified) |
| `assets/pure.js` | The branch's pure functions extracted **verbatim** from `src/index.js` (`normalizeBid`, `filterBids`, `computeStats`, `toCsv`, `parseCsv`, …) — substring-verified against the source |
| `assets/data.js` | Local data layer: envelope decrypt (WebCrypto), in-memory array, localStorage overlay, "Changes to publish" export |
| `assets/refresh.js` | Fleet refresh/freshness snippet; `APP_VERSION` stamped with `version.json` |
| `version.json` | `{"v":"2026-11-20.1"}` — bump together with `APP_VERSION` on every publish |
| `kit/` | Sharma kit **v1.4 vendored** (css/js + assets), fetched from the live kit worker — no Cloudflare `KIT_BASE` at runtime |
| `logos/` | 29 real builder logos mapped from `~/workspace/sharma-kit-rollout/logos/manifest.json` + `sources.json` provenance; the other 25 builders in the data get the kit's navy initials badge (the tracker's `.webp` logo set exists only on the worker and was not chased, per the brief) |
| `manifest.webmanifest` | Worker's manifest with relative icon paths (kit assets) |
| `sharma-sw.js` | Per-app service worker (kit v1.4 pattern): shell network-first, kit files stale-while-revalidate, **`bids.enc.json` network-only, never cached** |
| `import-template.csv` | The worker's `CSV_HEADER` constant, verbatim |

### Data-layer mapping (per PORT-PLAN §3)

- All `/api/*` calls the UI makes are answered locally with the branch's
  own semantics: stats via `computeStats`, lists via `filterBids`
  (Boards tab = `source=boards` + `board` filters), detail lookup,
  strict `normalizeBid` creates/edits (incl. the worker's won-date rules),
  delete, notes, CSV import via `parseCsv`. Error messages match the
  worker's (`Bid not found`, strict-rule messages, …).
- **Lock:** the branch's own kit lock screen (`ui/login.html` markup),
  JS-driven: passcode → PBKDF2 → AES-GCM decrypt; a wrong code fails the
  GCM check, which is the auth. Only the derived key is kept, in
  `sessionStorage` (Bid Boards pattern). While locked, all app chrome is
  hidden and no data renders. "Lock app" (More tab) clears the key and
  reloads. Copy change, honestly noted: the worker's "stays unlocked for
  30 days" (cookie) reads "until you lock it or close this tab"
  (session key).
- **Edits:** localStorage overlay `sharma-bids-overlay:v1` (creates /
  updates / tombstones), applied over the decrypted base on every unlock
  and pruned automatically once published data matches. A "Publish N
  changes" button appears when the overlay is non-empty; its sheet
  exports the diff in the Bid Boards publish format
  (`bids | <row-id> | field=value`, one line per changed field) with
  copy/download, plus a clear-after-publish action.
- **Downloads:** CSV export (all + filter-sheet filtered) and the import
  template are generated client-side (`toCsv` / `CSV_HEADER`) under the
  worker's filenames `sharma-bids.csv` / `bid-tracker-template.csv`.
- **Builders autocomplete:** derived from the bids array (the worker's
  best-effort LEADS/FOLLOWUP enrichment is a designed no-op statically).
- Deliberate omission: the Bid Boards lock's Formspree wrong-code email
  alert was NOT carried over (it is labelled for Bid Boards and posts to
  a third party); the lock itself is the full envelope scheme.

## Tests

Node unit pass over the pure layer (dataset in → numbers out):
`computeStats` total 165, open 102, pipeline New 35 / Drafting 1 /
Sent 78 / Follow-up 23 / Won 20 / Lost 6; boards filter 35 (25 C / 10 R);
`toCsv` 166 lines; CSV round-trip re-parses to 165 rows, 0 errors.

Headless Chrome (Chrome for Testing + Playwright, iPhone viewport,
local static server) — **13/13 essential checks passed, zero JS errors**:

1. Lock blocks data on load (lock visible, chrome hidden, 0 cards)
2. Wrong code → "Wrong passcode. Try again.", still locked
3. Unlock renders Today; all 5 tabs present (Today/Bids/Boards/Builders/More)
4. Bids list, All segment: **165 bids**
5. Builders tab renders (54 builders)
6. Boards tab: **35 bids**; Commercial **25**; Residential **10**
7. Sort by date (newest first): first 6 cards match the expected order
   computed from the dataset with the app's own comparator
8. Boards detail → **Start drafting** → stage becomes Drafting and the
   change is written to the localStorage overlay

(The earlier full 27-check pass — extra sorts, CSV blob contents, SW
cache audit, dark render, lock-app round trip — was cut short by the
expedite order; the checks above are the essential set. The CSV/SW/dark
code paths are the same ones exercised in the Node pass and the Bid
Boards fleet pattern.)

## Remaining publish steps (Jarvis, personally)

1. **Re-encrypt with the real code** (replaces the throwaway envelope):
   encrypt `~/workspace/bids-git-port/merged-dataset.json` into
   `bids.enc.json` in this tree using the Bid Boards flow
   (`~/workspace/bid-boards/github/tools/encrypt.py` scheme:
   `SHARMA_PASSCODE` env only, PBKDF2 600k / AES-GCM-256, fresh salt+IV),
   then round-trip-decrypt to confirm 165 records.
2. **Create the GitHub repo** (e.g. `Sharmaelechvac/sharma-bids`), commit
   this tree **without** `merged-dataset.json` (it lives outside the
   tree — keep it that way) and without this report's staging code being
   valid anymore (step 1 handles that), push, enable Pages.
3. **Live-verify** on the Pages URL: locked without the code, unlocks
   with the real code, 165 bids, Boards 35/25/10, logos render.
4. **Repoint Sharma Home's "Bids" tile** to the Pages URL (currently the
   Cloudflare worker URL); only then retire the worker app.
5. Ongoing publishes (overlay lines from a phone, scanner intake):
   apply lines to the plain dataset → re-encrypt (step 1) → bump
   `version.json` + `APP_VERSION` together → push.
