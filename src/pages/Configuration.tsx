import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AppHeader } from "@/components/AppHeader";
import { Plus, X, Save, RotateCcw, ShieldAlert, ExternalLink, AlertTriangle, Loader2, Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";
import { useMitigationControls, getControlNameById } from "@/hooks/useMitigationControls";
import { format } from "date-fns";

interface AWPItem {
  id: string;
  name: string;
  default_control_ids: string[];
  can_span_multiple_spaces: boolean;
  category: "critical_assets" | "water_systems" | "processes";
}

interface PendingChange {
  original: string[];
  current: string[];
}

interface PromptInfo {
  id: string;
  awp_class_name: string;
  category: string;
  drive_file_id: string | null;
  drive_file_name: string | null;
  drive_file_url: string | null;
  drive_file_modified_at: string | null;
  is_stale: boolean;
  prompt_content: string | null;
  content_updated_at: string | null;
  triage_drive_file_id: string | null;
  triage_drive_file_name: string | null;
  triage_drive_file_url: string | null;
  triage_drive_file_modified_at: string | null;
  triage_is_stale: boolean;
  triage_prompt_content: string | null;
  triage_content_updated_at: string | null;
}

export default function Configuration() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  useHeapIdentify();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showRevertDialog, setShowRevertDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
  const [linkingPrompt, setLinkingPrompt] = useState<string | null>(null);
  const [promptUrls, setPromptUrls] = useState<Map<string, string>>(new Map());
  const [resolvingPrompt, setResolvingPrompt] = useState<string | null>(null);
  const [pullingLatest, setPullingLatest] = useState<string | null>(null);

  // Triage prompt state
  const [linkingTriagePrompt, setLinkingTriagePrompt] = useState<string | null>(null);
  const [triagePromptUrls, setTriagePromptUrls] = useState<Map<string, string>>(new Map());
  const [resolvingTriagePrompt, setResolvingTriagePrompt] = useState<string | null>(null);
  const [pullingTriageLatest, setPullingTriageLatest] = useState<string | null>(null);

  // Control edit modal state
  const [editingControlsAwp, setEditingControlsAwp] = useState<AWPItem | null>(null);

  const isInternalUser = user?.email?.endsWith("@riskclock.com");

  const { data: awpItems = [], isLoading: awpLoading, refetch: refetchAWPs } = useQuery({
    queryKey: ["configuration-awps"],
    queryFn: async (): Promise<AWPItem[]> => {
      const [assetsRes, systemsRes, processesRes] = await Promise.all([
        supabase.from("critical_assets").select("id, name, default_control_ids, can_span_multiple_spaces" as any).eq("is_active", true).order("display_order"),
        supabase.from("water_systems").select("id, name, default_control_ids, can_span_multiple_spaces" as any).eq("is_active", true).order("display_order"),
        supabase.from("processes").select("id, name, default_control_ids, can_span_multiple_spaces" as any).eq("is_active", true).order("display_order"),
      ]);
      const toItem = (cat: AWPItem["category"]) => (r: any): AWPItem => ({
        id: r.id,
        name: r.name,
        default_control_ids: (r.default_control_ids as string[]) || [],
        can_span_multiple_spaces: !!r.can_span_multiple_spaces,
        category: cat,
      });
      const assets: AWPItem[] = ((assetsRes.data as any[]) || []).map(toItem("critical_assets"));
      const systems: AWPItem[] = ((systemsRes.data as any[]) || []).map(toItem("water_systems"));
      const processes: AWPItem[] = ((processesRes.data as any[]) || []).map(toItem("processes"));
      return [...assets, ...systems, ...processes];
    },
  });

  const { data: controls = [], isLoading: controlsLoading } = useMitigationControls();

  const { data: prompts = [], refetch: refetchPrompts } = useQuery({
    queryKey: ["awp-class-prompts"],
    queryFn: async (): Promise<PromptInfo[]> => {
      const { data, error } = await supabase
        .from("awp_class_prompts")
        .select("*");
      if (error) throw error;
      return (data || []) as PromptInfo[];
    },
  });

  const promptsByName = useMemo(() => {
    const map = new Map<string, PromptInfo>();
    prompts.forEach(p => map.set(p.awp_class_name, p));
    return map;
  }, [prompts]);

  const groupedAWPs = useMemo(() => ({
    critical_assets: awpItems.filter(a => a.category === "critical_assets"),
    water_systems: awpItems.filter(a => a.category === "water_systems"),
    processes: awpItems.filter(a => a.category === "processes"),
  }), [awpItems]);

  const getCurrentControlIds = (awp: AWPItem): string[] => {
    const change = pendingChanges.get(awp.id);
    if (!change) {
      return [...awp.default_control_ids].sort((a, b) => {
        const nameA = getControlNameById(controls, a) || a;
        const nameB = getControlNameById(controls, b) || b;
        return nameA.localeCompare(nameB);
      });
    }
    const originalSorted = [...change.original].sort((a, b) => {
      const nameA = getControlNameById(controls, a) || a;
      const nameB = getControlNameById(controls, b) || b;
      return nameA.localeCompare(nameB);
    });
    const newlyAdded = change.current.filter(id => !change.original.includes(id));
    const remaining = originalSorted.filter(id => change.current.includes(id));
    return [...remaining, ...newlyAdded];
  };

  const hasUnsavedChanges = useMemo(() => {
    for (const [, change] of pendingChanges) {
      if (JSON.stringify([...change.original].sort()) !== JSON.stringify([...change.current].sort())) return true;
    }
    return false;
  }, [pendingChanges]);

  const handleAddControl = (awp: AWPItem, controlId: string) => {
    const current = pendingChanges.get(awp.id)?.current ?? awp.default_control_ids;
    if (current.includes(controlId)) return;
    const original = pendingChanges.get(awp.id)?.original ?? awp.default_control_ids;
    setPendingChanges(prev => { const next = new Map(prev); next.set(awp.id, { original, current: [...current, controlId] }); return next; });
  };

  const handleRemoveControl = (awp: AWPItem, controlId: string) => {
    const current = pendingChanges.get(awp.id)?.current ?? awp.default_control_ids;
    const original = pendingChanges.get(awp.id)?.original ?? awp.default_control_ids;
    setPendingChanges(prev => { const next = new Map(prev); next.set(awp.id, { original, current: current.filter(id => id !== controlId) }); return next; });
  };

  const changeSummary = useMemo(() => {
    const summary: { category: string; awpName: string; added: string[]; removed: string[] }[] = [];
    for (const [awpId, change] of pendingChanges) {
      const awp = awpItems.find(a => a.id === awpId);
      if (!awp) continue;
      const added = change.current.filter(id => !change.original.includes(id));
      const removed = change.original.filter(id => !change.current.includes(id));
      if (added.length > 0 || removed.length > 0) {
        const categoryLabel = awp.category === "critical_assets" ? "Critical Assets" : awp.category === "water_systems" ? "Water Systems" : "Processes";
        summary.push({ category: categoryLabel, awpName: awp.name, added: added.map(id => getControlNameById(controls, id) || id), removed: removed.map(id => getControlNameById(controls, id) || id) });
      }
    }
    return summary;
  }, [pendingChanges, awpItems, controls]);

  const handleSave = async () => {
    setSaving(true);
    try {
      let updatedCount = 0;
      for (const [awpId, change] of pendingChanges) {
        const awp = awpItems.find(a => a.id === awpId);
        if (!awp) continue;
        if (JSON.stringify([...change.original].sort()) === JSON.stringify([...change.current].sort())) continue;
        const { data, error } = await supabase.from(awp.category).update({ default_control_ids: change.current }).eq("id", awpId).select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("Not authorized to update AWP configuration.");
        updatedCount++;
      }
      if (updatedCount === 0) {
        toast({ title: "No changes to save", description: "All configurations are already up to date." });
      } else {
        toast({ title: "Changes saved", description: "AWP configurations have been updated." });
      }
      setPendingChanges(new Map());
      setShowSaveDialog(false);
      setEditingControlsAwp(null);
      refetchAWPs();
      queryClient.invalidateQueries({ queryKey: ["awp-options"] });
    } catch (error: any) {
      toast({ title: "Error saving changes", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = () => { setPendingChanges(new Map()); setShowRevertDialog(false); };

  // Link a Google Drive doc prompt (default)
  const handleLinkPrompt = async (awpName: string, category: string) => {
    const url = promptUrls.get(awpName);
    if (!url?.trim()) return;
    setResolvingPrompt(awpName);
    try {
      const { data, error } = await supabase.functions.invoke("resolve-drive-doc", {
        body: { fileUrl: url, exportContent: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const existing = promptsByName.get(awpName);
      if (existing) {
        await supabase.from("awp_class_prompts").update({
          drive_file_id: data.fileId,
          drive_file_name: data.fileName,
          drive_file_url: url,
          drive_file_modified_at: data.modifiedTime,
          is_stale: false,
          prompt_content: data.content || null,
          content_updated_at: new Date().toISOString(),
        } as any).eq("id", existing.id);
      } else {
        await supabase.from("awp_class_prompts").insert({
          awp_class_name: awpName,
          category,
          drive_file_id: data.fileId,
          drive_file_name: data.fileName,
          drive_file_url: url,
          drive_file_modified_at: data.modifiedTime,
          prompt_content: data.content || null,
          content_updated_at: new Date().toISOString(),
        } as any);
      }

      try {
        await supabase.functions.invoke("watch-drive-doc", { body: { fileId: data.fileId } });
      } catch (e) {
        console.warn("Watch setup failed (non-critical):", e);
      }

      toast({ title: "Prompt linked", description: `"${data.fileName}" linked to ${awpName}` });
      setLinkingPrompt(null);
      setPromptUrls(prev => { const next = new Map(prev); next.delete(awpName); return next; });
      refetchPrompts();
    } catch (error: any) {
      toast({ title: "Failed to link prompt", description: error.message, variant: "destructive" });
    } finally {
      setResolvingPrompt(null);
    }
  };

  const handlePullLatest = async (prompt: PromptInfo) => {
    setPullingLatest(prompt.awp_class_name);
    try {
      const { data, error } = await supabase.functions.invoke("resolve-drive-doc", {
        body: { fileUrl: prompt.drive_file_id, exportContent: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await supabase.from("awp_class_prompts").update({
        drive_file_modified_at: data.modifiedTime,
        drive_file_name: data.fileName,
        is_stale: false,
        content_updated_at: new Date().toISOString(),
        prompt_content: data.content || null,
      } as any).eq("id", prompt.id);

      toast({ title: "Prompt updated", description: `Latest metadata pulled for "${data.fileName}"` });
      refetchPrompts();
    } catch (error: any) {
      toast({ title: "Pull failed", description: error.message, variant: "destructive" });
    } finally {
      setPullingLatest(null);
    }
  };

  // Link a Google Drive doc for triaging prompt
  const handleLinkTriagePrompt = async (awpName: string, category: string) => {
    const url = triagePromptUrls.get(awpName);
    if (!url?.trim()) return;
    setResolvingTriagePrompt(awpName);
    try {
      const { data, error } = await supabase.functions.invoke("resolve-drive-doc", {
        body: { fileUrl: url, exportContent: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const existing = promptsByName.get(awpName);
      if (existing) {
        await supabase.from("awp_class_prompts").update({
          triage_drive_file_id: data.fileId,
          triage_drive_file_name: data.fileName,
          triage_drive_file_url: url,
          triage_drive_file_modified_at: data.modifiedTime,
          triage_is_stale: false,
          triage_prompt_content: data.content || null,
          triage_content_updated_at: new Date().toISOString(),
        } as any).eq("id", existing.id);
      } else {
        await supabase.from("awp_class_prompts").insert({
          awp_class_name: awpName,
          category,
          triage_drive_file_id: data.fileId,
          triage_drive_file_name: data.fileName,
          triage_drive_file_url: url,
          triage_drive_file_modified_at: data.modifiedTime,
          triage_prompt_content: data.content || null,
          triage_content_updated_at: new Date().toISOString(),
        } as any);
      }

      try {
        await supabase.functions.invoke("watch-drive-doc", { body: { fileId: data.fileId } });
      } catch (e) {
        console.warn("Watch setup failed (non-critical):", e);
      }

      toast({ title: "Triage prompt linked", description: `"${data.fileName}" linked to ${awpName}` });
      setLinkingTriagePrompt(null);
      setTriagePromptUrls(prev => { const next = new Map(prev); next.delete(awpName); return next; });
      refetchPrompts();
    } catch (error: any) {
      toast({ title: "Failed to link triage prompt", description: error.message, variant: "destructive" });
    } finally {
      setResolvingTriagePrompt(null);
    }
  };

  const handlePullTriageLatest = async (prompt: PromptInfo) => {
    setPullingTriageLatest(prompt.awp_class_name);
    try {
      const { data, error } = await supabase.functions.invoke("resolve-drive-doc", {
        body: { fileUrl: prompt.triage_drive_file_id, exportContent: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await supabase.from("awp_class_prompts").update({
        triage_drive_file_modified_at: data.modifiedTime,
        triage_drive_file_name: data.fileName,
        triage_is_stale: false,
        triage_content_updated_at: new Date().toISOString(),
        triage_prompt_content: data.content || null,
      } as any).eq("id", prompt.id);

      toast({ title: "Triage prompt updated", description: `Latest metadata pulled for "${data.fileName}"` });
      refetchPrompts();
    } catch (error: any) {
      toast({ title: "Pull failed", description: error.message, variant: "destructive" });
    } finally {
      setPullingTriageLatest(null);
    }
  };

  if (!isInternalUser) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <ShieldAlert className="h-16 w-16 text-destructive mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">403 - Access Denied</h1>
          <p className="text-muted-foreground">You don't have permission to access this page.</p>
          <Button onClick={() => navigate("/projects")}>Go to Projects</Button>
        </div>
      </div>
    );
  }

  const loading = awpLoading || controlsLoading;

  const hasAWPChanges = (awp: AWPItem): boolean => {
    const change = pendingChanges.get(awp.id);
    return change ? JSON.stringify([...change.original].sort()) !== JSON.stringify([...change.current].sort()) : false;
  };

  const renderPromptCell = (awp: AWPItem) => {
    const prompt = promptsByName.get(awp.name);
    const isEditing = linkingPrompt === awp.name;
    const isResolving = resolvingPrompt === awp.name;
    const isPulling = pullingLatest === awp.name;

    if (prompt?.drive_file_id && !isEditing) {
      return (
        <div className="flex items-center gap-2 flex-wrap">
          <a href={prompt.drive_file_url || `https://docs.google.com/document/d/${prompt.drive_file_id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
            {prompt.drive_file_name || "Linked Doc"}<ExternalLink className="w-3 h-3" />
          </a>
          {prompt.drive_file_modified_at && (
            <span className="text-xs text-muted-foreground">{format(new Date(prompt.drive_file_modified_at), "MMM d, yyyy")}</span>
          )}
          {prompt.is_stale && (
            <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">
              <AlertTriangle className="w-3 h-3 mr-1" />Updated
            </Badge>
          )}
          <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => handlePullLatest(prompt)} disabled={isPulling}>
            {isPulling ? <Loader2 className="w-3 h-3 animate-spin" /> : "Pull Latest"}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setLinkingPrompt(awp.name)}>Change</Button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <Input placeholder="Paste Google Drive doc URL..." className="h-7 text-xs max-w-[280px]" value={promptUrls.get(awp.name) || ""} onChange={(e) => setPromptUrls(prev => { const next = new Map(prev); next.set(awp.name, e.target.value); return next; })} />
        <Button variant="outline" size="sm" className="h-7 text-xs" disabled={!promptUrls.get(awp.name)?.trim() || isResolving} onClick={() => handleLinkPrompt(awp.name, awp.category)}>
          {isResolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3 mr-1" />}Link
        </Button>
        {isEditing && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLinkingPrompt(null)}>Cancel</Button>}
      </div>
    );
  };

  const renderTriagePromptCell = (awp: AWPItem) => {
    const prompt = promptsByName.get(awp.name);
    const isEditing = linkingTriagePrompt === awp.name;
    const isResolving = resolvingTriagePrompt === awp.name;
    const isPulling = pullingTriageLatest === awp.name;

    if (prompt?.triage_drive_file_id && !isEditing) {
      return (
        <div className="flex items-center gap-2 flex-wrap">
          <a href={prompt.triage_drive_file_url || `https://docs.google.com/document/d/${prompt.triage_drive_file_id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
            {prompt.triage_drive_file_name || "Linked Doc"}<ExternalLink className="w-3 h-3" />
          </a>
          {prompt.triage_drive_file_modified_at && (
            <span className="text-xs text-muted-foreground">{format(new Date(prompt.triage_drive_file_modified_at), "MMM d, yyyy")}</span>
          )}
          {prompt.triage_is_stale && (
            <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">
              <AlertTriangle className="w-3 h-3 mr-1" />Updated
            </Badge>
          )}
          <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => handlePullTriageLatest(prompt)} disabled={isPulling}>
            {isPulling ? <Loader2 className="w-3 h-3 animate-spin" /> : "Pull Latest"}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setLinkingTriagePrompt(awp.name)}>Change</Button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <Input placeholder="Paste Google Drive doc URL..." className="h-7 text-xs max-w-[280px]" value={triagePromptUrls.get(awp.name) || ""} onChange={(e) => setTriagePromptUrls(prev => { const next = new Map(prev); next.set(awp.name, e.target.value); return next; })} />
        <Button variant="outline" size="sm" className="h-7 text-xs" disabled={!triagePromptUrls.get(awp.name)?.trim() || isResolving} onClick={() => handleLinkTriagePrompt(awp.name, awp.category)}>
          {isResolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3 mr-1" />}Link
        </Button>
        {isEditing && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLinkingTriagePrompt(null)}>Cancel</Button>}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">App Configuration</h1>
            <p className="text-muted-foreground">Manage default mitigation controls, prompts, and agent settings</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setShowRevertDialog(true)} disabled={!hasUnsavedChanges}>
              <RotateCcw className="h-4 w-4 mr-2" />Revert Changes
            </Button>
            <Button onClick={() => setShowSaveDialog(true)} disabled={!hasUnsavedChanges}>
              <Save className="h-4 w-4 mr-2" />Save Changes
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : (
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">AWP Class</TableHead>
                  <TableHead className="w-[180px]">Default Mitigation Controls</TableHead>
                  <TableHead className="w-[350px]">Triaging Prompt</TableHead>
                  <TableHead className="w-[350px]">Full Prompt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={4} className="font-semibold text-sm py-2">Critical Assets</TableCell>
                </TableRow>
                {groupedAWPs.critical_assets.map((awp) => (
                  <AWPRow key={awp.id} awp={awp} controls={controls} currentIds={getCurrentControlIds(awp)} hasChanges={hasAWPChanges(awp)} onEditControls={() => setEditingControlsAwp(awp)} triagePromptCell={renderTriagePromptCell(awp)} promptCell={renderPromptCell(awp)} />
                ))}
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={4} className="font-semibold text-sm py-2">Water Systems</TableCell>
                </TableRow>
                {groupedAWPs.water_systems.map((awp) => (
                  <AWPRow key={awp.id} awp={awp} controls={controls} currentIds={getCurrentControlIds(awp)} hasChanges={hasAWPChanges(awp)} onEditControls={() => setEditingControlsAwp(awp)} triagePromptCell={renderTriagePromptCell(awp)} promptCell={renderPromptCell(awp)} />
                ))}
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={4} className="font-semibold text-sm py-2">Processes</TableCell>
                </TableRow>
                {groupedAWPs.processes.map((awp) => (
                  <AWPRow key={awp.id} awp={awp} controls={controls} currentIds={getCurrentControlIds(awp)} hasChanges={hasAWPChanges(awp)} onEditControls={() => setEditingControlsAwp(awp)} triagePromptCell={renderTriagePromptCell(awp)} promptCell={renderPromptCell(awp)} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <SpaceHierarchyPromptSection />
      </main>

      {/* Control Edit Modal */}
      {editingControlsAwp && (
        <ControlEditModal
          awp={editingControlsAwp}
          controls={controls}
          currentIds={getCurrentControlIds(editingControlsAwp)}
          pendingChange={pendingChanges.get(editingControlsAwp.id)}
          onAddControl={handleAddControl}
          onRemoveControl={handleRemoveControl}
          onClose={() => setEditingControlsAwp(null)}
        />
      )}

      <AlertDialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <AlertDialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle>Save Changes</AlertDialogTitle>
            <AlertDialogDescription>The following changes will be applied:</AlertDialogDescription>
          </AlertDialogHeader>
          <ScrollArea className="flex-1 max-h-[50vh] pr-4">
            <div className="space-y-4">
              {changeSummary.map((item, idx) => (
                <div key={idx} className="border rounded-lg p-3">
                  <p className="font-medium text-foreground">{item.category}: {item.awpName}</p>
                  {item.added.length > 0 && <p className="text-sm text-green-600">+ {item.added.join(", ")}</p>}
                  {item.removed.length > 0 && <p className="text-sm text-destructive">- {item.removed.join(", ")}</p>}
                </div>
              ))}
            </div>
          </ScrollArea>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Confirm"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showRevertDialog} onOpenChange={setShowRevertDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Changes</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to discard all unsaved changes?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevert}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// AWP Row Component
interface AWPRowProps {
  awp: AWPItem;
  controls: { id: string; name: string; category: string }[];
  currentIds: string[];
  hasChanges: boolean;
  onEditControls: () => void;
  triagePromptCell: React.ReactNode;
  promptCell: React.ReactNode;
}

function AWPRow({ awp, controls, currentIds, hasChanges, onEditControls, triagePromptCell, promptCell }: AWPRowProps) {
  const count = currentIds.length;
  return (
    <TableRow className={hasChanges ? "bg-yellow-50/50" : ""}>
      <TableCell className="font-medium py-2">{awp.name}</TableCell>
      <TableCell className="py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{count} control{count !== 1 ? "s" : ""}</span>
          <Button variant="outline" size="sm" className="h-6 text-xs" onClick={onEditControls}>Edit</Button>
        </div>
      </TableCell>
      <TableCell className="py-2">{triagePromptCell}</TableCell>
      <TableCell className="py-2">{promptCell}</TableCell>
    </TableRow>
  );
}

// Control Edit Modal
interface ControlEditModalProps {
  awp: AWPItem;
  controls: { id: string; name: string; category: string }[];
  currentIds: string[];
  pendingChange?: PendingChange;
  onAddControl: (awp: AWPItem, controlId: string) => void;
  onRemoveControl: (awp: AWPItem, controlId: string) => void;
  onClose: () => void;
}

function ControlEditModal({ awp, controls, currentIds, pendingChange, onAddControl, onRemoveControl, onClose }: ControlEditModalProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Controls — {awp.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {currentIds.map((controlId) => {
              const controlName = getControlNameById(controls, controlId);
              const isNew = pendingChange && !pendingChange.original.includes(controlId);
              return (
                <Badge key={controlId} variant="secondary" className={`flex items-center gap-1 text-xs ${isNew ? "border-green-500 bg-green-50" : ""}`}>
                  {controlName || controlId}
                  <button onClick={() => onRemoveControl(awp, controlId)} className="ml-0.5 hover:text-destructive"><X className="h-3 w-3" /></button>
                </Badge>
              );
            })}
          </div>
          <AddControlPopover awp={awp} controls={controls} currentIds={currentIds} onAdd={onAddControl} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Add Control Popover
interface AddControlPopoverProps {
  awp: AWPItem;
  controls: { id: string; name: string; category: string }[];
  currentIds: string[];
  onAdd: (awp: AWPItem, controlId: string) => void;
}

function AddControlPopover({ awp, controls, currentIds, onAdd }: AddControlPopoverProps) {
  const [open, setOpen] = useState(false);
  const availableControls = controls.filter(c => !currentIds.includes(c.id));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7"><Plus className="h-3 w-3 mr-1" />Add Control</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search controls..." />
          <CommandList>
            <CommandEmpty>No controls found.</CommandEmpty>
            <CommandGroup>
              {availableControls.map((control) => (
                <CommandItem key={control.id} value={control.name} onSelect={() => { onAdd(awp, control.id); setOpen(false); }}>{control.name}</CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------- Space Hierarchy Prompt ----------------
function SpaceHierarchyPromptSection() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const loadPrompt = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("app_settings" as any)
        .select("value, updated_at")
        .eq("key", "space_hierarchy_prompt")
        .maybeSingle();
      if (error) throw error;
      setContent((data as any)?.value ?? "");
      setUpdatedAt((data as any)?.updated_at ?? null);
    } catch (e: any) {
      toast({ title: "Failed to load prompt", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const openModal = async () => {
    setOpen(true);
    await loadPrompt();
  };

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("app_settings" as any)
        .upsert({ key: "space_hierarchy_prompt", value: content, updated_at: new Date().toISOString() } as any, { onConflict: "key" });
      if (error) throw error;
      toast({ title: "Prompt saved", description: "Build Space Hierarchy will use the updated prompt next run." });
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-8 bg-card rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Space Hierarchy Prompt</h2>
          <p className="text-sm text-muted-foreground">
            Prompt sent to the Build Space Hierarchy agent. Extracted drawing text is appended after the prompt.
          </p>
        </div>
        <Button variant="outline" onClick={openModal}>Edit Prompt</Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Space Hierarchy Prompt</DialogTitle>
            <DialogDescription>
              {updatedAt
                ? `Last updated ${format(new Date(updatedAt), "MMM d, yyyy 'at' h:mm a")}`
                : "Edit and save the prompt used by Build Space Hierarchy."}
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          ) : (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="font-mono text-xs flex-1 min-h-[400px]"
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
