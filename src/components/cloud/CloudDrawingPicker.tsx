import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronRight, FileText, Folder, Loader2, RefreshCw } from "lucide-react";
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
  const checking = provider === "forma" ? autodesk.connected === null : procore.loading && !procore.isConnected;
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
  const [hubResult, setHubResult] = useState<{ outcome: "success" | "error"; count: number; checkedAt: string; message?: string } | null>(null);
  const [reload, setReload] = useState(0);

  const fail = (e: unknown, what: string) => {
    toast({ title: `Could not load ${what}`, description: (e as any)?.message, variant: "destructive" });
    if ((e as any)?.needsReauth) autodesk.refresh();
  };

  useEffect(() => {
    if (!open || !connected) return;
    let active = true;
    setContainers([]); setContainerId(""); setPicked(new Map()); setHubResult(null);
    setLoading("containers");
    (provider === "procore"
      ? callProcore("list-companies", {}).then((r) => (r.companies ?? []).map((c: any) => ({ id: String(c.id), name: c.name })))
      : callForma<{ hubs: Option[] }>("list-forma-files", { action: "hubs" }).then((r) => r.hubs))
      .then((list: Option[]) => {
        if (!active) return;
        setContainers(list);
        if (provider === "forma") setHubResult({ outcome: "success", count: list.length, checkedAt: new Date().toISOString() });
        if (list.length === 1) setContainerId(list[0].id);
      })
      .catch((e) => {
        if (!active) return;
        if (provider === "forma") setHubResult({ outcome: "error", count: 0, checkedAt: new Date().toISOString(), message: (e as any)?.message || "Request failed" });
        fail(e, provider === "procore" ? "companies" : "hubs");
      })
      .finally(() => { if (active) setLoading(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connected, provider, reload]);

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
      <DialogContent className="w-[calc(100%-2rem)] max-w-2xl max-h-[calc(100dvh-2rem)] min-w-0 overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CloudProviderLogo provider={provider} className="h-5 w-5" /> {label}</DialogTitle>
          <DialogDescription>Choose drawings to import.</DialogDescription>
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
          <div className="min-w-0 space-y-4">
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label>{provider === "procore" ? "Company" : "Hub"}</Label>
                <Select value={containerId} onValueChange={setContainerId} disabled={loading === "containers"}>
                  <SelectTrigger aria-label={provider === "procore" ? "Company" : "Hub"} className="min-w-0 [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0"><SelectValue placeholder={loading === "containers" ? "Loading..." : "Select"} /></SelectTrigger>
                  <SelectContent className="max-w-[calc(100vw-2rem)]">{containers.map((c) => <SelectItem key={c.id} value={c.id}><span className="block truncate">{c.name}</span></SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label>Project</Label>
                <Select value={projectId} onValueChange={setProjectId} disabled={!containerId || loading === "projects"}>
                  <SelectTrigger aria-label="Project" className="min-w-0 [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0"><SelectValue placeholder={loading === "projects" ? "Loading..." : "Select"} /></SelectTrigger>
                  <SelectContent className="max-w-[calc(100vw-2rem)]">{projects.map((p) => <SelectItem key={p.id} value={p.id}><span className="block truncate">{p.name}</span></SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {provider === "forma" && hubResult && (hubResult.outcome === "error" || hubResult.count === 0) && (
              <section className="min-w-0 space-y-3 rounded-md border border-border bg-muted/40 p-4" aria-live="polite">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><AlertCircle className="h-4 w-4 shrink-0" />{hubResult.outcome === "error" ? "Could not load Autodesk hubs" : "No Autodesk hubs available"}</h3>
                <p className="text-sm text-muted-foreground">{hubResult.outcome === "error" ? "The hub request failed. Review the details below and try again." : "Autodesk returned no hubs accessible to this connection. This can be caused by account permissions or missing integration access."}</p>
                <ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground">
                  <li>Confirm you connected the Autodesk account that has access to the project's Docs files.</li>
                  <li>Ask your Autodesk account administrator to check RiskBlue's integration access in account administration, not project settings. Depending on the account, this appears under Custom Integrations or Apps.</li>
                  <li>If that section is missing, your administrator may need to confirm the account's API access with Autodesk.</li>
                </ul>
                <details className="min-w-0 text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-foreground">Diagnostic details</summary>
                  <dl className="mt-2 space-y-1 break-words">
                    <div><dt className="inline font-medium">Request: </dt><dd className="inline">Autodesk Data Management: list hubs</dd></div>
                    <div><dt className="inline font-medium">Result: </dt><dd className="inline">{hubResult.outcome === "success" ? `Successful response, ${hubResult.count} hubs returned` : "Request failed"}</dd></div>
                    <div><dt className="inline font-medium">Checked at (UTC): </dt><dd className="inline">{hubResult.checkedAt}</dd></div>
                    {hubResult.message && <div><dt className="inline font-medium">Error: </dt><dd className="inline">{hubResult.message}</dd></div>}
                  </dl>
                </details>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setReload((n) => n + 1)}><RefreshCw className="h-4 w-4" />Retry hubs</Button>
              </section>
            )}

            {projectId && (
              <div className="min-w-0 overflow-hidden rounded-md border border-border">
                <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  <Button type="button" variant="link" className="h-auto p-0 text-xs text-muted-foreground" onClick={() => goTo(-1)}>Project files</Button>
                  {trail.map((t, i) => (
                    <span key={t.id} className="flex min-w-0 items-center gap-1">
                      <ChevronRight className="h-3 w-3 shrink-0" />
                      <Button type="button" variant="link" className="h-auto min-w-0 whitespace-normal break-words p-0 text-left text-xs text-muted-foreground" onClick={() => goTo(i)}>{t.name}</Button>
                    </span>
                  ))}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {loading === "folder" ? (
                    <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  ) : (
                    <>
                      {listing.folders.map((f) => (
                        <Button key={f.id} type="button" variant="ghost" onClick={() => openFolder(f)} className="flex h-auto w-full min-w-0 justify-start gap-2 rounded-none px-3 py-2 text-left text-sm font-normal">
                          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" /> <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </Button>
                      ))}
                      {listing.files.length > 0 && (
                        <label className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                          <Checkbox checked={allHere} onCheckedChange={toggleAll} /> Select all drawings in this folder
                        </label>
                      )}
                      {listing.files.map((f) => (
                        <label key={f.id} className="flex min-w-0 cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
                          <Checkbox className="shrink-0" checked={picked.has(f.id)} onCheckedChange={() => toggle(f)} />
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
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

        <DialogFooter className="min-w-0 gap-2 sm:gap-0">
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
