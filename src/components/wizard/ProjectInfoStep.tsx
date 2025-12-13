import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProjectMutation } from "@/hooks/useProjectMutation";

interface ProjectInfoStepProps {
  data: any;
  projectId?: string;
  onLocalChange?: (field: string, value: any) => void;
}

export const ProjectInfoStep = ({ data, projectId, onLocalChange }: ProjectInfoStepProps) => {
  const { updateField } = useProjectMutation(projectId);

  const handleChange = (field: string, value: any) => {
    // Update local state in parent for immediate UI feedback
    onLocalChange?.(field, value);
    // Persist to database (debounced)
    updateField(field, value);
  };

  return (
    <div>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Project name</Label>
          <Input
            id="name"
            value={data.name || ""}
            onChange={(e) => handleChange("name", e.target.value)}
            placeholder="Huron-Axy Tower"
            required
          />
        </div>

        <div className="space-y-2">
          <div className="space-y-3">
            <Input
              id="address_1"
              value={data.address_1 || ""}
              onChange={(e) => handleChange("address_1", e.target.value)}
              placeholder="Address 1"
            />
            <Input
              id="address_2"
              value={data.address_2 || ""}
              onChange={(e) => handleChange("address_2", e.target.value)}
              placeholder="Address 2 (optional)"
              className="text-muted-foreground"
            />
            <div className="grid grid-cols-3 gap-3">
              <Input
                id="city"
                value={data.city || ""}
                onChange={(e) => handleChange("city", e.target.value)}
                placeholder="City"
              />
              <Input
                id="state"
                value={data.state || ""}
                onChange={(e) => handleChange("state", e.target.value)}
                placeholder="State"
              />
              <Input
                id="zip_code"
                value={data.zip_code || ""}
                onChange={(e) => handleChange("zip_code", e.target.value)}
                placeholder="Zip"
              />
            </div>
            <Input
              id="country"
              value={data.country || "United States"}
              onChange={(e) => handleChange("country", e.target.value)}
              placeholder="Country"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="builders_risk">Has the project secured a Builder's Risk Policy?</Label>
          <Select
            value={(data.has_builders_risk_policy ?? false).toString()}
            onValueChange={(value) => handleChange("has_builders_risk_policy", value === "true")}
          >
            <SelectTrigger id="builders_risk">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="false">No</SelectItem>
              <SelectItem value="true">Yes</SelectItem>
            </SelectContent>
          </Select>
        </div>

      </div>
    </div>
  );
};
