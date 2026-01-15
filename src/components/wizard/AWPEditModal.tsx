import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, Pencil, Paperclip, X, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { countByCategory } from "@/lib/analysisItemMapper";
import { supabase } from "@/integrations/supabase/client";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { AWPItemEditModal } from "./AWPItemEditModal";
import { FileAnalysisModal } from "./FileAnalysisModal";
import { InlineCombobox } from "./InlineCombobox";
import { useAWPOptions, isAssetName, isWaterSystemName, getCategoryForName, getDefaultControlIdsForName } from "@/hooks/useAWPOptions";
import {
  generateNextIdFromOptions,
  sqftToSqm,
  sqmToSqft,
  inchesToMm,
  mmToInches,
} from "@/lib/awpIdGenerator";
import { resolveControlIdsToNames } from "@/lib/controlAutoAssignment";

interface AWPEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysisItems: AnalysisItem[];
  onUpdateItems: (items: AnalysisItem[], changeCount?: number) => void;
  projectId: string;
  projectName?: string;
  initialNewItems?: AnalysisItem[]; // Pre-populate from analysis results
}

type AreaUnit = "sqft" | "sqm";
type PipeUnit = "in" | "mm";

interface NewRowItem {
  tempId: string;
  name: string;
  areaName: string;
  floor: string;
  drawingCode: string;
  areaSqft: number | null;
  pipeDiameterInches: number | null;
  pipeDiameterMM: number | null;
  drawingFile: File | null; // Phase 3: Drawing upload
  drawingUrl: string | null; // Phase 3: Existing drawing URL
  source?: 'manual' | 'analysis'; // Track creation origin
}

interface ChangesSummary {
  edited: { id: string; name: string; areaName?: string }[];
  removed: { id: string; name: string; areaName?: string }[];
  added: { name: string; areaName?: string }[];
}

// Create empty row helper
const createEmptyRow = (): NewRowItem => ({
  tempId: `NEW-${Date.now()}-${Math.random()}`,
  name: "",
  areaName: "",
  floor: "",
  drawingCode: "",
  areaSqft: null,
  pipeDiameterInches: null,
  pipeDiameterMM: null,
  drawingFile: null,
  drawingUrl: null,
  source: 'manual', // Manually created items
});

// Convert AnalysisItem to NewRowItem for pre-population
const analysisItemToNewRow = (item: AnalysisItem): NewRowItem => ({
  tempId: `NEW-${Date.now()}-${Math.random()}-${item.id}`,
  name: item.name,
  areaName: item.areaName || "",
  floor: item.floor || "",
  drawingCode: item.drawingCode || "",
  // Check both camelCase and snake_case for area (mock data uses snake_case)
  areaSqft: item.areaSqft || item.area_sqft || null,
  pipeDiameterInches: (item.additionalParameters as any)?.pipeDiameterInches || null,
  pipeDiameterMM: (item.additionalParameters as any)?.pipeDiameterMM || null,
  drawingFile: null,
  drawingUrl: item.drawingUrl || null,
  source: item.source || 'analysis', // Items from analysis flow
});

