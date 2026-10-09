import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/contexts/TenantContext";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, ArrowUpRight, Loader2, MapPin, ShieldCheck, ImagePlus, Upload, FileText, X } from "lucide-react";
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
  const { tenantPath } = useTenant();
  const [drawings, setDrawings] = useState<File[]>([]);
  const [projectImage, setProjectImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
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

  const tol = TOLERANCES[tolerance];
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
        <header className={cn("relative isolate mb-16 overflow-hidden border-b border-border", imageUrl && "min-h-[440px]")}>
          {imageUrl && <img src={imageUrl} alt="Project backdrop" className="absolute inset-0 -z-10 h-full w-full object-cover" />}
          <div className="mx-auto max-w-5xl px-6 py-16 sm:px-8 sm:py-20">
          <div className={cn("max-w-2xl", imageUrl && "project-intro-image-copy rounded-md p-6 sm:p-10")}>
          <p className="mb-6 text-base font-medium uppercase tracking-[0.15em] text-muted-foreground">New Project</p>
          <h1 className="font-serif text-5xl font-medium leading-[1.1] sm:text-6xl">
            Begin with intent.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Tell us about the project. We will shape a water mitigation strategy around it and introduce the
            specialists best placed to deliver it.
          </p>
          </div>
          </div>
        </header>

        <div className="mx-auto max-w-5xl space-y-20 px-6 sm:px-8">
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
              setUploadError(invalid.length ? `Unsupported drawing: ${invalid.map((file) => file.name).join(", ")}` : null);
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
          </Section>

          <Section index="03" title="Project image">
            <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload project image" className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && ["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
                setUploadError(null);
                setProjectImage(file);
              } else if (file) setUploadError("Please select a JPG, PNG or WebP project image.");
              e.target.value = "";
            }} />
            <div className="flex flex-wrap items-center gap-4">
              {imageUrl && <img src={imageUrl} alt="Selected project image" className="h-20 w-28 rounded-md object-cover" />}
              <Button variant="outline" className="h-12 text-base" onClick={() => imageInput.current?.click()}><ImagePlus /> {projectImage ? "Change image" : "Add project image"}</Button>
              {projectImage && <Button variant="ghost" size="icon" aria-label="Remove project image" title="Remove project image" onClick={() => setProjectImage(null)}><X /></Button>}
            </div>
            {projectImage && <p className="mt-3 break-words text-base text-muted-foreground">{projectImage.name}</p>}
          </Section>
          {uploadError && <p role="alert" className="text-base text-destructive">{uploadError}</p>}

          <Section index="04" title="Water mitigation budget">
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

          <Section index="05" title="Risk tolerance">
            <div className="pt-4">
               <Slider aria-label="Risk tolerance" value={[tolerance]} min={0} max={2} step={1} onValueChange={(v) => setTolerance(v[0])} />
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
        </div>
      </main>
    </div>
  );
}

function Section({ index, title, children }: { index: string; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
      <div className="pt-5">
        <p className="text-base text-muted-foreground">{index}</p>
        <p className="mt-2 text-base font-medium text-foreground">{title}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}
