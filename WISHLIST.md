# Wishlist / Future Features

A running list of nice-to-have features that are **deferred** (not needed right
now), so they don't get lost. Move an item into a commit when you decide to build it.

---

## 1. Saved date/time for model transforms  _(deferred — not needed now)_
Add a `transform_saved_at` timestamp to `BIMData` and `PointCloudData` so the UI
can show **when a position/orientation was last saved**.

- **Backend:** add `transform_saved_at = models.DateTimeField(null=True, blank=True)`
  to both models (`rbac_backend_full/projects/models.py`); set it to `timezone.now()`
  in `BIMUpdateView` / `PointCloudUpdateView` whenever a `transform` is saved.
  Run `makemigrations` + `migrate`.
- **Frontend:** show it next to the Save button / in ProjectDetailsPage
  (e.g. "Position saved 2026-06-13 14:02").
- **Why:** auditing — know which uploads have a confirmed alignment and how fresh it is.

---

## 2. Automatic global registration for pathological starts _(optional upgrade)_
Current ICP auto-align uses PCA + identity seeds (good for most cases). For
arbitrary/flipped starts, a feature-based global registration (FPFH + RANSAC)
would be fully robust. Open3D normally does this but has **no Python 3.13 wheel**,
so it would need a numpy/scipy implementation.

---

## 3. Point-size slider for the point cloud _(minor UX)_
Point size is currently auto-derived from the cloud's bounding box. A manual
"Point size" slider in the rotate panel (next to Opacity/Scale) would let users
fine-tune density appearance per cloud.

---

## 4. Large point clouds: octree streaming _(only if needed)_
Current renderer loads the whole cloud into memory (with Float16/Uint8 quantization
+ subsampling). For genuinely huge scans (10M+ points), integrate `potree-core`
(octree LOD streaming) into the existing Three.js scene so BIM overlay, gizmo,
section box and picking keep working.

---

## 5. Repo cleanup: stop tracking `__pycache__` _(housekeeping)_
`*.pyc` files under `rbac_backend_full/**/__pycache__/` are currently tracked.
Add `__pycache__/` and `*.pyc` to `.gitignore` and `git rm --cached` them for a
cleaner repo.
