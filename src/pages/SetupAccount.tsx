import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";
import { Loader2 } from "lucide-react";
import { z } from "zod";

const passwordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type Status =
  | { kind: "loading" }
  | { kind: "ready"; email: string; name: string | null }
  | { kind: "expired" }
  | { kind: "used" }
  | { kind: "invalid" };

const FN_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.functions.supabase.co/verify-setup-token`;

const SetupAccount = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const { toast } = useToast();

  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus({ kind: "invalid" });
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${FN_URL}?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (res.ok && data.valid) {
          setStatus({ kind: "ready", email: data.email, name: data.name });
        } else if (data?.error === "expired") setStatus({ kind: "expired" });
        else if (data?.error === "used") setStatus({ kind: "used" });
        else setStatus({ kind: "invalid" });
      } catch {
        setStatus({ kind: "invalid" });
      }
    })();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status.kind !== "ready" || !token) return;

    const validation = passwordSchema.safeParse({ password, confirmPassword });
    if (!validation.success) {
      toast({
        title: "Check your password",
        description: validation.error.errors[0].message,
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data?.error === "expired") {
          setStatus({ kind: "expired" });
          return;
        }
        if (data?.error === "used") {
          setStatus({ kind: "used" });
          return;
        }
        throw new Error(data?.error || "Failed to set password");
      }

      // Auto-login using the same password the user just typed.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: data.email,
        password,
      });

      if (signInErr) {
        toast({
          title: "Account ready",
          description: "Please sign in with your new password.",
        });
        navigate("/auth");
        return;
      }

      toast({
        title: "Welcome to RiskBlue",
        description: "Your account is ready.",
      });
      navigate("/projects");
    } catch (err: any) {
      toast({
        title: "Error",
        description: getUserFriendlyError(err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <img src={riskBlueLogo} alt="RiskBlue" className="h-12 mx-auto mb-8" />
        </div>

        {status.kind === "loading" && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p>Verifying your setup link…</p>
          </div>
        )}

        {status.kind === "expired" && (
          <div className="space-y-4 text-center">
            <h1 className="text-2xl font-bold">Setup link expired</h1>
            <p className="text-muted-foreground">
              This account setup link has expired. Please contact your
              administrator to request a new one.
            </p>
            <Button asChild variant="outline">
              <a href="mailto:support@riskclock.com?subject=Request%20new%20setup%20link">
                Request a new link
              </a>
            </Button>
          </div>
        )}

        {status.kind === "used" && (
          <div className="space-y-4 text-center">
            <h1 className="text-2xl font-bold">Account already set up</h1>
            <p className="text-muted-foreground">
              This setup link has already been used. Please sign in.
            </p>
            <Button onClick={() => navigate("/auth")}>Sign in</Button>
          </div>
        )}

        {status.kind === "invalid" && (
          <div className="space-y-4 text-center">
            <h1 className="text-2xl font-bold">Invalid setup link</h1>
            <p className="text-muted-foreground">
              This link doesn't appear to be valid. If you've already set up
              your account, please sign in.
            </p>
            <Button onClick={() => navigate("/auth")}>Sign in</Button>
          </div>
        )}

        {status.kind === "ready" && (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-bold text-foreground">
                Set up your RiskBlue account
              </h1>
              <p className="text-muted-foreground">
                {status.name ? `Hi ${status.name}, ` : "Hi, "}
                create a password for{" "}
                <span className="font-medium text-foreground">
                  {status.email}
                </span>
                .
              </p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Setting up…" : "Set Up Account"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default SetupAccount;
