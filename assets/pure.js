/*! BidsPure — pure functions extracted VERBATIM from
   ~/workspace/sharma-bids-live/src/index.js (branch bids-merge, 8e8754b).
   No I/O, no network. listBuildersLocal is the worker listBuilders()'s
   bids pass only (the LEADS/FOLLOWUP enrichment was best-effort by design). */
(function () {
  "use strict";
const STATUSES = ["New", "Drafting", "Sent", "Follow-up", "Won", "Lost", "No response"];

const TRADES = ["Electrical", "HVAC", "Both", "Low voltage"];

const OPEN = new Set(["Drafting", "Sent", "Follow-up", "No response"]);

const CSV_HEADER = "builder,project,plan_name,trade,bid_date,amount,houses,status,follow_up_date,lost_reason,attachment,notes,alternate_group,living_sf,under_roof_sf";

const FOOTER = "Sharma Electric & HVAC · Lic. EC13013924 · CAC1823596";

function normalizeBid(input, { strict } = {}) {
  const builder = String(input.builder || "").trim();
  const project = String(input.project || "").trim();
  if (strict && !builder) throw new Error("Builder is required");
  if (strict && !project) throw new Error("Project or address is required");

  const trade = cleanEnum(input.trade, TRADES, "Electrical");
  const status = cleanEnum(input.status, STATUSES, "Drafting");
  const amount = parseAmount(input.amount);
  const houses = parseHouses(input.houses);
  const livingSf = parseSf(input.livingSf ?? input.living_sf);
  const underRoofSf = parseSf(input.underRoofSf ?? input.under_roof_sf);
  /* A strict create that omits the date defaults to today, but an explicitly
     present (even empty) date is kept as-is — edits and status changes must
     never stamp a fake "Sent" date onto a bid that has none. */
  const bidDate = parseDate(input.bidDate || input.bid_date)
    || (strict && input.bidDate === undefined && input.bid_date === undefined ? todayET() : "");
  const followUpDate = parseDate(input.followUpDate || input.follow_up_date) || "";
  const lostReason = String(input.lostReason || input.lost_reason || "").trim();
  if (status === "Lost" && strict && !lostReason) throw new Error("Lost reason is required when status is Lost");
  const attachment = cleanUrl(input.attachment || input.attachmentUrl || "");

  const notes = Array.isArray(input.notes)
    ? input.notes.map((n) => ({
        id: n.id || crypto.randomUUID(),
        at: n.at || new Date().toISOString(),
        text: String(n.text || "").trim(),
      })).filter((n) => n.text)
    : [];

  const planName = String(input.planName || input.plan_name || "").trim();
  const alternateGroup = String(input.alternateGroup || input.alternate_group || "").trim();

  const out = {
    id: input.id,
    builder,
    project,
    planName,
    alternateGroup,
    trade,
    bidDate,
    amount,
    houses,
    livingSf,
    underRoofSf,
    status,
    followUpDate,
    lostReason: status === "Lost" ? lostReason : lostReason,
    attachment,
    notes,
    wonDate: input.wonDate || (status === "Won" ? (bidDate || todayET()) : ""),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };

  /* Boards provenance block — carried only when present, so native records
     keep their exact shape and boards fields survive later edits (the PUT
     handler merges the stored record into the input). The boards seed
     names its square footage sqftLiving/sqftRoof; fold it into the
     Tracker's livingSf/underRoofSf when those are not already set. */
  if (input.source === "boards") out.source = "boards";
  if (input.board !== undefined && input.board !== null && String(input.board).trim()) {
    out.board = String(input.board).trim() === "residential" ? "residential" : "commercial";
  }
  for (const k of ["boardsRowId", "boardsStatus", "address", "gmailThreadId", "contactName", "contactEmail", "jobber", "folder", "dedupeKey"]) {
    if (input[k] !== undefined && input[k] !== null) out[k] = String(input[k]).trim();
  }
  if (input.dueDate !== undefined && input.dueDate !== null) {
    out.dueDate = parseDate(input.dueDate) || String(input.dueDate).trim();
  }
  if (Array.isArray(input.files)) {
    out.files = input.files
      .map((x) => ({ name: String((x && x.name) || x || "").trim() }))
      .filter((x) => x.name);
  }
  if (input.archived !== undefined) out.archived = !!input.archived;
  if (out.livingSf == null) {
    const s = parseSf(input.sqftLiving);
    if (s != null) out.livingSf = s;
  }
  if (out.underRoofSf == null) {
    const s = parseSf(input.sqftRoof);
    if (s != null) out.underRoofSf = s;
  }

  return out;
}

function cleanEnum(value, allowed, fallback) {
  const v = String(value || "").trim();
  const hit = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
  return hit || fallback;
}

function parseAmount(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100) / 100;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function parseHouses(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

function parseSf(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = Math.round(Number(String(value).replace(/[^0-9.]/g, "")));
  if (!Number.isFinite(n) || n < 1 || n > 1000000) return null;
  return n;
}

function parseDate(value) {
  if (!value) return "";
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

function cleanUrl(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {}
  return "";
}

function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function filterBids(bids, params) {
  const status = (params.get("status") || "").trim();
  const trade = (params.get("trade") || "").trim();
  const source = (params.get("source") || "").trim();
  const board = (params.get("board") || "").trim();
  const builder = (params.get("builder") || "").trim().toLowerCase();
  const q = (params.get("q") || "").trim().toLowerCase();
  const from = (params.get("from") || "").trim();
  const to = (params.get("to") || "").trim();
  return bids.filter((b) => {
    if (status && b.status !== status) return false;
    if (trade && b.trade !== trade) return false;
    if (source && b.source !== source) return false;
    if (board && b.board !== board) return false;
    if (builder && b.builder.toLowerCase() !== builder) return false;
    if (from && (b.bidDate || "") < from) return false;
    if (to && (b.bidDate || "") > to) return false;
    if (q) {
      const blob = [b.builder, b.project, b.planName, b.trade, b.status, b.lostReason, b.attachment, b.alternateGroup, ...(b.notes || []).map((n) => n.text)].join(" ").toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
}

function primaryForTotals(bids) {
  const best = new Map();
  for (const b of bids) {
    const g = String(b.alternateGroup || "").trim();
    if (!g) continue;
    const cur = best.get(g);
    const amt = Number(b.amount) || 0;
    const curAmt = cur ? Number(cur.amount) || 0 : -1;
    if (!cur || amt > curAmt || (amt === curAmt && String(b.id) < String(cur.id))) best.set(g, b);
  }
  return bids.filter((b) => {
    const g = String(b.alternateGroup || "").trim();
    return !g || best.get(g)?.id === b.id;
  });
}

function computeStats(bids) {
  const today = todayET();
  const month = today.slice(0, 7);
  const counted = primaryForTotals(bids);
  const open = counted.filter((b) => OPEN.has(b.status));
  const won = bids.filter((b) => b.status === "Won");
  const lost = bids.filter((b) => b.status === "Lost");
  const wonMonth = won.filter((b) => (b.wonDate || b.updatedAt || b.bidDate || "").slice(0, 7) === month);
  const follow = bids.filter((b) => {
    if (!b.followUpDate || b.status === "Won" || b.status === "Lost") return false;
    return b.followUpDate <= today;
  });
  const dueToday = follow.filter((b) => b.followUpDate === today);
  const overdue = follow.filter((b) => b.followUpDate < today);

  const sum = (list) => list.reduce((a, b) => a + (Number(b.amount) || 0), 0);
  const decided = won.length + lost.length;
  const wonAmt = sum(won);
  const lostAmt = sum(lost);
  const decidedAmt = wonAmt + lostAmt;
  const countedIds = new Set(counted.map((b) => b.id));

  const pipeline = {};
  for (const s of STATUSES) {
    const list = counted.filter((b) => b.status === s);
    pipeline[s] = { count: list.length, amount: sum(list) };
  }

  const byBuilderMap = new Map();
  for (const b of bids) {
    const key = b.builder || "(no name)";
    if (!byBuilderMap.has(key)) {
      byBuilderMap.set(key, { builder: key, bids: 0, open: 0, won: 0, lost: 0, openAmount: 0, wonAmount: 0, lastBidDate: "" });
    }
    const row = byBuilderMap.get(key);
    row.bids += 1;
    const counts = countedIds.has(b.id);
    if (counts && OPEN.has(b.status)) {
      row.open += 1;
      row.openAmount += Number(b.amount) || 0;
    }
    if (b.status === "Won") {
      row.won += 1;
      row.wonAmount += Number(b.amount) || 0;
    }
    if (b.status === "Lost") row.lost += 1;
    if (b.bidDate && b.bidDate > row.lastBidDate) row.lastBidDate = b.bidDate;
  }
  const builders = [...byBuilderMap.values()].sort((a, b) => b.bids - a.bids || a.builder.localeCompare(b.builder));
  const excluded = bids.length - counted.length;

  return {
    today,
    total: bids.length,
    open: { count: open.length, amount: sum(open) },
    winRate: {
      count: decided ? won.length / decided : null,
      amount: decidedAmt ? wonAmt / decidedAmt : null,
      won: won.length,
      lost: lost.length,
      wonAmount: wonAmt,
      lostAmount: lostAmt,
    },
    followUp: { today: dueToday, overdue, count: follow.length },
    wonThisMonth: { count: wonMonth.length, amount: sum(wonMonth), month },
    pipeline,
    builders,
    alternates: {
      groups: new Set(bids.map((b) => String(b.alternateGroup || "").trim()).filter(Boolean)).size,
      excluded,
      excludedAmount: sum(bids) - sum(counted),
    },
    footer: FOOTER,
  };
}

function toCsv(bids) {
  const lines = [CSV_HEADER];
  for (const b of bids) {
    const notes = (b.notes || []).map((n) => n.text).join(" | ");
    lines.push([
      b.builder,
      b.project,
      b.planName,
      b.trade,
      b.bidDate,
      b.amount == null ? "" : b.amount,
      b.houses == null ? "" : b.houses,
      b.status,
      b.followUpDate,
      b.lostReason,
      b.attachment,
      notes,
      b.alternateGroup,
      b.livingSf == null ? "" : b.livingSf,
      b.underRoofSf == null ? "" : b.underRoofSf,
    ].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

function csvCell(value) {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsv(text) {
  const errors = [];
  const rows = [];
  const records = splitCsv(String(text || "").replace(/^\uFEFF/, ""));
  if (!records.length) return { rows, errors: [{ line: 1, error: "CSV is empty" }] };

  const header = records[0].map((h) => String(h || "").trim().toLowerCase().replace(/\s+/g, "_"));
  const idx = (names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const cols = {
    builder: idx(["builder", "builder_name", "gc", "customer"]),
    project: idx(["project", "address", "house", "plan", "project_or_address", "job"]),
    trade: idx(["trade"]),
    bid_date: idx(["bid_date", "biddate", "date", "sent_date"]),
    amount: idx(["amount", "bid_amount", "total", "price"]),
    houses: idx(["houses", "house_count", "qty", "units"]),
    status: idx(["status"]),
    follow_up_date: idx(["follow_up_date", "followup_date", "follow_up", "followup"]),
    lost_reason: idx(["lost_reason", "reason"]),
    attachment: idx(["attachment", "url", "link", "estimate_url"]),
    notes: idx(["notes", "note"]),
    plan_name: idx(["plan_name", "plan", "plan_or_model"]),
    alternate_group: idx(["alternate_group", "alternate", "alt_group"]),
    living_sf: idx(["living_sf", "living_sq_ft", "living", "living_area"]),
    under_roof_sf: idx(["under_roof_sf", "under_roof_sq_ft", "under_roof", "total_sf"]),
  };
  if (cols.builder === -1 || cols.project === -1) {
    return { rows, errors: [{ line: 1, error: "CSV needs builder and project (or address) columns" }] };
  }

  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (rec.every((c) => String(c || "").trim() === "")) continue;
    const get = (key) => (cols[key] === -1 ? "" : rec[cols[key]]);
    const builder = String(get("builder") || "").trim();
    const project = String(get("project") || "").trim();
    if (!builder || !project) {
      errors.push({ line: i + 1, error: "Missing builder or project" });
      continue;
    }
    const tradeRaw = String(get("trade") || "Electrical").trim();
    const statusRaw = String(get("status") || "Drafting").trim();
    const trade = TRADES.find((t) => t.toLowerCase() === tradeRaw.toLowerCase());
    const status = STATUSES.find((s) => s.toLowerCase() === statusRaw.toLowerCase());
    if (tradeRaw && !trade) {
      errors.push({ line: i + 1, error: `Unknown trade "${tradeRaw}"` });
      continue;
    }
    if (statusRaw && !status) {
      errors.push({ line: i + 1, error: `Unknown status "${statusRaw}"` });
      continue;
    }
    const lostReason = String(get("lost_reason") || "").trim();
    if ((status || "Drafting") === "Lost" && !lostReason) {
      errors.push({ line: i + 1, error: "Lost reason required for Lost status" });
      continue;
    }
    const note = String(get("notes") || "").trim();
    const now = new Date().toISOString();
    try {
      rows.push(normalizeBid({
        builder,
        project,
        planName: get("plan_name"),
        alternateGroup: get("alternate_group"),
        trade: trade || "Electrical",
        bidDate: get("bid_date"),
        amount: get("amount"),
        houses: get("houses"),
        livingSf: get("living_sf"),
        underRoofSf: get("under_roof_sf"),
        status: status || "Drafting",
        followUpDate: get("follow_up_date"),
        lostReason,
        attachment: get("attachment"),
        notes: note ? [{ id: crypto.randomUUID(), at: now, text: note }] : [],
      }));
    } catch (err) {
      errors.push({ line: i + 1, error: err.message || "Invalid row" });
    }
  }
  return { rows, errors };
}

function splitCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
function listBuildersLocal(bids) {
  const seen = new Map();
  for (const b of bids) {
    const n = String(b.builder || "").trim();
    if (!n) continue;
    const k = n.toLowerCase();
    if (!seen.has(k)) seen.set(k, { name: n, source: "bids" });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
  window.BidsPure = { STATUSES, TRADES, OPEN, CSV_HEADER, FOOTER, normalizeBid, cleanEnum, parseAmount, parseHouses, parseSf, parseDate, cleanUrl, todayET, filterBids, primaryForTotals, computeStats, toCsv, csvCell, parseCsv, splitCsv, listBuildersLocal };
})();
