import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/contexts/TenantContext";
import { IntakeSlider } from "@/components/wizard/IntakeSlider";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { COVERAGE_FIELDS, COVERAGE_MAX, clampCoverage, snapCoverage, snapTolerance, developerProjectDetails, type CoverageKey } from "@/lib/developerIntake";
import { saveDeveloperProject } from "@/lib/saveDeveloperProject";
import { ArrowLeft, ArrowUpRight, Loader2, MapPin, ShieldCheck, ImagePlus, Upload, FileText, X, Save } from "lucide-react";
import { cn } from "@/lib/utils";

type Suggestion = { placeId: string; text: string };
type Place = { formattedAddress: string; lat?: number; lng?: number; city?: string | null; region?: string | null };

const TOLERANCES = [
  {
    key: "low",
    label: "Low",
    title: "Comprehensive protection",
    body: "For high-value interiors, occupied buildings and critical systems. Typically covers every riser, plant room, kitchen and washroom with automatic shut-off and continuous leak detection.",
  },
  {
    key: "medium",
    label: "Medium",
    title: "Balanced protection",
    body: "The common choice for most developments. Typically protects mechanical rooms, risers and wet areas with detection and alerts, plus shut-off on the main supply.",
  },
  {
    key: "high",
    label: "High",
    title: "Essential protection",
    body: "For budget-led or early-phase projects. Typically covers the incoming supply and highest-risk plant spaces with point detection and a site-wide alert.",
  },
];

const MOCK_WMSVS = [
  { name: "Aquilon Water Defence", street: "18 Harbour Row", km: 2.4, rating: "4.9", years: 14, specialty: "High-rise residential and hospitality", url: "https://example.com/aquilon", initials: "AQ" },
  { name: "Meridian Leak Systems", street: "402 Foundry Lane, Suite 7", km: 5.8, rating: "4.8", years: 21, specialty: "Commercial office and mixed-use", url: "https://example.com/meridian", initials: "ME" },
  { name: "Halcyon Mitigation Group", street: "77 Kingsway Court", km: 9.1, rating: "4.7", years: 9, specialty: "Healthcare, labs and critical facilities", url: "https://example.com/halcyon", initials: "HM" },
];

function formatCurrency(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits).toLocaleString("en-US") : "";
}

