import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { projectSchemas } from "@/lib/validation";

interface ProjectInfoStepProps {
  data: any;
  onNext: (data: any) => void;
  isProcessingWebhook?: boolean;
}

export const ProjectInfoStep = ({ data, onNext, isProcessingWebhook }: ProjectInfoStepProps) => {
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

  // Effect 1: Sync incoming data to local state only when external data actually changes
  // This prevents overwriting user input when the component re-renders
  useEffect(() => {
    setFormData(prev => {
      // Only update if the incoming data is different from current form state
      // This prevents the form from resetting while user is typing
      const incomingData = {
        name: data.name || "",
        address_1: data.address_1 || "",
        address_2: data.address_2 || "",
        city: data.city || "",
        state: data.state || "",
        zip_code: data.zip_code || "",
        country: data.country || "United States",
        has_builders_risk_policy: data.has_builders_risk_policy || false,
      };
      
      // Check if any value from parent is actually different (and not empty replacing filled)
      const hasRealChanges = Object.keys(incomingData).some(key => {
        const incomingValue = incomingData[key as keyof typeof incomingData];
        const currentValue = prev[key as keyof typeof prev];
        // Only accept change if incoming is not empty or current is also empty
        return incomingValue !== currentValue && (incomingValue !== "" || currentValue === "");
      });
      
      if (hasRealChanges) {
        return incomingData;
      }
      return prev;
    });
  }, [data.name, data.address_1, data.address_2, data.city, data.state, data.zip_code, data.country, data.has_builders_risk_policy]);

  // Effect 2: Auto-save with debounce (blocked during webhook processing)
  useEffect(() => {
    if (isProcessingWebhook) return;
    
    const timer = setTimeout(() => {
      // Validate project name
      const nameValidation = projectSchemas.name.safeParse(formData.name);
      if (!nameValidation.success) return;

      // Validate zip code if provided
      if (formData.zip_code && formData.zip_code.trim() !== "") {
        const zipValidation = projectSchemas.zipCode.safeParse(formData.zip_code);
        if (!zipValidation.success) return;
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
          if (!validation.success) return;
        }
      }

      onNext(formData);
    }, 500);

    return () => clearTimeout(timer);
  }, [formData, onNext, isProcessingWebhook]);

  return (
    <div>
      <div className="space-y-4">
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

      </div>
    </div>
  );
};
