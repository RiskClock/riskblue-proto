import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ClassAliasModalClass {
  /** Canonical class name (unchanged across projects). */
  name: string;
  /** Canonical short prefix used to generate instance IDs. */
  idPrefix: string | null;
}

export interface ClassAliasEntry {
  alias: string | null;
  aliasPrefix: string | null;
}

interface ClassAliasModalProps {
  open: boolean;
  awpClassName: string;
  currentAlias: string | null;
  currentAliasPrefix: string | null;
  /** All classes visible/known in this project — used for uniqueness checks. */
  allClasses: ClassAliasModalClass[];
  /** Existing alias entries in this project, keyed by canonical class name. */
  existingAliases: Record<string, ClassAliasEntry>;
  onClose: () => void;
  /** Called with trimmed values (empty string clears that field). */
  onSave: (alias: string, aliasPrefix: string) => Promise<void> | void;
}

/**
 * Per-project display alias for an AWP class. The alias replaces the
 * canonical class name (and optionally its short acronym) in headers,
 * tooltips, and the Threat Report. Clearing a field removes that override.
 * Both fields are validated against every other class/alias in the project
 * so an alias never collides with an existing name or prefix.
 */
export function ClassAliasModal({
  open,
  awpClassName,
  currentAlias,
  currentAliasPrefix,
  allClasses,
  existingAliases,
  onClose,
  onSave,
}: ClassAliasModalProps) {
  const [alias, setAlias] = useState<string>(currentAlias ?? "");
  const [aliasPrefix, setAliasPrefix] = useState<string>(currentAliasPrefix ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAlias(currentAlias ?? "");
      setAliasPrefix(currentAliasPrefix ?? "");
    }
  }, [open, currentAlias, currentAliasPrefix]);

  // Collect every taken name and prefix from other classes so we can hard-
  // block duplicates. Case-insensitive comparison; the current class's own
  // values are excluded so re-saving unchanged values doesn't trip the check.
  const { takenNames, takenPrefixes } = useMemo(() => {
    const names = new Map<string, string>();
    const prefixes = new Map<string, string>();
    for (const c of allClasses) {
      if (c.name === awpClassName) continue;
      const entry = existingAliases[c.name];
      const effectiveName = (entry?.alias?.trim() || c.name).toLowerCase();
      names.set(effectiveName, entry?.alias?.trim() || c.name);
      const pref = (entry?.aliasPrefix?.trim() || c.idPrefix || "").toLowerCase();
      if (pref) prefixes.set(pref, entry?.aliasPrefix?.trim() || c.idPrefix || "");
    }
    return { takenNames: names, takenPrefixes: prefixes };
  }, [allClasses, awpClassName, existingAliases]);

  const trimmedAlias = alias.trim();
  const trimmedPrefix = aliasPrefix.trim();

  const aliasConflict = trimmedAlias
    ? takenNames.get(trimmedAlias.toLowerCase())
    : undefined;
  const prefixConflict = trimmedPrefix
    ? takenPrefixes.get(trimmedPrefix.toLowerCase())
    : undefined;

  const blocked = !!aliasConflict || !!prefixConflict;

  const handleSave = async () => {
    if (blocked) return;
    setSaving(true);
    try {
      await onSave(trimmedAlias, trimmedPrefix);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename class in this project</DialogTitle>
          <DialogDescription>
            Set a display name and/or short acronym shown for{" "}
            <span className="font-medium text-foreground">{awpClassName}</span>{" "}
            in this project only. Leave a field blank to revert it to the
            default.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="alias-input">Alias</Label>
            <Input
              id="alias-input"
              autoFocus
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder={awpClassName}
              aria-invalid={!!aliasConflict}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
            {aliasConflict && (
              <p className="text-xs text-destructive">
                "{trimmedAlias}" is already used by another class in this
                project.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alias-prefix-input">Acronym</Label>
            <Input
              id="alias-prefix-input"
              value={aliasPrefix}
              onChange={(e) => setAliasPrefix(e.target.value)}
              placeholder="e.g. CW"
              aria-invalid={!!prefixConflict}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
            {prefixConflict && (
              <p className="text-xs text-destructive">
                Acronym "{trimmedPrefix}" is already used by another class in
                this project.
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Only affects how the class label is shown — existing instance
              IDs keep the original prefix.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || blocked}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
