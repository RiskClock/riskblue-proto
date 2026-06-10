import { useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, AlertCircle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface PolicyDoc {
  url: string;
  html: string;
  version: string;
}

interface PolicyReviewPanelProps {
  tos: PolicyDoc | null;
  privacy: PolicyDoc | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  accepted: boolean;
  onAcceptedChange: (next: boolean) => void;
}

function ScrollablePolicy({
  html,
  url,
  onReachedBottom,
  reached,
}: {
  html: string;
  url: string;
  onReachedBottom: () => void;
  reached: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // If content is short enough to not need scrolling, mark as read immediately.
    if (el.scrollHeight - el.clientHeight <= 8) {
      onReachedBottom();
    }
  }, [html, onReachedBottom]);

  const handleScroll = () => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) {
      onReachedBottom();
    }
  };

  const scrollToBottom = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={handleScroll}
        className="h-[420px] overflow-y-auto rounded-md border bg-muted/20 p-4 text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_img]:max-w-full"
      >
        <div dangerouslySetInnerHTML={{ __html: html }} />
        <div className="mt-4 pt-3 border-t text-xs text-muted-foreground">
          Source:{" "}
          <a href={url} target="_blank" rel="noopener noreferrer">
            {url}
          </a>
        </div>
      </div>
      {!reached && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          <ChevronDown className="h-3 w-3" /> Scroll to bottom
        </button>
      )}
    </div>
  );
}

export function PolicyReviewPanel({
  tos,
  privacy,
  loading,
  error,
  onRetry,
  accepted,
  onAcceptedChange,
}: PolicyReviewPanelProps) {
  const [scrolledTos, setScrolledTos] = useState(false);
  const [scrolledPrivacy, setScrolledPrivacy] = useState(false);
  const [tab, setTab] = useState<"tos" | "privacy">("tos");

  const bothScrolled = scrolledTos && scrolledPrivacy;

  if (loading) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-md border bg-muted/20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !tos || !privacy) {
    return (
      <div className="flex h-[520px] flex-col items-center justify-center gap-3 rounded-md border bg-destructive/5 p-6 text-center">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <div className="text-sm text-destructive">{error || "Could not load policies."}</div>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "tos" | "privacy")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="tos" className="gap-2">
            Terms of Service
            {scrolledTos && <span className="text-xs text-green-600">✓</span>}
          </TabsTrigger>
          <TabsTrigger value="privacy" className="gap-2">
            Privacy Policy
            {scrolledPrivacy && <span className="text-xs text-green-600">✓</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tos" className="mt-3">
          <ScrollablePolicy
            html={tos.html}
            url={tos.url}
            reached={scrolledTos}
            onReachedBottom={() => setScrolledTos(true)}
          />
        </TabsContent>
        <TabsContent value="privacy" className="mt-3">
          <ScrollablePolicy
            html={privacy.html}
            url={privacy.url}
            reached={scrolledPrivacy}
            onReachedBottom={() => setScrolledPrivacy(true)}
          />
        </TabsContent>
      </Tabs>

      <label
        className={`flex items-start gap-3 rounded-md border p-3 ${
          bothScrolled ? "cursor-pointer hover:bg-muted/40" : "cursor-not-allowed opacity-70"
        }`}
      >
        <Checkbox
          checked={accepted}
          disabled={!bothScrolled}
          onCheckedChange={(v) => onAcceptedChange(v === true)}
          className="mt-0.5"
        />
        <span className="text-sm">
          I have read and agree to the{" "}
          <a
            href={tos.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            href={privacy.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            Privacy Policy
          </a>
          .
          {!bothScrolled && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Scroll to the bottom of both documents to enable this checkbox.
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
