import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, ArrowUpRight, Loader2, MapPin, ShieldCheck } from "lucide-react";
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
      <AppHeader />
      <main className="mx-auto max-w-5xl px-8 pb-40 pt-16">
        <button
          onClick={() => navigate(-1)}
          className="mb-16 inline-flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Projects
        </button>

        <header className="mb-24">
          <p className="mb-6 text-xs uppercase tracking-[0.35em] text-muted-foreground">New development</p>
          <h1 className="font-serif text-6xl font-medium leading-[1.05] text-foreground md:text-7xl">
            Begin with intent.
          </h1>
          <p className="mt-8 max-w-xl text-lg font-light leading-relaxed text-muted-foreground">
            Tell us about the development. We will shape a water mitigation strategy around it and introduce the
            specialists best placed to deliver it.
          </p>
        </header>

        <div className="space-y-28">
          <Section index="01" title="Project name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Aldwych Residences"
              className="h-auto rounded-none border-0 border-b border-border bg-transparent px-0 py-4 font-serif text-3xl shadow-none focus-visible:border-foreground focus-visible:ring-0"
            />
          </Section>

          <Section index="02" title="Water mitigation budget">
            <div className="flex items-baseline gap-3 border-b border-border focus-within:border-foreground">
              <span className="font-serif text-3xl text-muted-foreground">$</span>
              <Input
                inputMode="numeric"
                value={budget}
                onChange={(e) => setBudget(formatCurrency(e.target.value))}
                placeholder="250,000"
                className="h-auto rounded-none border-0 bg-transparent px-0 py-4 font-serif text-3xl tabular-nums shadow-none focus-visible:ring-0"
              />
            </div>
          </Section>

          <Section index="03" title="Risk tolerance">
            <div className="pt-4">
              <Slider value={[tolerance]} min={0} max={2} step={1} onValueChange={(v) => setTolerance(v[0])} />
              <div className="mt-6 grid grid-cols-3 text-xs uppercase tracking-[0.25em]">
                {TOLERANCES.map((t, i) => (
                  <button
                    key={t.key}
                    onClick={() => setTolerance(i)}
                    className={cn(
                      "transition-colors",
                      i === 0 ? "text-left" : i === 1 ? "text-center" : "text-right",
                      i === tolerance ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div key={tol.key} className="mt-12 animate-fade-in border-l border-foreground/30 pl-8">
                <p className="font-serif text-3xl text-foreground">{tol.title}</p>
                <p className="mt-4 max-w-2xl font-light leading-relaxed text-muted-foreground">{tol.body}</p>
              </div>
            </div>
          </Section>

          <Section index="04" title="Project address">
            <div className="relative">
              <div className="flex items-center gap-4 border-b border-border focus-within:border-foreground">
                <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPlace(null);
                  }}
                  onFocus={() => suggestions.length && setOpen(true)}
                  onBlur={() => setTimeout(() => setOpen(false), 150)}
                  placeholder="Start typing an address"
                  className="h-auto rounded-none border-0 bg-transparent px-0 py-4 text-xl font-light shadow-none focus-visible:ring-0"
                />
                {(searching || resolving) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
              {open && suggestions.length > 0 && (
                <ul className="absolute z-20 mt-2 w-full overflow-hidden border border-border bg-popover shadow-2xl">
                  {suggestions.map((s) => (
                    <li key={s.placeId}>
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(s)}
                        className="w-full px-6 py-4 text-left font-light text-popover-foreground transition-colors hover:bg-muted"
                      >
                        {s.text}
                      </button>
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
                  <p className="mb-4 text-xs uppercase tracking-[0.35em] text-muted-foreground">Curated for this site</p>
                  <h2 className="font-serif text-5xl font-medium text-foreground">Your recommended specialists</h2>
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
                      <span className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                        {i === 0 ? "Best match" : `0${i + 1}`}
                      </span>
                    </div>
                    <h3 className="font-serif text-2xl leading-tight text-card-foreground">{w.name}</h3>
                    <p className="mt-3 text-sm font-light text-muted-foreground">{w.specialty}</p>
                    <div className="mt-10 space-y-3 text-sm font-light text-muted-foreground">
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
                      className="mt-auto inline-flex items-center gap-2 pt-12 text-xs uppercase tracking-[0.25em] text-foreground underline-offset-8 hover:underline"
                    >
                      Visit website <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  </article>
                ))}
              </div>
              <p className="mt-6 text-xs text-muted-foreground">Preview only. Specialist details are illustrative.</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function Section({ index, title, children }: { index: string; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-8 md:grid-cols-[180px_1fr]">
      <div className="pt-5">
        <p className="font-serif text-sm text-muted-foreground">{index}</p>
        <p className="mt-2 text-xs uppercase tracking-[0.3em] text-foreground">{title}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}
