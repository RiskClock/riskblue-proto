import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";

type InviteStatus = "loading" | "needs_login" | "needs_signup" | "success" | "error" | "expired" | "already_accepted";

interface InviteData {
  projectId: string;
  projectName: string;
  email?: string;
  name?: string;
  role?: string;
  token?: string;
  message?: string;
}

const AcceptInvite = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, signUp } = useAuth();
  const { toast } = useToast();
  
  const token = searchParams.get("token");
  
  const [status, setStatus] = useState<InviteStatus>("loading");
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [error, setError] = useState<string>("");
  
  // Signup form state
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Process the invitation
  useEffect(() => {
    const processInvite = async () => {
      if (!token) {
        setStatus("error");
        setError("No invitation token provided");
        return;
      }

      try {
        const { data, error: invokeError } = await supabase.functions.invoke("accept-invite", {
          body: { token },
        });

        if (invokeError) {
          throw new Error(invokeError.message);
        }

        if (!data.success && data.error) {
          if (data.error.includes("expired")) {
            setStatus("expired");
          } else if (data.error.includes("already been accepted")) {
            setStatus("already_accepted");
            setInviteData({ projectId: data.projectId, projectName: data.projectName });
          } else {
            setStatus("error");
            setError(data.error);
          }
          return;
        }

        setInviteData({
          projectId: data.projectId,
          projectName: data.projectName,
          email: data.email,
          name: data.name,
          role: data.role,
          token: data.token,
          message: data.message,
        });

        if (data.status === "needs_signup") {
          setStatus("needs_signup");
        } else if (data.status === "added" || data.status === "already_member") {
          if (user) {
            setStatus("success");
            // Redirect to project after a short delay
            setTimeout(() => {
              navigate(`/project/${data.projectId}`);
            }, 2000);
          } else {
            setStatus("needs_login");
          }
        } else {
          setStatus("success");
        }
      } catch (err: any) {
        console.error("Error processing invite:", err);
        setStatus("error");
        setError(err.message || "Failed to process invitation");
      }
    };

    processInvite();
  }, [token, user, navigate]);

  // Handle signup form submission
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!inviteData?.email || !inviteData?.name) {
      toast({
        title: "Error",
        description: "Missing invitation data",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Error",
        description: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: signUpError } = await signUp(inviteData.email, password, inviteData.name);
      
      if (signUpError) {
        throw signUpError;
      }

      // Complete the invitation signup
      const { data, error: completeError } = await supabase.functions.invoke("complete-invite-signup", {
        body: { 
          token: inviteData.token,
          userId: (await supabase.auth.getUser()).data.user?.id,
        },
      });

      if (completeError) {
        console.error("Error completing invite signup:", completeError);
      }

      toast({
        title: "Account Created",
        description: "Your account has been created and you've been added to the project",
      });

      setStatus("success");
      
      // Redirect to project
      setTimeout(() => {
        navigate(`/project/${inviteData.projectId}`);
      }, 2000);
    } catch (err: any) {
      console.error("Signup error:", err);
      toast({
        title: "Signup Failed",
        description: err.message || "Failed to create account",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle login redirect
  const handleLoginRedirect = () => {
    // Store the token to process after login
    sessionStorage.setItem("pendingInviteToken", token || "");
    navigate("/auth");
  };

  // Handle go to project
  const handleGoToProject = () => {
    if (inviteData?.projectId) {
      navigate(`/project/${inviteData.projectId}`);
    } else {
      navigate("/projects");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <img src={riskBlueLogo} alt="RiskBlue" className="h-10 mx-auto mb-4" />
          <CardTitle>Project Invitation</CardTitle>
          {inviteData?.projectName && (
            <CardDescription>
              You've been invited to collaborate on "{inviteData.projectName}"
            </CardDescription>
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
            <div className="flex flex-col items-center py-8">
              <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
              <p className="text-lg font-medium mb-2">You're in!</p>
              <p className="text-muted-foreground text-center mb-4">
                {inviteData?.message || "You've been added to the project."}
              </p>
              <p className="text-sm text-muted-foreground">Redirecting to project...</p>
            </div>
          )}

          {status === "needs_login" && (
            <div className="flex flex-col items-center py-6">
              <AlertCircle className="h-12 w-12 text-yellow-500 mb-4" />
              <p className="text-lg font-medium mb-2">Login Required</p>
              <p className="text-muted-foreground text-center mb-6">
                You've been added to the project. Please log in to access it.
              </p>
              <Button onClick={handleLoginRedirect} className="w-full">
                Go to Login
              </Button>
            </div>
          )}

          {status === "needs_signup" && (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="text-center mb-6">
                <p className="text-muted-foreground">
                  Create your account to join the project as a{" "}
                  <span className="font-medium">{inviteData?.role === "admin" ? "Admin" : "Contributor"}</span>
                </p>
              </div>

              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={inviteData?.name || ""} disabled className="bg-muted" />
              </div>

              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={inviteData?.email || ""} disabled className="bg-muted" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password"
                  required
                  minLength={6}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Account & Join Project
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={handleLoginRedirect}
                  className="text-primary hover:underline"
                >
                  Log in instead
                </button>
              </p>
            </form>
          )}

          {status === "already_accepted" && (
            <div className="flex flex-col items-center py-6">
              <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
              <p className="text-lg font-medium mb-2">Already Accepted</p>
              <p className="text-muted-foreground text-center mb-6">
                This invitation has already been accepted.
              </p>
              <Button onClick={handleGoToProject} className="w-full">
                Go to Project
              </Button>
            </div>
          )}

          {status === "expired" && (
            <div className="flex flex-col items-center py-6">
              <XCircle className="h-12 w-12 text-destructive mb-4" />
              <p className="text-lg font-medium mb-2">Invitation Expired</p>
              <p className="text-muted-foreground text-center mb-6">
                This invitation has expired. Please ask the project admin to send a new invitation.
              </p>
              <Button variant="outline" onClick={() => navigate("/projects")}>
                Go to Projects
              </Button>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center py-6">
              <XCircle className="h-12 w-12 text-destructive mb-4" />
              <p className="text-lg font-medium mb-2">Something Went Wrong</p>
              <p className="text-muted-foreground text-center mb-6">
                {error || "Failed to process the invitation"}
              </p>
              <Button variant="outline" onClick={() => navigate("/projects")}>
                Go to Projects
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AcceptInvite;
