import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { useAccountType } from "@/hooks/useAccountType";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

interface AWPItem {
  id: string;
  name: string;
  default_control_ids: string[];
  category: "critical_assets" | "water_systems" | "processes";
}

interface MitigationControl {
  id: string;
  name: string;
}

// Controls with special sub-options
const SPECIAL_CONTROLS: Record<string, string[]> = {
  "Presence of Water Monitoring": ["Single (Probe)", "Area (Rope)"],
  "Automatic Shut Off Valves": ['⌀1"', '⌀2"', '⌀4"', '⌀8"'],
};

export default function Controls() {
  const { user } = useAuth();
  const { isWMSV, loading: accountLoading } = useAccountType();

  // Selected control IDs per AWP class: Map<`${awpClassName}::${controlId}`, sub_options>
  const [selections, setSelections] = useState<Map<string, string[]>>(new Map());
  const [expandedAWP, setExpandedAWP] = useState<Set<string>>(new Set());
  const [expandedControls, setExpandedControls] = useState<Set<string>>(new Set());

  // Fetch AWP items with default_control_ids
  const { data: awpItems = [], isLoading: awpLoading } = useQuery({
    queryKey: ["controls-awp-items-with-controls"],
    queryFn: async (): Promise<AWPItem[]> => {
      const [assetsRes, systemsRes, processesRes] = await Promise.all([
        supabase.from("critical_assets").select("id, name, default_control_ids").eq("is_active", true).order("display_order"),
        supabase.from("water_systems").select("id, name, default_control_ids").eq("is_active", true).order("display_order"),
        supabase.from("processes").select("id, name, default_control_ids").eq("is_active", true).order("display_order"),
      ]);
      return [
        ...(assetsRes.data || []).map(a => ({ ...a, category: "critical_assets" as const })),
        ...(systemsRes.data || []).map(s => ({ ...s, category: "water_systems" as const })),
        ...(processesRes.data || []).map(p => ({ ...p, category: "processes" as const })),
      ];
    },
  });

  // Fetch all mitigation controls
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
  });

  // Fetch existing selections
  const { data: existingSelections = [], isLoading: selectionsLoading } = useQuery({
    queryKey: ["wmsv-control-selections", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wmsv_control_selections")
        .select("*")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Build control lookup
  const controlMap = useMemo(() => {
    const m = new Map<string, MitigationControl>();
    allControls.forEach(c => m.set(c.id, c));
    return m;
  }, [allControls]);

  // Populate selections from DB
  useEffect(() => {
    if (existingSelections.length > 0) {
      const map = new Map<string, string[]>();
      existingSelections.forEach((s: any) => {
        const key = `${s.awp_class_name}::${s.control_id}`;
        map.set(key, (s.sub_options as string[]) || []);
        // Auto-expand AWP classes and special controls that have selections
        setExpandedAWP(prev => new Set(prev).add(s.awp_class_name));
        const control = controlMap.get(s.control_id);
        if (control && SPECIAL_CONTROLS[control.name]) {
          setExpandedControls(prev => new Set(prev).add(key));
        }
      });
      setSelections(map);
    }
  }, [existingSelections, controlMap]);

  const makeKey = (awpName: string, controlId: string) => `${awpName}::${controlId}`;

  const toggleControl = async (awpItem: AWPItem, controlId: string) => {
    const key = makeKey(awpItem.name, controlId);
    const isSelected = selections.has(key);
    const control = controlMap.get(controlId);
    const isSpecial = control && SPECIAL_CONTROLS[control.name];

    if (isSelected) {
      setSelections(prev => { const n = new Map(prev); n.delete(key); return n; });
      if (isSpecial) {
        setExpandedControls(prev => { const n = new Set(prev); n.delete(key); return n; });
      }
      await supabase
        .from("wmsv_control_selections")
        .delete()
        .eq("user_id", user!.id)
        .eq("awp_class_name", awpItem.name)
        .eq("control_id", controlId);
    } else {
      setSelections(prev => new Map(prev).set(key, []));
      if (isSpecial) {
        setExpandedControls(prev => new Set(prev).add(key));
      }
      await supabase.from("wmsv_control_selections").upsert({
        user_id: user!.id,
        awp_class_name: awpItem.name,
        category: awpItem.category,
        control_id: controlId,
        sub_options: [],
      } as any, { onConflict: "user_id,awp_class_name,control_id" });
    }
  };

  const toggleSubOption = async (awpItem: AWPItem, controlId: string, subOption: string) => {
    const key = makeKey(awpItem.name, controlId);
    const currentSubs = selections.get(key) || [];
    const newSubs = currentSubs.includes(subOption)
      ? currentSubs.filter(s => s !== subOption)
      : [...currentSubs, subOption];

    setSelections(prev => new Map(prev).set(key, newSubs));

    await supabase.from("wmsv_control_selections").upsert({
      user_id: user!.id,
      awp_class_name: awpItem.name,
      category: awpItem.category,
      control_id: controlId,
      sub_options: newSubs,
    } as any, { onConflict: "user_id,awp_class_name,control_id" });
  };

  if (accountLoading || awpLoading || controlsLoading || selectionsLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!isWMSV) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">You don't have access to this page.</p>
        </div>
      </div>
    );
  }

  const categories = [
    { key: "critical_assets", label: "Critical Assets" },
    { key: "water_systems", label: "Water Systems" },
    { key: "processes", label: "Contractor Processes" },
  ] as const;

  const renderAWPGroup = (awpItem: AWPItem) => {
    const controlIds = awpItem.default_control_ids || [];
    const controls = controlIds
      .map(id => controlMap.get(id))
      .filter((c): c is MitigationControl => !!c);

    if (controls.length === 0) return null;

    const isExpanded = expandedAWP.has(awpItem.name);
    const selectedCount = controls.filter(c => selections.has(makeKey(awpItem.name, c.id))).length;

    return (
      <div key={awpItem.id} className="space-y-1">
        <button
          onClick={() => setExpandedAWP(prev => {
            const n = new Set(prev);
            if (n.has(awpItem.name)) n.delete(awpItem.name); else n.add(awpItem.name);
            return n;
          })}
          className="flex items-center gap-1.5 w-full text-left hover:bg-muted/50 rounded px-1 py-1"
        >
          {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
          <span className="text-sm font-medium">{awpItem.name}</span>
          {selectedCount > 0 && (
            <span className="text-xs text-muted-foreground ml-auto">{selectedCount}/{controls.length}</span>
          )}
        </button>
        {isExpanded && (
          <div className="ml-6 space-y-1">
            {controls.map(control => {
              const key = makeKey(awpItem.name, control.id);
              const isSelected = selections.has(key);
              const specialSubs = SPECIAL_CONTROLS[control.name];
              const isControlExpanded = expandedControls.has(key);
              const currentSubs = selections.get(key) || [];

              if (specialSubs) {
                return (
                  <div key={control.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (!isSelected) {
                            toggleControl(awpItem, control.id);
                          } else {
                            setExpandedControls(prev => {
                              const n = new Set(prev);
                              if (n.has(key)) n.delete(key); else n.add(key);
                              return n;
                            });
                          }
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {isSelected && isControlExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleControl(awpItem, control.id)}
                      />
                      <span className="text-sm">{control.name}</span>
                    </div>
                    {isSelected && isControlExpanded && (
                      <div className="ml-10 space-y-1">
                        {specialSubs.map(sub => (
                          <div key={sub} className="flex items-center gap-2">
                            <Checkbox
                              checked={currentSubs.includes(sub)}
                              onCheckedChange={() => toggleSubOption(awpItem, control.id, sub)}
                            />
                            <span className="text-sm text-muted-foreground">{sub}</span>
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
                    onCheckedChange={() => toggleControl(awpItem, control.id)}
                  />
                  <span className="text-sm">{control.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold text-foreground mb-8">Risk Mitigation Controls</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {categories.map(cat => {
            const items = awpItems.filter(a => a.category === cat.key);
            return (
              <div key={cat.key} className="bg-card rounded-lg border p-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">{cat.label}</h2>
                <div className="space-y-2">
                  {items.map(renderAWPGroup)}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
