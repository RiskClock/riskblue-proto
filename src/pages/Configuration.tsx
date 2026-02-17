import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { LogOut, Plus, X, Save, RotateCcw, ShieldAlert, Settings, FileText, BarChart3, ExternalLink, AlertTriangle, Loader2, Link2 } from "lucide-react";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { useMitigationControls, getControlNameById } from "@/hooks/useMitigationControls";
import { LogoDropdown } from "@/components/LogoDropdown";
import { ProviderSelectionDialog } from "@/components/ProviderSelectionDialog";
import { format } from "date-fns";

interface AWPItem {
  id: string;
  name: string;
  default_control_ids: string[];
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
}

export default function Configuration() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  useHeapIdentify();
  const { getInitial } = useUserDisplayName();
  const [showProviderDialog, setShowProviderDialog] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showRevertDialog, setShowRevertDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
  const [linkingPrompt, setLinkingPrompt] = useState<string | null>(null);
  const [promptUrls, setPromptUrls] = useState<Map<string, string>>(new Map());
  const [resolvingPrompt, setResolvingPrompt] = useState<string | null>(null);
  const [pullingLatest, setPullingLatest] = useState<string | null>(null);

  const isInternalUser = user?.email?.endsWith("@riskclock.com");

  const { data: awpItems = [], isLoading: awpLoading, refetch: refetchAWPs } = useQuery({
    queryKey: ["configuration-awps"],
    queryFn: async (): Promise<AWPItem[]> => {
      const [assetsRes, systemsRes, processesRes] = await Promise.all([
        supabase.from("critical_assets").select("id, name, default_control_ids").eq("is_active", true).order("display_order"),
        supabase.from("water_systems").select("id, name, default_control_ids").eq("is_active", true).order("display_order"),
        supabase.from("processes").select("id, name, default_control_ids").eq("is_active", true).order("display_order"),
      ]);
      const assets: AWPItem[] = (assetsRes.data || []).map(a => ({ ...a, category: "critical_assets" as const }));
      const systems: AWPItem[] = (systemsRes.data || []).map(s => ({ ...s, category: "water_systems" as const }));
      const processes: AWPItem[] = (processesRes.data || []).map(p => ({ ...p, category: "processes" as const }));
      return [...assets, ...systems, ...processes];
    },
  });

  const { data: controls = [], isLoading: controlsLoading } = useMitigationControls();

  // Fetch prompts
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
      refetchAWPs();
      queryClient.invalidateQueries({ queryKey: ["awp-options"] });
    } catch (error: any) {
      toast({ title: "Error saving changes", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = () => { setPendingChanges(new Map()); setShowRevertDialog(false); };

  // Link a Google Drive doc prompt
  const handleLinkPrompt = async (awpName: string, category: string) => {
    const url = promptUrls.get(awpName);
    if (!url?.trim()) return;
    setResolvingPrompt(awpName);
    try {
      const { data, error } = await supabase.functions.invoke("resolve-drive-doc", {
        body: { fileUrl: url },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Upsert prompt record
      const existing = promptsByName.get(awpName);
      if (existing) {
        await supabase.from("awp_class_prompts").update({
          drive_file_id: data.fileId,
          drive_file_name: data.fileName,
          drive_file_url: url,
          drive_file_modified_at: data.modifiedTime,
          is_stale: false,
        }).eq("id", existing.id);
      } else {
        await supabase.from("awp_class_prompts").insert({
          awp_class_name: awpName,
          category,
          drive_file_id: data.fileId,
          drive_file_name: data.fileName,
          drive_file_url: url,
          drive_file_modified_at: data.modifiedTime,
        });
      }

      // Set up watch notifications (best effort)
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

  // Pull latest content for a stale prompt
  const handlePullLatest = async (prompt: PromptInfo) => {
    setPullingLatest(prompt.awp_class_name);
    try {
      const { data, error } = await supabase.functions.invoke("resolve-drive-doc", {
        body: { fileUrl: prompt.drive_file_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await supabase.from("awp_class_prompts").update({
        drive_file_modified_at: data.modifiedTime,
        drive_file_name: data.fileName,
        is_stale: false,
        content_updated_at: new Date().toISOString(),
      }).eq("id", prompt.id);

      toast({ title: "Prompt updated", description: `Latest metadata pulled for "${data.fileName}"` });
      refetchPrompts();
    } catch (error: any) {
      toast({ title: "Pull failed", description: error.message, variant: "destructive" });
    } finally {
      setPullingLatest(null);
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
          <a
            href={prompt.drive_file_url || `https://docs.google.com/document/d/${prompt.drive_file_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            {prompt.drive_file_name || "Linked Doc"}
            <ExternalLink className="w-3 h-3" />
          </a>
          {prompt.drive_file_modified_at && (
            <span className="text-xs text-muted-foreground">
              {format(new Date(prompt.drive_file_modified_at), "MMM d, yyyy")}
            </span>
          )}
          {prompt.is_stale && (
            <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-300">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Updated
            </Badge>
          )}
          {prompt.is_stale && (
            <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => handlePullLatest(prompt)} disabled={isPulling}>
              {isPulling ? <Loader2 className="w-3 h-3 animate-spin" /> : "Pull Latest"}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setLinkingPrompt(awp.name)}>
            Change
          </Button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <Input
          placeholder="Paste Google Drive doc URL..."
          className="h-7 text-xs max-w-[280px]"
          value={promptUrls.get(awp.name) || ""}
          onChange={(e) => setPromptUrls(prev => { const next = new Map(prev); next.set(awp.name, e.target.value); return next; })}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={!promptUrls.get(awp.name)?.trim() || isResolving}
          onClick={() => handleLinkPrompt(awp.name, awp.category)}
        >
          {isResolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3 mr-1" />}
          Link
        </Button>
        {isEditing && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLinkingPrompt(null)}>
            Cancel
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <LogoDropdown />
          <div className="flex items-center gap-6">
            <button onClick={() => navigate("/projects")} className="text-foreground hover:text-primary">Projects</button>
            <button onClick={() => setShowProviderDialog(true)} className="text-foreground hover:text-primary">Solution Provider Portal</button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Avatar className="cursor-pointer"><AvatarFallback>{getInitial()}</AvatarFallback></Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem className="cursor-pointer"><Settings className="h-4 w-4 mr-2" />Configuration</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/internal/analysis-queue")} className="cursor-pointer"><FileText className="h-4 w-4 mr-2" />Analysis Queue</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/logs")} className="cursor-pointer"><BarChart3 className="h-4 w-4 mr-2" />Logs</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut} className="cursor-pointer"><LogOut className="h-4 w-4 mr-2" />Logout</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">AWP Configuration</h1>
            <p className="text-muted-foreground">Manage default mitigation controls for each AWP class</p>
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
                  <TableHead>Default Mitigation Controls</TableHead>
                  <TableHead className="w-[350px]">Default Prompt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={3} className="font-semibold text-sm py-2">Critical Assets</TableCell>
                </TableRow>
                {groupedAWPs.critical_assets.map((awp) => (
                  <AWPRow key={awp.id} awp={awp} controls={controls} currentIds={getCurrentControlIds(awp)} hasChanges={hasAWPChanges(awp)} pendingChange={pendingChanges.get(awp.id)} onAddControl={handleAddControl} onRemoveControl={handleRemoveControl} promptCell={renderPromptCell(awp)} />
                ))}
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={3} className="font-semibold text-sm py-2">Water Systems</TableCell>
                </TableRow>
                {groupedAWPs.water_systems.map((awp) => (
                  <AWPRow key={awp.id} awp={awp} controls={controls} currentIds={getCurrentControlIds(awp)} hasChanges={hasAWPChanges(awp)} pendingChange={pendingChanges.get(awp.id)} onAddControl={handleAddControl} onRemoveControl={handleRemoveControl} promptCell={renderPromptCell(awp)} />
                ))}
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={3} className="font-semibold text-sm py-2">Processes</TableCell>
                </TableRow>
                {groupedAWPs.processes.map((awp) => (
                  <AWPRow key={awp.id} awp={awp} controls={controls} currentIds={getCurrentControlIds(awp)} hasChanges={hasAWPChanges(awp)} pendingChange={pendingChanges.get(awp.id)} onAddControl={handleAddControl} onRemoveControl={handleRemoveControl} promptCell={renderPromptCell(awp)} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

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

      <ProviderSelectionDialog open={showProviderDialog} onOpenChange={setShowProviderDialog} />
    </div>
  );
}

// AWP Row Component
interface AWPRowProps {
  awp: AWPItem;
  controls: { id: string; name: string; category: string }[];
  currentIds: string[];
  hasChanges: boolean;
  pendingChange?: PendingChange;
  onAddControl: (awp: AWPItem, controlId: string) => void;
  onRemoveControl: (awp: AWPItem, controlId: string) => void;
  promptCell: React.ReactNode;
}

function AWPRow({ awp, controls, currentIds, hasChanges, pendingChange, onAddControl, onRemoveControl, promptCell }: AWPRowProps) {
  return (
    <TableRow className={hasChanges ? "bg-yellow-50/50" : ""}>
      <TableCell className="font-medium py-2">{awp.name}</TableCell>
      <TableCell className="py-2">
        <div className="flex flex-wrap gap-1.5 items-center">
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
          <AddControlPopover awp={awp} controls={controls} currentIds={currentIds} onAdd={onAddControl} />
        </div>
      </TableCell>
      <TableCell className="py-2">{promptCell}</TableCell>
    </TableRow>
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
        <Button variant="outline" size="sm" className="h-6 px-1.5"><Plus className="h-3 w-3" /></Button>
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
