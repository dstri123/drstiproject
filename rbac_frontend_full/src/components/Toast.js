import { useEffect } from "react";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";

export default function Toast({
  message,
  type = "success",
  onClose,
  duration = 3000,
  id
}) {
  useEffect(() => {
    if (duration) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const bgColors = {
    success: "bg-green-50 border-green-300",
    error: "bg-red-50 border-red-300",
    info: "bg-blue-50 border-blue-300",
  };

  const textColors = {
    success: "text-green-900",
    error: "text-red-900",
    info: "text-blue-900",
  };

  const iconColors = {
    success: "text-green-600",
    error: "text-red-600",
    info: "text-blue-600",
  };

  const icons = {
    success: <CheckCircle2 className={`w-5 h-5 ${iconColors.success}`} />,
    error: <AlertCircle className={`w-5 h-5 ${iconColors.error}`} />,
    info: <Info className={`w-5 h-5 ${iconColors.info}`} />,
  };

  return (
    <div
      className={`fixed top-20 right-4 max-w-md rounded-lg border p-4 shadow-md transition-all duration-300 animate-in fade-in slide-in-from-right-4 ${bgColors[type]}`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        {icons[type]}
        <div className="flex-1">
          <p className={`text-sm font-medium ${textColors[type]}`}>
            {message}
          </p>
        </div>
        <button
          onClick={onClose}
          className={`text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
