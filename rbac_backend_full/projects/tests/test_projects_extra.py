"""Project model / helpers / serializers, project image upload, project
delete side effects and CreateProjectUserView."""
import datetime
from unittest import mock

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase

from accounts.models import User
from projects import views
from projects.models import (
    BIMData, CameraFile, GaussianFile, MatrixFile, PointCloudData, Project, ProjectImage, ProjectUser,
    validate_bim_file, validate_camera_file, validate_matrix_file, validate_pointcloud_file,
)
from projects.serializers import ProjectSerializer, ProjectUserSerializer

from .test_core import PW, ProjectsTestBase, ifc, las
from .test_files import D1, js, media_exists, png_bytes, txt


class HelperTests(SimpleTestCase):
    def test_as_bool(self):
        for v in (True, "true", "True", "1", 1, "yes", "on"):
            self.assertTrue(views.as_bool(v), v)
        for v in (False, "false", "0", 0, None, "", "no", "off"):
            self.assertFalse(views.as_bool(v), v)

    def test_is_valid_date(self):
        self.assertTrue(views.is_valid_date("2026-02-28"))
        self.assertTrue(views.is_valid_date(datetime.date(2026, 1, 1)))
        for v in ("2026-02-30", "2026-13-01", "today", "", None, "2026-01-01T00:00"):
            self.assertFalse(views.is_valid_date(v), v)

    def test_validators(self):
        cases = [
            (validate_bim_file, [".rvt", ".IFC", ".dwg", ".nwd", ".nwc", ".fbx"], ".las", "Only BIM files allowed"),
            (validate_pointcloud_file, [".e57", ".las", ".LAZ", ".plz", ".pts", ".xyz", ".ply"], ".ifc",
             "Only Point Cloud files allowed"),
            (validate_camera_file, [".txt", ".TXT"], ".json", "Only .txt camera files allowed"),
            (validate_matrix_file, [".json"], ".txt", "Only .json matrix files allowed"),
        ]
        for validator, good, bad, msg in cases:
            for ext in good:
                validator(SimpleUploadedFile("f" + ext, b"x"))
            with self.assertRaisesMessage(ValidationError, msg):
                validator(SimpleUploadedFile("f" + bad, b"x"))
            with self.assertRaises(ValidationError):
                validator(SimpleUploadedFile("noext", b"x"))


class SlugTests(ProjectsTestBase):
    def new(self, name):
        return Project.objects.create(project_name=name, description="", start=D1, end=D1)

    def test_duplicate_names_get_unique_slugs(self):
        """Regression: the slug column is unique, so a second project with the
        same name used to raise IntegrityError (500 from create-project)."""
        self.assertEqual(self.new("Tower A").slug, "tower-a-2")
        self.assertEqual(self.new("tower  a!").slug, "tower-a-3")
        self.login(self.admin)
        r = self.client.post("/api/v1/create-project/", {"project_name": "Tower A", "description": "d",
                                                         "start": "2026-01-01", "end": "2026-02-01"})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(Project.objects.get(id=r.data["project_id"]).slug, "tower-a-4")

    def test_unsluggable_name_falls_back(self):
        self.assertEqual(self.new("!!!").slug, "project")
        self.assertEqual(self.new("???").slug, "project-2")

    def test_resave_and_rename_to_same_name_keep_slug(self):
        self.project.description = "changed"
        self.project.save()
        self.assertEqual(self.project.slug, "tower-a")
        self.login(self.admin)
        r = self.client.patch(f"/api/v1/projects/{self.project.id}/", {"project_name": "Tower A"}, format="json")
        self.assertEqual(r.data["slug"], "tower-a")

    def test_rename_onto_existing_name(self):
        other = self.new("Tower B")
        self.login(self.admin)
        r = self.client.patch(f"/api/v1/projects/{other.id}/", {"project_name": "Tower A"}, format="json")
        self.assertEqual((r.status_code, r.data["slug"]), (200, "tower-a-2"))

    def test_explicit_slug_is_kept(self):
        p = Project.objects.create(project_name="X", slug="custom", description="", start=D1, end=D1)
        self.assertEqual(p.slug, "custom")
        self.assertEqual(str(p), "X")