export const AWPEditModal = ({
  isOpen,
  onClose,
  analysisItems,
  onUpdateItems,
  projectId,
  projectName,
  initialNewItems,
}: AWPEditModalProps) => {
  // Fetch AWP options from DB
  const { data: awpOptions = [] } = useAWPOptions();
  
  // Hidden file input refs for drawing uploads
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  
  // Tab navigation refs for spreadsheet-like UX
  const cellRefs = useRef<Map<string, HTMLInputElement | HTMLButtonElement>>(new Map());
  const pendingFocusRowRef = useRef<string | null>(null);
  
  // Original items for comparison
  const [originalItems, setOriginalItems] = useState<AnalysisItem[]>([]);
  
  // Existing items (left pane)
  const [existingItems, setExistingItems] = useState<AnalysisItem[]>([]);
  
  // Track deleted item IDs
  const [deletedItemIds, setDeletedItemIds] = useState<Set<string>>(new Set());
  
  // New items being added (right pane) - now as table rows
  const [newRows, setNewRows] = useState<NewRowItem[]>([createEmptyRow()]);
  
  // Edit modal state
  const [editingItem, setEditingItem] = useState<AnalysisItem | null>(null);
  
  // Save confirmation state
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [changesSummary, setChangesSummary] = useState<ChangesSummary | null>(null);
  
  // Issue 15: Discard confirmation state
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  
  // Units for new rows
  const [areaUnit, setAreaUnit] = useState<AreaUnit>("sqft");
  const [pipeUnit, setPipeUnit] = useState<PipeUnit>("in");
  
  // File analysis animation modal
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analysisFiles, setAnalysisFiles] = useState<{ name: string; id: string }[]>([]);
  const [pendingAnalysisCallback, setPendingAnalysisCallback] = useState<(() => void) | null>(null);
  const { toast } = useToast();

  // Initialize/reset ALL state when modal opens
  useEffect(() => {
    if (isOpen) {
      // Deep copy each item to prevent reference equality issues
      const deepCopyItems = analysisItems.map(item => JSON.parse(JSON.stringify(item)));
      setOriginalItems(deepCopyItems);
      setExistingItems(analysisItems.map(item => JSON.parse(JSON.stringify(item))));
      setDeletedItemIds(new Set());
      
      // Phase 5: Pre-populate with initialNewItems if provided
      if (initialNewItems && initialNewItems.length > 0) {
        const prePopulatedRows = initialNewItems.map(item => analysisItemToNewRow(item));
        setNewRows([...prePopulatedRows, createEmptyRow()]);
      } else {
        setNewRows([createEmptyRow()]); // Fresh default row
      }
      
      setChangesSummary(null);
      setShowSaveConfirmation(false);
      setShowDiscardConfirm(false);
      setEditingItem(null);
      setAreaUnit("sqft");
      setPipeUnit("in");
    }
  }, [isOpen, analysisItems, initialNewItems]);

  // Visible existing items (now includes deleted items with special styling)
  const visibleExistingItems = useMemo(() => existingItems, [existingItems]);
  
  // Non-deleted items for calculations
  const activeExistingItems = useMemo(() => 
    existingItems.filter(item => !deletedItemIds.has(item.id)), [existingItems, deletedItemIds]);

  // Check if any item needs Size or Pipe column
  const hasAssets = useMemo(() => 
    activeExistingItems.some(item => isAssetName(awpOptions, item.name)) || newRows.some(row => isAssetName(awpOptions, row.name)), 
    [activeExistingItems, newRows, awpOptions]);
  const hasWaterSystems = useMemo(() => 
    activeExistingItems.some(item => isWaterSystemName(awpOptions, item.name)) || newRows.some(row => isWaterSystemName(awpOptions, row.name)), 
    [activeExistingItems, newRows, awpOptions]);

  // All class options for combobox - from DB
  const allClassOptions = useMemo(() => 
    awpOptions.map(opt => ({ value: opt.name, category: opt.category })),
    [awpOptions]);

  // Issue 24: Fix hasUnsavedChanges to not trigger on empty default row
  const hasUnsavedChanges = useMemo(() => {
    // Check for edits to existing items
    const hasEdits = existingItems.some((current) => {
      const original = originalItems.find(o => o.id === current.id);
      return original && JSON.stringify(current) !== JSON.stringify(original);
    });
    
    // Check for deletions
    const hasDeletions = deletedItemIds.size > 0;
    
    // Check for additions - only count rows with a type selected (row.name is the class type)
    const hasAdditions = newRows.some(row => row.name.trim() !== '');
    
    return hasEdits || hasDeletions || hasAdditions;
  }, [existingItems, originalItems, deletedItemIds, newRows]);

  // Add new row
  const handleAddRow = useCallback(() => {
    const newRow = createEmptyRow();
    pendingFocusRowRef.current = newRow.tempId;
    setNewRows(prev => [...prev, newRow]);
  }, []);

  // Tab navigation helpers
  const getCellKey = useCallback((rowId: string, colName: string) => `${rowId}-${colName}`, []);
  
  const getEditableColumns = useCallback((row: NewRowItem): string[] => {
    const cols = ['name', 'type', 'floor']; // Always present (name = areaName, type = AWP class)
    
    const isAsset = row.name ? isAssetName(awpOptions, row.name) : false;
    const isWaterSystem = row.name ? isWaterSystemName(awpOptions, row.name) : false;
    
    if (hasAssets && isAsset) cols.push('size');
    if (hasWaterSystems && isWaterSystem) cols.push('pipe');
    
    return cols;
  }, [awpOptions, hasAssets, hasWaterSystems]);

  const handleCellKeyDown = useCallback((
    e: React.KeyboardEvent,
    rowTempId: string,
    columnName: string
  ) => {
    if (e.key !== 'Tab') return;
    
    e.preventDefault(); // Take over Tab behavior
    
    const rowIndex = newRows.findIndex(r => r.tempId === rowTempId);
    const row = newRows[rowIndex];
    const columns = getEditableColumns(row);
    const colIndex = columns.indexOf(columnName);
    
    const isShift = e.shiftKey;
    let nextRowIndex = rowIndex;
    let nextColIndex = colIndex + (isShift ? -1 : 1);
    
    // Handle wrapping to next/previous row
    if (nextColIndex >= columns.length) {
      nextColIndex = 0;
      nextRowIndex++;
      
      // If past last row, add a new row
      if (nextRowIndex >= newRows.length) {
        handleAddRow();
        // Focus will be set after state update via useEffect
        return;
      }
    } else if (nextColIndex < 0) {
      if (rowIndex === 0) return; // Already at first cell, do nothing
      
      nextRowIndex--;
      const prevRow = newRows[nextRowIndex];
      const prevColumns = getEditableColumns(prevRow);
      nextColIndex = prevColumns.length - 1;
    }
    
    // Focus the next cell
    const nextRow = newRows[nextRowIndex];
    const nextColumns = getEditableColumns(nextRow);
    const nextColName = nextColumns[nextColIndex];
    const nextCell = cellRefs.current.get(getCellKey(nextRow.tempId, nextColName));
    
    nextCell?.focus();
  }, [newRows, getEditableColumns, getCellKey, handleAddRow]);

  // Auto-focus first cell of newly added row
  useEffect(() => {
    if (pendingFocusRowRef.current) {
      const tempId = pendingFocusRowRef.current;
      pendingFocusRowRef.current = null;
      
      // Small timeout to ensure DOM is updated
      requestAnimationFrame(() => {
        const firstCell = cellRefs.current.get(getCellKey(tempId, 'name'));
        firstCell?.focus();
      });
    }
  }, [newRows, getCellKey]);

  // Update a new row field
  const updateNewRow = useCallback((tempId: string, field: keyof NewRowItem, value: any) => {
    setNewRows(prev => prev.map(row => {
      if (row.tempId !== tempId) return row;
      return { ...row, [field]: value };
    }));
  }, []);

  // Delete a new row
  const deleteNewRow = useCallback((tempId: string) => {
    setNewRows(prev => {
      const filtered = prev.filter(row => row.tempId !== tempId);
      // Always keep at least one row
      return filtered.length === 0 ? [createEmptyRow()] : filtered;
    });
  }, []);

  // Handle edit item save
  const handleEditSave = useCallback((updatedItem: AnalysisItem) => {
    setExistingItems(prev => prev.map(item => 
      item.id === editingItem?.id ? updatedItem : item
    ));
    setEditingItem(null);
  }, [editingItem]);

  // Handle delete (mark for deletion without confirmation)
  const handleDelete = useCallback((itemId: string) => {
    setDeletedItemIds(prev => new Set([...prev, itemId]));
  }, []);

  // Handle undo delete
  const handleUndoDelete = useCallback((itemId: string) => {
    setDeletedItemIds(prev => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  // Handle area change for new row
  const handleNewRowAreaChange = useCallback((tempId: string, value: string) => {
    const numValue = parseFloat(value) || null;
    if (areaUnit === "sqft") {
      updateNewRow(tempId, "areaSqft", numValue);
    } else {
      updateNewRow(tempId, "areaSqft", numValue ? sqmToSqft(numValue) : null);
    }
  }, [areaUnit, updateNewRow]);

  // Handle pipe diameter change for new row
  const handleNewRowPipeChange = useCallback((tempId: string, value: string) => {
    const numValue = parseFloat(value) || null;
    if (pipeUnit === "in") {
      updateNewRow(tempId, "pipeDiameterInches", numValue);
      updateNewRow(tempId, "pipeDiameterMM", numValue ? inchesToMm(numValue) : null);
    } else {
      updateNewRow(tempId, "pipeDiameterMM", numValue);
      updateNewRow(tempId, "pipeDiameterInches", numValue ? mmToInches(numValue) : null);
    }
  }, [pipeUnit, updateNewRow]);

  // Get displayed value for new row area
  const getNewRowAreaDisplay = useCallback((row: NewRowItem) => {
    if (!row.areaSqft) return "";
    return areaUnit === "sqft" ? row.areaSqft : sqftToSqm(row.areaSqft);
  }, [areaUnit]);

  // Get displayed value for new row pipe
  const getNewRowPipeDisplay = useCallback((row: NewRowItem) => {
    if (pipeUnit === "in") {
      return row.pipeDiameterInches || "";
    }
    return row.pipeDiameterMM || "";
  }, [pipeUnit]);

  // Calculate changes summary
  const calculateChanges = useCallback((): ChangesSummary => {
    const edited: ChangesSummary["edited"] = [];
    const removed: ChangesSummary["removed"] = [];
    const added: ChangesSummary["added"] = [];

    // Find edited items
    existingItems.forEach(current => {
      if (deletedItemIds.has(current.id)) return;
      const original = originalItems.find(o => o.id === current.id);
      if (original) {
        const hasChanges = JSON.stringify(current) !== JSON.stringify(original);
        if (hasChanges) {
          edited.push({ id: current.id, name: current.name, areaName: current.areaName });
        }
      }
    });

    // Find removed items
    deletedItemIds.forEach(id => {
      const original = originalItems.find(o => o.id === id);
      if (original) {
        removed.push({ id: original.id, name: original.name, areaName: original.areaName });
      }
    });

    // Find added items
    newRows.filter(row => row.name).forEach(row => {
      added.push({ name: row.name, areaName: row.areaName });
    });

    return { edited, removed, added };
  }, [existingItems, originalItems, deletedItemIds, newRows]);

  // Issue 15: Handle close with unsaved changes check
  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      setChangesSummary(calculateChanges());
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [hasUnsavedChanges, calculateChanges, onClose]);

  // Handle save click - show confirmation if there are changes
  const handleSaveClick = useCallback(() => {
    const changes = calculateChanges();
    const hasChanges = changes.edited.length > 0 || changes.removed.length > 0 || changes.added.length > 0;
    
    if (hasChanges) {
      setChangesSummary(changes);
      setShowSaveConfirmation(true);
    } else {
      onClose();
    }
  }, [calculateChanges, onClose]);

  // Phase 3: Handle drawing file selection
  const handleDrawingFileChange = useCallback((tempId: string, file: File | null) => {
    updateNewRow(tempId, "drawingFile", file);
    if (file) {
      updateNewRow(tempId, "drawingUrl", null); // Clear URL when new file selected
    }
  }, [updateNewRow]);

  // Phase 3: Remove drawing from row
  const handleRemoveDrawing = useCallback((tempId: string) => {
    updateNewRow(tempId, "drawingFile", null);
    updateNewRow(tempId, "drawingUrl", null);
  }, [updateNewRow]);

  // Issue 22: Confirm save - generate IDs incrementally to avoid duplicates
  // Phase 3: Upload drawings to storage
  // Phase 5: Auto-assign default controls based on class name (now using DB arrays)
  const handleConfirmSave = useCallback(async () => {
    // Filter out deleted items
    const remainingItems = existingItems.filter(item => !deletedItemIds.has(item.id));
    
    // Convert new rows to AnalysisItems - accumulate items for proper ID generation
    const allCurrentItems = [...remainingItems];
    const newItems: AnalysisItem[] = [];
    
    // Collect all control IDs needed for resolution
    const controlIdsToResolve = new Set<string>();
    newRows.filter(row => row.name).forEach(row => {
      const controlIds = getDefaultControlIdsForName(awpOptions, row.name);
      controlIds.forEach(id => controlIdsToResolve.add(id));
    });
    
    // Resolve control IDs to names in one batch
    const controlNames = await resolveControlIdsToNames(Array.from(controlIdsToResolve));
    const idToNameMap = new Map<string, string>();
    
    // Build the mapping from IDs to names
    if (controlIdsToResolve.size > 0) {
      const { data } = await supabase
        .from("mitigation_controls")
        .select("id, name")
        .in("id", Array.from(controlIdsToResolve));
      data?.forEach((c: any) => idToNameMap.set(c.id, c.name));
    }
    
    // Phase 3: Upload drawings and collect URLs
    const rowsWithDrawings = newRows.filter(row => row.name && row.drawingFile);
    const uploadPromises = rowsWithDrawings.map(async (row) => {
      const file = row.drawingFile!;
      const fileName = `${projectId}/${Date.now()}-${file.name}`;
      const { data, error } = await supabase.storage
        .from('awp-drawings')
        .upload(fileName, file);
      
      if (error) {
        console.error('Error uploading drawing:', error);
        return { tempId: row.tempId, url: null };
      }
      
      const { data: urlData } = supabase.storage
        .from('awp-drawings')
        .getPublicUrl(data.path);
      
      return { tempId: row.tempId, url: urlData.publicUrl };
    });
    
    const uploadResults = await Promise.all(uploadPromises);
    const drawingUrlMap = new Map(uploadResults.map(r => [r.tempId, r.url]));
    
    for (const row of newRows.filter(row => row.name)) {
      const category = getCategoryForName(awpOptions, row.name);
      // Issue 22: Pass accumulated items so each new item gets incrementing ID
      // Now uses AWP options from DB for ID prefix
      const id = generateNextIdFromOptions(row.name, awpOptions, allCurrentItems);
      
      // Phase 5: Get default controls for this class from DB array
      const defaultControlIds = getDefaultControlIdsForName(awpOptions, row.name);
      const defaultControls = defaultControlIds
        .map(id => idToNameMap.get(id))
        .filter((name): name is string => !!name);
      
      // Phase 3: Get drawing URL (uploaded or existing)
      const drawingUrl = drawingUrlMap.get(row.tempId) || row.drawingUrl || undefined;
      
      const newItem: AnalysisItem = {
        id,
        name: row.name,
        category: category || "Asset",
        areaName: row.areaName || undefined,
        floor: row.floor || undefined,
        drawingCode: row.drawingCode || undefined,
        fileName: undefined,
        areaSqft: row.areaSqft || undefined,
        width: undefined,
        length: undefined,
        sizeCategory: undefined,
        coordinates: undefined,
        controls: defaultControls, // Auto-assigned default controls from DB
        drawingUrl, // Phase 3: Drawing URL
        source: row.source || 'manual', // Preserve source, default to manual
        additionalParameters: row.pipeDiameterInches ? {
          pipeDiameterInches: row.pipeDiameterInches,
          pipeDiameterMM: row.pipeDiameterMM,
        } : undefined,
      };
      
      // Add to accumulated list for next ID generation
      allCurrentItems.push(newItem);
      newItems.push(newItem);
    }

    const allItems = [...remainingItems, ...newItems];
    
    // Calculate edit count by comparing existing items to originals
    const editCount = existingItems.filter(current => {
      const original = originalItems.find(o => o.id === current.id);
      return original && JSON.stringify(current) !== JSON.stringify(original);
    }).length;
    const changeCount = deletedItemIds.size + newItems.length + editCount;
    
    onUpdateItems(allItems, changeCount);
    setShowSaveConfirmation(false);
    onClose();
  }, [existingItems, deletedItemIds, newRows, onUpdateItems, onClose, projectId, awpOptions, originalItems]);

  // Get size display for existing item
  const getItemSizeDisplay = (item: AnalysisItem) => {
    const sqft = item.areaSqft || (item as any)?.area_sqft;
    return sqft ? `${Math.round(sqft)} ft²` : "-";
  };

  // Get pipe display for existing item
  const getItemPipeDisplay = (item: AnalysisItem) => {
    const params = item.additionalParameters as any;
    if (params?.pipeDiameterInches) {
      return `${params.pipeDiameterInches}"`;
    }
    return "-";
  };

  // Handle analysis modal completion (kept for initialNewItems flow)
  const handleAnalysisModalComplete = useCallback(() => {
    setShowAnalysisModal(false);
    if (pendingAnalysisCallback) {
      pendingAnalysisCallback();
      setPendingAnalysisCallback(null);
    }
  }, [pendingAnalysisCallback]);

  // Determine column count for colSpan
  const getColSpan = () => {
    let cols = 5; // Name, Type, ID, Floor, Actions
    if (hasAssets) cols++;
    if (hasWaterSystems) cols++;
    return cols;
  };

  // Issue 17: Get column span for right pane
  const getRightColSpan = () => {
    let cols = 4; // Name, Type, Floor, Actions
    if (hasAssets) cols++;
    if (hasWaterSystems) cols++;
    return cols;
  };

  return (
    <>
      {/* Issue 15: Use handleClose for onOpenChange */}
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        {/* Issue 13: Increased modal width to 95vw */}
        <DialogContent className="max-w-[95vw] w-full h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Assets, Water Systems, and Processes List</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Make changes directly. Existing items won't be removed unless you delete them.
          </p>
        </DialogHeader>
          
          <div className="flex-1 flex gap-4 overflow-hidden">
            {/* Left Pane - Existing Items Table - Issue 25: table-fixed for stable widths */}
            <div className="w-3/5 flex flex-col border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted/50 text-sm font-medium">
                Existing Items ({activeExistingItems.length})
                {deletedItemIds.size > 0 && (
                  <span className="text-destructive ml-2">({deletedItemIds.size} pending removal)</span>
                )}
              </div>
              <div className="flex-1 overflow-auto">
                <Table className="table-fixed">
                  {/* Issue 25: Fixed column widths with min-w for stability */}
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-[130px] min-w-[130px] py-2 text-xs">Name</TableHead>
                      <TableHead className="w-[200px] min-w-[200px] py-2 text-xs">Type</TableHead>
                      <TableHead className="w-[90px] min-w-[90px] py-2 text-xs">ID</TableHead>
                      <TableHead className="w-[60px] min-w-[60px] py-2 text-xs">Floor</TableHead>
                      {hasAssets && <TableHead className="w-[80px] min-w-[80px] py-2 text-xs">Size</TableHead>}
                      {hasWaterSystems && <TableHead className="w-[70px] min-w-[70px] py-2 text-xs">Pipe Ø</TableHead>}
                      <TableHead className="w-[80px] min-w-[80px] py-2 text-xs">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Issue 25: Fixed column widths with min-w for stability */}
                    {visibleExistingItems.map((item) => {
                      const isDeleted = deletedItemIds.has(item.id);
                      return (
                        <TableRow 
                          key={item.id} 
                          className={`h-8 ${isDeleted ? 'bg-destructive/5 opacity-60' : ''}`}
                        >
                          <TableCell className="py-1 px-2 w-[130px] min-w-[130px]">
                            <span className={`text-xs truncate block ${isDeleted ? 'line-through text-muted-foreground' : ''}`} title={item.areaName}>
                              {item.areaName || "-"}
                            </span>
                          </TableCell>
                          <TableCell className="py-1 px-2 w-[200px] min-w-[200px]">
                            <span className={`text-xs truncate block ${isDeleted ? 'line-through text-muted-foreground' : ''}`} title={item.name}>
                              {item.name}
                            </span>
                          </TableCell>
                          <TableCell className={`py-1 px-2 font-mono text-xs w-[90px] min-w-[90px] ${isDeleted ? 'line-through text-muted-foreground' : ''}`}>{item.id}</TableCell>
                          <TableCell className={`py-1 px-2 text-xs w-[60px] min-w-[60px] ${isDeleted ? 'line-through text-muted-foreground' : ''}`}>{item.floor || "-"}</TableCell>
                          {hasAssets && (
                            <TableCell className={`py-1 px-2 text-xs w-[80px] min-w-[80px] ${isDeleted ? 'line-through text-muted-foreground' : ''}`}>
                              {isAssetName(awpOptions, item.name) ? getItemSizeDisplay(item) : "-"}
                            </TableCell>
                          )}
                          {hasWaterSystems && (
                            <TableCell className={`py-1 px-2 text-xs w-[70px] min-w-[70px] ${isDeleted ? 'line-through text-muted-foreground' : ''}`}>
                              {isWaterSystemName(awpOptions, item.name) ? getItemPipeDisplay(item) : "-"}
                            </TableCell>
                          )}
                          <TableCell className="py-1 px-2 w-[80px]">
                            {isDeleted ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-amber-600 hover:text-amber-700"
                                onClick={() => handleUndoDelete(item.id)}
                                title="Undo delete"
                              >
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            ) : (
                              <div className="flex gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => setEditingItem(item)}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive hover:text-destructive"
                                  onClick={() => handleDelete(item.id)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {visibleExistingItems.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={getColSpan()} className="text-center py-8 text-muted-foreground text-xs">
                          No existing items
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Right Pane - Add New Items - Issue 25: table-fixed for stable widths */}
            <div className="w-2/5 flex flex-col border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted/50 text-sm font-medium shrink-0">
                Add New Items
              </div>
              
              <div className="flex-1 overflow-auto min-h-0">
                <Table className="table-fixed">
                  {/* Issue 17: Reordered columns - Issue 25: Fixed widths with min-w */}
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-[100px] min-w-[100px] py-2 text-xs">Name</TableHead>
                      <TableHead className="w-[130px] min-w-[130px] py-2 text-xs">Type</TableHead>
                      <TableHead className="w-[40px] min-w-[40px] py-2 text-xs">Fl</TableHead>
                      <TableHead className="w-[50px] min-w-[50px] py-2 text-xs">Drawing</TableHead>
                      {hasAssets && <TableHead className="w-[60px] min-w-[60px] py-2 text-xs">Size</TableHead>}
                      {hasWaterSystems && <TableHead className="w-[50px] min-w-[50px] py-2 text-xs">Pipe</TableHead>}
                      <TableHead className="w-[36px] min-w-[36px] py-2 text-xs"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {newRows.map((row) => {
                      const isAsset = row.name ? isAssetName(awpOptions, row.name) : false;
                      const isWaterSystem = row.name ? isWaterSystemName(awpOptions, row.name) : false;
                      
                      return (
                        <TableRow key={row.tempId} className="h-8">
                          {/* Issue 17: Name column first - Issue 25: fixed width with min-w */}
                          <TableCell className="py-1 px-1 w-[100px] min-w-[100px]">
                            <Input
                              ref={(el) => { if (el) cellRefs.current.set(getCellKey(row.tempId, 'name'), el); }}
                              className="h-6 text-xs px-2"
                              placeholder="Name"
                              value={row.areaName}
                              onChange={(e) => updateNewRow(row.tempId, "areaName", e.target.value)}
                              onKeyDown={(e) => handleCellKeyDown(e, row.tempId, 'name')}
                            />
                          </TableCell>
                          
                          {/* Type field using InlineCombobox with portal */}
                          <TableCell className="py-1 px-1 w-[150px] min-w-[150px]">
                            <InlineCombobox
                              ref={(el) => { if (el) cellRefs.current.set(getCellKey(row.tempId, 'type'), el as any); }}
                              value={row.name}
                              options={allClassOptions}
                              onChange={(val) => updateNewRow(row.tempId, "name", val)}
                              placeholder="Type to search..."
                              onKeyDown={(e) => handleCellKeyDown(e, row.tempId, 'type')}
                            />
                          </TableCell>
                          
                          {/* Floor */}
                          <TableCell className="py-1 px-1 w-[40px] min-w-[40px]">
                            <Input
                              ref={(el) => { if (el) cellRefs.current.set(getCellKey(row.tempId, 'floor'), el); }}
                              className="h-6 text-xs px-1"
                              placeholder="Fl"
                              value={row.floor}
                              onChange={(e) => updateNewRow(row.tempId, "floor", e.target.value)}
                              onKeyDown={(e) => handleCellKeyDown(e, row.tempId, 'floor')}
                            />
                          </TableCell>
                          
                          {/* Phase 3: Drawing upload */}
                          <TableCell className="py-1 px-1 w-[50px] min-w-[50px]">
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png"
                              className="hidden"
                              ref={(el) => { if (el) fileInputRefs.current.set(row.tempId, el); }}
                              onChange={(e) => handleDrawingFileChange(row.tempId, e.target.files?.[0] || null)}
                            />
                            {row.drawingFile || row.drawingUrl ? (
                              <div className="flex items-center gap-0.5">
                                <Paperclip className="h-3 w-3 text-green-600" />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-4 w-4 p-0"
                                  onClick={() => handleRemoveDrawing(row.tempId)}
                                >
                                  <X className="h-2.5 w-2.5 text-muted-foreground" />
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => fileInputRefs.current.get(row.tempId)?.click()}
                              >
                                <Paperclip className="h-3 w-3 text-muted-foreground" />
                              </Button>
                            )}
                          </TableCell>
                          
                          {/* Size (Assets) - Issue 25: fixed width with min-w */}
                          {hasAssets && (
                            <TableCell className="py-1 px-1 w-[70px] min-w-[70px]">
                              {isAsset ? (
                                <Input
                                  ref={(el) => { if (el) cellRefs.current.set(getCellKey(row.tempId, 'size'), el); }}
                                  type="number"
                                  className="h-6 text-xs px-2"
                                  placeholder="ft²"
                                  value={getNewRowAreaDisplay(row)}
                                  onChange={(e) => handleNewRowAreaChange(row.tempId, e.target.value)}
                                  onKeyDown={(e) => handleCellKeyDown(e, row.tempId, 'size')}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                          )}
                          
                          {/* Pipe Diameter (Water Systems) - Issue 25: fixed width with min-w */}
                          {hasWaterSystems && (
                            <TableCell className="py-1 px-1 w-[60px] min-w-[60px]">
                              {isWaterSystem ? (
                                <Input
                                  ref={(el) => { if (el) cellRefs.current.set(getCellKey(row.tempId, 'pipe'), el); }}
                                  type="number"
                                  className="h-6 text-xs px-2"
                                  placeholder="in"
                                  value={getNewRowPipeDisplay(row)}
                                  onChange={(e) => handleNewRowPipeChange(row.tempId, e.target.value)}
                                  onKeyDown={(e) => handleCellKeyDown(e, row.tempId, 'pipe')}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                          )}
                          
                          {/* Delete - Issue 25: fixed width with min-w */}
                          <TableCell className="py-1 px-1 w-[40px] min-w-[40px]">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              onClick={() => deleteNewRow(row.tempId)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                
              </div>
              
              {/* Issue 12: Add Row button docked outside scroll */}
              <div className="p-2 border-t shrink-0">
                <Button onClick={handleAddRow} size="sm" variant="outline" className="w-full">
                  <Plus className="w-3 h-3 mr-1" /> Add Row
                </Button>
              </div>
            </div>
          </div>

          {/* Footer - Issue 15: Use handleClose instead of onClose */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSaveClick}>
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Item Modal */}
      {editingItem && (
        <AWPItemEditModal
          isOpen={!!editingItem}
          onClose={() => setEditingItem(null)}
          item={editingItem}
          allItems={existingItems}
          onSave={handleEditSave}
          projectId={projectId}
        />
      )}

      {/* File Analysis Animation Modal */}
      <FileAnalysisModal
        isOpen={showAnalysisModal}
        files={analysisFiles}
        onComplete={handleAnalysisModalComplete}
      />

      {/* Issue 15: Discard Confirmation Dialog - Scrollable */}
      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent className="max-h-[85vh] flex flex-col overflow-hidden">
          <AlertDialogHeader className="flex-shrink-0">
            <AlertDialogTitle>Discard Changes?</AlertDialogTitle>
          </AlertDialogHeader>
          <ScrollArea className="flex-1 min-h-0 max-h-[50vh] pr-4">
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>You have unsaved changes. Are you sure you want to discard them?</p>
                
                {changesSummary?.edited.length ? (
                  <div>
                    <span className="font-medium text-foreground">Pending edits ({changesSummary.edited.length}):</span>
                    <ul className="list-disc list-inside mt-1 text-muted-foreground">
                      {changesSummary.edited.map((item, i) => (
                        <li key={i} className="truncate">{item.areaName || item.name} ({item.id})</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {changesSummary?.removed.length ? (
                  <div>
                    <span className="font-medium text-destructive">Pending removals ({changesSummary.removed.length}):</span>
                    <ul className="list-disc list-inside mt-1 text-muted-foreground">
                      {changesSummary.removed.map((item, i) => (
                        <li key={i} className="truncate">{item.areaName || item.name} ({item.id})</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {changesSummary?.added.length ? (
                  <div>
                    <span className="font-medium text-green-600">Pending additions ({changesSummary.added.length}):</span>
                    <ul className="list-disc list-inside mt-1 text-muted-foreground">
                      {changesSummary.added.map((item, i) => (
                        <li key={i} className="truncate">{item.areaName || item.name}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </ScrollArea>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setShowDiscardConfirm(false); onClose(); }}>
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save Confirmation Dialog - Scrollable */}
      <AlertDialog open={showSaveConfirmation} onOpenChange={setShowSaveConfirmation}>
        <AlertDialogContent className="max-h-[85vh] flex flex-col overflow-hidden">
          <AlertDialogHeader className="flex-shrink-0">
            <AlertDialogTitle>Confirm Changes</AlertDialogTitle>
          </AlertDialogHeader>
          <ScrollArea className="flex-1 min-h-0 max-h-[50vh] pr-4">
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {changesSummary?.edited.length ? (
                  <div>
                    <span className="font-medium text-foreground">Edited ({changesSummary.edited.length}):</span>
                    <ul className="list-disc list-inside mt-1 text-muted-foreground">
                      {changesSummary.edited.map((item, i) => (
                        <li key={i} className="truncate">{item.areaName || item.name} ({item.id})</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {changesSummary?.removed.length ? (
                  <div>
                    <span className="font-medium text-destructive">Removed ({changesSummary.removed.length}):</span>
                    <ul className="list-disc list-inside mt-1 text-muted-foreground">
                      {changesSummary.removed.map((item, i) => (
                        <li key={i} className="truncate">{item.areaName || item.name} ({item.id})</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {changesSummary?.added.length ? (
                  <div>
                    <span className="font-medium text-green-600">Added ({changesSummary.added.length}):</span>
                    <ul className="list-disc list-inside mt-1 text-muted-foreground">
                      {changesSummary.added.map((item, i) => (
                        <li key={i} className="truncate">{item.areaName || item.name}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </ScrollArea>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSave}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
