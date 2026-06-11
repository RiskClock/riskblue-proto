import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { CalendarIcon, Upload, X, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RepositoryConnectionDialog } from "@/components/wizard/RepositoryConnectionDialog";
import { ProcoreConnectionDialog } from "@/components/wizard/ProcoreConnectionDialog";
import { SharePointConnectionDialog } from "@/components/wizard/SharePointConnectionDialog";

const LS_KEY = "analysis-queue-navigate-after-create";
const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg,.dwg,.dxf";

interface CreateAnalysisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateAnalysisModal({ open, onOpenChange, onCreated }: CreateAnalysisModalProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const nameRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [files, setFiles] = useState<File[]>([]);
  const [navigateAfter, setNavigateAfter] = useState(() => {
    return localStorage.getItem(LS_KEY) === "true";
  });
  const [creating, setCreating] = useState(false);

  // Cloud source dialog state
  const [showDriveDialog, setShowDriveDialog] = useState(false);
  const [showProcoreDialog, setShowProcoreDialog] = useState(false);
  const [showSharePointDialog, setShowSharePointDialog] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setName("");
      setStartDate(undefined);
      setEndDate(undefined);
      setFiles([]);
      setPendingProjectId(null);
      setPendingRequestId(null);
      setTimeout(() => nameRef.current?.focus(), 100);
    }
  }, [open]);

  const handleNavigateChange = (checked: boolean) => {
    setNavigateAfter(checked);
    localStorage.setItem(LS_KEY, String(checked));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  /** Create project + placeholder request if not yet created */
  const ensureProjectAndRequest = async (): Promise<{ projectId: string; requestId: string }> => {
    if (pendingProjectId && pendingRequestId) {
      return { projectId: pendingProjectId, requestId: pendingRequestId };
    }
    if (!name.trim() || !user) throw new Error("Project name is required");

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .insert({
        name: name.trim(),
        user_id: user.id,
        construction_start_date: startDate ? format(startDate, "yyyy-MM-dd") : null,
        construction_end_date: endDate ? format(endDate, "yyyy-MM-dd") : null,
      })
      .select()
      .single();
    if (pErr) throw pErr;

    const { data: req, error: rErr } = await supabase
      .from("analysis_requests")
      .insert({
        project_id: project.id,
        user_id: user.id,
        source_type: "manual_upload",
        status: "awaiting_upload",
      })
      .select()
      .single();
    if (rErr) throw rErr;

    setPendingProjectId(project.id);
    setPendingRequestId(req.id);
    return { projectId: project.id, requestId: req.id };
  };

  const handleCloudSourceClick = async (source: "drive" | "procore" | "sharepoint") => {
    if (!name.trim()) {
      toast({ title: "Name Required", description: "Please enter a project name first.", variant: "destructive" });
      return;
    }
    try {
      setCreating(true);
      await ensureProjectAndRequest();
      if (source === "drive") setShowDriveDialog(true);
      else if (source === "procore") setShowProcoreDialog(true);
      else setShowSharePointDialog(true);
    } catch (error) {
      const msg = (error as any)?.message || "Failed to create project";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleCloudAnalysisStarted = () => {
    onOpenChange(false);
    onCreated();
    if (navigateAfter && pendingRequestId) {
      navigate(`/internal/analysis-queue/${pendingRequestId}`);
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !user) return;
    setCreating(true);

    try {
      // Reuse project if already created (e.g. user clicked Drive, cancelled, then Create)
      let projectId = pendingProjectId;
      if (!projectId) {
        const { data: project, error: projectError } = await supabase
          .from("projects")
          .insert({
            name: name.trim(),
            user_id: user.id,
            construction_start_date: startDate ? format(startDate, "yyyy-MM-dd") : null,
            construction_end_date: endDate ? format(endDate, "yyyy-MM-dd") : null,
          })
          .select()
          .single();
        if (projectError) throw projectError;
        projectId = project.id;
      }

      const hasFiles = files.length > 0;
      let requestId = pendingRequestId;

      if (!requestId) {
        const { data: analysisRequest, error: arError } = await supabase
          .from("analysis_requests")
          .insert({
            project_id: projectId,
            user_id: user.id,
            source_type: "manual_upload",
            status: hasFiles ? "pending" : "awaiting_upload",
            file_count: files.length,
          })
          .select()
          .single();
        if (arError) throw arError;
        requestId = analysisRequest.id;
      } else if (hasFiles) {
        const { error: updateErr } = await supabase
          .from("analysis_requests")
          .update({ status: "pending", file_count: files.length })
          .eq("id", requestId);
        if (updateErr) throw updateErr;
      }

      // Upload files if any
      if (hasFiles) {
        let totalBytes = 0;
        for (const file of files) {
          const filePath = `${projectId}/${requestId}/${file.name}`;
          const { error: uploadError } = await supabase.storage
            .from("uploaded-drawings")
            .upload(filePath, file);
          if (uploadError) throw uploadError;
          totalBytes += file.size;

          const { error: fileError } = await supabase.from("analysis_request_files").insert({
            analysis_request_id: requestId,
            drive_file_id: `manual_${Date.now()}_${file.name}`,
            name: file.name,
            mime_type: file.type || "application/octet-stream",
            size_bytes: file.size,
            relative_path: file.name,
            storage_path: filePath,
            copy_status: "copied",
          });
          if (fileError) throw fileError;
        }

        await supabase
          .from("analysis_requests")
          .update({ status: "copied", total_size_bytes: totalBytes })
          .eq("id", requestId);

        // Auto-trigger split phase (bounded — no downstream agents).
        supabase.functions
          .invoke("run-analysis-pipeline", {
            body: { analysisRequestId: requestId, phaseOverride: "split" },
          })
          .catch((e) => console.error("[create-analysis] auto-split kickoff failed", e));
      }

      toast({ title: "Analysis Created", description: `Project "${name.trim()}" created successfully.` });
      onOpenChange(false);
      onCreated();

      if (navigateAfter) {
        navigate(`/internal/analysis-queue/${requestId}`);
      }
    } catch (error) {
      const msg = (error as any)?.message || (error instanceof Error ? error.message : "Failed to create analysis");
      toast({
        title: "Creation Failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Analysis</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Project Name */}
            <div className="space-y-2">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter project name"
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleCreate(); }}
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date (optional)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !startDate && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>End Date (optional)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !endDate && "text-muted-foreground")}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={endDate} onSelect={setEndDate} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* File Selection */}
            <div className="space-y-2">
              <Label>Select files to analyze (optional)</Label>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="w-4 h-4 mr-1" />
                  Upload from Computer
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleCloudSourceClick("drive")} disabled={creating}>
                  <img src="/icons/icon_googledrive.png" className="w-4 h-4 mr-1" alt="Google Drive" />
                  Google Drive
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleCloudSourceClick("procore")} disabled={creating}>
                  <img src="/icons/icon_procore.png" className="w-4 h-4 mr-1" alt="Procore" />
                  Procore
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleCloudSourceClick("sharepoint")} disabled={creating}>
                  <img src="/icons/icon_sharepoint.png" className="w-4 h-4 mr-1" alt="SharePoint" />
                  SharePoint
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />

              {/* File list */}
              {files.length > 0 && (
                <div className="border rounded-md p-2 space-y-1 max-h-40 overflow-y-auto">
                  {files.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm px-2 py-1 bg-muted/50 rounded">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{file.name}</span>
                        <span className="text-muted-foreground text-xs shrink-0">{formatBytes(file.size)}</span>
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeFile(idx)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Navigate checkbox */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="navigate-after"
                checked={navigateAfter}
                onCheckedChange={(checked) => handleNavigateChange(!!checked)}
              />
              <Label htmlFor="navigate-after" className="text-sm font-normal cursor-pointer">
                Go to analysis page after creation
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim() || creating}>
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cloud source dialogs - rendered outside the main Dialog to avoid nesting issues */}
      {pendingProjectId && (
        <>
          <RepositoryConnectionDialog
            isOpen={showDriveDialog}
            onClose={() => setShowDriveDialog(false)}
            projectId={pendingProjectId}
            projectName={name.trim()}
            analysisRequestId={pendingRequestId || undefined}
            onAnalysisStarted={handleCloudAnalysisStarted}
          />
          <ProcoreConnectionDialog
            isOpen={showProcoreDialog}
            onClose={() => setShowProcoreDialog(false)}
            projectId={pendingProjectId}
            projectName={name.trim()}
            analysisRequestId={pendingRequestId || undefined}
            onAnalysisStarted={handleCloudAnalysisStarted}
          />
          <SharePointConnectionDialog
            isOpen={showSharePointDialog}
            onClose={() => setShowSharePointDialog(false)}
            projectId={pendingProjectId}
            projectName={name.trim()}
            analysisRequestId={pendingRequestId || undefined}
            onAnalysisStarted={handleCloudAnalysisStarted}
          />
        </>
      )}
    </>
  );
}
