import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { useTenant } from "@/contexts/TenantContext";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

interface MitigationControl {
  id: string;
  name: string;
}

const SPECIAL_CONTROLS: Record<string, string[]> = {
  "Presence of Water Monitoring": ["Single (Probe)", "Area (Rope)"],
  "Automatic Shut Off Valve": ['1"', '2"', '4"', '8"'],
  "Inline Flow Sensors": ['1"', '2"', '4"', '8"'],
  "Ultrasonic Flow Sensors": ['1"', '2"', '4"', '8"'],
};

const CATEGORIES = [
  { key: "critical_assets", label: "Critical Assets", table: "critical_assets" },
  { key: "water_systems", label: "Water Systems", table: "water_systems" },
  { key: "processes", label: "Contractor Processes", table: "processes" },
] as const;

type CategoryKey = typeof CATEGORIES[number]["key"];

export default function Controls() {
  const { user } = useAuth();
  const { tenant, tenantId, loading: tenantLoading } = useTenant();

  const isInternalUser = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;
  // Guests are read-only; admins and members (and internal staff) may edit.
  const canEdit = isInternalUser || tenant?.role === "admin" || tenant?.role === "member";

  // Selections: Map<`${category}::${controlId}`, sub_options[]>
  const [selections, setSelections] = useState<Map<string, string[]>>(new Map());
  const [expandedControls, setExpandedControls] = useState<Set<string>>(new Set());

  // Description banner dismissal
  const [showDescription, setShowDescription] = useState(() =>
    sessionStorage.getItem("riskblue_controls_description_dismissed") !== "true"
  );
  const handleDismissDescription = () => {
    setShowDescription(false);
    sessionStorage.setItem("riskblue_controls_description_dismissed", "true");
  };

  // Fetch unique control IDs per category
  const { data: categoryControlIds = {}, isLoading: awpLoading } = useQuery({
    queryKey: ["controls-category-control-ids"],
    queryFn: async (): Promise<Record<CategoryKey, string[]>> => {
      const [assetsRes, systemsRes, processesRes] = await Promise.all([
        supabase.from("critical_assets").select("default_control_ids").eq("is_active", true),
        supabase.from("water_systems").select("default_control_ids").eq("is_active", true),
        supabase.from("processes").select("default_control_ids").eq("is_active", true),
      ]);

      const collectUnique = (rows: { default_control_ids: string[] }[] | null): string[] => {
        const set = new Set<string>();
        (rows || []).forEach(r => (r.default_control_ids || []).forEach(id => set.add(id)));
        return Array.from(set);
      };

      return {
        critical_assets: collectUnique(assetsRes.data),
        water_systems: collectUnique(systemsRes.data),
        processes: collectUnique(processesRes.data),
      };
    },
    enabled: !!tenantId,
  });

  const { data: allControls = [], isLoading: controlsLoading } = useQuery({
    queryKey: ["all-mitigation-controls"],
    queryFn: async (): Promise<MitigationControl[]> => {
      const { data, error } = await supabase
        .from("mitigation_controls")
        .select("id, name")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });

  // Existing selections for the active company
  const { data: existingSelections = [], isLoading: selectionsLoading } = useQuery({
    queryKey: ["company-control-selections", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_control_selections")
        .select("*")
        .eq("tenant_id", tenantId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!tenantId,
  });

  const controlMap = useMemo(() => {
    const m = new Map<string, MitigationControl>();
    allControls.forEach(c => m.set(c.id, c));
    return m;
  }, [allControls]);

  // Sync selections from the database ONCE per company load. Later local edits
  // are authoritative - a stale refetch must not overwrite in-flight changes.
  const syncedTenantRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectionsLoading) return;
    if (!tenantId) return;
    if (syncedTenantRef.current === tenantId) return;
    const map = new Map<string, string[]>();
    existingSelections.forEach((s: any) => {
      const key = `${s.category}::${s.control_id}`;
      map.set(key, (s.sub_options as string[]) || []);
      const control = controlMap.get(s.control_id);
      if (control && SPECIAL_CONTROLS[control.name]) {
        setExpandedControls(prev => new Set(prev).add(key));
      }
    });
    setSelections(map);
    syncedTenantRef.current = tenantId;
  }, [existingSelections, controlMap, tenantId, selectionsLoading]);

  const makeKey = (category: string, controlId: string) => `${category}::${controlId}`;

  // Per-key write queue: serialize writes so rapid toggles always end with the
  // user's last intended state.
  const writeQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const desiredStateRef = useRef<Map<string, string[] | null>>(new Map());

  const flushWrite = async (category: CategoryKey, controlId: string, key: string) => {
    if (!tenantId || !user) return;
    while (true) {
      const desired = desiredStateRef.current.get(key);
      if (desired === undefined) return;
      desiredStateRef.current.delete(key);

      if (desired === null) {
        const { error } = await supabase
          .from("company_control_selections")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("category", category)
          .eq("control_id", controlId);
        if (error) {
          toast.error((error as any)?.message || "Failed to remove selection");
        }
      } else {
        const { error } = await supabase.from("company_control_selections").upsert(
          {
            tenant_id: tenantId,
            company: tenant?.name || "",
            category,
            control_id: controlId,
            sub_options: desired,
            updated_by: user.id,
            created_by: user.id,
          } as any,
          { onConflict: "tenant_id,category,control_id" }
        );
        if (error) {
          toast.error((error as any)?.message || "Failed to save selection");
        }
      }
      if (!desiredStateRef.current.has(key)) return;
    }
  };

  const enqueueWrite = (category: CategoryKey, controlId: string, desired: string[] | null) => {
    const key = makeKey(category, controlId);
    desiredStateRef.current.set(key, desired);
    const prev = writeQueueRef.current.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => flushWrite(category, controlId, key));
    writeQueueRef.current.set(key, next);
  };

  const toggleControl = (category: CategoryKey, controlId: string) => {
    if (!canEdit) return;
    const key = makeKey(category, controlId);
    const isSelected = selections.has(key);
    const control = controlMap.get(controlId);
    const specialSubs = control ? SPECIAL_CONTROLS[control.name] : undefined;

    if (isSelected) {
      setSelections(prev => { const n = new Map(prev); n.delete(key); return n; });
      enqueueWrite(category, controlId, null);
    } else {
      const defaultSubs = specialSubs ? [...specialSubs] : [];
      setSelections(prev => new Map(prev).set(key, defaultSubs));
      if (specialSubs) {
        setExpandedControls(prev => new Set(prev).add(key));
      }
      enqueueWrite(category, controlId, defaultSubs);
    }
  };

  const toggleSubOption = (category: CategoryKey, controlId: string, subOption: string) => {
    if (!canEdit) return;
    const key = makeKey(category, controlId);
    const currentSubs = selections.get(key) || [];
    const newSubs = currentSubs.includes(subOption)
      ? currentSubs.filter(s => s !== subOption)
      : [...currentSubs, subOption];

    if (newSubs.length === 0) {
      setSelections(prev => { const n = new Map(prev); n.delete(key); return n; });
      enqueueWrite(category, controlId, null);
    } else {
      setSelections(prev => new Map(prev).set(key, newSubs));
      enqueueWrite(category, controlId, newSubs);
    }
  };

  const pageTitle = tenant?.name
    ? `${tenant.name}'s Marketplace Control Listing`
    : "Marketplace Control Listing";

  if (tenantLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Marketplace Control Listing" />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Marketplace Control Listing" />
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">
            Select a company to manage its Marketplace Control Listing.
          </p>
        </div>
      </div>
    );
  }

  if (awpLoading || controlsLoading || selectionsLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title={pageTitle} />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const renderControlList = (category: CategoryKey) => {
    const controlIds = (categoryControlIds as Record<CategoryKey, string[]>)[category] || [];
    const controls = allControls.filter(c => controlIds.includes(c.id));

    return controls.map(control => {
      const key = makeKey(category, control.id);
      const isSelected = selections.has(key);
      const specialSubs = SPECIAL_CONTROLS[control.name];
      const isControlExpanded = expandedControls.has(key);
      const currentSubs = selections.get(key) || [];

      if (specialSubs) {
        const allChecked = isSelected && currentSubs.length === specialSubs.length;
        const someChecked = isSelected && currentSubs.length > 0 && currentSubs.length < specialSubs.length;
        const optionCount = specialSubs.length;

        const handleParentToggle = () => {
          if (!canEdit) return;
          if (isSelected && someChecked) {
            const allSubs = [...specialSubs];
            setSelections(prev => new Map(prev).set(key, allSubs));
            enqueueWrite(category, control.id, allSubs);
          } else {
            toggleControl(category, control.id);
          }
        };

        const toggleExpanded = () => {
          setExpandedControls(prev => {
            const n = new Set(prev);
            if (n.has(key)) n.delete(key); else n.add(key);
            return n;
          });
        };

        return (
          <div key={control.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                indeterminate={someChecked}
                disabled={!canEdit}
                onCheckedChange={handleParentToggle}
              />
              <span className="text-sm cursor-pointer select-none flex-1" onClick={toggleExpanded}>
                {control.name} <span className="underline">({optionCount} option{optionCount === 1 ? "" : "s"})</span>
              </span>
              <button
                onClick={toggleExpanded}
                className="text-muted-foreground hover:text-foreground p-0.5"
                aria-label={isControlExpanded ? "Collapse options" : "Expand options"}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  className={`transition-transform ${isControlExpanded ? "rotate-180" : ""}`}
                  fill="currentColor"
                >
                  <path d="M5 7.5L1 2.5h8z" />
                </svg>
              </button>
            </div>
            {isControlExpanded && (
              <div className="ml-6 space-y-1">
                {specialSubs.map(sub => (
                  <div key={sub} className="flex items-center gap-2">
                    <Checkbox
                      checked={currentSubs.includes(sub)}
                      disabled={!canEdit}
                      onCheckedChange={() => toggleSubOption(category, control.id, sub)}
                    />
                    <span
                      className="text-sm text-muted-foreground cursor-pointer select-none"
                      onClick={() => toggleSubOption(category, control.id, sub)}
                    >
                      {sub}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }

      return (
        <div key={control.id} className="flex items-center gap-2 py-0.5">
          <Checkbox
            checked={isSelected}
            disabled={!canEdit}
            onCheckedChange={() => toggleControl(category, control.id)}
          />
          <span
            className="text-sm cursor-pointer select-none"
            onClick={() => toggleControl(category, control.id)}
          >
            {control.name}
          </span>
        </div>
      );
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title={pageTitle} />
      <main className="container mx-auto px-6 py-8">
        {showDescription && (
          <div className="bg-muted/50 p-6 rounded-lg mb-8 relative">
            <button
              onClick={handleDismissDescription}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss description"
            >
              <X className="h-4 w-4" />
            </button>
            <p className="text-sm text-foreground mb-3 pr-6">
              <strong>🛠️ This is your company's control catalog on RiskBlue.</strong>
            </p>
            <p className="text-sm text-muted-foreground whitespace-pre-line">
              {`The controls you select here determine how your company appears when General Contractors, Carriers, and Brokers build Water Mitigation Guidelines. Only the controls you offer will be shown under your company name, positioning you as a qualified vendor for those capabilities.\n\nSelecting more relevant controls increases your visibility and likelihood of being chosen for projects.`}
            </p>
          </div>
        )}

        {!canEdit && (
          <p className="text-sm text-muted-foreground mb-4">
            You have view-only access to this listing.
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
          {CATEGORIES.map(cat => (
            <div key={cat.key} className="bg-card rounded-lg border p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4">{cat.label}</h2>
              <div className="space-y-2">
                {renderControlList(cat.key)}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
