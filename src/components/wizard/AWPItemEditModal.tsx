import { useState, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

interface AWPItemEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: AnalysisItem;
  allItems: AnalysisItem[];
  onSave: (updatedItem: AnalysisItem) => void;
}

type AreaUnit = "sqft" | "sqm";
type PipeUnit = "in" | "mm";

export const AWPItemEditModal = ({
  isOpen,
  onClose,
  item,
  allItems,
  onSave,
}: AWPItemEditModalProps) => {
  const [localItem, setLocalItem] = useState<AnalysisItem>({ ...item });
  const [areaUnit, setAreaUnit] = useState<AreaUnit>("sqft");
  const [pipeUnit, setPipeUnit] = useState<PipeUnit>("in");

  // Reset local state when item changes
  useMemo(() => {
    if (isOpen) {
      setLocalItem({ ...item });
    }
  }, [isOpen, item]);

  const updateField = useCallback((updates: Partial<AnalysisItem>) => {
    setLocalItem(prev => {
      const updated = { ...prev, ...updates };
      
      // If class name changed, update category and regenerate ID
      if (updates.name && updates.name !== prev.name) {
        const newCategory = CLASS_TO_CATEGORY_MAP[updates.name];
        if (newCategory) {
          updated.category = newCategory;
          // Regenerate ID based on new class
          const otherItems = allItems.filter(i => i.id !== prev.id);
          updated.id = generateNextId(updates.name, otherItems);
        }
      }
      
      return updated;
    });
  }, [allItems]);

  const handleAreaChange = useCallback((value: string, unit: AreaUnit) => {
    const numValue = parseFloat(value) || 0;
    if (unit === "sqft") {
      updateField({ areaSqft: numValue });
    } else {
      updateField({ areaSqft: sqmToSqft(numValue) });
    }
  }, [updateField]);

  const handlePipeDiameterChange = useCallback((value: string, unit: PipeUnit) => {
    const numValue = parseFloat(value) || 0;
    const additionalParams = localItem?.additionalParameters || {};
    
    if (unit === "in") {
      updateField({
        additionalParameters: {
          ...additionalParams,
          pipeDiameterInches: numValue,
          pipeDiameterMM: inchesToMm(numValue),
        },
      });
    } else {
      updateField({
        additionalParameters: {
          ...additionalParams,
          pipeDiameterMM: numValue,
          pipeDiameterInches: mmToInches(numValue),
        },
      });
    }
  }, [localItem, updateField]);

  const handleSave = useCallback(() => {
    onSave(localItem);
    onClose();
  }, [localItem, onSave, onClose]);

  const getDisplayedArea = useCallback(() => {
    const sqft = localItem?.areaSqft || (localItem as any)?.area_sqft || 0;
    if (areaUnit === "sqft") return sqft;
    return sqftToSqm(sqft);
  }, [localItem, areaUnit]);

  const getDisplayedPipeDiameter = useCallback(() => {
    const params = localItem?.additionalParameters as any;
    if (pipeUnit === "in") {
      return params?.pipeDiameterInches || 0;
    }
    return params?.pipeDiameterMM || 0;
  }, [localItem, pipeUnit]);

  const isItemAsset = localItem?.name ? isAssetClass(localItem.name) : false;
  const isItemWaterSystem = localItem?.name ? isWaterSystemClass(localItem.name) : false;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Item</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* ID (read-only) */}
          <div>
            <Label className="text-muted-foreground">ID</Label>
            <Input value={localItem.id} disabled className="bg-muted" />
          </div>

          {/* AWP Class Dropdown */}
          <div>
            <Label>AWP Class</Label>
            <Select value={localItem.name || ""} onValueChange={(v) => updateField({ name: v })}>
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
              value={localItem.areaName || ""}
              onChange={(e) => updateField({ areaName: e.target.value })}
              placeholder="e.g., IT ROOM"
            />
          </div>

          {/* Floor */}
          <div>
            <Label>Floor</Label>
            <Input
              value={localItem.floor || ""}
              onChange={(e) => updateField({ floor: e.target.value })}
              placeholder="e.g., Lower Level"
            />
          </div>

          {/* Drawing Code */}
          <div>
            <Label>Drawing Code</Label>
            <Input
              value={localItem.drawingCode || ""}
              onChange={(e) => updateField({ drawingCode: e.target.value })}
              placeholder="e.g., SWC-408"
            />
          </div>

          {/* Source File */}
          <div>
            <Label>Source File</Label>
            <Input
              value={localItem.fileName || ""}
              onChange={(e) => updateField({ fileName: e.target.value })}
              placeholder="e.g., A2.01-LOWER-LEVEL.pdf"
            />
          </div>

          {/* Size (Assets only) */}
          {isItemAsset && (
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
                  <ToggleGroupItem value="sqft" className="px-3 text-xs">sqft</ToggleGroupItem>
                  <ToggleGroupItem value="sqm" className="px-3 text-xs">sqm</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          )}

          {/* Pipe Diameter (Water Systems only) */}
          {isItemWaterSystem && (
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
                  <ToggleGroupItem value="in" className="px-3 text-xs">in</ToggleGroupItem>
                  <ToggleGroupItem value="mm" className="px-3 text-xs">mm</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
