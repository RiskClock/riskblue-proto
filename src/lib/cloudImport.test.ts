import { describe, expect, test } from "bun:test";
import { isDrawingFile, mergeSelection, removeCloudFile, IMPORT_PROJECT_STATUS_LABEL } from "./cloudImportRules";

describe("cloud drawing import", () => {
  test("only drawing file types can be picked", () => {
    expect(isDrawingFile("A-101.PDF")).toBe(true);
    expect(isDrawingFile("plan.dwg")).toBe(true);
    expect(isDrawingFile("notes.docx")).toBe(false);
  });
  test("picking more files from the same project combines them without duplicates", () => {
    const a = { provider: "forma" as const, containerId: "h", projectId: "p", files: [{ id: "1", name: "a.pdf" }] };
    const b = { ...a, files: [{ id: "1", name: "a.pdf" }, { id: "2", name: "b.pdf" }] };
    const out = mergeSelection([a], b);
    expect(out.length).toBe(1);
    expect(out[0].files.map((f) => f.id)).toEqual(["1", "2"]);
  });
  test("removing the last file drops the selection", () => {
    const a = { provider: "procore" as const, containerId: "c", projectId: "p", files: [{ id: "9", name: "x.pdf" }] };
    expect(removeCloudFile([a], "procore", "9")).toEqual([]);
  });
  test("import statuses read Importing Drawings then Ready for Analysis", () => {
    expect(IMPORT_PROJECT_STATUS_LABEL.importing_drawings).toBe("Importing Drawings");
    expect(IMPORT_PROJECT_STATUS_LABEL.ready_for_analysis).toBe("Ready for Analysis");
  });
});
