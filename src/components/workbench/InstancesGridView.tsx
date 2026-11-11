import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { DeviceButton, randomPlanColor, type DevicesApi } from "@/components/wizard/FileViewerModal";
import { assignmentKeyFor, useDrawingPlans, type DrawingPlan } from "@/components/wizard/useDrawingPlans";
import { SHARED_GROUP_KEY, UNASSIGNED_GROUP_KEY, type SpaceGroup } from "@/lib/threatReportBuildings";
import { addRange, cellId, rectCells, toggleCell, type GridPoint } from "@/lib/instanceGridSelection";

export interface InstanceGridRow {
  awpClassName: string;
  category: string;
  spaceName: string | null;
  fileId: string;
  pageIndex: number;
  logicalKey: string;
  annotationBaseId: string;
  sourceIds: string[];
  pipeType: string | null;
  pipeDiameter: string | null;
}

export interface InstanceGridEntry {
  key: string;
  canonicalName: string;
  displayName: string;
  displayPrefix: string;
}

interface Props {
  projectId: string;
  loading: boolean;
  rows: InstanceGridRow[];
  entries: InstanceGridEntry[];
  entryKeyForRow: (r: any) => string;
  levelNames: Set<string>;
  spaceList: string[];
  spaceGroups: SpaceGroup[] | null;
  spaceShortLabel: Map<string, string>;
  fileNameById: Map<string, string>;
  pageCountByFileId: Map<string, number>;
  /** "fileName::page" -> levels shown on that page. */
  pageLevelsByKey: Map<string, string[]>;
  canEdit: boolean;
  onOpenDrawing: (fileId: string, page: number) => void;
}

type Cell = { count: number; ids: Set<string> };
type VisibleRow = { key: string; label: string; kind: "group" | "space"; spaces: string[]; groupKey?: string };

const UNASSIGNED = "__unassigned__";