class SerializerTests(ProjectsTestBase):
    def test_project_serializer_lists_related_ids(self):
        bim = BIMData.objects.create(project=self.project, description="d", date=D1, file=ifc())
        img = ProjectImage.objects.create(project=self.project, image=SimpleUploadedFile("a.jpg", b"a"))
        data = ProjectSerializer(self.project).data
        self.assertEqual((data["bimdata_set"], data["pointclouddata_set"], data["images_set"]), ([bim.id], [], [img.id]))
        self.assertEqual(data["slug"], "tower-a")

    def test_project_user_serializer(self):
        pu = ProjectUser.objects.create(user=self.dc, project=self.project)
        self.assertEqual(ProjectUserSerializer(pu).data, {"id": pu.id, "user": self.dc.id, "project": self.project.id})

    def test_project_viewset_is_not_routed(self):
        self.login(self.admin)
        self.assertEqual(self.client.get(f"/api/v1/projects/{self.project.id}/").status_code, 405)


class CreateProjectExtraTests(ProjectsTestBase):
    def test_create_saves_cover_image_sent_by_frontend(self):
        """Regression: CreateProject.js sends `image` but the view ignored it."""
        self.login(self.admin)
        r = self.client.post("/api/v1/create-project/", {
            "project_name": "Img", "description": "d", "start": "2026-01-01", "end": "2026-02-01",
            "image": SimpleUploadedFile("cover.png", png_bytes(), "image/png"),
        }, format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        p = Project.objects.get(id=r.data["project_id"])
        self.assertTrue(p.image.name.startswith("project_images/cover"))
        self.assertTrue(media_exists(p.image.name))

    def test_create_without_image_and_missing_description(self):
        self.login(self.admin)
        r = self.client.post("/api/v1/create-project/", {"project_name": "NoImg", "description": "d",
                                                          "start": "2026-01-01", "end": "2026-02-01"})
        self.assertFalse(Project.objects.get(id=r.data["project_id"]).image)
        # description is NOT NULL and the catch-all turns that into a 500 (reported, not fixed).
        r = self.client.post("/api/v1/create-project/", {"project_name": "X", "start": "2026-01-01", "end": "2026-02-01"})
        self.assertEqual(r.status_code, 500)


class UpdateProjectImageTests(ProjectsTestBase):
    def url(self, pk=None):
        return f"/api/v1/projects/{pk or self.project.id}/"

    def test_upload_and_replace_image(self):
        self.login(self.admin)
        r = self.client.put(self.url(), {"image": SimpleUploadedFile("cover.png", png_bytes(), "image/png")},
                            format="multipart")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["image"].startswith("http://testserver/media/project_images/cover"))
        self.project.refresh_from_db()
        first = self.project.image.name
        self.assertTrue(media_exists(first))
        listed = self.client.get("/api/v1/projects/").data[0]
        self.assertEqual(listed["image"], r.data["image"])
        # Replacing the cover removes the previous file from disk.
        r = self.client.patch(self.url(), {"image": SimpleUploadedFile("cover2.png", png_bytes(), "image/png")},
                              format="multipart")
        self.project.refresh_from_db()
        self.assertTrue(media_exists(self.project.image.name))
        self.assertFalse(media_exists(first))
        # An update without an image keeps it.
        r = self.client.patch(self.url(), {"description": "x"}, format="json")
        self.assertEqual(r.data["image"].rsplit("/", 1)[-1], self.project.image.name.rsplit("/", 1)[-1])

    def test_update_all_geo_fields_and_zero_coordinates(self):
        """Regression: latitude/longitude 0 (equator / meridian) were
        serialised as null because of a truthiness check."""
        self.login(self.admin)
        r = self.client.put(self.url(), {
            "latitude": "0", "longitude": "0", "altitude": 12.5, "scale": 2, "zoom": 17, "footprint_area": 99.5,
            "start": "2026-03-01", "end_date": "2026-09-01", "description": "geo",
        }, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["latitude"], r.data["longitude"]), ("0", "0"))
        self.assertEqual((r.data["altitude"], r.data["scale"], r.data["zoom"], r.data["footprint_area"]),
                         (12.5, 2, 17, 99.5))
        self.project.refresh_from_db()
        self.assertEqual((str(self.project.start), str(self.project.end)), ("2026-03-01", "2026-09-01"))
        row = self.client.get("/api/v1/projects/").data[0]
        self.assertEqual((row["latitude"], row["longitude"]), ("0.000000", "0.000000"))
        self.assertIsNone(row["image"])

    def test_requires_login(self):
        self.assertEqual(self.client.patch(self.url(), {}, format="json").status_code, 401)

    def test_invalid_date_is_reported_as_500(self):
        # Every exception is turned into a 500 (see report); pin current behaviour.
        self.login(self.admin)
        r = self.client.patch(self.url(), {"start": "not-a-date"}, format="json")
        self.assertEqual(r.status_code, 500)
        self.assertIn("error", r.data)


