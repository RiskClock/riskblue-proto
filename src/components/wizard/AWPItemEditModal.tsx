import { useState, useCallback, useMemo, useRef, ChangeEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Paperclip, X, Loader2 } from "lucide-react";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { useAWPOptions, groupAWPOptionsByCategory, isAssetName, isWaterSystemName, getCategoryForName } from "@/hooks/useAWPOptions";
import { supabase } from "@/integrations/supabase/client";
import {
  generateNextIdFromOptions,
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
  projectId?: string;
}

type AreaUnit = "sqft" | "sqm";
type PipeUnit = "in" | "mm";

export const AWPItemEditModal = ({
  isOpen,
  onClose,
  item,
  allItems,
  onSave,
  projectId,
}: AWPItemEditModalProps) => {
  // Fetch AWP options from DB
  const { data: awpOptions = [] } = useAWPOptions();
  const groupedOptions = useMemo(() => groupAWPOptionsByCategory(awpOptions), [awpOptions]);
  
  const [localItem, setLocalItem] = useState<AnalysisItem>({ ...item });
  const [areaUnit, setAreaUnit] = useState<AreaUnit>("sqft");
  const [pipeUnit, setPipeUnit] = useState<PipeUnit>("in");
  
  // Drawing upload state
  const [drawingFile, setDrawingFile] = useState<File | null>(null);
  const [uploadingDrawing, setUploadingDrawing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset local state when item changes
  useMemo(() => {
    if (isOpen) {
      setLocalItem({ ...item });
      setDrawingFile(null);
    }
  }, [isOpen, item]);

  const updateField = useCallback((updates: Partial<AnalysisItem>) => {
    setLocalItem(prev => {
      const updated = { ...prev, ...updates };
      
      // If class name changed, update category and regenerate ID
      if (updates.name && updates.name !== prev.name) {
        const newCategory = getCategoryForName(awpOptions, updates.name);
        if (newCategory) {
          updated.category = newCategory;
          // Regenerate ID based on new class
          const otherItems = allItems.filter(i => i.id !== prev.id);
          updated.id = generateNextIdFromOptions(updates.name, awpOptions, otherItems);
        }
      }
      
      return updated;
    });
  }, [allItems, awpOptions]);

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

  const handleFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setDrawingFile(file);
    }
  }, []);

  const clearDrawing = useCallback(() => {
    setDrawingFile(null);
    updateField({ drawingUrl: undefined });
  }, [updateField]);

  const handleSave = useCallback(async () => {
    let finalDrawingUrl = localItem.drawingUrl || (localItem as any).drawing_url;
    
    // Upload new drawing if selected
    if (drawingFile && projectId) {
      setUploadingDrawing(true);
      const fileName = `${projectId}/${Date.now()}-${drawingFile.name}`;
      const { data, error } = await supabase.storage
        .from('awp-drawings')
        .upload(fileName, drawingFile);
      
      if (!error && data) {
        const { data: urlData } = supabase.storage
          .from('awp-drawings')
          .getPublicUrl(data.path);
        finalDrawingUrl = urlData.publicUrl;
      }
      setUploadingDrawing(false);
    }
    
    onSave({ ...localItem, drawingUrl: finalDrawingUrl });
    onClose();
  }, [localItem, onSave, onClose, drawingFile, projectId]);

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

  const isItemAsset = localItem?.name ? isAssetName(awpOptions, localItem.name) : false;
  const isItemWaterSystem = localItem?.name ? isWaterSystemName(awpOptions, localItem.name) : false;
  
  const hasExistingDrawing = !!(localItem.drawingUrl || (localItem as any).drawing_url);

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
                {groupedOptions["Asset"] && groupedOptions["Asset"].length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="font-semibold text-foreground">Asset</SelectLabel>
                    {groupedOptions["Asset"].map((opt) => (
                      <SelectItem key={opt.id} value={opt.name}>{opt.name}</SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {groupedOptions["Water System"] && groupedOptions["Water System"].length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="font-semibold text-foreground">Water System</SelectLabel>
                    {groupedOptions["Water System"].map((opt) => (
                      <SelectItem key={opt.id} value={opt.name}>{opt.name}</SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {groupedOptions["Process"] && groupedOptions["Process"].length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="font-semibold text-foreground">Process</SelectLabel>
                    {groupedOptions["Process"].map((opt) => (
                      <SelectItem key={opt.id} value={opt.name}>{opt.name}</SelectItem>
                    ))}
                  </SelectGroup>
                )}
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

          {/* Drawing Upload */}
          <div>
            <Label>Drawing</Label>
            <div className="flex items-center gap-2 mt-1">
              {(hasExistingDrawing || drawingFile) ? (
                <>
                  <span className="text-sm text-muted-foreground truncate flex-1">
                    {drawingFile?.name || "Current drawing"}
                  </span>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Replace
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8"
                    onClick={clearDrawing}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <Button 
                  variant="outline" 
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="w-4 h-4 mr-2" />
                  Upload Drawing
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
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
          <Button onClick={handleSave} disabled={uploadingDrawing}>
            {uploadingDrawing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