export default function DeveloperNewProject() {
  const navigate = useNavigate();
  const { tenantPath, tenantId } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveIds = useRef({ projectId: crypto.randomUUID(), requestId: crypto.randomUUID() });
  const saveLock = useRef(false);
  const [scope, setScope] = useState<Record<CoverageKey, number>>({ general_liability: 0, workers_compensation: 0, pollution_environmental_liability: 0, excess_umbrella_liability: 0 });
  const handleSave = async () => {
    if (!user || !name.trim() || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await saveDeveloperProject(supabase, {
        ...saveIds.current, userId: user.id, tenantId, name, address: query,
        city: place?.city, region: place?.region,
        details: developerProjectDetails(budget, tolerance, scope), image: projectImage, drawings,
      });
      toast({ title: "Project saved", description: "Your project and attachments have been saved. No credits were charged." });
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
  const [name, setName] = useState("");
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
  const locality = useMemo(
    () => [place?.city, place?.region].filter(Boolean).join(", "),
    [place],
  );

  return (
    <div className="min-h-screen bg-background">
      <AppHeader leftContent={
        <Button variant="ghost" onClick={() => navigate(tenantPath("/projects"))} className="text-base">
          <ArrowLeft /> <span className="hidden sm:inline">Projects</span>
        </Button>
      } />
      <main className="pb-32">
        <header className="relative isolate mb-16 overflow-hidden">
          {imageUrl && <img src={imageUrl} alt="Project backdrop" className="absolute inset-0 -z-10 h-full w-full object-cover" />}
          <div className="relative mx-auto max-w-5xl px-6 py-24 sm:px-8 sm:py-20">
            <div className="absolute right-6 top-4 z-20 flex items-center gap-2 sm:right-8">
              <Button variant="outline" disabled={saving} onClick={() => imageInput.current?.click()} className="text-base"><ImagePlus />{imageUrl ? "Change project image" : "Add project image"}</Button>
              <Button variant="outline" size="icon" aria-label="Remove project image" title="Remove project image" disabled={saving || !projectImage} className={cn(!projectImage && "invisible")} onClick={() => setProjectImage(null)}><X /></Button>
            </div>
          <div className={cn("relative max-w-2xl", imageUrl && "project-intro-image-copy")}>
            {imageUrl && <div aria-hidden className="project-intro-image-backdrop absolute -inset-x-8 -inset-y-10" />}
            <div className="relative">
              <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload project image" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && ["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
                  setImageError(null);
                  setProjectImage(file);
                } else if (file) setImageError("Please select a JPG, PNG or WebP project image.");
                e.target.value = "";
              }} />
              <p className="mb-6 text-base font-medium uppercase tracking-[0.15em] text-muted-foreground">New Project</p>
              <h1 className="font-serif text-5xl font-medium leading-[1.1] sm:text-6xl">
                Begin with intent.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                Tell us about the project. We will shape a water mitigation strategy around it and introduce the
                specialists best placed to deliver it.
              </p>
              {imageError && <p role="alert" className="mt-4 break-words text-base text-destructive">{imageError}</p>}
            </div>
          </div>
          </div>
        </header>

        <fieldset disabled={saving} className="mx-auto min-w-0 max-w-5xl space-y-20 px-6 sm:px-8">
          <Section index="01" title="Project name">
            <Input
              value={name}
              aria-label="Project name"
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Aldwych Residences"
              className="h-auto rounded-none border-0 border-b border-border bg-transparent px-0 py-4 font-serif text-2xl md:text-3xl shadow-none focus-visible:border-foreground focus-visible:ring-0"
            />
          </Section>

          <Section index="02" title="Drawings">
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
          </Section>

          <Section index="03" title="Water mitigation budget">
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

          <Section index="04" title="Risk tolerance">
            <div className="pt-4">
               <IntakeSlider label="Risk tolerance" value={tolerance} max={2} ticks={3} onChange={setTolerance} onCommit={(value) => setTolerance(snapTolerance(value))} />
              <div className="mt-6 grid grid-cols-3 text-base">
                {TOLERANCES.map((t, i) => (
                  <Button variant="ghost"
                    key={t.key}
                    onClick={() => setTolerance(i)}
                    className={cn(
                      "transition-colors",
                      i === 0 ? "text-left" : i === 1 ? "text-center" : "text-right",
                      i === tolerance ? "text-foreground" : "text-muted-foreground hover:text-foreground",
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

          <Section index="05" title="Minimum Protection Scope">
            <div className="space-y-10">
              {COVERAGE_FIELDS.map(({ key, label }) => <div key={key}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                  <label htmlFor={key} className="text-base font-medium">{label}</label>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">$</span>
                    <Input id={key} aria-label={label} inputMode="numeric" value={scope[key].toLocaleString("en-US")} className="w-40 text-right text-base md:text-base tabular-nums" onChange={(e) => setScope((current) => ({ ...current, [key]: clampCoverage(Number(e.target.value.replace(/[^\d]/g, ""))) }))} />
                  </div>
                </div>
                <IntakeSlider label={`${label} coverage`} value={scope[key]} max={COVERAGE_MAX} ticks={101} onChange={(value) => setScope((current) => ({ ...current, [key]: value }))} onCommit={(value) => setScope((current) => ({ ...current, [key]: snapCoverage(value) }))} />
                <div className="mt-1 flex justify-between text-base tabular-nums text-muted-foreground"><span>$0</span><span>$10 million</span></div>
              </div>)}
            </div>
          </Section>

          <Section index="06" title="Project address">
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
                        className="h-auto w-full justify-start whitespace-normal px-6 py-4 text-left text-base text-popover-foreground hover:bg-muted"
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

          {place && !resolving && (
            <section className="animate-fade-in">
              <div className="mb-14 flex items-end justify-between gap-8 border-t border-border pt-16">
                <div>
                  <p className="mb-4 text-base uppercase tracking-[0.1em] text-muted-foreground">Curated for this site</p>
                  <h2 className="font-serif text-4xl font-medium text-foreground">Your recommended specialists</h2>
                </div>
                <p className="hidden max-w-xs text-right text-sm font-light text-muted-foreground md:block">
                  Matched on proximity, project type and a {tol.label.toLowerCase()} risk tolerance.
                </p>
              </div>
              <div className="grid gap-px overflow-hidden border border-border bg-border md:grid-cols-3">
                {MOCK_WMSVS.map((w, i) => (
                  <article key={w.name} className="flex flex-col bg-card p-10">
                    <div className="mb-10 flex items-center justify-between">
                      <div className="flex h-14 w-14 items-center justify-center border border-foreground/80 font-serif text-xl tracking-wider text-foreground">
                        {w.initials}
                      </div>
                      <span className="text-sm uppercase tracking-[0.1em] text-muted-foreground">
                        {i === 0 ? "Best match" : `0${i + 1}`}
                      </span>
                    </div>
                    <h3 className="font-serif text-2xl leading-tight text-card-foreground">{w.name}</h3>
                    <p className="mt-3 text-base text-muted-foreground">{w.specialty}</p>
                    <div className="mt-10 space-y-3 text-base text-muted-foreground">
                      <p className="text-card-foreground">
                        {w.street}
                        {locality ? `, ${locality}` : ""}
                      </p>
                      <p className="tabular-nums">{w.km.toFixed(1)} km from site</p>
                      <p className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4" /> {w.rating} rating, {w.years} years certified
                      </p>
                    </div>
                    <a
                      href={w.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-auto inline-flex items-center gap-2 pt-12 text-base text-foreground underline-offset-8 hover:underline"
                    >
                      Visit website <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  </article>
                ))}
              </div>
              <p className="mt-6 text-base text-muted-foreground">Preview only. Specialist details are illustrative.</p>
            </section>
          )}
          <div className="flex flex-col items-end gap-4">
            {saveError && <p role="alert" className="w-full text-base text-destructive">{saveError}</p>}
            <Button size="lg" className="h-14 px-8 text-base" disabled={saving || !user || !name.trim()} onClick={handleSave}>{saving ? <Loader2 className="animate-spin" /> : <Save />}{saving ? "Saving project…" : "Save project"}</Button>
          </div>
        </fieldset>
      </main>
    </div>
  );
}

function Section({ index, title, children }: { index: string; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
      <div className="pt-5">
        <p className="font-serif text-xl text-foreground/75">{index}</p>
        <p className="mt-2 text-base font-medium text-foreground">{title}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}
