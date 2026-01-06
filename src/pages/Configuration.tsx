import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LogOut, Plus, X, Save, RotateCcw, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMitigationControls, getControlNameById } from "@/hooks/useMitigationControls";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";
import { ProviderSelectionDialog } from "@/components/ProviderSelectionDialog";

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

export default function Configuration() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showProviderDialog, setShowProviderDialog] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showRevertDialog, setShowRevertDialog] = useState(false);
  const [saving, setSaving] = useState(false);

  // Track changes: AWP id -> { original, current }
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());

  const isInternalUser = user?.email?.endsWith("@riskclock.com");

  // Fetch all AWPs
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

  // Group AWPs by category
  const groupedAWPs = useMemo(() => {
    return {
      critical_assets: awpItems.filter(a => a.category === "critical_assets"),
      water_systems: awpItems.filter(a => a.category === "water_systems"),
      processes: awpItems.filter(a => a.category === "processes"),
    };
  }, [awpItems]);

  // Get current control IDs for an AWP (with pending changes applied)
  const getCurrentControlIds = (awp: AWPItem): string[] => {
    const change = pendingChanges.get(awp.id);
    return change ? change.current : awp.default_control_ids;
  };

  // Check if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    for (const [, change] of pendingChanges) {
      if (JSON.stringify(change.original.sort()) !== JSON.stringify(change.current.sort())) {
        return true;
      }
    }
    return false;
  }, [pendingChanges]);

  // Add control to AWP
  const handleAddControl = (awp: AWPItem, controlId: string) => {
    const current = getCurrentControlIds(awp);
    if (current.includes(controlId)) return;

    const original = pendingChanges.get(awp.id)?.original ?? awp.default_control_ids;
    setPendingChanges(prev => {
      const next = new Map(prev);
      next.set(awp.id, { original, current: [...current, controlId] });
      return next;
    });
  };

  // Remove control from AWP
  const handleRemoveControl = (awp: AWPItem, controlId: string) => {
    const current = getCurrentControlIds(awp);
    const original = pendingChanges.get(awp.id)?.original ?? awp.default_control_ids;
    setPendingChanges(prev => {
      const next = new Map(prev);
      next.set(awp.id, { original, current: current.filter(id => id !== controlId) });
      return next;
    });
  };

  // Compute change summary for save dialog
  const changeSummary = useMemo(() => {
    const summary: { category: string; awpName: string; added: string[]; removed: string[] }[] = [];

    for (const [awpId, change] of pendingChanges) {
      const awp = awpItems.find(a => a.id === awpId);
      if (!awp) continue;

      const added = change.current.filter(id => !change.original.includes(id));
      const removed = change.original.filter(id => !change.current.includes(id));

      if (added.length > 0 || removed.length > 0) {
        const categoryLabel = awp.category === "critical_assets" ? "Critical Assets" 
          : awp.category === "water_systems" ? "Water Systems" 
          : "Processes";
        
        summary.push({
          category: categoryLabel,
          awpName: awp.name,
          added: added.map(id => getControlNameById(controls, id) || id),
          removed: removed.map(id => getControlNameById(controls, id) || id),
        });
      }
    }

    return summary;
  }, [pendingChanges, awpItems, controls]);

  // Save changes to database
  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [awpId, change] of pendingChanges) {
        const awp = awpItems.find(a => a.id === awpId);
        if (!awp) continue;

        if (JSON.stringify(change.original.sort()) === JSON.stringify(change.current.sort())) {
          continue;
        }

        const { error } = await supabase
          .from(awp.category)
          .update({ default_control_ids: change.current })
          .eq("id", awpId);

        if (error) throw error;
      }

      toast({ title: "Changes saved", description: "AWP configurations have been updated." });
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

  // Revert all changes
  const handleRevert = () => {
    setPendingChanges(new Map());
    setShowRevertDialog(false);
  };

  // Access control
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

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <img src={riskBlueLogo} alt="RiskBlue" className="h-8 cursor-pointer" onClick={() => navigate("/projects")} />
          <div className="flex items-center gap-6">
            <button onClick={() => navigate("/projects")} className="text-foreground hover:text-primary">
              Projects
            </button>
            <button className="text-primary font-medium">Configuration</button>
            <button onClick={() => setShowProviderDialog(true)} className="text-foreground hover:text-primary">
              Solution Provider Portal
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Avatar className="cursor-pointer">
                  <AvatarFallback>{user?.email?.[0].toUpperCase()}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={signOut} className="cursor-pointer">
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </DropdownMenuItem>
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
              <RotateCcw className="h-4 w-4 mr-2" />
              Revert Changes
            </Button>
            <Button onClick={() => setShowSaveDialog(true)} disabled={!hasUnsavedChanges}>
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : (
          <Accordion type="multiple" defaultValue={["critical_assets", "water_systems", "processes"]} className="space-y-4">
            <AWPSection
              title="Critical Assets"
              value="critical_assets"
              items={groupedAWPs.critical_assets}
              controls={controls}
              getCurrentControlIds={getCurrentControlIds}
              onAddControl={handleAddControl}
              onRemoveControl={handleRemoveControl}
              pendingChanges={pendingChanges}
            />
            <AWPSection
              title="Water Systems"
              value="water_systems"
              items={groupedAWPs.water_systems}
              controls={controls}
              getCurrentControlIds={getCurrentControlIds}
              onAddControl={handleAddControl}
              onRemoveControl={handleRemoveControl}
              pendingChanges={pendingChanges}
            />
            <AWPSection
              title="Processes"
              value="processes"
              items={groupedAWPs.processes}
              controls={controls}
              getCurrentControlIds={getCurrentControlIds}
              onAddControl={handleAddControl}
              onRemoveControl={handleRemoveControl}
              pendingChanges={pendingChanges}
            />
          </Accordion>
        )}
      </main>

      {/* Save Confirmation Dialog */}
      <AlertDialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <AlertDialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle>Save Changes</AlertDialogTitle>
            <AlertDialogDescription>
              The following changes will be applied:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ScrollArea className="flex-1 max-h-[50vh] pr-4">
            <div className="space-y-4">
              {changeSummary.map((item, idx) => (
                <div key={idx} className="border rounded-lg p-3">
                  <p className="font-medium text-foreground">{item.category}: {item.awpName}</p>
                  {item.added.length > 0 && (
                    <p className="text-sm text-green-600">+ {item.added.join(", ")}</p>
                  )}
                  {item.removed.length > 0 && (
                    <p className="text-sm text-destructive">- {item.removed.join(", ")}</p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revert Confirmation Dialog */}
      <AlertDialog open={showRevertDialog} onOpenChange={setShowRevertDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Changes</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to discard all unsaved changes?
            </AlertDialogDescription>
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

// AWP Section Component
interface AWPSectionProps {
  title: string;
  value: string;
  items: AWPItem[];
  controls: { id: string; name: string; category: string }[];
  getCurrentControlIds: (awp: AWPItem) => string[];
  onAddControl: (awp: AWPItem, controlId: string) => void;
  onRemoveControl: (awp: AWPItem, controlId: string) => void;
  pendingChanges: Map<string, PendingChange>;
}

function AWPSection({ title, value, items, controls, getCurrentControlIds, onAddControl, onRemoveControl, pendingChanges }: AWPSectionProps) {
  return (
    <AccordionItem value={value} className="border rounded-lg bg-card">
      <AccordionTrigger className="px-6 py-4 hover:no-underline">
        <span className="text-lg font-semibold">{title} ({items.length})</span>
      </AccordionTrigger>
      <AccordionContent className="px-6 pb-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[250px]">AWP Class</TableHead>
              <TableHead>Default Mitigation Controls</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((awp) => {
              const currentIds = getCurrentControlIds(awp);
              const change = pendingChanges.get(awp.id);
              const hasChanges = change && JSON.stringify(change.original.sort()) !== JSON.stringify(change.current.sort());

              return (
                <TableRow key={awp.id} className={hasChanges ? "bg-yellow-50/50" : ""}>
                  <TableCell className="font-medium">{awp.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2 items-center">
                      {currentIds.map((controlId) => {
                        const controlName = getControlNameById(controls, controlId);
                        const isNew = change && !change.original.includes(controlId);
                        return (
                          <Badge
                            key={controlId}
                            variant="secondary"
                            className={`flex items-center gap-1 ${isNew ? "border-green-500 bg-green-50" : ""}`}
                          >
                            {controlName || controlId}
                            <button
                              onClick={() => onRemoveControl(awp, controlId)}
                              className="ml-1 hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        );
                      })}
                      <AddControlPopover
                        awp={awp}
                        controls={controls}
                        currentIds={currentIds}
                        onAdd={onAddControl}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </AccordionContent>
    </AccordionItem>
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
        <Button variant="outline" size="sm" className="h-7 px-2">
          <Plus className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search controls..." />
          <CommandList>
            <CommandEmpty>No controls found.</CommandEmpty>
            <CommandGroup>
              {availableControls.map((control) => (
                <CommandItem
                  key={control.id}
                  value={control.name}
                  onSelect={() => {
                    onAdd(awp, control.id);
                    setOpen(false);
                  }}
                >
                  <span>{control.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">({control.category})</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
