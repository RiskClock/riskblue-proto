import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/contexts/TenantContext";
import { IntakeSlider } from "@/components/wizard/IntakeSlider";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { snapTolerance, developerProjectDetails, EXTRACTION_SCOPES, OWNERSHIP_INTENTS, isOwnershipIntent, restoreDeveloperChoices, developerScopeDetails } from "@/lib/developerIntake";
import { saveDeveloperProject } from "@/lib/saveDeveloperProject";
import { ArrowLeft, Loader2, ImagePlus, Upload, FileText, X, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { DeveloperProjectStepper } from "@/components/developer/DeveloperProjectStepper";
import { DEVELOPER_STATUS_LABEL } from "@/lib/developerVendors";

type Place = { formattedAddress: string; lat?: number; lng?: number; city?: string | null; region?: string | null };

const TOLERANCES = [
  {
    key: "essential",
    label: "Essential",
    title: "Essential protection",
    body: "For budget-led or early-phase projects. Typically covers the incoming supply and highest-risk plant spaces with point detection and a site-wide alert.",
  },
  {
    key: "balanced",
    label: "Balanced",
    title: "Balanced protection",
    body: "The common choice for most developments. Typically protects mechanical rooms, risers and wet areas with detection and alerts, plus shut-off on the main supply.",
  },
  {
    key: "comprehensive",
    label: "Comprehensive",
    title: "Comprehensive protection",
    body: "For high-value interiors, occupied buildings and critical systems. Typically covers every riser, plant room, kitchen and washroom with automatic shut-off and continuous leak detection.",
  },
];

function formatCurrency(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits).toLocaleString("en-US") : "";
}

