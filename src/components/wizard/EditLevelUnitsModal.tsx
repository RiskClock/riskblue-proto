import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Plus, X } from "lucide-react";
import {
  type ParsedFloorPlan,
  floorPlanDisplayLabel,
  unitPlanRefKey,
} from "@/lib/surveyFloorPlans";
import { awpClassColor, readableTextOn } from "@/lib/awpColor";

interface EditLevelUnitsModalProps {
  isOpen: boolean;
  onClose: () => void;
  levelPlan: ParsedFloorPlan;
  currentUnits: string[];
  allUnitPlans: ParsedFloorPlan[];
  onSave: (units: string[]) => void | Promise<void>;
}

export const EditLevelUnitsModal = ({
  isOpen,
  onClose,
  levelPlan,
  currentUnits,
  allUnitPlans,
  onSave,
}: EditLevelUnitsModalProps) => {
  const [units, setUnits] = useState<string[]>(currentUnits);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setUnits(currentUnits);
  }, [currentUnits, isOpen]);

  const unitColor = awpClassColor("unit_floor_plan");
  const unitTextColor = readableTextOn(unitColor);

  const pickerOptions = Array.from(
    new Set(allUnitPlans.map((u) => unitPlanRefKey(u))),
  )
    .filter((u) => !!u && !units.includes(u))
    .sort();

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(units);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Units for {floorPlanDisplayLabel(levelPlan)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                {units.length} unit{units.length === 1 ? "" : "s"}
              </span>
              {pickerOptions.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="h-7">
                      <Plus className="h-3 w-3 mr-1" />
                      Add unit
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-56 p-1 max-h-64 overflow-y-auto">
                    <div className="space-y-0.5">
                      {pickerOptions.map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => setUnits((prev) => [...prev, u])}
                          className="w-full text-left text-xs px-2 py-1 rounded hover:bg-muted"
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 min-h-[2rem] p-2 border rounded-md bg-muted/30">
              {units.length === 0 ? (
                <span className="text-xs italic text-muted-foreground">
                  No units assigned.
                </span>
              ) : (
                units.map((u) => (
                  <Badge
                    key={u}
                    variant="outline"
                    className="h-6 px-2 text-xs gap-1"
                    style={{
                      backgroundColor: unitColor,
                      color: unitTextColor,
                      borderColor: unitColor,
                    }}
                  >
                    {u}
                    <button
                      type="button"
                      onClick={() =>
                        setUnits((prev) => prev.filter((x) => x !== u))
                      }
                      className="hover:opacity-70"
                      aria-label={`Remove ${u}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
