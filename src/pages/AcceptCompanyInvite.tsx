import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { normalizeFunctionError } from "@/lib/functionsError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle, AlertCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";

type Status = "loading" | "needs_login" | "needs_signup" | "success" | "error";

const AcceptCompanyInvite = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, signUp } = useAuth();
  const { toast } = useToast();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<any>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!token) {
        setStatus("error");
        setError("No invitation token provided");
        return;
      }
      try {
        const { data, error: invokeError } = await supabase.functions.invoke("accept-tenant-invite", {
          body: { token },
        });
        if (invokeError) throw await normalizeFunctionError(invokeError);
        if (cancelled) return;

        if (!data?.success) {
          setStatus("error");
          setError(data?.error || "Invitation could not be processed");
          return;
        }

        setInvite(data);

        if (data.status === "needs_signup") {
          setStatus("needs_signup");
        } else if (user) {
          setStatus("success");
          setTimeout(() => navigate(`/t/${data.tenantId}/projects`), 1500);
        } else {
          setStatus("needs_login");
        }
      } catch (e: any) {
        if (cancelled) return;
        setStatus("error");
        setError(e.message || "Failed to process invitation");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [token, user, navigate]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { error: signUpError } = await signUp(invite.email, password, name.trim() || invite.email);
      if (signUpError) throw signUpError;

      const userId = (await supabase.auth.getUser()).data.user?.id;
      const { data, error: completeError } = await supabase.functions.invoke("accept-tenant-invite", {
        body: { token, userId },
      });
      if (completeError) throw await normalizeFunctionError(completeError);
      if (!data?.success) throw new Error(data?.error || "Failed to join company");

      toast({ title: "Welcome aboard", description: `You've joined ${invite.tenantName}.` });
      setStatus("success");
      setTimeout(() => navigate(`/t/${invite.tenantId}/projects`), 1500);
    } catch (err: any) {
      toast({ title: "Signup failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const goToLogin = () => {
    sessionStorage.setItem("pendingCompanyInviteToken", token || "");
    navigate("/auth");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <img src={riskBlueLogo} alt="RiskBlue" className="h-10 mx-auto mb-4" />
          <CardTitle>Company Invitation</CardTitle>
          {invite?.tenantName && (
            <CardDescription>You've been invited to join "{invite.tenantName}"</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {status === "loading" && (
            <div className="flex flex-col items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Processing your invitation...</p>
            </div>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center py-8 text-center">
              <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
              <p className="text-lg font-medium mb-2">You're in!</p>
              <p className="text-sm text-muted-foreground">Taking you to the company workspace...</p>
            </div>
          )}

          {status === "needs_login" && (
            <div className="flex flex-col items-center py-6 text-center">
              <AlertCircle className="h-12 w-12 text-yellow-500 mb-4" />
              <p className="text-lg font-medium mb-2">Login required</p>
              <p className="text-muted-foreground mb-6">
                You've been added to {invite?.tenantName}. Log in to access it.
              </p>
              <Button onClick={goToLogin} className="w-full">Go to Login</Button>
            </div>
          )}

          {status === "needs_signup" && (
            <form onSubmit={handleSignup} className="space-y-4">
              <p className="text-muted-foreground text-center">
                Create your account to join as a <span className="font-medium capitalize">{invite?.role}</span>
              </p>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={invite?.email || ""} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} required minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm" type="password" value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)} required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Account & Join
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Already have an account?{" "}
                <button type="button" onClick={goToLogin} className="text-primary hover:underline">
                  Log in
                </button>
              </p>
            </form>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center py-8 text-center">
              <XCircle className="h-12 w-12 text-destructive mb-4" />
              <p className="text-lg font-medium mb-2">Invitation problem</p>
              <p className="text-muted-foreground mb-6">{error}</p>
              <Button variant="outline" onClick={() => navigate("/projects")} className="w-full">
                Go to Projects
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AcceptCompanyInvite;
