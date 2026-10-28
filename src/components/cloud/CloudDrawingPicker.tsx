import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FileText, Folder, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useProcoreToken } from "@/hooks/useProcoreToken";
import { useAutodeskConnection, callForma } from "@/hooks/useAutodeskConnection";
import { CLOUD_PROVIDER_LABEL, isDrawingFile, type CloudFile, type CloudProvider, type CloudSelection } from "@/lib/cloudImport";
import { CloudProviderLogo } from "./CloudProviderButton";

type Option = { id: string; name: string };
type Listing = { folders: Option[]; files: CloudFile[] };

async function callProcore(action: string, params: Record<string, string>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");
  const q = new URLSearchParams({ action, ...params }).toString();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/list-procore-files?${q}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || "Request failed");
  return json;
}

const procoreListing = (r: any): Listing => ({
  folders: (r?.folders ?? []).filter((f: any) => !f.is_deleted).map((f: any) => ({ id: String(f.id), name: f.name })),
  files: (r?.files ?? []).filter((f: any) => !f.is_deleted).map((f: any) => ({ id: String(f.id), name: f.name, size: f.size ?? f.file_versions?.[0]?.file_size ?? null })),
});

interface Props {
  provider: CloudProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (selection: CloudSelection) => void | Promise<void>;
  confirmLabel?: string;
}

