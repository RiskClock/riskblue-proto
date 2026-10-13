import { useState } from "react";
import { Settings2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ColumnPreferences<T extends string> = { order: T[]; visible: Record<T, boolean> };

export function ColumnEditDropdown<T extends string>({ columns, columnPrefs, onChange, lockedColumns = [], reorderable = true }: {
  columns: { id: T; label: string }[];
  columnPrefs: ColumnPreferences<T>;
  onChange: (next: ColumnPreferences<T>) => void;
  lockedColumns?: T[];
  reorderable?: boolean;
}) {
  const [dragId, setDragId] = useState<T | null>(null);
  const [overId, setOverId] = useState<T | null>(null);
  const resetDrag = () => { setDragId(null); setOverId(null); };
  const drop = (target: T) => {
    if (!dragId || dragId === target || lockedColumns.includes(target)) { resetDrag(); return; }
    const order = [...columnPrefs.order];
    const from = order.indexOf(dragId), to = order.indexOf(target);
    if (from < 0 || to < 0) { resetDrag(); return; }
    order.splice(from, 1);
    order.splice(to, 0, dragId);
    onChange({ ...columnPrefs, order: [...lockedColumns, ...order.filter(id => !lockedColumns.includes(id))] });
    resetDrag();
  };
  return <Popover>
    <PopoverTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8" title="Edit columns" aria-label="Edit columns"><Settings2 className="h-4 w-4" /></Button></PopoverTrigger>
    <PopoverContent align="end" className="w-64 p-2">
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{reorderable ? "Show & reorder columns" : "Show columns"}</div>
      <div className="space-y-0.5">{columnPrefs.order.filter(id => columns.some(c => c.id === id)).map(id => {
        const locked = lockedColumns.includes(id);
        const label = columns.find(c => c.id === id)?.label || id;
        return <div key={id} data-column-id={id} draggable={reorderable && !locked}
          onDragStart={e => { setDragId(id); e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; }}
          onDragOver={e => { if (locked || !dragId) return; e.preventDefault(); setOverId(id); }}
          onDragLeave={() => setOverId(null)} onDrop={e => { e.preventDefault(); drop(id); }} onDragEnd={resetDrag}
          className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm select-none", !locked && "hover:bg-accent hover:text-accent-foreground", reorderable && !locked && "cursor-grab active:cursor-grabbing", overId === id && "ring-1 ring-primary", dragId === id && "opacity-50")}>
          {reorderable && <GripVertical className={cn("h-4 w-4 shrink-0 text-muted-foreground", locked && "opacity-25")} />}
          <Checkbox aria-label={label} checked={columnPrefs.visible[id]} disabled={locked} onCheckedChange={checked => onChange({ ...columnPrefs, visible: { ...columnPrefs.visible, [id]: checked === true } })} />
          <span className={cn("flex-1", locked && "text-muted-foreground")}>{label}</span>
        </div>;
      })}</div>
    </PopoverContent>
  </Popover>;
}