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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { normalizeFunctionError } from "@/lib/functionsError";
import { getUserFriendlyError } from "@/lib/errorHandling";
import {
  acquireAgentLock,
  releaseAgentLock,
  startAgentHeartbeat,
} from "@/lib/agentLock";
import { parseSurveyFloorPlans, type ParsedFloorPlan } from "@/lib/surveyFloorPlans";

export interface ScoutFileInput {
  id: string;
  name: string;
  pages: Array<{ page_index: number; sheet_number: string | null }>;
}

interface ScoutRunModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string | null;
  projectId: string | null;
  files: ScoutFileInput[];
  /** Called after results are applied (or discarded) so the page can refetch. */
  onApplied: () => void;
}

type Stage = "select" | "running" | "review";

const keyOf = (fileId: string, page: number) => `${fileId}::${page}`;

/** Flatten a raw Scout response into page-level objects keyed by page number. */
function flattenRawPages(raw: string | null | undefined): Map<number, any> {
  const out = new Map<number, any>();
  if (!raw || raw.startsWith("ERROR:")) return out;
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    const s = raw.indexOf("[");
    const e = raw.lastIndexOf("]");
    if (s >= 0 && e > s) {
      try {
        parsed = JSON.parse(raw.slice(s, e + 1));
      } catch {
        return out;
      }
    }
  }
  const items: any[] = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const push = (item: any) => {
    const page = Number(item?.page_number ?? item?.page ?? item?.pageNumber);
    if (!Number.isFinite(page)) return;
    out.set(page, item);
  };
  for (const item of items) {
    if (Array.isArray(item?.surveyed_pages)) {
      for (const p of item.surveyed_pages) push(p);
    } else {
      push(item);
    }
  }
  return out;
}

/** Stable plan id, matching parseSurveyFloorPlans' fallback scheme. */
const planIdAt = (fp: any, page: number, index: number) =>
  typeof fp?.plan_id === "string" && fp.plan_id ? fp.plan_id : `fp_p${page}_${index + 1}`;

const planLabel = (p: ParsedFloorPlan) => {
  const t = String(p.type ?? "unknown").replace(/_/g, " ");
  const ref = p.reference_id ? ` · ${p.reference_id}` : "";
  const floors = p.floors.length > 0 ? ` · ${p.floors.join(", ")}` : "";
  return `${t}${ref}${floors}`;
};

