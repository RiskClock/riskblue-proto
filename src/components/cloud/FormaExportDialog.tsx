import { useEffect, useState } from "react";
import { ChevronRight, Folder, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAutodeskConnection, callForma } from "@/hooks/useAutodeskConnection";
import { CloudProviderLogo } from "./CloudProviderButton";

type Option = { id: string; name: string };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  pdfBlob: Blob | null;
  fileName: string;
}

/** Upload a generated report into an Autodesk Forma / Docs folder. */
export function FormaExportDialog({ isOpen, onClose, pdfBlob, fileName }: Props) {
  const { toast } = useToast();
  const { connected, connect } = useAutodeskConnection();
  const [hubs, setHubs] = useState<Option[]>([]);
  const [hubId, setHubId] = useState("");
  const [projects, setProjects] = useState<Option[]>([]);
  const [projectId, setProjectId] = useState("");
  const [trail, setTrail] = useState<Option[]>([]);
  const [folders, setFolders] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const err = (e: unknown, title: string) => toast({ title, description: (e as any)?.message, variant: "destructive" });

  useEffect(() => {
    if (!isOpen || !connected) return;
    callForma<{ hubs: Option[] }>("list-forma-files", { action: "hubs" })
      .then((r) => { setHubs(r.hubs); if (r.hubs.length === 1) setHubId(r.hubs[0].id); })
      .catch((e) => err(e, "Could not load hubs"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, connected]);

  useEffect(() => {
    setProjects([]); setProjectId("");
    if (!hubId) return;
    callForma<{ projects: Option[] }>("list-forma-files", { action: "projects", hubId })
      .then((r) => setProjects(r.projects))
      .catch((e) => err(e, "Could not load projects"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubId]);

  const load = async (folder: Option | null) => {
    setLoading(true);
    try {
      const r = folder
        ? await callForma<{ folders: Option[] }>("list-forma-files", { action: "folder", projectId, folderId: folder.id })
        : await callForma<{ folders: Option[] }>("list-forma-files", { action: "top-folders", hubId, projectId });
      setFolders(r.folders);
    } catch (e) {
      err(e, "Could not load folders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setTrail([]); setFolders([]);
    if (projectId) load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const current = trail[trail.length - 1];

  const upload = async () => {
    if (!pdfBlob || !current) return;
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("folderId", current.id);
      form.append("fileName", fileName);
      form.append("file", new File([pdfBlob], fileName, { type: "application/pdf" }));
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-to-forma`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: form,
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error || "Upload failed");
      toast({ title: "Uploaded to Autodesk Forma", description: json.newVersion ? `Added a new version of ${fileName} in ${current.name}.` : `${fileName} was added to ${current.name}.` });
      onClose();
    } catch (e) {
      err(e, "Upload to Autodesk Forma failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CloudProviderLogo provider="forma" className="h-5 w-5" /> Upload to Autodesk Forma</DialogTitle>
          <DialogDescription>{fileName}</DialogDescription>
        </DialogHeader>
        {connected === null ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !connected ? (
          <div className="flex flex-col items-center gap-4 py-6">
            <p className="text-sm text-muted-foreground">Connect your Autodesk account to choose a folder.</p>
            <Button className="gap-2" onClick={() => connect().catch((e) => err(e, "Could not connect Autodesk"))}><CloudProviderLogo provider="forma" /> Connect Autodesk Forma</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Hub</Label>
                <Select value={hubId} onValueChange={setHubId}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{hubs.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Project</Label>
                <Select value={projectId} onValueChange={setProjectId} disabled={!hubId}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {projectId && (
              <div className="rounded-md border border-border">
                <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  <button type="button" className="hover:text-foreground" onClick={() => { setTrail([]); load(null); }}>Project files</button>
                  {trail.map((t, i) => (
                    <span key={t.id} className="flex items-center gap-1"><ChevronRight className="h-3 w-3" />
                      <button type="button" className="hover:text-foreground" onClick={() => { const n = trail.slice(0, i + 1); setTrail(n); load(t); }}>{t.name}</button>
                    </span>
                  ))}
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {loading ? <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                    : folders.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">No subfolders.</p>
                    : folders.map((f) => (
                      <button key={f.id} type="button" onClick={() => { setTrail((t) => [...t, f]); load(f); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                        <Folder className="h-4 w-4 text-muted-foreground" /><span className="flex-1 truncate">{f.name}</span><ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </button>
                    ))}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{current ? `Uploads to: ${current.name}` : "Open a folder to upload into it."}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {connected && <Button onClick={upload} disabled={!current || !pdfBlob || busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Upload</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
