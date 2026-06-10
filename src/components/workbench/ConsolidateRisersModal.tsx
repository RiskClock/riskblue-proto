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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// One persisted consolidation group.
interface ConsolidationGroup {
  id?: string;
  label: string;
  member_annotation_ids: string[];
}

interface AnnotationRow {
  id: string;
  awp_class_name: string;
  instance_number: number | null;
  file_id: string;
  page_index: number;
  nx: number;
  ny: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  requestId: string | undefined;
  // Class names that are flagged "Can Span Multiple Spaces" AND have annotations.
  spannableClasses: { name: string; idPrefix: string | null }[];
  fileNameById: Map<string, string>;
  pageSpaceMap: Map<string, string[]>; // "fileName::page" -> spaces
  onSaved: () => void;
}

export function ConsolidateRisersModal({
  open,
  onOpenChange,
  requestId,
  spannableClasses,
  fileNameById,
  pageSpaceMap,
  onSaved,
}: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [annotations, setAnnotations] = useState<AnnotationRow[]>([]);
  // class -> groups
  const [groupsByClass, setGroupsByClass] = useState<
    Record<string, ConsolidationGroup[]>
  >({});
  const [activeClass, setActiveClass] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !requestId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const classNames = spannableClasses.map((c) => c.name);
      const [annRes, consRes] = await Promise.all([
        supabase
          .from("drawing_instances" as any)
          .select("id, awp_class_name, instance_number, file_id, page_index, nx, ny")
          .eq("analysis_request_id", requestId)
          .in("awp_class_name", classNames),
        supabase
          .from("annotation_consolidations" as any)
          .select("id, awp_class_name, label, member_annotation_ids")
          .eq("analysis_request_id", requestId),
      ]);
      if (cancelled) return;
      const rows = (annRes.data as any[] | null) || [];
      setAnnotations(rows as AnnotationRow[]);

      // Build groups from DB; auto-suggest groups for classes without any.
      const existing: Record<string, ConsolidationGroup[]> = {};
      for (const r of (consRes.data as any[] | null) || []) {
        const list = existing[r.awp_class_name] || [];
        list.push({
          id: r.id,
          label: r.label,
          member_annotation_ids: (r.member_annotation_ids as string[]) || [],
        });
        existing[r.awp_class_name] = list;
      }
      // Auto-suggest groupings for classes with no saved groups: cluster by
      // proximity of (nx, ny) across pages — annotations within 0.05 normalized
      // distance go into the same group.
      for (const c of spannableClasses) {
        if (existing[c.name]?.length) continue;
        const classRows = rows.filter((r: AnnotationRow) => r.awp_class_name === c.name);
        const suggested = clusterByProximity(classRows);
        existing[c.name] = suggested.map((memberIds, i) => ({
          label: `${c.idPrefix || c.name.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, "0")}`,
          member_annotation_ids: memberIds,
        }));
      }
      setGroupsByClass(existing);
      setActiveClass(spannableClasses[0]?.name || null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, requestId, spannableClasses]);

  const annById = useMemo(() => {
    const m = new Map<string, AnnotationRow>();
    for (const a of annotations) m.set(a.id, a);
    return m;
  }, [annotations]);

  const classAnnotations = (className: string) =>
    annotations.filter((a) => a.awp_class_name === className);

  const updateGroups = (className: string, fn: (g: ConsolidationGroup[]) => ConsolidationGroup[]) => {
    setGroupsByClass((prev) => ({ ...prev, [className]: fn(prev[className] || []) }));
  };

  const renameGroup = (className: string, idx: number, label: string) => {
    updateGroups(className, (g) => g.map((x, i) => (i === idx ? { ...x, label } : x)));
  };

  const toggleMember = (className: string, idx: number, annId: string) => {
    updateGroups(className, (g) =>
      g.map((x, i) => {
        if (i !== idx) {
          // Remove from any other group to keep membership exclusive.
          return { ...x, member_annotation_ids: x.member_annotation_ids.filter((m) => m !== annId) };
        }
        const has = x.member_annotation_ids.includes(annId);
        return {
          ...x,
          member_annotation_ids: has
            ? x.member_annotation_ids.filter((m) => m !== annId)
            : [...x.member_annotation_ids, annId],
        };
      }),
    );
  };

  const addGroup = (className: string, prefix: string | null) => {
    updateGroups(className, (g) => [
      ...g,
      {
        label: `${prefix || className.slice(0, 3).toUpperCase()}-${String(g.length + 1).padStart(3, "0")}`,
        member_annotation_ids: [],
      },
    ]);
  };

  const removeGroup = (className: string, idx: number) => {
    updateGroups(className, (g) => g.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!requestId) return;
    setSaving(true);
    try {
      // Delete all existing groups for these classes, then insert fresh.
      const classNames = spannableClasses.map((c) => c.name);
      await supabase
        .from("annotation_consolidations" as any)
        .delete()
        .eq("analysis_request_id", requestId)
        .in("awp_class_name", classNames);

      const rows: any[] = [];
      for (const [className, groups] of Object.entries(groupsByClass)) {
        groups.forEach((g, i) => {
          if (g.member_annotation_ids.length === 0) return;
          rows.push({
            analysis_request_id: requestId,
            awp_class_name: className,
            label: g.label || `${className}-${i + 1}`,
            instance_number: i + 1,
            member_annotation_ids: g.member_annotation_ids,
          });
        });
      }
      if (rows.length) {
        const { error } = await supabase.from("annotation_consolidations" as any).insert(rows);
        if (error) throw error;
      }
      toast({ title: "Consolidation saved", description: `${rows.length} group${rows.length === 1 ? "" : "s"} saved.` });
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Could not save consolidation", description: (e as any)?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const memberToGroup = useMemo(() => {
    const m = new Map<string, number>();
    if (!activeClass) return m;
    (groupsByClass[activeClass] || []).forEach((g, i) => {
      for (const id of g.member_annotation_ids) m.set(id, i);
    });
    return m;
  }, [groupsByClass, activeClass]);

  const activeAnn = activeClass ? classAnnotations(activeClass) : [];
  const activeGroups = activeClass ? groupsByClass[activeClass] || [] : [];
  const activePrefix = spannableClasses.find((c) => c.name === activeClass)?.idPrefix ?? null;

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Consolidate multi-space annotations</DialogTitle>
          <DialogDescription>
            For classes that can span multiple spaces (e.g. risers), group the annotations on different pages
            that represent the same physical instance. Each group becomes one row in the instances report,
            spanning every space its members are placed in.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : spannableClasses.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No annotations in this project belong to a class that can span multiple spaces.
          </div>
        ) : (
          <div className="grid grid-cols-[180px_1fr] gap-4 max-h-[60vh]">
            <div className="border rounded-md overflow-auto">
              {spannableClasses.map((c) => {
                const groupCount = (groupsByClass[c.name] || []).length;
                const annCount = classAnnotations(c.name).length;
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => setActiveClass(c.name)}
                    className={`w-full text-left px-3 py-2 text-sm border-b hover:bg-muted/40 ${
                      activeClass === c.name ? "bg-muted font-medium" : ""
                    }`}
                  >
                    <div>{c.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {annCount} annotation{annCount === 1 ? "" : "s"} · {groupCount} group{groupCount === 1 ? "" : "s"}
                    </div>
                  </button>
                );
              })}
            </div>

            <ScrollArea className="border rounded-md p-3">
              {activeClass ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{activeClass}</div>
                    <Button size="sm" variant="outline" onClick={() => addGroup(activeClass!, activePrefix)}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" /> Add group
                    </Button>
                  </div>

                  {activeGroups.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No groups yet. Click "Add group" to start.</div>
                  ) : (
                    activeGroups.map((g, gIdx) => {
                      const spaces = new Set<string>();
                      for (const mid of g.member_annotation_ids) {
                        const a = annById.get(mid);
                        if (!a) continue;
                        const fname = fileNameById.get(a.file_id) || "";
                        const sps = pageSpaceMap.get(`${fname}::${a.page_index}`) || [];
                        for (const s of sps) spaces.add(s);
                      }
                      return (
                        <div key={gIdx} className="border rounded-md p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <Input
                              value={g.label}
                              onChange={(e) => renameGroup(activeClass!, gIdx, e.target.value)}
                              className="h-8 max-w-[260px]"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground"
                              onClick={() => removeGroup(activeClass!, gIdx)}
                              aria-label="Remove group"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            {spaces.size > 0 && (
                              <div className="flex flex-wrap gap-1 ml-2">
                                {Array.from(spaces).map((s) => (
                                  <Badge key={s} variant="outline" className="text-[10px]">
                                    {s}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}

                  <div className="pt-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      Annotations in {activeClass}
                    </div>
                    <div className="text-[11px] text-muted-foreground mb-2">
                      Assign each annotation to one of the groups above (or leave unassigned to keep it as a
                      single-space instance).
                    </div>
                    <div className="space-y-1">
                      {activeAnn.map((a) => {
                        const groupIdx = memberToGroup.get(a.id);
                        const fname = fileNameById.get(a.file_id) || "";
                        const spaces = pageSpaceMap.get(`${fname}::${a.page_index}`) || [];
                        return (
                          <div
                            key={a.id}
                            className="flex items-center gap-2 text-xs py-1 border-b last:border-b-0"
                          >
                            <span className="font-mono w-16 shrink-0">
                              {activePrefix || a.awp_class_name.slice(0, 3).toUpperCase()}
                              {String(a.instance_number ?? 0).padStart(3, "0")}
                            </span>
                            <span className="text-muted-foreground truncate flex-1">
                              {fname} · Page {a.page_index}
                              {spaces.length ? ` · ${spaces.join(", ")}` : ""}
                            </span>
                            {activeGroups.map((g, gIdx) => (
                              <label key={gIdx} className="flex items-center gap-1 cursor-pointer">
                                <Checkbox
                                  checked={groupIdx === gIdx}
                                  onCheckedChange={() => toggleMember(activeClass!, gIdx, a.id)}
                                />
                                <span className="text-[11px]">{g.label}</span>
                              </label>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Select a class to begin.</div>
              )}
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save consolidation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Naive proximity clustering: group annotations whose (nx, ny) are within 0.05.
// Returns arrays of annotation ids (one per cluster).
function clusterByProximity(rows: AnnotationRow[]): string[][] {
  const THRESH = 0.05;
  const clusters: { cx: number; cy: number; ids: string[] }[] = [];
  for (const r of rows) {
    let assigned = false;
    for (const c of clusters) {
      if (Math.abs(c.cx - r.nx) <= THRESH && Math.abs(c.cy - r.ny) <= THRESH) {
        c.ids.push(r.id);
        // Update centroid
        c.cx = (c.cx * (c.ids.length - 1) + r.nx) / c.ids.length;
        c.cy = (c.cy * (c.ids.length - 1) + r.ny) / c.ids.length;
        assigned = true;
        break;
      }
    }
    if (!assigned) clusters.push({ cx: r.nx, cy: r.ny, ids: [r.id] });
  }
  return clusters.map((c) => c.ids);
}
