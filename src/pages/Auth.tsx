import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { signInSchema } from "@/lib/validation";
import { getUserFriendlyError } from "@/lib/errorHandling";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

declare global {
  interface Window {
    heap?: {
      track: (event: string, properties?: Record<string, unknown>) => void;
    };
  }
}

const Auth = () => {
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Request access modal state
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestForm, setRequestForm] = useState({
    fullName: '',
    workEmail: '',
    companyName: ''
  });
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  
  const { signIn, user, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Redirect to projects if already authenticated
  useEffect(() => {
    if (!loading && user) {
      navigate("/projects");
    }
  }, [user, loading, navigate]);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      toast({
        title: "Email required",
        description: "Please enter your email address.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-password-reset', {
        body: { email }
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.error || 'Failed to send reset email');
      
      setResetEmailSent(true);
      toast({
        title: "Reset email sent",
        description: "Check your email for a password reset link.",
      });
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Track login button click
    if (window.heap) {
      window.heap.track('login_button_clicked');
    }
    
    try {
      // Validate login input
      const validation = signInSchema.safeParse({ email, password });
      if (!validation.success) {
        toast({
          title: "Validation Error",
          description: validation.error.errors[0].message,
          variant: "destructive",
        });
        return;
      }

      const { error } = await signIn(email, password);
      if (error) throw error;
      navigate("/projects");
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  };

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingRequest(true);
    
    try {
      // Track submit request click
      if (window.heap) {
        window.heap.track('access_request_submitted', {
          company: requestForm.companyName
        });
      }
      
      const { error } = await supabase
        .from('access_requests')
        .insert({
          full_name: requestForm.fullName,
          work_email: requestForm.workEmail,
          company_name: requestForm.companyName
        });
      
      if (error) throw error;
      setRequestSubmitted(true);
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: "Failed to submit request. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  // Forgot password view
  if (isForgotPassword) {
    return (
      <div className="min-h-screen flex">
        <div className="flex-1 flex items-center justify-center bg-background p-8">
          <div className="w-full max-w-md space-y-8">
            <div className="text-center">
              <img src={riskBlueLogo} alt="RiskBlue" className="h-12 mx-auto mb-8" />
              <h1 className="text-4xl font-bold font-serif text-foreground">Reset Password</h1>
              <p className="text-muted-foreground mt-2">
                {resetEmailSent 
                  ? "Check your email for a reset link" 
                  : "Enter your email to receive a reset link"}
              </p>
            </div>

            {!resetEmailSent ? (
              <form onSubmit={handleForgotPassword} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>

                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? "Sending..." : "Send Reset Link"}
                </Button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setIsForgotPassword(false);
                      setResetEmailSent(false);
                    }}
                    className="text-sm text-primary hover:underline"
                  >
                    Back to login
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-center space-y-4">
                <p className="text-muted-foreground">
                  We've sent a password reset link to <strong>{email}</strong>
                </p>
                <Button 
                  onClick={() => {
                    setIsForgotPassword(false);
                    setResetEmailSent(false);
                  }} 
                  variant="outline" 
                  className="w-full"
                >
                  Back to login
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="hidden lg:flex flex-1 bg-[url('https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80')] bg-cover bg-center relative items-center justify-center">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/80 to-primary/60" />
          <div className="relative z-10 max-w-md text-white">
            <h2 className="text-4xl font-bold font-serif mb-4">
              Enterprise-grade water risk management for construction and insurance
            </h2>
            <p className="text-lg text-white/90">
              Connect risk assessment, control measures, and trusted solution providers 
              in one platform built for builders, insurers, and risk teams.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      <div className="flex-1 flex items-center justify-center bg-background p-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <img src={riskBlueLogo} alt="RiskBlue" className="h-12 mx-auto mb-8" />
            <h1 className="text-4xl font-bold font-serif text-foreground">Log In</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                />
                <Label htmlFor="remember" className="text-sm text-muted-foreground">
                  Remember me
                </Label>
              </div>
              <button 
                type="button" 
                onClick={() => setIsForgotPassword(true)}
                className="text-sm text-primary hover:underline"
              >
                Forgot password?
              </button>
            </div>

            <Button type="submit" className="w-full">Log In</Button>
          </form>

          <div className="mt-8 pt-6 border-t border-border text-center space-y-2">
            <p className="text-sm font-medium text-foreground">Don't have an account?</p>
            <p className="text-sm text-muted-foreground">
              RiskBlue is available by invitation for approved organizations.
            </p>
            <button
              type="button"
              onClick={() => setShowRequestModal(true)}
              className="text-sm text-primary hover:underline font-medium"
            >
              Request Access
            </button>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 bg-[url('https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80')] bg-cover bg-center relative items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/80 to-primary/60" />
        <div className="relative z-10 max-w-md text-white">
          <h2 className="text-4xl font-bold font-serif mb-4">
            Enterprise-grade water risk management for construction and insurance
          </h2>
          <p className="text-lg text-white/90">
            Connect risk assessment, control measures, and trusted solution providers 
            in one platform built for builders, insurers, and risk teams.
          </p>
        </div>
      </div>

      <Dialog open={showRequestModal} onOpenChange={(open) => {
        setShowRequestModal(open);
        if (!open) {
          setRequestSubmitted(false);
          setRequestForm({ fullName: '', workEmail: '', companyName: '' });
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request Access</DialogTitle>
          </DialogHeader>
          
          {!requestSubmitted ? (
            <form onSubmit={handleRequestAccess} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input 
                  id="fullName" 
                  required 
                  value={requestForm.fullName} 
                  onChange={(e) => setRequestForm({...requestForm, fullName: e.target.value})} 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="workEmail">Work email</Label>
                <Input 
                  id="workEmail" 
                  type="email" 
                  required 
                  value={requestForm.workEmail}
                  onChange={(e) => setRequestForm({...requestForm, workEmail: e.target.value})} 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="companyName">Company name</Label>
                <Input 
                  id="companyName" 
                  required 
                  value={requestForm.companyName}
                  onChange={(e) => setRequestForm({...requestForm, companyName: e.target.value})} 
                />
              </div>
              <Button type="submit" className="w-full" disabled={isSubmittingRequest}>
                {isSubmittingRequest ? "Submitting..." : "Submit Request"}
              </Button>
            </form>
          ) : (
            <p className="text-muted-foreground py-4">
              Thanks — our team will review your request and follow up shortly.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Auth;