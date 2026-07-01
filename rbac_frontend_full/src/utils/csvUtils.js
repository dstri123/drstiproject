// Export contributors to CSV
export const exportContributorsToCSV = (contributors) => {
  if (!contributors || contributors.length === 0) {
    return { success: false, message: "No contributors to export" };
  }

  // Prepare CSV headers
  const headers = ["Username", "Email", "First Name", "Last Name", "Role"];

  // Prepare CSV rows
  const rows = contributors.map((c) => [
    c.username || "",
    c.email || "",
    c.first_name || "",
    c.last_name || "",
    (c.sub_role || c.role || "member").replace(/_/g, " ").toUpperCase(),
  ]);

  // Combine headers and rows
  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row
        .map((cell) =>
          typeof cell === "string" && cell.includes(",")
            ? `"${cell}"`
            : cell
        )
        .join(",")
    ),
  ].join("\n");

  // Create blob and download
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.setAttribute("href", url);
  link.setAttribute("download", `contributors_${new Date().toISOString().split("T")[0]}.csv`);
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return { success: true, message: "Contributors exported successfully" };
};

// Parse CSV file and validate
export const parseCSVFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const csv = e.target.result;
        const lines = csv.split("\n").filter((line) => line.trim());

        if (lines.length < 2) {
          reject("CSV file must have headers and at least one data row");
          return;
        }

        // Parse headers
        const headers = lines[0]
          .split(",")
          .map((h) => h.trim().toLowerCase());

        // Validate required headers
        const requiredHeaders = ["username", "email", "first name", "last name", "role"];
        const hasAllHeaders = requiredHeaders.every((header) =>
          headers.includes(header)
        );

        if (!hasAllHeaders) {
          reject(
            `CSV must contain columns: ${requiredHeaders.join(", ")}`
          );
          return;
        }

        // Parse data rows
        const contributors = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const values = parseCSVLine(line);

          if (values.length < 5) {
            reject(`Row ${i + 1} has missing columns`);
            return;
          }

          contributors.push({
            username: values[0].trim(),
            email: values[1].trim(),
            first_name: values[2].trim(),
            last_name: values[3].trim(),
            role: normalizeRole(values[4].trim()),
          });
        }

        resolve(contributors);
      } catch (error) {
        reject(`Error parsing CSV: ${error.message}`);
      }
    };

    reader.onerror = () => {
      reject("Error reading file");
    };

    reader.readAsText(file);
  });
};

// Helper function to parse CSV line (handles quoted values)
const parseCSVLine = (line) => {
  const values = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
};

// Normalize role from CSV format
const normalizeRole = (role) => {
  const roleMap = {
    "PROJECT ENGINEER": "project_engineer",
    "DATA CONTRIBUTOR": "data_contributor",
    "PROJECT MANAGER": "project_manager",
    "SITE ENGINEER": "site_engineer",
    "ADMIN": "admin",
  };

  return roleMap[role.toUpperCase()] || "project_engineer";
};

// Generate sample CSV template
export const downloadCSVTemplate = () => {
  const headers = ["Username", "Email", "First Name", "Last Name", "Role"];
  const sampleData = [
    ["john_doe", "john@example.com", "John", "Doe", "PROJECT ENGINEER"],
    ["jane_smith", "jane@example.com", "Jane", "Smith", "DATA CONTRIBUTOR"],
    [
      "mike_johnson",
      "mike@example.com",
      "Mike",
      "Johnson",
      "PROJECT MANAGER",
    ],
  ];

  const csvContent = [
    headers.join(","),
    ...sampleData.map((row) => row.join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.setAttribute("href", url);
  link.setAttribute("download", "contributors_template.csv");
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