export const ScoutRunModal = ({
  open,
  onOpenChange,
  requestId,
  projectId,
  files,
  onApplied,
}: ScoutRunModalProps) => {
  const [stage, setStage] = useState<Stage>("select");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [applying, setApplying] = useState(false);
  /** Previous raw response per file, captured before the run. */
  const [snapshots, setSnapshots] = useState<Map<string, string | null>>(new Map());
  /** New raw response per file returned by the run. */
  const [freshRaw, setFreshRaw] = useState<Map<string, string>>(new Map());
  /** Pages kept in the review stage. */
  const [keptPages, setKeptPages] = useState<Set<string>>(new Set());
  /** Individual detections kept, key = `${fileId}::${page}::${planId}`. */
  const [keptPlans, setKeptPlans] = useState<Set<string>>(new Set());

  // Reset whenever the dialog opens fresh.
  useEffect(() => {
    if (!open) return;
    setStage("select");
    setSelected(new Set(files.flatMap((f) => f.pages.map((p) => keyOf(f.id, p.page_index)))));
    setExpanded(new Set(files.map((f) => f.id)));
    setProgress(null);
    setSnapshots(new Map());
    setFreshRaw(new Map());
    setKeptPages(new Set());
    setKeptPlans(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const totalSelected = selected.size;

  const toggleFile = (f: ScoutFileInput, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of f.pages) {
        const k = keyOf(f.id, p.page_index);
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };

  const togglePage = (fileId: string, page: number, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = keyOf(fileId, page);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });
  };

  const toggleExpanded = (fileId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });

  // ---- Run -----------------------------------------------------------------
  const runSurvey = async () => {
    if (!requestId || !projectId || totalSelected === 0) return;
    const targets = files
      .map((f) => ({
        file: f,
        pages: f.pages
          .map((p) => p.page_index)
          .filter((p) => selected.has(keyOf(f.id, p)))
          .sort((a, b) => a - b),
      }))
      .filter((t) => t.pages.length > 0);
    if (targets.length === 0) return;

    const lock = await acquireAgentLock(projectId, "Scout", requestId);
    if (!lock.ok) {
      toast({
        variant: "destructive",
        title: lock.busy ? "Another agent is running" : "Scout unavailable",
        description: lock.message,
      });
      return;
    }
    const stopHeartbeat = startAgentHeartbeat(lock.runId);
    setStage("running");
    const snaps = new Map<string, string | null>();
    const fresh = new Map<string, string>();

    try {
      for (let i = 0; i < targets.length; i++) {
        const { file, pages } = targets[i];
        setProgress({ current: i + 1, total: targets.length, fileName: file.name });

        const { data: baseline } = await supabase
          .from("analysis_request_files")
          .select("survey_raw_response, survey_raw_updated_at")
          .eq("id", file.id)
          .maybeSingle();
        snaps.set(file.id, (baseline as any)?.survey_raw_response ?? null);
        const baselineUpdatedAt = (baseline as any)?.survey_raw_updated_at ?? null;

        const { data, error } = await supabase.functions.invoke("survey-pages", {
          body: { analysisRequestId: requestId, fileId: file.id, pageNumbers: pages },
        });
        if (error) throw await normalizeFunctionError(error);
        if ((data as any)?.error) throw new Error((data as any).error);

        let finalRaw = "";
        for (let attempts = 0; attempts < 240; attempts++) {
          await new Promise((r) => setTimeout(r, 2000));
          const { data: poll } = await supabase
            .from("analysis_request_files")
            .select("survey_raw_response, survey_raw_updated_at")
            .eq("id", file.id)
            .maybeSingle();
          const updatedAt = (poll as any)?.survey_raw_updated_at ?? null;
          if (updatedAt && updatedAt !== baselineUpdatedAt) {
            finalRaw = (poll as any)?.survey_raw_response ?? "";
            if (finalRaw.startsWith("ERROR: ")) throw new Error(finalRaw.slice(7));
            break;
          }
        }
        if (!finalRaw) throw new Error(`Timed out waiting for Scout on ${file.name}.`);
        fresh.set(file.id, finalRaw);
      }

      // Seed the review selections: everything detected is kept by default.
      const pagesKept = new Set<string>();
      const plansKept = new Set<string>();
      for (const [fileId, raw] of fresh.entries()) {
        const byPage = parseSurveyFloorPlans(raw);
        for (const [page, plans] of byPage.entries()) {
          pagesKept.add(keyOf(fileId, page));
          for (const p of plans) plansKept.add(`${fileId}::${page}::${p.plan_id}`);
        }
      }
      // Pages that were surveyed but returned nothing still count as reviewed.
      for (const t of targets) {
        for (const p of t.pages) pagesKept.add(keyOf(t.file.id, p));
      }
      setSnapshots(snaps);
      setFreshRaw(fresh);
      setKeptPages(pagesKept);
      setKeptPlans(plansKept);
      setStage("review");
      await releaseAgentLock(lock.runId, "completed");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await releaseAgentLock(lock.runId, "failed", message);
      // Roll back anything already overwritten so nothing is lost.
      for (const [fileId, prev] of snaps.entries()) {
        await supabase
          .from("analysis_request_files")
          .update({ survey_raw_response: prev } as any)
          .eq("id", fileId);
      }
      toast({ variant: "destructive", title: "Scout failed", description: message });
      setStage("select");
    } finally {
      stopHeartbeat();
      setProgress(null);
    }
  };

  // ---- Review data ---------------------------------------------------------
  const reviewByFile = useMemo(() => {
    const out: Array<{
      file: ScoutFileInput;
      pages: Array<{ page: number; plans: ParsedFloorPlan[] }>;
    }> = [];
    for (const f of files) {
      const raw = freshRaw.get(f.id);
      if (raw === undefined) continue;
      const byPage = parseSurveyFloorPlans(raw);
      const pages = f.pages
        .map((p) => p.page_index)
        .filter((p) => selected.has(keyOf(f.id, p)))
        .sort((a, b) => a - b)
        .map((page) => ({ page, plans: byPage.get(page) ?? [] }));
      out.push({ file: f, pages });
    }
    return out;
  }, [files, freshRaw, selected]);

  const keptPlanCount = keptPlans.size;

  // ---- Apply / discard -----------------------------------------------------
  /** Restore every snapshot, dropping the fresh run entirely. */
  const discard = async () => {
    setApplying(true);
    try {
      for (const [fileId, prev] of snapshots.entries()) {
        const { error } = await supabase
          .from("analysis_request_files")
          .update({ survey_raw_response: prev } as any)
          .eq("id", fileId);
        if (error) throw error;
      }
      toast({ title: "Scout results discarded" });
      onApplied();
      onOpenChange(false);
    } catch (e) {
      toast({ variant: "destructive", title: "Could not discard", description: getUserFriendlyError(e) });
    } finally {
      setApplying(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    try {
      for (const [fileId, raw] of freshRaw.entries()) {
        const oldPages = flattenRawPages(snapshots.get(fileId) ?? null);
        const newPages = flattenRawPages(raw);
        const merged = new Map<number, any>(oldPages);

        for (const [page, item] of newPages.entries()) {
          if (!keptPages.has(keyOf(fileId, page))) continue; // keep the old page
          const plans = Array.isArray(item?.floor_plans) ? item.floor_plans : [];
          const filtered = plans.filter((fp: any, i: number) =>
            keptPlans.has(`${fileId}::${page}::${planIdAt(fp, page, i)}`),
          );
          merged.set(page, { ...item, floor_plans: filtered });
        }

        const mergedArray = Array.from(merged.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, item]) => item);
        const { error } = await supabase
          .from("analysis_request_files")
          .update({ survey_raw_response: JSON.stringify(mergedArray, null, 2) } as any)
          .eq("id", fileId);
        if (error) throw error;
      }
      toast({
        title: "Scout results applied",
        description: `${keptPlanCount} detection${keptPlanCount === 1 ? "" : "s"} written to the drawings.`,
      });
      onApplied();
      onOpenChange(false);
    } catch (e) {
      toast({ variant: "destructive", title: "Could not apply results", description: getUserFriendlyError(e) });
    } finally {
      setApplying(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && stage === "running") return; // don't abandon a live run
    if (!next && stage === "review") {
      void discard();
      return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {stage === "review" ? "Review Scout results" : "Scout Agent"}
          </DialogTitle>
          <DialogDescription>
            {stage === "select"
              ? "Choose the files and pages for Scout Agent to survey."
              : stage === "running"
                ? "Scout is surveying the selected pages."
                : "Uncheck any detection you do not want. Applying overwrites the bounding boxes on the checked pages."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-2 px-2">
          {stage === "running" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              {progress
                ? `Surveying ${progress.fileName} (${progress.current} of ${progress.total})…`
                : "Starting…"}
            </div>
          )}

          {stage === "select" && (
            <div className="space-y-3">
              {files.map((f) => {
                const all = f.pages.every((p) => selected.has(keyOf(f.id, p.page_index)));
                const some = f.pages.some((p) => selected.has(keyOf(f.id, p.page_index)));
                const isOpen = expanded.has(f.id);
                return (
                  <div key={f.id} className="rounded-md border">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <Checkbox
                        checked={all ? true : some ? "indeterminate" : false}
                        onCheckedChange={(v) => toggleFile(f, v === true || v === "indeterminate")}
                      />
                      <button
                        type="button"
                        className="flex items-center gap-1 text-sm font-medium min-w-0"
                        onClick={() => toggleExpanded(f.id)}
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0" />
                        )}
                        <span className="truncate">{f.name}</span>
                      </button>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {f.pages.length} page{f.pages.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {isOpen && (
                      <div className="border-t px-3 py-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                        {f.pages.map((p) => (
                          <label
                            key={p.page_index}
                            className="flex items-center gap-2 text-sm cursor-pointer min-w-0"
                          >
                            <Checkbox
                              checked={selected.has(keyOf(f.id, p.page_index))}
                              onCheckedChange={(v) => togglePage(f.id, p.page_index, v === true)}
                            />
                            <span className="truncate">
                              Page {p.page_index}
                              {p.sheet_number ? ` · ${p.sheet_number}` : ""}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {files.length === 0 && (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  This project has no source PDFs.
                </p>
              )}
            </div>
          )}

          {stage === "review" && (
            <div className="space-y-3">
              {reviewByFile.map(({ file, pages }) => (
                <div key={file.id} className="rounded-md border">
                  <div className="px-3 py-2 text-sm font-medium border-b truncate">{file.name}</div>
                  <div className="divide-y">
                    {pages.map(({ page, plans }) => {
                      const pk = keyOf(file.id, page);
                      const pageKept = keptPages.has(pk);
                      return (
                        <div key={page} className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={pageKept}
                              onCheckedChange={(v) =>
                                setKeptPages((prev) => {
                                  const next = new Set(prev);
                                  if (v === true) next.add(pk);
                                  else next.delete(pk);
                                  return next;
                                })
                              }
                            />
                            <span className="text-sm">Page {page}</span>
                            <Badge variant={plans.length > 0 ? "secondary" : "outline"} className="ml-1">
                              {plans.length} detected
                            </Badge>
                          </div>
                          {pageKept && plans.length > 0 && (
                            <div className="mt-1 ml-6 space-y-1">
                              {plans.map((p) => {
                                const kk = `${file.id}::${page}::${p.plan_id}`;
                                return (
                                  <label
                                    key={kk}
                                    className="flex items-center gap-2 text-xs cursor-pointer min-w-0"
                                  >
                                    <Checkbox
                                      checked={keptPlans.has(kk)}
                                      onCheckedChange={(v) =>
                                        setKeptPlans((prev) => {
                                          const next = new Set(prev);
                                          if (v === true) next.add(kk);
                                          else next.delete(kk);
                                          return next;
                                        })
                                      }
                                    />
                                    <span className="truncate capitalize">{planLabel(p)}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          {!pageKept && (
                            <p className="ml-6 mt-1 text-xs text-muted-foreground">
                              Existing bounding boxes on this page are kept.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {stage === "select" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={runSurvey} disabled={totalSelected === 0}>
                Run Scout Agent
              </Button>
            </>
          )}
          {stage === "review" && (
            <>
              <Button variant="outline" onClick={discard} disabled={applying}>
                Discard results
              </Button>
              <Button onClick={apply} disabled={applying}>
                {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Apply to drawings
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
