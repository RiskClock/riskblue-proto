import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, X, ChevronUp, ChevronDown, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";

interface FileLike {
  id: string;
  name: string;
}
interface SheetLike {
  id: string;
  parent_file_id: string;
  page_index: number;
  sheet_number: string | null;
  sheet_title: string | null;
}

interface LevelDraft {
  uid: string; // local key only
  name: string;
  space_index: number | null;
  matched_sources: Array<{ file_name: string; page_number: number }>;
  // any extra fields we preserve verbatim
  extra: Record<string, unknown>;
}

interface NonLevelRecord {
  raw: any; // preserved verbatim
}

const LEVEL_CATEGORY = "Contiguous Storey";

function isLevelCategory(cat: unknown): boolean {
  if (typeof cat !== "string") return true; // missing → treat as level
  const c = cat.toLowerCase();
  return !c || c === "level" || c === "contiguous storey";
}

export function SpatialArchitectModal({
  open,
  onOpenChange,
  requestId,
  payload,
  status,
  error,
  updatedAt,
  running,
  fileGroups,
  onBuild,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  requestId: string | undefined;
  payload: any | null | undefined;
  status: string | null | undefined;
  error: string | null | undefined;
  updatedAt: string | null | undefined;
  running: boolean;
  fileGroups: Array<{ file: FileLike; sheets: SheetLike[] }>;
  onBuild: () => Promise<void> | void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [levels, setLevels] = useState<LevelDraft[]>([]);
  const [nonLevels, setNonLevels] = useState<NonLevelRecord[]>([]);
  const [saving, setSaving] = useState(false);

  // Load editable state from payload whenever it changes / modal opens.
  useEffect(() => {
    if (!open) return;
    const parsed = payload?.parsed;
    const records: any[] = Array.isArray(parsed?.spatial_records)
      ? parsed.spatial_records
      : Array.isArray(parsed?.physical_spaces)
        ? parsed.physical_spaces
        : [];
    const lvl: LevelDraft[] = [];
    const others: NonLevelRecord[] = [];
    let uid = 0;
    for (const r of records) {
      if (isLevelCategory(r?.space_category)) {
        const ms: Array<{ file_name: string; page_number: number }> = [];
        for (const m of Array.isArray(r?.matched_sources) ? r.matched_sources : []) {
          const fn = typeof m?.file_name === "string" ? m.file_name : null;
          const pn = Number(m?.page_number);
          if (fn && Number.isFinite(pn)) ms.push({ file_name: fn, page_number: pn });
        }
        const { standardized_space_name, space_category, space_index, matched_sources, ...extra } =
          r || {};
        lvl.push({
          uid: `lvl-${uid++}`,
          name: typeof standardized_space_name === "string" ? standardized_space_name : "",
          space_index:
            typeof space_index === "number" && Number.isFinite(space_index) ? space_index : null,
          matched_sources: ms,
          extra,
        });
      } else {
        others.push({ raw: r });
      }
    }
    lvl.sort((a, b) => {
      const ai = a.space_index ?? Number.POSITIVE_INFINITY;
      const bi = b.space_index ?? Number.POSITIVE_INFINITY;
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name);
    });
    setLevels(lvl);
    setNonLevels(others);
  }, [open, payload]);

  const allPages = useMemo(() => {
    const out: Array<{
      file_name: string;
      page_number: number;
      label: string;
    }> = [];
    for (const g of fileGroups) {
      for (const sh of g.sheets) {
        out.push({
          file_name: g.file.name,
          page_number: sh.page_index,
          label: `p${sh.page_index}${
            sh.sheet_number ? ` · ${sh.sheet_number}` : ""
          }${sh.sheet_title ? ` · ${sh.sheet_title}` : ""}`,
        });
      }
    }
    return out;
  }, [fileGroups]);

  const updateLevel = (uid: string, patch: Partial<LevelDraft>) => {
    setLevels((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  };

  const move = (uid: string, dir: -1 | 1) => {
    setLevels((prev) => {
      const idx = prev.findIndex((l) => l.uid === uid);
      if (idx < 0) return prev;
      const swap = idx + dir;
      if (swap < 0 || swap >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[swap]] = [next[swap], next[idx]];
      // Re-stamp space_index to match new order, preserving sign for parking.
      return next.map((l, i) => ({ ...l, space_index: i }));
    });
  };

  const remove = (uid: string) => {
    setLevels((prev) => prev.filter((l) => l.uid !== uid));
  };

  const addLevel = () => {
    setLevels((prev) => [
      ...prev,
      {
        uid: `lvl-new-${Date.now()}`,
        name: "",
        space_index: prev.length,
        matched_sources: [],
        extra: {},
      },
    ]);
  };

  const addPage = (
    uid: string,
    page: { file_name: string; page_number: number },
  ) => {
    setLevels((prev) =>
      prev.map((l) => {
        if (l.uid !== uid) return l;
        if (
          l.matched_sources.some(
            (m) => m.file_name === page.file_name && m.page_number === page.page_number,
          )
        )
          return l;
        return {
          ...l,
          matched_sources: [...l.matched_sources, page],
        };
      }),
    );
  };

  const removePage = (uid: string, idx: number) => {
    setLevels((prev) =>
      prev.map((l) =>
        l.uid === uid
          ? { ...l, matched_sources: l.matched_sources.filter((_, i) => i !== idx) }
          : l,
      ),
    );
  };

  const handleSave = async () => {
    if (!requestId) return;
    // Validate: every level needs a name.
    const blanks = levels.filter((l) => !l.name.trim());
    if (blanks.length > 0) {
      toast({
        variant: "destructive",
        title: "Missing level name",
        description: `${blanks.length} level(s) have no name.`,
      });
      return;
    }
    setSaving(true);
    try {
      const editedLevels = levels.map((l) => ({
        ...l.extra,
        standardized_space_name: l.name.trim(),
        space_category: LEVEL_CATEGORY,
        space_index: l.space_index,
        applies_to_levels: [],
        matched_sources: l.matched_sources,
      }));
      const editedOthers = nonLevels.map((n) => n.raw);
      const existing = (payload && typeof payload === "object" ? payload : {}) as any;
      const existingParsed =
        existing.parsed && typeof existing.parsed === "object" ? existing.parsed : {};
      const nextPayload = {
        ...existing,
        parsed: {
          ...existingParsed,
          spatial_records: [...editedLevels, ...editedOthers],
        },
      };
      const { error: upErr } = await supabase
        .from("analysis_requests")
        .update({ space_hierarchy_json: nextPayload } as any)
        .eq("id", requestId);
      if (upErr) throw upErr;
      toast({ title: "Spatial hierarchy saved" });
      onSaved();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Could not save",
        description: getUserFriendlyError(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleBuild = async () => {
    if (levels.length > 0) {
      if (
        !window.confirm(
          "Build Spatial Model will overwrite the existing levels. Continue?",
        )
      ) {
        return;
      }
    }
    await onBuild();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onOpenChange(false)}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Spatial Architect</DialogTitle>
          <DialogDescription>
            Canonical list of physical levels for this project. Connect each
            level to the drawing pages that depict it. Used by the Threat
            Report to group annotations.
          </DialogDescription>
        </DialogHeader>

        {/* Status row */}
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold">Status:</span>
            {running ? (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Running…
              </span>
            ) : status === "failed" ? (
              <span className="text-destructive truncate" title={error ?? undefined}>
                Failed — {error ?? "unknown error"}
              </span>
            ) : status === "complete" ? (
              <span className="text-muted-foreground">
                Complete{updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ""}
              </span>
            ) : (
              <span className="text-muted-foreground">
                Not run yet — click Build Spatial Model to analyze drawings.
              </span>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleBuild}
            disabled={!requestId || running}
          >
            {running ? (
              <>
                <Loader2 className="h-3 w-3 mr-2 animate-spin" /> Building…
              </>
            ) : (
              "Build Spatial Model"
            )}
          </Button>
        </div>

        {/* Levels list */}
        <div className="flex-1 overflow-auto border rounded-md divide-y">
          {levels.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              No levels yet. Click <strong>Build Spatial Model</strong> to
              analyze the drawings, or add a level manually.
            </div>
          ) : (
            levels.map((l, i) => (
              <div key={l.uid} className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={l.name}
                    onChange={(e) => updateLevel(l.uid, { name: e.target.value })}
                    placeholder="Level name (e.g. Level 2, Ground, P1)"
                    className="h-8 text-sm flex-1"
                  />
                  <Input
                    type="number"
                    value={l.space_index ?? ""}
                    onChange={(e) =>
                      updateLevel(l.uid, {
                        space_index: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    placeholder="idx"
                    className="h-8 text-sm w-20"
                    title="Numeric index (P1=-1, Ground=0, L1=1…)"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => move(l.uid, -1)}
                    disabled={i === 0}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => move(l.uid, 1)}
                    disabled={i === levels.length - 1}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    onClick={() => remove(l.uid)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pl-1">
                  {l.matched_sources.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">
                      No drawings assigned
                    </span>
                  )}
                  {l.matched_sources.map((m, idx) => (
                    <Badge
                      key={`${m.file_name}-${m.page_number}-${idx}`}
                      variant="secondary"
                      className="gap-1 font-normal"
                    >
                      <span className="truncate max-w-[280px]">
                        {m.file_name} · p{m.page_number}
                      </span>
                      <button
                        type="button"
                        className="ml-0.5 rounded hover:bg-muted-foreground/20 p-0.5"
                        onClick={() => removePage(l.uid, idx)}
                        aria-label="Remove page"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <AddPagePopover
                    pages={allPages}
                    existing={l.matched_sources}
                    onAdd={(p) => addPage(l.uid, p)}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" size="sm" onClick={addLevel}>
            <Plus className="h-4 w-4 mr-1" /> Add level
          </Button>
          <div className="text-xs text-muted-foreground">
            {levels.length} level{levels.length === 1 ? "" : "s"}
            {nonLevels.length > 0
              ? ` · ${nonLevels.length} unit/template record(s) preserved`
              : ""}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !requestId}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddPagePopover({
  pages,
  existing,
  onAdd,
}: {
  pages: Array<{ file_name: string; page_number: number; label: string }>;
  existing: Array<{ file_name: string; page_number: number }>;
  onAdd: (p: { file_name: string; page_number: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const existingKey = new Set(existing.map((e) => `${e.file_name}::${e.page_number}`));
  const filtered = pages.filter(
    (p) =>
      !existingKey.has(`${p.file_name}::${p.page_number}`) &&
      (q.trim() === "" ||
        p.file_name.toLowerCase().includes(q.toLowerCase()) ||
        p.label.toLowerCase().includes(q.toLowerCase())),
  );
  const byFile = new Map<string, typeof filtered>();
  for (const p of filtered) {
    const arr = byFile.get(p.file_name) || [];
    arr.push(p);
    byFile.set(p.file_name, arr);
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-6 text-xs">
          <Plus className="h-3 w-3 mr-1" /> Add pages
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <div className="p-2 border-b">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search file or page…"
            className="h-8 text-xs"
          />
        </div>
        <div className="max-h-80 overflow-auto">
          {byFile.size === 0 && (
            <div className="p-3 text-xs text-muted-foreground text-center">
              No pages match.
            </div>
          )}
          {Array.from(byFile.entries()).map(([fname, arr]) => (
            <div key={fname} className="py-1">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
                {fname}
              </div>
              {arr.map((p) => (
                <button
                  key={`${p.file_name}-${p.page_number}`}
                  type="button"
                  className="w-full text-left px-3 py-1 text-xs hover:bg-muted truncate"
                  onClick={() => {
                    onAdd({ file_name: p.file_name, page_number: p.page_number });
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
