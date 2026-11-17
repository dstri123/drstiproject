"""Project images, camera / matrix files, BIM / point-cloud updates,
environmental data, Gaussian files and the project schedule."""
import datetime
import io
import os
import unittest
import zipfile

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction

from projects.models import (
    BIMData, CameraFile, EnvironmentalData, GaussianFile, MatrixFile, PointCloudData,
    ProjectImage, ProjectSchedule,
)

from .test_core import ProjectsTestBase, ifc, las

D1, D2, D3 = datetime.date(2026, 1, 1), datetime.date(2026, 2, 1), datetime.date(2026, 3, 1)


def make_zip(entries, name="photos.zip"):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path, data in entries.items():
            if path.endswith("/"):
                zf.writestr(zipfile.ZipInfo(path), b"")
            else:
                zf.writestr(path, data)
    return SimpleUploadedFile(name, buf.getvalue(), content_type="application/zip")


def txt(name="images.txt"):
    return SimpleUploadedFile(name, b"# COLMAP images\n")


def js(name="matrix.json"):
    return SimpleUploadedFile(name, b"{}")


def png_bytes():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (2, 2), "red").save(buf, "PNG")
    return buf.getvalue()


def media_exists(name):
    return os.path.exists(os.path.join(settings.MEDIA_ROOT, name))


