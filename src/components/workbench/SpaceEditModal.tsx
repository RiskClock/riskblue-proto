import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Check, Plus, X, Loader2, Eye } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SpaceEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  pageNumber: number;
  currentSpaces: string[];
  allSpaces: string[];
  onSave: (spaces: string[]) => Promise<void>;
  promptText?: string | null;
  basePrompt?: string | null;
}

export function SpaceEditModal({
  isOpen,
  onClose,
  fileName,
  pageNumber,
  currentSpaces,
  allSpaces,
  onSave,
}: SpaceEditModalProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelected([...currentSpaces]);
      setNewName("");
      setSearch("");
    }
  }, [isOpen, currentSpaces]);

  const options = useMemo(() => {
    const set = new Set<string>([...allSpaces, ...selected]);
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
  }, [allSpaces, selected]);

  const filtered = useMemo(
    () => options.filter((o) => o.toLowerCase().includes(search.toLowerCase())),
    [options, search],
  );

  const toggle = (name: string) => {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  const addNew = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (!selected.includes(trimmed)) setSelected((prev) => [...prev, trimmed]);
    setNewName("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(selected);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Spaces</DialogTitle>
          <DialogDescription className="truncate">
            {fileName} · Page {pageNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((s) => (
                <Badge
                  key={s}
                  variant="outline"
                  className="bg-sky-500/10 text-sky-700 border-sky-500/30 gap-1"
                >
                  {s}
                  <button
                    onClick={() => toggle(s)}
                    className="hover:text-destructive"
                    aria-label={`Remove ${s}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <Input
            placeholder="Search identified spaces..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
          />

          <ScrollArea className="h-56 border rounded-md">
            <div className="p-1">
              {filtered.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground text-center">
                  No matches.
                </div>
              ) : (
                filtered.map((opt) => {
                  const active = selected.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => toggle(opt)}
                      className={`w-full flex items-center justify-between text-left text-sm px-2 py-1.5 rounded hover:bg-muted ${
                        active ? "bg-muted/60" : ""
                      }`}
                    >
                      <span className="truncate">{opt}</span>
                      {active && <Check className="h-3.5 w-3.5 text-sky-600 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>

          <div className="flex gap-2">
            <Input
              placeholder="Create new space name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addNew();
                }
              }}
              className="h-8 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={addNew}
              disabled={!newName.trim()}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
