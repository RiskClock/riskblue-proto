/** A deliberate control pick includes its location without applying siblings. */
export function toggleControlWithParent(
  instanceId: string,
  controlId: string,
  selectedInstanceIds: readonly string[],
  selectedControlIds: ReadonlySet<string>,
  selectInstances: (instanceIds: string[], selected: boolean) => void,
  toggleControl: (controlId: string) => void,
) {
  if (!selectedControlIds.has(controlId) && !selectedInstanceIds.includes(instanceId)) {
    selectInstances([instanceId], true);
  }
  toggleControl(controlId);
}