import { useState, useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnalysisItem } from "@/lib/analysisItemMapper";
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

interface EditableItem extends AnalysisItem {
  isNew?: boolean;
}

export const AWPEditModal = ({
  isOpen,
  onClose,
  analysisItems,
  onUpdateItems,
}: AWPEditModalProps) => {
  const [localItems, setLocalItems] = useState<EditableItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [areaUnit, setAreaUnit] = useState<AreaUnit>("sqft");
  const [pipeUnit, setPipeUnit] = useState<PipeUnit>("in");

  // Initialize local items when modal opens
  useMemo(() => {
    if (isOpen) {
      setLocalItems(analysisItems.map(item => ({ ...item })));
      setSelectedItemId(analysisItems[0]?.id || null);
    }
  }, [isOpen, analysisItems]);

  const selectedItem = useMemo(
    () => localItems.find(item => item.id === selectedItemId) || null,
    [localItems, selectedItemId]
  );

  const handleAddRow = useCallback(() => {
    const tempId = `NEW-${Date.now()}`;
    const newItem: EditableItem = {
      id: tempId,
      name: "",
      category: "Asset",
      areaName: "",
      floor: "",
      drawingCode: "",
      fileName: "",
      width: undefined,
      length: undefined,
      areaSqft: undefined,
      sizeCategory: undefined,
      coordinates: undefined,
      controls: [],
      isNew: true,
    };
    setLocalItems(prev => [...prev, newItem]);
    setSelectedItemId(tempId);
  }, []);

  const handleDeleteItem = useCallback((itemId: string) => {
    setLocalItems(prev => prev.filter(item => item.id !== itemId));
    if (selectedItemId === itemId) {
      const remaining = localItems.filter(item => item.id !== itemId);
      setSelectedItemId(remaining[0]?.id || null);
    }
  }, [localItems, selectedItemId]);

  const updateSelectedItem = useCallback((updates: Partial<EditableItem>) => {
    if (!selectedItemId) return;
    setLocalItems(prev => prev.map(item => {
      if (item.id !== selectedItemId) return item;
      const updated = { ...item, ...updates };
      
      // If class name changed, update category and regenerate ID
      if (updates.name && updates.name !== item.name) {
        const newCategory = CLASS_TO_CATEGORY_MAP[updates.name];
        if (newCategory) {
          updated.category = newCategory;
          // Regenerate ID based on new class
          const newId = generateNextId(updates.name, prev.filter(i => i.id !== selectedItemId));
          updated.id = newId;
          // Also update selectedItemId to track the new ID
          setTimeout(() => setSelectedItemId(newId), 0);
        }
      }
      
      return updated;
    }));
  }, [selectedItemId]);

  const handleClassChange = useCallback((className: string) => {
    updateSelectedItem({ name: className });
  }, [updateSelectedItem]);

  const handleAreaChange = useCallback((value: string, unit: AreaUnit) => {
    const numValue = parseFloat(value) || 0;
    if (unit === "sqft") {
      updateSelectedItem({ areaSqft: numValue });
    } else {
      // Convert sqm to sqft for storage
      updateSelectedItem({ areaSqft: sqmToSqft(numValue) });
    }
  }, [updateSelectedItem]);

  const handlePipeDiameterChange = useCallback((value: string, unit: PipeUnit) => {
    const numValue = parseFloat(value) || 0;
    const additionalParams = selectedItem?.additionalParameters || {};
    
    if (unit === "in") {
      updateSelectedItem({
        additionalParameters: {
          ...additionalParams,
          pipeDiameterInches: numValue,
          pipeDiameterMM: inchesToMm(numValue),
        },
      });
    } else {
      updateSelectedItem({
        additionalParameters: {
          ...additionalParams,
          pipeDiameterMM: numValue,
          pipeDiameterInches: mmToInches(numValue),
        },
      });
    }
  }, [selectedItem, updateSelectedItem]);

  const handleSave = useCallback(() => {
    // Filter out items without a class name
    const validItems = localItems.filter(item => item.name);
    // Remove the isNew flag
    const cleanedItems = validItems.map(({ isNew, ...item }) => item as AnalysisItem);
    onUpdateItems(cleanedItems);
    onClose();
  }, [localItems, onUpdateItems, onClose]);

  // Get displayed area value based on unit
  const getDisplayedArea = useCallback(() => {
    const sqft = selectedItem?.areaSqft || (selectedItem as any)?.area_sqft || 0;
    if (areaUnit === "sqft") return sqft;
    return sqftToSqm(sqft);
  }, [selectedItem, areaUnit]);

  // Get displayed pipe diameter based on unit
  const getDisplayedPipeDiameter = useCallback(() => {
    const params = selectedItem?.additionalParameters as any;
    if (pipeUnit === "in") {
      return params?.pipeDiameterInches || 0;
    }
    return params?.pipeDiameterMM || 0;
  }, [selectedItem, pipeUnit]);

  const isSelectedAsset = selectedItem?.name ? isAssetClass(selectedItem.name) : false;
  const isSelectedWaterSystem = selectedItem?.name ? isWaterSystemClass(selectedItem.name) : false;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit AWP Items</DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 flex gap-4 overflow-hidden">
          {/* Left Pane - List */}
          <div className="w-1/3 flex flex-col border rounded-lg overflow-hidden">
            <div className="p-2 border-b bg-muted/50">
              <Button onClick={handleAddRow} size="sm" className="w-full">
                <Plus className="w-4 h-4 mr-1" /> Add Row
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {localItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setSelectedItemId(item.id)}
                    className={cn(
                      "p-2 rounded cursor-pointer text-sm transition-colors",
                      selectedItemId === item.id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    )}
                  >
                    <div className="font-medium truncate">
                      {item.name || <span className="italic text-muted-foreground">New Item</span>}
                    </div>
                    <div className="text-xs opacity-70 truncate">
                      {item.id} • {item.areaName || item.floor || "No location"}
                    </div>
                  </div>
                ))}
                {localItems.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No items. Click "Add Row" to create one.
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Right Pane - Edit Form */}
          <div className="w-2/3 border rounded-lg p-4 overflow-y-auto">
            {selectedItem ? (
              <div className="space-y-4">
                {/* ID (read-only) */}
                <div>
                  <Label className="text-muted-foreground">ID</Label>
                  <Input value={selectedItem.id} disabled className="bg-muted" />
                </div>

                {/* AWP Class Dropdown */}
                <div>
                  <Label>AWP Class</Label>
                  <Select value={selectedItem.name || ""} onValueChange={handleClassChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a class" />
                    </SelectTrigger>
                    <SelectContent className="bg-background">
                      <SelectGroup>
                        <SelectLabel className="font-semibold text-foreground">Asset</SelectLabel>
                        {CLASSES_BY_CATEGORY.Asset.map((cls) => (
                          <SelectItem key={cls} value={cls}>{cls}</SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel className="font-semibold text-foreground">Water System</SelectLabel>
                        {CLASSES_BY_CATEGORY["Water System"].map((cls) => (
                          <SelectItem key={cls} value={cls}>{cls}</SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel className="font-semibold text-foreground">Process</SelectLabel>
                        {CLASSES_BY_CATEGORY.Process.map((cls) => (
                          <SelectItem key={cls} value={cls}>{cls}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                {/* Area Name */}
                <div>
                  <Label>Area Name</Label>
                  <Input
                    value={selectedItem.areaName || ""}
                    onChange={(e) => updateSelectedItem({ areaName: e.target.value })}
                    placeholder="e.g., IT ROOM"
                  />
                </div>

                {/* Floor */}
                <div>
                  <Label>Floor</Label>
                  <Input
                    value={selectedItem.floor || ""}
                    onChange={(e) => updateSelectedItem({ floor: e.target.value })}
                    placeholder="e.g., Lower Level"
                  />
                </div>

                {/* Drawing Code */}
                <div>
                  <Label>Drawing Code</Label>
                  <Input
                    value={selectedItem.drawingCode || ""}
                    onChange={(e) => updateSelectedItem({ drawingCode: e.target.value })}
                    placeholder="e.g., SWC-408"
                  />
                </div>

                {/* Source File */}
                <div>
                  <Label>Source File</Label>
                  <Input
                    value={selectedItem.fileName || ""}
                    onChange={(e) => updateSelectedItem({ fileName: e.target.value })}
                    placeholder="e.g., A2.01-LOWER-LEVEL.pdf"
                  />
                </div>

                {/* Size (Assets only) */}
                {isSelectedAsset && (
                  <div>
                    <Label>Size</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        value={getDisplayedArea() || ""}
                        onChange={(e) => handleAreaChange(e.target.value, areaUnit)}
                        placeholder="0"
                        className="flex-1"
                      />
                      <ToggleGroup
                        type="single"
                        value={areaUnit}
                        onValueChange={(v) => v && setAreaUnit(v as AreaUnit)}
                        className="border rounded-md"
                      >
                        <ToggleGroupItem value="sqft" className="px-3 text-xs">
                          sqft
                        </ToggleGroupItem>
                        <ToggleGroupItem value="sqm" className="px-3 text-xs">
                          sqm
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                  </div>
                )}

                {/* Pipe Diameter (Water Systems only) */}
                {isSelectedWaterSystem && (
                  <div>
                    <Label>Pipe Diameter</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        value={getDisplayedPipeDiameter() || ""}
                        onChange={(e) => handlePipeDiameterChange(e.target.value, pipeUnit)}
                        placeholder="0"
                        className="flex-1"
                      />
                      <ToggleGroup
                        type="single"
                        value={pipeUnit}
                        onValueChange={(v) => v && setPipeUnit(v as PipeUnit)}
                        className="border rounded-md"
                      >
                        <ToggleGroupItem value="in" className="px-3 text-xs">
                          in
                        </ToggleGroupItem>
                        <ToggleGroupItem value="mm" className="px-3 text-xs">
                          mm
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                  </div>
                )}

                {/* Delete Button */}
                <div className="pt-4 border-t">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDeleteItem(selectedItem.id)}
                  >
                    <Trash2 className="w-4 h-4 mr-1" /> Delete Item
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Select an item to edit or add a new one
              </div>
            )}
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
  );
};
