import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, FileText, Loader2 } from "lucide-react";
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
import { RepositoryConnectionDialog } from "@/components/wizard/RepositoryConnectionDialog";
import { ProcoreConnectionDialog } from "@/components/wizard/ProcoreConnectionDialog";
import { SharePointConnectionDialog } from "@/components/wizard/SharePointConnectionDialog";

const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg,.dwg,.dxf";

interface WMSVCreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function WMSVCreateProjectModal({ open, onOpenChange, onCreated }: WMSVCreateProjectModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const nameRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [showDriveDialog, setShowDriveDialog] = useState(false);
  const [showProcoreDialog, setShowProcoreDialog] = useState(false);
  const [showSharePointDialog, setShowSharePointDialog] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setFiles([]);
      setPendingProjectId(null);
      setPendingRequestId(null);
      setTimeout(() => nameRef.current?.focus(), 100);
    }
  }, [open]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const ensureProjectAndRequest = async (): Promise<{ projectId: string; requestId: string }> => {
    if (pendingProjectId && pendingRequestId) {
      return { projectId: pendingProjectId, requestId: pendingRequestId };
    }
    if (!name.trim() || !user) throw new Error("Project name is required");

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .insert({ name: name.trim(), user_id: user.id })
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
      toast({ title: "Error", description: (error as any)?.message || "Failed to create project", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleCloudAnalysisStarted = () => {
    onOpenChange(false);
    onCreated();
    toast({ title: "Project Created", description: `"${name.trim()}" created. Import started in background.` });
  };

  const handleCreate = async () => {
    if (!name.trim() || !user) return;
    setCreating(true);

    const projectName = name.trim();
    const selectedFiles = files;
    const hasFiles = selectedFiles.length > 0;

    try {
      // Create project + analysis_request synchronously so we have IDs to track
      let projectId = pendingProjectId;
      if (!projectId) {
        const { data: project, error: projectError } = await supabase
          .from("projects")
          .insert({ name: projectName, user_id: user.id })
          .select()
          .single();
        if (projectError) throw projectError;
        projectId = project.id;
      }

      let requestId = pendingRequestId;
      if (!requestId) {
        const { data: req, error: rErr } = await supabase
          .from("analysis_requests")
          .insert({
            project_id: projectId,
            user_id: user.id,
            source_type: "manual_upload",
            status: hasFiles ? "copying" : "awaiting_upload",
            file_count: selectedFiles.length,
          })
          .select()
          .single();
        if (rErr) throw rErr;
        requestId = req.id;
      } else if (hasFiles) {
        await supabase
          .from("analysis_requests")
          .update({ status: "copying", file_count: selectedFiles.length })
          .eq("id", requestId);
      }

      // If there are files, register placeholder rows synchronously so the
      // project detail page shows them immediately as "uploading".
      let placeholderRows: Array<{ id: string; name: string; storage_path: string; size: number; file: File }> = [];
      if (hasFiles) {
        const inserts = selectedFiles.map((file) => ({
          analysis_request_id: requestId!,
          drive_file_id: `manual_${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name}`,
          name: file.name,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          relative_path: file.name,
          storage_path: `${projectId}/${requestId}/${file.name}`,
          copy_status: "pending" as const,
        }));
        const { data: inserted, error: insErr } = await supabase
          .from("analysis_request_files")
          .insert(inserts)
          .select("id, name, storage_path");
        if (insErr) throw insErr;
        placeholderRows = (inserted || []).map((row, i) => ({
          id: row.id,
          name: row.name,
          storage_path: row.storage_path!,
          size: selectedFiles[i].size,
          file: selectedFiles[i],
        }));
      }

      // Close modal immediately and let the parent navigate / refresh
      toast({ title: "Project Created", description: `"${projectName}" created successfully.` });
      onOpenChange(false);
      onCreated();

      // Background uploads (do not await)
      if (hasFiles && placeholderRows.length > 0) {
        const reqId = requestId!;
        (async () => {
          let copied = 0;
          let totalBytes = 0;
          const failures: string[] = [];

          for (const row of placeholderRows) {
            const { error: uploadError } = await supabase.storage
              .from("uploaded-drawings")
              .upload(row.storage_path, row.file, { upsert: true });

            if (uploadError) {
              failures.push(`${row.name}: ${uploadError.message}`);
              await supabase
                .from("analysis_request_files")
                .update({ copy_status: "failed" })
                .eq("id", row.id);
            } else {
              copied++;
              totalBytes += row.size;
              await supabase
                .from("analysis_request_files")
                .update({ copy_status: "copied" })
                .eq("id", row.id);
            }
          }

          const finalStatus = copied > 0 ? "copied" : "failed";
          const finalError = failures.length > 0
            ? `${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ""}`
            : null;

          await supabase
            .from("analysis_requests")
            .update({
              status: finalStatus,
              total_size_bytes: totalBytes,
              file_count: copied,
              error_message: finalError,
            })
            .eq("id", reqId);

          // Kick off background PDF splitting immediately so per-page sheet
          // rows exist by the time the user opens the project detail page.
          // phaseOverride="split" is non-destructive (no result clearing).
          if (copied > 0) {
            supabase.functions
              .invoke("run-analysis-pipeline", {
                body: { analysisRequestId: reqId, phaseOverride: "split" },
              })
              .catch((e) => console.error("[upload] auto-split failed", e));
          }

          if (failures.length === 0) {
            toast({
              title: "Upload Complete",
              description: `${copied} file(s) uploaded to "${projectName}".`,
            });
          } else {
            toast({
              title: copied > 0 ? "Some uploads failed" : "Upload Failed",
              description: `${copied}/${placeholderRows.length} uploaded for "${projectName}". ${finalError}`,
              variant: "destructive",
            });
          }

        })();
      }
    } catch (error) {
      toast({
        title: "Creation Failed",
        description: (error as any)?.message || "Failed to create project",
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
            <DialogTitle>Add New Project</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="wmsv-project-name">Project Name</Label>
              <Input
                id="wmsv-project-name"
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter project name"
                onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleCreate(); }}
              />
            </div>

            <div className="space-y-2">
              <Label>Drawings (optional)</Label>
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim() || creating}>
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
