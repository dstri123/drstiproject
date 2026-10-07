import JSZip from "jszip";

// Parses a project schedule (the "BIM IFC Project Schedule" layout: Activity
// ID / WBS / Level / Elevation / Activity / IFC Type(s) / Element Count /
// Duration / Start / Finish / Predecessor / Dependency / Mapping Key / Status)
// from an .xlsx, .csv or the 4D mapping .json into normalized activities.
//
// .xlsx is read with JSZip (already a dependency) rather than pulling in a
// spreadsheet library — an .xlsx is a zip of XML parts.

const DAY_MS = 86400000;

// Normalized header -> field name. Headers are compared lowercased with
// everything except letters/digits stripped ("Duration (workdays)" ->
// "durationworkdays").
const FIELD_ALIASES = {
  id: ["activityid", "id", "taskid", "activity_id"],
  wbs: ["wbs", "wbscode"],
  level: ["level", "storey", "floor", "phase"],
  elevation: ["elevationmm", "elevation"],
  name: ["activity", "activityname", "task", "taskname", "name"],
  ifcTypes: ["ifctypes", "ifctype"],
  elementCount: ["elementcount", "elements", "count"],
  duration: ["durationworkdays", "duration", "durationdays"],
  start: ["start", "startdate", "plannedstart"],
  finish: ["finish", "finishdate", "end", "enddate", "plannedfinish"],
  predecessor: ["predecessor", "predecessors"],
  dependency: ["dependency", "dependencytype", "relationship"],
  mappingKey: ["mappingkey", "schedulemappingkey"],
  status: ["status"],
};

const normHeader = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function fieldForHeader(h) {
  const n = normHeader(h);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(n)) return field;
  }
  return null;
}

export function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

export function parseDay(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s || "").trim());
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // dd/mm/yyyy or mm/dd/yyyy — assume day-first unless impossible.
  const m2 = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(String(s || "").trim());
  if (m2) {
    let [d, mo] = [+m2[1], +m2[2]];
    if (mo > 12) [d, mo] = [mo, d];
    return new Date(Date.UTC(+m2[3], mo - 1, d));
  }
  return null;
}

function excelSerialToDate(n) {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * DAY_MS);
}

function toDate(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    return n > 59 ? excelSerialToDate(n) : null;
  }
  return parseDay(v);
}