class NotFoundTests(ProjectsTestBase):
    """Regression: get_object_or_404 inside `try/except Exception` turned
    every 404 into a 500."""

    def test_missing_objects_return_404(self):
        self.login(self.admin)
        self.assertEqual(self.client.patch("/api/v1/projects/999999/", {}, format="json").status_code, 404)
        self.assertEqual(self.client.delete("/api/v1/projects/999999/delete/").status_code, 404)
        self.assertEqual(self.client.put("/api/v1/update-user-role/999999/", {"sub_role": "viewer"}).status_code, 404)
        r = self.client.post("/api/v1/assign-user/", {"project_id": 999999, "user_ids": [self.dc.id]}, format="json")
        self.assertEqual(r.status_code, 404)
        r = self.client.post("/api/v1/assign-user/", {"project_id": self.project.id, "user_ids": [999999]}, format="json")
        self.assertEqual(r.status_code, 404)
        r = self.client.post("/api/v1/remove-user/", {"project_id": self.project.id, "user_id": self.dc.id})
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.client.post("/api/v1/remove-user/", {"project_id": self.project.id}).status_code, 400)


class DeleteProjectFilesTests(ProjectsTestBase):
    def test_delete_project_removes_all_uploaded_files(self):
        """Regression: the cascade deleted the rows but left every file on disk."""
        p = self.project
        p.image = SimpleUploadedFile("cover.png", png_bytes())
        p.save()
        objs = [
            BIMData.objects.create(project=p, description="d", date=D1, file=ifc()).file,
            PointCloudData.objects.create(project=p, description="d", date=D1, file=las()).file,
            ProjectImage.objects.create(project=p, image=SimpleUploadedFile("a.jpg", b"a")).image,
            CameraFile.objects.create(project=p, batch_name="b", date=D1, file=txt()).file,
            MatrixFile.objects.create(project=p, batch_name="b", date=D1, file=js()).file,
            GaussianFile.objects.create(project=p, kind="cameras", date=D1, file=txt()).file,
        ]
        names = [f.name for f in objs] + [p.image.name]
        other = Project.objects.create(project_name="Other", description="", start=D1, end=D1)
        keep = BIMData.objects.create(project=other, description="d", date=D1, file=ifc()).file.name
        self.assertTrue(all(media_exists(n) for n in names))
        self.login(self.admin)
        r = self.client.delete(f"/api/v1/projects/{p.id}/delete/")
        self.assertEqual((r.status_code, r.data), (200, {"message": "Project deleted ✅"}))
        self.assertEqual([n for n in names if media_exists(n)], [])
        self.assertTrue(media_exists(keep))
        self.assertFalse(BIMData.objects.filter(project_id=p.id).exists())


