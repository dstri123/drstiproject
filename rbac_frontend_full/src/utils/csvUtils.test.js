import { downloadCSVTemplate, exportContributorsToCSV, parseCSVFile } from "./csvUtils";

// jsdom has no URL.createObjectURL; capture the Blob and the <a> click instead.
let blobs;
let clicks;
beforeEach(() => {
  blobs = [];
  clicks = [];
  URL.createObjectURL = jest.fn((b) => {
    blobs.push(b);
    return "blob:fake";
  });
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    clicks.push({ href: this.getAttribute("href"), download: this.getAttribute("download"), attached: document.body.contains(this) });
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  delete URL.createObjectURL;
});

const readBlob = (blob) =>
  new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsText(blob);
  });

const csvFile = (text) => new File([text], "c.csv", { type: "text/csv" });

describe("exportContributorsToCSV", () => {
  test.each([[undefined], [null], [[]]])("nothing to export: %p", (input) => {
    expect(exportContributorsToCSV(input)).toEqual({ success: false, message: "No contributors to export" });
    expect(clicks).toHaveLength(0);
  });

  test("writes headers + rows and triggers a dated download", async () => {
    const res = exportContributorsToCSV([
      { username: "ada", email: "a@x.com", first_name: "Ada", last_name: "L", sub_role: "project_engineer" },
      { username: "bob", email: "b@x.com", role: "admin" },
      { username: "cy" },
    ]);
    expect(res).toEqual({ success: true, message: "Contributors exported successfully" });
    expect(clicks).toHaveLength(1);
    expect(clicks[0].href).toBe("blob:fake");
    expect(clicks[0].download).toMatch(/^contributors_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(clicks[0].attached).toBe(true);
    expect(document.querySelector("a[download]")).toBeNull(); // removed afterwards
    expect(blobs[0].type).toBe("text/csv;charset=utf-8;");
    expect(await readBlob(blobs[0])).toBe(
      [
        "Username,Email,First Name,Last Name,Role",
        "ada,a@x.com,Ada,L,PROJECT ENGINEER",
        "bob,b@x.com,,,ADMIN",
        "cy,,,,MEMBER",
      ].join("\n"),
    );
  });

  test("quotes cells with commas, and escapes embedded quotes", async () => {
    exportContributorsToCSV([{ username: "u", email: "e", first_name: 'Jo "JJ"', last_name: "Smith, Jr", role: "admin" }]);
    const text = await readBlob(blobs[0]);
    expect(text.split("\n")[1]).toBe('u,e,"Jo ""JJ""","Smith, Jr",ADMIN');
  });

  test("exported file can be parsed back", async () => {
    const people = [
      { username: "ada", email: "a@x.com", first_name: 'A "B"', last_name: "C, D", role: "data_contributor" },
    ];
    exportContributorsToCSV(people);
    const text = await readBlob(blobs[0]);
    await expect(parseCSVFile(csvFile(text))).resolves.toEqual(people);
  });
});

describe("parseCSVFile", () => {
  const HEADER = "Username,Email,First Name,Last Name,Role";

  test("parses rows and normalises roles", async () => {
    const text = [
      HEADER,
      "ada,a@x.com,Ada,L,PROJECT ENGINEER",
      "bob,b@x.com,Bob,M,data contributor",
      "cy,c@x.com,Cy,N,Project Manager",
      "di,d@x.com,Di,O,SITE ENGINEER",
      "ed,e@x.com,Ed,P,ADMIN",
      "fy,f@x.com,Fy,Q,superadmin",
    ].join("\n");
    const rows = await parseCSVFile(csvFile(text));
    expect(rows.map((r) => r.role)).toEqual([
      "project_engineer",
      "data_contributor",
      "project_manager",
      "site_engineer",
      "admin",
      "project_engineer", // unknown roles fall back
    ]);
    expect(rows[0]).toEqual({ username: "ada", email: "a@x.com", first_name: "Ada", last_name: "L", role: "project_engineer" });
  });

  test("handles CRLF, blank lines, padding and quoted commas", async () => {
    const text = `${HEADER}\r\n\r\n  ada , a@x.com ,"Ada, Jr", L ,ADMIN \r\n`;
    await expect(parseCSVFile(csvFile(text))).resolves.toEqual([
      { username: "ada", email: "a@x.com", first_name: "Ada, Jr", last_name: "L", role: "admin" },
    ]);
  });

  test("headers are case-insensitive and may be in any order", async () => {
    const text = "ROLE,email,USERNAME,last name,First Name\nADMIN,a@x.com,ada,L,Ada";
    await expect(parseCSVFile(csvFile(text))).resolves.toEqual([
      { username: "ada", email: "a@x.com", first_name: "Ada", last_name: "L", role: "admin" },
    ]);
  });

  test("header only -> rejected", async () => {
    await expect(parseCSVFile(csvFile(HEADER))).rejects.toBe("CSV file must have headers and at least one data row");
  });

  test("empty file -> rejected", async () => {
    await expect(parseCSVFile(csvFile(""))).rejects.toBe("CSV file must have headers and at least one data row");
  });

  test("missing a required header -> rejected", async () => {
    await expect(parseCSVFile(csvFile("Username,Email,First Name,Last Name\na,b,c,d"))).rejects.toBe(
      "CSV must contain columns: username, email, first name, last name, role",
    );
  });

  test("short row -> rejected with its row number", async () => {
    const text = `${HEADER}\nada,a@x.com,Ada,L,ADMIN\nbob,b@x.com`;
    await expect(parseCSVFile(csvFile(text))).rejects.toBe("Row 3 has missing columns");
  });

  test("read error -> rejected", async () => {
    const orig = FileReader.prototype.readAsText;
    FileReader.prototype.readAsText = function () {
      this.onerror(new Error("x"));
    };
    try {
      await expect(parseCSVFile(csvFile("x"))).rejects.toBe("Error reading file");
    } finally {
      FileReader.prototype.readAsText = orig;
    }
  });
});

test("downloadCSVTemplate downloads a parseable sample", async () => {
  downloadCSVTemplate();
  expect(clicks).toEqual([{ href: "blob:fake", download: "contributors_template.csv", attached: true }]);
  const rows = await parseCSVFile(csvFile(await readBlob(blobs[0])));
  expect(rows.map((r) => [r.username, r.role])).toEqual([
    ["john_doe", "project_engineer"],
    ["jane_smith", "data_contributor"],
    ["mike_johnson", "project_manager"],
  ]);
});
