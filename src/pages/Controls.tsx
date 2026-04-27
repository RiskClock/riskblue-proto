import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useAccountType } from "@/hooks/useAccountType";
import { Loader2, ShieldCheck, Mail, CheckCircle2 } from "lucide-react";
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

const REQUEST_STORAGE_KEY = (userId: string) => `control-library-access-requested:${userId}`;

export default function Controls() {
  const { user } = useAuth();
  const { isWMSV, company, loading: accountLoading } = useAccountType();

  // Selections: Map<`${category}::${controlId}`, sub_options[]>
  const [selections, setSelections] = useState<Map<string, string[]>>(new Map());
  const [expandedControls, setExpandedControls] = useState<Set<string>>(new Set());
  const [requesting, setRequesting] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);

  const hasCompany = !!(company && company.trim());
  const showAccessGate = !accountLoading && isWMSV && !hasCompany;

  useEffect(() => {
    if (user?.id) {
      setHasRequested(localStorage.getItem(REQUEST_STORAGE_KEY(user.id)) === "1");
    }
  }, [user?.id]);

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
    enabled: !showAccessGate,
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
    enabled: !showAccessGate,
  });

  // Fetch existing selections for the user's company
  const { data: existingSelections = [], isLoading: selectionsLoading } = useQuery({
    queryKey: ["company-control-selections", company],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_control_selections")
        .select("*")
        .ilike("company", company!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && hasCompany,
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

  const upsertSelection = async (category: CategoryKey, controlId: string, subs: string[]) => {
    if (!company || !user) return;
    await supabase.from("company_control_selections").upsert(
      {
        company,
        category,
        control_id: controlId,
        sub_options: subs,
        updated_by: user.id,
        created_by: user.id,
      },
      { onConflict: "company,category,control_id" }
    );
  };

  const removeSelection = async (category: CategoryKey, controlId: string) => {
    if (!company) return;
    await supabase
      .from("company_control_selections")
      .delete()
      .ilike("company", company)
      .eq("category", category)
      .eq("control_id", controlId);
  };

  const toggleControl = async (category: CategoryKey, controlId: string) => {
    const key = makeKey(category, controlId);
    const isSelected = selections.has(key);
    const control = controlMap.get(controlId);
    const specialSubs = control ? SPECIAL_CONTROLS[control.name] : undefined;

    if (isSelected) {
      setSelections(prev => { const n = new Map(prev); n.delete(key); return n; });
      await removeSelection(category, controlId);
    } else {
      const defaultSubs = specialSubs ? [...specialSubs] : [];
      setSelections(prev => new Map(prev).set(key, defaultSubs));
      if (specialSubs) {
        setExpandedControls(prev => new Set(prev).add(key));
      }
      await upsertSelection(category, controlId, defaultSubs);
    }
  };

  const toggleSubOption = async (category: CategoryKey, controlId: string, subOption: string) => {
    const key = makeKey(category, controlId);
    const currentSubs = selections.get(key) || [];
    const newSubs = currentSubs.includes(subOption)
      ? currentSubs.filter(s => s !== subOption)
      : [...currentSubs, subOption];

    if (newSubs.length === 0) {
      setSelections(prev => { const n = new Map(prev); n.delete(key); return n; });
      await removeSelection(category, controlId);
    } else {
      setSelections(prev => new Map(prev).set(key, newSubs));
      await upsertSelection(category, controlId, newSubs);
    }
  };

  const handleRequestAccess = async () => {
    if (!user) return;
    setRequesting(true);
    try {
      const fullName = (user.user_metadata?.display_name as string) || user.email?.split("@")[0] || "Unknown";
      const workEmail = user.email || "";

      // Persist request (idempotent-ish: insert one row)
      await supabase.from("access_requests").insert({
        full_name: fullName,
        work_email: workEmail,
        company_name: company || "(not set)",
        request_type: "control_library",
        requesting_user_id: user.id,
        status: "pending",
      } as any);

      const { error } = await supabase.functions.invoke("notify-access-request", {
        body: {
          fullName,
          workEmail,
          companyName: company || "",
          requestType: "control_library",
          context: "WMSV user without company tried to access the Control Library page.",
        },
      });
      if (error) throw error;

      localStorage.setItem(REQUEST_STORAGE_KEY(user.id), "1");
      setHasRequested(true);
      toast.success("Request sent. We'll be in touch shortly.");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to send request");
    } finally {
      setRequesting(false);
    }
  };

  if (accountLoading) {
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

  // WMSV but no company → show access gate modal
  if (showAccessGate) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <Dialog open={true} onOpenChange={() => { /* non-dismissable */ }}>
          <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
            <DialogHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                </div>
                <DialogTitle className="text-lg">Control Library</DialogTitle>
              </div>
              <DialogDescription className="text-sm leading-relaxed pt-2 space-y-3">
                <p>
                  The Control Library lets your company specify which water mitigation
                  controls you can offer end customers. Your selections are surfaced inside
                  RiskBlue's Water Mitigation Guideline (WMG) builder, so when a project
                  needs a control your company supports, you appear as an available vendor.
                </p>
                <p className="text-foreground font-medium">
                  Your account isn't yet configured to manage a company's Control Library.
                </p>
                <p>
                  Request access and we'll set up your company so you can start managing your
                  offered controls.
                </p>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-2">
              {hasRequested ? (
                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Access requested. We'll reach out soon.</span>
                </div>
              ) : (
                <Button onClick={handleRequestAccess} disabled={requesting} className="gap-2">
                  {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  {requesting ? "Sending request…" : "Request access"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (awpLoading || controlsLoading || selectionsLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
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

        const handleParentToggle = async () => {
          if (isSelected && allChecked) {
            await toggleControl(category, control.id);
          } else if (isSelected && someChecked) {
            const allSubs = [...specialSubs];
            setSelections(prev => new Map(prev).set(key, allSubs));
            await upsertSelection(category, control.id, allSubs);
          } else {
            await toggleControl(category, control.id);
          }
        };

        return (
          <div key={control.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                indeterminate={someChecked}
                onCheckedChange={handleParentToggle}
              />
              <span
                className="text-sm cursor-pointer select-none flex-1"
                onClick={handleParentToggle}
              >
                {control.name} <span className="underline">({optionCount} option{optionCount === 1 ? "" : "s"})</span>
              </span>
              <button
                onClick={() => {
                  setExpandedControls(prev => {
                    const n = new Set(prev);
                    if (n.has(key)) n.delete(key); else n.add(key);
                    return n;
                  });
                }}
                className="text-muted-foreground hover:text-foreground p-0.5"
                aria-label={isControlExpanded ? "Collapse options" : "Expand options"}
              >
                {/* Triangle icon - rotates when expanded */}
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
      <AppHeader />
      <main className="container mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold text-foreground mb-8">{company ? `${company}'s Control Library` : "Control Library"}</h1>
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
