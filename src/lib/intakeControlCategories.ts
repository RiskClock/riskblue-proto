/** Control categories offered at project intake and as Workbench control columns. */
export const INTAKE_CONTROL_CATEGORIES = new Set(["risk detection", "valve and automation controls"]);

export const isIntakeControlCategory = (category?: string | null) =>
  INTAKE_CONTROL_CATEGORIES.has((category || "").trim().toLowerCase());
