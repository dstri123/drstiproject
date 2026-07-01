"""
Server-side IFC metadata extraction
Inspired by IFCtoFDS's client-side IFC parsing (IfcMeta, IfcAdapter).
This backend equivalent extracts element counts, types, bounds, and
IFC mapping summaries — no WebAssembly required.

Requires: ifcopenshell (pip install ifcopenshell)
Falls back gracefully if ifcopenshell is not installed.
"""
import os
import re
import logging

logger = logging.getLogger(__name__)

# IFC type → category mapping (mirrors IFCtoFDS categoryForIfcType)
IFC_CATEGORY_MAP = {
    'IFCWALL': 'structure', 'IFCWALLSTANDARDCASE': 'structure',
    'IFCSLAB': 'structure', 'IFCROOF': 'structure',
    'IFCCOLUMN': 'structure', 'IFCBEAM': 'structure',
    'IFCSTAIR': 'structure', 'IFCMEMBER': 'structure',
    'IFCRAILING': 'structure', 'IFCCURTAINWALL': 'structure',
    'IFCPLATE': 'structure', 'IFCCOVERING': 'structure',
    'IFCFOOTING': 'structure', 'IFCPILE': 'structure',
    'IFCDOOR': 'fills',
    'IFCWINDOW': 'fills',
    'IFCSPACE': 'space',
}

# IFC types that map to FDS OBST (mirrors IFCtoFDS fdsRole logic)
FDS_OBST_TYPES = {
    'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCROOF',
    'IFCCOLUMN', 'IFCBEAM', 'IFCSTAIR', 'IFCFOOTING', 'IFCPILE',
}
FDS_GEOM_TYPES = {'IFCCOVERING', 'IFCMEMBER', 'IFCRAILING', 'IFCPLATE'}
FDS_HOLE_TYPES = {'IFCDOOR', 'IFCWINDOW', 'IFCOPENINGELEMENT'}


def parse_ifc_metadata(file_path):
    """
    Extract element metadata from an IFC file.
    Returns a dict: { elements, summary, bounds, diagnostics }

    Tries ifcopenshell first; falls back to a regex-based fast scan
    that mirrors IFCtoFDS's IfcMeta.buildModel() approach.
    """
    try:
        import ifcopenshell
        return _parse_with_ifcopenshell(file_path)
    except ImportError:
        logger.info('ifcopenshell not installed — using regex fallback parser')
        return _parse_with_regex(file_path)
    except Exception as e:
        logger.exception('ifcopenshell parse failed')
        return _parse_with_regex(file_path)


# ─── ifcopenshell parser (full, accurate) ─────────────────────────────────────

def _parse_with_ifcopenshell(file_path):
    import ifcopenshell
    import ifcopenshell.util.element as ifc_util

    diagnostics = []
    elements = []

    try:
        model = ifcopenshell.open(file_path)
    except Exception as e:
        return {
            'elements': [],
            'summary': [],
            'bounds': None,
            'diagnostics': [{'level': 'error', 'title': 'IFC parse failed', 'detail': str(e)}],
        }

    schema = model.schema
    diagnostics.append({
        'level': 'info',
        'title': f'IFC schema: {schema}',
        'detail': f'File uses {schema} schema.',
    })

    products = model.by_type('IfcProduct')
    for product in products:
        ifc_type = product.is_a().upper()
        category = IFC_CATEGORY_MAP.get(ifc_type, 'other')
        fds_role = _fds_role_for_type(ifc_type)
        name = getattr(product, 'Name', '') or ''

        elements.append({
            'step_id':   str(product.id()),
            'global_id': getattr(product, 'GlobalId', ''),
            'ifc_type':  ifc_type,
            'name':      name,
            'category':  category,
            'convertible': fds_role != '',
            'fds_role':  fds_role,
            'bounds':    None,
        })

    summary = _build_summary(elements)
    bounds  = _compute_bounds_from_elements(elements)

    if not elements:
        diagnostics.append({
            'level': 'warning',
            'title': 'No IfcProduct elements found',
            'detail': 'The file may be empty or use a non-standard schema.',
        })

    return {'elements': elements, 'summary': summary, 'bounds': bounds, 'diagnostics': diagnostics}


# ─── Regex fallback parser (mirrors IFCtoFDS IfcMeta.buildModel) ──────────────

