import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, Download, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type State =
  | { kind: "loading" }
  | { kind: "ready"; url: string; filename: string }
  | { kind: "error"; message: string };


export default function ThreatReportDownload() {
  const { projectId, exportId } = useParams<{ projectId: string; exportId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const redirect = encodeURIComponent(
        `/projects/${projectId}/export/${exportId}`,
      );
      navigate(`/auth?redirect=${redirect}`, { replace: true });
      return;
    }
    if (!projectId || !exportId) {
      setState({ kind: "error", message: "Invalid report link." });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("download-threat-report", {
          body: { exportId },
        });
        if (cancelled) return;
        if (error) {
          // Try to surface server-side error message if present.
          const detail = (error as any)?.context?.body
            ? JSON.stringify((error as any).context.body)
            : error.message;
          setState({ kind: "error", message: detail || "Could not load report." });
          return;
        }
        const url = (data as any)?.url;
        const filename = (data as any)?.filename || "threat-report.docx";
        if (!url) {
          setState({ kind: "error", message: "Report URL missing from response." });
          return;
        }
        setState({ kind: "ready", url, filename });
        // Auto-trigger download once.
        if (!downloaded) {
          setDownloaded(true);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }

      } catch (e: any) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e?.message || "Unexpected error loading the report.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, projectId, exportId]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="max-w-md w-full bg-background border rounded-lg shadow-sm p-6 text-center space-y-4">
        <h1 className="text-xl font-semibold">Threat Report</h1>
        {state.kind === "loading" && (
          <>
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Preparing your download…</p>
          </>
        )}
        {state.kind === "ready" && (
          <>
            <p className="text-sm text-muted-foreground">
              {downloaded
                ? "Your download should have started."
                : "Click below to download."}
            </p>
            <div className="flex flex-col gap-2">
              <Button asChild>
                <a href={state.url} download="threat-report.docx">
                  <Download className="h-4 w-4 mr-2" />
                  Download again
                </a>
              </Button>
              <Button variant="outline" onClick={() => navigate(`/internal/workbench/project/${projectId}`)}>
                Open project
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Download links expire 5 minutes after they're issued.
            </p>
          </>
        )}
        {state.kind === "error" && (
          <>
            <AlertCircle className="h-6 w-6 mx-auto text-destructive" />
            <p className="text-sm text-destructive">{state.message}</p>
            <Button variant="outline" onClick={() => navigate(`/internal/workbench/project/${projectId}`)}>
              Open project
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
