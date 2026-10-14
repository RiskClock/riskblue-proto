export type DeveloperProgress = { currentStep: number; waiting: boolean };

/** Present existing intake progress without starting analysis or vendor workflows. */
export function developerProgress(isExisting: boolean, status?: string, vendorCount = 0): DeveloperProgress {
  if (!isExisting) return { currentStep: 0, waiting: false };
  if (status === "waiting_drawings") return { currentStep: 1, waiting: true };
  if (!status || status === "processing") return { currentStep: 1, waiting: false };
  if (status === "processed") return { currentStep: vendorCount > 0 ? 3 : 2, waiting: false };
  return { currentStep: 1, waiting: false };
}