class CreateProjectUserTests(ProjectsTestBase):
    url = "/api/v1/create-project-user/"

    def test_creates_member(self):
        self.login(self.admin)
        r = self.client.post(self.url, {"username": "pm2", "password": PW, "sub_role": "project_manager"})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data, {"message": "User created ✅", "username": "pm2", "role": "project_manager"})
        u = User.objects.get(username="pm2")
        self.assertEqual((u.role, u.sub_role, u.is_active, u.created_by), ("member", "project_manager", True, self.admin))
        self.assertTrue(u.check_password(PW))

    def test_validation(self):
        self.login(self.admin)
        for body in ({}, {"username": "a", "password": PW}, {"username": "a", "sub_role": "viewer"},
                     {"password": PW, "sub_role": "viewer"}):
            r = self.client.post(self.url, body)
            self.assertEqual((r.status_code, r.data["error"]), (400, "Missing required fields"), body)

    def test_duplicate_username_is_400(self):
        """Regression: duplicate username hit the DB unique constraint -> 500."""
        self.login(self.admin)
        r = self.client.post(self.url, {"username": "viewer", "password": PW, "sub_role": "viewer"})
        self.assertEqual((r.status_code, r.data["error"]), (400, "Username already exists"))

    def test_requires_login(self):
        self.assertEqual(self.client.post(self.url, {}).status_code, 401)

    def test_unexpected_error_is_500(self):
        self.login(self.admin)
        with mock.patch.object(User.objects, "create_user", side_effect=RuntimeError("db down")):
            r = self.client.post(self.url, {"username": "x1", "password": PW, "sub_role": "viewer"})
        self.assertEqual((r.status_code, r.data["error"]), (500, "db down"))


class ErrorPathTests(ProjectsTestBase):
    """The catch-all `except Exception` branches return 500 with the message."""

    def test_catch_all_branches(self):
        self.login(self.admin)
        boom = RuntimeError("boom")
        with mock.patch.object(User.objects, "create_user", side_effect=boom):
            r = self.client.post("/api/v1/create-user-assign/", {"username": "q", "password": PW, "sub_role": "viewer"})
            self.assertEqual((r.status_code, r.data["error"]), (500, "boom"))
        with mock.patch.object(Project.objects, "create", side_effect=boom):
            r = self.client.post("/api/v1/create-project/", {"project_name": "p", "start": "2026-01-01", "end": "2026-01-02"})
            self.assertEqual(r.status_code, 500)
        with mock.patch.object(views.User.objects, "exclude", side_effect=boom):
            self.assertEqual(self.client.get("/api/v1/users/").status_code, 500)
        with mock.patch.object(views.ProjectUser.objects, "get_or_create", side_effect=boom):
            r = self.client.post("/api/v1/assign-user/", {"project_id": self.project.id, "user_ids": [self.dc.id]},
                                 format="json")
            self.assertEqual(r.status_code, 500)
        ProjectUser.objects.create(user=self.dc, project=self.project)
        with mock.patch.object(ProjectUser, "delete", side_effect=boom):
            r = self.client.post("/api/v1/remove-user/", {"project_id": self.project.id, "user_id": self.dc.id})
            self.assertEqual(r.status_code, 500)
        with mock.patch.object(Project, "delete", side_effect=boom):
            self.assertEqual(self.client.delete(f"/api/v1/projects/{self.project.id}/delete/").status_code, 500)
        with mock.patch.object(User, "save", side_effect=boom):
            self.assertEqual(self.client.put(f"/api/v1/update-user-role/{self.dc.id}/", {"sub_role": "viewer"}).status_code, 400)
            self.assertEqual(
                self.client.put(f"/api/v1/update-user-role/{self.dc.id}/", {"sub_role": "project_manager"}).status_code, 500)
            self.assertEqual(self.client.put(f"/api/v1/users/{self.dc.id}/", {"first_name": "x"}).status_code, 500)
        with mock.patch.object(User, "delete", side_effect=boom):
            self.assertEqual(self.client.delete(f"/api/v1/users/{self.dc.id}/").status_code, 500)
        with mock.patch.object(views.User.objects, "get", side_effect=boom):
            self.assertEqual(self.client.get(f"/api/v1/users/{self.dc.id}/").status_code, 500)

    def test_user_detail_get_and_put_not_found(self):
        self.login(self.admin)
        r = self.client.get(f"/api/v1/users/{self.dc.id}/")
        self.assertEqual((r.data["username"], r.data["sub_role"], r.data["description"]),
                         ("data_contributor", "data_contributor", ""))
        self.assertEqual(self.client.get("/api/v1/users/999999/").status_code, 404)
        self.assertEqual(self.client.put("/api/v1/users/999999/", {}).status_code, 404)
