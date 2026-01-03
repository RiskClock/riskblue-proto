import { useState, useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Trash2, Pencil, ChevronsUpDown, Check } from "lucide-react";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { AWPItemEditModal } from "./AWPItemEditModal";
import { cn } from "@/lib/utils";
import {
  CLASSES_BY_CATEGORY,
  CLASS_TO_CATEGORY_MAP,
  generateNextId,
  isAssetClass,
  isWaterSystemClass,
  sqftToSqm,
  sqmToSqft,
  inchesToMm,
  mmToInches,
} from "@/lib/awpIdGenerator";

interface AWPEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysisItems: AnalysisItem[];
  onUpdateItems: (items: AnalysisItem[]) => void;
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
}

interface ChangesSummary {
  edited: { id: string; name: string; areaName?: string }[];
  removed: { id: string; name: string; areaName?: string }[];
  added: { name: string; areaName?: string }[];
}

export const AWPEditModal = ({
  isOpen,
  onClose,
  analysisItems,
  onUpdateItems,
}: AWPEditModalProps) => {
  // Original items for comparison
  const [originalItems, setOriginalItems] = useState<AnalysisItem[]>([]);
  
  // Existing items (left pane)
  const [existingItems, setExistingItems] = useState<AnalysisItem[]>([]);
  
  // Track deleted item IDs
  const [deletedItemIds, setDeletedItemIds] = useState<Set<string>>(new Set());
  
  // New items being added (right pane)
  const [newRows, setNewRows] = useState<NewRowItem[]>([]);
  
  // Edit modal state
  const [editingItem, setEditingItem] = useState<AnalysisItem | null>(null);
  
  // Save confirmation state
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [changesSummary, setChangesSummary] = useState<ChangesSummary | null>(null);
  
  // Units for right pane
  const [areaUnit, setAreaUnit] = useState<AreaUnit>("sqft");
  const [pipeUnit, setPipeUnit] = useState<PipeUnit>("in");
  
  // Combobox state for new rows
  const [openCombobox, setOpenCombobox] = useState<string | null>(null);

  // Initialize when modal opens
  useMemo(() => {
    if (isOpen) {
      setOriginalItems(analysisItems.map(item => ({ ...item })));
      setExistingItems(analysisItems.map(item => ({ ...item })));
      setDeletedItemIds(new Set());
      setNewRows([]);
    }
  }, [isOpen, analysisItems]);

  // Visible existing items (excluding deleted)
  const visibleExistingItems = useMemo(() => 
    existingItems.filter(item => !deletedItemIds.has(item.id)), [existingItems, deletedItemIds]);

  // Check if any existing item is an Asset or Water System for column visibility
  const hasAssets = useMemo(() => 
    visibleExistingItems.some(item => isAssetClass(item.name)), [visibleExistingItems]);
  const hasWaterSystems = useMemo(() => 
    visibleExistingItems.some(item => isWaterSystemClass(item.name)), [visibleExistingItems]);

  // All class options for combobox
  const allClassOptions = useMemo(() => [
    ...CLASSES_BY_CATEGORY.Asset.map(cls => ({ value: cls, category: "Asset" })),
    ...CLASSES_BY_CATEGORY["Water System"].map(cls => ({ value: cls, category: "Water System" })),
    ...CLASSES_BY_CATEGORY.Process.map(cls => ({ value: cls, category: "Process" })),
  ], []);

  // Add new row to right pane
  const handleAddRow = useCallback(() => {
    const newRow: NewRowItem = {
      tempId: `NEW-${Date.now()}`,
      name: "",
      areaName: "",
      floor: "",
      drawingCode: "",
      areaSqft: null,
      pipeDiameterInches: null,
      pipeDiameterMM: null,
    };
    setNewRows(prev => [...prev, newRow]);
  }, []);

  // Update a new row field
  const updateNewRow = useCallback((tempId: string, field: keyof NewRowItem, value: any) => {
    setNewRows(prev => prev.map(row => {
      if (row.tempId !== tempId) return row;
      return { ...row, [field]: value };
    }));
  }, []);

  // Delete a new row
  const deleteNewRow = useCallback((tempId: string) => {
    setNewRows(prev => prev.filter(row => row.tempId !== tempId));
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

  // Confirm save
  const handleConfirmSave = useCallback(() => {
    // Filter out deleted items
    const remainingItems = existingItems.filter(item => !deletedItemIds.has(item.id));
    
    // Convert new rows to AnalysisItems
    const newItems: AnalysisItem[] = newRows
      .filter(row => row.name)
      .map(row => {
        const category = CLASS_TO_CATEGORY_MAP[row.name];
        const id = generateNextId(row.name, [...remainingItems]);
        
        return {
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
          controls: [],
          additionalParameters: row.pipeDiameterInches ? {
            pipeDiameterInches: row.pipeDiameterInches,
            pipeDiameterMM: row.pipeDiameterMM,
          } : undefined,
        };
      });

    const allItems = [...remainingItems, ...newItems];
    onUpdateItems(allItems);
    setShowSaveConfirmation(false);
    onClose();
  }, [existingItems, deletedItemIds, newRows, onUpdateItems, onClose]);

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

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-7xl h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit List</DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 flex gap-4 overflow-hidden">
            {/* Left Pane - Existing Items Table */}
            <div className="w-3/5 flex flex-col border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted/50 text-sm font-medium">
                Existing Items ({visibleExistingItems.length})
              </div>
              <div className="flex-1 overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-[140px] py-2 text-xs">Name</TableHead>
                      <TableHead className="w-[160px] py-2 text-xs">Type</TableHead>
                      <TableHead className="w-[90px] py-2 text-xs">ID</TableHead>
                      <TableHead className="w-[60px] py-2 text-xs">Floor</TableHead>
                      {hasAssets && <TableHead className="w-[70px] py-2 text-xs">Size</TableHead>}
                      {hasWaterSystems && <TableHead className="w-[60px] py-2 text-xs">Pipe Ø</TableHead>}
                      <TableHead className="w-[70px] py-2 text-xs">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleExistingItems.map((item) => (
                      <TableRow key={item.id} className="h-8">
                        <TableCell className="py-1 px-2">
                          <span className="text-xs truncate block max-w-[130px]" title={item.areaName}>
                            {item.areaName || "-"}
                          </span>
                        </TableCell>
                        <TableCell className="py-1 px-2">
                          <span className="text-xs truncate block max-w-[150px]" title={item.name}>
                            {item.name}
                          </span>
                        </TableCell>
                        <TableCell className="py-1 px-2 font-mono text-xs">{item.id}</TableCell>
                        <TableCell className="py-1 px-2 text-xs">{item.floor || "-"}</TableCell>
                        {hasAssets && (
                          <TableCell className="py-1 px-2 text-xs">
                            {isAssetClass(item.name) ? getItemSizeDisplay(item) : "-"}
                          </TableCell>
                        )}
                        {hasWaterSystems && (
                          <TableCell className="py-1 px-2 text-xs">
                            {isWaterSystemClass(item.name) ? getItemPipeDisplay(item) : "-"}
                          </TableCell>
                        )}
                        <TableCell className="py-1 px-2">
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
                        </TableCell>
                      </TableRow>
                    ))}
                    {visibleExistingItems.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={hasAssets && hasWaterSystems ? 7 : hasAssets || hasWaterSystems ? 6 : 5} className="text-center py-8 text-muted-foreground text-xs">
                          No existing items
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Right Pane - Add New Items */}
            <div className="w-2/5 flex flex-col border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted/50 flex items-center justify-between">
                <span className="text-sm font-medium">Add New Items</span>
                <Button onClick={handleAddRow} size="sm" variant="outline">
                  <Plus className="w-4 h-4 mr-1" /> Add Row
                </Button>
              </div>
              <ScrollArea className="flex-1 p-3">
                <div className="space-y-4">
                  {newRows.map((row) => {
                    const isAsset = row.name ? isAssetClass(row.name) : false;
                    const isWaterSystem = row.name ? isWaterSystemClass(row.name) : false;
                    
                    return (
                      <div key={row.tempId} className="p-3 border rounded-lg space-y-3 bg-card">
                        <div className="flex justify-between items-start">
                          <span className="text-xs text-muted-foreground">New Item</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => deleteNewRow(row.tempId)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        
                        {/* Type - Searchable Combobox */}
                        <Popover open={openCombobox === row.tempId} onOpenChange={(open) => setOpenCombobox(open ? row.tempId : null)}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={openCombobox === row.tempId}
                              className="w-full justify-between h-8 text-sm font-normal"
                            >
                              {row.name || "Select type..."}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[300px] p-0 bg-background" align="start">
                            <Command>
                              <CommandInput placeholder="Search type..." className="h-9" />
                              <CommandList>
                                <CommandEmpty>No type found.</CommandEmpty>
                                <CommandGroup heading="Asset">
                                  {CLASSES_BY_CATEGORY.Asset.map((cls) => (
                                    <CommandItem
                                      key={cls}
                                      value={cls}
                                      onSelect={() => {
                                        updateNewRow(row.tempId, "name", cls);
                                        setOpenCombobox(null);
                                      }}
                                    >
                                      {cls}
                                      <Check className={cn("ml-auto h-4 w-4", row.name === cls ? "opacity-100" : "opacity-0")} />
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                                <CommandGroup heading="Water System">
                                  {CLASSES_BY_CATEGORY["Water System"].map((cls) => (
                                    <CommandItem
                                      key={cls}
                                      value={cls}
                                      onSelect={() => {
                                        updateNewRow(row.tempId, "name", cls);
                                        setOpenCombobox(null);
                                      }}
                                    >
                                      {cls}
                                      <Check className={cn("ml-auto h-4 w-4", row.name === cls ? "opacity-100" : "opacity-0")} />
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                                <CommandGroup heading="Process">
                                  {CLASSES_BY_CATEGORY.Process.map((cls) => (
                                    <CommandItem
                                      key={cls}
                                      value={cls}
                                      onSelect={() => {
                                        updateNewRow(row.tempId, "name", cls);
                                        setOpenCombobox(null);
                                      }}
                                    >
                                      {cls}
                                      <Check className={cn("ml-auto h-4 w-4", row.name === cls ? "opacity-100" : "opacity-0")} />
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>

                        {/* Name & Floor in row */}
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            className="h-8 text-sm"
                            placeholder="Name"
                            value={row.areaName}
                            onChange={(e) => updateNewRow(row.tempId, "areaName", e.target.value)}
                          />
                          <Input
                            className="h-8 text-sm"
                            placeholder="Floor"
                            value={row.floor}
                            onChange={(e) => updateNewRow(row.tempId, "floor", e.target.value)}
                          />
                        </div>

                        {/* Drawing Code */}
                        <Input
                          className="h-8 text-sm"
                          placeholder="Drawing Code"
                          value={row.drawingCode}
                          onChange={(e) => updateNewRow(row.tempId, "drawingCode", e.target.value)}
                        />

                        {/* Size (Assets) */}
                        {isAsset && (
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              className="h-8 text-sm flex-1"
                              placeholder="Size"
                              value={getNewRowAreaDisplay(row)}
                              onChange={(e) => handleNewRowAreaChange(row.tempId, e.target.value)}
                            />
                            <ToggleGroup
                              type="single"
                              value={areaUnit}
                              onValueChange={(v) => v && setAreaUnit(v as AreaUnit)}
                              className="border rounded-md"
                            >
                              <ToggleGroupItem value="sqft" className="px-2 text-xs h-8">ft²</ToggleGroupItem>
                              <ToggleGroupItem value="sqm" className="px-2 text-xs h-8">m²</ToggleGroupItem>
                            </ToggleGroup>
                          </div>
                        )}

                        {/* Pipe Diameter (Water Systems) */}
                        {isWaterSystem && (
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              className="h-8 text-sm flex-1"
                              placeholder="Pipe Diameter"
                              value={getNewRowPipeDisplay(row)}
                              onChange={(e) => handleNewRowPipeChange(row.tempId, e.target.value)}
                            />
                            <ToggleGroup
                              type="single"
                              value={pipeUnit}
                              onValueChange={(v) => v && setPipeUnit(v as PipeUnit)}
                              className="border rounded-md"
                            >
                              <ToggleGroupItem value="in" className="px-2 text-xs h-8">in</ToggleGroupItem>
                              <ToggleGroupItem value="mm" className="px-2 text-xs h-8">mm</ToggleGroupItem>
                            </ToggleGroup>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {newRows.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      Click "Add Row" to add new items
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
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
        />
      )}

      {/* Save Confirmation Dialog */}
      <AlertDialog open={showSaveConfirmation} onOpenChange={setShowSaveConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Changes</AlertDialogTitle>
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
          </AlertDialogHeader>
          <AlertDialogFooter>
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
