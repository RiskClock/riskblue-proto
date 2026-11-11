import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAWPOptions, groupAWPOptionsByCategory } from "@/hooks/useAWPOptions";
import { INTAKE_CONTROL_CATEGORIES } from "@/lib/intakeControlCategories";
import { SUBTYPED_CLASSES } from "@/components/CreateProjectModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight } from "lucide-react";

export type ScopeTab = "water_systems" | "assets" | "equipment_fixtures" | "controls";
export type ScopeValue = { classNames: string[]; subtypes: Record<string, string[]>; controlIds: string[]; other: Record<ScopeTab, string> };
export const EMPTY_SCOPE: ScopeValue = { classNames: [], subtypes: {}, controlIds: [], other: { water_systems: "", assets: "", equipment_fixtures: "", controls: "" } };
const TABS: { id: ScopeTab; label: string }[] = [
  { id: "water_systems", label: "Water Systems" }, { id: "assets", label: "Assets" },
  { id: "equipment_fixtures", label: "Equipment & Fixtures" }, { id: "controls", label: "Controls" },
];
const splitOther = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function useIntakeControls() {
  return useQuery({
    queryKey: ["create-project-mitigation-controls"],
    queryFn: async () => {
      const { data, error } = await supabase.from("mitigation_controls").select("id, name, category").eq("is_active", true).order("display_order");
      if (error) throw error;
      return ((data || []) as { id: string; name: string; category?: string | null }[])
        .filter((c) => INTAKE_CONTROL_CATEGORIES.has((c.category || "").trim().toLowerCase()));
    },
  });
}

export function scopeCount(v: ScopeValue) {
  const subtyped = Object.values(v.subtypes).reduce((n, s) => n + s.length, 0);
  return v.classNames.filter((c) => !SUBTYPED_CLASSES[c]).length + subtyped + v.controlIds.length
    + Object.values(v.other).reduce((n, s) => n + splitOther(s).length, 0);
}

/** Same Water Systems / Assets / Equipment & Fixtures / Controls list as the new project pop-up. */
export function ScopePicker({ value, onChange }: { value: ScopeValue; onChange: (v: ScopeValue) => void }) {
  const { data: options = [] } = useAWPOptions();
  const { data: controls = [] } = useIntakeControls();
  const [tab, setTab] = useState<ScopeTab>("water_systems");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["Kitchen Equipment", "Washroom Fixtures", "Laundry Equipment"]));
  const grouped = useMemo(() => groupAWPOptionsByCategory(options.filter((o) => ["Asset", "Water System", "Equipment & Fixtures"].includes(o.displayCategory))), [options]);
  const byTab: Record<ScopeTab, typeof options> = { water_systems: grouped["Water System"] || [], assets: grouped.Asset || [], equipment_fixtures: grouped["Equipment & Fixtures"] || [], controls: [] };
  const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const toggleSubtype = (cls: string, abbr: string) => {
    const next = toggle(value.subtypes[cls] || [], abbr);
    const subtypes = { ...value.subtypes, [cls]: next };
    const classNames = next.length ? Array.from(new Set([...value.classNames, cls])) : value.classNames.filter((c) => c !== cls);
    onChange({ ...value, subtypes, classNames });
  };
  const countFor = (t: ScopeTab) => {
    const other = splitOther(value.other[t]).length;
    if (t === "controls") return value.controlIds.length + other;
    return byTab[t].reduce((n, o) => n + (SUBTYPED_CLASSES[o.name] ? (value.subtypes[o.name]?.length || 0) : value.classNames.includes(o.name) ? 1 : 0), 0) + other;
  };
  return (
    <Tabs value={tab} onValueChange={(t) => setTab(t as ScopeTab)} className="rounded-md border border-border">
      <TabsList className="m-3 mb-0 flex h-auto flex-wrap justify-start">
        {TABS.map((t) => { const c = countFor(t.id); return <TabsTrigger key={t.id} value={t.id}>{t.label}{c ? ` (${c})` : ""}</TabsTrigger>; })}
      </TabsList>
      {TABS.map((t) => (
        <TabsContent key={t.id} value={t.id} className="m-0 space-y-4 p-4">
          <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
            {t.id === "controls" ? controls.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 text-base">
                <Checkbox checked={value.controlIds.includes(c.id)} onCheckedChange={() => onChange({ ...value, controlIds: toggle(value.controlIds, c.id) })} />{c.name}
              </label>
            )) : byTab[t.id].map((o) => {
              const defs = SUBTYPED_CLASSES[o.name];
              if (defs) {
                const open = expanded.has(o.name);
                const picked = value.subtypes[o.name] || [];
                return (
                  <div key={o.id} className="space-y-2">
                    <button type="button" className="flex w-full items-center gap-2 text-left text-base" onClick={() => setExpanded((p) => { const n = new Set(p); n.has(o.name) ? n.delete(o.name) : n.add(o.name); return n; })}>
                      {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      {o.idPrefix && <span className="font-mono text-xs text-muted-foreground">{o.idPrefix}</span>}{o.name}
                      {picked.length > 0 && <span className="text-sm text-muted-foreground">({picked.length} selected)</span>}
                    </button>
                    {open && <div className="space-y-2 pl-6">{defs.map((s) => (
                      <label key={s.abbr} className="flex cursor-pointer items-center gap-2 text-base">
                        <Checkbox checked={picked.includes(s.abbr)} onCheckedChange={() => toggleSubtype(o.name, s.abbr)} />
                        <span className="font-mono text-xs text-muted-foreground">{s.abbr}</span>{s.label}
                      </label>
                    ))}</div>}
                  </div>
                );
              }
              return (
                <label key={o.id} className="flex cursor-pointer items-center gap-2 text-base">
                  <Checkbox checked={value.classNames.includes(o.name)} onCheckedChange={() => onChange({ ...value, classNames: toggle(value.classNames, o.name) })} />
                  {o.idPrefix && <span className="font-mono text-xs text-muted-foreground">{o.idPrefix}</span>}{o.name}
                </label>
              );
            })}
          </div>
          <Input value={value.other[t.id]} onChange={(e) => onChange({ ...value, other: { ...value.other, [t.id]: e.target.value } })} placeholder={`Other ${t.label.toLowerCase()} (comma-separate to add multiple)`} className="text-base md:text-base" />
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** Column values matching what the new project pop-up saves for its scope list. */
export function scopeColumns(v: ScopeValue, controls: { id: string; name: string }[]) {
  const controlNames = controls.filter((c) => v.controlIds.includes(c.id)).map((c) => c.name);
  const other = Object.fromEntries(Object.entries(v.other).map(([k, s]) => [k, splitOther(s)])) as Record<ScopeTab, string[]>;
  return {
    selected_awp_class_names: v.classNames,
    selected_other_classes: [...Object.values(other).flat(), ...controlNames],
    selected_awp_subtypes: Object.fromEntries(Object.entries(v.subtypes).filter(([, s]) => s.length)),
    intake_identify_selections: { controls: controlNames, other },
  };
}
