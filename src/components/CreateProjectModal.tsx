import { toStorageSafeFileName } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, FileText, X, Loader2, Coins, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useAWPOptions, groupAWPOptionsByCategory } from "@/hooks/useAWPOptions";
import { useCredits } from "@/hooks/useCredits";
import { BuyCreditsModal } from "@/components/BuyCreditsModal";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { useTenant } from "@/contexts/TenantContext";
import { CURRENCY_OPTIONS, normalizeCurrencyCode, type CurrencyCode } from "@/lib/currency";

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (projectId: string) => void;
}

const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg,.dwg,.dxf";
type IdentifyTab = "water_systems" | "assets" | "equipment_fixtures" | "controls";

const EMPTY_OTHER_TEXT: Record<IdentifyTab, string> = {
  water_systems: "",
  assets: "",
  equipment_fixtures: "",
  controls: "",
};

const IDENTIFY_TABS: { id: IdentifyTab; label: string }[] = [
  { id: "water_systems", label: "Water Systems" },
  { id: "assets", label: "Assets" },
  { id: "equipment_fixtures", label: "Equipment & Fixtures" },
  { id: "controls", label: "Controls" },
];

export type ProjectSizeTier = "small" | "medium" | "large" | "enterprise";

export const PROJECT_SIZE_TIERS: {
  id: ProjectSizeTier;
  label: string;
  range: string;
  units: number;
  cost: number;
}[] = [
  { id: "small", label: "Small Project", range: "Up to 50 units", units: 50, cost: 25 },
  { id: "medium", label: "Medium Project", range: "51 – 250 units", units: 250, cost: 50 },
  { id: "large", label: "Large Project", range: "251 – 700 units", units: 700, cost: 100 },
  { id: "enterprise", label: "Enterprise", range: "700+ units", units: 701, cost: 0 },
];

export function computeCreditCost(units: number | null): {
  cost: number | null;
  contact: boolean;
} {
  if (units == null || Number.isNaN(units) || units <= 0) return { cost: null, contact: false };
  if (units > 700) return { cost: 0, contact: false };
  if (units <= 50) return { cost: 25, contact: false };
  if (units <= 250) return { cost: 50, contact: false };
  return { cost: 100, contact: false };
}

// Classes that expose subtypes during project creation. Each selected
// abbreviation is preseeded as a "Type" suggestion on that class' annotations.
export const COLD_WATER_SUBTYPES: { label: string; abbr: string }[] = [
  { label: "Main City Entry", abbr: "MCE" },
  { label: "Post-Booster", abbr: "PB" },
  { label: "Zone Entry", abbr: "ZE" },
  { label: "Suite Riser Entry", abbr: "SRE" },
  { label: "Suite Entry", abbr: "SE" },
];
export const RISER_SUBTYPES: { label: string; abbr: string }[] = [
  { label: "Main Mechanical", abbr: "MMCH" },
  { label: "Domestic Cold/Hot Water", abbr: "DCHW" },
  { label: "Chilled Water Return/Supply", abbr: "CWRS" },
  { label: "Electrical", abbr: "ELCT" },
  { label: "Fire Sprinkler", abbr: "FSPK" },
];
export const KITCHEN_EQUIPMENT_SUBTYPES: { label: string; abbr: string }[] = [
  { label: "Sink", abbr: "SINK" },
  { label: "Refrigerator", abbr: "RFGR" },
  { label: "Dishwasher", abbr: "DSHW" },
  { label: "Ice maker", abbr: "ICEM" },
];
export const WASHROOM_FIXTURE_SUBTYPES: { label: string; abbr: string }[] = [
  { label: "Sink", abbr: "SINK" },
  { label: "Toilet", abbr: "TLT" },
  { label: "Bathtub", abbr: "BTHT" },
  { label: "Shower Box", abbr: "SHWB" },
];
export const LAUNDRY_EQUIPMENT_SUBTYPES: { label: string; abbr: string }[] = [
  { label: "Sink", abbr: "SINK" },
  { label: "Water Heater", abbr: "WTRH" },
  { label: "Washing Machine", abbr: "WSHM" },
];
const COLD_WATER_NAME = "Cold Water";
const RISER_NAME = "Riser";
export const SUBTYPED_CLASSES: Record<string, { label: string; abbr: string }[]> = {
  [COLD_WATER_NAME]: COLD_WATER_SUBTYPES,
  [RISER_NAME]: RISER_SUBTYPES,
  "Kitchen Equipment": KITCHEN_EQUIPMENT_SUBTYPES,
  "Washroom Fixtures": WASHROOM_FIXTURE_SUBTYPES,
  "Laundry Equipment": LAUNDRY_EQUIPMENT_SUBTYPES,
};


