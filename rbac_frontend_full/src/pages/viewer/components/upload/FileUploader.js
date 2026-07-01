import React, { useState, useRef, useCallback } from "react";
import { Upload } from "lucide-react";

export default function FileUploader({ label, onFileSelected, accept }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const file = e.dataTransfer.files?.[0];
      if (file) {
        onFileSelected?.(file);
      }
    },
    [onFileSelected],
  );

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected?.(file);
    }

    // Reset input so same file can be selected again
    e.target.value = "";
  };

  return (
    <div
      style={{ marginBottom: "16px" }}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <div
        style={{
          border: "2px dashed",
          borderRadius: "12px",
          padding: "14px 20px",
          textAlign: "center",
          cursor: "pointer",
          transition: "all 0.2s ease",
          backgroundColor: isDragging ? "#eef6ff" : "#fafafa",
          borderColor: isDragging ? "#3b82f6" : "#d1d5db",
          color: "#374151",
          width: "90%",
          margin: "0 auto",
        }}
      >
        <Upload
          size={24}
          strokeWidth={1.8}
          style={{
            color: isDragging ? "#3b82f6" : "#6b7280",
            marginBottom: "8px",
          }}
        />

        <div
          style={{
            fontWeight: 600,
            fontSize: "14px",
            marginBottom: "4px",
          }}
        >
          {label}
        </div>

        <div
          style={{
            fontSize: "12px",
            color: "#6b7280",
          }}
        >
          Drop file here or click to browse
        </div>
      </div>

      {/* Hidden input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />
    </div>
  );
}
