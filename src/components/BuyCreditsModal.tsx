import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Coins, Loader2, Lock, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCredits } from "@/hooks/useCredits";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, stripeEnvironment } from "@/lib/stripe";
import { useAuth } from "@/contexts/AuthContext";
import { PolicyReviewPanel, type PolicyDoc } from "@/components/checkout/PolicyReviewPanel";

interface BuyCreditsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: string;
}

interface CreditPackage {
  id: "pack_100" | "pack_500";
  credits: number;
  priceUsd: number;
  priceIdFull: string;
}

const PACKAGES: CreditPackage[] = [
  { id: "pack_100", credits: 100, priceUsd: 100, priceIdFull: "credits_pack_100_v3_usd" },
  { id: "pack_500", credits: 500, priceUsd: 400, priceIdFull: "credits_pack_500_v3_usd" },
];

type Step = "select" | "review_and_checkout";

export const BuyCreditsModal = ({ open, onOpenChange, reason }: BuyCreditsModalProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { balance, refetch } = useCredits();

  const [step, setStep] = useState<Step>("select");
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null);

  // Policy state
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policiesError, setPoliciesError] = useState<string | null>(null);
  const [tos, setTos] = useState<PolicyDoc | null>(null);
  const [privacy, setPrivacy] = useState<PolicyDoc | null>(null);
  const [accepted, setAccepted] = useState(false);

  // Stripe state
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [packageLoading, setPackageLoading] = useState<string | null>(null);

  // Reset everything when modal closes
  useEffect(() => {
    if (!open) {
      setStep("select");
      setSelectedPackage(null);
      setPoliciesLoading(false);
      setPoliciesError(null);
      setTos(null);
      setPrivacy(null);
      setAccepted(false);
      setClientSecret(null);
      setCheckoutLoading(false);
      setCheckoutError(null);
      setPackageLoading(null);
    }
  }, [open]);

  const handleCheckoutComplete = async () => {
    onOpenChange(false);
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const { data } = await refetch();
      if ((data ?? 0) > balance) break;
    }
  };

  const fetchPolicies = async () => {
    setPoliciesLoading(true);
    setPoliciesError(null);
    try {
      const { data, error } = await supabase.functions.invoke("get-stripe-policies", {
        body: { environment: stripeEnvironment },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.tos || !data?.privacy) throw new Error("Policies missing from response");
      setTos(data.tos);
      setPrivacy(data.privacy);

      // If user already accepted these exact versions, auto-tick.
      if (user?.id) {
        const { data: prior } = await supabase
          .from("policy_acceptances")
          .select("document_type, document_version")
          .eq("user_id", user.id)
          .in("document_version", [data.tos.version, data.privacy.version]);
        const hasTos = prior?.some(
          (r) => r.document_type === "tos" && r.document_version === data.tos.version,
        );
        const hasPrivacy = prior?.some(
          (r) => r.document_type === "privacy" && r.document_version === data.privacy.version,
        );
        if (hasTos && hasPrivacy) setAccepted(true);
      }
    } catch (e) {
      setPoliciesError(e instanceof Error ? e.message : "Failed to load policies");
    } finally {
      setPoliciesLoading(false);
    }
  };

  const fetchClientSecret = async (pkg: CreditPackage) => {
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      const { data, error } = await supabase.functions.invoke("create-credit-checkout", {
        body: {
          packageId: pkg.id,
          environment: stripeEnvironment,
          returnUrl: `${window.location.origin}/credits/return?session_id={CHECKOUT_SESSION_ID}`,
          tosVersion: tos?.version,
          privacyVersion: privacy?.version,
        },
      });
      if (error) throw error;
      if (!data?.clientSecret) throw new Error("No clientSecret returned");
      setClientSecret(data.clientSecret);
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : "Failed to start checkout");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleSelect = async (pkg: CreditPackage) => {
    setPackageLoading(pkg.id);
    setSelectedPackage(pkg);
    setStep("review_and_checkout");
    // Kick off both fetches in parallel.
    await Promise.all([fetchPolicies(), fetchClientSecret(pkg)]);
    setPackageLoading(null);
  };

  const handleAcceptedChange = async (next: boolean) => {
    if (!next) {
      setAccepted(false);
      return;
    }
    if (!user?.id || !tos || !privacy) return;

    // Optimistically flip so the scrim lifts immediately.
    setAccepted(true);

    // Only persist once per (tos.version, privacy.version) pair per session.
    const key = `${tos.version}|${privacy.version}`;
    if (persistedRef.current === key) return;

    const rows = [
      {
        user_id: user.id,
        document_type: "tos" as const,
        document_url: tos.url,
        document_version: tos.version,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      },
      {
        user_id: user.id,
        document_type: "privacy" as const,
        document_url: privacy.url,
        document_version: privacy.version,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      },
    ];
    const { error } = await supabase.from("policy_acceptances").insert(rows);
    if (error) {
      toast({
        title: "Could not record acceptance",
        description: (error as any)?.message ?? "Please try again.",
        variant: "destructive",
      });
      setAccepted(false);
      return;
    }
    persistedRef.current = key;
  };


  const handleBack = () => {
    setStep("select");
    setSelectedPackage(null);
    setClientSecret(null);
    setAccepted(false);
    setTos(null);
    setPrivacy(null);
    setPoliciesError(null);
    setCheckoutError(null);
  };

  const dialogWidth = step === "select" ? "max-w-3xl" : "max-w-6xl";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogWidth} max-h-[92vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            {step === "review_and_checkout" && selectedPackage
              ? `Buy ${selectedPackage.credits} Credits`
              : "Buy Credits"}
          </DialogTitle>
          <DialogDescription>
            {step === "review_and_checkout"
              ? "Review the Terms of Service and Privacy Policy, then complete your purchase."
              : reason
                ? reason
                : `You currently have ${balance} credit${balance === 1 ? "" : "s"}. Scanning each document uses 1 credit.`}
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="grid gap-4 md:grid-cols-2 mt-2">
            {PACKAGES.map((pkg) => (
              <Card
                key={pkg.id}
                className="relative overflow-hidden p-5 flex flex-col gap-3 transition-all border-primary/20 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 bg-gradient-to-br from-card to-primary/5"
              >
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-primary">{pkg.credits}</span>
                  <span className="text-sm text-muted-foreground">credits</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-primary">
                    ${pkg.priceUsd.toLocaleString()}
                  </span>
                </div>
                <div className="flex-1" />
                <Button
                  size="sm"
                  onClick={() => handleSelect(pkg)}
                  disabled={packageLoading !== null}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {packageLoading === pkg.id ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    "Buy"
                  )}
                </Button>
              </Card>
            ))}
          </div>
        )}

        {step === "review_and_checkout" && (
          <div className="mt-2">
            <div className="mb-3 flex justify-start">
              <Button variant="ghost" size="sm" onClick={handleBack}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Choose a different package
              </Button>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Left: policies */}
              <PolicyReviewPanel
                tos={tos}
                privacy={privacy}
                loading={policiesLoading}
                error={policiesError}
                onRetry={fetchPolicies}
                accepted={accepted}
                onAcceptedChange={handleAcceptedChange}
              />

              {/* Right: Stripe checkout with scrim */}
              <div className="relative min-h-[520px] rounded-md border bg-background">
                {checkoutLoading && (
                  <div className="flex h-[520px] items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!checkoutLoading && checkoutError && (
                  <div className="flex h-[520px] flex-col items-center justify-center gap-3 p-6 text-center">
                    <div className="text-sm text-destructive">{checkoutError}</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => selectedPackage && fetchClientSecret(selectedPackage)}
                    >
                      Retry
                    </Button>
                  </div>
                )}
                {!checkoutLoading && !checkoutError && clientSecret && (
                  <div className="p-1">
                    <EmbeddedCheckoutProvider
                      stripe={getStripe()}
                      options={{
                        fetchClientSecret: async () => clientSecret,
                        onComplete: handleCheckoutComplete,
                      }}
                    >
                      <EmbeddedCheckout />
                    </EmbeddedCheckoutProvider>
                  </div>
                )}

                {/* Scrim that blocks Stripe interaction until accepted */}
                <div
                  aria-hidden={accepted}
                  className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-md bg-background/70 p-6 text-center backdrop-blur-sm transition-opacity duration-200 ${
                    accepted ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100"
                  }`}
                >
                  <Lock className="h-6 w-6 text-muted-foreground" />
                  <div className="max-w-sm text-sm text-muted-foreground">
                    Check the boxes confirming you've read the Terms of Service and Privacy Policy to enable payment.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
};
