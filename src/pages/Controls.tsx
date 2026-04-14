import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { useAccountType } from "@/hooks/useAccountType";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

interface MitigationControl {
  id: string;
  name: string;
}

const SPECIAL_CONTROLS: Record<string, string[]> = {
  "Presence of Water Monitoring": ["Single (Probe)", "Area (Rope)"],
  "Automatic Shut Off Valves": ['⌀1"', '⌀2"', '⌀4"', '⌀8"'],
};

const CATEGORIES = [
  { key: "critical_assets", label: "Critical Assets", table: "critical_assets" },
  { key: "water_systems", label: "Water Systems", table: "water_systems" },
  { key: "processes", label: "Contractor Processes", table: "processes" },
] as const;

type CategoryKey = typeof CATEGORIES[number]["key"];

export default function Controls() {
  const { user } = useAuth();
  const { isWMSV, loading: accountLoading } = useAccountType();

  // Selections: Map<`${category}::${controlId}`, sub_options[]>
  const [selections, setSelections] = useState<Map<string, string[]>>(new Map());
  const [expandedControls, setExpandedControls] = useState<Set<string>>(new Set());

  // Fetch unique control IDs per category from the three tables
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
        const key = `${s.category}::${s.control_id}`;
        map.set(key, (s.sub_options as string[]) || []);
        const control = controlMap.get(s.control_id);
        if (control && SPECIAL_CONTROLS[control.name]) {
          setExpandedControls(prev => new Set(prev).add(key));
        }
      });
      setSelections(map);
    }
  }, [existingSelections, controlMap]);

  const makeKey = (category: string, controlId: string) => `${category}::${controlId}`;

  const toggleControl = async (category: CategoryKey, controlId: string) => {
    const key = makeKey(category, controlId);
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
        .eq("category", category)
        .eq("control_id", controlId);
    } else {
      setSelections(prev => new Map(prev).set(key, []));
      if (isSpecial) {
        setExpandedControls(prev => new Set(prev).add(key));
      }
      await supabase.from("wmsv_control_selections").upsert({
        user_id: user!.id,
        awp_class_name: category,
        category,
        control_id: controlId,
        sub_options: [],
      } as any, { onConflict: "user_id,category,control_id" });
    }
  };

  const toggleSubOption = async (category: CategoryKey, controlId: string, subOption: string) => {
    const key = makeKey(category, controlId);
    const currentSubs = selections.get(key) || [];
    const newSubs = currentSubs.includes(subOption)
      ? currentSubs.filter(s => s !== subOption)
      : [...currentSubs, subOption];

    setSelections(prev => new Map(prev).set(key, newSubs));

    await supabase.from("wmsv_control_selections").upsert({
      user_id: user!.id,
      awp_class_name: category,
      category,
      control_id: controlId,
      sub_options: newSubs,
    } as any, { onConflict: "user_id,category,control_id" });
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

  const renderControlList = (category: CategoryKey) => {
    const controlIds = (categoryControlIds as Record<CategoryKey, string[]>)[category] || [];
    // Maintain display_order from allControls
    const controls = allControls.filter(c => controlIds.includes(c.id));

    return controls.map(control => {
      const key = makeKey(category, control.id);
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
                    toggleControl(category, control.id);
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
                onCheckedChange={() => toggleControl(category, control.id)}
              />
              <span className="text-sm">{control.name}</span>
            </div>
            {isSelected && isControlExpanded && (
              <div className="ml-10 space-y-1">
                {specialSubs.map(sub => (
                  <div key={sub} className="flex items-center gap-2">
                    <Checkbox
                      checked={currentSubs.includes(sub)}
                      onCheckedChange={() => toggleSubOption(category, control.id, sub)}
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
            onCheckedChange={() => toggleControl(category, control.id)}
          />
          <span className="text-sm">{control.name}</span>
        </div>
      );
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold text-foreground mb-8">Risk Mitigation Controls</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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
