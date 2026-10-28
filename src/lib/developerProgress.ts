export type DeveloperProgress = { currentStep: number; waiting: boolean };

/** Sample bids cannot bypass unfinished drawing intake or analysis. */
export function developerListStatus(status: string | undefined, hasBids: boolean): string {
  if (status === "processed" && hasBids) return "receiving_bids";
  return status || "processing";
}

/** Present existing intake progress without starting analysis or vendor workflows. */
export function developerProgress(isExisting: boolean, status?: string, vendorCount = 0): DeveloperProgress {
  if (!isExisting) return { currentStep: 0, waiting: false };
  if (status === "waiting_drawings") return { currentStep: 1, waiting: true };
  if (!status || status === "processing" || status === "importing_drawings" || status === "ready_for_analysis") return { currentStep: 1, waiting: false };
  if (status === "import_failed") return { currentStep: 1, waiting: true };
  if (status === "processed") return { currentStep: vendorCount > 0 ? 3 : 2, waiting: false };
  return { currentStep: 1, waiting: false };
}