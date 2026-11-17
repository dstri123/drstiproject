import JSZip from "jszip";
import { isoDay, parseDay, parseScheduleFile, workdaysBetween } from "./scheduleParser";

// jsdom 16's File has no .text()/.arrayBuffer(), so feed the parser a
// duck-typed file object.
const textFile = (name, text) => ({ name, text: async () => text });
const csvFile = (lines, name = "schedule.csv") => textFile(name, lines.join("\n"));
const jsonFile = (data, name = "mapping.json") =>
  textFile(name, typeof data === "string" ? data : JSON.stringify(data));

const HEADER =
  "Activity ID,WBS,Level,Elevation (mm),Activity,IFC Type(s),Element Count,Duration (workdays),Start,Finish,Predecessor,Dependency,Mapping Key,Status";

// ---------------------------------------------------------------- helpers

describe("parseDay", () => {
  test("ISO dates (with or without time, single-digit parts)", () => {
    expect(isoDay(parseDay("2024-03-05"))).toBe("2024-03-05");
    expect(isoDay(parseDay("2024-3-5"))).toBe("2024-03-05");
    expect(isoDay(parseDay("  2024-03-05T13:45:00Z "))).toBe("2024-03-05");
  });

  test("slash / dot dates are day-first unless the month would be impossible", () => {
    expect(isoDay(parseDay("03/04/2024"))).toBe("2024-04-03");
    expect(isoDay(parseDay("3.4.2024"))).toBe("2024-04-03");
    expect(isoDay(parseDay("12/25/2024"))).toBe("2024-12-25");
  });

  test("returns UTC midnight", () => {
    const d = parseDay("2024-01-01");
    expect(d.getTime()).toBe(Date.UTC(2024, 0, 1));
  });

  test.each([null, undefined, "", "garbage", "2024/01/01", "01-02-2024", "Jan 5 2024"])(
    "unparseable %p -> null",
    (v) => {
      expect(parseDay(v)).toBeNull();
    },
  );
});

describe("workdaysBetween", () => {
  const d = (s) => parseDay(s);
  test("counts Mon-Fri inclusive", () => {
    // 2024-01-01 is a Monday.
    expect(workdaysBetween(d("2024-01-01"), d("2024-01-05"))).toBe(5);
    expect(workdaysBetween(d("2024-01-01"), d("2024-01-07"))).toBe(5);
    expect(workdaysBetween(d("2024-01-01"), d("2024-01-08"))).toBe(6);
    expect(workdaysBetween(d("2024-01-03"), d("2024-01-03"))).toBe(1);
  });
  test("weekend-only and reversed ranges are 0", () => {
    expect(workdaysBetween(d("2024-01-06"), d("2024-01-07"))).toBe(0);
    expect(workdaysBetween(d("2024-01-05"), d("2024-01-01"))).toBe(0);
  });
});

// ---------------------------------------------------------------- CSV

