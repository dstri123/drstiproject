import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, Loader2 } from "lucide-react";
import {
  Box,
  Typography,
  Grid,
  CardMedia,
  CircularProgress,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { motion } from "framer-motion";

import API from "../../api/axios";
import { createProjectSlug } from "@/lib/utils";

export default function ProjectCards3D() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await API.get("/projects/");
      setProjects(res.data || []);
    } catch (err) {
      console.error("Failed to fetch projects", err);
    } finally {
      setLoading(false);
    }
  };

  const handleView = (project) => {
    navigate(`/viewer/${createProjectSlug(project)}`);
  };

  if (loading) {
    return (
      <div className="flex justify-center mt-10">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 bg-slate-50">
      <h2 className="text-3xl font-bold tracking-tight text-center mb-8">
        Project Dashboard
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
        {projects.map((project) => (
          <Card
            key={project.id}
            className="overflow-hidden hover:shadow-lg transition-all hover:-translate-y-1 block"
          >
            <CardContent className="p-0">
              <div className="p-4 border-b">
                <h3 className="text-xl font-bold text-center capitalize">
                  {project.project_name || project.name}
                </h3>
              </div>
              <div className="p-4">
                <img
                  src={
                    project.image ||
                    "https://via.placeholder.com/400x250?text=No+Image"
                  }
                  alt={project.project_name || project.name}
                  className="w-full h-60 object-cover rounded-xl"
                />
              </div>
              <div className="px-4 pb-4">
                <Button
                  className="w-full text-base py-6"
                  onClick={() => handleView(project)}
                >
                  <Eye className="w-5 h-5 mr-2" />
                  View
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
