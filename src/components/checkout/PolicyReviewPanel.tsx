import { useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface PolicyDoc {
  url: string;
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

function PolicyFrame({
  url,
  reviewed,
  onReviewedChange,
  label,
}: {
  url: string;
  reviewed: boolean;
  onReviewedChange: (next: boolean) => void;
  label: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Reset loaded state when URL changes
  useEffect(() => {
    setLoaded(false);
  }, [url]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-[420px] overflow-hidden rounded-md border bg-muted/20">
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={url}
          title={label}
          onLoad={() => setLoaded(true)}
          className="h-full w-full"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Open in new tab
          <ExternalLink className="h-3 w-3" />
        </a>
        <label
          className={`inline-flex items-center gap-2 text-xs ${
            loaded ? "cursor-pointer" : "cursor-not-allowed opacity-60"
          }`}
        >
          <Checkbox
            checked={reviewed}
            disabled={!loaded}
            onCheckedChange={(v) => onReviewedChange(v === true)}
          />
          <span>I have read the {label}</span>
        </label>
      </div>
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
  const [reviewedTos, setReviewedTos] = useState(false);
  const [reviewedPrivacy, setReviewedPrivacy] = useState(false);
  const [tab, setTab] = useState<"tos" | "privacy">("tos");

  const bothReviewed = reviewedTos && reviewedPrivacy;

  // If acceptance got auto-set from prior history, treat both as reviewed.
  useEffect(() => {
    if (accepted) {
      setReviewedTos(true);
      setReviewedPrivacy(true);
    }
  }, [accepted]);

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
            {reviewedTos && <span className="text-xs text-green-600">✓</span>}
          </TabsTrigger>
          <TabsTrigger value="privacy" className="gap-2">
            Privacy Policy
            {reviewedPrivacy && <span className="text-xs text-green-600">✓</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tos" className="mt-3">
          <PolicyFrame
            url={tos.url}
            label="Terms of Service"
            reviewed={reviewedTos}
            onReviewedChange={setReviewedTos}
          />
        </TabsContent>
        <TabsContent value="privacy" className="mt-3">
          <PolicyFrame
            url={privacy.url}
            label="Privacy Policy"
            reviewed={reviewedPrivacy}
            onReviewedChange={setReviewedPrivacy}
          />
        </TabsContent>
      </Tabs>

      <label
        className={`flex items-start gap-3 rounded-md border p-3 ${
          bothReviewed ? "cursor-pointer hover:bg-muted/40" : "cursor-not-allowed opacity-70"
        }`}
      >
        <Checkbox
          checked={accepted}
          disabled={!bothReviewed}
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
          {!bothReviewed && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Confirm you've read each document above to enable this checkbox.
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
