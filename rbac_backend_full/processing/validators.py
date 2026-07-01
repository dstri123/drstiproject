"""
File validation utilities
Inspired by IFCtoFDS's file-size guard, extension check, and
diagnostics panel that reports errors/warnings on load.
"""
import os
import zipfile


# ─── Allowed extensions ────────────────────────────────────────────────────────

BIM_EXTENSIONS = {'.rvt', '.ifc', '.dwg', '.nwd', '.nwc', '.fbx'}
POINTCLOUD_EXTENSIONS = {'.e57', '.las', '.laz', '.plz', '.pts', '.xyz', '.ply'}
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tif', '.tiff', '.webp'}

# Files above this size get a warning (not an error) — mirrors IFCtoFDS WEB_IFC_MAX_BYTES
BIM_WARN_SIZE_MB = 200
PC_WARN_SIZE_MB  = 700


# ─── Diagnostic result ─────────────────────────────────────────────────────────

class Diagnostic:
    def __init__(self, level, title, detail='', check_name=''):
        self.level      = level       # 'info' | 'warning' | 'error'
        self.title      = title
        self.detail     = detail
        self.check_name = check_name

    def to_dict(self):
        return {
            'level':      self.level,
            'title':      self.title,
            'detail':     self.detail,
            'check_name': self.check_name,
        }


# ─── BIM file validation ───────────────────────────────────────────────────────

def validate_bim_upload(file_obj):
    """
    Runs all BIM file checks and returns a list of Diagnostic objects.
    Inspired by IFCtoFDS finishIfcLoad + renderDiagnostics.
    """
    diagnostics = []
    name = file_obj.name
    ext  = os.path.splitext(name)[1].lower()
    size_mb = file_obj.size / (1024 * 1024)

    # Extension check
    if ext not in BIM_EXTENSIONS:
        diagnostics.append(Diagnostic(
            'error', 'Unsupported file type',
            f'Extension "{ext}" is not a supported BIM format. '
            f'Allowed: {", ".join(sorted(BIM_EXTENSIONS))}',
            check_name='extension'
        ))
        return diagnostics  # no point checking further

    # Size warning (mirrors IFCtoFDS oversizeNotice)
    if size_mb > BIM_WARN_SIZE_MB:
        diagnostics.append(Diagnostic(
            'warning', 'Large file',
            f'{name} is {size_mb:.1f} MB. Files above {BIM_WARN_SIZE_MB} MB may be slow to process.',
            check_name='file_size'
        ))

    # IFC-specific: check magic bytes / header
    if ext == '.ifc':
        diags = _check_ifc_header(file_obj)
        diagnostics.extend(diags)

    # FBX: check magic bytes
    if ext == '.fbx':
        diags = _check_fbx_header(file_obj)
        diagnostics.extend(diags)

    if not diagnostics:
        diagnostics.append(Diagnostic(
            'info', 'File validation passed',
            f'{name} ({size_mb:.1f} MB) passed all checks.',
            check_name='overall'
        ))

    return diagnostics


def validate_pointcloud_upload(file_obj):
    """Runs all point-cloud file checks."""
    diagnostics = []
    name = file_obj.name
    ext  = os.path.splitext(name)[1].lower()
    size_mb = file_obj.size / (1024 * 1024)

    if ext not in POINTCLOUD_EXTENSIONS:
        diagnostics.append(Diagnostic(
            'error', 'Unsupported file type',
            f'Extension "{ext}" is not a supported point-cloud format. '
            f'Allowed: {", ".join(sorted(POINTCLOUD_EXTENSIONS))}',
            check_name='extension'
        ))
        return diagnostics

    if size_mb > PC_WARN_SIZE_MB:
        diagnostics.append(Diagnostic(
            'warning', 'Very large point cloud',
            f'{name} is {size_mb:.1f} MB. Consider subsampling before upload for faster loading.',
            check_name='file_size'
        ))

    if ext == '.ply':
        diags = _check_ply_header(file_obj)
        diagnostics.extend(diags)

    if ext in ('.las', '.laz'):
        diags = _check_las_header(file_obj)
        diagnostics.extend(diags)

    if not diagnostics:
        diagnostics.append(Diagnostic(
            'info', 'File validation passed',
            f'{name} ({size_mb:.1f} MB) passed all checks.',
            check_name='overall'
        ))

    return diagnostics


# ─── Format-specific header checks ────────────────────────────────────────────

