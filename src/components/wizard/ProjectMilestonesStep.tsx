import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProject } from "@/contexts/ProjectContext";
import structuralImg from "@/assets/timeline1-structural.avif";
import envelopeImg from "@/assets/timeline2-envelope.avif";
import mepImg from "@/assets/timeline3-MEP.avif";
import elevatorsImg from "@/assets/timeline4-elevators.avif";
import fireImg from "@/assets/timeline5-fire.avif";
import interiorImg from "@/assets/timeline6-interior.avif";

export const ProjectMilestonesStep = () => {
  const { projectData, updateField } = useProject();

  return (
    <div className="space-y-8">
      <div>
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="start_date" className="text-sm text-muted-foreground">Start date</Label>
            <Input
              id="start_date"
              type="date"
              value={projectData.construction_start_date || ""}
              onChange={(e) => updateField("construction_start_date", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="end_date" className="text-sm text-muted-foreground">Est. finish date</Label>
            <Input
              id="end_date"
              type="date"
              value={projectData.construction_end_date || ""}
              onChange={(e) => updateField("construction_end_date", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-muted/30 p-6 rounded-lg space-y-4">
          <div className="h-32 bg-muted rounded flex items-center justify-center overflow-hidden">
            <img src={structuralImg} alt="Structural frame" className="w-full h-full object-contain" />
          </div>
          <Label className="text-base font-semibold">Structural Frame</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="frame_start" className="text-sm text-muted-foreground">Start date</Label>
              <Input
                id="frame_start"
                type="date"
                value={projectData.frame_start_date || ""}
                onChange={(e) => updateField("frame_start_date", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="frame_end" className="text-sm text-muted-foreground">Est. finish date</Label>
              <Input
                id="frame_end"
                type="date"
                value={projectData.frame_end_date || ""}
                onChange={(e) => updateField("frame_end_date", e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="bg-muted/30 p-6 rounded-lg space-y-4">
          <div className="h-32 bg-muted rounded flex items-center justify-center overflow-hidden">
            <img src={envelopeImg} alt="Building envelope" className="w-full h-full object-contain" />
          </div>
          <Label className="text-base font-semibold">Building Envelope</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="enclosure_start" className="text-sm text-muted-foreground">Start date</Label>
              <Input
                id="enclosure_start"
                type="date"
                value={projectData.enclosure_start_date || ""}
                onChange={(e) => updateField("enclosure_start_date", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="enclosure_end" className="text-sm text-muted-foreground">Est. finish date</Label>
              <Input
                id="enclosure_end"
                type="date"
                value={projectData.enclosure_end_date || ""}
                onChange={(e) => updateField("enclosure_end_date", e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="bg-muted/30 p-6 rounded-lg space-y-4">
          <div className="h-32 bg-muted rounded flex items-center justify-center overflow-hidden">
            <img src={mepImg} alt="MEP rough-ins" className="w-full h-full object-contain" />
          </div>
          <Label className="text-base font-semibold">MEP Rough-ins</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mep_start" className="text-sm text-muted-foreground">Start date</Label>
              <Input
                id="mep_start"
                type="date"
                value={projectData.mep_start_date || ""}
                onChange={(e) => updateField("mep_start_date", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mep_end" className="text-sm text-muted-foreground">Est. finish date</Label>
              <Input
                id="mep_end"
                type="date"
                value={projectData.mep_end_date || ""}
                onChange={(e) => updateField("mep_end_date", e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="bg-muted/30 p-6 rounded-lg space-y-4">
          <div className="h-32 bg-muted rounded flex items-center justify-center overflow-hidden">
            <img src={elevatorsImg} alt="Building elevators" className="w-full h-full object-contain" />
          </div>
          <Label className="text-base font-semibold">Elevators</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="elevators_start" className="text-sm text-muted-foreground">Start date</Label>
              <Input
                id="elevators_start"
                type="date"
                value={projectData.elevators_start_date || ""}
                onChange={(e) => updateField("elevators_start_date", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="elevators_end" className="text-sm text-muted-foreground">Est. finish date</Label>
              <Input
                id="elevators_end"
                type="date"
                value={projectData.elevators_end_date || ""}
                onChange={(e) => updateField("elevators_end_date", e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="bg-muted/30 p-6 rounded-lg space-y-4">
          <div className="h-32 bg-muted rounded flex items-center justify-center overflow-hidden">
            <img src={fireImg} alt="Fire suppression system" className="w-full h-full object-contain" />
          </div>
          <Label className="text-base font-semibold">Fire Suppression</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fire_start" className="text-sm text-muted-foreground">Start date</Label>
              <Input
                id="fire_start"
                type="date"
                value={projectData.fire_start_date || ""}
                onChange={(e) => updateField("fire_start_date", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fire_end" className="text-sm text-muted-foreground">Est. finish date</Label>
              <Input
                id="fire_end"
                type="date"
                value={projectData.fire_end_date || ""}
                onChange={(e) => updateField("fire_end_date", e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="bg-muted/30 p-6 rounded-lg space-y-4">
          <div className="h-32 bg-muted rounded flex items-center justify-center overflow-hidden">
            <img src={interiorImg} alt="Interior finishes" className="w-full h-full object-contain" />
          </div>
          <Label className="text-base font-semibold">Interior Finishes</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="interior_start" className="text-sm text-muted-foreground">Start date</Label>
              <Input
                id="interior_start"
                type="date"
                value={projectData.interior_start_date || ""}
                onChange={(e) => updateField("interior_start_date", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="interior_end" className="text-sm text-muted-foreground">Est. finish date</Label>
              <Input
                id="interior_end"
                type="date"
                value={projectData.interior_end_date || ""}
                onChange={(e) => updateField("interior_end_date", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
