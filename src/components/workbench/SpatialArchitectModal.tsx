import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, ChevronUp, ChevronDown, Trash2, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function serializeLevels(levels: LevelDraft[]): string {
  return JSON.stringify(
    levels.map((l) => ({
      name: l.name.trim(),
      idx: l.space_index,
      ms: l.matched_sources
        .slice()
        .sort((a, b) =>
          a.file_name.localeCompare(b.file_name) ||
          a.page_number - b.page_number,
        ),
    })),
  );
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
  canBuild = true,
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
  canBuild?: boolean;
}) {
  const { toast } = useToast();
  const [levels, setLevels] = useState<LevelDraft[]>([]);
  const [nonLevels, setNonLevels] = useState<NonLevelRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const initialSerialized = useRef<string>("");

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
    const levelByKey = new Map<string, LevelDraft>();
    let uid = 0;
    for (const r of records) {
      if (isLevelCategory(r?.space_category)) {
        const ms: Array<{ file_name: string; page_number: number }> = [];
        const seenPages = new Set<string>();
        for (const m of Array.isArray(r?.matched_sources) ? r.matched_sources : []) {
          const fn = typeof m?.file_name === "string" ? m.file_name : null;
          const pn = Number(m?.page_number);
          if (!fn || !Number.isFinite(pn)) continue;
          const key = `${fn}\u0000${pn}`;
          if (seenPages.has(key)) continue;
          seenPages.add(key);
          ms.push({ file_name: fn, page_number: pn });
        }
        const { standardized_space_name, space_category, space_index, matched_sources, ...extra } =
          r || {};
        const name = typeof standardized_space_name === "string" ? standardized_space_name : "";
        const mergeKey = name.trim().toLowerCase();
        const existing = mergeKey ? levelByKey.get(mergeKey) : undefined;
        if (existing) {
          // Merge matched_sources into the existing level (dedup).
          const existingKeys = new Set(
            existing.matched_sources.map((m) => `${m.file_name}\u0000${m.page_number}`),
          );
          for (const m of ms) {
            const k = `${m.file_name}\u0000${m.page_number}`;
            if (!existingKeys.has(k)) {
              existing.matched_sources.push(m);
              existingKeys.add(k);
            }
          }
          if (existing.space_index === null && typeof space_index === "number") {
            existing.space_index = space_index;
          }
        } else {
          const draft: LevelDraft = {
            uid: `lvl-${uid++}`,
            name,
            space_index:
              typeof space_index === "number" && Number.isFinite(space_index) ? space_index : null,
            matched_sources: ms,
            extra,
          };
          lvl.push(draft);
          if (mergeKey) levelByKey.set(mergeKey, draft);
        }
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
    initialSerialized.current = serializeLevels(lvl);
  }, [open, payload]);

  const isDirty = useMemo(
    () => serializeLevels(levels) !== initialSerialized.current,
    [levels],
  );

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

  const duplicate = (uid: string) => {
    setLevels((prev) => {
      const idx = prev.findIndex((l) => l.uid === uid);
      if (idx < 0) return prev;
      const src = prev[idx];
      const copy: LevelDraft = {
        ...src,
        uid: `lvl-dup-${Date.now()}`,
        matched_sources: src.matched_sources.map((m) => ({ ...m })),
        extra: { ...src.extra },
      };
      const next = prev.slice();
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  // When set, the effect below scrolls that row into view and focuses its
  // Level Name input on the next render. Cleared after use.
  const pendingFocusUidRef = useRef<string | null>(null);

  const addLevel = () => {
    const uid = `lvl-new-${Date.now()}`;
    setLevels((prev) => {
      const maxIdx = prev.reduce(
        (acc, l) => (typeof l.space_index === "number" && l.space_index > acc ? l.space_index : acc),
        Number.NEGATIVE_INFINITY,
      );
      const nextIdx = Number.isFinite(maxIdx) ? (maxIdx as number) + 1 : 0;
      return [
        ...prev,
        {
          uid,
          name: "",
          space_index: nextIdx,
          matched_sources: [],
          extra: {},
        },
      ];
    });
    pendingFocusUidRef.current = uid;
  };

  // After a new level is appended, scroll it into view and focus its name input.
  useEffect(() => {
    const uid = pendingFocusUidRef.current;
    if (!uid) return;
    if (!levels.some((l) => l.uid === uid)) return;
    pendingFocusUidRef.current = null;
    // Wait a frame so the row is in the DOM.
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(
        `[data-level-uid="${uid}"]`,
      );
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = row.querySelector<HTMLInputElement>('input[data-level-name-input="1"]');
      input?.focus();
    });
  }, [levels]);


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

  const confirmDiscardIfDirty = (): boolean => {
    if (!isDirty) return true;
    return window.confirm(
      "You have unsaved changes. Discard them and close this window?",
    );
  };

  const handleClose = () => {
    if (saving) return;
    if (!confirmDiscardIfDirty()) return;
    onOpenChange(false);
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
      initialSerialized.current = serializeLevels(levels);
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
          "Build Spatial Model will replace the current list of levels with a fresh analysis of the drawings. Any edits you've made (names, ordering, drawing assignments) will be overwritten. Continue?",
        )
      ) {
        return;
      }
    }
    await onBuild();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) return;
        handleClose();
      }}
    >
      <DialogContent
        className="max-w-4xl max-h-[85vh] flex flex-col"
        onEscapeKeyDown={(e) => {
          if (isDirty && !confirmDiscardIfDirty()) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (isDirty && !confirmDiscardIfDirty()) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (isDirty && !confirmDiscardIfDirty()) e.preventDefault();
        }}
      >
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
                Failed - {error ?? "unknown error"} (previous results preserved)
              </span>
            ) : status === "complete" ? (
              <span className="text-muted-foreground">
                Complete{updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ""}
              </span>
            ) : (
              <span className="text-muted-foreground">
                Not run yet - click Build Spatial Model to analyze drawings.
              </span>
            )}
          </div>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={handleBuild}
                    disabled={!requestId || running || !canBuild}
                    className={(!requestId || running || !canBuild) ? "pointer-events-none" : ""}
                  >
                    {running ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-2 animate-spin" /> Building…
                      </>
                    ) : (
                      "Build Spatial Model"
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {!canBuild ? "No permission" : running ? "Building…" : "Analyze drawings to build the spatial model"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Levels list */}
        <div className="flex-1 min-h-0 flex flex-col border rounded-md overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[minmax(0,1fr)_70px_minmax(0,1.6fr)_128px] items-center gap-2 px-3 py-2 bg-muted/40 border-b text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <div>Level name</div>
            <div className="text-center">Index</div>
            <div>Drawings</div>
            <div className="text-right">Actions</div>
          </div>

          <div className="flex-1 overflow-auto divide-y">
            {levels.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">
                No levels yet. Click <strong>Build Spatial Model</strong> to
                analyze the drawings, or add a level manually.
              </div>
            ) : (
              levels.map((l, i) => (
                <div
                  key={l.uid}
                  data-level-uid={l.uid}
                  className="grid grid-cols-[minmax(0,1fr)_70px_minmax(0,1.6fr)_128px] items-start gap-2 px-3 py-2"
                >
                  <Input
                    value={l.name}
                    onChange={(e) => updateLevel(l.uid, { name: e.target.value })}
                    placeholder="e.g. Level 2, Ground, P1"
                    className="h-8 text-sm"
                    data-level-name-input="1"
                  />

                  <Input
                    type="number"
                    value={l.space_index ?? ""}
                    onChange={(e) =>
                      updateLevel(l.uid, {
                        space_index: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="h-8 text-sm text-center"
                    title="Numeric index (P1=-1, Ground=0, L1=1…)"
                  />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                    {l.matched_sources.length === 0 && (
                      <span className="text-xs text-muted-foreground italic">
                        None
                      </span>
                    )}
                    {(() => {
                      const byFile = new Map<string, number[]>();
                      for (const m of l.matched_sources) {
                        const arr = byFile.get(m.file_name) || [];
                        arr.push(m.page_number);
                        byFile.set(m.file_name, arr);
                      }
                      return Array.from(byFile.entries()).map(([fileName, pages]) => (
                        <div
                          key={fileName}
                          className="flex items-center gap-1.5 min-w-0 max-w-full text-xs"
                        >
                          <span className="font-medium truncate min-w-0" title={fileName}>
                            {fileName}
                          </span>
                          <span className="text-muted-foreground shrink-0">
                            {pages
                              .slice()
                              .sort((a, b) => a - b)
                              .map((p) => `p${p}`)
                              .join(", ")}
                          </span>
                        </div>
                      ));
                    })()}
                    <AddPagePopover
                      pages={allPages}
                      existing={l.matched_sources}
                      onAdd={(p) => addPage(l.uid, p)}
                      onRemove={(p) => {
                        const idx = l.matched_sources.findIndex(
                          (m) => m.file_name === p.file_name && m.page_number === p.page_number,
                        );
                        if (idx >= 0) removePage(l.uid, idx);
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-end gap-0.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => move(l.uid, -1)}
                      disabled={i === 0}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => move(l.uid, 1)}
                      disabled={i === levels.length - 1}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => duplicate(l.uid)}
                      title="Duplicate level"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={() => remove(l.uid)}
                      title="Delete level"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
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
            {isDirty ? " · unsaved changes" : ""}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !requestId || !isDirty}>
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
  onRemove,
}: {
  pages: Array<{ file_name: string; page_number: number; label: string }>;
  existing: Array<{ file_name: string; page_number: number }>;
  onAdd: (p: { file_name: string; page_number: number }) => void;
  onRemove: (p: { file_name: string; page_number: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const existingKey = new Set(existing.map((e) => `${e.file_name}::${e.page_number}`));
  const filtered = pages.filter(
    (p) =>
      q.trim() === "" ||
      p.file_name.toLowerCase().includes(q.toLowerCase()) ||
      p.label.toLowerCase().includes(q.toLowerCase()),
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
          <Plus className="h-3 w-3 mr-1" /> Manage Pages
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0 flex flex-col max-h-[24rem]" align="start">
        <div className="p-2 border-b shrink-0">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search file or page…"
            className="h-8 text-xs"
          />
        </div>
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
          onWheel={(e) => e.stopPropagation()}
        >
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
              {arr.map((p) => {
                const isSelected = existingKey.has(`${p.file_name}::${p.page_number}`);
                return (
                  <button
                    key={`${p.file_name}-${p.page_number}`}
                    type="button"
                    className="w-full text-left px-3 py-1 text-xs hover:bg-muted flex items-center gap-2"
                    onClick={() => {
                      if (isSelected) {
                        onRemove({ file_name: p.file_name, page_number: p.page_number });
                      } else {
                        onAdd({ file_name: p.file_name, page_number: p.page_number });
                      }
                    }}
                  >
                    <span
                      className={`inline-flex items-center justify-center h-4 w-4 shrink-0 rounded border ${
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-input bg-background"
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{p.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
