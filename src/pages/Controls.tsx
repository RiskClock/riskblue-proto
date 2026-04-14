import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { useAccountType } from "@/hooks/useAccountType";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AWPItem {
  id: string;
  name: string;
  category: "critical_assets" | "water_systems" | "processes";
}

interface ControlSelection {
  awp_class_name: string;
  category: string;
  sub_options: string[];
}

// Items with special dropdown sub-options
const SPECIAL_ITEMS: Record<string, { label: string; subOptions: string[] }> = {
  "Presence of Water Monitoring": {
    label: "Presence of Water Monitoring",
    subOptions: ["Single (Probe)", "Area (Rope)"],
  },
  "Automatic Shut Off Valves": {
    label: "Automatic Shut Off Valves",
    subOptions: ['⌀1"', '⌀2"', '⌀4"', '⌀8"'],
  },
};

export default function Controls() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isWMSV, loading: accountLoading } = useAccountType();
  const queryClient = useQueryClient();

  const [selections, setSelections] = useState<Map<string, ControlSelection>>(new Map());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Fetch AWP items (same as Configuration page)
  const { data: awpItems = [], isLoading: awpLoading } = useQuery({
    queryKey: ["controls-awp-items"],
    queryFn: async (): Promise<AWPItem[]> => {
      const [assetsRes, systemsRes, processesRes] = await Promise.all([
        supabase.from("critical_assets").select("id, name").eq("is_active", true).order("display_order"),
        supabase.from("water_systems").select("id, name").eq("is_active", true).order("display_order"),
        supabase.from("processes").select("id, name").eq("is_active", true).order("display_order"),
      ]);
      return [
        ...(assetsRes.data || []).map(a => ({ ...a, category: "critical_assets" as const })),
        ...(systemsRes.data || []).map(s => ({ ...s, category: "water_systems" as const })),
        ...(processesRes.data || []).map(p => ({ ...p, category: "processes" as const })),
      ];
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

  // Populate selections from DB on load
  useEffect(() => {
    if (existingSelections.length > 0) {
      const map = new Map<string, ControlSelection>();
      existingSelections.forEach((s: any) => {
        map.set(s.awp_class_name, {
          awp_class_name: s.awp_class_name,
          category: s.category,
          sub_options: (s.sub_options as string[]) || [],
        });
        // Auto-expand special items that have selections
        if (SPECIAL_ITEMS[s.awp_class_name]) {
          setExpandedItems(prev => new Set(prev).add(s.awp_class_name));
        }
      });
      setSelections(map);
    }
  }, [existingSelections]);

  const categoryMap: Record<string, string> = {
    critical_assets: "critical_assets",
    water_systems: "water_systems",
    processes: "processes",
  };

  const toggleSelection = async (item: AWPItem) => {
    const isSpecial = !!SPECIAL_ITEMS[item.name];
    const isSelected = selections.has(item.name);

    if (isSelected) {
      // Remove
      setSelections(prev => {
        const next = new Map(prev);
        next.delete(item.name);
        return next;
      });
      if (isSpecial) {
        setExpandedItems(prev => {
          const next = new Set(prev);
          next.delete(item.name);
          return next;
        });
      }
      await supabase
        .from("wmsv_control_selections")
        .delete()
        .eq("user_id", user!.id)
        .eq("awp_class_name", item.name);
    } else {
      // Add
      const sel: ControlSelection = {
        awp_class_name: item.name,
        category: categoryMap[item.category],
        sub_options: [],
      };
      setSelections(prev => new Map(prev).set(item.name, sel));
      if (isSpecial) {
        setExpandedItems(prev => new Set(prev).add(item.name));
      }
      await supabase.from("wmsv_control_selections").upsert({
        user_id: user!.id,
        awp_class_name: item.name,
        category: categoryMap[item.category],
        sub_options: [],
      }, { onConflict: "user_id,awp_class_name" });
    }
  };

  const toggleSubOption = async (itemName: string, subOption: string, category: string) => {
    const existing = selections.get(itemName);
    const currentSubs = existing?.sub_options || [];
    const newSubs = currentSubs.includes(subOption)
      ? currentSubs.filter(s => s !== subOption)
      : [...currentSubs, subOption];

    const sel: ControlSelection = {
      awp_class_name: itemName,
      category,
      sub_options: newSubs,
    };
    setSelections(prev => new Map(prev).set(itemName, sel));

    // If no sub-options left, keep the parent selected but with empty sub_options
    await supabase.from("wmsv_control_selections").upsert({
      user_id: user!.id,
      awp_class_name: itemName,
      category,
      sub_options: newSubs,
    }, { onConflict: "user_id,awp_class_name" });
  };

  const toggleExpand = (name: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (accountLoading || awpLoading || selectionsLoading) {
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

  const criticalAssets = awpItems.filter(a => a.category === "critical_assets");
  const waterSystems = awpItems.filter(a => a.category === "water_systems");
  const processes = awpItems.filter(a => a.category === "processes");

  const renderItem = (item: AWPItem) => {
    const isSpecial = !!SPECIAL_ITEMS[item.name];
    const isSelected = selections.has(item.name);
    const isExpanded = expandedItems.has(item.name);
    const specialConfig = SPECIAL_ITEMS[item.name];
    const currentSubs = selections.get(item.name)?.sub_options || [];

    if (isSpecial) {
      return (
        <div key={item.id} className="space-y-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!isSelected) {
                  toggleSelection(item);
                } else {
                  toggleExpand(item.name);
                }
              }}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              {isSelected && isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleSelection(item)}
            />
            <span className="text-sm">{item.name}</span>
          </div>
          {isSelected && isExpanded && specialConfig && (
            <div className="ml-10 space-y-1">
              {specialConfig.subOptions.map(sub => (
                <div key={sub} className="flex items-center gap-2">
                  <Checkbox
                    checked={currentSubs.includes(sub)}
                    onCheckedChange={() => toggleSubOption(item.name, sub, categoryMap[item.category])}
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
      <div key={item.id} className="flex items-center gap-2 py-1">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => toggleSelection(item)}
        />
        <span className="text-sm">{item.name}</span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold text-foreground mb-8">Risk Mitigation Controls</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Critical Assets */}
          <div className="bg-card rounded-lg border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Critical Assets</h2>
            <div className="space-y-2">
              {criticalAssets.map(renderItem)}
            </div>
          </div>

          {/* Water Systems */}
          <div className="bg-card rounded-lg border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Water Systems</h2>
            <div className="space-y-2">
              {waterSystems.map(renderItem)}
            </div>
          </div>

          {/* Contractor Processes */}
          <div className="bg-card rounded-lg border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Contractor Processes</h2>
            <div className="space-y-2">
              {processes.map(renderItem)}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