/** Browse a cloud repository and pick drawing files. Only the choice is returned; nothing downloads here. */
export function CloudDrawingPicker({ provider, open, onOpenChange, onConfirm, confirmLabel }: Props) {
  const { toast } = useToast();
  const procore = useProcoreToken();
  const autodesk = useAutodeskConnection();
  const connected = provider === "procore" ? procore.isConnected : !!autodesk.connected;
  const checking = provider === "forma" && autodesk.connected === null;
  const label = CLOUD_PROVIDER_LABEL[provider];

  const [connecting, setConnecting] = useState(false);
  const [containers, setContainers] = useState<Option[]>([]);
  const [containerId, setContainerId] = useState("");
  const [projects, setProjects] = useState<Option[]>([]);
  const [projectId, setProjectId] = useState("");
  const [trail, setTrail] = useState<Option[]>([]);
  const [listing, setListing] = useState<Listing>({ folders: [], files: [] });
  const [loading, setLoading] = useState<"containers" | "projects" | "folder" | null>(null);
  const [picked, setPicked] = useState<Map<string, CloudFile>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  const fail = (e: unknown, what: string) => {
    toast({ title: `Could not load ${what}`, description: (e as any)?.message, variant: "destructive" });
    if ((e as any)?.needsReauth) autodesk.refresh();
  };

  useEffect(() => {
    if (!open || !connected) return;
    setLoading("containers");
    (provider === "procore"
      ? callProcore("list-companies", {}).then((r) => (r.companies ?? []).map((c: any) => ({ id: String(c.id), name: c.name })))
      : callForma<{ hubs: Option[] }>("list-forma-files", { action: "hubs" }).then((r) => r.hubs))
      .then((list: Option[]) => {
        setContainers(list);
        if (list.length === 1) setContainerId(list[0].id);
      })
      .catch((e) => fail(e, provider === "procore" ? "companies" : "hubs"))
      .finally(() => setLoading(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connected, provider]);

  useEffect(() => {
    setProjects([]); setProjectId(""); setTrail([]); setListing({ folders: [], files: [] });
    if (!containerId) return;
    setLoading("projects");
    (provider === "procore"
      ? callProcore("list-projects", { companyId: containerId }).then((r) => (r.projects ?? []).map((p: any) => ({ id: String(p.id), name: p.name })))
      : callForma<{ projects: Option[] }>("list-forma-files", { action: "projects", hubId: containerId }).then((r) => r.projects))
      .then(setProjects)
      .catch((e) => fail(e, "projects"))
      .finally(() => setLoading(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId, provider]);

  const loadFolder = async (folder: Option | null) => {
    setLoading("folder");
    try {
      let next: Listing;
      if (provider === "procore") {
        next = procoreListing(folder
          ? await callProcore("list-subfolder", { companyId: containerId, projectId, folderId: folder.id })
          : await callProcore("list-folders", { companyId: containerId, projectId }));
      } else {
        next = folder
          ? await callForma<Listing>("list-forma-files", { action: "folder", projectId, folderId: folder.id })
          : await callForma<Listing>("list-forma-files", { action: "top-folders", hubId: containerId, projectId });
      }
      setListing({ folders: next.folders, files: next.files.filter((f) => isDrawingFile(f.name)) });
    } catch (e) {
      fail(e, "folder");
    } finally {
      setLoading(null);
    }
  };

  useEffect(() => {
    setTrail([]); setPicked(new Map());
    if (projectId) loadFolder(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const openFolder = (f: Option) => { setTrail((t) => [...t, f]); loadFolder(f); };
  const goTo = (i: number) => {
    const next = trail.slice(0, i + 1);
    setTrail(next);
    loadFolder(next[next.length - 1] ?? null);
  };

  const pathPrefix = useMemo(() => trail.map((t) => t.name).join("/"), [trail]);
  const toggle = (f: CloudFile) => setPicked((m) => {
    const n = new Map(m);
    if (n.has(f.id)) n.delete(f.id); else n.set(f.id, { ...f, path: pathPrefix ? `${pathPrefix}/${f.name}` : f.name });
    return n;
  });
  const allHere = listing.files.length > 0 && listing.files.every((f) => picked.has(f.id));
  const toggleAll = () => setPicked((m) => {
    const n = new Map(m);
    for (const f of listing.files) {
      if (allHere) n.delete(f.id); else n.set(f.id, { ...f, path: pathPrefix ? `${pathPrefix}/${f.name}` : f.name });
    }
    return n;
  });

  const handleConnect = async () => {
    setConnecting(true);
    try {
      if (provider === "procore") await procore.connectProcore(window.location.pathname);
      else await autodesk.connect();
    } catch (e) {
      toast({ title: `Could not connect ${label}`, description: (e as Error).message, variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  };

  const confirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm({
        provider, containerId, projectId,
        projectName: projects.find((p) => p.id === projectId)?.name,
        files: Array.from(picked.values()),
      });
      setPicked(new Map());
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not add drawings", description: (e as any)?.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CloudProviderLogo provider={provider} className="h-5 w-5" /> {label}</DialogTitle>
          <DialogDescription>Choose drawings to import. They copy in the background, so you can close the page once you are done.</DialogDescription>
        </DialogHeader>

        {checking ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !connected ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <CloudProviderLogo provider={provider} className="h-10 w-10" />
            <p className="max-w-sm text-sm text-muted-foreground">Connect your {label} account to browse project files. RiskBlue only reads the files you choose.</p>
            <Button onClick={handleConnect} disabled={connecting} className="gap-2">
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudProviderLogo provider={provider} />}
              Connect {label}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{provider === "procore" ? "Company" : "Hub"}</Label>
                <Select value={containerId} onValueChange={setContainerId} disabled={loading === "containers"}>
                  <SelectTrigger><SelectValue placeholder={loading === "containers" ? "Loading..." : "Select"} /></SelectTrigger>
                  <SelectContent>{containers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Project</Label>
                <Select value={projectId} onValueChange={setProjectId} disabled={!containerId || loading === "projects"}>
                  <SelectTrigger><SelectValue placeholder={loading === "projects" ? "Loading..." : "Select"} /></SelectTrigger>
                  <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {projectId && (
              <div className="rounded-md border border-border">
                <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  <button type="button" className="hover:text-foreground" onClick={() => goTo(-1)}>Project files</button>
                  {trail.map((t, i) => (
                    <span key={t.id} className="flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      <button type="button" className="hover:text-foreground" onClick={() => goTo(i)}>{t.name}</button>
                    </span>
                  ))}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {loading === "folder" ? (
                    <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  ) : (
                    <>
                      {listing.folders.map((f) => (
                        <button key={f.id} type="button" onClick={() => openFolder(f)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                          <Folder className="h-4 w-4 text-muted-foreground" /> <span className="flex-1 truncate">{f.name}</span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </button>
                      ))}
                      {listing.files.length > 0 && (
                        <label className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                          <Checkbox checked={allHere} onCheckedChange={toggleAll} /> Select all drawings in this folder
                        </label>
                      )}
                      {listing.files.map((f) => (
                        <label key={f.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
                          <Checkbox checked={picked.has(f.id)} onCheckedChange={() => toggle(f)} />
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="flex-1 truncate">{f.name}</span>
                        </label>
                      ))}
                      {listing.folders.length === 0 && listing.files.length === 0 && (
                        <p className="px-3 py-6 text-center text-sm text-muted-foreground">No drawings in this folder.</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {connected && (
            <Button onClick={confirm} disabled={picked.size === 0 || submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmLabel ?? "Add"} {picked.size > 0 ? `${picked.size} drawing${picked.size === 1 ? "" : "s"}` : "drawings"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
