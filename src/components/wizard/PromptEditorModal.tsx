import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles } from "lucide-react";

interface PromptEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (prompt: string) => void;
  defaultPrompt: string;
}

export const PromptEditorModal = ({
  open,
  onOpenChange,
  onConfirm,
  defaultPrompt,
}: PromptEditorModalProps) => {
  const [prompt, setPrompt] = useState(defaultPrompt);

  const handleConfirm = () => {
    onConfirm(prompt);
    onOpenChange(false);
  };

  const handleReset = () => {
    setPrompt(defaultPrompt);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Analysis Prompt
          </DialogTitle>
          <DialogDescription>
            Review and edit the prompt that will be sent to Gemini for analyzing your drawings.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-hidden">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="h-[400px] resize-none font-mono text-sm"
            placeholder="Enter your analysis prompt..."
          />
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleReset}>
            Reset to Default
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            <Sparkles className="h-4 w-4 mr-2" />
            Analyze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const DEFAULT_ANALYSIS_PROMPT = `I am providing you with building drawings that may include multiple water-related systems.

Assume I have no technical knowledge, so you must extract everything directly from the drawings without asking me any questions.

Your task is to analyze the drawing and create one universal chart covering every water system visible, including (if present):

- Domestic Cold Water (CW)
- Domestic Hot Water (HW)
- Hot Water Return (HWR)
- Rainwater Harvesting / Filtered Water
- Irrigation
- Condensate Drains (CD)
- Stormwater (STM / PSTM)
- Sanitary (SAN)
- Natural Gas (NG) *only if relevant for monitoring*
- Fire Protection (FSP, FDC, DCDA, Fire Pump, Standpipe, Sprinkler Mains)

For each system and each significant line, populate a chart with one row per monitored line using the following fields:

1. Line Monitored — The functional name of the line (e.g., "Main Hot Water Supply," "Fire Protection Incoming Main," "Domestic Cold Water Riser," etc.)
2. Line Code (from the drawing) — Exact text on the drawing (e.g., "Ø100 CW," "150 Ø FIRE PROTECTION SERVICES LINE," "Ø50 HW UP").
3. Pipe Diameter — The diameter shown (e.g., Ø20, Ø50, Ø150).
4. Qty — How many such lines or risers appear on the drawing.
5. Sensor Type — Recommend one: in-line, non-intrusive clamp-on ultrasonic, or "none required."
6. Exact Location & Description — Where the sensor should be installed, described precisely using visible drawing context (e.g., "after DCDA, before pump suction," "on HW header leaving DWH-1/2," "below riser before vertical transition," etc.).
7. Purpose / Goal — A short explanation of what the sensor would detect (e.g., "leaks," "unauthorized flow," "monitor zone usage," "detect burst or abnormal demand").
8. System Type — Identify system group (e.g., "Domestic Hot Water Recirculation System," "Wet Fire Sprinkler System," "Cold Water Distribution," "Storm Drainage—no monitoring applicable").
9. Coordinates — [x start, y start, x end, y end] box within the file where the system was found, *in normalized coordinates.*

Important rules:

- Extract EVERYTHING directly from the drawing text—no assumptions.
- Use the exact line codes and diameter labels as shown on the drawing.
- Use concise wording, suitable to forward to a hardware vendor.
- Include one row per line or per riser if needed.
- If a system does not require monitoring, include it with "Sensor Type = none required."
- The goal is a universal, standardized monitoring table for all water-related lines.
- Output only the completed chart, clean and professional.`;
