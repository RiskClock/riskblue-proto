import { useEffect, useRef, useState } from "react";
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

  // If acceptance got auto-set from prior history, treat both as reviewed.
  useEffect(() => {
    if (accepted) {
      setReviewedTos(true);
      setReviewedPrivacy(true);
    }
  }, [accepted]);

  // Drive parent acceptance from the two per-document checkboxes.
  const bothReviewed = reviewedTos && reviewedPrivacy;
  useEffect(() => {
    if (bothReviewed && !accepted) {
      onAcceptedChange(true);
    } else if (!bothReviewed && accepted) {
      onAcceptedChange(false);
    }
  }, [bothReviewed, accepted, onAcceptedChange]);

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
    <div className="flex flex-col gap-6">
      <PolicyFrame
        url={tos.url}
        label="Terms of Service"
        reviewed={reviewedTos}
        onReviewedChange={setReviewedTos}
      />
      <PolicyFrame
        url={privacy.url}
        label="Privacy Policy"
        reviewed={reviewedPrivacy}
        onReviewedChange={setReviewedPrivacy}
      />
    </div>
  );
}

