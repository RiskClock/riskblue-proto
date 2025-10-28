import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ProjectInfoStepProps {
  data: any;
  onNext: (data: any) => void;
}

export const ProjectInfoStep = ({ data, onNext }: ProjectInfoStepProps) => {
  const [formData, setFormData] = useState({
    name: data.name || "",
    address_1: data.address_1 || "",
    address_2: data.address_2 || "",
    city: data.city || "",
    state: data.state || "",
    zip_code: data.zip_code || "",
    country: data.country || "United States",
    has_builders_risk_policy: data.has_builders_risk_policy || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext(formData);
  };

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground mb-1">Step 1 of 7</p>
        <h2 className="text-2xl font-bold text-foreground mb-2">Project Info</h2>
        <p className="text-sm text-muted-foreground">
          Filling out project and insurance details ensures all critical information is documented,
          helping to avoid delays and misunderstandings during construction. Inviting other stakeholders
          to contribute allows for accurate and comprehensive data entry, creating a shared source of
          truth for the entire team. This collaboration streamlines communication, reduces risks, and
          ensures the project runs smoothly from start to finish.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="name">Project name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Huron-Axy Tower"
            required
          />
        </div>

        <div className="space-y-2">
          <Label>Project address</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="address_1" className="text-sm text-muted-foreground">Address 1</Label>
              <Input
                id="address_1"
                value={formData.address_1}
                onChange={(e) => setFormData({ ...formData, address_1: e.target.value })}
                placeholder="5060 Flagami Blvd"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="address_2" className="text-sm text-muted-foreground">Address 2</Label>
              <Input
                id="address_2"
                value={formData.address_2}
                onChange={(e) => setFormData({ ...formData, address_2: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city" className="text-sm text-muted-foreground">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Miami"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state" className="text-sm text-muted-foreground">State / Province</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                placeholder="Florida"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip_code" className="text-sm text-muted-foreground">Zip / Postal code</Label>
              <Input
                id="zip_code"
                value={formData.zip_code}
                onChange={(e) => setFormData({ ...formData, zip_code: e.target.value })}
                placeholder="33144"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country" className="text-sm text-muted-foreground">Country</Label>
              <Input
                id="country"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                placeholder="United States"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="builders_risk">Has the project secured a Builder's Risk Policy?</Label>
          <Select
            value={formData.has_builders_risk_policy.toString()}
            onValueChange={(value) =>
              setFormData({ ...formData, has_builders_risk_policy: value === "true" })
            }
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

        <div className="flex justify-end">
          <Button type="submit">Continue</Button>
        </div>
      </form>
    </div>
  );
};
