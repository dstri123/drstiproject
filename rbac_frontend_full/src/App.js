import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Navigate } from "react-router-dom";

// Auth
import Login from "./pages/auth/Login";

// Super Admin
import CreateAdmin from "./pages/admin/CreateAdmin";
import OrganizationManagement from "./pages/admin/OrganizationManagement";
import EditOrganization from "./pages/admin/EditOrganization";

// Admin
import AdminDashboard from "./pages/admin/Dashboard";
import Projects from "./pages/admin/Projects";
import CreateProject from "./pages/admin/CreateProject";
import EditProject from "./pages/admin/EditProject";
import ProjectContributors from "./pages/admin/ProjectContributors";
import CreateProjectContributor from "./pages/admin/CreateProjectContributor";
import EditProjectContributor from "./pages/admin/EditProjectContributor";
import ProjectManagement from "./pages/admin/ProjectManagement";
import Users from "./pages/admin/Users";
import AdminProfile from "./pages/admin/Profile";

// Member
import MemberDashboard from "./pages/member/Dashboard";
import CreateUser from "./pages/member/CreateUser";

// User
import UserDashboard from "./pages/user/Dashboard";

// Layout
import DashboardLayout from "./layouts/DashboardLayout";
import { ToastProvider } from "./components/ToastContainer";

//subroles
import ManagerDashboard from "./pages/roles/ManagerDashboard";
import EngineerDashboard from "./pages/roles/EngineerDashboard";
import DataDashboard from "./pages/roles/DataDashboard";

import ProjectDetailsPage from "./pages/roles/ProjectDetailsPage";

// Tools
import ToolsPage from "./pages/tools/ToolsPage";
import IFCConverterTool from "./pages/tools/IFCConverterTool";

import ViewerPage from "./pages/viewer/ViewerPage";
import MapGroundSpike from "./pages/viewer/MapGroundSpike";
import PhotoFolders from "./pages/photos/PhotoFolders";
import PhotoFolderView from "./pages/photos/PhotoFolderView";
import PhotoUpload from "./pages/photos/PhotoUpload";
import AnalyticsPage from "./pages/analytics/AnalyticsPage";
import ProgressAssessmentPage from "./pages/analytics/ProgressAssessmentPage";

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          {/* 🔓 Public Routes (NO layout) */}
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />

          {/* 🔐 Layout Wrapper */}
          <Route element={<DashboardLayout />}>
            {/* Super Admin */}
            <Route path="/superadmin/organizations" element={<OrganizationManagement />} />
            <Route path="/superadmin/organizations/create" element={<CreateAdmin />} />
            <Route path="/superadmin/organizations/:id/edit" element={<EditOrganization />} />
            <Route path="/organizations" element={<Navigate to="/superadmin/organizations" replace />} />
            <Route path="/superadmin" element={<Navigate to="/superadmin/organizations" replace />} />
            <Route path="/superadmin/create-admin" element={<Navigate to="/superadmin/organizations/create" replace />} />

          {/* Admin */}
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/projects" element={<Projects />} />
          <Route path="/admin/projects/create" element={<CreateProject />} />
          <Route path="/admin/projects/:slug/edit" element={<EditProject />} />
          <Route path="/admin/project-user" element={<ProjectContributors />} />
          <Route path="/admin/project-user/create" element={<CreateProjectContributor />} />
          <Route path="/admin/project-user/:id/edit" element={<EditProjectContributor />} />
          <Route
            path="/admin/project-management"
            element={<ProjectManagement />}
          />
          <Route path="/admin/users" element={<Users />} />
          <Route path="/profile" element={<AdminProfile />} />
          <Route
            path="/admin/profile"
            element={<Navigate to="/profile" replace />}
          />

          {/* Member */}
          <Route path="/member/dashboard" element={<MemberDashboard />} />
          <Route path="/member/create-user" element={<CreateUser />} />

          {/* User */}
          <Route path="/user/dashboard" element={<UserDashboard />} />

          <Route path="/manager" element={<ManagerDashboard />} />
          <Route path="/engineer" element={<EngineerDashboard />} />
          <Route path="/data" element={<DataDashboard />} />
          <Route path="/project/:slug/data" element={<ProjectDetailsPage />} />

          {/* Tools */}
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/tools/ifc-converter" element={<IFCConverterTool />} />

          {/* 3D Viewer */}
          <Route path="/viewer/:projectSlug" element={<ViewerPage />} />
          {/* SPIKE: MapLibre + Three.js geo map prototype */}
          <Route path="/map-spike" element={<MapGroundSpike />} />
          <Route path="/photos" element={<PhotoFolders />} />
          <Route path="/photos/:id" element={<PhotoFolderView />} />
          <Route path="/photos/upload" element={<PhotoUpload />} />
          <Route
            path="/project/:slug/data/upload-images"
            element={<PhotoUpload />}
          />
          {/* Analytics — split-screen model comparison, project ID from viewer */}
          <Route path="/analytics/:slug" element={<AnalyticsPage />} />
          <Route path="/progress/:slug" element={<ProgressAssessmentPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </ToastProvider>
  );
}
