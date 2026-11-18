import { render, screen } from "@testing-library/react";
import App from "./App";

// Every page is replaced with a marker so this test only checks the routing
// table (and the DashboardLayout / PersistentWorkspace wiring), not the pages.
function mockPage(name) {
  const React = require("react");
  const { useParams } = require("react-router-dom");
  return {
    __esModule: true,
    default: function MockPage() {
      const params = useParams();
      const suffix = Object.keys(params).length ? ` ${JSON.stringify(params)}` : "";
      return React.createElement("div", { "data-testid": "page" }, `${name}${suffix}`);
    },
  };
}

jest.mock("./pages/auth/Login", () => mockPage("Login"));
jest.mock("./pages/auth/ForgotPassword", () => mockPage("ForgotPassword"));
jest.mock("./pages/admin/CreateAdmin", () => mockPage("CreateAdmin"));
jest.mock("./pages/admin/OrganizationManagement", () => mockPage("OrganizationManagement"));
jest.mock("./pages/admin/EditOrganization", () => mockPage("EditOrganization"));
jest.mock("./pages/admin/Projects", () => mockPage("Projects"));
jest.mock("./pages/admin/CreateProject", () => mockPage("CreateProject"));
jest.mock("./pages/admin/EditProject", () => mockPage("EditProject"));
jest.mock("./pages/admin/ProjectContributors", () => mockPage("ProjectContributors"));
jest.mock("./pages/admin/CreateProjectContributor", () => mockPage("CreateProjectContributor"));
jest.mock("./pages/admin/EditProjectContributor", () => mockPage("EditProjectContributor"));
jest.mock("./pages/admin/ProjectManagement", () => mockPage("ProjectManagement"));
jest.mock("./pages/admin/Users", () => mockPage("Users"));
jest.mock("./pages/admin/Profile", () => mockPage("AdminProfile"));
jest.mock("./pages/member/Dashboard", () => mockPage("MemberDashboard"));
jest.mock("./pages/member/CreateUser", () => mockPage("CreateUser"));
jest.mock("./pages/user/Dashboard", () => mockPage("UserDashboard"));
jest.mock("./pages/roles/ManagerDashboard", () => mockPage("ManagerDashboard"));
jest.mock("./pages/roles/EngineerDashboard", () => mockPage("EngineerDashboard"));
jest.mock("./pages/roles/DataDashboard", () => mockPage("DataDashboard"));
jest.mock("./pages/roles/SiteEngineerDashboard", () => mockPage("SiteEngineerDashboard"));
jest.mock("./pages/roles/ProjectDetailsPage", () => mockPage("ProjectDetailsPage"));
jest.mock("./pages/tools/ToolsPage", () => mockPage("ToolsPage"));
jest.mock("./pages/viewer/MapGroundSpike", () => mockPage("MapGroundSpike"));
jest.mock("./pages/photos/PhotoFolders", () => mockPage("PhotoFolders"));
jest.mock("./pages/photos/PhotoFolderView", () => mockPage("PhotoFolderView"));
jest.mock("./pages/photos/PhotoUpload", () => mockPage("PhotoUpload"));
jest.mock("./pages/analytics/ProgressTimelinePage", () => mockPage("ProgressTimelinePage"));
jest.mock("./pages/dashboard/ProjectDashboardPage", () => mockPage("ProjectDashboardPage"));
jest.mock("./pages/activity/ActivityHome", () => mockPage("ActivityHome"));
jest.mock("./pages/activity/AdminActivityDetailPage", () => mockPage("AdminActivityDetailPage"));
// Persistent pages are rendered by PersistentWorkspace (which reads the URL itself).
jest.mock("./pages/viewer/ViewerPage", () => mockPage("ViewerPage"));
jest.mock("./pages/analytics/AnalyticsPage", () => mockPage("AnalyticsPage"));
jest.mock("./pages/analytics/ProgressAssessmentPage", () => mockPage("ProgressAssessmentPage"));
// Layout chrome: Sidebar fetches the profile, so replace it with a marker.
jest.mock("./layouts/Sidebar", () => {
  const React = require("react");
  return { __esModule: true, default: () => React.createElement("nav", { "aria-label": "sidebar" }) };
});

function renderAt(path) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

