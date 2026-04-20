import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCredits } from "@/hooks/useCredits";

export default function CheckoutReturn() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const navigate = useNavigate();
  const { balance, refetch } = useCredits();

  // Poll briefly so the new balance lands before the user sees this page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 8; i++) {
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 1000));
        await refetch();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refetch]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-4">
        {sessionId ? (
          <>
            <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Check className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold">Payment received</h1>
            <p className="text-sm text-muted-foreground">
              Your credits are being added to your account.
            </p>
            <p className="text-base">
              Current balance:{" "}
              <span className="font-semibold tabular-nums">{balance} credits</span>{" "}
              <Loader2 className="inline h-3 w-3 animate-spin text-muted-foreground" />
            </p>
            <Button onClick={() => navigate("/projects")}>Back to projects</Button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">No payment session found</h1>
            <Button onClick={() => navigate("/projects")}>Back to projects</Button>
          </>
        )}
      </div>
    </div>
  );
}
