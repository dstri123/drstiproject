"""
Maps API write requests to human-readable activity-log entries.

Each Route matches a path relative to /api/v1/ (named groups `pk` and
`project_id` are picked up automatically). A write that doesn't match any
route — and isn't in SKIP — is still logged with a generic description, so
new endpoints are never silently missed; add a Route here to give them a
nicer message.

Route fields:
  methods     HTTP methods this route applies to
  pattern     regex for the path after /api/v1/
  action      one of ActivityLog.ACTION_CHOICES
  label       what was acted on, e.g. "BIM file"
  model       "app.Model" looked up by `pk` BEFORE the view runs, so deletes
              can still name what they removed and which project it was in
  track       fields of `model` compared before/after the request; any that
              changed are stored in details["changes"] as [old, new]
  name_key    request-data key holding the target's name (for creates)
  project_key request-data key holding the project id
"""
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Route:
    methods: tuple
    pattern: str
    action: str
    label: str
    model: str = None
    track: tuple = ()
    name_key: str = None
    project_key: str = None

    def match(self, method, path):
        if method not in self.methods:
            return None
        return re.fullmatch(self.pattern, path)


POST, PUT, PATCH, DELETE = ("POST",), ("PUT",), ("PATCH",), ("DELETE",)
EDIT = ("PUT", "PATCH")

