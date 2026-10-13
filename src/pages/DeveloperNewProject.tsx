import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/contexts/TenantContext";
import { IntakeSlider } from "@/components/wizard/IntakeSlider";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { snapTolerance, developerProjectDetails } from "@/lib/developerIntake";
import { saveDeveloperProject } from "@/lib/saveDeveloperProject";
import { ArrowLeft, ArrowUpRight, Loader2, MapPin, ShieldCheck, ImagePlus, Upload, FileText, X, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { BidComparison } from "@/components/developer/BidComparison";
import { MOCK_VENDORS, DEFAULT_VENDOR_IDS, DEVELOPER_STATUS_LABEL, bidsReceived } from "@/lib/developerVendors";
import { Search } from "lucide-react";

type Suggestion = { placeId: string; text: string };
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
  const [loaded, setLoaded] = useState<{ status: string; projectData: Record<string, any>; imagePath: string | null; drawingNames: string[] } | null>(null);
  const [phases, setPhases] = useState<string[]>([]);
  const [vendorIds, setVendorIds] = useState<string[]>(DEFAULT_VENDOR_IDS);
  const [addedVendorIds, setAddedVendorIds] = useState<string[]>([]);
  const [vendorQuery, setVendorQuery] = useState("");
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
    if (!user || !name.trim() || !phases.length || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await saveDeveloperProject(supabase, {
        ...saveIds.current, userId: user.id, tenantId, name, address: query,
        city: place?.city, region: place?.region,
        details: { ...(loaded?.projectData || {}), ...developerProjectDetails(budget, tolerance), selected_vendor_ids: vendorIds },
        image: projectImage, drawings: drawingMode === "upload" ? drawings : [],
        protectionPhase: phases, isUpdate: isEdit, existingImagePath: projectImage ? null : loaded?.imagePath ?? null,
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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionToken = useRef<string>(crypto.randomUUID());
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [readyBackdropUrl, setReadyBackdropUrl] = useState<string | null>(null);
  const bidsSection = useRef<HTMLElement>(null);

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
      setPhases(((p as any).protection_phase as string[]) || []);
      const ids: string[] = Array.isArray(pd.selected_vendor_ids) ? pd.selected_vendor_ids : DEFAULT_VENDOR_IDS;
      setVendorIds(ids);
      setAddedVendorIds(ids.filter((id) => !DEFAULT_VENDOR_IDS.includes(id)));
      const { data: reqs } = await supabase.from("analysis_requests").select("id").eq("project_id", editId);
      const reqIds = (reqs || []).map((r) => r.id);
      const { data: files } = reqIds.length
        ? await supabase.from("analysis_request_files").select("name").in("analysis_request_id", reqIds) : { data: [] as { name: string }[] };
      setLoaded({ status: (p as any).workbench_status || "processing", projectData: pd, imagePath: pd.project_image_path || null, drawingNames: (files || []).map((f) => f.name) });
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
  const reqId = useRef(0);

  useEffect(() => {
    if (place && query === place.formattedAddress) return;
    if (query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setSearching(true);
      const { data, error } = await supabase.functions.invoke("places-address", {
        body: { action: "autocomplete", input: query, sessionToken: sessionToken.current },
      });
      if (id !== reqId.current) return;
      setSearching(false);
      if (error) {
        setError("Address suggestions are unavailable right now.");
        return;
      }
      setError(null);
      setSuggestions(data?.suggestions || []);
      setOpen(true);
    }, 300);
    return () => clearTimeout(t);
  }, [query, place]);

  const choose = async (s: Suggestion) => {
    setOpen(false);
    setQuery(s.text);
    setResolving(true);
    const { data, error } = await supabase.functions.invoke("places-address", {
      body: { action: "details", placeId: s.placeId, sessionToken: sessionToken.current },
    });
    sessionToken.current = crypto.randomUUID();
    setResolving(false);
    if (error || !data?.formattedAddress) {
      setPlace({ formattedAddress: s.text });
    } else {
      setPlace(data);
      setQuery(data.formattedAddress);
    }
  };

  const tol = TOLERANCES[snapTolerance(tolerance)];
  const backdropUrl = imageUrl || existingImageUrl;
  const receivedCount = isEdit ? bidsReceived(editId || "", vendorIds) : 0;
  const budgetValue = Number(budget.replace(/[^\d]/g, "")) || 0;
  const shownVendors = MOCK_VENDORS.filter((v) => isEdit ? vendorIds.includes(v.id) : (v.recommended || addedVendorIds.includes(v.id)));
  const vendorMatches = vendorQuery.trim()
    ? MOCK_VENDORS.filter((v) => !shownVendors.some((s) => s.id === v.id) && v.name.toLowerCase().includes(vendorQuery.trim().toLowerCase()))
    : [];
  const toggleVendor = (id: string) => setVendorIds((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id]);
  const addVendor = (id: string) => { setAddedVendorIds((c) => [...c, id]); setVendorIds((c) => c.includes(id) ? c : [...c, id]); setVendorQuery(""); };
  const locality = useMemo(
    () => [place?.city, place?.region].filter(Boolean).join(", "),
    [place],
  );

  return (
    <div className="developer-intake min-h-screen bg-background">
      <AppHeader leftContent={
        <Button variant="ghost" onClick={() => navigate(tenantPath("/projects"))} className="text-base">
          <ArrowLeft /> <span className="hidden sm:inline">Projects</span>
        </Button>
      } />
      <main className="pb-32">
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
                {isEdit && receivedCount > 0 ? <Button variant="link" className="h-auto p-0 text-base text-inherit" onClick={() => bidsSection.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })}>{receivedCount} {receivedCount === 1 ? "bid" : "bids"} available</Button> : isEdit ? (loaded ? DEVELOPER_STATUS_LABEL[loaded.status] || "Processing" : "Loading project") : "New Project"}
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
              className="h-auto rounded-none border-0 border-b border-border bg-transparent px-0 py-4 font-serif text-2xl md:text-3xl shadow-none focus-visible:border-foreground focus-visible:ring-0"
            />
          </Section>

          <Section index="02" title="Water mitigation budget">
            <div className="flex items-baseline gap-3 border-b border-border focus-within:border-foreground">
              <span className="font-serif text-3xl text-muted-foreground">$</span>
              <Input
                inputMode="numeric"
                aria-label="Water mitigation budget"
                value={budget}
                onChange={(e) => setBudget(formatCurrency(e.target.value))}
                placeholder="250,000"
                className="h-auto rounded-none border-0 bg-transparent px-0 py-4 font-serif text-2xl md:text-3xl tabular-nums shadow-none focus-visible:ring-0"
              />
            </div>
          </Section>

          <Section index="03" title="Protection level">
            <div className="pt-4">
               <IntakeSlider label="Protection level" value={tolerance} max={2} ticks={3} onChange={setTolerance} onCommit={(value) => setTolerance(snapTolerance(value))} />
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

          <Section index="04" title="Protection phase">
            <div className="flex flex-wrap gap-x-8 gap-y-4 md:pt-[3.25rem]">
              {["Construction", "Operational"].map((ph) => (
                <label key={ph} className="flex cursor-pointer items-center gap-3 text-base">
                  <Checkbox checked={phases.includes(ph)} onCheckedChange={(v) => setPhases((c) => v ? [...c, ph] : c.filter((x) => x !== ph))} aria-label={ph} />{ph}
                </label>
              ))}
            </div>
            {!phases.length && <p className="mt-3 text-base text-muted-foreground">Select at least one phase.</p>}
          </Section>

          <Section index="05" title={isEdit ? "Drawings" : "Drawings (optional)"}>
            <RadioGroup aria-label="Drawing availability" value={drawingMode} onValueChange={setDrawingMode} disabled={saving} className="mb-6 flex flex-wrap gap-x-6 gap-y-4 md:pt-[3.25rem]">
              {[["upload", "Upload now"], ["later", "Provide later"], ["request", "Request from other"]].map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-center gap-2 text-base">
                  <RadioGroupItem value={value} id={`drawings-${value}`} />{label}
                </label>
              ))}
            </RadioGroup>
            {drawingMode === "request" && <div className="space-y-5 border-l border-border pl-6">
              <p className="text-base leading-relaxed text-muted-foreground">We'll send them a secure link to upload the files. They will not see your budget or protection level.</p>
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

          <Section index="06" title="Project address (optional)">
            <div className="relative">
              <div className="flex items-center gap-4 border-b border-border focus-within:border-foreground">
                <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
                <Input
                  value={query}
                  aria-label="Project address"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPlace(null);
                  }}
                  onFocus={() => suggestions.length && setOpen(true)}
                  onBlur={() => setTimeout(() => setOpen(false), 150)}
                  placeholder="Start typing an address"
                  className="h-auto rounded-none border-0 bg-transparent px-0 py-4 text-xl md:text-xl shadow-none focus-visible:ring-0"
                />
                {(searching || resolving) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
              {open && suggestions.length > 0 && (
                <ul className="absolute z-20 mt-2 w-full overflow-hidden border border-border bg-popover shadow-2xl">
                  {suggestions.map((s) => (
                    <li key={s.placeId}>
                       <Button variant="ghost"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(s)}
                        className="h-auto w-full justify-start whitespace-normal px-6 py-4 text-left text-base text-popover-foreground hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground"
                      >
                        {s.text}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            </div>
          </Section>

          {((place && !resolving) || isEdit) && (
            <section ref={bidsSection} id="project-bids" className={cn("scroll-mt-8 px-6 sm:px-8", !isEdit && "mx-auto max-w-5xl animate-fade-in")}>
              <div className="mb-14 flex items-end justify-between gap-8 border-t border-border pt-16">
                <div>
                  <p className="mb-4 text-base uppercase tracking-[0.1em] text-muted-foreground">{isEdit ? "Bids" : "Curated for this site"}</p>
                  <h2 className="font-serif text-4xl font-medium text-foreground">{isEdit ? "Your water mitigation vendors" : "Your recommended specialists"}</h2>
                </div>
                {!isEdit && <p className="hidden max-w-xs text-right text-sm font-light text-muted-foreground md:block">
                  Matched on proximity, project type and a {tol.label.toLowerCase()} protection level. Untick any you do not want to invite.
                </p>}
              </div>
              {shownVendors.length === 0 ? <p className="text-base text-muted-foreground">No vendors selected yet. Search below to add one.</p> :
              isEdit ? <BidComparison vendors={shownVendors} projectId={editId || saveIds.current.projectId} budget={budgetValue} onRemove={toggleVendor} /> :
              <div className="grid gap-px overflow-hidden border border-border bg-border md:grid-cols-3">
                {shownVendors.map((w, i) => {
                  const selected = vendorIds.includes(w.id);
                  
                  return (
                  <article key={w.id} className={cn("flex min-w-0 flex-col bg-card p-6 transition-opacity lg:p-8", !selected && "opacity-50")}>
                    <div className="mb-10 grid h-24 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                      {w.logo ? <img src={w.logo} alt={`${w.name} logo`} className="h-24 w-full max-w-32 object-contain object-left" />
                        : <span className="flex h-20 w-20 items-center justify-center border border-border font-serif text-3xl text-foreground">{w.name[0]}</span>}
                      {isEdit
                        ? <Button variant="ghost" size="icon" aria-label={`Remove ${w.name}`} title={`Remove ${w.name}`} onClick={() => toggleVendor(w.id)}><X /></Button>
                        : <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm uppercase tracking-[0.1em] text-muted-foreground">
                            {w.recommended ? (i === 0 ? "Best match" : `0${i + 1}`) : "Added"}
                            <Checkbox checked={selected} onCheckedChange={() => toggleVendor(w.id)} aria-label={`Select ${w.name}`} />
                          </label>}
                    </div>
                    <h3 className="font-serif text-2xl leading-tight text-card-foreground">{w.name}</h3>
                    <>
                    <p className="mt-3 text-base text-muted-foreground">{w.specialty}</p>
                    <div className="mt-8 space-y-2 border-t border-border pt-6 text-base text-muted-foreground">
                      <p>{w.street}{locality ? `, ${locality}` : ""}</p>
                      <p className="tabular-nums">{w.km.toFixed(1)} km from site</p>
                      <p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> {w.rating} rating, {w.years} years certified</p>
                    </div>
                    <a href={w.url} target="_blank" rel="noreferrer" className="mt-auto inline-flex items-center gap-2 pt-12 text-base text-foreground underline-offset-8 hover:underline">
                      Visit website <ArrowUpRight className="h-3.5 w-3.5" />
                    </a></>
                  </article>);
                })}
              </div>}
              <div className="relative mt-10">
                <p className="mb-3 text-base font-medium text-foreground">Add another vendor</p>
                <div className="flex items-center gap-4 border-b border-border focus-within:border-foreground">
                  <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <Input value={vendorQuery} onChange={(e) => setVendorQuery(e.target.value)} aria-label="Search vendors" placeholder="Search vendors by name"
                    className="h-auto rounded-none border-0 bg-transparent px-0 py-4 text-xl md:text-xl shadow-none focus-visible:ring-0" />
                </div>
                {vendorQuery.trim() && (
                  <ul className="absolute z-20 mt-2 w-full overflow-hidden border border-border bg-popover shadow-2xl">
                    {vendorMatches.length === 0 ? <li className="px-6 py-4 text-base text-muted-foreground">No matching vendors</li> :
                      vendorMatches.map((v) => <li key={v.id}>
                        <Button variant="ghost" onClick={() => addVendor(v.id)} className="h-auto w-full justify-between whitespace-normal px-6 py-4 text-left text-base text-popover-foreground hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground">
                          <span>{v.name}</span><span className="text-sm opacity-70">{v.specialty}</span>
                        </Button>
                      </li>)}
                  </ul>
                )}
              </div>
            </section>
          )}
          <div className="mx-auto flex max-w-5xl flex-col items-end gap-4 px-6 sm:px-8">
            {saveError && <p role="alert" className="w-full text-base text-destructive">{saveError}</p>}
            <Button size="lg" className="h-14 px-8 text-base" disabled={saving || !user || !name.trim() || !phases.length || (isEdit && !loaded)} onClick={handleSave}>{saving ? <Loader2 className="animate-spin" /> : <Save />}{saving ? (isEdit ? "Saving changes" : "Creating project") : (isEdit ? "Save changes" : "Create project")}</Button>
          </div>
        </fieldset>
      </main>
    </div>
  );
}

function Section({ index, title, children }: { index: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto grid max-w-5xl gap-6 px-6 sm:px-8 md:grid-cols-[200px_minmax(0,1fr)]">
      <div className="pt-5">
        <p className="font-serif text-xl text-foreground/75">{index}</p>
        <p className="mt-2 text-base font-medium text-foreground">{title}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}
