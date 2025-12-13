import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProjectMutation } from "@/hooks/useProjectMutation";

import residentialImg from "@/assets/type1-residential.avif";
import mixedUseImg from "@/assets/type2-mixeduse.avif";
import institutionalImg from "@/assets/type3-institutional.avif";
import commercialImg from "@/assets/type4-commercial.avif";
import midRiseImg from "@/assets/buildingtype1-mid-rise.avif";
import highRiseImg from "@/assets/buildingtype2-high-rise.avif";
import singleHouseImg from "@/assets/buildingtype3-singlehouse.avif";
import houseComplexImg from "@/assets/buildingtype4-housecomplex.avif";
import singleTowerImg from "@/assets/tower1-single.avif";
import doubleTowerImg from "@/assets/tower2-double.avif";
import multiTowerImg from "@/assets/tower3-multi.avif";
import castInPlaceImg from "@/assets/structuraltype_cast-in-place.png";
import precastImg from "@/assets/structuraltype_precast.png";
import steelImg from "@/assets/structuraltype_steel.png";
import massTimberImg from "@/assets/structuraltype_mass_timber.png";

const constructionTypes = [
  { id: "residential", label: "Residential", disabled: false, image: residentialImg },
  { id: "mixed-use", label: "Mixed Use", disabled: false, image: mixedUseImg },
  { id: "institutional", label: "Institutional", disabled: false, image: institutionalImg },
  { id: "commercial", label: "Commercial", disabled: false, image: commercialImg },
];

const buildingTypes = [
  { id: "mid-rise", label: "Mid-rise", disabled: false, image: midRiseImg },
  { id: "high-rise", label: "High-rise", disabled: false, image: highRiseImg },
  { id: "single-house", label: "Single House", disabled: true, image: singleHouseImg },
  { id: "house-complex", label: "House Complex", disabled: true, image: houseComplexImg },
];

const structuralTypes = [
  { id: "cast-in-place", label: "Cast-in-Place Reinforced Concrete", disabled: false, image: castInPlaceImg },
  { id: "precast", label: "Precast Concrete", disabled: false, image: precastImg },
  { id: "steel", label: "Steel", disabled: false, image: steelImg },
  { id: "mass-timber", label: "Mass Timber", disabled: false, image: massTimberImg },
];

const towerTypes = [
  { id: "single", label: "Single Tower", disabled: false, image: singleTowerImg },
  { id: "double", label: "Double Tower", disabled: false, image: doubleTowerImg },
  { id: "multi", label: "Multi-tower", disabled: false, image: multiTowerImg },
];

interface ConstructionDetailsStepProps {
  data: any;
  projectId?: string;
  onLocalChange?: (field: string, value: any) => void;
}