ROUTES = [
    # ── Projects ─────────────────────────────────────────────────────────────
    Route(POST, r"create-project/", "create", "project", name_key="project_name"),
    Route(EDIT, r"projects/(?P<pk>\d+)/", "update", "project", model="projects.Project",
          track=("project_name", "description", "start", "end", "latitude", "longitude",
                 "altitude", "scale", "zoom", "footprint_area")),
    Route(DELETE, r"projects/(?P<pk>\d+)/delete/", "delete", "project", model="projects.Project"),

    # ── Users & project membership ───────────────────────────────────────────
    Route(POST, r"create-project-user/", "create", "user", name_key="username"),
    Route(POST, r"create-user-assign/", "create", "user", name_key="username"),
    Route(PUT, r"users/(?P<pk>\d+)/", "update", "user", model="accounts.User",
          track=("email", "first_name", "last_name", "sub_role", "description")),
    Route(DELETE, r"users/(?P<pk>\d+)/", "delete", "user", model="accounts.User"),
    Route(PUT, r"update-user-role/(?P<pk>\d+)/", "update", "user role", model="accounts.User",
          track=("sub_role",)),
    Route(POST, r"assign-user/", "assign", "users to project", project_key="project_id"),
    Route(POST, r"remove-user/", "unassign", "user from project", project_key="project_id"),

    # ── Project data files ───────────────────────────────────────────────────
    Route(POST, r"projects/(?P<project_id>\d+)/bim/", "upload", "BIM file"),
    Route(PUT, r"bim/(?P<pk>\d+)/update/", "update", "BIM file", model="projects.BIMData",
          track=("is_latest", "transform")),
    Route(DELETE, r"bim/(?P<pk>\d+)/delete/", "delete", "BIM file", model="projects.BIMData"),

    Route(POST, r"projects/(?P<project_id>\d+)/pointcloud/", "upload", "point cloud"),
    Route(PUT, r"pointcloud/(?P<pk>\d+)/update/", "update", "point cloud",
          model="projects.PointCloudData", track=("is_latest", "transform")),
    Route(DELETE, r"pointcloud/(?P<pk>\d+)/delete/", "delete", "point cloud",
          model="projects.PointCloudData"),

    Route(POST, r"projects/(?P<project_id>\d+)/images/", "upload", "photo batch", name_key="batch_name"),
    Route(DELETE, r"projects/(?P<project_id>\d+)/images/", "delete", "photo batch"),
    Route(DELETE, r"images/(?P<pk>\d+)/delete/", "delete", "photo", model="projects.ProjectImage"),

    Route(POST, r"projects/(?P<project_id>\d+)/camera/", "upload", "camera file", name_key="batch_name"),
    Route(PUT, r"camera/(?P<pk>\d+)/update/", "update", "camera file", model="projects.CameraFile",
          track=("is_latest",)),
    Route(DELETE, r"camera/(?P<pk>\d+)/delete/", "delete", "camera file", model="projects.CameraFile"),

    Route(POST, r"projects/(?P<project_id>\d+)/matrix/", "upload", "matrix file", name_key="batch_name"),
    Route(PUT, r"matrix/(?P<pk>\d+)/update/", "update", "matrix file", model="projects.MatrixFile",
          track=("is_latest",)),
    Route(DELETE, r"matrix/(?P<pk>\d+)/delete/", "delete", "matrix file", model="projects.MatrixFile"),

    Route(POST, r"projects/(?P<project_id>\d+)/environmental/", "upload", "environmental data",
          name_key="date"),
    Route(DELETE, r"environmental/(?P<pk>\d+)/delete/", "delete", "environmental data",
          model="projects.EnvironmentalData"),

    Route(POST, r"projects/(?P<project_id>\d+)/gaussian-files/", "upload", "Gaussian splat file"),
    Route(DELETE, r"gaussian-files/(?P<pk>\d+)/delete/", "delete", "Gaussian splat file",
          model="projects.GaussianFile"),

    Route(PUT, r"projects/(?P<project_id>\d+)/schedule/", "upload", "schedule", name_key="file_name"),
    Route(PATCH, r"projects/(?P<project_id>\d+)/schedule/", "update", "schedule level mapping"),
    Route(DELETE, r"projects/(?P<project_id>\d+)/schedule/", "delete", "schedule"),

    # ── Accounts & organizations ─────────────────────────────────────────────
    Route(POST, r"auth/signup/", "create", "account", name_key="username"),
    Route(POST, r"auth/create-admin/", "create", "organization admin", name_key="username"),
    Route(POST, r"auth/create-member/", "create", "user", name_key="username"),
    Route(POST, r"auth/create-user/", "create", "user", name_key="username"),
    Route(PUT, r"auth/organizations/(?P<pk>\d+)/update/", "update", "organization",
          model="accounts.Organization", track=("name",)),
    Route(DELETE, r"auth/organizations/(?P<pk>\d+)/", "delete", "organization",
          model="accounts.Organization"),
    Route(PUT, r"auth/admins/(?P<pk>\d+)/", "update", "admin", model="accounts.User",
          track=("username", "email", "first_name", "last_name")),
    Route(DELETE, r"auth/admins/(?P<pk>\d+)/", "delete", "admin", model="accounts.User"),
    Route(EDIT, r"(?:auth/)?profile/update/", "update", "own profile"),

    # ── Processing ───────────────────────────────────────────────────────────
    Route(POST, r"processing/progress/save/", "create", "progress assessment", project_key="project_id"),
    Route(POST, r"processing/alignment/pair/", "create", "BIM / point cloud alignment",
          project_key="project_id"),
    Route(POST, r"processing/align/icp/", "process", "ICP auto-alignment"),
    Route(POST, r"processing/gaussian/train/", "process", "Gaussian splat training"),
    Route(POST, r"processing/tools/pointcloud-to-pl(?:y|ay)/", "process", "point cloud to PLY conversion"),
]

LOGIN_PATTERN = re.compile(r"auth/(?:custom-)?login/")

# Writes that change nothing worth auditing (lookups, validation, previews,
# token refresh, the viewer's automatic background saves) or that the
# activity app records itself.
SKIP = [re.compile(p) for p in (
    r"auth/token/refresh/",
    r"auth/check-(?:username|email|admin)/",
    r"check-admin/",
    r"auth/password-reset/(?:request|verify|confirm)/",  # confirm logs itself
    r"processing/(?:validate|bounds|ifc-metadata|jobs)/.*",
    r"processing/progress/(?:analyze|overlap-snapshot)/",
    r"activity/.*",
)]


def normalize(path):
    """accounts.urls is included under both auth/ and auth/signup/, so every
    account endpoint has a twin (auth/signup/custom-login/ ...). Fold the
    twins onto the auth/ form: auth/signup/signup/ -> auth/signup/."""
    return re.sub(r"^auth/signup/(?=.)", "auth/", path)


def find_route(method, path):
    for route in ROUTES:
        match = route.match(method, path)
        if match:
            return route, match.groupdict()
    return None, {}


def is_skipped(path):
    return any(p.fullmatch(path) for p in SKIP)
