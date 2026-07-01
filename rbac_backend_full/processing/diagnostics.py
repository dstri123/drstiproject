"""
Model diagnostics checks
Inspired by IFCtoFDS's compare/checks.js — runChecks(fdsModel, ifcModel)
Each check function returns a list of Diagnostic-like dicts.
"""
import os


def run_bim_checks(bim_data_instance):
    """
    Run all quality checks on a BIMData instance.
    Returns list of { level, title, detail, check_name }.
    """
    results = []
    results += _check_bim_file_exists(bim_data_instance)
    results += _check_bim_has_transform(bim_data_instance)
    results += _check_bim_date_set(bim_data_instance)
    results += _check_bim_description(bim_data_instance)
    return results


def run_pointcloud_checks(point_data_instance):
    """Run all quality checks on a PointCloudData instance."""
    results = []
    results += _check_pc_file_exists(point_data_instance)
    results += _check_pc_has_transform(point_data_instance)
    results += _check_pc_date_set(point_data_instance)
    return results


def run_project_checks(project_instance):
    """Run consistency checks across a whole project."""
    from projects.models import BIMData, PointCloudData
    results = []

    bim_count = BIMData.objects.filter(project=project_instance).count()
    pc_count  = PointCloudData.objects.filter(project=project_instance).count()

    if bim_count == 0:
        results.append(_diag('warning', 'No BIM files uploaded',
                             'Upload a BIM model to enable 3D comparison.', 'project_bim'))
    if pc_count == 0:
        results.append(_diag('info', 'No point cloud uploaded',
                             'Upload a point cloud for as-built comparison.', 'project_pc'))

    if bim_count > 0 and pc_count > 0:
        results.append(_diag('info', 'BIM and point cloud present',
                             'Both data types are available for overlay comparison.', 'project_complete'))

    # Check project date range
    if project_instance.end < project_instance.start:
        results.append(_diag('error', 'Invalid project dates',
                             'End date is before start date.', 'project_dates'))

    return results


# ─── Individual checks ────────────────────────────────────────────────────────

def _check_bim_file_exists(bim):
    if not bim.file:
        return [_diag('error', 'BIM file missing', 'No file is associated with this record.', 'bim_file')]
    try:
        exists = os.path.exists(bim.file.path)
    except Exception:
        exists = False
    if not exists:
        return [_diag('error', 'BIM file not found on disk',
                      f'File "{bim.file.name}" was expected but does not exist.', 'bim_file')]
    size_mb = os.path.getsize(bim.file.path) / (1024 * 1024)
    if size_mb < 0.001:
        return [_diag('warning', 'BIM file appears empty',
                      f'File is only {size_mb*1024:.1f} KB — it may be corrupt.', 'bim_file')]
    return [_diag('info', f'BIM file OK ({size_mb:.1f} MB)', check_name='bim_file')]


def _check_bim_has_transform(bim):
    if not bim.transform:
        return [_diag('info', 'No saved transform',
                      'Model position has not been saved. Use the viewer to align and save.', 'bim_transform')]
    return []


def _check_bim_date_set(bim):
    if not bim.date:
        return [_diag('warning', 'BIM upload has no date', 'Set a date for timeline filtering.', 'bim_date')]
    return []


def _check_bim_description(bim):
    if not bim.description or len(bim.description.strip()) < 3:
        return [_diag('info', 'BIM description is empty',
                      'Add a description to help team members identify this upload.', 'bim_description')]
    return []


def _check_pc_file_exists(pc):
    if not pc.file:
        return [_diag('error', 'Point cloud file missing', check_name='pc_file')]
    try:
        exists = os.path.exists(pc.file.path)
    except Exception:
        exists = False
    if not exists:
        return [_diag('error', 'Point cloud file not found on disk',
                      f'File "{pc.file.name}" was expected but does not exist.', 'pc_file')]
    size_mb = os.path.getsize(pc.file.path) / (1024 * 1024)
    return [_diag('info', f'Point cloud file OK ({size_mb:.0f} MB)', check_name='pc_file')]


def _check_pc_has_transform(pc):
    if not pc.transform:
        return [_diag('info', 'No saved transform for point cloud',
                      'Align the point cloud with the BIM model and save its position.', 'pc_transform')]
    return []


def _check_pc_date_set(pc):
    if not pc.date:
        return [_diag('warning', 'Point cloud has no date', check_name='pc_date')]
    return []


# ─── Helper ────────────────────────────────────────────────────────────────────

def _diag(level, title, detail='', check_name=''):
    return {'level': level, 'title': title, 'detail': detail, 'check_name': check_name}
