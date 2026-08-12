import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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

type MetricKey = "f1" | "precision" | "recall";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "f1", label: "F1" },
  { key: "precision", label: "Precision" },
  { key: "recall", label: "Recall" },
];

interface DatasetRow {
  id: string;
  name: string;
  /** metrics[iterationIndex] */
  metrics: (Record<MetricKey, number> | null)[];
}

const INITIAL_DATASETS: DatasetRow[] = [
  { id: "ds-1", name: "Golden Set A", metrics: [] },
  { id: "ds-2", name: "Golden Set B", metrics: [] },
];

export default function PromptRefineryDetail() {
  const { promptId } = useParams<{ promptId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAllowed = (user?.email?.toLowerCase() ?? "") === REFINERY_ADMIN_EMAIL;

  const [metric, setMetric] = useState<MetricKey>("f1");
  const [datasets, setDatasets] = useState<DatasetRow[]>(INITIAL_DATASETS);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [runOpen, setRunOpen] = useState(false);
  const [refineTarget, setRefineTarget] = useState<string>(INITIAL_DATASETS[0]?.id ?? "");
  const [evalTargets, setEvalTargets] = useState<string[]>(INITIAL_DATASETS.map((d) => d.id));

  const iterationCount = useMemo(
    () => datasets.reduce((max, d) => Math.max(max, d.metrics.length), 0),
    [datasets],
  );

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

  const addDataset = () => {
    const name = newName.trim();
    if (!name) return;
    setDatasets((prev) => [
      ...prev,
      { id: `ds-${Date.now()}`, name, metrics: Array(iterationCount).fill(null) },
    ]);
    setNewName("");
    setAddOpen(false);
  };

  const openRunModal = () => {
    setRefineTarget((prev) => (datasets.some((d) => d.id === prev) ? prev : datasets[0]?.id ?? ""));
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
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Add Dataset
          </Button>
          <div className="flex items-center gap-2">
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

        <div className="rounded-md border bg-card overflow-auto">
          <Table className="[&_td]:py-2 [&_th]:py-2">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[280px]">Dataset</TableHead>
                {Array.from({ length: Math.max(iterationCount, 1) }).map((_, i) => (
                  <TableHead key={i} className="w-[100px] text-center tabular-nums">
                    {i + 1}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {datasets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={Math.max(iterationCount, 1) + 1} className="text-center text-muted-foreground py-10">
                    No datasets yet.
                  </TableCell>
                </TableRow>
              )}
              {datasets.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium truncate">{d.name}</TableCell>
                  {Array.from({ length: Math.max(iterationCount, 1) }).map((_, i) => {
                    const value = d.metrics[i]?.[metric];
                    return (
                      <TableCell key={i} className="text-center tabular-nums text-muted-foreground">
                        {value == null ? "-" : `${value.toFixed(1)}%`}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={iterationCount === 0}>
            Latest Iteration Result
          </Button>
          <Button onClick={openRunModal} disabled={datasets.length === 0}>
            {iterationCount === 0 ? "Run First Iteration" : "Run Next Iteration"}
          </Button>
        </div>
      </main>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add dataset</DialogTitle>
            <DialogDescription>Give the dataset a name to track it in the iteration table.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dataset-name">Dataset name</Label>
            <Input
              id="dataset-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDataset()}
              placeholder="e.g. Suite Riser Set"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addDataset} disabled={!newName.trim()}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {iterationCount === 0 ? "Run First Iteration" : "Run Next Iteration"}
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
            <Button variant="outline" onClick={() => setRunOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setRunOpen(false)}>Run</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
