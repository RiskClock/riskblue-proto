import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const ExternalAuthCallback = () => {
  const navigate = useNavigate();
  const ran = useRef(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const tokenHash = hash.get("token_hash");
    const pending = new URLSearchParams(window.location.search).get("confirm_procore");
    window.history.replaceState(null, "", window.location.pathname);
    if (pending) {
      // Cloud Auth processes the emailed magic-link session before authorization below.
      const waitForUser = async () => {
        for (let attempt = 0; attempt < 20; attempt++) {
          const { data } = await supabase.auth.getUser();
          if (data.user) { setConfirmation(pending); return; }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        setError("Email sign-in link expired. Start Procore sign-in again.");
      };
      void waitForUser();
      return;
    }
    if (!tokenHash) {
      navigate("/auth", { replace: true });
      return;
    }
    supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" }).then(({ error }) => {
      if (error) {
        navigate(`/auth?external_error=${encodeURIComponent("Sign-in link expired. Please try again.")}`, { replace: true });
      } else {
        navigate("/projects", { replace: true });
      }
    });
  }, [navigate]);

  const confirm = async () => {
    if (!confirmation || busy) return;
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Please open the email confirmation link again.");
      const response = await fetch(`https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/external-auth?action=confirm-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ token: confirmation }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not link Procore");
      navigate("/projects", { replace: true });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not link Procore"); }
    finally { setBusy(false); }
  };

  if (confirmation || error) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md space-y-5">
        <h1 className="text-2xl font-semibold">Link Procore</h1>
        <p className="text-muted-foreground">Confirm only if you just signed into Procore and want to use it to access this RiskBlue account.</p>
        {error && <p className="text-destructive" role="alert">{error}</p>}
        <div className="flex gap-3">
          {confirmation && !error && <Button onClick={confirm} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm linking Procore</Button>}
          <Button variant="outline" onClick={() => navigate("/projects", { replace: true })}>Cancel</Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      Signing you in
    </div>
  );
};

export default ExternalAuthCallback;
