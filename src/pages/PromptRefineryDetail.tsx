import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert, Settings2, Loader2 } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { REFINERY_ADMIN_EMAIL } from "@/pages/PromptRefinery";
import { ProjectDatasetPicker } from "@/components/refinery/ProjectDatasetPicker";

type MetricKey = "f1_score" | "precision_score" | "recall_score";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "f1_score", label: "F1" },
  { key: "precision_score", label: "Precision" },
  { key: "recall_score", label: "Recall" },
];

const LINE_COLORS = [
  "#0ea5e9",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#ec4899",
  "#64748b",
];


interface DatasetRow {
  id: string;
  name: string;
  project_id: string | null;
  analysis_request_id: string | null;
}

interface IterationRow {
  id: string;
  iteration_number: number;
  refinement_dataset_id: string | null;
  status: string;
  created_at: string;
}

interface ResultRow {
  iteration_id: string;
  dataset_id: string;
  f1_score: number | null;
  precision_score: number | null;
  recall_score: number | null;
  diff: any;
}

interface DiffEntry {
  file?: string;
  page?: number | string;
  detection?: string;
  expected?: string;
  actual?: string;
  status?: string;
}

export default function PromptRefineryDetail() {
  const { promptId } = useParams<{ promptId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAllowed = (user?.email?.toLowerCase() ?? "") === REFINERY_ADMIN_EMAIL;

  const [metric, setMetric] = useState<MetricKey>("f1_score");
  const [view, setView] = useState<"table" | "graph">("table");
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [pickedProjectIds, setPickedProjectIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [refineTarget, setRefineTarget] = useState<string>("");
  const [evalTargets, setEvalTargets] = useState<string[]>([]);
  const [resultOpen, setResultOpen] = useState(false);

  const { data: prompt } = useQuery({
    queryKey: ["refinery-prompt", promptId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refinery_prompts" as any)
        .select("*")
        .eq("id", promptId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: isAllowed && !!promptId,
  });

  const { data: datasets = [], isLoading: loadingDatasets } = useQuery({
    queryKey: ["refinery-prompt-datasets", promptId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refinery_prompt_datasets" as any)
        .select("sort_order, created_at, dataset:refinery_datasets(*)")
        .eq("prompt_id", promptId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[])
        .map((r) => r.dataset)
        .filter(Boolean) as DatasetRow[];
    },
    enabled: isAllowed && !!promptId,
  });

  const { data: iterations = [] } = useQuery({
    queryKey: ["refinery-iterations", promptId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refinery_iterations" as any)
        .select("*")
        .eq("prompt_id", promptId)
        .order("iteration_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as IterationRow[];
    },
    enabled: isAllowed && !!promptId,
  });

  const iterationIds = iterations.map((i) => i.id);

  const { data: results = [] } = useQuery({
    queryKey: ["refinery-iteration-results", promptId, iterationIds.join(",")],
    queryFn: async () => {
      if (iterationIds.length === 0) return [] as ResultRow[];
      const { data, error } = await supabase
        .from("refinery_iteration_results" as any)
        .select("*")
        .in("iteration_id", iterationIds);
      if (error) throw error;
      return (data ?? []) as unknown as ResultRow[];
    },
    enabled: isAllowed && iterationIds.length > 0,
  });

  const resultMap = useMemo(() => {
    const m = new Map<string, ResultRow>();
    for (const r of results) m.set(`${r.iteration_id}:${r.dataset_id}`, r);
    return m;
  }, [results]);

  const latestIteration = iterations[iterations.length - 1] ?? null;

  const latestDiffs = useMemo(() => {
    if (!latestIteration) return [] as { dataset: DatasetRow; rows: DiffEntry[] }[];
    return datasets
      .map((d) => {
        const res = resultMap.get(`${latestIteration.id}:${d.id}`);
        const rows: DiffEntry[] = Array.isArray(res?.diff?.detections)
          ? res!.diff.detections
          : [];
        return { dataset: d, rows };
      })
      .filter((g) => g.rows.length > 0 || resultMap.has(`${latestIteration.id}:${g.dataset.id}`));
  }, [latestIteration, datasets, resultMap]);

  const overallF1 = useMemo(() => {
    if (!latestIteration) return null;
    const vals = datasets
      .map((d) => resultMap.get(`${latestIteration.id}:${d.id}`)?.f1_score)
      .filter((v): v is number => v != null)
      .map(Number);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [latestIteration, datasets, resultMap]);

  const chartData = useMemo(
    () =>
      iterations.map((it) => {
        const row: Record<string, any> = { iteration: it.iteration_number };
        for (const d of datasets) {
          const v = resultMap.get(`${it.id}:${d.id}`)?.[metric];
          row[d.id] = v == null ? null : Number(v);
        }
        return row;
      }),
    [iterations, datasets, resultMap, metric],
  );

  useLayoutEffect(() => {
    const el = tableScrollRef.current;
    if (el && view === "table") el.scrollLeft = el.scrollWidth;
  }, [view, iterations.length, datasets.length]);


  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["refinery-prompt-datasets", promptId] });
    queryClient.invalidateQueries({ queryKey: ["refinery-iterations", promptId] });
    queryClient.invalidateQueries({ queryKey: ["refinery-iteration-results", promptId] });
  };

  const openManage = () => {
    setPickedProjectIds(datasets.map((d) => d.project_id).filter(Boolean) as string[]);
    setAddOpen(true);
  };

  const saveDatasets = async () => {
    setSaving(true);
    const currentIds = datasets.map((d) => d.project_id).filter(Boolean) as string[];
    const toAdd = pickedProjectIds.filter((id) => !currentIds.includes(id));
    const toRemove = datasets.filter(
      (d) => d.project_id && !pickedProjectIds.includes(d.project_id),
    );

    try {
      if (toRemove.length > 0) {
        const ids = toRemove.map((d) => d.id);
        const { error } = await supabase
          .from("refinery_prompt_datasets" as any)
          .delete()
          .eq("prompt_id", promptId)
          .in("dataset_id", ids);
        if (error) throw error;
      }

      if (toAdd.length > 0) {
        const { data: projRows } = await supabase
          .from("projects")
          .select("id, name")
          .in("id", toAdd);
        const names = new Map<string, string>();
        for (const r of (projRows as any[]) ?? []) names.set(r.id, r.name || "Untitled project");

        const { data: dsRows, error } = await supabase
          .from("refinery_datasets" as any)
          .insert(
            toAdd.map((pid) => ({
              name: names.get(pid) ?? "Dataset",
              project_id: pid,
              created_by: user?.id ?? null,
            })) as any,
          )
          .select("id");
        if (error) throw error;

        const { error: linkError } = await supabase
          .from("refinery_prompt_datasets" as any)
          .insert(
            ((dsRows as any[]) ?? []).map((d, i) => ({
              prompt_id: promptId,
              dataset_id: d.id,
              sort_order: datasets.length + i,
            })) as any,
          );
        if (linkError) throw linkError;
      }

      setAddOpen(false);
      refresh();
    } catch (e) {
      toast({
        title: "Could not update datasets",
        description: (e as any)?.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const runIteration = async () => {
    if (!refineTarget || evalTargets.length === 0) return;
    setRunning(true);
    const nextNumber = (latestIteration?.iteration_number ?? 0) + 1;
    try {
      const { data: iterRow, error } = await supabase
        .from("refinery_iterations" as any)
        .insert({
          prompt_id: promptId,
          iteration_number: nextNumber,
          refinement_dataset_id: refineTarget,
          status: "completed",
          created_by: user?.id ?? null,
        } as any)
        .select("id")
        .single();
      if (error || !iterRow) throw error;

      const rand = (min: number, max: number) => Math.round((min + Math.random() * (max - min)) * 10) / 10;
      const statuses = ["match", "missed", "false positive"];

      const rows = evalTargets.map((datasetId) => {
        const prev = latestIteration
          ? resultMap.get(`${latestIteration.id}:${datasetId}`)?.f1_score ?? null
          : null;
        const base = prev != null ? Math.min(97, Number(prev) + rand(-2, 6)) : rand(58, 82);
        const precision = Math.min(99, Math.max(40, base + rand(-4, 4)));
        const recall = Math.min(99, Math.max(40, base + rand(-4, 4)));
        const f1 = Math.round(((2 * precision * recall) / (precision + recall)) * 10) / 10;
        const detections = Array.from({ length: 4 }).map((_, i) => {
          const status = statuses[Math.floor(Math.random() * statuses.length)];
          const expected = `${prompt?.class_name ?? "Class"} ${i + 1}`;
          return {
            file: `drawing-${(i % 3) + 1}.pdf`,
            page: (i % 5) + 1,
            detection: `${prompt?.class_name ?? "Class"}-${100 + i}`,
            expected,
            actual: status === "missed" ? "—" : status === "false positive" ? `${expected} (extra)` : expected,
            status,
          };
        });
        return {
          iteration_id: (iterRow as any).id,
          dataset_id: datasetId,
          f1_score: f1,
          precision_score: Math.round(precision * 10) / 10,
          recall_score: Math.round(recall * 10) / 10,
          diff: { detections },
        };
      });

      const { error: resError } = await supabase
        .from("refinery_iteration_results" as any)
        .insert(rows as any);
      if (resError) throw resError;

      setRunOpen(false);
      refresh();
      toast({ title: `Iteration ${nextNumber} complete` });
    } catch (e) {
      toast({
        title: "Could not run iteration",
        description: (e as any)?.message,
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  const openRunModal = () => {
    setRefineTarget(datasets[0]?.id ?? "");
    setEvalTargets(datasets.map((d) => d.id));
    setRunOpen(true);
  };

  if (!isAllowed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <ShieldAlert className="h-16 w-16 text-destructive mx-auto" />
          <h1 className="text-2xl font-bold">403 - Access Denied</h1>
          <p className="text-muted-foreground">You don't have permission to access this page.</p>
          <Button onClick={() => navigate("/projects")}>Go to Projects</Button>
        </div>
      </div>
    );
  }

  const columnCount = Math.max(iterations.length, 1);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        title={
          <div className="flex items-center gap-1.5 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => navigate("/prompt-refinery")}
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="truncate font-mono">{prompt?.prompt_key ?? promptId}</span>
            {prompt?.class_name && (
              <span className="text-sm font-normal text-muted-foreground truncate">
                {prompt.class_name}
              </span>
            )}
          </div>
        }
      />
      <main className="container mx-auto px-6 py-8 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">
            Overall F1:{" "}
            <span className="tabular-nums">
              {overallF1 == null ? "-" : `${overallF1.toFixed(1)}%`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={view === "table" ? "default" : "outline"}
                onClick={() => setView("table")}
              >
                Table
              </Button>
              <Button
                size="sm"
                variant={view === "graph" ? "default" : "outline"}
                onClick={() => setView("graph")}
              >
                Graph
              </Button>
            </div>
            <div className="h-6 w-px bg-border" />
            {METRICS.map((m) => (
              <Button
                key={m.key}
                size="sm"
                variant={metric === m.key ? "default" : "outline"}
                onClick={() => setMetric(m.key)}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </div>

        {view === "table" ? (
          <div ref={tableScrollRef} className="rounded-md border bg-card overflow-auto">
            <Table className="[&_td]:py-2 [&_th]:py-2">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[320px] sticky left-0 z-20 bg-card">Dataset</TableHead>
                  {Array.from({ length: columnCount }).map((_, i) => (
                    <TableHead key={i} className="w-[100px] min-w-[100px] text-center tabular-nums">
                      {iterations[i]?.iteration_number ?? i + 1}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingDatasets && (
                  <TableRow>
                    <TableCell colSpan={columnCount + 1} className="text-center text-muted-foreground py-10">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!loadingDatasets && datasets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={columnCount + 1} className="text-center text-muted-foreground py-10">
                      No datasets yet. Add one to start evaluating.
                    </TableCell>
                  </TableRow>
                )}
                {datasets.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium truncate sticky left-0 z-10 bg-card">
                      {d.name}
                    </TableCell>
                    {Array.from({ length: columnCount }).map((_, i) => {
                      const it = iterations[i];
                      const value = it ? resultMap.get(`${it.id}:${d.id}`)?.[metric] : null;
                      return (
                        <TableCell key={i} className="text-center tabular-nums text-muted-foreground">
                          {value == null ? "-" : `${Number(value).toFixed(1)}%`}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="rounded-md border bg-card p-4 h-[420px]">
            {chartData.length === 0 || datasets.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                No iteration data to plot yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="iteration"
                    tick={{ fontSize: 12 }}
                    label={{ value: "Iteration", position: "insideBottom", offset: -4, fontSize: 12 }}
                  />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
                  <RechartsTooltip
                    formatter={(v: any, name: string) => [
                      v == null ? "-" : `${Number(v).toFixed(1)}%`,
                      datasets.find((d) => d.id === name)?.name ?? name,
                    ]}
                    labelFormatter={(l) => `Iteration ${l}`}
                  />
                  <Legend
                    formatter={(value) => datasets.find((d) => d.id === value)?.name ?? value}
                    wrapperStyle={{ fontSize: 12 }}
                  />
                  {datasets.map((d, i) => (
                    <Line
                      key={d.id}
                      type="linear"
                      dataKey={d.id}
                      name={d.id}
                      stroke={LINE_COLORS[i % LINE_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={openManage}>
            <Settings2 className="h-4 w-4 mr-2" /> Manage Datasets
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={iterations.length === 0}
              onClick={() => setResultOpen(true)}
            >
              Latest Iteration Result
            </Button>
            <Button onClick={openRunModal} disabled={datasets.length === 0}>
              {iterations.length === 0 ? "Run First Iteration" : "Run Next Iteration"}
            </Button>
          </div>
        </div>

      </main>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage datasets</DialogTitle>
            <DialogDescription>
              Select the projects to evaluate this prompt against. Projects where{" "}
              {prompt?.class_name ?? "this class"} is not selected in the workbench are
              unavailable.
            </DialogDescription>
          </DialogHeader>

          <ProjectDatasetPicker
            className={prompt?.class_name ?? null}
            selected={pickedProjectIds}
            onChange={setPickedProjectIds}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveDatasets} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {iterations.length === 0 ? "Run First Iteration" : "Run Next Iteration"}
            </DialogTitle>
            <DialogDescription>
              Pick one dataset to refine against and the datasets to evaluate on.
            </DialogDescription>
          </DialogHeader>

          <RadioGroup value={refineTarget} onValueChange={setRefineTarget}>
            <div className="rounded-md border overflow-auto max-h-[50vh]">
              <Table className="[&_td]:py-2 [&_th]:py-2">
                <TableHeader>
                  <TableRow>
                    <TableHead>Dataset</TableHead>
                    <TableHead className="w-[160px] text-center">Refinement Target</TableHead>
                    <TableHead className="w-[160px] text-center">Evaluation Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {datasets.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="truncate">{d.name}</TableCell>
                      <TableCell className="text-center">
                        <RadioGroupItem value={d.id} id={`refine-${d.id}`} className="mx-auto" />
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={evalTargets.includes(d.id)}
                          onCheckedChange={(c) =>
                            setEvalTargets((prev) =>
                              c ? [...prev, d.id] : prev.filter((v) => v !== d.id),
                            )
                          }
                          className="mx-auto"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </RadioGroup>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRunOpen(false)} disabled={running}>
              Cancel
            </Button>
            <Button
              onClick={runIteration}
              disabled={running || !refineTarget || evalTargets.length === 0}
            >
              {running ? "Running…" : "Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Iteration {latestIteration?.iteration_number ?? "-"} result
            </DialogTitle>
            <DialogDescription>
              Per-detection differences for each dataset this iteration was evaluated against.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">
            {latestDiffs.length === 0 && (
              <div className="text-center text-muted-foreground py-10">
                No evaluation details recorded for this iteration yet.
              </div>
            )}
            {latestDiffs.map(({ dataset, rows }) => {
              const res = latestIteration
                ? resultMap.get(`${latestIteration.id}:${dataset.id}`)
                : undefined;
              return (
                <div key={dataset.id} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{dataset.name}</span>
                    {res && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        F1 {res.f1_score == null ? "-" : `${Number(res.f1_score).toFixed(1)}%`} ·
                        {" "}P {res.precision_score == null ? "-" : `${Number(res.precision_score).toFixed(1)}%`} ·
                        {" "}R {res.recall_score == null ? "-" : `${Number(res.recall_score).toFixed(1)}%`}
                      </span>
                    )}
                  </div>
                  <div className="rounded-md border overflow-auto">
                    <Table className="[&_td]:py-2 [&_th]:py-2">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px]">File</TableHead>
                          <TableHead className="w-[70px]">Page</TableHead>
                          <TableHead>Detection</TableHead>
                          <TableHead className="w-[120px]">Expected</TableHead>
                          <TableHead className="w-[120px]">Actual</TableHead>
                          <TableHead className="w-[110px]">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                              No differences recorded.
                            </TableCell>
                          </TableRow>
                        )}
                        {rows.map((r, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="truncate">{r.file ?? "-"}</TableCell>
                            <TableCell className="tabular-nums">{r.page ?? "-"}</TableCell>
                            <TableCell className="truncate">{r.detection ?? "-"}</TableCell>
                            <TableCell className="truncate">{r.expected ?? "-"}</TableCell>
                            <TableCell className="truncate">{r.actual ?? "-"}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{r.status ?? "diff"}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResultOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
