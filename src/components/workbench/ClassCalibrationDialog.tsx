import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { normalizeFunctionError } from "@/lib/functionsError";
import { cropDrawingAt } from "@/lib/wadeSkills";

type Step = "setup" | "pick" | "running" | "review";

/**
 * Wade "Class Calibration" skill: pick a class, click an example on the open
 * drawing, add an optional note, review the proposed project prompt, approve
 * to save it as this project's override for that class.
 */
export function ClassCalibrationDialog({
  open,
  onClose,
  projectId,
  classes,
  initialClass,
  initialNote,
  onFinished,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  classes: { name: string; label: string }[];
  initialClass?: string | null;
  initialNote?: string | null;
  onFinished?: (summary: string) => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("setup");
  const [cls, setCls] = useState<string>("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [proposal, setProposal] = useState("");
  const [previous, setPrevious] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("setup");
    setCls(initialClass && classes.some((c) => c.name === initialClass) ? initialClass : "");
    setNote(initialNote ?? "");
    setPreview(null);
    setProposal("");
  }, [open, initialClass, initialNote, classes]);

  const label = classes.find((c) => c.name === cls)?.label ?? cls;

  const run = async (image: string, coordinates: { x: number; y: number } | null) => {
    setStep("running");
    try {
      const { data, error } = await supabase.functions.invoke("calibrate-class", {
        body: {
          projectId,
          class_id: cls,
          user_text_description: note,
          coordinates,
          imageBase64: image,
        },
      });
      if (error) throw await normalizeFunctionError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      setProposal(String((data as any).current_prompt ?? ""));
      setPrevious(String((data as any).previous_prompt ?? ""));
      setStep("review");
    } catch (e: any) {
      toast({ title: "Calibration failed", description: e?.message, variant: "destructive" });
      setStep("setup");
    }
  };

  // Capture the next click on the drawing while picking.
  useEffect(() => {
    if (!open || step !== "pick") return;
    let swallowUntil = 0;
    const onDown = (ev: PointerEvent) => {
      const surface = (ev.target as HTMLElement | null)?.closest?.("[data-doc-surface]");
      if (!surface) return;
      const img = surface.querySelector("img.pdf-canvas-element") as HTMLImageElement | null;
      if (!img) return;
      ev.preventDefault();
      ev.stopPropagation();
      swallowUntil = Date.now() + 800;
      const image = cropDrawingAt(img, ev.clientX, ev.clientY);
      if (!image) {
        toast({ title: "Could not read the drawing", description: "Try again once the drawing has loaded.", variant: "destructive" });
        return;
      }
      const rect = img.getBoundingClientRect();
      const coordinates = rect.width && rect.height && img.naturalWidth
        ? {
            x: Math.round((ev.clientX - rect.left) * (img.naturalWidth / rect.width)),
            y: Math.round((ev.clientY - rect.top) * (img.naturalHeight / rect.height)),
          }
        : null;
      setPreview(image);
      void run(image, coordinates);
    };
    const swallow = (ev: Event) => {
      if (Date.now() < swallowUntil) { ev.preventDefault(); ev.stopPropagation(); }
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") setStep("setup"); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", swallow, true);
    document.addEventListener("click", swallow, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      setTimeout(() => {
        document.removeEventListener("pointerup", swallow, true);
        document.removeEventListener("click", swallow, true);
      }, 900);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  const approve = async () => {
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("project_class_prompt_overrides" as any).upsert(
        {
          project_id: projectId,
          awp_class_name: cls,
          prompt_content: proposal,
          calibration_notes: { note: note || null, calibrated_at: new Date().toISOString() },
          updated_by: auth?.user?.id ?? null,
        } as any,
        { onConflict: "project_id,awp_class_name" },
      );
      if (error) throw error;
      toast({ title: "Calibration saved", description: `Risk Radar will use the calibrated ${label} prompt on this project.` });
      onFinished?.(`- Saved a calibrated ${label} prompt for this project.`);
      onClose();
    } catch (e: any) {
      toast({ title: "Save failed", description: (e as any)?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  if (step === "pick" || step === "running") {
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] rounded-lg border bg-card shadow-xl px-4 py-3 flex items-center gap-3 text-sm">
        {step === "pick" ? (
          <>
            <span>Click an example of <strong>{label}</strong> on the drawing.</span>
            <Button size="sm" variant="outline" onClick={() => setStep("setup")}>Cancel</Button>
          </>
        ) : (
          <>
            {preview && <img src={preview} alt="" className="h-10 w-10 rounded border object-cover" />}
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Calibrating {label}...</span>
          </>
        )}
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={step === "review" ? "max-w-4xl max-h-[85vh] flex flex-col" : "max-w-lg"}>
        <DialogHeader>
          <DialogTitle>Class Calibration</DialogTitle>
          <DialogDescription>
            {step === "review"
              ? `Review the proposed ${label} prompt for this project. Approve to save it. The shared class prompt stays unchanged.`
              : "Pick a class, then click an example of it on the open drawing."}
          </DialogDescription>
        </DialogHeader>
        {step === "setup" ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Class</div>
              <Select value={cls} onValueChange={setCls}>
                <SelectTrigger><SelectValue placeholder="Select a class" /></SelectTrigger>
                <SelectContent>
                  {classes.map((c) => <SelectItem key={c.name} value={c.name}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Note (optional)</div>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Elevator pits are shown as a hatched square labeled PIT" rows={3} />
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-[120px_1fr] gap-3">
            <div className="space-y-2">
              {preview && <img src={preview} alt="Example" className="w-full rounded border" />}
              {previous && <p className="text-xs text-muted-foreground">Replaces the current prompt for this class on this project.</p>}
            </div>
            <Textarea value={proposal} onChange={(e) => setProposal(e.target.value)} className="font-mono text-xs min-h-[400px]" />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          {step === "setup" ? (
            <Button onClick={() => setStep("pick")} disabled={!cls}>Pick on drawing</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("pick")} disabled={saving}>Try another example</Button>
              <Button onClick={approve} disabled={saving || !proposal.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve and save"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
