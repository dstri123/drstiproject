// Rendered inside App's <DashboardLayout> route (which supplies the Topbar,
// Sidebar and <Outlet/>), so the page must not wrap itself in the layout again.
export default function Users() {
  return <h2 className="text-3xl font-bold tracking-tight">Users Management</h2>;
}
