import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { projectSchemas } from "@/lib/validation";

interface ProjectInfoStepProps {
  data: any;
  onNext: (data: any) => void;
}

export const ProjectInfoStep = ({ data, onNext }: ProjectInfoStepProps) => {
  const { toast } = useToast();
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
    
    // Validate project name
    const nameValidation = projectSchemas.name.safeParse(formData.name);
    if (!nameValidation.success) {
      toast({
        title: "Validation Error",
        description: nameValidation.error.errors[0].message,
        variant: "destructive",
      });
      return;
    }

    // Validate zip code if provided
    if (formData.zip_code && formData.zip_code.trim() !== "") {
      const zipValidation = projectSchemas.zipCode.safeParse(formData.zip_code);
      if (!zipValidation.success) {
        toast({
          title: "Validation Error",
          description: zipValidation.error.errors[0].message,
          variant: "destructive",
        });
        return;
      }
    }

    // Validate address fields lengths
    const fields = [
      { value: formData.address_1, schema: projectSchemas.address, name: "Address 1" },
      { value: formData.address_2, schema: projectSchemas.address, name: "Address 2" },
      { value: formData.city, schema: projectSchemas.city, name: "City" },
      { value: formData.state, schema: projectSchemas.state, name: "State" },
      { value: formData.country, schema: projectSchemas.country, name: "Country" },
    ];

    for (const field of fields) {
      if (field.value && field.value.trim() !== "") {
        const validation = field.schema.safeParse(field.value);
        if (!validation.success) {
          toast({
            title: "Validation Error",
            description: `${field.name}: ${validation.error.errors[0].message}`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    onNext(formData);
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-foreground mb-1">Basic Project Info</h2>
        <p className="text-sm text-muted-foreground">
          Enter project details and insurance information for accurate documentation.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
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
          <div className="space-y-3">
            <Input
              id="address_1"
              value={formData.address_1}
              onChange={(e) => setFormData({ ...formData, address_1: e.target.value })}
              placeholder="Address 1"
            />
            <Input
              id="address_2"
              value={formData.address_2}
              onChange={(e) => setFormData({ ...formData, address_2: e.target.value })}
              placeholder="Address 2 (optional)"
              className="text-muted-foreground"
            />
            <div className="grid grid-cols-3 gap-3">
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="City"
              />
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                placeholder="State"
              />
              <Input
                id="zip_code"
                value={formData.zip_code}
                onChange={(e) => setFormData({ ...formData, zip_code: e.target.value })}
                placeholder="Zip"
              />
            </div>
            <Input
              id="country"
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              placeholder="Country"
            />
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
          <Button type="submit">Save</Button>
        </div>
      </form>
    </div>
  );
};
