import { CheckCircle2, AlertCircle, Loader2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useExportManager, type ActiveExport } from "@/contexts/ExportContext";
import { cn } from "@/lib/utils";

/**
 * Fixed bottom-right global panel that surfaces all in-flight, completed,
 * failed, and cancelled DOCX exports. Mounted once at the app root.
 */
export function ExportProgressPanel() {
  const { exports, cancelExport, dismissExport } = useExportManager();

  if (exports.length === 0) return null;

  const hasActive = exports.some(
    (e) => e.status === "pending" || e.status === "processing",
  );

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] w-[360px] max-w-[calc(100vw-2rem)] space-y-2"
      role="region"
      aria-label="Active exports"
    >
      {hasActive && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-sm">
          Keep this tab open while exports are running. Closing this tab may
          stop the export before the download starts.
        </div>
      )}

      <div className="space-y-2">
        {exports.map((exp) => (
          <ExportRow
            key={exp.id}
            exp={exp}
            onCancel={() => cancelExport(exp.id)}
            onDismiss={() => dismissExport(exp.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface ExportRowProps {
  exp: ActiveExport;
  onCancel: () => void;
  onDismiss: () => void;
}

function ExportRow({ exp, onCancel, onDismiss }: ExportRowProps) {
  const isActive = exp.status === "pending" || exp.status === "processing";
  const isComplete = exp.status === "complete";
  const isFailed = exp.status === "failed";
  const isCancelled = exp.status === "cancelled";

  const titlePrefix = isActive
    ? "Exporting"
    : isComplete
      ? "Exported"
      : isCancelled
        ? "Export cancelled —"
        : "Export failed —";

  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-3 shadow-md",
        isFailed && "border-destructive/40",
        isComplete && "border-emerald-300",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isActive && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
            {isComplete && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
            {isFailed && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
            {isCancelled && <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            <p className="truncate text-sm font-medium text-foreground">
              {titlePrefix} {exp.projectName}
            </p>
          </div>

          {isActive && (
            <>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">{exp.detail || "Working…"}</span>
                <span className="ml-2 shrink-0">{exp.percent}%</span>
              </div>
              <Progress value={exp.percent} className="mt-1 h-1.5" />
              <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-700">
                Tab must stay open
              </p>
            </>
          )}

          {isComplete && (
            <p className="mt-1 text-xs text-muted-foreground">
              Export complete. Download started.
            </p>
          )}

          {isCancelled && (
            <p className="mt-1 text-xs text-muted-foreground">Export cancelled.</p>
          )}

          {isFailed && (
            <p className="mt-1 text-xs text-destructive break-words">
              {exp.error || "Export failed."}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center">
          {isActive ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
