import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface ProjectDatasetOption {
  id: string;
  name: string;
  eligible: boolean;
}

/**
 * Lists all projects and flags whether the given AWP class is selected in the
 * project's workbench columns (falling back to the classes picked at project
 * creation when no workbench preference row exists).
 */
export function useProjectDatasetOptions(className: string | null | undefined) {
  return useQuery({
    queryKey: ["refinery-project-dataset-options", className ?? ""],
    queryFn: async (): Promise<ProjectDatasetOption[]> => {
      const [projectsRes, prefsRes] = await Promise.all([
        supabase
          .from("projects")
          .select("id, name, selected_awp_class_names, selected_other_classes")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("workbench_column_preferences").select("id, awp_class_names"),
      ]);
      if (projectsRes.error) throw projectsRes.error;

      const prefMap = new Map<string, string[]>();
      for (const row of (prefsRes.data as any[]) ?? []) {
        prefMap.set(String(row.id), (row.awp_class_names as string[]) || []);
      }

      return ((projectsRes.data as any[]) ?? []).map((p) => {
        const pref = prefMap.get(String(p.id));
        const classes =
          pref ??
          [
            ...(((p.selected_awp_class_names as string[]) || [])),
            ...(((p.selected_other_classes as string[]) || [])),
          ];
        return {
          id: p.id as string,
          name: (p.name as string) || "Untitled project",
          eligible: !!className && classes.includes(className),
        };
      });
    },
  });
}

export function ProjectDatasetPicker({
  className,
  selected,
  onChange,
  emptyLabel = "No projects found.",
}: {
  className: string | null | undefined;
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyLabel?: string;
}) {
  const { data: options = [], isLoading } = useProjectDatasetOptions(className);

  const eligibleIds = useMemo(
    () => options.filter((o) => o.eligible).map((o) => o.id),
    [options],
  );
  const eligibleCount = eligibleIds.length;
  const selectedEligible = useMemo(
    () => eligibleIds.filter((id) => selected.includes(id)),
    [eligibleIds, selected],
  );
  const allChecked = eligibleCount > 0 && selectedEligible.length === eligibleCount;
  const someChecked = selectedEligible.length > 0 && !allChecked;

  const toggle = (id: string) => {
    onChange(
      selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id],
    );
  };

  const toggleAll = () => {
    if (allChecked) onChange(selected.filter((id) => !eligibleIds.includes(id)));
    else onChange(Array.from(new Set([...selected, ...eligibleIds])));
  };

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between px-3 py-2 border-b text-xs text-muted-foreground">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={allChecked ? true : someChecked ? "indeterminate" : false}
            disabled={eligibleCount === 0}
            onCheckedChange={toggleAll}
          />
          <span>{allChecked ? "Unselect all" : "Select all"}</span>
          <span>· {selected.length} selected</span>
        </label>
        <span>
          {eligibleCount} of {options.length} project
          {options.length === 1 ? "" : "s"} include this class
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto divide-y">
        {isLoading && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
          </div>
        )}
        {!isLoading && options.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</div>
        )}
        {options.map((o) => (
          <label
            key={o.id}
            className={cn(
              "flex items-center gap-3 px-3 py-2 text-sm",
              o.eligible ? "cursor-pointer hover:bg-muted/40" : "cursor-not-allowed",
            )}
            title={
              o.eligible
                ? undefined
                : "This class is not selected in this project's workbench columns"
            }
          >
            <Checkbox
              checked={selected.includes(o.id)}
              disabled={!o.eligible}
              onCheckedChange={() => o.eligible && toggle(o.id)}
            />
            <span
              className={cn(
                "truncate flex-1",
                o.eligible ? "text-foreground" : "text-muted-foreground/50",
              )}
            >
              {o.name}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default ProjectDatasetPicker;