export function InstancesGridView(props: Props) {
  const { projectId, loading, rows, entries, entryKeyForRow, levelNames, spaceList, spaceGroups, spaceShortLabel, fileNameById, pageCountByFileId, pageLevelsByKey, canEdit, onOpenDrawing } = props;
  const { toast } = useToast();
  const drawingPlans = useDrawingPlans(projectId, true);

  const { data: companyName } = useQuery({
    queryKey: ["instances-view-company", projectId],
    queryFn: async () => {
      const { data: p } = await supabase.from("projects").select("tenant_id").eq("id", projectId).maybeSingle();
      const tid = (p as any)?.tenant_id as string | null;
      if (!tid) return null;
      const { data: t } = await supabase.from("tenants").select("name").eq("id", tid).maybeSingle();
      return ((t as any)?.name as string) ?? null;
    },
  });

  const entryKeys = useMemo(() => entries.map((e) => e.key), [entries]);
  const entrySet = useMemo(() => new Set(entryKeys), [entryKeys]);
  const spaceOf = useCallback(
    (r: InstanceGridRow) => (r.spaceName && levelNames.has(r.spaceName) ? r.spaceName : UNASSIGNED),
    [levelNames],
  );

  // Counts per space and entry. Consolidated instances count once per cell.
  const aggregate = useCallback(
    (filter: (r: InstanceGridRow) => boolean) => {
      const out = new Map<string, Cell>();
      const seen = new Set<string>();
      for (const r of rows) {
        if (!filter(r)) continue;
        const key = entryKeyForRow(r);
        if (!entrySet.has(key)) continue;
        const cell = out.get(key) ?? { count: 0, ids: new Set<string>() };
        r.sourceIds.forEach((id) => cell.ids.add(id));
        if (r.logicalKey.startsWith("cons::")) {
          const dedup = `${key}::${r.annotationBaseId}`;
          if (seen.has(dedup)) { out.set(key, cell); continue; }
          seen.add(dedup);
        }
        cell.count += 1;
        out.set(key, cell);
      }
      return out;
    },
    [rows, entryKeyForRow, entrySet],
  );

  const groups = spaceGroups && spaceGroups.length > 0 ? spaceGroups : null;
  const buildingCount = groups ? groups.filter((g) => g.key !== SHARED_GROUP_KEY && g.key !== UNASSIGNED_GROUP_KEY).length : 0;

  const cellsByRow = useMemo(() => {
    const m = new Map<string, Map<string, Cell>>();
    m.set("__total__", aggregate(() => true));
    for (const s of spaceList) m.set(`space:${s}`, aggregate((r) => spaceOf(r) === s));
    for (const g of groups ?? []) {
      const set = new Set(g.spaces);
      m.set(`group:${g.key}`, aggregate((r) => set.has(spaceOf(r))));
    }
    return m;
  }, [aggregate, spaceList, groups, spaceOf]);

  // Drawings referenced by each space: pages linked to the level plus pages holding its detections.
  const fileIdByName = useMemo(() => new Map(Array.from(fileNameById.entries()).map(([id, n]) => [n, id])), [fileNameById]);
  const drawingsBySpace = useMemo(() => {
    const m = new Map<string, Map<string, { fileId: string; page: number }>>();
    const add = (space: string, fileId: string, page: number) => {
      const inner = m.get(space) ?? new Map();
      inner.set(`${fileId}::${page}`, { fileId, page });
      m.set(space, inner);
    };
    for (const [key, levels] of pageLevelsByKey) {
      const idx = key.lastIndexOf("::");
      const fileId = fileIdByName.get(key.slice(0, idx));
      const page = Number(key.slice(idx + 2));
      if (!fileId || !Number.isFinite(page)) continue;
      levels.forEach((l) => add(levelNames.has(l) ? l : UNASSIGNED, fileId, page));
    }
    for (const r of rows) add(spaceOf(r), r.fileId, r.pageIndex);
    return m;
  }, [pageLevelsByKey, fileIdByName, rows, spaceOf, levelNames]);
  const drawingsFor = useCallback(
    (spaces: string[]) => {
      const out = new Map<string, { fileId: string; page: number }>();
      spaces.forEach((s) => drawingsBySpace.get(s)?.forEach((v, k) => out.set(k, v)));
      return Array.from(out.values()).sort((a, b) =>
        (fileNameById.get(a.fileId) || "").localeCompare(fileNameById.get(b.fileId) || "", undefined, { numeric: true }) || a.page - b.page,
      );
    },
    [drawingsBySpace, fileNameById],
  );

  const drawingLabel = useCallback((d: { fileId: string; page: number }) => {
    const name = (fileNameById.get(d.fileId) || "Drawing").replace(/\.pdf$/i, "");
    return (pageCountByFileId.get(d.fileId) ?? 1) > 1 ? `${name} p.${d.page}` : name;
  }, [fileNameById, pageCountByFileId]);
  // Fixed Drawings column width: fits the longest label across every space, so expanding rows never resizes it.
  const drawingsColWidth = useMemo(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    const font = getComputedStyle(document.body).fontFamily || "sans-serif";
    if (ctx) ctx.font = `12px ${font}`;
    let max = 0;
    drawingsBySpace.forEach((m) => m.forEach((d) => {
      const label = drawingLabel(d);
      max = Math.max(max, ctx ? ctx.measureText(label).width : label.length * 7);
    }));
    // label + button padding/border + cell padding
    return Math.max(120, Math.ceil(max) + 16 + 24 + 4);
  }, [drawingsBySpace, drawingLabel]);

  // Collapsible sections: everything collapsed by default.
  const [sectionOpen, setSectionOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const spaceLabel = (s: string) => (s === UNASSIGNED ? "Unassigned" : spaceShortLabel.get(s) || s);

  const visibleRows = useMemo<VisibleRow[]>(() => {
    if (!sectionOpen) return [];
    if (!groups) return spaceList.map((s) => ({ key: `space:${s}`, label: spaceLabel(s), kind: "space", spaces: [s] }));
    const out: VisibleRow[] = [];
    for (const g of groups) {
      out.push({ key: `group:${g.key}`, label: g.label, kind: "group", spaces: g.spaces, groupKey: g.key });
      if (openGroups.has(g.key)) for (const s of g.spaces) out.push({ key: `space:${s}`, label: spaceLabel(s), kind: "space", spaces: [s] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionOpen, groups, spaceList, openGroups, spaceShortLabel]);
  const rowKeys = useMemo(() => visibleRows.map((r) => r.key), [visibleRows]);

  // ---- Selection --------------------------------------------------------
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchor = useRef<GridPoint | null>(null);
  const drag = useRef<{ base: Set<string>; start: GridPoint } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const lastCellEl = useRef<HTMLElement | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const placePopup = () => {
    const el = lastCellEl.current;
    const box = containerRef.current;
    if (!el || !box) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    setPopupPos({ x: r.right - b.left + box.scrollLeft + 6, y: r.top - b.top + box.scrollTop });
  };

  // Drop selections for rows that were collapsed away.
  useEffect(() => {
    const visible = new Set(rowKeys);
    setSelection((prev) => {
      const next = new Set(Array.from(prev).filter((id) => visible.has(id.split("|")[0])));
      return next.size === prev.size ? prev : next;
    });
  }, [rowKeys]);
  useEffect(() => { if (selection.size === 0) setPopupPos(null); }, [selection]);

  const cellGesture = useRef(false);
  const popupOpenRef = useRef(false);
  popupOpenRef.current = !!popupPos;
  // Outside click: first closes the options pop-up, the next one clears the selection.
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t || tableRef.current?.contains(t) || popupRef.current?.contains(t)) return;
      if (t.closest?.('[role="menu"],[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper]')) return;
      if (popupOpenRef.current) { setPopupPos(null); return; }
      setSelection((prev) => (prev.size ? new Set() : prev));
      anchor.current = null;
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, []);

  const onCellDown = (e: React.MouseEvent<HTMLElement>, row: number, col: number) => {
    if (e.button !== 0) return;
    cellGesture.current = true;
    e.preventDefault();
    containerRef.current?.focus();
    lastCellEl.current = e.currentTarget;
    const id = cellId(rowKeys[row], entryKeys[col]);
    const point = { row, col };
    const multi = e.metaKey || e.ctrlKey;
    if (e.shiftKey && anchor.current) {
      const cells = rectCells(anchor.current, point, rowKeys, entryKeys);
      setSelection(multi ? addRange(selection, cells) : new Set(cells));
      drag.current = null;
      return;
    }
    anchor.current = point;
    if (multi) {
      const next = toggleCell(selection, id);
      setSelection(next);
      drag.current = next.has(id) ? { base: selection, start: point } : null;
    } else {
      setSelection(new Set([id]));
      drag.current = { base: new Set(), start: point };
    }
    setPopupPos(null);
  };
  const onCellEnter = (e: React.MouseEvent<HTMLElement>, row: number, col: number) => {
    if (!drag.current) return;
    lastCellEl.current = e.currentTarget;
    setSelection(addRange(drag.current.base, rectCells(drag.current.start, { row, col }, rowKeys, entryKeys)));
  };
  useEffect(() => {
    const up = () => {
      if (!cellGesture.current) return;
      cellGesture.current = false;
      drag.current = null;
      placePopup();
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  useEffect(() => { if (selection.size > 0 && !drag.current) placePopup(); }, [selection]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setSelection(new Set()); anchor.current = null; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && rowKeys.length) {
      e.preventDefault();
      setSelection(new Set(rectCells({ row: 0, col: 0 }, { row: rowKeys.length - 1, col: entryKeys.length - 1 }, rowKeys, entryKeys)));
    }
  };

  // Selecting a building cell covers its spaces; resolve to unique space cells so nothing is counted twice.
  const groupOfSpace = useMemo(() => {
    const m = new Map<string, string>();
    groups?.forEach((g) => g.spaces.forEach((sp) => m.set(sp, g.key)));
    return m;
  }, [groups]);
  const effectiveCells = useMemo(() => {
    const out = new Set<string>();
    for (const id of selection) {
      const i = id.lastIndexOf("|");
      const rk = id.slice(0, i), ek = id.slice(i + 1);
      if (rk.startsWith("group:")) {
        const g = groups?.find((x) => `group:${x.key}` === rk);
        g?.spaces.forEach((sp) => out.add(`space:${sp}|${ek}`));
      } else out.add(id);
    }
    return out;
  }, [selection, groups]);

  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of selection) {
      const [rk, ek] = [id.slice(0, id.lastIndexOf("|")), id.slice(id.lastIndexOf("|") + 1)];
      cellsByRow.get(rk)?.get(ek)?.ids.forEach((x) => ids.add(x));
    }
    return ids;
  }, [selection, cellsByRow]);
  const selectedCount = useMemo(() => {
    let n = 0;
    for (const id of effectiveCells) {
      const i = id.lastIndexOf("|");
      n += cellsByRow.get(id.slice(0, i))?.get(id.slice(i + 1))?.count ?? 0;
    }
    return n;
  }, [effectiveCells, cellsByRow]);

  const plansWithSelection = useMemo(
    () => drawingPlans.plans.filter((p) => p.included_instance_ids.some((id) => selectedIds.has(id))),
    [drawingPlans.plans, selectedIds],
  );
  const plansForCell = useCallback(
    (cell: Cell | undefined): DrawingPlan[] => {
      if (!cell || cell.ids.size === 0) return [];
      return drawingPlans.plans.filter((p) => p.included_instance_ids.some((id) => cell.ids.has(id)));
    },
    [drawingPlans.plans],
  );

  // ---- Plan actions -----------------------------------------------------
  const [createOpen, setCreateOpen] = useState(false);
  const [planName, setPlanName] = useState("");
  const [planDesc, setPlanDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const baseOf = (p: DrawingPlan) => {
    const b = (p.product_assignments as any)?.__base;
    return b && typeof b === "object" ? (b as Record<string, number>) : {};
  };
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setSaving(true);
    try {
      await fn();
      toast({ title: done });
      setSelection(new Set());
    } catch (e) {
      toast({ title: "Could not update plan", description: getUserFriendlyError(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  const createPlan = () =>
    run(async () => {
      const { data } = await supabase.auth.getUser();
      await drawingPlans.createPlan(
        { name: planName.trim(), description: planDesc.trim(), baseQuantities: {}, color: randomPlanColor(), includedInstanceIds: Array.from(selectedIds) },
        data?.user?.id ?? null,
      );
      setCreateOpen(false);
      setPlanName("");
      setPlanDesc("");
    }, `Created plan "${planName.trim()}"`);
  const addToPlan = (p: DrawingPlan) =>
    run(
      () => drawingPlans.updatePlan(p.id, {
        name: p.name, description: p.summary ?? "", baseQuantities: baseOf(p), color: p.color || randomPlanColor(),
        includedInstanceIds: Array.from(new Set([...p.included_instance_ids, ...selectedIds])),
      }),
      `Added to "${p.name}"`,
    );
  const removeFromPlan = (p: DrawingPlan) =>
    run(
      () => drawingPlans.updatePlan(p.id, {
        name: p.name, description: p.summary ?? "", baseQuantities: baseOf(p), color: p.color || randomPlanColor(),
        includedInstanceIds: p.included_instance_ids.filter((id) => !selectedIds.has(id)),
      }),
      `Removed from "${p.name}"`,
    );

  // ---- Products row -----------------------------------------------------
  const devices: DevicesApi = {
    planName: null,
    productsById: drawingPlans.productsById,
    choices: (cls) => drawingPlans.productChoices(cls),
    assigned: (cls, type, diam) => {
      const entry = drawingPlans.catalogFor(cls);
      return entry ? drawingPlans.assignedDevicesFor(assignmentKeyFor(entry.id, cls, type, diam), entry.id) : [];
    },
    canEdit,
    mapped: (cls) => !!drawingPlans.catalogFor(cls),
    save: async (cls, type, diam, ids) => {
      const entry = drawingPlans.catalogFor(cls);
      if (!entry) return;
      try {
        await drawingPlans.saveAssignment(assignmentKeyFor(entry.id, cls, type, diam), ids);
      } catch (e) {
        toast({ title: "Could not save products", description: getUserFriendlyError(e), variant: "destructive" });
      }
    },
  };
  const deviceRowFor = (e: InstanceGridEntry) => {
    const [, type = "", diam = ""] = e.key.split("::");
    return {
      cls: { name: e.canonicalName },
      type: type === "(untyped)" ? "" : type,
      diam: diam === "(no size)" ? "" : diam,
    };
  };

  const renderDrawings = (spaces: string[]) => {
    const list = drawingsFor(spaces);
    if (list.length === 0) return <span className="text-muted-foreground">None</span>;
    return (
      <div className="flex flex-col items-start gap-1">
        {list.map((d) => {
          const label = drawingLabel(d);
          return (
            <button
              key={`${d.fileId}:${d.page}`}
              type="button"
              className="whitespace-nowrap rounded border bg-background px-1.5 py-0.5 text-xs text-primary hover:bg-muted"
              title={label}
              onClick={(ev) => { ev.stopPropagation(); onOpenDrawing(d.fileId, d.page); }}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  };

  const renderCountCell = (rowKey: string, rowIdx: number | null, entry: InstanceGridEntry, colIdx: number) => {
    const cell = cellsByRow.get(rowKey)?.get(entry.key);
    const count = cell?.count ?? 0;
    const bars = plansForCell(cell);
    const selectable = rowIdx !== null;
    const g = rowKey.startsWith("space:") ? groupOfSpace.get(rowKey.slice(6)) : undefined;
    const isSel = selectable && (selection.has(cellId(rowKey, entry.key)) || (!!g && selection.has(cellId(`group:${g}`, entry.key))));
    return (
      <td
        key={entry.key}
        className={`border-b border-l px-2 py-1.5 text-right tabular-nums ${selectable ? "cursor-cell" : ""} ${isSel ? "bg-primary/15 outline outline-1 -outline-offset-1 outline-primary" : ""} ${count === 0 ? "text-muted-foreground" : ""}`}
        onMouseDown={selectable ? (e) => onCellDown(e, rowIdx!, colIdx) : undefined}
        onMouseEnter={selectable ? (e) => onCellEnter(e, rowIdx!, colIdx) : undefined}
      >
        <span className="inline-flex items-center justify-end gap-1.5">
          {bars.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex gap-0.5">
                  {bars.map((p) => <span key={p.id} className="h-4 w-1 rounded-sm" style={{ backgroundColor: p.color || "hsl(var(--primary))" }} />)}
                </span>
              </TooltipTrigger>
              <TooltipContent>{bars.map((p) => p.name).join(", ")}</TooltipContent>
            </Tooltip>
          )}
          {count}
        </span>
      </td>
    );
  };

  if (loading) {
    return <div className="flex items-center justify-center rounded-lg border bg-card p-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (entries.length === 0) {
    return <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">No detections yet.</div>;
  }

  const sectionLabel = groups ? `Buildings (${buildingCount})` : `Spaces (${spaceList.length})`;
  const stickyFirst = "sticky left-0 z-10 bg-card border-b px-3 py-1.5 text-left whitespace-nowrap";

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative max-h-[calc(100vh-220px)] overflow-auto rounded-lg border bg-card outline-none select-none"
    >
      <table ref={tableRef} className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-muted">
          <tr>
            <th className={`${stickyFirst} bg-muted font-medium text-muted-foreground`}>Class</th>
            {entries.map((e) => (
              <th key={e.key} className="border-b border-l px-2 py-2 text-right font-medium whitespace-nowrap">
                <Tooltip>
                  <TooltipTrigger asChild><span className="cursor-default">{e.displayPrefix}</span></TooltipTrigger>
                  <TooltipContent>{e.displayName}</TooltipContent>
                </Tooltip>
              </th>
            ))}
            <th className="border-b border-l px-3 py-2 text-left font-medium" style={{ width: drawingsColWidth, minWidth: drawingsColWidth }}>Drawings</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={`${stickyFirst} font-medium`}>{companyName ? `${companyName} Product` : "Product"}</td>
            {entries.map((e) => (
              <td key={e.key} className="border-b border-l px-1 py-1 text-right">
                <DeviceButton row={deviceRowFor(e)} devices={devices} />
              </td>
            ))}
            <td className="border-b border-l" />
          </tr>
          <tr className="bg-muted/40">
            <td className={`${stickyFirst} bg-muted font-semibold`}>Total</td>
            {entries.map((e, ci) => renderCountCell("__total__", null, e, ci))}
            <td className="border-b border-l" />
          </tr>
          <tr className="cursor-pointer hover:bg-muted/40" onClick={() => setSectionOpen((v) => !v)}>
            <td className={`${stickyFirst} font-medium`}>
              <span className="inline-flex items-center gap-1">
                {sectionOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {sectionLabel}
              </span>
            </td>
            <td className="border-b" colSpan={entries.length + 1} />
          </tr>
          {visibleRows.map((vr, ri) => (
            <Fragment key={vr.key}>
              <tr className={vr.kind === "group" ? "bg-muted/20" : ""}>
                <td
                  className={`${stickyFirst} ${vr.kind === "group" ? "cursor-pointer pl-6 font-medium hover:bg-muted" : groups ? "pl-14" : "pl-8"}`}
                  onClick={vr.kind === "group" ? () => setOpenGroups((prev) => toggleCell(prev, vr.groupKey!)) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {vr.kind === "group" && (openGroups.has(vr.groupKey!) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
                    {vr.kind === "group" ? `${vr.label} (${vr.spaces.length})` : vr.label}
                  </span>
                </td>
                {entries.map((e, ci) => renderCountCell(vr.key, ri, e, ci))}
                <td className="border-b border-l px-3 py-1.5 align-top" style={{ width: drawingsColWidth, minWidth: drawingsColWidth }}>{renderDrawings(vr.spaces)}</td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>

      {popupPos && selection.size > 0 && canEdit && (
        <div
          ref={popupRef}
          className="absolute z-30 flex w-max flex-col items-stretch gap-0.5 rounded-md border bg-popover p-1 shadow-md [&_button]:justify-start"
          style={{ left: popupPos.x, top: popupPos.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="px-2 py-1 text-xs text-muted-foreground whitespace-nowrap">{selectedCount} instances</span>
          <Button size="sm" variant="ghost" className="h-7" disabled={saving || selectedIds.size === 0} onClick={() => setCreateOpen(true)}>
            Create a Plan
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7" disabled={saving || selectedIds.size === 0 || drawingPlans.plans.length === 0}>
                Add to existing Plan
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {drawingPlans.plans.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => void addToPlan(p)}>
                  <span className="mr-2 h-3 w-1 rounded-sm" style={{ backgroundColor: p.color || "hsl(var(--primary))" }} />
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7" disabled={saving || plansWithSelection.length === 0}>
                Remove from Plan
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {plansWithSelection.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => void removeFromPlan(p)}>
                  <span className="mr-2 h-3 w-1 rounded-sm" style={{ backgroundColor: p.color || "hsl(var(--primary))" }} />
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => !saving && setCreateOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create a Plan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Plan name" autoFocus />
            <Textarea value={planDesc} onChange={(e) => setPlanDesc(e.target.value)} placeholder="Description" className="min-h-20" />
            <p className="text-xs text-muted-foreground">{selectedCount} instances will be added.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void createPlan()} disabled={saving || !planName.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
