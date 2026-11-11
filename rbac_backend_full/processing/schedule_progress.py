"""Schedule-vs-scan progress for the Project Dashboard.

Matches each schedule activity to the BIM elements it covers and reads their
measured status from every saved Progress Assessment (one per scan date), so
the dashboard can show actual % complete, actual start/finish dates and the
elements not yet built.

An activity is matched to elements by, in order of preference:
  1. its explicit GlobalId list from the 4D schedule mapping JSON
     (schedule.meta["element_mapping"] = {activity_id: [GlobalId, ...]}), or
  2. its IFC type(s) + level: element_type starts with one of the activity's
     IFC types (so IFCWALL also covers IFCWALLSTANDARDCASE) and the element's
     storey equals the activity's level (case-insensitive, after applying
     schedule.meta["level_map"] = {schedule level: IFC storey name}).
"""
import os
import re

# Missing-element rows returned per activity; the full count is always sent.
MISSING_LIMIT = 500

# Attribute-only element index per IFC (keyed by path + mtime) for the 4D view.
_INDEX_CACHE = {}

# Spatial/void entities that have a Representation but aren't built elements.
_NON_ELEMENT_TYPES = (
    "IfcSpatialStructureElement", "IfcSpatialElement", "IfcOpeningElement",
    "IfcAnnotation", "IfcGrid",
)

_UNGROUPED = {"", "ungrouped"}


def _split_types(value):
    return [t.upper() for t in re.split(r"[,;\s/|]+", str(value or "")) if t.strip()]


def _norm(value):
    return str(value or "").strip().lower()


def build_matchers(activities, meta):
    """{activity_id: (kind, predicate)} — kind is 'elements', 'type_level',
    'type' (no level given) or 'none'."""
    mapping = (meta or {}).get("element_mapping") or {}
    level_map = {_norm(k): _norm(v) for k, v in ((meta or {}).get("level_map") or {}).items() if v}
    matchers = {}
    for a in activities:
        aid = str(a.get("id", ""))
        ids = mapping.get(aid)
        if ids:
            id_set = set(ids)
            matchers[aid] = ("elements", lambda e, s=id_set: e["element_id"] in s)
            continue
        types = tuple(_split_types(a.get("ifcTypes")))
        if not types:
            matchers[aid] = ("none", None)
            continue
        level = _norm(a.get("level"))
        if level in _UNGROUPED:
            matchers[aid] = ("type", lambda e, t=types: e["element_type"].upper().startswith(t))
            continue
        level = level_map.get(level, level)
        matchers[aid] = (
            "type_level",
            lambda e, t=types, lv=level: e["level_norm"] == lv and e["element_type"].upper().startswith(t),
        )
    return matchers


def element_index(ifc_path):
    """Every built element in the IFC as {express_id, element_id (GlobalId),
    element_type, level} — attributes only, no geometry, so it's quick enough
    to run on request. express_id is the STEP line number, which is also the
    expressID web-ifc gives each element in the browser."""
    import ifcopenshell
    import ifcopenshell.util.element as element_util
    from .progress import _storey_of

    try:
        key = (ifc_path, os.path.getmtime(ifc_path))
        if key in _INDEX_CACHE:
            return _INDEX_CACHE[key]
    except OSError:
        key = None

    model = ifcopenshell.open(ifc_path)
    out = []
    for product in model.by_type("IfcProduct"):
        if getattr(product, "Representation", None) is None:
            continue
        if any(_is_a(product, t) for t in _NON_ELEMENT_TYPES):
            continue
        try:
            level, _elevation = _storey_of(product, element_util)
        except Exception:  # floor is optional — never drop the element
            level = ""
        out.append({
            "express_id": product.id(),
            "element_id": getattr(product, "GlobalId", "") or str(product.id()),
            "element_type": product.is_a().upper(),
            "level": level,
        })
    if key:
        _INDEX_CACHE.clear()  # one model at a time is plenty
        _INDEX_CACHE[key] = out
    return out


def _is_a(entity, ifc_class):
    try:
        return entity.is_a(ifc_class)
    except Exception:  # class not in this schema (e.g. IFC2X3 vs IFC4)
        return False


# Explicit GlobalId lists beat type+level rules, which beat type-only rules,
# so a broad "all IFCWALL" activity can't steal elements a precise one owns.
_MATCH_PRIORITY = {"elements": 0, "type_level": 1, "type": 2}


def link_elements(activities, meta, elements):
    """{express_id: activity_id} — each element goes to the highest-priority
    activity that matches it (schedule order breaks ties), using the same
    matchers as the dashboard's measured progress."""
    matchers = build_matchers(activities, meta)
    ordered = sorted(
        (
            (_MATCH_PRIORITY[kind], i, str(a.get("id", "")), pred)
            for i, a in enumerate(activities)
            for kind, pred in [matchers[str(a.get("id", ""))]]
            if pred is not None
        ),
        key=lambda t: (t[0], t[1]),
    )
    links = {}
    for e in elements:
        e["level_norm"] = _norm(e.get("level"))
        for _prio, _i, aid, pred in ordered:
            if pred(e):
                links[e["express_id"]] = aid
                break
    return links


def compute(activities, meta, scans):
    """scans: chronological [(scan_date_iso, [element dict, ...]), ...] where
    each element has element_id, element_type, level, name, category,
    status, completion. Returns {activity_id: {...}}."""
    matchers = build_matchers(activities, meta)
    for _date, elements in scans:
        for e in elements:
            e["level_norm"] = _norm(e.get("level"))

    out = {}
    for a in activities:
        aid = str(a.get("id", ""))
        kind, pred = matchers[aid]
        row = {
            "match": kind, "matched": 0, "completed": 0, "in_progress": 0,
            "not_started": 0, "actual_pct": None, "actual_start": None,
            "actual_finish": None, "missing": [], "missing_total": 0,
            "scan_date": None,  # scan the latest figures come from
        }
        out[aid] = row
        if pred is None or not scans:
            continue

        latest = latest_date = None
        for scan_date, elements in scans:
            matched = [e for e in elements if pred(e)]
            if not matched:
                continue
            done = sum(1 for e in matched if e["status"] == "completed")
            started = sum(1 for e in matched if e["status"] in ("completed", "in_progress"))
            if started and row["actual_start"] is None:
                row["actual_start"] = scan_date
            if done == len(matched) and row["actual_finish"] is None:
                row["actual_finish"] = scan_date
            latest, latest_date = matched, scan_date

        if latest is None:
            continue
        counts = {"completed": 0, "in_progress": 0, "not_started": 0}
        for e in latest:
            counts[e["status"]] = counts.get(e["status"], 0) + 1
        missing = [e for e in latest if e["status"] != "completed"]
        missing.sort(key=lambda e: (e["status"] != "not_started", e.get("completion") or 0))
        row.update(counts)
        row["matched"] = len(latest)
        row["scan_date"] = latest_date
        row["actual_pct"] = round(counts["completed"] / len(latest) * 100, 1)
        row["missing_total"] = len(missing)
        row["missing"] = [
            {k: e.get(k) for k in ("element_id", "name", "element_type", "level", "category", "status", "completion")}
            for e in missing[:MISSING_LIMIT]
        ]
        # A later scan can show regressions (e.g. temporary works removed),
        # so only keep the finish date if the latest scan is still complete.
        if counts["completed"] != len(latest):
            row["actual_finish"] = None
    return out
