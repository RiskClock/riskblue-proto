import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const ExternalAuthCallback = () => {
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const tokenHash = hash.get("token_hash");
    window.history.replaceState(null, "", window.location.pathname);
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

  return (
    <div className="min-h-screen flex items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      Signing you in
    </div>
  );
};

export default ExternalAuthCallback;