def _check_ifc_header(file_obj):
    """IFC files must start with ISO-10303-21."""
    diagnostics = []
    try:
        file_obj.seek(0)
        header = file_obj.read(80).decode('utf-8', errors='ignore')
        file_obj.seek(0)
        if 'ISO-10303-21' not in header:
            diagnostics.append(Diagnostic(
                'warning', 'Unexpected IFC header',
                'The file does not begin with "ISO-10303-21". It may not be a valid STEP/IFC file.',
                check_name='ifc_header'
            ))
        else:
            diagnostics.append(Diagnostic(
                'info', 'IFC STEP header detected',
                'ISO-10303-21 header found — file appears to be valid IFC.',
                check_name='ifc_header'
            ))
    except Exception as e:
        diagnostics.append(Diagnostic('warning', 'Could not read file header', str(e), check_name='ifc_header'))
    return diagnostics


def _check_fbx_header(file_obj):
    """Binary FBX starts with 'Kaydara FBX Binary'."""
    diagnostics = []
    try:
        file_obj.seek(0)
        magic = file_obj.read(23)
        file_obj.seek(0)
        if magic.startswith(b'Kaydara FBX Binary'):
            diagnostics.append(Diagnostic('info', 'Binary FBX detected', check_name='fbx_header'))
        else:
            # Could be ASCII FBX — not an error
            diagnostics.append(Diagnostic(
                'info', 'ASCII or non-standard FBX',
                'File does not begin with the binary FBX magic bytes. It may be ASCII FBX.',
                check_name='fbx_header'
            ))
    except Exception as e:
        diagnostics.append(Diagnostic('warning', 'Could not read FBX header', str(e), check_name='fbx_header'))
    return diagnostics


def _check_ply_header(file_obj):
    """PLY files must start with 'ply'."""
    diagnostics = []
    try:
        file_obj.seek(0)
        magic = file_obj.read(3)
        file_obj.seek(0)
        if magic == b'ply':
            diagnostics.append(Diagnostic('info', 'PLY header detected', check_name='ply_header'))
        else:
            diagnostics.append(Diagnostic(
                'error', 'Invalid PLY file',
                'File does not begin with "ply". The file may be corrupt or in a different format.',
                check_name='ply_header'
            ))
    except Exception as e:
        diagnostics.append(Diagnostic('error', 'Could not read PLY header', str(e), check_name='ply_header'))
    return diagnostics


def _check_las_header(file_obj):
    """LAS/LAZ files must start with the 'LASF' file signature."""
    diagnostics = []
    try:
        file_obj.seek(0)
        magic = file_obj.read(4)
        file_obj.seek(0)
        if magic == b'LASF':
            diagnostics.append(Diagnostic('info', 'LAS/LAZ header detected', check_name='las_header'))
        else:
            diagnostics.append(Diagnostic(
                'error', 'Invalid LAS/LAZ file',
                'File does not begin with "LASF". The file may be corrupt or not a valid LAS/LAZ file.',
                check_name='las_header'
            ))
    except Exception as e:
        diagnostics.append(Diagnostic('error', 'Could not read LAS/LAZ header', str(e), check_name='las_header'))
    return diagnostics


# ─── ZIP image batch validation ───────────────────────────────────────────────

def validate_image_zip(file_obj):
    """
    Validates a ZIP file intended for batch image upload.
    Returns (valid_names, diagnostics).
    """
    diagnostics = []
    valid_names = []

    if not zipfile.is_zipfile(file_obj):
        return [], [Diagnostic('error', 'Not a valid ZIP file', check_name='zip')]

    file_obj.seek(0)
    with zipfile.ZipFile(file_obj, 'r') as zf:
        all_names = zf.namelist()
        for name in all_names:
            if name.endswith('/'):
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext in IMAGE_EXTENSIONS:
                valid_names.append(name)
            else:
                diagnostics.append(Diagnostic(
                    'warning', f'Skipped non-image file',
                    f'"{name}" is not a supported image format and will be ignored.',
                    check_name='zip_contents'
                ))

    if not valid_names:
        diagnostics.append(Diagnostic(
            'error', 'No valid images found in ZIP',
            f'The archive contains {len(all_names)} files but none are supported images.',
            check_name='zip_contents'
        ))
    else:
        diagnostics.append(Diagnostic(
            'info', f'{len(valid_names)} image(s) ready for import',
            check_name='zip_contents'
        ))

    file_obj.seek(0)
    return valid_names, diagnostics
