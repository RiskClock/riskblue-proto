import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Settings2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileViewerModal } from "@/components/wizard/FileViewerModal";
import type { DocumentSourceDescriptor } from "@/components/viewer";
import { useAWPOptions, groupAWPOptionsByCategory } from "@/hooks/useAWPOptions";
import { getUserFriendlyError } from "@/lib/errorHandling";

const PREF_ID = "global";

interface FileRow {
  id: string;
  name: string;
  source_type: string;
}

interface SheetRow {
  id: string;
  parent_file_id: string;
  page_index: number;
  sheet_number: string | null;
  sheet_title: string | null;
  storage_path: string | null;
  file_name: string;
  file_source_type: string;
}

interface TriageCount {
  sheet_id: string | null;
  file_id: string;
  awp_class_name: string;
  instances: number | null;
}

export default function WorkbenchProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  const [activeSheet, setActiveSheet] = useState<SheetRow | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [draftCols, setDraftCols] = useState<string[]>([]);
  const [savingPrefs, setSavingPrefs] = useState(false);

  useEffect(() => {
    if (user && !isInternal) navigate("/projects", { replace: true });
  }, [user, isInternal, navigate]);

  // Project metadata
  const { data: project } = useQuery({
    queryKey: ["workbench-project", projectId],
    enabled: !!projectId && isInternal,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, user_id")
        .eq("id", projectId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Latest analysis_request for this project
  const { data: analysisRequest } = useQuery({
    queryKey: ["workbench-analysis-request", projectId],
    enabled: !!projectId && isInternal,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_requests")
        .select("id, source_type")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Files + sheets for the latest request
  const { data: rows, isLoading } = useQuery({
    queryKey: ["workbench-rows", analysisRequest?.id],
    enabled: !!analysisRequest?.id,
    queryFn: async () => {
      const requestId = analysisRequest!.id;
      const [filesRes, sheetsRes] = await Promise.all([
        supabase
          .from("analysis_request_files")
          .select("id, name")
          .eq("analysis_request_id", requestId),
        supabase
          .from("analysis_request_sheets")
          .select("id, parent_file_id, page_index, sheet_number, sheet_title, storage_path")
          .eq("analysis_request_id", requestId)
          .order("page_index", { ascending: true }),
      ]);
      if (filesRes.error) throw filesRes.error;
      if (sheetsRes.error) throw sheetsRes.error;
      const files: FileRow[] = (filesRes.data || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        source_type: analysisRequest!.source_type,
      }));
      const fileMap = new Map(files.map((f) => [f.id, f]));
      const sheets: SheetRow[] = (sheetsRes.data || [])
        .map((s: any): SheetRow | null => {
          const f = fileMap.get(s.parent_file_id);
          if (!f) return null;
          return {
            id: s.id,
            parent_file_id: s.parent_file_id,
            page_index: s.page_index,
            sheet_number: s.sheet_number,
            sheet_title: s.sheet_title,
            storage_path: s.storage_path,
            file_name: f.name,
            file_source_type: f.source_type,
          };
        })
        .filter((s): s is SheetRow => s !== null)
        .sort(
          (a, b) =>
            a.file_name.localeCompare(b.file_name) || a.page_index - b.page_index,
        );
      return { files, sheets };
    },
  });

  // Triage counts per (sheet, awp_class)
  const { data: triage } = useQuery({
    queryKey: ["workbench-triage", analysisRequest?.id],
    enabled: !!analysisRequest?.id,
    queryFn: async (): Promise<TriageCount[]> => {
      const { data, error } = await supabase
        .from("analysis_triage_results")
        .select("sheet_id, file_id, awp_class_name, instances")
        .eq("analysis_request_id", analysisRequest!.id);
      if (error) throw error;
      return (data || []) as TriageCount[];
    },
  });

  // AWP options + global column preferences
  const { data: awpOptions } = useAWPOptions();
  const eligibleOptions = useMemo(
    () => (awpOptions || []).filter((o) => o.category === "Asset" || o.category === "Water System"),
    [awpOptions],
  );

  const { data: prefs } = useQuery({
    queryKey: ["workbench-column-prefs"],
    enabled: isInternal,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workbench_column_preferences")
        .select("awp_class_names")
        .eq("id", PREF_ID)
        .maybeSingle();
      if (error) throw error;
      return (data?.awp_class_names as string[]) || [];
    },
  });

  const enabledCols = prefs || [];

  const countLookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of triage || []) {
      if (!t.sheet_id) continue;
      const key = `${t.sheet_id}::${t.awp_class_name}`;
      m.set(key, (m.get(key) || 0) + (t.instances || 0));
    }
    return m;
  }, [triage]);

  const openManage = () => {
    setDraftCols(enabledCols);
    setManageOpen(true);
  };

  const toggleDraft = (name: string) => {
    setDraftCols((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  const saveColumns = async () => {
    setSavingPrefs(true);
    try {
      const { error } = await supabase
        .from("workbench_column_preferences")
        .upsert({
          id: PREF_ID,
          awp_class_names: draftCols,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["workbench-column-prefs"] });
      toast({ title: "Columns updated" });
      setManageOpen(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Could not save columns",
        description: getUserFriendlyError(error),
      });
    } finally {
      setSavingPrefs(false);
    }
  };

  const sheetSource = useMemo<DocumentSourceDescriptor | null>(() => {
    if (!activeSheet || !activeSheet.storage_path) return null;
    const bucket =
      activeSheet.file_source_type === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";
    return {
      kind: "supabase-storage",
      bucket,
      path: activeSheet.storage_path,
      mimeType: "application/pdf",
    };
  }, [activeSheet]);

  if (!user || !isInternal) {
    return (
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        <AppHeader />
        <main className="container mx-auto px-6 py-12 flex-1 overflow-auto">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShieldAlert className="h-4 w-4" /> Internal users only.
          </div>
        </main>
      </div>
    );
  }

  const grouped = awpOptions ? groupAWPOptionsByCategory(eligibleOptions) : {};

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AppHeader />
      <main className="container mx-auto px-6 py-8 flex-1 overflow-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/internal/workbench")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Workbench
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{project?.name || "Project"}</h1>
              <p className="text-sm text-muted-foreground">Files and pages by detection</p>
            </div>
          </div>
          {rows && (
            <Badge variant="outline" className="text-sm">
              {rows.sheets.length} page{rows.sheets.length === 1 ? "" : "s"} · {rows.files.length} file
              {rows.files.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : !analysisRequest || !rows || rows.sheets.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No drawings uploaded for this project yet.
          </div>
        ) : (
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px]">File / Page</TableHead>
                  {enabledCols.map((name) => (
                    <TableHead key={name} className="text-right whitespace-nowrap">
                      {name}
                    </TableHead>
                  ))}
                  <TableHead className="text-right w-[1%] whitespace-nowrap">
                    <Button variant="outline" size="sm" onClick={openManage}>
                      <Settings2 className="h-4 w-4 mr-1" /> Manage
                    </Button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.sheets.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => setActiveSheet(s)}
                  >
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">{s.file_name}</span>
                        <span className="text-xs text-muted-foreground">
                          Page {s.page_index}
                          {s.sheet_number ? ` · ${s.sheet_number}` : ""}
                          {s.sheet_title ? ` — ${s.sheet_title}` : ""}
                        </span>
                      </div>
                    </TableCell>
                    {enabledCols.map((name) => {
                      const count = countLookup.get(`${s.id}::${name}`) || 0;
                      return (
                        <TableCell key={name} className="text-right tabular-nums">
                          {count > 0 ? (
                            <span className="font-medium">{count}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      {/* Drawing modal */}
      {activeSheet && sheetSource && (
        <FileViewerModal
          isOpen={!!activeSheet}
          onClose={() => setActiveSheet(null)}
          fileId={activeSheet.id}
          fileName={`${activeSheet.file_name} — Page ${activeSheet.page_index}`}
          mimeType="application/pdf"
          accessToken=""
          detections={[]}
          sourceOverride={sheetSource}
        />
      )}

      {/* Manage columns modal */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage columns</DialogTitle>
            <DialogDescription>
              Pick which assets and water systems appear as columns. Shared across all internal
              users.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto space-y-5 py-2">
            {Object.entries(grouped).map(([category, opts]) => (
              <div key={category}>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {category}
                </div>
                <div className="space-y-2">
                  {opts.map((opt) => {
                    const checked = draftCols.includes(opt.name);
                    return (
                      <label
                        key={opt.id}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleDraft(opt.name)}
                        />
                        <span>{opt.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageOpen(false)} disabled={savingPrefs}>
              Cancel
            </Button>
            <Button onClick={saveColumns} disabled={savingPrefs}>
              {savingPrefs ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
