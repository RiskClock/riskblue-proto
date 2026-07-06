import { useEffect, useState } from "react";
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

interface ClassAliasModalProps {
  open: boolean;
  awpClassName: string;
  currentAlias: string | null;
  onClose: () => void;
  /** Called with the trimmed value (empty string clears the alias). */
  onSave: (alias: string) => Promise<void> | void;
}

/**
 * Per-project display alias for an AWP class. The alias replaces the
 * canonical class name everywhere it is shown in this project (column
 * headers, tooltips, Threat Report). Clearing the field removes the alias.
 */
export function ClassAliasModal({
  open,
  awpClassName,
  currentAlias,
  onClose,
  onSave,
}: ClassAliasModalProps) {
  const [value, setValue] = useState<string>(currentAlias ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValue(currentAlias ?? "");
  }, [open, currentAlias]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(value.trim());
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
            Set a display name shown for{" "}
            <span className="font-medium text-foreground">{awpClassName}</span>{" "}
            in this project only. Leave blank to revert to the default.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="alias-input">Alias</Label>
          <Input
            id="alias-input"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={awpClassName}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
