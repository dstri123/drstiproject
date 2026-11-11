"""
BCF 2.1 export (buildingSMART BIM Collaboration Format) — opens in Revit
(BCF Manager / Revizto / BIMcollab plugins), Navisworks, Solibri, BIMcollab
Zoom, etc.

Archive layout:
  bcf.version
  project.bcfp
  extensions.xsd                 statuses / priorities / users this export uses
  <topic guid>/markup.bcf        the issue
  <topic guid>/viewpoint.bcfv    camera + pinned element (IfcGuid)
  <topic guid>/snapshot.png      3D view captured when the issue was pinned
  <topic guid>/photo.bcfv        same camera, so the site photo is shown as a
  <topic guid>/photo.jpg         second viewpoint (most tools ignore
                                 DocumentReference, but every tool shows
                                 viewpoint snapshots)

Coordinates are IFC model coordinates in metres (see models.Issue).
"""
import io
import os
import uuid
import zipfile
import xml.etree.ElementTree as ET

from .models import Issue

BCF_VERSION = "2.1"
TOPIC_TYPE = "Issue"


def _guid(issue, kind):
    """Deterministic sub-GUIDs so re-exporting an issue keeps the same
    viewpoint/comment ids and importers update instead of duplicating."""
    return str(uuid.uuid5(issue.guid, kind))


def _sub(parent, tag, text=None, **attrs):
    el = ET.SubElement(parent, tag, {k: str(v) for k, v in attrs.items()})
    if text is not None:
        el.text = str(text)
    return el


def _xml(root):
    buf = io.BytesIO()
    ET.ElementTree(root).write(buf, encoding="utf-8", xml_declaration=True)
    return buf.getvalue()


def _iso(dt):
    return dt.replace(microsecond=0).isoformat()


def _author(user):
    if not user:
        return "unknown"
    return user.email or user.username


def _xyz(parent, tag, values):
    el = _sub(parent, tag)
    for axis, v in zip(("X", "Y", "Z"), values):
        _sub(el, axis, repr(float(v)))
    return el


def _version_xml():
    root = ET.Element("Version", VersionId=BCF_VERSION)
    _sub(root, "DetailedVersion", BCF_VERSION)
    return _xml(root)


def _project_xml(project):
    root = ET.Element("ProjectExtension")
    pid = uuid.uuid5(uuid.NAMESPACE_URL, f"drsti/project/{project.pk}")
    _sub(_sub(root, "Project", ProjectId=pid), "Name", project.project_name)
    _sub(root, "ExtensionSchema", "extensions.xsd")
    return _xml(root)


def _extensions_xsd(statuses, priorities, users):
    xs = "http://www.w3.org/2001/XMLSchema"
    ET.register_namespace("xs", xs)
    root = ET.Element(f"{{{xs}}}schema")
    redefine = _sub(root, f"{{{xs}}}redefine", schemaLocation="markup.xsd")

    def enum(name, values):
        st = _sub(redefine, f"{{{xs}}}simpleType", name=name)
        restriction = _sub(st, f"{{{xs}}}restriction", base=name)
        for v in values:
            _sub(restriction, f"{{{xs}}}enumeration", value=v)

    enum("TopicType", [TOPIC_TYPE])
    enum("TopicStatus", statuses)
    enum("Priority", priorities)
    if users:
        enum("UserIdType", users)
    return _xml(root)


def _viewpoint_xml(issue, guid, global_id):
    root = ET.Element("VisualizationInfo", Guid=guid)
    components = _sub(root, "Components")
    if global_id:
        selection = _sub(components, "Selection")
        _sub(selection, "Component", IfcGuid=global_id)
    _sub(components, "Visibility", DefaultVisibility="true")

    vp = issue.viewpoint or {}
    if vp.get("position") and vp.get("direction"):
        cam = _sub(root, "PerspectiveCamera")
        _xyz(cam, "CameraViewPoint", vp["position"])
        _xyz(cam, "CameraDirection", vp["direction"])
        _xyz(cam, "CameraUpVector", vp.get("up") or [0, 0, 1])
        _sub(cam, "FieldOfView", repr(float(vp.get("fov") or 60)))
    return _xml(root)