# ── Project images (ZIP upload) ──────────────────────────────────────────────
class ProjectImageTests(ProjectsTestBase):
    def url(self, project_id=None):
        return f"/api/v1/projects/{project_id or self.project.id}/images/"

    def upload(self, entries, **extra):
        data = {"zip_file": make_zip(entries, extra.pop("zip_name", "photos.zip")), **extra}
        return self.client.post(self.url(), data, format="multipart")

    def test_requires_login(self):
        self.assertEqual(self.client.get(self.url()).status_code, 401)
        self.assertEqual(self.client.post(self.url(), {}).status_code, 401)
        self.assertEqual(self.client.delete(self.url() + "?batch_name=x").status_code, 401)
        self.assertEqual(self.client.delete("/api/v1/images/1/delete/").status_code, 401)

    def test_upload_extracts_supported_images_only(self):
        self.login(self.admin)
        r = self.upload({
            "DJI_0001.JPG": b"a", "sub/dir/b.png": b"b", "win\\c.tiff": b"c", "notes.txt": b"x",
            "emptydir/": b"", "\\": b"nameless",
        }, date="2026-04-01")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(len(r.data), 3)
        rows = {i.original_path: i for i in ProjectImage.objects.all()}
        self.assertEqual(set(rows), {"DJI_0001.JPG", "sub/dir/b.png", "win/c.tiff"})
        img = rows["sub/dir/b.png"]
        self.assertEqual((img.batch_name, img.original_name, img.date), ("photos", "b.png", datetime.date(2026, 4, 1)))
        self.assertTrue(img.image.name.startswith("project_images/photos/sub/dir/"))
        self.assertTrue(media_exists(img.image.name))
        self.assertEqual(r.data[0]["project"], self.project.id)
        self.assertTrue(r.data[0]["image"].startswith("http://testserver/media/"))

    def test_requested_batch_name_is_sanitised(self):
        self.login(self.admin)
        r = self.upload({"a.jpg": b"a"}, batch_name="Flight 1")
        self.assertEqual(r.status_code, 200)
        img = ProjectImage.objects.get()
        self.assertEqual(img.batch_name, "Flight_1")
        self.assertIsNone(img.date)
        self.assertEqual(str(img), "a.jpg")

    def test_validation_errors(self):
        self.login(self.admin)
        r = self.client.post(self.url(), {}, format="multipart")
        self.assertEqual((r.status_code, r.data), (400, {"zip_file": "This field is required."}))
        r = self.client.post(self.url(), {"zip_file": SimpleUploadedFile("x.zip", b"not a zip")}, format="multipart")
        self.assertEqual((r.status_code, r.data["zip_file"]), (400, "Upload must be a valid ZIP file."))
        r = self.upload({"readme.md": b"x"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("did not contain any supported image", r.data["zip_file"])
        self.assertFalse(ProjectImage.objects.exists())

    def test_invalid_date_is_400_and_writes_nothing(self):
        """Regression: a bad date used to reach model.save() -> 500, after the
        first file was already written to disk."""
        self.login(self.admin)
        r = self.upload({"a.jpg": b"a"}, date="not-a-date")
        self.assertEqual(r.status_code, 400)
        self.assertIn("date", r.data)
        self.assertFalse(ProjectImage.objects.exists())
        self.assertFalse(media_exists("project_images/photos/a.jpg"))

    def test_path_traversal_entry_is_rejected(self):
        self.login(self.admin)
        r = self.upload({"../evil.jpg": b"x"})
        self.assertEqual(r.status_code, 400)
        self.assertFalse(ProjectImage.objects.exists())
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(settings.MEDIA_ROOT), "evil.jpg")))

    def test_permissions_and_missing_project(self):
        self.login(self.dc)
        r = self.upload({"a.jpg": b"a"})
        self.assertEqual((r.status_code, r.data["error"]), (403, "You are not assigned to this project"))
        self.assign(self.dc)
        self.assertEqual(self.upload({"a.jpg": b"a"}).status_code, 200)
        r = self.client.post(self.url(999999), {"zip_file": make_zip({"a.jpg": b"a"})}, format="multipart")
        self.assertEqual(r.status_code, 404)

    def test_list_and_filter_by_batch(self):
        self.login(self.admin)
        self.upload({"a.jpg": b"a"}, batch_name="one")
        self.upload({"b.jpg": b"b", "c.jpg": b"c"}, batch_name="two")
        self.assertEqual(len(self.client.get(self.url()).data), 3)
        self.assertEqual(len(self.client.get(self.url() + "?batch_name=two").data), 2)
        self.assertEqual(self.client.get(self.url(999999)).data, [])

    def test_delete_batch_removes_rows_and_files(self):
        self.login(self.admin)
        self.upload({"a.jpg": b"a"}, batch_name="one")
        self.upload({"b.jpg": b"b"}, batch_name="two")
        one = ProjectImage.objects.get(batch_name="one").image.name
        two = ProjectImage.objects.get(batch_name="two").image.name
        r = self.client.delete(self.url())
        self.assertEqual((r.status_code, r.data), (400, {"batch_name": "This field is required."}))
        r = self.client.delete(self.url() + "?batch_name=nope")
        self.assertEqual((r.status_code, r.data["error"]), (404, "No images found for that folder."))
        r = self.client.delete(self.url() + "?batch_name=one")
        self.assertEqual((r.status_code, r.data), (200, {"message": "Deleted"}))
        self.assertEqual(list(ProjectImage.objects.values_list("batch_name", flat=True)), ["two"])
        self.assertFalse(media_exists(one))
        self.assertTrue(media_exists(two))

    def test_delete_single_image(self):
        self.login(self.admin)
        self.upload({"a.jpg": b"a"})
        img = ProjectImage.objects.get()
        self.assertEqual(self.client.delete(f"/api/v1/images/{img.id}/delete/").data, {"message": "Deleted"})
        self.assertFalse(ProjectImage.objects.exists())
        self.assertFalse(media_exists(img.image.name))
        r = self.client.delete(f"/api/v1/images/{img.id}/delete/")
        self.assertEqual((r.status_code, r.data["error"]), (404, "Image not found"))


