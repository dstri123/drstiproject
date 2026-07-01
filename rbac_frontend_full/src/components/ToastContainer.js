import { useState, useCallback, createContext, useContext } from "react";
import Toast from "./Toast";

const ToastContext = createContext();

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback(
    (message, type = "success", duration = 3000) => {
      const id = Date.now();
      setToasts((prev) => [...prev, { id, message, type, duration }]);
      return id;
    },
    []
  );

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const success = useCallback(
    (message, duration = 3000) => addToast(message, "success", duration),
    [addToast]
  );

  const error = useCallback(
    (message, duration = 4000) => addToast(message, "error", duration),
    [addToast]
  );

  const info = useCallback(
    (message, duration = 3000) => addToast(message, "info", duration),
    [addToast]
  );

  const value = { addToast, removeToast, success, error, info };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* z-index must beat the full-screen viewer/analytics overlays
          (which use zIndex ~52), otherwise toasts render behind them and
          appear to "not show". */}
      <div
        className="fixed top-0 right-0 p-4 space-y-2"
        style={{ zIndex: 100000 }}
      >
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            id={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
