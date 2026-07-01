import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eye, Loader2, Users, Image as ImageIcon, Cuboid, Folder } from "lucide-react";
import API from "../../api/axios";
import { useNavigate } from "react-router-dom";
import { createProjectSlug } from "@/lib/utils";
import Topbar from "../../layouts/Topbar";

export default function DataDashboard() {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [allProjects, setAllProjects] = useState([]);
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const navigate = useNavigate();

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const res = await API.get("projects/");
      setAllProjects(res.data);
      setProjects(res.data);
    } catch (err) {
      console.error("Failed to fetch projects", err);
    } finally {
      setLoading(false);
    }
  };

  const filterProjects = (startDate, endDate) => {
    let filtered = allProjects;

    if (startDate) {
      filtered = filtered.filter((project) => {
        if (!project.start) return true;
        return new Date(project.start) >= new Date(startDate);
      });
    }

    if (endDate) {
      filtered = filtered.filter((project) => {
        if (!project.end) return true;
        return new Date(project.end) <= new Date(endDate);
      });
    }

    setProjects(filtered);
  };

  const handleStartDateChange = (e) => {
    const date = e.target.value;
    setFilterStartDate(date);
    filterProjects(date, filterEndDate);
  };

  const handleEndDateChange = (e) => {
    const date = e.target.value;
    setFilterEndDate(date);
    filterProjects(filterStartDate, date);
  };

  const handleClearFilters = () => {
    setFilterStartDate("");
    setFilterEndDate("");
    setProjects(allProjects);
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  return (
    <>
      <Topbar />
      <div className="px-4 sm:px-6 py-8 min-h-screen bg-white">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-black mb-1">Projects</h1>
            <p className="text-sm text-gray-600">
              Upload data and access project viewers
            </p>
          </div>

          {/* Filter Section */}
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 mb-6">
            <div className="flex flex-col sm:flex-row gap-4 items-end">
              <div className="flex-1">
                <label className="text-sm font-semibold text-black block mb-2">
                  Start Date From
                </label>
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={handleStartDateChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                />
              </div>

              <div className="flex-1">
                <label className="text-sm font-semibold text-black block mb-2">
                  End Date To
                </label>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={handleEndDateChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
                />
              </div>

              <Button
                onClick={handleClearFilters}
                variant="outline"
                className="border-gray-300 text-black hover:bg-gray-100"
              >
                Clear Filters
              </Button>
            </div>
            {(filterStartDate || filterEndDate) && (
              <p className="text-xs text-gray-600 mt-3">
                Showing {projects.length} of {allProjects.length} project(s)
              </p>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-black" />
            </div>
          ) : projects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((project) => (
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
                    {/* Project Name & Summary */}
                    <div>
                      <h3 className="font-bold text-black text-base">{project.project_name}</h3>
                      <p className="text-xs text-gray-600 line-clamp-2">
                        {project.description && project.description.length > 0
                          ? project.description.substring(0, 80) + (project.description.length > 80 ? "..." : "")
                          : "Upload and access project data through the viewer"}
                      </p>
                    </div>

                    {/* Data Type Badges */}
                    {(() => {
                      const hasBIM = project.bimdata_set && project.bimdata_set.length > 0;
                      const hasCloud = project.pointclouddata_set && project.pointclouddata_set.length > 0;
                      const hasImages = project.images_set && project.images_set.length > 0;
                      const count = (hasBIM ? 1 : 0) + (hasCloud ? 1 : 0) + (hasImages ? 1 : 0);

                      return (
                        <div className="flex items-center justify-between">
                          <div className="flex flex-wrap gap-2 pt-2">
                      {/* BIM Data Badge */}
                      {project.bimdata_set && project.bimdata_set.length > 0 ? (
                        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-black text-white border border-black">
                          BIM
                        </span>
                      ) : (
                        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-400 border border-gray-200 opacity-50">
                          BIM
                        </span>
                      )}

                      {/* Point Cloud Badge */}
                      {project.pointclouddata_set && project.pointclouddata_set.length > 0 ? (
                        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-black text-white border border-black">
                          Cloud
                        </span>
                      ) : (
                        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-400 border border-gray-200 opacity-50">
                          Cloud
                        </span>
                      )}

                      {/* Images Badge - Check for actual uploaded image data */}
                      {project.images_set && project.images_set.length > 0 ? (
                        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-black text-white border border-black">
                          Images
                        </span>
                      ) : (
                        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-400 border border-gray-200 opacity-50">
                          Images
                        </span>
                      )}
                          </div>
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                            count === 0
                              ? "bg-red-100 text-red-700 border-red-200"
                              : count === 1
                              ? "bg-yellow-100 text-yellow-700 border-yellow-200"
                              : count === 2
                              ? "bg-amber-100 text-amber-700 border-amber-200"
                              : "bg-green-100 text-green-700 border-green-200"
                          }`}>
                            {count}/3
                          </span>
                        </div>
                      );
                    })()}

                    {/* Users Count & Dates - Single Row */}
                    <div className="flex items-center justify-between text-xs text-gray-600 gap-2">
                      <div className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        <span>Users: {project.users?.length || 0}</span>
                      </div>
                      {project.start && (
                        <span>
                          Start: {new Date(project.start).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      )}
                      {project.end && (
                        <span>
                          End: {new Date(project.end).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2 pt-2 border-t border-gray-200">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          navigate(`/project/${project.slug || project.project_name.toLowerCase().replace(/\s+/g, '-')}/data`, {
                            state: { projectName: project.project_name },
                          })
                        }
                        className="flex-1 border-gray-300 text-black text-xs hover:bg-gray-50"
                      >
                        Upload Data
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          navigate(`/viewer/${createProjectSlug(project)}`)
                        }
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
              <p className="text-gray-500 text-sm font-medium">No projects available</p>
              <p className="text-gray-400 text-xs mt-1">Check back later for new projects</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