// Durations in the source workbook are numbers that happen to be formatted
// as dates (3 shows as "1900-01-03"), so a CSV export can carry that text.
function toDuration(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  const d = parseDay(s);
  if (d && d.getUTCFullYear() === 1900) {
    return Math.round((d - Date.UTC(1899, 11, 31)) / DAY_MS);
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function toNumber(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function workdaysBetween(start, finish) {
  let n = 0;
  for (let t = start.getTime(); t <= finish.getTime(); t += DAY_MS) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

// ---------- row-level normalization ----------

function rowsToActivities(rows) {
  // Find the header row (first row with an Activity/ID column and a start).
  let headerIdx = -1;
  let fieldMap = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const map = (rows[i] || []).map(fieldForHeader);
    if (map.includes("start") && (map.includes("name") || map.includes("id"))) {
      headerIdx = i;
      fieldMap = map;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error(
      "Couldn't find a header row with at least 'Activity' (or 'Activity ID') and 'Start' columns.",
    );
  }

  const records = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.some((c) => c !== "" && c != null)) continue;
    const rec = {};
    fieldMap.forEach((f, ci) => {
      if (f && rec[f] == null) rec[f] = row[ci];
    });
    records.push(rec);
  }
  return recordsToActivities(records);
}

function recordsToActivities(records) {
  const out = [];
  records.forEach((r, i) => {
    const start = toDate(r.start);
    let finish = toDate(r.finish);
    if (!start) return; // can't place it on a timeline
    let duration = toDuration(r.duration);
    if (!finish) {
      finish = new Date(start.getTime() + Math.max(0, (duration || 1) - 1) * DAY_MS);
    }
    if (finish < start) finish = start;
    if (duration == null) duration = workdaysBetween(start, finish);

    const id = String(r.id ?? "").trim() || `T${String(i + 1).padStart(3, "0")}`;
    const level = String(r.level ?? "").trim() || "Ungrouped";
    out.push({
      id,
      wbs: String(r.wbs ?? "").trim(),
      level,
      elevation: toNumber(r.elevation),
      name: String(r.name ?? "").trim() || id,
      ifcTypes: String(r.ifcTypes ?? "").trim(),
      elementCount: toNumber(r.elementCount),
      duration,
      start: isoDay(start),
      finish: isoDay(finish),
      predecessors: String(r.predecessor ?? "")
        .split(/[,;\s]+/)
        .map((p) => p.trim())
        .filter(Boolean),
      dependency: String(r.dependency ?? "").trim() || (r.predecessor ? "FS" : ""),
      mappingKey: String(r.mappingKey ?? "").trim(),
      status: String(r.status ?? "").trim() || "Not Started",
      milestone: duration === 0,
    });
  });
  if (!out.length) throw new Error("No activities with a valid Start date were found.");
  return out;
}

// ---------- CSV ----------

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------- XLSX ----------

function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const xmlDoc = (s) => new DOMParser().parseFromString(s, "application/xml");
const byTag = (node, tag) => Array.from(node.getElementsByTagNameNS("*", tag));
const textOf = (node) => byTag(node, "t").map((t) => t.textContent).join("");

async function readSheetRows(zip, path, sharedStrings) {
  const doc = xmlDoc(await zip.file(path).async("string"));
  const rows = [];
  byTag(doc, "row").forEach((rowEl) => {
    const r = parseInt(rowEl.getAttribute("r"), 10) - 1;
    const row = [];
    byTag(rowEl, "c").forEach((c) => {
      const ref = c.getAttribute("r");
      const ci = ref ? colIndex(ref) : row.length;
      const t = c.getAttribute("t");
      const vEl = byTag(c, "v")[0];
      let val = "";
      if (t === "s") val = sharedStrings[parseInt(vEl?.textContent, 10)] ?? "";
      else if (t === "inlineStr") val = textOf(c);
      else if (t === "str" || t === "e") val = vEl?.textContent ?? "";
      else if (t === "b") val = vEl?.textContent === "1";
      else if (vEl) val = Number(vEl.textContent);
      row[ci] = val;
    });
    rows[Number.isFinite(r) ? r : rows.length] = Array.from(row, (v) => v ?? "");
  });
  return Array.from(rows, (r) => r || []);
}

async function parseXLSX(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const ssFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings = ssFile
    ? byTag(xmlDoc(await ssFile.async("string")), "si").map(textOf)
    : [];

  // Resolve sheets in workbook order via the relationships part.
  const wb = xmlDoc(await zip.file("xl/workbook.xml").async("string"));
  const rels = xmlDoc(await zip.file("xl/_rels/workbook.xml.rels").async("string"));
  const relTarget = {};
  byTag(rels, "Relationship").forEach((r) => {
    relTarget[r.getAttribute("Id")] = r.getAttribute("Target");
  });
  const sheetPaths = byTag(wb, "sheet")
    .map((s) => {
      const rid = s.getAttribute("r:id") || s.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id",
      );
      const target = relTarget[rid];
      if (!target) return null;
      return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    })
    .filter((p) => p && zip.file(p));

  // Use the first sheet that has a recognisable schedule header.
  let lastErr = null;
  for (const p of sheetPaths) {
    try {
      return rowsToActivities(await readSheetRows(zip, p, sharedStrings));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("The workbook has no worksheets.");
}

// ---------- JSON (4D schedule mapping export) ----------

function parseJSON(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.activities;
  if (!Array.isArray(list)) throw new Error("JSON must contain an 'activities' array.");
  const records = list.map((a) => {
    const rec = {};
    Object.entries(a).forEach(([k, v]) => {
      const f = fieldForHeader(k);
      if (f && rec[f] == null) rec[f] = v;
    });
    return rec;
  });
  const activities = recordsToActivities(records);

  // Keep only per-activity element counts from element_mapping — the full
  // list (thousands of GlobalIds) is too large to cache in the browser.
  const mappedCounts = {};
  (data.element_mapping || []).forEach((m) => {
    const id = m["Activity ID"];
    if (id) mappedCounts[id] = (mappedCounts[id] || 0) + 1;
  });
  activities.forEach((a) => {
    if (mappedCounts[a.id] != null) a.mappedElements = mappedCounts[a.id];
  });
  return {
    activities,
    meta: {
      sourceIfc: data.source_ifc || null,
      schema: data.schema || null,
      notes: data.notes || [],
    },
  };
}

export async function parseScheduleFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "xlsx" || ext === "xlsm") {
    return { activities: await parseXLSX(await file.arrayBuffer()), meta: {} };
  }
  if (ext === "csv") {
    return { activities: rowsToActivities(parseCSV(await file.text())), meta: {} };
  }
  if (ext === "json") return parseJSON(await file.text());
  if (ext === "xls") {
    throw new Error("Legacy .xls isn't supported — please save the file as .xlsx and upload again.");
  }
  throw new Error(`Unsupported file type ".${ext}". Upload .xlsx, .csv or .json.`);
}
