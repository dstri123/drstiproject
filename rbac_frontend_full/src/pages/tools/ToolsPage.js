import React from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, FileText } from "lucide-react";

export default function ToolsPage() {
  const navigate = useNavigate();

  const tools = [];

  return (
    <div className="px-4 sm:px-6 py-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-black mb-2">Tools</h1>
        <p className="text-sm text-gray-600">
          Utility tools for data processing and file conversion
        </p>
      </div>

      {/* Tools Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tools.map((tool) => (
          <Card
            key={tool.id}
            className="hover:shadow-lg transition-shadow cursor-pointer"
            onClick={() => navigate(tool.path)}
          >
            <CardHeader className="pb-4">
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 bg-gray-100 rounded-lg">
                  {tool.icon}
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">
                  {tool.category}
                </span>
              </div>
              <CardTitle className="text-lg text-black">
                {tool.name}
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                {tool.description}
              </p>

              <Button
                className="w-full bg-black hover:bg-gray-900 text-white"
                onClick={() => navigate(tool.path)}
              >
                Open Tool
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Empty State */}
      {tools.length === 0 && (
        <Card className="text-center py-12">
          <CardContent>
            <p className="text-gray-500">No tools available yet</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