const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function CreateProjectModal({ open, onOpenChange, onCreated }: CreateProjectModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: awpOptions } = useAWPOptions();
  const { data: mitigationControls = [] } = useQuery({
    queryKey: ["create-project-mitigation-controls"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mitigation_controls")
        .select("id, name, category")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return ((data || []) as { id: string; name: string; category?: string | null }[]).filter((control) => {
        const text = `${control.name || ""} ${control.category || ""}`.toLowerCase();
        return !text.includes("contractor");
      });
    },
    enabled: open,
  });
  const { balance, refetch: refetchCredits } = useCredits();
  const { tenantId, tenant, refetch: refetchTenants } = useTenant();
  // Company workspaces draw from the shared company pool instead of the personal one.
  const effectiveBalance = tenantId ? (tenant?.credits_balance ?? 0) : balance;
  const nameRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [sizeTier, setSizeTier] = useState<ProjectSizeTier | null>(null);
  const [selectedClassNames, setSelectedClassNames] = useState<Set<string>>(new Set());
  const [selectedControlIds, setSelectedControlIds] = useState<Set<string>>(new Set());
  const [otherTextByTab, setOtherTextByTab] = useState<Record<IdentifyTab, string>>(EMPTY_OTHER_TEXT);
  const [activeIdentifyTab, setActiveIdentifyTab] = useState<IdentifyTab>("water_systems");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>(normalizeCurrencyCode(tenant?.default_currency));
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());
  const [subtypesByClass, setSubtypesByClass] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    if (open) {
      setName("");
      setSizeTier(null);
      setSelectedClassNames(new Set());
      setSelectedControlIds(new Set());
      setOtherTextByTab(EMPTY_OTHER_TEXT);
      setActiveIdentifyTab("water_systems");
      setAdvancedOpen(false);
      setCurrencyCode(normalizeCurrencyCode(tenant?.default_currency));
      setFiles([]);
      setSubmitting(false);
      setExpandedClasses(new Set(["Kitchen Equipment", "Washroom Fixtures", "Laundry Equipment"]));
      setSubtypesByClass({});
      setTimeout(() => nameRef.current?.focus(), 100);
    }
  }, [open, tenant?.default_currency]);

  const eligibleOptions = useMemo(
    () =>
      (awpOptions || []).filter(
        (o) => o.displayCategory === "Asset" || o.displayCategory === "Water System" || o.displayCategory === "Equipment & Fixtures",
      ),
    [awpOptions],
  );
  const grouped = useMemo(() => groupAWPOptionsByCategory(eligibleOptions), [eligibleOptions]);
  const optionsByTab = useMemo(
    () => ({
      water_systems: grouped["Water System"] || [],
      assets: grouped.Asset || [],
      equipment_fixtures: grouped["Equipment & Fixtures"] || [],
      controls: [],
    }),
    [grouped],
  );

  const tierConfig = sizeTier ? PROJECT_SIZE_TIERS.find((t) => t.id === sizeTier)! : null;
  const units = tierConfig ? tierConfig.units : null;
  const { cost, contact } = computeCreditCost(units);

  const otherEntriesByTab = useMemo(() => {
    const entries = {} as Record<IdentifyTab, string[]>;
    IDENTIFY_TABS.forEach((tab) => {
      entries[tab.id] = otherTextByTab[tab.id]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    });
    return entries;
  }, [otherTextByTab]);

  const selectedControlNames = useMemo(
    () => mitigationControls.filter((control) => selectedControlIds.has(control.id)).map((control) => control.name),
    [mitigationControls, selectedControlIds],
  );

  const otherList = useMemo(
    () => [...Object.values(otherEntriesByTab).flat(), ...selectedControlNames],
    [otherEntriesByTab, selectedControlNames],
  );

  const anySubtypeSelected = useMemo(
    () => Object.values(subtypesByClass).some((s) => s.size > 0),
    [subtypesByClass],
  );

  const hasAnyClass =
    selectedClassNames.size > 0 ||
    selectedControlIds.size > 0 ||
    anySubtypeSelected ||
    otherList.length > 0;

  const finalSelectedClassNames = useMemo(() => {
    const s = new Set(selectedClassNames);
    for (const className of Object.keys(SUBTYPED_CLASSES)) {
      if ((subtypesByClass[className]?.size ?? 0) > 0) s.add(className);
      else s.delete(className);
    }
    return Array.from(s);
  }, [selectedClassNames, subtypesByClass]);

  const selectedSubtypesMap = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [className, defs] of Object.entries(SUBTYPED_CLASSES)) {
      const picked = subtypesByClass[className];
      if (!picked || picked.size === 0) continue;
      // Preserve canonical order from the subtype definition
      out[className] = defs.filter((s) => picked.has(s.abbr)).map((s) => s.abbr);
    }
    return out;
  }, [subtypesByClass]);

  const toggleSubtype = (className: string, abbr: string) => {
    setSubtypesByClass((prev) => {
      const next = new Set(prev[className] || []);
      if (next.has(abbr)) next.delete(abbr);
      else next.add(abbr);
      return { ...prev, [className]: next };
    });
  };

  const toggleControl = (id: string) => {
    setSelectedControlIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setOtherTextForTab = (tab: IdentifyTab, value: string) =>
    setOtherTextByTab((prev) => ({ ...prev, [tab]: value }));

  const countForIdentifyTab = (tab: IdentifyTab) => {
    const otherCount = otherEntriesByTab[tab].length;
    if (tab === "controls") return selectedControlIds.size + otherCount;
    const optionCount = optionsByTab[tab].reduce((total: number, opt: any) => {
      const subtypeCount = subtypesByClass[opt.name]?.size ?? 0;
      if (subtypeCount > 0) return total + subtypeCount;
      return total + (selectedClassNames.has(opt.name) ? 1 : 0);
    }, 0);
    return optionCount + otherCount;
  };


  const canSave =
    !!user &&
    name.trim().length > 0 &&
    units != null &&
    units > 0 &&
    !contact &&
    cost != null &&
    hasAnyClass &&
    files.length > 0 &&
    !submitting;

  const toggleClass = (n: string) => {
    setSelectedClassNames((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    e.target.value = "";
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!canSave || !user || cost == null) return;

    if (effectiveBalance < cost) {
      setShowBuyCredits(true);
      return;
    }

    setSubmitting(true);
    const projectName = name.trim();

    try {
      // Generate the project id up-front so the credit transaction can be
      // linked to the project it paid for (audit trail).
      const projectId = crypto.randomUUID();

      // 1) Consume credits up-front (skip if free, e.g. Enterprise).
      //    Inside a company workspace credits come from the shared tenant pool.
      if (cost > 0) {
        const { data: consumeRes, error: consumeErr } = tenantId
          ? await supabase.rpc("consume_tenant_credits", {
              p_tenant_id: tenantId,
              p_amount: cost,
              p_project_id: projectId,
            } as any)
          : await supabase.rpc("consume_credits", {
              p_user_id: user.id,
              p_amount: cost,
            });
        if (consumeErr) throw consumeErr;
        const ok = (consumeRes as any)?.success;
        if (!ok) {
          const reason = (consumeRes as any)?.reason;
          if (reason === "insufficient_credits") {
            setShowBuyCredits(true);
            return;
          }
          throw new Error(`Couldn't consume credits (${reason || "unknown"})`);
        }
        if (tenantId) refetchTenants();
        else await refetchCredits();
      }

      // 2) Create the project
      const { data: project, error: pErr } = await supabase
        .from("projects")
        .insert({
          id: projectId,
          user_id: user.id,
          name: projectName,
          status: "draft",
          estimated_units: units,
          credits_consumed: cost,
          tenant_id: tenantId,
          currency_code: currencyCode,
          selected_awp_class_names: finalSelectedClassNames,
          selected_other_classes: otherList,
          selected_awp_subtypes: selectedSubtypesMap,
          project_data: {
            intake_identify_selections: {
              water_systems: optionsByTab.water_systems.filter((opt) => selectedClassNames.has(opt.name)).map((opt) => opt.name),
              assets: optionsByTab.assets.filter((opt) => selectedClassNames.has(opt.name)).map((opt) => opt.name),
              equipment_fixtures: optionsByTab.equipment_fixtures.filter((opt) => selectedClassNames.has(opt.name)).map((opt) => opt.name),
              controls: selectedControlNames,
              other: otherEntriesByTab,
            },
          },
        } as any)
        .select("id")
        .single();
      if (pErr) throw pErr;

      // 3) Optionally upload files (background)
      if (files.length > 0) {
        const { data: req, error: rErr } = await supabase
          .from("analysis_requests")
          .insert({
            project_id: project.id,
            user_id: user.id,
            source_type: "manual_upload",
            status: "copying",
            file_count: files.length,
          })
          .select("id")
          .single();
        if (rErr) throw rErr;

        const filesToUpload = files;
        (async () => {
          let copied = 0;
          let totalBytes = 0;
          for (const f of filesToUpload) {
            const path = `${project.id}/${req.id}/${toStorageSafeFileName(f.name)}`;
            const { error: upErr } = await supabase.storage
              .from("uploaded-drawings")
              .upload(path, f, { upsert: true });
            if (upErr) {
              await supabase
                .from("analysis_request_files")
                .insert({
                  analysis_request_id: req.id,
                  drive_file_id: `manual_${Date.now()}_${Math.random().toString(36).slice(2)}_${f.name}`,
                  name: f.name,
                  mime_type: f.type || "application/octet-stream",
                  size_bytes: f.size,
                  relative_path: f.name,
                  storage_path: path,
                  copy_status: "failed",
                });
              continue;
            }
            const isPdf = (f.type || "").includes("pdf") || f.name.toLowerCase().endsWith(".pdf");
            const pageCount = isPdf
              ? await (await import("@/lib/pdfProcessor")).extractPdfPageCount(f)
              : null;
            await supabase.from("analysis_request_files").insert({
              analysis_request_id: req.id,
              drive_file_id: `manual_${Date.now()}_${Math.random().toString(36).slice(2)}_${f.name}`,
              name: f.name,
              mime_type: f.type || "application/octet-stream",
              size_bytes: f.size,
              relative_path: f.name,
              storage_path: path,
              copy_status: "copied",
              expected_page_count: pageCount ?? null,
            } as any);
            copied++;
            totalBytes += f.size;
          }
          await supabase
            .from("analysis_requests")
            .update({
              status: copied > 0 ? "copied" : "failed",
              total_size_bytes: totalBytes,
              file_count: copied,
            })
            .eq("id", req.id);

          // Note: auto-split on project creation was removed. The user must
          // start splitting explicitly from the workbench.

        })();
      }

      toast({
        title: "Project created",
        description: `"${projectName}" was created and ${cost} credit${cost === 1 ? "" : "s"} consumed.`,
      });
      onOpenChange(false);
      onCreated?.(project.id);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Could not create project",
        description: getUserFriendlyError(error),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] p-0 flex flex-col gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle>Add New Project</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-5">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="cp-name">
                Project Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cp-name"
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter project name"
              />
            </div>

            {/* Project Size */}
            <div className="space-y-2">
              <Label>
                Project Size (Suites or Rooms){" "}
                <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-4 gap-2">
                {PROJECT_SIZE_TIERS.map((tier) => {
                  const selected = sizeTier === tier.id;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => setSizeTier(tier.id)}
                      className={`rounded-md border p-3 text-left transition-all ${
                        selected
                          ? "border-primary bg-primary/5 ring-2 ring-primary"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="text-sm font-semibold">{tier.label}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {tier.range}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Cost summary */}
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Coins className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Cost</span>
              </div>
              {!tierConfig ? (
                <p className="text-sm text-muted-foreground">
                  Select a project size to see the cost.
                </p>
              ) : tierConfig.id === "enterprise" ? (
                <div className="text-sm">
                  <div>
                    <span className="text-2xl font-bold text-primary">0</span>{" "}
                    <span className="text-muted-foreground">credits</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Enterprise projects are free to create - our team will reach out to coordinate scope.
                  </p>
                </div>
              ) : (
                <div className="text-sm">
                  <div>
                    <span className="text-2xl font-bold text-primary">{cost}</span>{" "}
                    <span className="text-muted-foreground">credits</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your balance: {effectiveBalance} credit{effectiveBalance === 1 ? "" : "s"}.
                    {effectiveBalance < (cost ?? 0) && " You don't have enough - you'll be prompted to purchase more."}
                  </p>
                </div>
              )}
            </div>

            {/* Files */}
            <div className="space-y-2">
              <Label>
                Drawings <span className="text-destructive">*</span>
              </Label>
              <div className="pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <Upload className="w-4 h-4 mr-1" />
                  Upload from Computer
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
                    <div
                      key={idx}
                      className="flex items-center justify-between text-sm px-2 py-1 bg-muted/50 rounded"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{file.name}</span>
                        <span className="text-muted-foreground text-xs shrink-0">
                          {formatBytes(file.size)}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => removeFile(idx)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Classes */}
            <div className="space-y-2">
              <Label>
                Elements to Identify <span className="text-destructive">*</span>
              </Label>
              <Tabs value={activeIdentifyTab} onValueChange={(value) => setActiveIdentifyTab(value as IdentifyTab)} className="rounded-md border">
                <TabsList className="m-3 mb-0 flex h-auto flex-wrap justify-start">
                  {IDENTIFY_TABS.map((tab) => {
                    const count = countForIdentifyTab(tab.id);
                    return (
                      <TabsTrigger key={tab.id} value={tab.id} className="text-xs">
                        {tab.label}{count > 0 ? ` (${count})` : ""}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
                {IDENTIFY_TABS.map((tab) => (
                  <TabsContent key={tab.id} value={tab.id} className="m-0">
                    <div className="p-3 space-y-3">
                      {tab.id === "controls" ? (
                        <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                          {mitigationControls.map((control) => (
                            <label key={control.id} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox checked={selectedControlIds.has(control.id)} onCheckedChange={() => toggleControl(control.id)} />
                              <span>{control.name}</span>
                            </label>
                          ))}
                          {mitigationControls.length === 0 && <p className="text-sm text-muted-foreground">No controls available.</p>}
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                          {optionsByTab[tab.id].map((opt) => {
                            const subtypeDefs = SUBTYPED_CLASSES[opt.name];
                            if (subtypeDefs) {
                              const expanded = expandedClasses.has(opt.name);
                              const picked = subtypesByClass[opt.name] || new Set<string>();
                              return (
                                <div key={opt.id} className="space-y-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedClasses((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(opt.name)) next.delete(opt.name);
                                        else next.add(opt.name);
                                        return next;
                                      })
                                    }
                                    className="flex items-center gap-2 text-sm w-full text-left"
                                  >
                                    {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                                    {opt.idPrefix && <span className="font-mono text-xs text-muted-foreground">{opt.idPrefix}</span>}
                                    <span>{opt.name}</span>
                                    {picked.size > 0 && <span className="ml-1 text-xs text-muted-foreground">({picked.size} selected)</span>}
                                  </button>
                                  {expanded && (
                                    <div className="pl-6 space-y-1.5">
                                      {subtypeDefs.map((sub) => (
                                        <label key={sub.abbr} className="flex items-center gap-2 text-sm cursor-pointer">
                                          <Checkbox checked={picked.has(sub.abbr)} onCheckedChange={() => toggleSubtype(opt.name, sub.abbr)} />
                                          <span className="font-mono text-xs text-muted-foreground">{sub.abbr}</span>
                                          <span>{sub.label}</span>
                                        </label>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            }

                            return (
                              <label key={opt.id} className="flex items-center gap-2 text-sm cursor-pointer">
                                <Checkbox checked={selectedClassNames.has(opt.name)} onCheckedChange={() => toggleClass(opt.name)} />
                                <span>
                                  {opt.idPrefix && <span className="font-mono text-xs text-muted-foreground mr-2">{opt.idPrefix}</span>}
                                  {opt.name}
                                </span>
                              </label>
                            );
                          })}
                          {optionsByTab[tab.id].length === 0 && <p className="text-sm text-muted-foreground">No options available.</p>}
                        </div>
                      )}
                      <div className="space-y-2 rounded-md bg-muted/30 p-3">
                        <Label className="text-sm">Other {tab.label}</Label>
                        <Input
                          value={otherTextByTab[tab.id]}
                          onChange={(e) => setOtherTextForTab(tab.id, e.target.value)}
                          placeholder="Type anything (comma-separate to add multiple)"
                        />
                      </div>
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </div>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="rounded-lg border bg-muted/20">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
                onClick={() => setAdvancedOpen((value) => !value)}
              >
                Advanced Options
                {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              <CollapsibleContent className="border-t px-4 py-3">
                <div className="space-y-2 sm:max-w-xs">
                  <Label>Currency</Label>
                  <Select value={currencyCode} onValueChange={(value) => setCurrencyCode(normalizeCurrencyCode(value))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((option) => (
                        <SelectItem key={option.code} value={option.code}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t shrink-0">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSave}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {contact ? "Contact required" : "Create Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BuyCreditsModal
        open={showBuyCredits}
        onOpenChange={setShowBuyCredits}
        reason={
          cost != null
            ? `This project costs ${cost} credits. You currently have ${effectiveBalance}.`
            : undefined
        }
      />
    </>
  );
}
