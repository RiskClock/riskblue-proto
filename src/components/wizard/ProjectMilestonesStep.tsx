import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";

interface ProjectMilestonesStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
}

export const ProjectMilestonesStep = ({ data, onNext, onBack }: ProjectMilestonesStepProps) => {
  const [formData, setFormData] = useState({
    construction_start_date: data.construction_start_date || "",
    construction_end_date: data.construction_end_date || "",
    frame_start_date: data.frame_start_date || "",
    frame_end_date: data.frame_end_date || "",
    enclosure_start_date: data.enclosure_start_date || "",
    enclosure_end_date: data.enclosure_end_date || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext(formData);
  };

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground mb-1">Step 2 of 7</p>
        <h2 className="text-2xl font-bold text-foreground mb-2">Project Milestones</h2>
        <p className="text-sm text-muted-foreground">
          Filling out Project Milestones based on a Level 3 Schedule is essential for accurately assessing
          the duration of risk exposure for critical assets and water systems throughout the construction
          timeline. Clearly defined milestones help teams stay ahead of potential delays and unattended
          risks that could disrupt progress, increase costs, or compromise safety.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div>
          <Label className="text-base mb-4 block">What is the construction timeline?</Label>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="start_date" className="text-sm text-muted-foreground">Start date</Label>
              <Input
                id="start_date"
                type="date"
                value={formData.construction_start_date}
                onChange={(e) => setFormData({ ...formData, construction_start_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date" className="text-sm text-muted-foreground">Est. finish date</Label>
              <Input
                id="end_date"
                type="date"
                value={formData.construction_end_date}
                onChange={(e) => setFormData({ ...formData, construction_end_date: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-muted/30 p-6 rounded-lg space-y-4">
            <div className="h-32 bg-muted rounded flex items-center justify-center text-muted-foreground text-sm">
              Building Frame Icon
            </div>
            <Label className="text-base">What is the estimated start and finish of the building's structural frame?</Label>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="frame_start" className="text-sm text-muted-foreground">Start date</Label>
                <Input
                  id="frame_start"
                  type="date"
                  value={formData.frame_start_date}
                  onChange={(e) => setFormData({ ...formData, frame_start_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="frame_end" className="text-sm text-muted-foreground">Est. finish date</Label>
                <Input
                  id="frame_end"
                  type="date"
                  value={formData.frame_end_date}
                  onChange={(e) => setFormData({ ...formData, frame_end_date: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="bg-muted/30 p-6 rounded-lg space-y-4">
            <div className="h-32 bg-muted rounded flex items-center justify-center text-muted-foreground text-sm">
              Building Enclosure Icon
            </div>
            <Label className="text-base">What is the estimated start and finish of the building's enclosures/envelope (dried-in/weatherproofed)?</Label>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="enclosure_start" className="text-sm text-muted-foreground">Start date</Label>
                <Input
                  id="enclosure_start"
                  type="date"
                  value={formData.enclosure_start_date}
                  onChange={(e) => setFormData({ ...formData, enclosure_start_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="enclosure_end" className="text-sm text-muted-foreground">Est. finish date</Label>
                <Input
                  id="enclosure_end"
                  type="date"
                  value={formData.enclosure_end_date}
                  onChange={(e) => setFormData({ ...formData, enclosure_end_date: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>Back</Button>
          <Button type="submit">Continue</Button>
        </div>
      </form>
    </div>
  );
};
