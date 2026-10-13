export function isDeveloperTestProject(projectData: unknown, accountType: unknown): boolean {
  return accountType === "developer" || (
    typeof projectData === "object" && projectData !== null &&
    "intake_type" in projectData && projectData.intake_type === "developer"
  );
}