describe("CSV", () => {
  test("parses the standard BIM schedule layout", async () => {
    const { activities, meta } = await parseScheduleFile(
      csvFile([
        HEADER,
        'A010,1.1,Basement 1,"-3,500",Excavation,IfcFooting,"1,234",5,2024-01-01,2024-01-05,,,MK-1,In Progress',
        "A020,1.2,Basement 1,-3500,Slab,IfcSlab,12,3,2024-01-08,2024-01-10,A010,SS,MK-2,",
      ]),
    );
    expect(meta).toEqual({});
    expect(activities).toHaveLength(2);
    expect(activities[0]).toEqual({
      id: "A010",
      wbs: "1.1",
      level: "Basement 1",
      elevation: -3500,
      name: "Excavation",
      ifcTypes: "IfcFooting",
      elementCount: 1234,
      duration: 5,
      start: "2024-01-01",
      finish: "2024-01-05",
      predecessors: [],
      dependency: "",
      mappingKey: "MK-1",
      status: "In Progress",
      milestone: false,
    });
    expect(activities[1]).toMatchObject({
      predecessors: ["A010"],
      dependency: "SS",
      status: "Not Started",
      elementCount: 12,
    });
  });

  test("column aliases, header case/punctuation and BOM are ignored", async () => {
    const { activities } = await parseScheduleFile(
      csvFile([
        "﻿Task_ID,WBS Code,Storey,Task Name,IFC Type,Elements,Duration Days,Planned Start,Planned Finish,Predecessors,Relationship,Schedule Mapping Key,STATUS",
        "T1,W,L1,Walls,IfcWall,4,2,2024-02-01,2024-02-02,,,K,Completed",
      ]),
    );
    expect(activities[0]).toMatchObject({
      id: "T1",
      wbs: "W",
      level: "L1",
      name: "Walls",
      ifcTypes: "IfcWall",
      elementCount: 4,
      duration: 2,
      start: "2024-02-01",
      finish: "2024-02-02",
      mappingKey: "K",
      status: "Completed",
    });
  });

  test.each([
    ["Floor"],
    ["Phase"],
    ["Level"],
  ])("'%s' column is read as the level", async (col) => {
    const { activities } = await parseScheduleFile(csvFile([`Name,${col},Start Date`, "X,Roof,2024-01-01"]));
    expect(activities[0].level).toBe("Roof");
  });

  test("'End' / 'End Date' alias the finish", async () => {
    const a = await parseScheduleFile(csvFile(["Task,Start,End", "X,2024-01-01,2024-01-03"]));
    const b = await parseScheduleFile(csvFile(["Task,Start,End Date", "X,2024-01-01,2024-01-04"]));
    expect(a.activities[0].finish).toBe("2024-01-03");
    expect(b.activities[0].finish).toBe("2024-01-04");
  });

  test("header row may follow title rows; only the first matching column wins", async () => {
    const { activities } = await parseScheduleFile(
      csvFile([
        "BIM IFC Project Schedule",
        "Generated 2024",
        "",
        "ID,Activity,Name,Start",
        "A1,First name col,Second name col,2024-01-01",
      ]),
    );
    expect(activities[0].name).toBe("First name col");
  });

  test("quoted cells with commas, escaped quotes and CRLF line endings", async () => {
    const { activities } = await parseScheduleFile(
      textFile(
        "s.csv",
        'Activity,Start,Predecessor\r\n"Pour ""Level 2"", slab",2024-01-01,"A1, A2;A3  A4"\r\n',
      ),
    );
    expect(activities[0].name).toBe('Pour "Level 2", slab');
    expect(activities[0].predecessors).toEqual(["A1", "A2", "A3", "A4"]);
    // A predecessor with no Dependency column defaults to finish-to-start.
    expect(activities[0].dependency).toBe("FS");
  });

  test("defaults: generated id, name falls back to id, level Ungrouped, status Not Started", async () => {
    const { activities } = await parseScheduleFile(
      csvFile(["Activity ID,Activity,Start", ",,2024-01-01", "B2,,2024-01-02"]),
    );
    expect(activities[0]).toMatchObject({ id: "T001", name: "T001", level: "Ungrouped", status: "Not Started", wbs: "" });
    expect(activities[1]).toMatchObject({ id: "B2", name: "B2" });
  });

  test("blank rows are skipped; rows without a valid start are dropped", async () => {
    const { activities } = await parseScheduleFile(
      csvFile(["Activity,Start", "A,2024-01-01", ",", "", "B,not a date", "C,"]),
    );
    expect(activities.map((a) => a.name)).toEqual(["A"]);
  });

  test("missing finish is derived from the duration (calendar days)", async () => {
    const { activities } = await parseScheduleFile(
      csvFile(["Activity,Start,Duration", "A,2024-01-01,3", "B,2024-01-01,", "C,2024-01-01,0"]),
    );
    expect(activities[0]).toMatchObject({ finish: "2024-01-03", duration: 3 });
    // No duration -> one day, duration recomputed as workdays.
    expect(activities[1]).toMatchObject({ finish: "2024-01-01", duration: 1, milestone: false });
    // Zero duration -> milestone on the start day.
    expect(activities[2]).toMatchObject({ finish: "2024-01-01", duration: 0, milestone: true });
  });

  test("missing duration is computed as workdays between start and finish", async () => {
    const { activities } = await parseScheduleFile(csvFile(["Activity,Start,Finish", "A,2024-01-01,2024-01-14"]));
    expect(activities[0].duration).toBe(10);
  });

  test("finish before start is clamped to the start", async () => {
    const { activities } = await parseScheduleFile(
      csvFile(["Activity,Start,Finish,Duration", "A,2024-01-10,2024-01-01,2"]),
    );
    expect(activities[0]).toMatchObject({ start: "2024-01-10", finish: "2024-01-10", duration: 2 });
  });

  test("dates as Excel serials and day-first text; small numbers are not dates", async () => {
    const { activities } = await parseScheduleFile(
      csvFile(["Activity,Start,Finish", "A,45292,45296", "B,15/01/2024,20.01.2024", "C,2024-01-01,42"]),
    );
    expect(activities[0]).toMatchObject({ start: "2024-01-01", finish: "2024-01-05" });
    expect(activities[1]).toMatchObject({ start: "2024-01-15", finish: "2024-01-20" });
    // 42 is too small to be a serial date -> treated as no finish.
    expect(activities[2].finish).toBe("2024-01-01");
  });

  test("durations exported as 1900-dates are converted back to day counts", async () => {
    const { activities } = await parseScheduleFile(
      csvFile(["Activity,Start,Finish,Duration", "A,2024-01-01,2024-01-10,1900-01-03", "B,2024-01-01,2024-01-10,4.5d"]),
    );
    expect(activities[0].duration).toBe(3);
    expect(activities[1].duration).toBe(4.5);
  });

  test("non-numeric elevation / element count become null; unparseable duration is recomputed", async () => {
    const { activities } = await parseScheduleFile(
      csvFile(["Activity,Start,Finish,Elevation,Count,Duration", "A,2024-01-01,2024-01-02,n/a,many,abc"]),
    );
    expect(activities[0]).toMatchObject({ elevation: null, elementCount: null, duration: 2 });
  });

  test("no header row in the first 15 rows -> clear error", async () => {
    const rows = Array.from({ length: 15 }, (_, i) => `filler ${i}`);
    await expect(parseScheduleFile(csvFile([...rows, "Activity,Start", "A,2024-01-01"]))).rejects.toThrow(
      /Couldn't find a header row/,
    );
    await expect(parseScheduleFile(csvFile(["Activity,Finish", "A,2024-01-01"]))).rejects.toThrow(
      /'Activity' \(or 'Activity ID'\) and 'Start'/,
    );
    await expect(parseScheduleFile(csvFile([]))).rejects.toThrow(/header row/);
  });

  test("header but no dated rows -> error", async () => {
    await expect(parseScheduleFile(csvFile(["Activity,Start", "A,", "B,tbd"]))).rejects.toThrow(
      "No activities with a valid Start date were found.",
    );
  });
});