def _markup_xml(issue, global_id, bim_name, snapshot_name, photo_name):
    root = ET.Element("Markup")
    if bim_name:
        header = _sub(root, "Header")
        f = _sub(header, "File", isExternal="true")
        _sub(f, "Filename", bim_name)
        if issue.bim and issue.bim.date:
            _sub(f, "Date", f"{issue.bim.date.isoformat()}T00:00:00")

    topic = _sub(root, "Topic", Guid=issue.guid, TopicType=TOPIC_TYPE,
                 TopicStatus=issue.get_status_display())
    _sub(topic, "Title", issue.title)
    _sub(topic, "Priority", issue.get_priority_display())
    _sub(topic, "Index", issue.number)
    _sub(topic, "CreationDate", _iso(issue.created_at))
    _sub(topic, "CreationAuthor", _author(issue.created_by))
    _sub(topic, "ModifiedDate", _iso(issue.updated_at))
    _sub(topic, "ModifiedAuthor", _author(issue.updated_by or issue.created_by))
    if issue.due_date:
        _sub(topic, "DueDate", f"{issue.due_date.isoformat()}T00:00:00")
    if issue.assignee:
        _sub(topic, "AssignedTo", _author(issue.assignee))
    description = issue.description or ""
    if issue.element_type or global_id:
        element = " ".join(p for p in (issue.element_type, global_id) if p)
        description = f"{description}\n\nElement: {element}".strip()
    if description:
        _sub(topic, "Description", description)
    if photo_name:
        doc = _sub(topic, "DocumentReference", Guid=_guid(issue, "photo-doc"),
                   isExternal="false")
        _sub(doc, "ReferencedDocument", f"../{issue.guid}/{photo_name}")
        _sub(doc, "Description", "Site photo")

    vp_guid = _guid(issue, "viewpoint")
    if description:
        comment = _sub(root, "Comment", Guid=_guid(issue, "comment"))
        _sub(comment, "Date", _iso(issue.created_at))
        _sub(comment, "Author", _author(issue.created_by))
        _sub(comment, "Comment", description)
        _sub(comment, "Viewpoint", Guid=vp_guid)

    vps = _sub(root, "Viewpoints", Guid=vp_guid)
    _sub(vps, "Viewpoint", "viewpoint.bcfv")
    if snapshot_name:
        _sub(vps, "Snapshot", snapshot_name)
    if photo_name:
        pvps = _sub(root, "Viewpoints", Guid=_guid(issue, "photo-viewpoint"))
        _sub(pvps, "Viewpoint", "photo.bcfv")
        _sub(pvps, "Snapshot", photo_name)
    return _xml(root)


def _read(field):
    if not field:
        return None
    try:
        field.open("rb")
        try:
            return field.read()
        finally:
            field.close()
    except (OSError, ValueError):
        return None


def _snapshot_entry(issue):
    data = _read(issue.snapshot)
    if not data:
        return None, None
    ext = os.path.splitext(issue.snapshot.name)[1].lower()
    return ("snapshot.jpg" if ext in (".jpg", ".jpeg") else "snapshot.png"), data


def _photo_entry(issue, max_edge=2048):
    """BCF snapshots must be PNG or JPEG, so other formats (HEIC, WebP…) and
    very large phone photos are re-encoded as a JPEG."""
    data = _read(issue.photo)
    if not data:
        return None, None
    try:
        from PIL import Image, ImageOps
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
        img.thumbnail((max_edge, max_edge))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85)
        return "photo.jpg", out.getvalue()
    except Exception:
        return None, None


def build_bcfzip(project, issues, global_ids=None):
    """Bytes of a .bcfzip with one topic per issue. `global_ids`:
    {issue.pk: IfcGuid} for issues whose GlobalId was resolved server-side."""
    global_ids = global_ids or {}
    users = sorted({_author(u) for i in issues for u in (i.assignee, i.created_by) if u})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("bcf.version", _version_xml())
        z.writestr("project.bcfp", _project_xml(project))
        z.writestr("extensions.xsd", _extensions_xsd(
            [label for _, label in Issue.STATUS_CHOICES],
            [label for _, label in Issue.PRIORITY_CHOICES],
            users,
        ))
        for issue in issues:
            folder = str(issue.guid)
            global_id = issue.element_global_id or global_ids.get(issue.pk, "")
            bim_name = os.path.basename(issue.bim.file.name) if issue.bim and issue.bim.file else ""
            snapshot_name, snapshot = _snapshot_entry(issue)
            photo_name, photo = _photo_entry(issue)

            z.writestr(f"{folder}/markup.bcf",
                       _markup_xml(issue, global_id, bim_name, snapshot_name, photo_name))
            z.writestr(f"{folder}/viewpoint.bcfv",
                       _viewpoint_xml(issue, _guid(issue, "viewpoint"), global_id))
            if snapshot:
                z.writestr(f"{folder}/{snapshot_name}", snapshot)
            if photo:
                z.writestr(f"{folder}/photo.bcfv",
                           _viewpoint_xml(issue, _guid(issue, "photo-viewpoint"), global_id))
                z.writestr(f"{folder}/{photo_name}", photo)
    return buf.getvalue()
