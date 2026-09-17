import { useState, useMemo, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Label } from "@/components/ui/label";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AppHeader } from "@/components/AppHeader";
import { Plus, X, ShieldAlert, Loader2, Pencil } from "lucide-react";
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

interface PromptInfo {
  id: string;
  awp_class_name: string;
  category: string;
  prompt_content: string | null;
  content_updated_at: string | null;
  triage_prompt_content: string | null;
  triage_content_updated_at: string | null;
}

const CATEGORY_LABELS: Record<AWPItem["category"], string> = {
  critical_assets: "Critical Assets",
  water_systems: "Water Systems",
  processes: "Processes",
};

const MAX_INLINE_CONTROLS = 5;

export default function Configuration() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  useHeapIdentify();

  const [viewMode, setViewMode] = useState<"risk" | "control">("risk");
  const [editingAwp, setEditingAwp] = useState<AWPItem | null>(null);
  const [editingControlId, setEditingControlId] = useState<string | null>(null);

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
      return (data || []) as unknown as PromptInfo[];
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

  const sortedControlIds = (ids: string[]): string[] =>
    [...ids].sort((a, b) => {
      const nameA = getControlNameById(controls, a) || a;
      const nameB = getControlNameById(controls, b) || b;
      return nameA.localeCompare(nameB);
    });

  const getCurrentControlIds = (awp: AWPItem): string[] => {
    const live = awpItems.find(a => a.id === awp.id) ?? awp;
    return sortedControlIds(live.default_control_ids);
  };

  const afterSave = async () => {
    await Promise.all([refetchAWPs(), refetchPrompts()]);
    queryClient.invalidateQueries({ queryKey: ["awp-options"] });
  };

  /** Saves the whole risk row: name, mapped controls and both prompts. */
  const saveRisk = async (
    awp: AWPItem,
    values: { name: string; controlIds: string[]; prompt: string; triagePrompt: string },
  ) => {
    const newName = values.name.trim() || awp.name;
    try {
      const payload: any = { default_control_ids: values.controlIds };
      if (newName !== awp.name) payload.name = newName;
      const { data, error } = await supabase
        .from(awp.category)
        .update(payload)
        .eq("id", awp.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Not authorized to update this configuration.");

      const existing = promptsByName.get(awp.name);
      const now = new Date().toISOString();
      const promptPayload: any = {
        awp_class_name: newName,
        category: awp.category,
        prompt_content: values.prompt.trim() || null,
        content_updated_at: now,
        triage_prompt_content: values.triagePrompt.trim() || null,
        triage_content_updated_at: now,
      };
      if (existing) {
        const { error: pErr } = await supabase.from("awp_class_prompts").update(promptPayload).eq("id", existing.id);
        if (pErr) throw pErr;
      } else {
        const { error: pErr } = await supabase.from("awp_class_prompts").insert(promptPayload);
        if (pErr) throw pErr;
      }

      toast({ title: "Saved", description: `${newName} updated. New projects will use these settings.` });
      setEditingAwp(null);
      await afterSave();
    } catch (error: any) {
      toast({ title: "Could not save", description: (error as any)?.message, variant: "destructive" });
    }
  };

  /** Saves which risks a control is mapped to (control-centric view). */
  const saveControlRisks = async (controlId: string, selectedAwpIds: string[]) => {
    try {
      const selected = new Set(selectedAwpIds);
      const updates = awpItems
        .map((awp) => {
          const has = awp.default_control_ids.includes(controlId);
          const should = selected.has(awp.id);
          if (has === should) return null;
          const next = should
            ? [...awp.default_control_ids, controlId]
            : awp.default_control_ids.filter((id) => id !== controlId);
          return supabase.from(awp.category).update({ default_control_ids: next } as any).eq("id", awp.id);
        })
        .filter(Boolean) as unknown as Promise<any>[];
      const results = await Promise.all(updates);
      const failed = results.find((r) => r?.error);
      if (failed?.error) throw failed.error;
      toast({ title: "Saved", description: "Risk mapping updated for this control." });
      setEditingControlId(null);
      await afterSave();
    } catch (error: any) {
      toast({ title: "Could not save", description: (error as any)?.message, variant: "destructive" });
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

  const editingPrompt = editingAwp ? promptsByName.get(editingAwp.name) ?? null : null;
  const editingControl = controls.find((c) => c.id === editingControlId) ?? null;

  const riskRows = (items: AWPItem[]) =>
    items.map((awp) => (
      <RiskRow
        key={awp.id}
        awp={awp}
        controls={controls}
        currentIds={getCurrentControlIds(awp)}
        hasPrompt={!!promptsByName.get(awp.name)?.prompt_content}
        onEdit={() => setEditingAwp(awp)}
      />
    ));

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        title="App Configuration"
        infoTitle="About App Configuration"
        infoContent={<p>Manage default mitigation controls, prompts, and agent settings used across the platform.</p>}
      />

      <main className="container mx-auto px-6 py-8">
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-3 gap-4">
              <h2 className="text-lg font-semibold">Risk-Control Map</h2>
              <ToggleGroup
                type="single"
                size="sm"
                value={viewMode}
                onValueChange={(v) => v && setViewMode(v as "risk" | "control")}
                className="border rounded-md bg-card"
              >
                <ToggleGroupItem value="risk" className="text-xs px-3">Risk-centric</ToggleGroupItem>
                <ToggleGroupItem value="control" className="text-xs px-3">Control-centric</ToggleGroupItem>
              </ToggleGroup>
            </div>
            {/* overflow-visible on the table wrapper so the sticky header tracks
                page scroll instead of the table's own (non-scrolling) viewport */}
            <div className="bg-card rounded-lg border [&>div]:overflow-visible">
              {viewMode === "risk" ? (
                <Table className="[&_td]:py-2 [&_th]:py-2 [&_thead_th]:sticky [&_thead_th]:top-[72px] [&_thead_th]:z-10 [&_thead_th]:bg-card [&_thead_th]:shadow-[inset_0_-1px_0_hsl(var(--border))]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[220px]">Risk</TableHead>
                      <TableHead>Controls</TableHead>
                      <TableHead className="w-[180px] text-center">Can Span Multiple Spaces</TableHead>
                      <TableHead className="w-[90px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(["critical_assets", "water_systems", "processes"] as const).map((cat) => (
                      <Fragment key={cat}>
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableCell colSpan={4} className="font-semibold text-sm py-2">{CATEGORY_LABELS[cat]}</TableCell>
                        </TableRow>
                        {riskRows(groupedAWPs[cat])}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Table className="[&_td]:py-2 [&_th]:py-2 [&_thead_th]:sticky [&_thead_th]:top-[72px] [&_thead_th]:z-10 [&_thead_th]:bg-card [&_thead_th]:shadow-[inset_0_-1px_0_hsl(var(--border))]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[260px]">Control</TableHead>
                      <TableHead>Risks</TableHead>
                      <TableHead className="w-[90px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {controls.map((control) => {
                      const mapped = awpItems.filter((a) => a.default_control_ids.includes(control.id));
                      return (
                        <TableRow key={control.id}>
                          <TableCell className="font-medium py-2">{control.name}</TableCell>
                          <TableCell className="py-2">
                            <span className="text-sm text-muted-foreground block truncate max-w-[640px]">
                              {mapped.length > 0
                                ? mapped.map((m) => m.name).join(", ")
                                : "No risks mapped"}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditingControlId(control.id)}>
                              <Pencil className="h-3 w-3 mr-1" />Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}

        <AIAgentsSection />
      </main>

      {editingAwp && (
        <RiskEditModal
          key={editingAwp.id}
          awp={editingAwp}
          prompt={editingPrompt}
          controls={controls}
          currentIds={getCurrentControlIds(editingAwp)}
          onSave={(values) => saveRisk(editingAwp, values)}
          onClose={() => setEditingAwp(null)}
        />
      )}

      {editingControl && (
        <ControlRiskEditModal
          key={editingControl.id}
          control={editingControl}
          awpItems={awpItems}
          onSave={(ids) => saveControlRisks(editingControl.id, ids)}
          onClose={() => setEditingControlId(null)}
        />
      )}
    </div>
  );
}

// ---------------- Risk Row ----------------
interface RiskRowProps {
  awp: AWPItem;
  controls: { id: string; name: string; category: string }[];
  currentIds: string[];
  hasPrompt: boolean;
  onEdit: () => void;
}

function RiskRow({ awp, controls, currentIds, hasPrompt, onEdit }: RiskRowProps) {
  const names = currentIds.map((id) => getControlNameById(controls, id) || id);
  const shown = names.slice(0, MAX_INLINE_CONTROLS);
  const remaining = names.length - shown.length;

  return (
    <TableRow>
      <TableCell className="font-medium py-2">
        <div className="flex items-center gap-2">
          <span>{awp.name}</span>
          {!hasPrompt && <span className="text-xs font-normal text-muted-foreground">(missing prompt)</span>}
        </div>
      </TableCell>
      <TableCell className="py-2">
        <span className="text-sm text-muted-foreground block truncate max-w-[520px]">
          {names.length === 0 ? "No controls" : shown.join(", ")}
          {remaining > 0 && <span className="text-foreground"> +{remaining} more</span>}
        </span>
      </TableCell>
      <TableCell className="py-2 text-center text-sm">{awp.can_span_multiple_spaces ? "Yes" : "No"}</TableCell>
      <TableCell className="py-2 text-right">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onEdit}>
          <Pencil className="h-3 w-3 mr-1" />Edit
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ---------------- Risk Edit Modal ----------------
interface RiskEditModalProps {
  awp: AWPItem;
  prompt: PromptInfo | null;
  controls: { id: string; name: string; category: string }[];
  currentIds: string[];
  onSave: (values: { name: string; controlIds: string[]; prompt: string; triagePrompt: string }) => void | Promise<void>;
  onClose: () => void;
}

function RiskEditModal({ awp, prompt, controls, currentIds, onSave, onClose }: RiskEditModalProps) {
  const [name, setName] = useState(awp.name);
  const [ids, setIds] = useState<string[]>(currentIds);
  const [detection, setDetection] = useState(prompt?.prompt_content ?? "");
  const [triage, setTriage] = useState(prompt?.triage_prompt_content ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({ name, controlIds: ids, prompt: detection, triagePrompt: triage });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Risk - {awp.name}</DialogTitle>
          <DialogDescription>
            Changes apply to new projects only. Existing projects keep the settings they were created with.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Can span multiple spaces</Label>
              <div className="h-10 flex items-center text-sm text-muted-foreground">
                {awp.can_span_multiple_spaces ? "Yes" : "No"}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Controls</Label>
            <div className="flex flex-wrap gap-1.5">
              {ids.map((controlId) => (
                <Badge key={controlId} variant="secondary" className="flex items-center gap-1 text-xs">
                  {getControlNameById(controls, controlId) || controlId}
                  <button onClick={() => setIds((prev) => prev.filter((id) => id !== controlId))} className="ml-0.5 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {ids.length === 0 && <span className="text-sm text-muted-foreground">No controls</span>}
            </div>
            <AddControlPopover
              controls={controls}
              currentIds={ids}
              onAdd={(controlId) => setIds((prev) => [...prev, controlId])}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Detection prompt</Label>
            <Textarea
              value={detection}
              onChange={(e) => setDetection(e.target.value)}
              placeholder="Write the detection prompt for this risk..."
              className="font-mono text-xs min-h-[180px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Triage prompt</Label>
            <Textarea
              value={triage}
              onChange={(e) => setTriage(e.target.value)}
              placeholder="Write the triage prompt for this risk..."
              className="font-mono text-xs min-h-[140px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Control Edit Modal (control-centric view) ----------------
function ControlRiskEditModal({
  control,
  awpItems,
  onSave,
  onClose,
}: {
  control: { id: string; name: string };
  awpItems: AWPItem[];
  onSave: (awpIds: string[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(
    awpItems.filter((a) => a.default_control_ids.includes(control.id)).map((a) => a.id),
  );
  const [saving, setSaving] = useState(false);

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(selected);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Risks - {control.name}</DialogTitle>
          <DialogDescription>
            Changes apply to new projects only. Existing projects are unaffected.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto pr-1">
          {(["critical_assets", "water_systems", "processes"] as const).map((cat) => {
            const items = awpItems.filter((a) => a.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat} className="space-y-1.5">
                <p className="text-sm font-semibold">{CATEGORY_LABELS[cat]}</p>
                {items.map((awp) => (
                  <label key={awp.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selected.includes(awp.id)}
                      onCheckedChange={(v) => toggle(awp.id, v === true)}
                    />
                    {awp.name}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Add Control Popover
function AddControlPopover({
  controls,
  currentIds,
  onAdd,
}: {
  controls: { id: string; name: string; category: string }[];
  currentIds: string[];
  onAdd: (controlId: string) => void;
}) {
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
          <CommandList className="max-h-64 overflow-y-auto">
            <CommandEmpty>No controls found.</CommandEmpty>
            <CommandGroup>
              {availableControls.map((control) => (
                <CommandItem key={control.id} value={control.name} onSelect={() => { onAdd(control.id); setOpen(false); }}>{control.name}</CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------- Shared Model Picker (Gemini) ----------------
const GEMINI_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (fastest/cheapest)" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)" },
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
];

function PromptModelPicker({ settingKey, defaultModel }: { settingKey: string; defaultModel: string }) {
  const { toast } = useToast();
  const [model, setModel] = useState<string>(defaultModel);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("app_settings" as any)
        .select("value")
        .eq("key", settingKey)
        .maybeSingle();
      if (cancelled) return;
      const stored = (data as any)?.value;
      if (typeof stored === "string" && stored.length > 0) setModel(stored);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [settingKey]);

  const onChange = async (value: string) => {
    setModel(value);
    const { error } = await supabase
      .from("app_settings" as any)
      .upsert({ key: settingKey, value, updated_at: new Date().toISOString() } as any, { onConflict: "key" });
    if (error) {
      toast({ title: "Failed to save model", description: (error as any)?.message, variant: "destructive" });
    } else {
      toast({ title: "Model updated", description: `Next run will use ${value}.` });
    }
  };

  return (
    <Select value={model} onValueChange={onChange} disabled={loading}>
      <SelectTrigger className="w-[260px] [&>span]:flex-1 [&>span]:text-left [&>span]:truncate [&>span]:block">
        <SelectValue placeholder="Select model" />
      </SelectTrigger>
      <SelectContent>
        {GEMINI_MODEL_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------- Scout Agent Prompt ----------------
// ---------------- AI Agents ----------------
// The developer/user-message text that the analyze-drawings edge function
// sends alongside each AWP class's system prompt. Keep in sync with
// supabase/functions/analyze-drawings/index.ts.
const DEFAULT_ANALYZE_PROMPT =
  "Analyze this drawing according to the instructions provided.";

type AgentConfig = {
  title: string;
  description: string;
  modelKey: string;
  defaultModel: string;
  promptKey: string;
  buttonLabel: string;
  dialogTitle: string;
  fallbackDescription: string;
  savedDescription: string;
  defaultPrompt?: string;
};

const AGENT_CONFIGS: AgentConfig[] = [
  {
    title: "Scout Agent",
    description:
      "System prompt sent to Gemini when the Scout agent surveys each page. The PNG of every page is attached as image input.",
    modelKey: "survey_page_model",
    defaultModel: "gemini-3.5-flash",
    promptKey: "survey_page_prompt",
    buttonLabel: "Show Prompt",
    dialogTitle: "Scout Agent Prompt",
    fallbackDescription: "Edit and save the prompt used by Survey Pages.",
    savedDescription: "Scout Agent will use the updated prompt next run.",
  },
  {
    title: "Risk Radar Agent",
    description:
      "System prompt used by the Risk Radar agent (Identify Risk Elements). Sent to Gemini with the cached PDF context.",
    modelKey: "analyze_model",
    defaultModel: "gemini-3.5-flash",
    promptKey: "analyze_prompt",
    buttonLabel: "Show Prompt",
    dialogTitle: "Risk Radar Agent Prompt",
    fallbackDescription: "Edit and save the prompt used by the Analyze stage.",
    savedDescription: "Risk Radar Agent will use the updated prompt next run.",
    defaultPrompt: DEFAULT_ANALYZE_PROMPT,
  },
  {
    title: "Spatial Architect Agent",
    description:
      "Prompt sent to the Spatial Architect agent. Scout's per-page output is appended after the prompt for normalization.",
    modelKey: "space_hierarchy_model",
    defaultModel: "gemini-2.5-flash-lite",
    promptKey: "space_hierarchy_prompt",
    buttonLabel: "Show Prompt",
    dialogTitle: "Spatial Architect Agent Prompt",
    fallbackDescription: "Edit and save the prompt used by Build Space Hierarchy.",
    savedDescription: "Spatial Architect Agent will use the updated prompt next run.",
  },
  {
    title: "Wade Agent",
    description:
      "Model and system prompt for the Wade assistant in the Threat Report modal. The project's report context is appended after the prompt.",
    modelKey: "ask_wade_model",
    defaultModel: "gemini-3.5-flash",
    promptKey: "ask_wade_prompt",
    buttonLabel: "Show Prompt",
    dialogTitle: "Wade Agent System Prompt",
    fallbackDescription: "Leave blank to use the built-in default prompt.",
    savedDescription: "Wade will use the updated prompt on the next question.",
  },
];

function AgentPromptRow({ agent }: { agent: AgentConfig }) {
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
        .eq("key", agent.promptKey)
        .maybeSingle();
      if (error) throw error;
      const stored = (data as any)?.value;
      setContent(
        typeof stored === "string" && stored.length > 0 ? stored : (agent.defaultPrompt ?? ""),
      );
      setUpdatedAt((data as any)?.updated_at ?? null);
    } catch (e: any) {
      toast({ title: "Failed to load prompt", description: (e as any)?.message, variant: "destructive" });
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
        .upsert(
          { key: agent.promptKey, value: content, updated_at: new Date().toISOString() } as any,
          { onConflict: "key" },
        );
      if (error) throw error;
      toast({ title: "Prompt saved", description: agent.savedDescription });
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Save failed", description: (e as any)?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TableRow>
        <TableCell className="align-top font-medium">{agent.title}</TableCell>
        <TableCell className="align-top">
          <p className="text-sm text-muted-foreground max-w-[620px]">{agent.description}</p>
        </TableCell>
        <TableCell className="align-top">
          <PromptModelPicker settingKey={agent.modelKey} defaultModel={agent.defaultModel} />
        </TableCell>
        <TableCell className="align-top text-right">
          <Button variant="outline" onClick={openModal}>{agent.buttonLabel}</Button>
        </TableCell>
      </TableRow>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{agent.dialogTitle}</DialogTitle>
            <DialogDescription>
              {updatedAt
                ? `Last updated ${format(new Date(updatedAt), "MMM d, yyyy 'at' h:mm a")}`
                : agent.fallbackDescription}
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading...
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
    </>
  );
}

function AIAgentsSection() {
  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold mb-3">AI Agents</h2>
      <div className="bg-card rounded-lg border">
        <Table className="[&_td]:py-2 [&_th]:py-2 [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-card [&_thead_th]:shadow-[inset_0_-1px_0_hsl(var(--border))]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Agent</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[280px]">Model</TableHead>
              <TableHead className="w-[170px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {AGENT_CONFIGS.map((agent) => (
              <AgentPromptRow key={agent.promptKey} agent={agent} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