export default function DeveloperNewProject() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialName = (location.state as { projectName?: string } | null)?.projectName || "";
  const { id: editId } = useParams();
  const isEdit = !!editId;
  const [loaded, setLoaded] = useState<{ status: string; projectData: Record<string, any>; imagePath: string | null; drawingNames: string[]; legacyPhases: string[] } | null>(null);
  const [ownershipIntent, setOwnershipIntent] = useState("");
  const [extractionScope, setExtractionScope] = useState(0);
  const { tenantPath, tenantId } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveIds = useRef({ projectId: editId || crypto.randomUUID(), requestId: crypto.randomUUID() });
  const saveLock = useRef(false);
  const [drawingMode, setDrawingMode] = useState("upload");
  const [requestEmail, setRequestEmail] = useState("");
  const [requestBody, setRequestBody] = useState("Hello,\n\nCould you please upload the project drawings using the secure upload link provided with this request? Architectural and plumbing drawings would be especially helpful.\n\nThank you.");
  const handleSave = async () => {
    if (!user || !name.trim() || !isOwnershipIntent(ownershipIntent) || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await saveDeveloperProject(supabase, {
        ...saveIds.current, userId: user.id, tenantId, name, address: query,
        city: place?.city, region: place?.region,
        details: { ...(loaded?.projectData || {}), ...developerProjectDetails(budget, tolerance), ...developerScopeDetails(extractionScope, ownershipIntent) },
        image: projectImage, drawings: drawingMode === "upload" ? drawings : [],
        protectionPhase: loaded?.legacyPhases ?? [], isUpdate: isEdit, existingImagePath: projectImage ? null : loaded?.imagePath ?? null,
        workbenchStatus: loaded?.status === "processed" ? "processed"
          : (loaded?.drawingNames.length || (drawingMode === "upload" && drawings.length)) ? "processing" : "waiting_drawings",
      });
      if (isEdit) saveIds.current.requestId = crypto.randomUUID();
      toast({ title: isEdit ? "Changes saved" : "Project created", description: "Your project and attachments have been saved. No credits were charged." });
      navigate(tenantPath("/projects"));
    } catch (error) {
      setSaveError(`Saving did not finish. Please retry to complete the same project. ${(error as any)?.message || "Please try again."}`);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };
  const [drawings, setDrawings] = useState<File[]>([]);
  const [projectImage, setProjectImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [drawingError, setDrawingError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const drawingInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!projectImage) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(projectImage);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [projectImage]);
  const [name, setName] = useState(initialName);
  const [budget, setBudget] = useState("");
  const [tolerance, setTolerance] = useState(1);
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState<Place | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [readyBackdropUrl, setReadyBackdropUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      const { data: p, error } = await supabase.from("projects")
        .select("name, address_1, location, city, state, workbench_status, protection_phase, project_data").eq("id", editId).maybeSingle();
      if (error || !p) { setSaveError("This project could not be loaded."); return; }
      const pd = ((p as any).project_data || {}) as Record<string, any>;
      setName(p.name || "");
      setBudget(pd.water_mitigation_budget ? formatCurrency(String(pd.water_mitigation_budget)) : "");
      setTolerance({ high: 0, medium: 1, low: 2 }[pd.riskTolerance as string] ?? 1);
      const addr = (p as any).address_1 || (p as any).location || "";
      setQuery(addr);
      if (addr) setPlace({ formattedAddress: addr, city: (p as any).city, region: (p as any).state });
      const choices = restoreDeveloperChoices(pd);
      setOwnershipIntent(choices.ownershipIntent);
      setExtractionScope(choices.extractionScope);
      const { data: reqs } = await supabase.from("analysis_requests").select("id").eq("project_id", editId);
      const reqIds = (reqs || []).map((r) => r.id);
      const { data: files } = reqIds.length
        ? await supabase.from("analysis_request_files").select("name").in("analysis_request_id", reqIds) : { data: [] as { name: string }[] };
      setLoaded({ status: (p as any).workbench_status || "processing", projectData: pd, imagePath: pd.project_image_path || null, drawingNames: (files || []).map((f) => f.name), legacyPhases: p.protection_phase || [] });
      if (pd.project_image_path) {
        const { data: signed } = await supabase.storage.from(pd.project_image_bucket || "uploaded-drawings").createSignedUrl(pd.project_image_path, 3600);
        if (signed?.signedUrl) {
          const image = new Image();
          image.src = signed.signedUrl;
          await image.decode().catch(() => undefined);
          setReadyBackdropUrl(signed.signedUrl);
        }
        setExistingImageUrl(signed?.signedUrl || null);
      }
    })();
  }, [editId]);
  const tol = TOLERANCES[snapTolerance(tolerance)];
  const backdropUrl = imageUrl || existingImageUrl;

  return (
    <div className="developer-intake min-h-screen bg-background">
      <AppHeader leftContent={
        <Button variant="ghost" onClick={() => navigate(tenantPath("/projects"))} className="hidden text-base sm:inline-flex">
          <ArrowLeft /> <span className="hidden sm:inline">Projects</span>
        </Button>
      } />
      <main className="pb-32">
        <DeveloperProjectStepper isExisting={isEdit} status={loaded?.status} vendorCount={Array.isArray(loaded?.projectData.selected_vendor_ids) ? loaded.projectData.selected_vendor_ids.length : 0} />
        <header aria-busy={isEdit && !loaded} className={cn("relative isolate mb-16 overflow-hidden", (backdropUrl && readyBackdropUrl !== backdropUrl) && "invisible")}>
          {backdropUrl && <img src={backdropUrl} alt="Project backdrop" onLoad={() => setReadyBackdropUrl(backdropUrl)} onError={() => setReadyBackdropUrl(backdropUrl)} className="absolute inset-0 -z-10 h-full w-full object-cover" />}
          <div className="relative mx-auto max-w-5xl px-6 py-24 sm:px-8 sm:py-20">
            <div className="absolute right-6 top-4 z-20 flex items-center gap-2 sm:right-8">
              <Button variant="outline" disabled={saving} onClick={() => imageInput.current?.click()} className="text-base"><ImagePlus />{backdropUrl ? "Change project image" : "Add project image"}</Button>
              <Button variant="outline" size="icon" aria-label="Remove project image" title="Remove project image" disabled={saving || !projectImage} className={cn(!projectImage && "invisible")} onClick={() => setProjectImage(null)}><X /></Button>
            </div>
          <div className={cn("relative max-w-2xl", backdropUrl && "project-intro-image-copy")}>
            {backdropUrl && <div aria-hidden className="project-intro-image-backdrop absolute -inset-x-8 -inset-y-10" />}
            <div className="relative">
              <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload project image" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && ["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
                  setImageError(null);
                  setProjectImage(file);
                } else if (file) setImageError("Please select a JPG, PNG or WebP project image.");
                e.target.value = "";
              }} />
              <p className="mb-6 text-base font-medium uppercase tracking-[0.15em] text-muted-foreground">
                {isEdit ? (loaded ? DEVELOPER_STATUS_LABEL[loaded.status] || "Processing" : "Loading project") : "New Project"}
              </p>
              <h1 className="break-words font-serif text-5xl font-medium leading-[1.1] sm:text-6xl">
                {isEdit ? (name || "Loading project…") : "Begin with intent."}
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                {isEdit ? (loaded ? query || "No address provided" : "") : "Tell us about the project. We will shape a water mitigation strategy around it and introduce the specialists best placed to deliver it."}
              </p>
              {imageError && <p role="alert" className="mt-4 break-words text-base text-destructive">{imageError}</p>}
            </div>
          </div>
          </div>
        </header>

        {isEdit && !loaded && <div className="mx-auto mb-10 flex max-w-5xl items-center gap-3 px-6 text-muted-foreground sm:px-8" role="status"><Loader2 className="h-5 w-5 animate-spin" />{saveError || "Loading project details…"}</div>}
        <fieldset disabled={saving || (isEdit && !loaded)} aria-busy={isEdit && !loaded} className={cn("min-w-0 space-y-20 transition-opacity", isEdit && !loaded && "opacity-60")}>
          <Section index="01" title="Project name">
            <Input
              value={name}
              aria-label="Project name"
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Aldwych Residences"
              className="h-auto rounded-none border-0 border-b border-border bg-transparent px-0 pb-4 pt-0 font-serif text-2xl md:text-3xl shadow-none focus-visible:border-foreground focus-visible:ring-0"
            />
          </Section>

          <Section index="02" title="Target protection level">
            <div>
               <IntakeSlider label="Target protection level" value={tolerance} max={2} ticks={3} onChange={setTolerance} onCommit={(value) => setTolerance(snapTolerance(value))} />
              <div className="mt-6 grid grid-cols-3 text-base">
                {TOLERANCES.map((t, i) => (
                  <Button variant="ghost"
                    key={t.key}
                    onClick={() => setTolerance(i)}
                    className={cn(
                      "transition-colors",
                      i === 0 ? "text-left" : i === 1 ? "text-center" : "text-right",
                      "hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground",
                      i === tolerance ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
              <div key={tol.key} className="mt-12 animate-fade-in border-l border-foreground/30 pl-8">
                <p className="font-serif text-3xl text-foreground">{tol.title}</p>
                <p className="mt-4 max-w-2xl font-light leading-relaxed text-muted-foreground">{tol.body}</p>
              </div>
            </div>
          </Section>

          <Section index="03" title="Risk Extraction Scope">
            <div>
              <IntakeSlider label="Risk Extraction Scope" value={extractionScope} max={2} ticks={3} onChange={setExtractionScope} onCommit={(value) => setExtractionScope(snapTolerance(value))} />
              <div className="mt-6 grid grid-cols-1 gap-2 text-base sm:grid-cols-3">
                {EXTRACTION_SCOPES.map((scope, index) => (
                  <Button key={scope.key} variant="ghost" onClick={() => setExtractionScope(index)} aria-pressed={extractionScope === index}
                    className={cn("h-auto min-h-16 whitespace-normal break-words px-2 py-3 text-base leading-relaxed hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground", extractionScope === index ? "text-foreground" : "text-muted-foreground")}>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{["Engineer's Design", "Design + Upgrades", "Comprehensive"][index]}</span>
                  </Button>
                ))}
              </div>
              <div key={extractionScope} className="mt-12 animate-fade-in border-l border-foreground/30 pl-8">
                <p className="font-serif text-3xl text-foreground">{EXTRACTION_SCOPES[extractionScope].label}</p>
                <p className="mt-4 max-w-2xl font-light leading-relaxed text-muted-foreground">{EXTRACTION_SCOPES[extractionScope].body}</p>
              </div>
            </div>
          </Section>

          <Section index="04" title="System Ownership & Intent">
            <RadioGroup aria-label="System Ownership & Intent" required value={ownershipIntent} onValueChange={setOwnershipIntent} className="gap-6">
              {OWNERSHIP_INTENTS.map((intent) => (
                <label key={intent.key} className="flex cursor-pointer items-start gap-3 text-base">
                  <RadioGroupItem value={intent.key} aria-label={intent.label} className="mt-1 shrink-0" />
                  <span><span className="font-medium">{intent.label}</span><span className="mt-2 block leading-relaxed text-muted-foreground">{intent.body}</span></span>
                </label>
              ))}
            </RadioGroup>
          </Section>

          <Section index="05" title={isEdit ? "Drawings" : "Drawings (optional)"}>
            <p className="mb-6 text-base leading-relaxed text-muted-foreground">🔒 Confidential &amp; Secure: Your drawings are never shared. RiskBlue securely processes these files to extract a list of risk areas. Vendors only see the extracted risks to provide their bids.</p>
            <RadioGroup aria-label="Drawing availability" value={drawingMode} onValueChange={setDrawingMode} disabled={saving} className="mb-6 flex flex-wrap gap-x-6 gap-y-4">
              {[["upload", "Upload now"], ["later", "Provide later"], ["request", "Request from Architect/Engineer"]].map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-center gap-2 text-base">
                  <RadioGroupItem value={value} id={`drawings-${value}`} />{label}
                </label>
              ))}
            </RadioGroup>
            {drawingMode === "request" && <div className="space-y-5 border-l border-border pl-6">
              <p className="text-base leading-relaxed text-muted-foreground">We'll send them a secure link to upload the files. They will not see your target protection level.</p>
              <div className="space-y-2">
                <label htmlFor="drawing-request-email" className="text-base font-medium">Email</label>
                <Input id="drawing-request-email" type="email" value={requestEmail} onChange={(event) => setRequestEmail(event.target.value)} placeholder="name@company.com" className="text-base md:text-base" />
              </div>
              <div className="space-y-2">
                <label htmlFor="drawing-request-body" className="text-base font-medium">Email body</label>
                <Textarea id="drawing-request-body" value={requestBody} onChange={(event) => setRequestBody(event.target.value)} className="min-h-48 text-base leading-relaxed" />
              </div>
            </div>}
            {loaded && loaded.drawingNames.length > 0 && <ul className="mb-4 divide-y divide-border">
              {loaded.drawingNames.map((n, i) => <li key={`${n}-${i}`} className="flex items-center gap-3 py-3"><FileText className="h-5 w-5 shrink-0 text-muted-foreground" /><p className="min-w-0 flex-1 break-words text-base">{n}</p><span className="text-sm text-muted-foreground">Uploaded</span></li>)}
            </ul>}
            {drawingMode === "upload" && <>
            <input ref={drawingInput} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf" aria-label="Upload drawings" className="hidden" onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              const invalid = selected.filter((file) => !/\.(pdf|png|jpe?g|dwg|dxf)$/i.test(file.name));
              setDrawingError(invalid.length ? `Unsupported drawing: ${invalid.map((file) => file.name).join(", ")}` : null);
              setDrawings((current) => [...current, ...selected.filter((file) => /\.(pdf|png|jpe?g|dwg|dxf)$/i.test(file.name) && !current.some((item) => item.name === file.name && item.size === file.size))]);
              e.target.value = "";
            }} />
            <Button variant="outline" className="h-14 w-full justify-start border-dashed px-5 text-base" onClick={() => drawingInput.current?.click()}><Upload /> Upload drawings</Button>
            {drawings.length > 0 && <ul className="mt-4 divide-y divide-border">
              {drawings.map((file, i) => <li key={`${file.name}-${file.size}-${i}`} className="flex items-center gap-3 py-3">
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1"><p className="break-words text-base">{file.name}</p><p className="text-sm text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p></div>
                <Button variant="ghost" size="icon" aria-label={`Remove ${file.name}`} title={`Remove ${file.name}`} onClick={() => setDrawings((current) => current.filter((_, index) => index !== i))}><X /></Button>
              </li>)}
            </ul>}
            {drawingError && <p role="alert" className="mt-3 break-words text-base text-destructive">{drawingError}</p>}
            </>}
          </Section>

          <div className="mx-auto flex max-w-5xl flex-col items-end gap-4 px-6 sm:px-8">
            {saveError && <p role="alert" className="w-full text-base text-destructive">{saveError}</p>}
            <Button size="lg" className="h-14 px-8 text-base" disabled={saving || !user || !name.trim() || !isOwnershipIntent(ownershipIntent) || (isEdit && !loaded)} onClick={handleSave}>{saving ? <Loader2 className="animate-spin" /> : <Save />}{saving ? (isEdit ? "Saving changes" : "Creating project") : (isEdit ? "Save changes" : "Create project")}</Button>
          </div>
        </fieldset>
      </main>
    </div>
  );
}

function Section({ index, title, children }: { index: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto grid max-w-5xl gap-6 px-6 sm:px-8 md:grid-cols-[200px_minmax(0,1fr)]">
      <div>
        <p className="font-serif text-3xl leading-9 text-foreground/75">{index}</p>
        <p className="mt-2 text-base font-medium text-foreground">{title}</p>
      </div>
      <div className="min-w-0 md:pt-11">{children}</div>
    </section>
  );
}
