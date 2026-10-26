import ActivityLogPage from "./ActivityLogPage";
import SuperAdminActivityPage from "./SuperAdminActivityPage";

// /activity: superadmins get the by-admin overview; admins get the log of
// the users they created. Read at render time so it follows the current login.
export default function ActivityHome() {
  return localStorage.getItem("role") === "superadmin" ? (
    <SuperAdminActivityPage />
  ) : (
    <ActivityLogPage description="Everything done by the users you created — who did it and when" />
  );
}
