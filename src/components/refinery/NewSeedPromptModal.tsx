import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useAWPOptions } from "@/hooks/useAWPOptions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectDatasetPicker } from "@/components/refinery/ProjectDatasetPicker";

export const REFINERY_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)" },
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
];

export const slugifyPromptKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-{2,}/g, "-");

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export function NewSeedPromptModal({ open, onOpenChange, onCreated }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: awpOptions = [] } = useAWPOptions();

  const [className, setClassName] = useState<string>("");
  const [targetModel, setTargetModel] = useState<string>(REFINERY_MODEL_OPTIONS[0].value);
  const [promptKey, setPromptKey] = useState<string>("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [datasetProjectIds, setDatasetProjectIds] = useState<string[]>([]);

  const suggestedKey = useMemo(() => {
    if (!className) return "";
    return slugifyPromptKey(`${className}-${format(new Date(), "yyyyMMdd-HHmmss")}`);
  }, [className]);

  useEffect(() => {
    setDatasetProjectIds([]);
  }, [className]);

  useEffect(() => {
    if (!keyEdited) setPromptKey(suggestedKey);
  }, [suggestedKey, keyEdited]);

  useEffect(() => {
    if (open) {
      setClassName("");
      setTargetModel(REFINERY_MODEL_OPTIONS[0].value);
      setPromptKey("");
      setKeyEdited(false);
      setDatasetProjectIds([]);
    }
  }, [open]);

  const selectedOption = awpOptions.find((o) => o.name === className);

  const handleCreate = async () => {
    if (!className || !promptKey) return;
    setSaving(true);
    const { data: created, error } = await supabase.from("refinery_prompts" as any).insert({
      prompt_key: promptKey,
      class_name: className,
      class_category: selectedOption?.displayCategory ?? null,
      status: "draft",
      target_model: targetModel,
      created_by: user?.id ?? null,
    } as any).select("id").single();

    if (error || !created) {
      setSaving(false);
      toast({
        title: "Could not create prompt",
        description: (error as any)?.message,
        variant: "destructive",
      });
      return;
    }
    if (datasetProjectIds.length > 0) {
      const names = new Map<string, string>();
      const { data: projRows } = await supabase
        .from("projects")
        .select("id, name")
        .in("id", datasetProjectIds);
      for (const r of (projRows as any[]) ?? []) names.set(r.id, r.name || "Untitled project");

      const { data: dsRows } = await supabase
        .from("refinery_datasets" as any)
        .insert(
          datasetProjectIds.map((pid) => ({
            name: names.get(pid) ?? "Dataset",
            project_id: pid,
            created_by: user?.id ?? null,
          })) as any,
        )
        .select("id");

      if (dsRows) {
        await supabase.from("refinery_prompt_datasets" as any).insert(
          (dsRows as any[]).map((d, i) => ({
            prompt_id: (created as any).id,
            dataset_id: d.id,
            sort_order: i,
          })) as any,
        );
      }
    }

    setSaving(false);
    toast({ title: "Seed prompt created", description: promptKey });
    onOpenChange(false);
    onCreated?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Seed Prompt</DialogTitle>
          <DialogDescription>
            Create a draft prompt for a risk mitigation class.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Class</Label>
            <Select value={className} onValueChange={setClassName}>
              <SelectTrigger>
                <SelectValue placeholder="Select a class" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {awpOptions.map((o) => (
                  <SelectItem key={`${o.category}-${o.id}`} value={o.name}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Datasets</Label>
            <ProjectDatasetPicker
              className={className}
              selected={datasetProjectIds}
              onChange={setDatasetProjectIds}
              emptyLabel={className ? "No projects found." : "Select a class first."}
            />
          </div>

          <div className="space-y-2">
            <Label>Target Model</Label>
            <Select value={targetModel} onValueChange={setTargetModel}>
              <SelectTrigger className="[&>span]:flex-1 [&>span]:text-left [&>span]:truncate [&>span]:block">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {REFINERY_MODEL_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Prompt ID</Label>
            <Input
              value={promptKey}
              placeholder="select-a-class-first"
              onChange={(e) => {
                setKeyEdited(true);
                setPromptKey(slugifyPromptKey(e.target.value));
              }}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Lowercase only; spaces become dashes. Prefilled from class and time, editable.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!className || !promptKey || saving}>
            {saving ? "Creating…" : "Create Prompt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
