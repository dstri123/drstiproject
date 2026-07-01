import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { useState, useEffect } from "react";

export default function Topbar({ onMenuClick }) {
  const navigate = useNavigate();
  const [dateTime, setDateTime] = useState("");

  const role = localStorage.getItem("role")?.toUpperCase();

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      const date = now.toLocaleDateString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "2-digit"
      });
      const time = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
      setDateTime(`${date} ${time}`);
    };

    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("access");
    localStorage.removeItem("refresh");
    localStorage.removeItem("role");
    navigate("/login", { replace: true });
  };

  return (
    <header className="fixed top-0 left-0 w-full h-16 bg-white border-b border-gray-200 z-50 shadow-sm flex items-center justify-between px-4 sm:px-6">
      <div className="flex items-center space-x-3">
        {/* Hamburger menu for mobile */}
        <button
          onClick={onMenuClick}
          className="md:hidden p-2 hover:bg-gray-100 rounded-md mr-2 cursor-pointer active:bg-gray-200"
          type="button"
          aria-label="Toggle menu"
        >
          <Menu className="w-5 h-5 text-black" />
        </button>

        <img src="/distri-logo.png" alt="Drsti Logo" className="h-8 w-auto" />
        <h1 className="font-bold text-lg tracking-wide text-black">
          Drsti
        </h1>
      </div>

      {/* Date and Time - Typewriter Font */}
      <div className="hidden sm:flex items-center">
        <p className="font-mono text-sm text-gray-600 tracking-tight">
          {dateTime || "-- -- -- --:--:--"}
        </p>
      </div>
    </header>
  );
}
