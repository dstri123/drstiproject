"""Tests for core: the COEP/CORS middleware and the schema/docs routes."""
import contextlib
import io

from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, TestCase

from core.middleware import DisableCOEPMiddleware


class DisableCOEPMiddlewareTests(SimpleTestCase):
    def _run(self, response):
        return DisableCOEPMiddleware(lambda request: response)(RequestFactory().get("/media/x.png"))

    def test_removes_coep_and_adds_cross_origin_headers(self):
        resp = HttpResponse("x")
        resp["Cross-Origin-Embedder-Policy"] = "require-corp"
        out = self._run(resp)
        self.assertNotIn("Cross-Origin-Embedder-Policy", out)
        self.assertEqual(out["Cross-Origin-Resource-Policy"], "cross-origin")
        self.assertEqual(out["Access-Control-Allow-Origin"], "*")

    def test_without_coep_header(self):
        out = self._run(HttpResponse("x"))
        self.assertNotIn("Cross-Origin-Embedder-Policy", out)
        self.assertEqual(out["Cross-Origin-Resource-Policy"], "cross-origin")

    def test_overrides_existing_allow_origin(self):
        resp = HttpResponse("x")
        resp["Access-Control-Allow-Origin"] = "http://a"
        self.assertEqual(self._run(resp)["Access-Control-Allow-Origin"], "*")


class CoreUrlTests(TestCase):
    def test_headers_on_real_api_response(self):
        r = self.client.get("/api/v1/check-admin/")
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("Cross-Origin-Embedder-Policy", r)
        self.assertEqual(r["Cross-Origin-Resource-Policy"], "cross-origin")
        self.assertEqual(r["Access-Control-Allow-Origin"], "*")

    def test_schema_endpoint(self):
        # drf-spectacular prints a warning per APIView without a serializer.
        with contextlib.redirect_stderr(io.StringIO()):
            r = self.client.get("/api/schema/")
        self.assertEqual(r.status_code, 200)
        body = r.content.decode()
        self.assertIn("openapi:", body)
        self.assertIn("/api/v1/issues/project/{project_id}/", body)
        with contextlib.redirect_stderr(io.StringIO()):
            r = self.client.get("/api/schema/?format=json")
        self.assertEqual(r.status_code, 200)
        self.assertIn("paths", r.json())

    def test_swagger_ui(self):
        r = self.client.get("/api/docs/")
        self.assertEqual(r.status_code, 200)
        self.assertIn(b"swagger", r.content.lower())

    def test_token_refresh_route(self):
        r = self.client.post("/api/v1/auth/token/refresh/", {"refresh": "garbage"})
        self.assertEqual(r.status_code, 401)

    def test_admin_site_mounted(self):
        self.assertEqual(self.client.get("/admin/").status_code, 302)
