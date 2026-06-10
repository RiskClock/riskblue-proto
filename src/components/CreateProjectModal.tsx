import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Upload, FileText, X, Loader2, Coins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useAWPOptions, groupAWPOptionsByCategory } from "@/hooks/useAWPOptions";
import { useCredits } from "@/hooks/useCredits";
import { BuyCreditsModal } from "@/components/BuyCreditsModal";
import { getUserFriendlyError } from "@/lib/errorHandling";

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (projectId: string) => void;
}

const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg,.dwg,.dxf";

export type ProjectSizeTier = "small" | "medium" | "large" | "enterprise";

export const PROJECT_SIZE_TIERS: {
  id: ProjectSizeTier;
  label: string;
  range: string;
  units: number;
  cost: number;
}[] = [
  { id: "small", label: "Small Project", range: "Up to 50 units", units: 50, cost: 25 },
  { id: "medium", label: "Medium Project", range: "51 – 250 units", units: 250, cost: 50 },
  { id: "large", label: "Large Project", range: "251 – 700 units", units: 700, cost: 100 },
  { id: "enterprise", label: "Enterprise", range: "700+ units", units: 701, cost: 0 },
];

export function computeCreditCost(units: number | null): {
  cost: number | null;
  contact: boolean;
} {
  if (units == null || Number.isNaN(units) || units <= 0) return { cost: null, contact: false };
  if (units > 700) return { cost: 0, contact: false };
  if (units <= 50) return { cost: 25, contact: false };
  if (units <= 250) return { cost: 50, contact: false };
  return { cost: 100, contact: false };
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function CreateProjectModal({ open, onOpenChange, onCreated }: CreateProjectModalProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: awpOptions } = useAWPOptions();
  const { balance, refetch: refetchCredits } = useCredits();
  const nameRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [sizeTier, setSizeTier] = useState<ProjectSizeTier | null>(null);
  const [selectedClassNames, setSelectedClassNames] = useState<Set<string>>(new Set());
  const [otherEnabled, setOtherEnabled] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showBuyCredits, setShowBuyCredits] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setSizeTier(null);
      setSelectedClassNames(new Set());
      setOtherEnabled(false);
      setOtherText("");
      setFiles([]);
      setSubmitting(false);
      setTimeout(() => nameRef.current?.focus(), 100);
    }
  }, [open]);

  const eligibleOptions = useMemo(
    () => (awpOptions || []).filter((o) => o.category === "Asset" || o.category === "Water System"),
    [awpOptions],
  );
  const grouped = useMemo(() => groupAWPOptionsByCategory(eligibleOptions), [eligibleOptions]);

  const tierConfig = sizeTier ? PROJECT_SIZE_TIERS.find((t) => t.id === sizeTier)! : null;
  const units = tierConfig ? tierConfig.units : null;
  const { cost, contact } = computeCreditCost(units);

  const otherList = useMemo(
    () =>
      otherEnabled
        ? otherText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    [otherEnabled, otherText],
  );

  const hasAnyClass =
    selectedClassNames.size > 0 || (otherEnabled && otherList.length > 0);

  const canSave =
    !!user &&
    name.trim().length > 0 &&
    units != null &&
    units > 0 &&
    !contact &&
    cost != null &&
    hasAnyClass &&
    !submitting;

  const toggleClass = (n: string) => {
    setSelectedClassNames((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    e.target.value = "";
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!canSave || !user || cost == null) return;

    if (balance < cost) {
      setShowBuyCredits(true);
      return;
    }

    setSubmitting(true);
    const projectName = name.trim();

    try {
      // 1) Consume credits up-front (skip if free, e.g. Enterprise)
      if (cost > 0) {
        const { data: consumeRes, error: consumeErr } = await supabase.rpc("consume_credits", {
          p_user_id: user.id,
          p_amount: cost,
        });
        if (consumeErr) throw consumeErr;
        const ok = (consumeRes as any)?.success;
        if (!ok) {
          const reason = (consumeRes as any)?.reason;
          if (reason === "insufficient_credits") {
            setShowBuyCredits(true);
            return;
          }
          throw new Error(`Couldn't consume credits (${reason || "unknown"})`);
        }
        await refetchCredits();
      }

      // 2) Create the project
      const { data: project, error: pErr } = await supabase
        .from("projects")
        .insert({
          user_id: user.id,
          name: projectName,
          status: "draft",
          estimated_units: units,
          selected_awp_class_names: Array.from(selectedClassNames),
          selected_other_classes: otherList,
        } as any)
        .select("id")
        .single();
      if (pErr) throw pErr;

      // 3) Optionally upload files (background)
      if (files.length > 0) {
        const { data: req, error: rErr } = await supabase
          .from("analysis_requests")
          .insert({
            project_id: project.id,
            user_id: user.id,
            source_type: "manual_upload",
            status: "copying",
            file_count: files.length,
          })
          .select("id")
          .single();
        if (rErr) throw rErr;

        const filesToUpload = files;
        (async () => {
          let copied = 0;
          let totalBytes = 0;
          for (const f of filesToUpload) {
            const path = `${project.id}/${req.id}/${f.name}`;
            const { error: upErr } = await supabase.storage
              .from("uploaded-drawings")
              .upload(path, f, { upsert: true });
            if (upErr) {
              await supabase
                .from("analysis_request_files")
                .insert({
                  analysis_request_id: req.id,
                  drive_file_id: `manual_${Date.now()}_${Math.random().toString(36).slice(2)}_${f.name}`,
                  name: f.name,
                  mime_type: f.type || "application/octet-stream",
                  size_bytes: f.size,
                  relative_path: f.name,
                  storage_path: path,
                  copy_status: "failed",
                });
              continue;
            }
            await supabase.from("analysis_request_files").insert({
              analysis_request_id: req.id,
              drive_file_id: `manual_${Date.now()}_${Math.random().toString(36).slice(2)}_${f.name}`,
              name: f.name,
              mime_type: f.type || "application/octet-stream",
              size_bytes: f.size,
              relative_path: f.name,
              storage_path: path,
              copy_status: "copied",
            });
            copied++;
            totalBytes += f.size;
          }
          await supabase
            .from("analysis_requests")
            .update({
              status: copied > 0 ? "copied" : "failed",
              total_size_bytes: totalBytes,
              file_count: copied,
            })
            .eq("id", req.id);
        })();
      }

      toast({
        title: "Project created",
        description: `"${projectName}" was created and ${cost} credit${cost === 1 ? "" : "s"} consumed.`,
      });
      onOpenChange(false);
      onCreated?.(project.id);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Could not create project",
        description: getUserFriendlyError(error),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Project</DialogTitle>
            <DialogDescription>
              Set up your project, pick the asset & water-system classes to scan,
              and we'll calculate the credit cost.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="cp-name">
                Project Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cp-name"
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter project name"
              />
            </div>

            {/* Project Size */}
            <div className="space-y-2">
              <Label>
                Project Size (Suites or Rooms){" "}
                <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-4 gap-2">
                {PROJECT_SIZE_TIERS.map((tier) => {
                  const selected = sizeTier === tier.id;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => setSizeTier(tier.id)}
                      className={`rounded-md border p-3 text-left transition-all ${
                        selected
                          ? "border-primary bg-primary/5 ring-2 ring-primary"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="text-sm font-semibold">{tier.label}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {tier.range}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Cost summary */}
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Coins className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Cost</span>
              </div>
              {!tierConfig ? (
                <p className="text-sm text-muted-foreground">
                  Select a project size to see the cost.
                </p>
              ) : tierConfig.id === "enterprise" ? (
                <div className="text-sm">
                  <div>
                    <span className="text-2xl font-bold text-primary">0</span>{" "}
                    <span className="text-muted-foreground">credits</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Enterprise projects are free to create — our team will reach out to coordinate scope.
                  </p>
                </div>
              ) : (
                <div className="text-sm">
                  <div>
                    <span className="text-2xl font-bold text-primary">{cost}</span>{" "}
                    <span className="text-muted-foreground">credits</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your balance: {balance} credit{balance === 1 ? "" : "s"}.
                    {balance < (cost ?? 0) && " You don't have enough — you'll be prompted to purchase more."}
                  </p>
                </div>
              )}
            </div>

            {/* Files */}
            <div className="space-y-2">
              <Label>Drawings</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <Upload className="w-4 h-4 mr-1" />
                Upload from Computer
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              {files.length > 0 && (
                <div className="border rounded-md p-2 space-y-1 max-h-40 overflow-y-auto">
                  {files.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-sm px-2 py-1 bg-muted/50 rounded"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{file.name}</span>
                        <span className="text-muted-foreground text-xs shrink-0">
                          {formatBytes(file.size)}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => removeFile(idx)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Classes */}
            <div className="space-y-2">
              <Label>
                Asset & Water System Classes to identify for risks{" "}
                <span className="text-destructive">*</span>
              </Label>
              <div className="border rounded-md p-3 space-y-4 max-h-72 overflow-y-auto">
                {Object.entries(grouped).map(([category, opts]) => (
                  <div key={category}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      {category}
                    </div>
                    <div className="space-y-2">
                      {opts.map((opt) => {
                        const checked = selectedClassNames.has(opt.name);
                        return (
                          <label
                            key={opt.id}
                            className="flex items-center gap-2 text-sm cursor-pointer"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleClass(opt.name)}
                            />
                            <span>
                              {opt.idPrefix && (
                                <span className="font-mono text-xs text-muted-foreground mr-2">
                                  {opt.idPrefix}
                                </span>
                              )}
                              {opt.name}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <Separator />

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={otherEnabled}
                      onCheckedChange={(v) => setOtherEnabled(!!v)}
                    />
                    <span>Other (specify)</span>
                  </label>
                  {otherEnabled && (
                    <Input
                      value={otherText}
                      onChange={(e) => setOtherText(e.target.value)}
                      placeholder="Type anything (comma-separate to add multiple)"
                    />
                  )}
                </div>
              </div>
              {!hasAnyClass && (
                <p className="text-xs text-muted-foreground">
                  Select at least one class.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSave}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {contact ? "Contact required" : "Create Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BuyCreditsModal
        open={showBuyCredits}
        onOpenChange={setShowBuyCredits}
        reason={
          cost != null
            ? `This project costs ${cost} credits. You currently have ${balance}.`
            : undefined
        }
      />
    </>
  );
}
