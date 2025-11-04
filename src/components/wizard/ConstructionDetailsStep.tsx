import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Loader2 } from "lucide-react";
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

const towerTypes = [
  { id: "single", label: "Single Tower", disabled: false, image: singleTowerImg },
  { id: "double", label: "Double Tower", disabled: true, image: doubleTowerImg },
  { id: "multi", label: "Multi-tower", disabled: true, image: multiTowerImg },
];

interface ConstructionDetailsStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
  projectId?: string;
}

export const ConstructionDetailsStep = ({ data, onNext, onBack, projectId }: ConstructionDetailsStepProps) => {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    project_type: data.project_type || "",
    building_type: data.building_type || "",
    tower_type: data.tower_type || "",
    total_floors: data.total_floors || "",
    typical_floors: data.typical_floors || "",
    typical_floors_start: data.typical_floors_start || "",
    typical_floors_end: data.typical_floors_end || "",
    underground_parking: data.underground_parking || false,
    underground_parking_start: data.underground_parking_start || "",
    underground_parking_end: data.underground_parking_end || "",
    above_grade_parking: data.above_grade_parking || false,
  });
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [webhookResponse, setWebhookResponse] = useState<any>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setUploadedFiles(Array.from(e.target.files));
    }
  };

  const handleFileUpload = async () => {
    if (uploadedFiles.length === 0) return;

    setUploading(true);
    try {
      const formDataUpload = new FormData();
      uploadedFiles.forEach((file) => {
        formDataUpload.append("files", file);
      });
      formDataUpload.append("projectId", projectId || "");

      const response = await fetch(
        "https://gyubok.app.n8n.cloud/webhook/8fa778fd-3139-48d2-85af-b5c406186380",
        {
          method: "POST",
          body: formDataUpload,
        }
      );

      if (!response.ok) throw new Error("Upload failed");

      const result = await response.json();
      setWebhookResponse(result);

      toast({
        title: "Success",
        description: "Files uploaded and analyzed successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({ ...formData, uploadedFiles, webhookResponse });
  };

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground mb-1">Step 3 of 7</p>
        <h2 className="text-2xl font-bold text-foreground mb-2">Construction Details</h2>
        <p className="text-sm text-muted-foreground">
          RiskBlue will recommend appropriate Mitigation Controls tailored to the building type and size,
          ensuring effective water risk management. Key structural elements such as the typical floors,
          parking level depth, podium, and above-grade parking play a crucial role in shaping mitigation
          strategies.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div>
          <Label className="text-base mb-4 block">What type of construction is this project?</Label>
          <div className="grid grid-cols-4 gap-4">
            {constructionTypes.map((type) => (
              <button
                key={type.id}
                type="button"
                disabled={type.disabled}
                onClick={() => setFormData({ ...formData, project_type: type.id })}
                className={`relative p-6 rounded-lg border-2 transition-all ${
                  formData.project_type === type.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
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
          <Label className="text-base mb-4 block">What is the building type of this project?</Label>
          <div className="grid grid-cols-4 gap-4">
            {buildingTypes.map((type) => (
              <button
                key={type.id}
                type="button"
                disabled={type.disabled}
                onClick={() => setFormData({ ...formData, building_type: type.id })}
                className={`relative p-6 rounded-lg border-2 transition-all ${
                  formData.building_type === type.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
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

        {formData.building_type === "high-rise" && (
          <>
            <div>
              <Label className="text-base mb-4 block">Tower Configuration</Label>
              <div className="grid grid-cols-3 gap-4">
                {towerTypes.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    disabled={type.disabled}
                    onClick={() => setFormData({ ...formData, tower_type: type.id })}
                    className={`relative p-6 rounded-lg border-2 transition-all ${
                      formData.tower_type === type.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
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
              <Label className="text-base mb-4 block">Additional construction questions</Label>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="total_floors" className="text-sm">
                    How many total floors does the building have?
                  </Label>
                  <Input
                    id="total_floors"
                    type="number"
                    value={formData.total_floors}
                    onChange={(e) => setFormData({ ...formData, total_floors: e.target.value })}
                    placeholder="20"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="typical_floors" className="text-sm">
                    How many typical floors does the building have?
                  </Label>
                  <Input
                    id="typical_floors"
                    type="number"
                    value={formData.typical_floors}
                    onChange={(e) => setFormData({ ...formData, typical_floors: e.target.value })}
                    placeholder="15"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">What level do your typical floors cover?</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={formData.typical_floors_start}
                      onChange={(e) => setFormData({ ...formData, typical_floors_start: e.target.value })}
                      placeholder="P8"
                    />
                    <span>to</span>
                    <Input
                      value={formData.typical_floors_end}
                      onChange={(e) => setFormData({ ...formData, typical_floors_end: e.target.value })}
                      placeholder="9"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Is there an underground parking garage?</Label>
                  <Select
                    value={formData.underground_parking.toString()}
                    onValueChange={(value) =>
                      setFormData({ ...formData, underground_parking: value === "true" })
                    }
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

            <div className="bg-muted/30 p-6 rounded-lg space-y-4">
              <Label className="text-base mb-4 block">Please upload the Mechanical and Electrical drawings</Label>
              <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                <Input
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="max-w-xs mx-auto mb-3"
                  accept=".pdf,.dwg,.dxf,.jpg,.png"
                />
                <p className="text-sm text-muted-foreground">Supported formats: PDF, DWG, DXF, JPG, PNG</p>
                
                {uploadedFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {uploadedFiles.map((file, index) => (
                      <div key={index} className="flex items-center gap-2 justify-center text-sm">
                        <FileText className="h-4 w-4" />
                        <span>{file.name}</span>
                      </div>
                    ))}
                    <Button 
                      type="button" 
                      onClick={handleFileUpload} 
                      disabled={uploading}
                      className="mt-4"
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Uploading & Analyzing...
                        </>
                      ) : (
                        "Upload & Analyze"
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {webhookResponse && (
                <div className="mt-4 p-4 bg-card rounded-lg border">
                  <h4 className="font-semibold mb-2 text-sm">Analysis</h4>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {String(Object.values(webhookResponse)[0])}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>Back</Button>
          <Button type="submit">Continue</Button>
        </div>
      </form>
    </div>
  );
};
