import { useState, useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Plus, Trash2, Pencil } from "lucide-react";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { AWPItemEditModal } from "./AWPItemEditModal";
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

export const AWPEditModal = ({
  isOpen,
  onClose,
  analysisItems,
  onUpdateItems,
}: AWPEditModalProps) => {
  // Existing items (left pane)
  const [existingItems, setExistingItems] = useState<AnalysisItem[]>([]);
  
  // New items being added (right pane)
  const [newRows, setNewRows] = useState<NewRowItem[]>([]);
  
  // Edit modal state
  const [editingItem, setEditingItem] = useState<AnalysisItem | null>(null);
  
  // Delete confirmation state
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  
  // Units for right pane
  const [areaUnit, setAreaUnit] = useState<AreaUnit>("sqft");
  const [pipeUnit, setPipeUnit] = useState<PipeUnit>("in");

  // Initialize when modal opens
  useMemo(() => {
    if (isOpen) {
      setExistingItems(analysisItems.map(item => ({ ...item })));
      setNewRows([]);
    }
  }, [isOpen, analysisItems]);

  // Check if any existing item is an Asset or Water System for column visibility
  const hasAssets = useMemo(() => 
    existingItems.some(item => isAssetClass(item.name)), [existingItems]);
  const hasWaterSystems = useMemo(() => 
    existingItems.some(item => isWaterSystemClass(item.name)), [existingItems]);

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

  // Handle delete confirmation
  const handleDeleteConfirm = useCallback(() => {
    if (deletingItemId) {
      setExistingItems(prev => prev.filter(item => item.id !== deletingItemId));
      setDeletingItemId(null);
    }
  }, [deletingItemId]);

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

  // Save all changes
  const handleSave = useCallback(() => {
    // Convert new rows to AnalysisItems
    const newItems: AnalysisItem[] = newRows
      .filter(row => row.name) // Only include rows with a class selected
      .map(row => {
        const category = CLASS_TO_CATEGORY_MAP[row.name];
        const id = generateNextId(row.name, [...existingItems]);
        
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

    // Combine existing and new items
    const allItems = [...existingItems, ...newItems];
    onUpdateItems(allItems);
    onClose();
  }, [existingItems, newRows, onUpdateItems, onClose]);

  // Get size display for existing item
  const getItemSizeDisplay = (item: AnalysisItem) => {
    const sqft = item.areaSqft || (item as any)?.area_sqft;
    return sqft ? `${Math.round(sqft)} sqft` : "-";
  };

  // Get pipe display for existing item
  const getItemPipeDisplay = (item: AnalysisItem) => {
    const params = item.additionalParameters as any;
    if (params?.pipeDiameterInches) {
      return `${params.pipeDiameterInches}" / ${Math.round(params.pipeDiameterMM || 0)}mm`;
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
                Existing Items ({existingItems.length})
              </div>
              <ScrollArea className="flex-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Name</TableHead>
                      <TableHead className="w-[160px]">Type</TableHead>
                      <TableHead className="w-[90px]">ID</TableHead>
                      <TableHead className="w-[80px]">Floor</TableHead>
                      {hasAssets && <TableHead className="w-[90px]">Size</TableHead>}
                      {hasWaterSystems && <TableHead className="w-[120px]">Pipe Ø</TableHead>}
                      <TableHead className="w-[80px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {existingItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="py-2">
                          <span className="text-sm truncate block max-w-[130px]" title={item.areaName}>
                            {item.areaName || "-"}
                          </span>
                        </TableCell>
                        <TableCell className="py-2">
                          <span className="text-xs truncate block max-w-[150px]" title={item.name}>
                            {item.name}
                          </span>
                        </TableCell>
                        <TableCell className="py-2 font-mono text-xs">{item.id}</TableCell>
                        <TableCell className="py-2 text-sm">{item.floor || "-"}</TableCell>
                        {hasAssets && (
                          <TableCell className="py-2 text-sm">
                            {isAssetClass(item.name) ? getItemSizeDisplay(item) : "-"}
                          </TableCell>
                        )}
                        {hasWaterSystems && (
                          <TableCell className="py-2 text-sm">
                            {isWaterSystemClass(item.name) ? getItemPipeDisplay(item) : "-"}
                          </TableCell>
                        )}
                        <TableCell className="py-2">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setEditingItem(item)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeletingItemId(item.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {existingItems.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={hasAssets && hasWaterSystems ? 7 : hasAssets || hasWaterSystems ? 6 : 5} className="text-center py-8 text-muted-foreground">
                          No existing items
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
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
                        
                        {/* Type */}
                        <Select value={row.name} onValueChange={(v) => updateNewRow(row.tempId, "name", v)}>
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Select type..." />
                          </SelectTrigger>
                          <SelectContent className="bg-background">
                            <SelectGroup>
                              <SelectLabel className="font-semibold text-foreground">Asset</SelectLabel>
                              {CLASSES_BY_CATEGORY.Asset.map((cls) => (
                                <SelectItem key={cls} value={cls} className="text-sm">{cls}</SelectItem>
                              ))}
                            </SelectGroup>
                            <SelectGroup>
                              <SelectLabel className="font-semibold text-foreground">Water System</SelectLabel>
                              {CLASSES_BY_CATEGORY["Water System"].map((cls) => (
                                <SelectItem key={cls} value={cls} className="text-sm">{cls}</SelectItem>
                              ))}
                            </SelectGroup>
                            <SelectGroup>
                              <SelectLabel className="font-semibold text-foreground">Process</SelectLabel>
                              {CLASSES_BY_CATEGORY.Process.map((cls) => (
                                <SelectItem key={cls} value={cls} className="text-sm">{cls}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>

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
                              <ToggleGroupItem value="sqft" className="px-2 text-xs h-8">sqft</ToggleGroupItem>
                              <ToggleGroupItem value="sqm" className="px-2 text-xs h-8">sqm</ToggleGroupItem>
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
            <Button onClick={handleSave}>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingItemId} onOpenChange={(open) => !open && setDeletingItemId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this item from the list. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