// ---------------------------------------------------------------- file types

describe("file type dispatch", () => {
  test("legacy .xls is rejected with advice", async () => {
    await expect(parseScheduleFile(textFile("old.XLS", ""))).rejects.toThrow(/Legacy \.xls isn't supported/);
  });
  test.each([
    ["plan.pdf", '".pdf"'],
    ["noext", '".noext"'],
    ["trailing.", '"."'],
  ])("unsupported %s", async (name, shown) => {
    await expect(parseScheduleFile(textFile(name, ""))).rejects.toThrow(`Unsupported file type ${shown}`);
  });
  test("extension match is case-insensitive", async () => {
    const { activities } = await parseScheduleFile(textFile("S.CSV", "Activity,Start\nA,2024-01-01"));
    expect(activities).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- JSON

describe("JSON (4D mapping export)", () => {
  test("activities + element_mapping + meta", async () => {
    const { activities, meta } = await parseScheduleFile(
      jsonFile({
        source_ifc: "model.ifc",
        schema: "IFC4",
        notes: ["n1"],
        activities: [
          { "Activity ID": "A1", Activity: "Columns", Level: "L1", Start: "2024-01-01", Finish: "2024-01-03", Status: "Completed" },
          { "Activity ID": "A2", Activity: "Beams", Start: "2024-01-04", "Duration (workdays)": 2 },
          { "Activity ID": "A3", Activity: "Roof", Start: "2024-01-08" },
        ],
        element_mapping: [
          { "Activity ID": "A1", GlobalId: "g1" },
          { "Activity ID": "A1", "IFC GUID": "g2" },
          { "Activity ID": "A2" }, // mapped, but no GlobalId column
          { GlobalId: "orphan" }, // no activity id -> ignored
        ],
      }),
    );
    expect(activities.map((a) => a.id)).toEqual(["A1", "A2", "A3"]);
    expect(activities[0]).toMatchObject({ name: "Columns", level: "L1", status: "Completed", mappedElements: 2 });
    expect(activities[1]).toMatchObject({ finish: "2024-01-05", mappedElements: 1 });
    expect(activities[2].mappedElements).toBeUndefined();
    expect(meta).toEqual({
      sourceIfc: "model.ifc",
      schema: "IFC4",
      notes: ["n1"],
      element_mapping: { A1: ["g1", "g2"] },
    });
  });

  test("a bare array of activities is accepted; meta defaults", async () => {
    const { activities, meta } = await parseScheduleFile(
      jsonFile([{ id: "X", name: "Thing", start_date: "2024-05-01", end_date: "2024-05-02" }]),
    );
    expect(activities[0]).toMatchObject({ id: "X", name: "Thing", start: "2024-05-01", finish: "2024-05-02" });
    expect(meta).toEqual({ sourceIfc: null, schema: null, notes: [] });
  });

  test("missing activities array -> clear error", async () => {
    await expect(parseScheduleFile(jsonFile({ tasks: [] }))).rejects.toThrow("JSON must contain an 'activities' array.");
  });

  test("a JSON null document gives the same clear error (not a TypeError)", async () => {
    await expect(parseScheduleFile(jsonFile("null"))).rejects.toThrow("JSON must contain an 'activities' array.");
  });

  test("invalid JSON text rejects", async () => {
    await expect(parseScheduleFile(jsonFile("{not json"))).rejects.toThrow(SyntaxError);
  });

  test("activities without a start date -> error", async () => {
    await expect(parseScheduleFile(jsonFile({ activities: [{ Activity: "x" }] }))).rejects.toThrow(/valid Start date/);
  });
});

// ---------------------------------------------------------------- XLSX

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// cells: array of rows; each cell is a string (shared string), number, or
// {t, v} for explicit types. null leaves a gap.
function sheetXml(rows) {
  const shared = [];
  const body = rows
    .map((cells, ri) => {
      if (!cells) return "";
      const cs = cells
        .map((c, ci) => {
          if (c == null) return "";
          const ref = `${String.fromCharCode(65 + ci)}${ri + 1}`;
          if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
          if (typeof c === "string") {
            shared.push(c);
            return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
          }
          if (c.t === "inlineStr") return `<c r="${ref}" t="inlineStr"><is><t>${esc(c.v)}</t></is></c>`;
          return `<c r="${ref}" t="${c.t}"><v>${esc(c.v)}</v></c>`;
        })
        .join("");
      return `<row r="${ri + 1}">${cs}</row>`;
    })
    .join("");
  return { xml: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`, shared };
}

async function xlsxFile(sheets, { name = "schedule.xlsx", absoluteTargets = false, dropSheetFile = false } = {}) {
  const zip = new JSZip();
  // One shared-string table across sheets: rebase each sheet's indices.
  const allShared = [];
  const sheetXmls = sheets.map((rows) => {
    const offset = allShared.length;
    const { xml, shared } = sheetXml(rows);
    allShared.push(...shared);
    return xml.replace(/t="s"><v>(\d+)</g, (_, i) => `t="s"><v>${+i + offset}<`);
  });
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((_, i) => `<sheet name="S${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}<sheet name="Ghost" sheetId="99" r:id="rIdMissing"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Target="${absoluteTargets ? "/xl/" : "./"}worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  );
  if (allShared.length) {
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${allShared
        .map((s) => `<si><r><t>${esc(s.slice(0, 1))}</t></r><r><t>${esc(s.slice(1))}</t></r></si>`)
        .join("")}</sst>`,
    );
  }
  sheetXmls.forEach((xml, i) => {
    if (!(dropSheetFile && i === 0)) zip.file(`xl/worksheets/sheet${i + 1}.xml`, xml);
  });
  const data = await zip.generateAsync({ type: "uint8array" });
  return { name, arrayBuffer: async () => data };
}

describe("XLSX", () => {
  test("reads shared strings (rich text runs), numbers, inline / str / bool cells and Excel date serials", async () => {
    const file = await xlsxFile([
      [
        ["Activity ID", "Level", "Activity", "Element Count", "Duration", "Start", "Finish", "Status", "Predecessor"],
        ["A1", "L1", { t: "inlineStr", v: "Inline name" }, 7, 3, 45292, 45294, { t: "str", v: "Delayed" }, null],
        ["A2", "L1", "Shared", { t: "b", v: "1" }, 0, 45295, null, null, "A1"],
      ],
    ]);
    const { activities, meta } = await parseScheduleFile(file);
    expect(meta).toEqual({});
    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({
      id: "A1",
      name: "Inline name",
      elementCount: 7,
      duration: 3,
      start: "2024-01-01",
      finish: "2024-01-03",
      status: "Delayed",
      predecessors: [],
    });
    expect(activities[1]).toMatchObject({ id: "A2", name: "Shared", start: "2024-01-04", finish: "2024-01-04", milestone: true, predecessors: ["A1"] });
  });

  test("skips sheets without a schedule header and uses the first one that has it (.xlsm, absolute targets)", async () => {
    const file = await xlsxFile(
      [
        [["Cover sheet"], ["nothing to see"]],
        [null, ["Activity", "Start"], ["Second sheet task", 45292]],
      ],
      { name: "plan.XLSM", absoluteTargets: true },
    );
    const { activities } = await parseScheduleFile(file);
    expect(activities.map((a) => a.name)).toEqual(["Second sheet task"]);
  });

  test("sheet files missing from the zip are ignored", async () => {
    const file = await xlsxFile([[["Activity", "Start"], ["Gone", 45292]], [["Activity", "Start"], ["Kept", 45293]]], {
      dropSheetFile: true,
    });
    const { activities } = await parseScheduleFile(file);
    expect(activities.map((a) => a.name)).toEqual(["Kept"]);
  });

  test("no sheet has a header -> the header error", async () => {
    const file = await xlsxFile([[["hello"]], [["world"]]]);
    await expect(parseScheduleFile(file)).rejects.toThrow(/Couldn't find a header row/);
  });

  test("workbook with no worksheets -> error", async () => {
    const file = await xlsxFile([]);
    await expect(parseScheduleFile(file)).rejects.toThrow("The workbook has no worksheets.");
  });

  test("not a zip -> rejects", async () => {
    await expect(
      parseScheduleFile({ name: "bad.xlsx", arrayBuffer: async () => new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow();
  });
});