# ── Camera / matrix files (same rules, per batch_name) ───────────────────────
class BatchFileTestsMixin:
    model = None
    kind = ""        # "camera" / "matrix"
    good = None      # factory for a valid upload
    bad_ext = ""
    not_found = ""

    def list_url(self, project_id=None):
        return f"/api/v1/projects/{project_id or self.project.id}/{self.kind}/"

    def upload(self, batch="b1", date="2026-01-01", latest=True, name=None):
        f = self.good(name) if name else self.good()
        return self.client.post(self.list_url(), {"batch_name": batch, "date": date, "is_latest": latest, "file": f},
                                format="multipart")

    def make(self, batch="b1", date=D1, latest=False):
        return self.model.objects.create(project=self.project, batch_name=batch, date=date, is_latest=latest,
                                         file=self.good())

    def test_requires_login(self):
        self.assertEqual(self.client.get(self.list_url()).status_code, 401)
        self.assertEqual(self.client.delete(f"/api/v1/{self.kind}/1/delete/").status_code, 401)
        self.assertEqual(self.client.put(f"/api/v1/{self.kind}/1/update/", {}).status_code, 401)

    def test_upload_and_latest_is_per_batch(self):
        self.login(self.admin)
        a = self.upload("b1").data["id"]
        other = self.upload("b2").data["id"]
        r = self.upload("b1", date="2026-02-01")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["project"], r.data["batch_name"], r.data["is_latest"]), (self.project.id, "b1", True))
        self.assertFalse(self.model.objects.get(id=a).is_latest)
        self.assertTrue(self.model.objects.get(id=other).is_latest)   # other batch untouched
        self.assertTrue(media_exists(self.model.objects.get(id=r.data["id"]).file.name))
        # not-latest upload leaves the current latest alone
        self.upload("b1", latest=False)
        self.assertEqual(self.model.objects.filter(batch_name="b1", is_latest=True).get().id, r.data["id"])

    def test_upload_validation(self):
        self.login(self.admin)
        r = self.client.post(self.list_url(), {"date": "2026-01-01", "file": self.good()}, format="multipart")
        self.assertEqual((r.status_code, r.data), (400, {"batch_name": "This field is required."}))
        r = self.client.post(self.list_url(), {"batch_name": "b", "date": "2026-01-01",
                                               "file": SimpleUploadedFile("x.bin", b"x")}, format="multipart")
        self.assertEqual(r.status_code, 400)
        self.assertIn(self.bad_ext, str(r.data["file"]))
        r = self.client.post(self.list_url(), {"batch_name": "b", "file": self.good()}, format="multipart")
        self.assertIn("date", r.data)
        self.assertFalse(self.model.objects.exists())

    def test_upload_permissions(self):
        self.login(self.dc)
        self.assertEqual(self.upload().status_code, 403)
        self.assign(self.dc)
        self.assertEqual(self.upload().status_code, 200)
        r = self.client.post(self.list_url(999999), {"batch_name": "b", "date": "2026-01-01", "file": self.good()},
                             format="multipart")
        self.assertEqual(r.status_code, 404)

    def test_list_order_and_filter(self):
        old = self.make(date=D1)
        latest = self.make(date=D1, latest=True)
        newer = self.make(date=D2)
        other = self.make(batch="b2", date=D3)
        self.login(self.dc)
        ids = [row["id"] for row in self.client.get(self.list_url()).data]
        self.assertEqual(ids, [latest.id, other.id, newer.id, old.id])
        ids = [row["id"] for row in self.client.get(self.list_url() + "?batch_name=b1").data]
        self.assertEqual(ids, [latest.id, newer.id, old.id])
        self.assertIn(self.kind, str(old))

    def test_delete_latest_promotes_newest_in_same_batch(self):
        old = self.make(date=D1)
        newer = self.make(date=D2)
        latest = self.make(date=D3, latest=True)
        self.make(batch="b2", date=D3)
        self.login(self.admin)
        r = self.client.delete(f"/api/v1/{self.kind}/{latest.id}/delete/")
        self.assertEqual((r.status_code, r.data["promoted_latest_id"]), (200, newer.id))
        self.assertTrue(self.model.objects.get(id=newer.id).is_latest)
        self.assertFalse(self.model.objects.get(id=old.id).is_latest)
        self.assertFalse(self.model.objects.filter(batch_name="b2", is_latest=True).exists())
        self.assertFalse(media_exists(latest.file.name))

    def test_delete_non_latest_and_last(self):
        a = self.make(latest=True)
        b = self.make()
        self.login(self.admin)
        r = self.client.delete(f"/api/v1/{self.kind}/{b.id}/delete/")
        self.assertIsNone(r.data["promoted_latest_id"])
        self.assertTrue(self.model.objects.get(id=a.id).is_latest)
        r = self.client.delete(f"/api/v1/{self.kind}/{a.id}/delete/")   # the only one left
        self.assertEqual((r.status_code, r.data["promoted_latest_id"]), (200, None))
        r = self.client.delete(f"/api/v1/{self.kind}/{a.id}/delete/")
        self.assertEqual((r.status_code, r.data["error"]), (404, self.not_found))

    def test_update_sets_latest_within_batch(self):
        a = self.make(latest=True)
        b = self.make()
        other = self.make(batch="b2", latest=True)
        self.login(self.admin)
        r = self.client.put(f"/api/v1/{self.kind}/{b.id}/update/", {"is_latest": True}, format="json")
        self.assertEqual((r.status_code, r.data["is_latest"]), (200, True))
        self.assertFalse(self.model.objects.get(id=a.id).is_latest)
        self.assertTrue(self.model.objects.get(id=other.id).is_latest)

    def test_update_replacing_file_deletes_old_file(self):
        a = self.make(latest=True)
        old_name = a.file.name
        self.login(self.admin)
        r = self.client.put(f"/api/v1/{self.kind}/{a.id}/update/", {"file": self.good(), "date": "2026-05-01"},
                            format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        a.refresh_from_db()
        self.assertNotEqual(a.file.name, old_name)
        self.assertTrue(media_exists(a.file.name))
        self.assertFalse(media_exists(old_name))
        self.assertTrue(a.is_latest)   # partial update without is_latest keeps it

    def test_update_validation_and_not_found(self):
        a = self.make()
        self.login(self.admin)
        r = self.client.put(f"/api/v1/{self.kind}/{a.id}/update/", {"file": SimpleUploadedFile("x.bin", b"x")},
                            format="multipart")
        self.assertEqual(r.status_code, 400)
        self.assertTrue(media_exists(a.file.name))
        # Regression: used .objects.get() -> DoesNotExist -> 500.
        self.assertEqual(self.client.put(f"/api/v1/{self.kind}/999999/update/", {}, format="json").status_code, 404)


class CameraFileTests(BatchFileTestsMixin, ProjectsTestBase):
    model, kind, bad_ext, not_found = CameraFile, "camera", ".txt", "Camera file not found"
    good = staticmethod(txt)


class MatrixFileTests(BatchFileTestsMixin, ProjectsTestBase):
    model, kind, bad_ext, not_found = MatrixFile, "matrix", ".json", "Matrix file not found"
    good = staticmethod(js)


# ── BIM / point-cloud update ─────────────────────────────────────────────────
class ModelUpdateTestsMixin:
    model = None
    kind = ""
    good = None
    bad = None

    def make(self, latest=False, date=D1):
        return self.model.objects.create(project=self.project, description="d", date=date, is_latest=latest,
                                         file=self.good())

    def url(self, pk):
        return f"/api/v1/{self.kind}/{pk}/update/"

    def test_requires_login(self):
        self.assertEqual(self.client.put(self.url(1), {}).status_code, 401)

    def test_update_metadata_and_latest(self):
        a = self.make(latest=True)
        b = self.make()
        self.login(self.admin)
        r = self.client.put(self.url(b.id), {"description": "new", "date": "2026-06-01", "is_latest": "true"},
                            format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["description"], r.data["date"], r.data["is_latest"]), ("new", "2026-06-01", True))
        self.assertFalse(self.model.objects.get(id=a.id).is_latest)

    def test_update_transform_json(self):
        a = self.make()
        self.login(self.admin)
        r = self.client.put(self.url(a.id), {"transform": {"m": [1, 0, 0, 1]}}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        a.refresh_from_db()
        self.assertEqual(a.transform, {"m": [1, 0, 0, 1]})
        self.assertFalse(a.is_latest)

    def test_replacing_file_deletes_old_file(self):
        a = self.make()
        old = a.file.name
        self.login(self.admin)
        r = self.client.put(self.url(a.id), {"file": self.good()}, format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        a.refresh_from_db()
        self.assertTrue(media_exists(a.file.name))
        self.assertFalse(media_exists(old))

    def test_validation_and_not_found(self):
        a = self.make()
        self.login(self.admin)
        r = self.client.put(self.url(a.id), {"file": self.bad()}, format="multipart")
        self.assertEqual(r.status_code, 400)
        self.assertIn("file", r.data)
        self.assertEqual(self.client.put(self.url(a.id), {"date": "bad"}, format="json").status_code, 400)
        self.assertEqual(self.client.put(self.url(999999), {}, format="json").status_code, 404)

    def test_delete_removes_physical_file(self):
        a = self.make(latest=True)
        self.make()
        self.login(self.admin)
        self.assertEqual(self.client.delete(f"/api/v1/{self.kind}/{a.id}/delete/").status_code, 200)
        self.assertFalse(media_exists(a.file.name))


class PointCloudListTests(ProjectsTestBase):
    def test_list_upload_permission_and_delete_not_found(self):
        a = PointCloudData.objects.create(project=self.project, description="a", date=D1, file=las())
        b = PointCloudData.objects.create(project=self.project, description="b", date=D2, file=las(), is_latest=True)
        url = f"/api/v1/projects/{self.project.id}/pointcloud/"
        self.login(self.dc)
        self.assertEqual([r["id"] for r in self.client.get(url).data], [b.id, a.id])
        r = self.client.post(url, {"description": "x", "date": "2026-01-01", "file": las()}, format="multipart")
        self.assertEqual(r.status_code, 403)
        r = self.client.delete("/api/v1/pointcloud/999999/delete/")
        self.assertEqual((r.status_code, r.data["error"]), (404, "Point cloud not found"))


class BIMUpdateTests(ModelUpdateTestsMixin, ProjectsTestBase):
    model, kind = BIMData, "bim"
    good = staticmethod(ifc)
    bad = staticmethod(las)


class PointCloudUpdateTests(ModelUpdateTestsMixin, ProjectsTestBase):
    model, kind = PointCloudData, "pointcloud"
    good = staticmethod(las)
    bad = staticmethod(ifc)


# ── Environmental data ───────────────────────────────────────────────────────
class EnvironmentalDataTests(ProjectsTestBase):
    def url(self, project_id=None):
        return f"/api/v1/projects/{project_id or self.project.id}/environmental/"

    def post(self, date="2026-01-05", columns=("Temperature",), rows=None):
        rows = {"DJI_0001.JPG": {"Temperature": "31.2"}} if rows is None else rows
        return self.client.post(self.url(), {"date": date, "columns": list(columns), "rows": rows}, format="json")

    def test_requires_login(self):
        self.assertEqual(self.client.get(self.url()).status_code, 401)
        self.assertEqual(self.client.delete("/api/v1/environmental/1/delete/").status_code, 401)

    def test_create_then_replace_same_date(self):
        self.login(self.admin)
        r = self.post()
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["project"], r.data["date"], r.data["columns"]), (self.project.id, "2026-01-05", ["Temperature"]))
        r2 = self.post(columns=["Humidity"], rows={"A.JPG": {"Humidity": "40"}})
        self.assertEqual(r2.data["id"], r.data["id"])
        rec = EnvironmentalData.objects.get()
        self.assertEqual((rec.columns, rec.rows), (["Humidity"], {"A.JPG": {"Humidity": "40"}}))
        self.post(date="2026-01-06")
        self.assertEqual(EnvironmentalData.objects.count(), 2)
        self.assertIn("Tower A", str(rec))

    def test_unique_per_project_and_date_in_db(self):
        EnvironmentalData.objects.create(project=self.project, date=D1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            EnvironmentalData.objects.create(project=self.project, date=D1)

    def test_validation(self):
        self.login(self.admin)
        r = self.client.post(self.url(), {"columns": []}, format="json")
        self.assertEqual((r.status_code, r.data), (400, {"date": "This field is required."}))
        # Regression: an unparsable date used to raise inside the ORM -> 500.
        self.assertEqual(self.post(date="2026-13-45").status_code, 400)
        self.assertEqual(self.post(date="yesterday").status_code, 400)
        r = self.post(columns=["ok", 3])
        self.assertIn("columns must be a list of strings", str(r.data["columns"]))
        r = self.post(rows={"cam": "not-an-object"})
        self.assertIn("rows must be an object", str(r.data["rows"]))
        r = self.post(rows=["x"])
        self.assertEqual(r.status_code, 400)
        self.assertFalse(EnvironmentalData.objects.exists())

    def test_permissions(self):
        self.login(self.dc)
        self.assertEqual(self.post().status_code, 403)
        self.assign(self.dc)
        self.assertEqual(self.post().status_code, 200)
        r = self.client.post(self.url(999999), {"date": "2026-01-01"}, format="json")
        self.assertEqual(r.status_code, 404)

    def test_list_order_and_date_filter(self):
        a = EnvironmentalData.objects.create(project=self.project, date=D1)
        b = EnvironmentalData.objects.create(project=self.project, date=D2)
        self.login(self.members["viewer"])
        self.assertEqual([r["id"] for r in self.client.get(self.url()).data], [b.id, a.id])
        self.assertEqual([r["id"] for r in self.client.get(self.url() + "?date=2026-01-01").data], [a.id])
        self.assertEqual(self.client.get(self.url() + "?date=2026-01-09").data, [])
        r = self.client.get(self.url() + "?date=garbage")
        self.assertEqual(r.status_code, 400)
        self.assertIn("date", r.data)

    def test_delete(self):
        rec = EnvironmentalData.objects.create(project=self.project, date=D1)
        self.login(self.dc)
        r = self.client.delete(f"/api/v1/environmental/{rec.id}/delete/")
        self.assertEqual((r.status_code, r.data["error"]), (403, "You are not assigned to this project"))
        self.assign(self.dc)
        self.assertEqual(self.client.delete(f"/api/v1/environmental/{rec.id}/delete/").data, {"message": "Deleted"})
        self.assertFalse(EnvironmentalData.objects.exists())
        self.assertEqual(self.client.delete(f"/api/v1/environmental/{rec.id}/delete/").status_code, 404)


# ── Gaussian-splatting files ─────────────────────────────────────────────────
class GaussianFileTests(ProjectsTestBase):
    def url(self, project_id=None):
        return f"/api/v1/projects/{project_id or self.project.id}/gaussian-files/"

    def post(self, kind, name, date="2026-01-01"):
        data = {"date": date, "file": SimpleUploadedFile(name, b"data")}
        if kind is not None:
            data["kind"] = kind
        return self.client.post(self.url(), data, format="multipart")

    def test_requires_login(self):
        self.assertEqual(self.client.get(self.url()).status_code, 401)
        self.assertEqual(self.client.delete("/api/v1/gaussian-files/1/delete/").status_code, 401)

    def test_upload_each_kind(self):
        self.login(self.admin)
        for kind, name in (("points3d", "points3D.txt"), ("cameras", "cameras.TXT"), ("trained_ply", "splat.ply")):
            r = self.post(kind, name)
            self.assertEqual(r.status_code, 200, r.data)
            self.assertEqual((r.data["kind"], r.data["original_name"], r.data["project"]), (kind, name, self.project.id))
            obj = GaussianFile.objects.get(id=r.data["id"])
            self.assertTrue(media_exists(obj.file.name))
            self.assertIn(kind, str(obj))

    def test_extension_rules_per_kind(self):
        self.login(self.admin)
        r = self.post("points3d", "points.ply")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(str(r.data["file"][0]), "points3d must be a .txt file.")
        r = self.post("trained_ply", "splat.txt")
        self.assertEqual(str(r.data["file"][0]), "trained_ply must be a .ply file.")
        self.assertIn("kind", self.post("bogus", "x.txt").data)
        self.assertIn("kind", self.post(None, "x.txt").data)
        r = self.client.post(self.url(), {"kind": "cameras", "date": "2026-01-01"}, format="multipart")
        self.assertIn("file", r.data)
        self.assertFalse(GaussianFile.objects.exists())

    def test_permissions(self):
        self.login(self.dc)
        self.assertEqual(self.post("cameras", "cameras.txt").status_code, 403)
        self.assign(self.dc)
        self.assertEqual(self.post("cameras", "cameras.txt").status_code, 200)
        self.assertEqual(self.client.post(self.url(999999), {}, format="multipart").status_code, 404)

    def test_list_order_and_kind_filter(self):
        a = GaussianFile.objects.create(project=self.project, kind="cameras", date=D1, file=txt())
        b = GaussianFile.objects.create(project=self.project, kind="points3d", date=D2, file=txt())
        self.login(self.members["viewer"])
        self.assertEqual([r["id"] for r in self.client.get(self.url()).data], [b.id, a.id])
        self.assertEqual([r["id"] for r in self.client.get(self.url() + "?kind=cameras").data], [a.id])

    def test_delete_removes_file(self):
        obj = GaussianFile.objects.create(project=self.project, kind="cameras", date=D1, file=txt())
        url = f"/api/v1/gaussian-files/{obj.id}/delete/"
        self.login(self.dc)
        self.assertEqual(self.client.delete(url).status_code, 403)
        self.assertTrue(media_exists(obj.file.name))
        self.assign(self.dc)
        self.assertEqual(self.client.delete(url).data, {"message": "Deleted"})
        self.assertFalse(media_exists(obj.file.name))
        self.assertEqual(self.client.delete(url).status_code, 404)


# ── Project schedule ─────────────────────────────────────────────────────────
class ProjectScheduleTests(ProjectsTestBase):
    ACTS = [{"id": "A1", "level": "L1", "start": "2026-01-01", "finish": "2026-01-10"}]

    def url(self, project_id=None):
        return f"/api/v1/projects/{project_id or self.project.id}/schedule/"

    def put(self, meta=None, acts=None, name="plan.xlsx"):
        body = {"file_name": name, "activities": self.ACTS if acts is None else acts}
        if meta is not None:
            body["meta"] = meta
        return self.client.put(self.url(), body, format="json")

    def test_requires_login(self):
        self.assertEqual(self.client.get(self.url()).status_code, 401)
        self.assertEqual(self.client.put(self.url(), {}, format="json").status_code, 401)

    def test_get_none_then_put_creates(self):
        self.login(self.admin)
        r = self.client.get(self.url())
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.data)
        r = self.put(meta={"sheet": "S1"})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["project"], r.data["file_name"], r.data["uploaded_by"], r.data["uploaded_by_name"]),
                         (self.project.id, "plan.xlsx", self.admin.id, "boss"))
        self.assertEqual(self.client.get(self.url()).data["activities"], self.ACTS)
        self.assertIn("plan.xlsx", str(ProjectSchedule.objects.get()))

    def test_replace_keeps_level_map_unless_given(self):
        self.login(self.admin)
        first = self.put().data["id"]
        self.client.patch(self.url(), {"level_map": {"L1": "Level 1"}}, format="json")
        r = self.put(meta={"sheet": "S2"}, name="v2.csv")
        self.assertEqual(r.data["id"], first)
        self.assertEqual(r.data["meta"], {"sheet": "S2", "level_map": {"L1": "Level 1"}})
        r = self.put()   # no meta at all
        self.assertEqual(r.data["meta"], {"level_map": {"L1": "Level 1"}})
        r = self.put(meta={"level_map": {"L1": "B1F"}})
        self.assertEqual(r.data["meta"], {"level_map": {"L1": "B1F"}})
        self.assertEqual(ProjectSchedule.objects.count(), 1)

    def test_put_validation(self):
        self.login(self.admin)
        for acts in ([], [1, 2], "x"):
            r = self.put(acts=acts)
            self.assertEqual(r.status_code, 400, acts)
            self.assertIn("activities must be a non-empty list", str(r.data["activities"]))
        self.assertFalse(ProjectSchedule.objects.exists())

    def test_patch_level_map(self):
        self.login(self.admin)
        r = self.client.patch(self.url(), {"level_map": {"L1": "x"}}, format="json")
        self.assertEqual(r.status_code, 404)   # no schedule yet
        self.put(meta={"sheet": "S1"})
        r = self.client.patch(self.url(), {"level_map": {"L1": "Level 1", "L2": ""}}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["meta"], {"sheet": "S1", "level_map": {"L1": "Level 1"}})
        for bad in ([], {"L1": 3}, "x", None):
            r = self.client.patch(self.url(), {"level_map": bad}, format="json")
            self.assertEqual(r.status_code, 400, bad)
            self.assertIn("level_map", r.data)

    def test_delete(self):
        self.login(self.admin)
        self.put()
        r = self.client.delete(self.url())
        self.assertEqual(r.data, {"message": "Deleted"})
        self.assertFalse(ProjectSchedule.objects.exists())
        self.assertEqual(self.client.delete(self.url()).status_code, 200)   # idempotent
        self.assertEqual(self.client.delete(self.url(999999)).status_code, 404)

    def test_write_permissions(self):
        self.login(self.admin)
        self.put()
        self.login(self.dc)
        self.assertIsNotNone(self.client.get(self.url()).data)   # anyone logged in can read
        self.assertEqual(self.put().status_code, 403)
        self.assertEqual(self.client.patch(self.url(), {"level_map": {}}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(self.url()).status_code, 403)
        self.assertTrue(ProjectSchedule.objects.exists())
        self.assign(self.dc)
        self.assertEqual(self.put().status_code, 200)
        self.assertEqual(self.put().data["uploaded_by_name"], "data_contributor")
        self.assertEqual(self.client.put(self.url(999999), {}, format="json").status_code, 404)
        self.assertEqual(self.client.patch(self.url(999999), {}, format="json").status_code, 404)


class FileEndpointPermissionGapTests(ProjectsTestBase):
    """Delete/update endpoints that only check "logged in" (no assignment
    or role check). expectedFailure until the views enforce it."""

    def setUp(self):
        super().setUp()
        self.viewer = self.members["viewer"]

    @unittest.expectedFailure
    def test_unassigned_member_cannot_delete_image_batch(self):
        ProjectImage.objects.create(project=self.project, batch_name="b", image=SimpleUploadedFile("a.jpg", b"a"))
        self.login(self.viewer)
        self.assertEqual(self.client.delete(f"/api/v1/projects/{self.project.id}/images/?batch_name=b").status_code, 403)

    @unittest.expectedFailure
    def test_unassigned_member_cannot_delete_single_image(self):
        img = ProjectImage.objects.create(project=self.project, batch_name="b", image=SimpleUploadedFile("a.jpg", b"a"))
        self.login(self.viewer)
        self.assertEqual(self.client.delete(f"/api/v1/images/{img.id}/delete/").status_code, 403)

    @unittest.expectedFailure
    def test_unassigned_member_cannot_delete_camera_file(self):
        cam = CameraFile.objects.create(project=self.project, batch_name="b", date=D1, file=txt())
        self.login(self.viewer)
        self.assertEqual(self.client.delete(f"/api/v1/camera/{cam.id}/delete/").status_code, 403)

    @unittest.expectedFailure
    def test_unassigned_member_cannot_update_camera_file(self):
        cam = CameraFile.objects.create(project=self.project, batch_name="b", date=D1, file=txt())
        self.login(self.viewer)
        self.assertEqual(self.client.put(f"/api/v1/camera/{cam.id}/update/", {"is_latest": True}, format="json").status_code, 403)

    @unittest.expectedFailure
    def test_unassigned_member_cannot_delete_matrix_file(self):
        mat = MatrixFile.objects.create(project=self.project, batch_name="b", date=D1, file=js())
        self.login(self.viewer)
        self.assertEqual(self.client.delete(f"/api/v1/matrix/{mat.id}/delete/").status_code, 403)

    @unittest.expectedFailure
    def test_unassigned_member_cannot_update_matrix_file(self):
        mat = MatrixFile.objects.create(project=self.project, batch_name="b", date=D1, file=js())
        self.login(self.viewer)
        self.assertEqual(self.client.put(f"/api/v1/matrix/{mat.id}/update/", {"is_latest": True}, format="json").status_code, 403)

    @unittest.expectedFailure
    def test_unassigned_member_cannot_update_bim(self):
        bim = BIMData.objects.create(project=self.project, description="d", date=D1, file=ifc())
        self.login(self.viewer)
        self.assertEqual(self.client.put(f"/api/v1/bim/{bim.id}/update/", {"description": "x"}, format="json").status_code, 403)

    @unittest.expectedFailure
    def test_unassigned_member_cannot_update_point_cloud(self):
        pc = PointCloudData.objects.create(project=self.project, description="d", date=D1, file=las())
        self.login(self.viewer)
        self.assertEqual(self.client.put(f"/api/v1/pointcloud/{pc.id}/update/", {"description": "x"}, format="json").status_code, 403)

    @unittest.expectedFailure
    def test_unassigned_member_cannot_delete_point_cloud(self):
        ids = [PointCloudData.objects.create(project=self.project, description="d", date=D1, file=las()).id
               for _ in range(2)]
        self.login(self.viewer)
        self.assertEqual(self.client.delete(f"/api/v1/pointcloud/{ids[0]}/delete/").status_code, 403)
