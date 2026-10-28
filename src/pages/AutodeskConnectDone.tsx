import { useEffect } from "react";

/** Landing page inside the Autodesk connect popup. Closes itself so the original page continues. */
export default function AutodeskConnectDone() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("external_error");
  useEffect(() => {
    if (!error && window.opener) window.setTimeout(() => window.close(), 600);
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <p className="text-center text-sm text-muted-foreground">
        {error ? `Autodesk could not be connected. ${error}` : "Autodesk connected. You can close this window."}
      </p>
    </div>
  );
}
