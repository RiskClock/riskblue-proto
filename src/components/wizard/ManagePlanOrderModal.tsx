import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GripVertical, Plus, Trash2, X as XIcon } from "lucide-react";
import {
  getEffectiveBbox,
  getEffectiveLabel,
  type ParsedFloorPlan,
} from "@/lib/surveyFloorPlans";
import { awpClassColor } from "@/lib/awpColor";

const TYPE_LABELS: Record<string, string> = {
  level_floor_plan: "Level floor plan",
  unit_floor_plan: "Unit floor plan",
  schematic_level_row: "Schematic level row",
  typical_detail_block: "Typical detail block",
};

const TYPE_RANK: Record<string, number> = {
  level_floor_plan: 0,
  schematic_level_row: 1,
  unit_floor_plan: 2,
  typical_detail_block: 3,
};

type SortKey = "name" | "type" | "coordinate";

interface Row {
  planId: string;
  label: string;
  type: string;
  x: number;
  y: number;
}

export interface ManagePlanOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plans: ParsedFloorPlan[];
  overrides: Record<string, any>;
  /** Persist the new order (full list of plan ids, in order). */
  onSaveOrder: (planIds: string[]) => Promise<void> | void;
  /** Delete a plan from the page. Called once per removed row on save. */
  onDeletePlan?: (planId: string) => Promise<void> | void;
  /** Start the "add bounding box" flow. Closes this modal first. */
  onAddPlan?: () => Promise<void> | void;
}

export const ManagePlanOrderModal = ({
  open,
  onOpenChange,
  plans,
  overrides,
  onSaveOrder,
  onDeletePlan,
  onAddPlan,
}: ManagePlanOrderModalProps) => {
  const initialRows = useMemo<Row[]>(
    () =>
      plans.map((fp) => {
        const ovr = overrides?.[fp.plan_id] ?? {};
        const type =
          typeof ovr.type === "string" && ovr.type ? ovr.type : fp.type;
        const bb = getEffectiveBbox(fp, overrides);
        return {
          planId: fp.plan_id,
          label: getEffectiveLabel(fp, overrides) || fp.reference_id || fp.plan_id,
          type,
          x: bb ? bb[0] : Number.POSITIVE_INFINITY,
          y: bb ? bb[1] : Number.POSITIVE_INFINITY,
        };
      }),
    [plans, overrides],
  );

  const [rows, setRows] = useState<Row[]>(initialRows);
  const [removed, setRemoved] = useState<Row[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setRows(initialRows);
      setRemoved([]);
      setSort(null);
      setDragIndex(null);
    }
  }, [open, initialRows]);

  const applySort = (key: SortKey) => {
    const asc = sort?.key === key ? !sort.asc : true;
    const dir = asc ? 1 : -1;
    const byName = (a: Row, b: Row) =>
      a.label.localeCompare(b.label, undefined, { numeric: true });
    const byCoord = (a: Row, b: Row) => a.y - b.y || a.x - b.x;
    const byType = (a: Row, b: Row) =>
      (TYPE_RANK[a.type] ?? 99) - (TYPE_RANK[b.type] ?? 99);
    const cmp =
      key === "name"
        ? (a: Row, b: Row) => byName(a, b) || byCoord(a, b)
        : key === "type"
          ? (a: Row, b: Row) => byType(a, b) || byName(a, b)
          : (a: Row, b: Row) => byCoord(a, b) || byName(a, b);
    setRows((prev) => prev.slice().sort((a, b) => cmp(a, b) * dir));
    setSort({ key, asc });
  };

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= rows.length) return;
    setRows((prev) => {
      const next = prev.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const r of removed) {
        await onDeletePlan?.(r.planId);
      }
      await onSaveOrder(rows.map((r) => r.planId));
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage order</DialogTitle>
          <DialogDescription>
            Drag to reorder the bounding boxes on this page, or sort them by
            name, type or position. Changes apply when you save.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[11px] text-muted-foreground mr-1">Sort by</span>
          {(["name", "type", "coordinate"] as SortKey[]).map((k) => (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={sort?.key === k ? "default" : "outline"}
              className="h-7 px-2 text-[11px] capitalize"
              onClick={() => applySort(k)}
            >
              {k}
              {sort?.key === k ? (sort.asc ? " ↑" : " ↓") : ""}
            </Button>
          ))}
          {onAddPlan && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px] ml-auto gap-1"
              onClick={async () => {
                onOpenChange(false);
                await onAddPlan();
              }}
            >
              <Plus className="h-3 w-3" />
              Add
            </Button>
          )}
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-md border divide-y">
          {rows.length === 0 && (
            <div className="p-3 text-xs italic text-muted-foreground">
              No bounding boxes on this page.
            </div>
          )}
          {rows.map((r, idx) => {
            const color = awpClassColor(
              r.type === "unit_floor_plan" ? "Unit Floor Plan" : "Level Floor Plan",
            );
            return (
              <div
                key={r.planId}
                draggable
                onDragStart={() => setDragIndex(idx)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null && dragIndex !== idx) {
                    move(dragIndex, idx);
                    setDragIndex(idx);
                  }
                }}
                onDragEnd={() => setDragIndex(null)}
                className={`flex items-center gap-2 px-2 py-1.5 text-xs bg-background ${
                  dragIndex === idx ? "opacity-60" : ""
                }`}
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab shrink-0" />
                <span className="w-5 text-[10px] tabular-nums text-muted-foreground shrink-0">
                  {idx + 1}
                </span>
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="flex-1 min-w-0 truncate" title={r.label}>
                  {r.label}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {TYPE_LABELS[r.type] ?? r.type}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground shrink-0 w-20 text-right">
                  {Number.isFinite(r.x)
                    ? `${Math.round(r.x)}, ${Math.round(r.y)}`
                    : "-"}
                </span>
                {onDeletePlan && (
                  <button
                    type="button"
                    aria-label={`Delete ${r.label}`}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setRows((prev) => prev.filter((p) => p.planId !== r.planId));
                      setRemoved((prev) => [...prev, r]);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {removed.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 space-y-1">
            <div className="text-[11px] font-medium text-destructive">
              {removed.length} bounding box{removed.length === 1 ? "" : "es"} will
              be deleted on save
            </div>
            <div className="flex flex-wrap gap-1">
              {removed.map((r) => (
                <span
                  key={r.planId}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px]"
                >
                  {r.label}
                  <button
                    type="button"
                    aria-label={`Restore ${r.label}`}
                    onClick={() => {
                      setRemoved((prev) =>
                        prev.filter((p) => p.planId !== r.planId),
                      );
                      setRows((prev) => [...prev, r]);
                    }}
                    className="hover:opacity-70"
                  >
                    <XIcon className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManagePlanOrderModal;