# Matches: #ID=IFCWALL('GlobalId','Owner',...,'Name',...);
_ENTITY_RE = re.compile(
    r'#(\d+)\s*=\s*(IFC\w+)\s*\(',
    re.IGNORECASE
)
_GLOBAL_ID_RE = re.compile(
    r"#(\d+)\s*=\s*(IFC\w+)\s*\(\s*'([^']+)'",
    re.IGNORECASE
)

def _parse_with_regex(file_path):
    diagnostics = [{'level': 'info', 'title': 'Using fast regex parser',
                    'detail': 'ifcopenshell not available — element counts are accurate but bounds are not extracted.'}]
    elements = []

    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            text = f.read()
    except Exception as e:
        return {
            'elements': [], 'summary': [], 'bounds': None,
            'diagnostics': [{'level': 'error', 'title': 'Cannot read IFC file', 'detail': str(e)}],
        }

    # Detect schema
    schema_m = re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'", text, re.IGNORECASE)
    if schema_m:
        diagnostics.append({'level': 'info', 'title': f'IFC schema: {schema_m.group(1)}'})

    for m in _GLOBAL_ID_RE.finditer(text):
        step_id   = m.group(1)
        ifc_type  = m.group(2).upper()
        global_id = m.group(3)

        # Only include spatial/physical products
        if not _is_product_type(ifc_type):
            continue

        category = IFC_CATEGORY_MAP.get(ifc_type, 'other')
        fds_role = _fds_role_for_type(ifc_type)
        elements.append({
            'step_id':    step_id,
            'global_id':  global_id,
            'ifc_type':   ifc_type,
            'name':       '',
            'category':   category,
            'convertible': fds_role != '',
            'fds_role':   fds_role,
            'bounds':     None,
        })

    summary = _build_summary(elements)

    if not elements:
        diagnostics.append({'level': 'warning', 'title': 'No IFC elements matched regex scan'})

    return {'elements': elements, 'summary': summary, 'bounds': None, 'diagnostics': diagnostics}


# ─── Helpers ──────────────────────────────────────────────────────────────────

PRODUCT_TYPES = {
    'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCROOF',
    'IFCCOLUMN', 'IFCBEAM', 'IFCDOOR', 'IFCWINDOW', 'IFCSPACE',
    'IFCSTAIR', 'IFCMEMBER', 'IFCRAILING', 'IFCCURTAINWALL',
    'IFCPLATE', 'IFCCOVERING', 'IFCFOOTING', 'IFCPILE',
    'IFCFURNISHINGELEMENT', 'IFCBUILDINGELEMENTPROXY',
    'IFCOPENINGELEMENT', 'IFCFLOWSEGMENT', 'IFCFLOWTERMINAL',
}

def _is_product_type(ifc_type):
    return ifc_type in PRODUCT_TYPES or ifc_type.startswith('IFC')

def _fds_role_for_type(ifc_type):
    if ifc_type in FDS_OBST_TYPES: return 'OBST'
    if ifc_type in FDS_GEOM_TYPES: return 'GEOM'
    if ifc_type in FDS_HOLE_TYPES: return 'HOLE'
    return ''

def _build_summary(elements):
    """Group elements by IFC type — mirrors IFCtoFDS renderIfcMapping."""
    from collections import defaultdict
    groups = defaultdict(lambda: {'count': 0, 'convertible_count': 0, 'category': 'other', 'fds_role': ''})
    for el in elements:
        g = groups[el['ifc_type']]
        g['count'] += 1
        if el['convertible']:
            g['convertible_count'] += 1
        g['category'] = el['category']
        g['fds_role'] = el['fds_role']

    return [
        {
            'ifc_type':         k,
            'category':         v['category'],
            'count':            v['count'],
            'convertible_count': v['convertible_count'],
            'fds_role':         v['fds_role'],
        }
        for k, v in sorted(groups.items())
    ]

def _compute_bounds_from_elements(elements):
    """Compute overall bounds from per-element bounds (when available)."""
    xs, ys, zs = [], [], []
    for el in elements:
        b = el.get('bounds')
        if not b:
            continue
        xs += [b['xmin'], b['xmax']]
        ys += [b['ymin'], b['ymax']]
        zs += [b['zmin'], b['zmax']]
    if not xs:
        return None
    return {
        'xmin': min(xs), 'xmax': max(xs),
        'ymin': min(ys), 'ymax': max(ys),
        'zmin': min(zs), 'zmax': max(zs),
    }
