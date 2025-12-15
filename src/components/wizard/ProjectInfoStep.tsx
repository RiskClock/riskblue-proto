import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProject } from "@/contexts/ProjectContext";

export const ProjectInfoStep = () => {
  const { projectData, updateField } = useProject();

  return (
    <div>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Project name</Label>
          <Input
            id="name"
            value={projectData.name || ""}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="Huron-Axy Tower"
            required
          />
        </div>

        <div className="space-y-2">
          <div className="space-y-3">
            <Input
              id="address_1"
              value={projectData.address_1 || ""}
              onChange={(e) => updateField("address_1", e.target.value)}
              placeholder="Address 1"
            />
            <Input
              id="address_2"
              value={projectData.address_2 || ""}
              onChange={(e) => updateField("address_2", e.target.value)}
              placeholder="Address 2 (optional)"
              className="text-muted-foreground"
            />
            <div className="grid grid-cols-3 gap-3">
              <Input
                id="city"
                value={projectData.city || ""}
                onChange={(e) => updateField("city", e.target.value)}
                placeholder="City"
              />
              <Input
                id="state"
                value={projectData.state || ""}
                onChange={(e) => updateField("state", e.target.value)}
                placeholder="State"
              />
              <Input
                id="zip_code"
                value={projectData.zip_code || ""}
                onChange={(e) => updateField("zip_code", e.target.value)}
                placeholder="Zip"
              />
            </div>
            <Input
              id="country"
              value={projectData.country || ""}
              onChange={(e) => updateField("country", e.target.value)}
              placeholder="Country"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="builders_risk">Has the project secured a Builder's Risk Policy?</Label>
          <Select
            value={(projectData.has_builders_risk_policy ?? false).toString()}
            onValueChange={(value) => updateField("has_builders_risk_policy", value === "true")}
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