const pageText = () => screen.getAllByTestId("page").map((el) => el.textContent);

afterEach(() => window.history.pushState({}, "", "/"));

// [path, rendered page, sidebar shown?]
const ROUTES = [
  ["/", "Login", false],
  ["/login", "Login", false],
  ["/forgot-password", "ForgotPassword", false],
  ["/superadmin/organizations", "OrganizationManagement", true],
  ["/superadmin/organizations/create", "CreateAdmin", true],
  ["/superadmin/organizations/5/edit", 'EditOrganization {"id":"5"}', true],
  ["/admin", "Projects", true], // no admin dashboard: redirects to Project Setup
  ["/admin/projects", "Projects", true],
  ["/admin/projects/create", "CreateProject", true],
  ["/admin/projects/7_Tower/edit", 'EditProject {"slug":"7_Tower"}', true],
  ["/admin/project-user", "ProjectContributors", true],
  ["/admin/project-user/create", "CreateProjectContributor", true],
  ["/admin/project-user/3/edit", 'EditProjectContributor {"id":"3"}', true],
  ["/admin/project-management", "ProjectManagement", true],
  ["/admin/users", "Users", true],
  ["/profile", "AdminProfile", true],
  ["/member/dashboard", "MemberDashboard", false],
  ["/member/create-user", "CreateUser", false],
  ["/user/dashboard", "UserDashboard", false],
  ["/manager", "ManagerDashboard", true],
  ["/engineer", "EngineerDashboard", true],
  ["/data", "DataDashboard", true],
  ["/site-engineer", "SiteEngineerDashboard", false],
  ["/project/7_Tower/data", 'ProjectDetailsPage {"slug":"7_Tower"}', true],
  ["/tools", "ToolsPage", true],
  ["/activity", "ActivityHome", true],
  ["/activity/admin/9", 'AdminActivityDetailPage {"adminId":"9"}', true],
  ["/map-spike", "MapGroundSpike", false],
  ["/photos", "PhotoFolders", false],
  ["/photos/4", 'PhotoFolderView {"id":"4"}', false],
  ["/photos/upload", "PhotoUpload", false],
  ["/project/7_Tower/data/upload-images", 'PhotoUpload {"slug":"7_Tower"}', true],
  ["/progress-timeline/7_Tower", 'ProgressTimelinePage {"slug":"7_Tower"}', false],
  ["/project-dashboard/7_Tower", 'ProjectDashboardPage {"slug":"7_Tower"}', false],
];

test.each(ROUTES)("%s renders %s", (path, page, sidebar) => {
  renderAt(path);
  expect(pageText()).toEqual([page]);
  if (sidebar) expect(screen.getByRole("navigation", { name: "sidebar" })).toBeInTheDocument();
  else expect(screen.queryByRole("navigation", { name: "sidebar" })).not.toBeInTheDocument();
});

test("layout routes get the top bar, public routes don't", () => {
  renderAt("/admin");
  expect(screen.getByText("C Twin")).toBeInTheDocument();
});

test("public login page has no dashboard chrome", () => {
  renderAt("/login");
  expect(screen.queryByText("C Twin")).not.toBeInTheDocument();
});

test.each([
  ["/organizations", "/superadmin/organizations", "OrganizationManagement"],
  ["/superadmin", "/superadmin/organizations", "OrganizationManagement"],
  ["/superadmin/create-admin", "/superadmin/organizations/create", "CreateAdmin"],
  ["/admin/profile", "/profile", "AdminProfile"],
])("%s redirects to %s", (from, to, page) => {
  renderAt(from);
  expect(window.location.pathname).toBe(to);
  expect(pageText()).toEqual([page]);
});

test.each([
  ["/viewer/7_Tower", "ViewerPage"],
  ["/analytics/7_Tower", "AnalyticsPage"],
  ["/progress/7_Tower", "ProgressAssessmentPage"],
])("%s is rendered by PersistentWorkspace, outside the layout", (path, page) => {
  renderAt(path);
  expect(pageText()).toEqual([page]);
  expect(screen.queryByText("C Twin")).not.toBeInTheDocument();
});

test("unknown paths render no page", () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  renderAt("/nope");
  expect(screen.queryByTestId("page")).not.toBeInTheDocument();
  warn.mockRestore();
});
