import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Folder, Edit, Trash2, Users, Cuboid, Image as ImageIcon, Loader2 } from "lucide-react";
import API from "../../api/axios";
import Topbar from "../../layouts/Topbar";
import { useToast } from "../../components/ToastContainer";
import Pagination from "../../components/Pagination";

export default function Projects() {
  const navigate = useNavigate();
  const { success, error } = useToast();

  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const fetchProjects = async () => {
    try {
      const res = await API.get("projects/");
      setProjects(res.data || []);
    } catch (err) {
      error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
    document.title = "Projects - Drsti";
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this project?")) return;

    try {
      await API.delete(`projects/${id}/`);
      success("Project deleted successfully!");
      fetchProjects();
    } catch (err) {
      error("Failed to delete project");
    }
  };

  const handleEdit = (project) => {
    const slug = project.slug || project.project_name.toLowerCase().replace(/\s+/g, '-');
    navigate(`/admin/projects/${slug}/edit`);
  };

  const filteredProjects = projects.filter((p) =>
    p.project_name?.toLowerCase().includes(search.toLowerCase())
  );

  // Pagination calculation
  const totalPages = Math.ceil(filteredProjects.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedProjects = filteredProjects.slice(
    startIndex,
    startIndex + itemsPerPage
  );

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  return (
    <>
      <Topbar />

      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-black mb-1">
              Projects
            </h1>
            <p className="text-xs sm:text-sm text-gray-600">
              Create and manage your projects
            </p>
          </div>
          <Button
            onClick={() => navigate("/admin/projects/create")}
            className="bg-black hover:bg-gray-900 text-white px-4 py-2.5 font-medium rounded-md flex items-center gap-2 whitespace-nowrap w-full sm:w-auto justify-center sm:justify-start"
          >
            <Plus className="w-4 h-4" />
            Create Project
          </Button>
        </div>

        {/* Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <Input
            placeholder="Search projects by name..."
            className="border-gray-300 w-full sm:max-w-sm text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <p className="text-xs text-gray-600">
              Found {filteredProjects.length} project(s)
            </p>
          )}
        </div>

        {/* Card Grid View */}
        <div>
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-black" />
            </div>
          ) : paginatedProjects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {paginatedProjects.map((project) => (
                <div
                  key={project.id}
                  className="rounded-lg border border-gray-300 bg-white overflow-hidden hover:shadow-lg transition-shadow"
                >
                  {/* Project Image */}
                  <div className="h-40 bg-gray-100 flex items-center justify-center overflow-hidden">
                    {project.image ? (
                      <img
                        src={project.image.startsWith("http") ? project.image : `http://127.0.0.1:8000${project.image}`}
                        alt={project.project_name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.target.style.display = "none";
                          e.target.nextSibling?.classList.remove("hidden");
                        }}
                      />
                    ) : null}
                    <ImageIcon className={`w-12 h-12 text-gray-400 ${project.image ? "hidden" : ""}`} />
                  </div>

                  {/* Card Content */}
                  <div className="p-4 space-y-3">
                    {/* Project Name */}
                    <div>
                      <h3 className="font-bold text-black text-base">{project.project_name}</h3>
                      <p className="text-xs text-gray-600">{project.description || "-"}</p>
                    </div>

                    {/* Users Count & Start Date */}
                    <div className="flex items-center justify-between text-xs text-gray-600">
                      <div className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        <span>Users: {project.users?.length || 0}</span>
                      </div>
                      <div>
                        Start: {project.start
                          ? new Date(project.start).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "2-digit",
                              day: "2-digit",
                            })
                          : "-"}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2 pt-2 border-t border-gray-200">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(project)}
                        className="flex-1 border-gray-300 text-black text-xs hover:bg-gray-50"
                      >
                        <Edit className="w-3 h-3 mr-1" />
                        View Details
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/viewer/${project.slug || project.project_name.toLowerCase().replace(/\s+/g, '-')}`)}
                        className="flex-1 border-gray-300 text-black text-xs hover:bg-gray-50"
                      >
                        <Cuboid className="w-3 h-3 mr-1" />
                        3D Viewer
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
              <Folder className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm font-medium">No projects yet</p>
              <p className="text-gray-400 text-xs mt-1">Click "Create Project" to add one</p>
            </div>
          )}
        </div>

        {/* Pagination */}
        {filteredProjects.length > itemsPerPage && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            itemsPerPage={itemsPerPage}
            totalItems={filteredProjects.length}
          />
        )}
      </div>
    </>
  );
}