export const ConstructionDetailsStep = ({ data, projectId, onLocalChange }: ConstructionDetailsStepProps) => {
  const { updateField } = useProjectMutation(projectId);

  const handleChange = (field: string, value: any) => {
    onLocalChange?.(field, value);
    updateField(field, value);
  };

  const toggleStructuralType = (typeId: string) => {
    const currentTypes = data.structural_types || [];
    const newTypes = currentTypes.includes(typeId)
      ? currentTypes.filter((t: string) => t !== typeId)
      : [...currentTypes, typeId];
    handleChange("structural_types", newTypes);
  };

  return (
    <div>
      <div className="space-y-8">
        <div>
          <Label className="text-base mb-4 block">Construction Type</Label>
          <div className="grid grid-cols-4 gap-4">
            {constructionTypes.map((type) => (
              <button
                key={type.id}
                type="button"
                disabled={type.disabled}
                onClick={() => handleChange("project_type", type.id)}
                className={`relative p-6 rounded-lg transition-all ${
                  data.project_type === type.id
                    ? "border-4 border-primary bg-primary/5"
                    : "border-2 border-border hover:border-primary/50"
                } ${type.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div className="h-24 bg-muted rounded mb-3 flex items-center justify-center overflow-hidden">
                  <img src={type.image} alt={type.label} className="w-full h-full object-contain" />
                </div>
                <p className="text-sm text-center">{type.label}</p>
                {type.disabled && (
                  <div className="absolute top-2 right-2 text-xs bg-muted px-2 py-1 rounded">
                    Coming Soon
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-base mb-4 block">Building Type</Label>
          <div className="grid grid-cols-4 gap-4">
            {buildingTypes.map((type) => (
              <button
                key={type.id}
                type="button"
                disabled={type.disabled}
                onClick={() => handleChange("building_type", type.id)}
                className={`relative p-6 rounded-lg transition-all ${
                  data.building_type === type.id
                    ? "border-4 border-primary bg-primary/5"
                    : "border-2 border-border hover:border-primary/50"
                } ${type.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div className="h-24 bg-muted rounded mb-3 flex items-center justify-center overflow-hidden">
                  <img src={type.image} alt={type.label} className="w-full h-full object-contain" />
                </div>
                <p className="text-sm text-center">{type.label}</p>
                {type.disabled && (
                  <div className="absolute top-2 right-2 text-xs bg-muted px-2 py-1 rounded">
                    Coming Soon
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-base mb-4 block">Structural Type</Label>
          <div className="grid grid-cols-4 gap-4">
            {structuralTypes.map((type) => {
              const isSelected = (data.structural_types || []).includes(type.id);
              return (
                <button
                  key={type.id}
                  type="button"
                  disabled={type.disabled}
                  onClick={() => toggleStructuralType(type.id)}
                  className={`relative p-6 rounded-lg transition-all ${
                    isSelected
                      ? "border-4 border-primary bg-primary/5"
                      : "border-2 border-border hover:border-primary/50"
                  } ${type.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <div className="h-24 bg-muted rounded mb-3 flex items-center justify-center overflow-hidden">
                    <img src={type.image} alt={type.label} className="w-full h-full object-contain p-2" />
                  </div>
                  <p className="text-sm text-center">{type.label}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label className="text-base mb-4 block">Tower Configuration</Label>
          <div className="grid grid-cols-3 gap-4">
            {towerTypes.map((type) => (
              <button
                key={type.id}
                type="button"
                disabled={type.disabled}
                onClick={() => handleChange("tower_type", type.id)}
                className={`relative p-6 rounded-lg transition-all ${
                  data.tower_type === type.id
                    ? "border-4 border-primary bg-primary/5"
                    : "border-2 border-border hover:border-primary/50"
                } ${type.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div className="h-24 bg-muted rounded mb-3 flex items-center justify-center overflow-hidden">
                  <img src={type.image} alt={type.label} className="w-full h-full object-contain" />
                </div>
                <p className="text-sm text-center">{type.label}</p>
                {type.disabled && (
                  <div className="absolute top-2 right-2 text-xs bg-muted px-2 py-1 rounded">
                    Coming Soon
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-base mb-4 block">Building Details</Label>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-sm">Podium</Label>
              <Select
                value={(data.has_podium ?? false).toString()}
                onValueChange={(value) => handleChange("has_podium", value === "true")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">No</SelectItem>
                  <SelectItem value="true">Yes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="total_floors" className="text-sm">
                Total Floors
              </Label>
              <Input
                id="total_floors"
                type="number"
                value={data.total_floors || ""}
                onChange={(e) => handleChange("total_floors", e.target.value)}
                placeholder="20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="typical_floors" className="text-sm">
                Typical Floors
              </Label>
              <Input
                id="typical_floors"
                type="number"
                value={data.typical_floors || ""}
                onChange={(e) => handleChange("typical_floors", e.target.value)}
                placeholder="15"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Typical Floor Range</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={data.typical_floors_start || ""}
                  onChange={(e) => handleChange("typical_floors_start", e.target.value)}
                  placeholder="P8"
                />
                <span>to</span>
                <Input
                  value={data.typical_floors_end || ""}
                  onChange={(e) => handleChange("typical_floors_end", e.target.value)}
                  placeholder="9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Underground Parking</Label>
              <Select
                value={(data.underground_parking ?? false).toString()}
                onValueChange={(value) => handleChange("underground_parking", value === "true")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">No</SelectItem>
                  <SelectItem value="true">Yes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
