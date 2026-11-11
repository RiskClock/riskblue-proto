import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { saveDeveloperProject } from "@/lib/saveDeveloperProject";
import { DRAWING_STATUSES, MITIGATION_SCOPES, PROTECTION_TIMINGS, hasDrawings, intakeComplete, protectionPhaseFor, submitLabel } from "@/lib/standardIntake";
import { ScopePicker, EMPTY_SCOPE, scopeCount, scopeColumns, useIntakeControls, type ScopeValue } from "@/components/intake/ScopePicker";
import { CloudDrawingPicker } from "@/components/cloud/CloudDrawingPicker";
import { CloudProviderButton, CloudProviderLogo } from "@/components/cloud/CloudProviderButton";
import { CLOUD_PROVIDER_LABEL, mergeSelection, queueCloudImports, removeCloudFile, type CloudProvider, type CloudSelection } from "@/lib/cloudImport";
import { ArrowLeft, Loader2, ImagePlus, Upload, FileText, X, ScanSearch, Save } from "lucide-react";
import { cn } from "@/lib/utils";

const DRAWING_RE = /\.(pdf|png|jpe?g|dwg|dxf)$/i;

export default function StandardNewProject() {
  const navigate = useNavigate();
  const { tenantPath, tenantId } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: controls = [] } = useIntakeControls();
  const ids = useRef({ projectId: crypto.randomUUID(), requestId: crypto.randomUUID() });
  const lock = useRef(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [drawingStatus, setDrawingStatus] = useState("");
  const [scope, setScope] = useState("");
  const [custom, setCustom] = useState<ScopeValue>(EMPTY_SCOPE);
  const [timing, setTiming] = useState("");
  const [vendorChoice, setVendorChoice] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [drawings, setDrawings] = useState<File[]>([]);
  const [cloudPicks, setCloudPicks] = useState<CloudSelection[]>([]);
  const [pickerProvider, setPickerProvider] = useState<CloudProvider | null>(null);
  const [drawingError, setDrawingError] = useState<string | null>(null);
  const [projectImage, setProjectImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const drawingInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const drawingsOn = hasDrawings(drawingStatus);

  useEffect(() => {
    if (!projectImage) { setImageUrl(null); return; }
    const url = URL.createObjectURL(projectImage);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [projectImage]);

  const complete = intakeComplete({ name, drawingStatus, scope, timing, vendorChoice, vendorName, customScopeCount: scopeCount(custom) });

  const handleSave = async () => {
    if (!user || !complete || lock.current) return;
    lock.current = true; setSaving(true); setSaveError(null);
    const files = drawingsOn ? drawings : [];
    const picks = drawingsOn ? cloudPicks : [];
    const scopeCols = scope === "custom" ? scopeColumns(custom, controls) : null;
    try {
      await saveDeveloperProject(supabase, {
        ...ids.current, userId: user.id, tenantId, name, address,
        details: {
          intake_type: "standard",
          drawing_status: drawingStatus,
          mitigation_scope: scope,
          protection_timing: timing,
          preferred_vendor: vendorChoice === "yes" ? vendorName.trim() : vendorChoice === "no" ? null : undefined,
          has_preferred_vendor: vendorChoice ? vendorChoice === "yes" : null,
          ...(scopeCols ? { intake_identify_selections: scopeCols.intake_identify_selections } : {}),
        },
        extraColumns: scopeCols ? { selected_awp_class_names: scopeCols.selected_awp_class_names, selected_other_classes: scopeCols.selected_other_classes, selected_awp_subtypes: scopeCols.selected_awp_subtypes } : undefined,
        image: projectImage, drawings: files, protectionPhase: protectionPhaseFor(timing),
        workbenchStatus: picks.length ? "importing_drawings" : files.length ? "processing" : "waiting_drawings",
      });
      if (picks.length) await queueCloudImports(ids.current.projectId, user.id, picks);
      toast({ title: drawingsOn ? "Project submitted for analysis" : "Project created", description: drawingsOn ? "RiskBlue will review your drawings and start the analysis. No credits were charged." : "Add drawings whenever they are ready. No credits were charged." });
      navigate(tenantPath("/projects"));
    } catch (error) {
      setSaveError(`Saving did not finish. Please retry. ${(error as any)?.message || ""}`);
    } finally { lock.current = false; setSaving(false); }
  };

  const radio = (items: readonly { key: string; label: string; body?: string }[], value: string, onChange: (v: string) => void, label: string) => (
    <RadioGroup aria-label={label} value={value} onValueChange={onChange} className="gap-5">
      {items.map((i) => (
        <label key={i.key} className="flex cursor-pointer items-start gap-3 text-base">
          <RadioGroupItem value={i.key} aria-label={i.label} className="mt-1 shrink-0" />
          <span><span className="font-medium">{i.label}</span>{i.body && <span className="mt-1 block leading-relaxed text-muted-foreground">{i.body}</span>}</span>
        </label>
      ))}
    </RadioGroup>
  );

  return (
    <div className="developer-intake min-h-screen bg-background">
      <AppHeader leftContent={<Button variant="ghost" onClick={() => navigate(tenantPath("/projects"))} className="hidden text-base sm:inline-flex"><ArrowLeft /> Projects</Button>} />
      <main className="pb-32">
        <header className="relative isolate mb-16 overflow-hidden">
          {imageUrl && <img src={imageUrl} alt="Project backdrop" className="absolute inset-0 -z-10 h-full w-full scale-[1.02] object-cover blur-[2px]" />}
          <div className="relative mx-auto max-w-5xl px-6 py-24 sm:px-8 sm:py-20">
            <div className="absolute right-6 top-4 z-20 flex items-center gap-2 sm:right-8">
              <Button variant="outline" disabled={saving} onClick={() => imageInput.current?.click()} className="text-base"><ImagePlus />{imageUrl ? "Change project image" : "Add project image"}</Button>
              {projectImage && <Button variant="outline" size="icon" aria-label="Remove project image" onClick={() => setProjectImage(null)}><X /></Button>}
            </div>
            <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload project image" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && ["image/png", "image/jpeg", "image/webp"].includes(f.type)) setProjectImage(f); e.target.value = ""; }} />
            <div className={cn("relative max-w-2xl", imageUrl && "project-intro-image-copy")}>
              {imageUrl && <div aria-hidden className="project-intro-image-backdrop absolute -inset-x-8 -inset-y-10" />}
              <div className="relative">
                <p className="mb-6 text-base font-medium uppercase tracking-[0.15em] text-muted-foreground">New Project</p>
                <h1 className="font-serif text-5xl font-medium leading-[1.1] sm:text-6xl">Begin with intent.</h1>
                <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">Tell us about the project and your drawings. RiskBlue will shape the water mitigation scope around what you need.</p>
              </div>
            </div>
          </div>
        </header>

        <fieldset disabled={saving} className="min-w-0 space-y-20">
          <Section title="Project name">
            <Input value={name} aria-label="Project name" onChange={(e) => setName(e.target.value)} placeholder="e.g. The Aldwych Residences"
              className="h-auto rounded-none border-0 border-b border-border bg-transparent px-0 pb-4 pt-0 font-serif text-2xl shadow-none focus-visible:border-foreground focus-visible:ring-0 md:text-3xl" />
          </Section>
          <Section title="Project address (optional)">
            <Input value={address} aria-label="Project address" onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, region"
              className="h-auto rounded-none border-0 border-b border-border bg-transparent px-0 pb-3 pt-0 text-lg shadow-none focus-visible:border-foreground focus-visible:ring-0" />
          </Section>
          <Section title="What is the status of your project mechanical drawings?">
            {radio(DRAWING_STATUSES, drawingStatus, setDrawingStatus, "Drawing status")}
          </Section>
          <Section title="What water mitigation scope would you like RiskBlue to develop?">
            {radio(MITIGATION_SCOPES, scope, setScope, "Water mitigation scope")}
            {scope === "custom" && <div className="mt-6"><ScopePicker value={custom} onChange={setCustom} /></div>}
          </Section>
          <Section title="Drawings & Documents">
            <div className={cn(!drawingsOn && "pointer-events-none opacity-50")} aria-disabled={!drawingsOn}>
              {!drawingsOn && <p className="mb-4 text-base text-muted-foreground">Available once you tell us you have drawings.</p>}
              <p className="mb-6 text-base leading-relaxed text-muted-foreground">🔒 Confidential &amp; Secure: Your drawings are never shared. RiskBlue securely processes these files to extract a list of risk areas.</p>
              <input ref={drawingInput} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf" aria-label="Upload drawings" className="hidden" onChange={(e) => {
                const sel = Array.from(e.target.files ?? []);
                const bad = sel.filter((f) => !DRAWING_RE.test(f.name));
                setDrawingError(bad.length ? `Unsupported drawing: ${bad.map((f) => f.name).join(", ")}` : null);
                setDrawings((cur) => [...cur, ...sel.filter((f) => DRAWING_RE.test(f.name) && !cur.some((c) => c.name === f.name && c.size === f.size))]);
                e.target.value = "";
              }} />
              <Button variant="outline" disabled={!drawingsOn} className="h-14 w-full justify-start border-dashed px-5 text-base" onClick={() => drawingInput.current?.click()}><Upload /> Upload from computer</Button>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <CloudProviderButton provider="forma" label="Import from Forma" disabled={!drawingsOn} className="h-14 justify-start px-5 text-base" onClick={() => setPickerProvider("forma")} />
                <CloudProviderButton provider="procore" label="Import from Procore" disabled={!drawingsOn} className="h-14 justify-start px-5 text-base" onClick={() => setPickerProvider("procore")} />
              </div>
              {pickerProvider && <CloudDrawingPicker provider={pickerProvider} open onOpenChange={(o) => !o && setPickerProvider(null)} onConfirm={(sel) => setCloudPicks((cur) => mergeSelection(cur, sel))} />}
              {(cloudPicks.length > 0 || drawings.length > 0) && <ul className="mt-4 divide-y divide-border">
                {cloudPicks.flatMap((sel) => sel.files.map((f) => <li key={`${sel.provider}-${f.id}`} className="flex items-center gap-3 py-3">
                  <CloudProviderLogo provider={sel.provider} className="h-5 w-5" />
                  <div className="min-w-0 flex-1"><p className="break-words text-base">{f.name}</p><p className="text-sm text-muted-foreground">{CLOUD_PROVIDER_LABEL[sel.provider]}{sel.projectName ? `, ${sel.projectName}` : ""}</p></div>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${f.name}`} onClick={() => setCloudPicks((cur) => removeCloudFile(cur, sel.provider, f.id))}><X /></Button>
                </li>))}
                {drawings.map((f, i) => <li key={`${f.name}-${i}`} className="flex items-center gap-3 py-3">
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1"><p className="break-words text-base">{f.name}</p><p className="text-sm text-muted-foreground">{(f.size / 1024 / 1024).toFixed(2)} MB</p></div>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${f.name}`} onClick={() => setDrawings((cur) => cur.filter((_, j) => j !== i))}><X /></Button>
                </li>)}
              </ul>}
              {drawingError && <p role="alert" className="mt-3 text-base text-destructive">{drawingError}</p>}
            </div>
          </Section>
          <Section title="When must water mitigation protection be active?">
            {radio(PROTECTION_TIMINGS, timing, setTiming, "Protection timing")}
          </Section>
          <Section title="Do you already work with a preferred vendor in your region? (optional)">
            <RadioGroup aria-label="Preferred vendor" value={vendorChoice} onValueChange={setVendorChoice} className="gap-5">
              <label className="flex cursor-pointer items-center gap-3 text-base"><RadioGroupItem value="yes" aria-label="Yes" /><span className="font-medium">Yes</span></label>
              {vendorChoice === "yes" && <Input autoFocus value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Vendor name (required)" aria-label="Vendor name" className="ml-7 max-w-md text-base md:text-base" />}
              <label className="flex cursor-pointer items-center gap-3 text-base"><RadioGroupItem value="no" aria-label="No" /><span className="font-medium">No</span></label>
            </RadioGroup>
          </Section>
          <div className="mx-auto max-w-5xl px-6 sm:px-8">
            <div className="flex flex-col items-center gap-4 border-t border-border pt-8">
              {saveError && <p role="alert" className="w-full text-base text-destructive">{saveError}</p>}
              <Button size="lg" className="h-14 px-8 font-serif text-xl" disabled={saving || !user || !complete} onClick={handleSave}>
                {saving ? <Loader2 className="animate-spin" /> : drawingsOn ? <ScanSearch /> : <Save />}{saving ? "Saving project" : submitLabel(drawingStatus)}
              </Button>
            </div>
          </div>
        </fieldset>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto grid max-w-5xl gap-6 px-6 sm:px-8 md:grid-cols-[240px_minmax(0,1fr)]">
      <p className="text-base font-medium text-foreground">{title}</p>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
