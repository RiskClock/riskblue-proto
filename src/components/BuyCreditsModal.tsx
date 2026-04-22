import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Coins, Loader2, Check, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCredits } from "@/hooks/useCredits";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, stripeEnvironment, isPaymentsTestMode } from "@/lib/stripe";

interface BuyCreditsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional message shown above the packages, e.g. "You're out of credits." */
  reason?: string;
}

interface CreditPackage {
  id: "pack_20" | "pack_100" | "pack_500";
  credits: number;
  priceUsd: number;
  originalPriceUsd: number;
}

const PACKAGES: CreditPackage[] = [
  { id: "pack_20", credits: 20, priceUsd: 30, originalPriceUsd: 100 },
  { id: "pack_100", credits: 100, priceUsd: 130, originalPriceUsd: 430 },
  { id: "pack_500", credits: 500, priceUsd: 500, originalPriceUsd: 1650 },
];

export const BuyCreditsModal = ({ open, onOpenChange, reason }: BuyCreditsModalProps) => {
  const { toast } = useToast();
  const { balance, refetch } = useCredits();
  const [loadingPackage, setLoadingPackage] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null);
  const [completed, setCompleted] = useState(false);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setClientSecret(null);
      setSelectedPackage(null);
      setLoadingPackage(null);
      setCompleted(false);
    }
  }, [open]);

  // Refetch balance when checkout completes
  const handleCheckoutComplete = async () => {
    setCompleted(true);
    // Poll a few times in case webhook is slow
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const { data } = await refetch();
      if ((data ?? 0) > balance) break;
    }
  };

  const handleSelect = async (pkg: CreditPackage) => {
    setLoadingPackage(pkg.id);
    try {
      const { data, error } = await supabase.functions.invoke("create-credit-checkout", {
        body: {
          packageId: pkg.id,
          environment: stripeEnvironment,
          returnUrl: `${window.location.origin}/credits/return?session_id={CHECKOUT_SESSION_ID}`,
        },
      });

      if (error) throw error;
      if (!data?.clientSecret) throw new Error("No clientSecret returned");

      setClientSecret(data.clientSecret);
      setSelectedPackage(pkg);
    } catch (e) {
      toast({
        title: "Couldn't start checkout",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoadingPackage(null);
    }
  };

  const handleBack = () => {
    setClientSecret(null);
    setSelectedPackage(null);
    setCompleted(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            {clientSecret ? `Buy ${selectedPackage?.credits} Credits` : "Buy Credits"}
          </DialogTitle>
          <DialogDescription>
            {clientSecret
              ? "Complete your purchase below."
              : reason
                ? reason
                : `You currently have ${balance} credit${balance === 1 ? "" : "s"}. Each scan uses 1 credit.`}
          </DialogDescription>
        </DialogHeader>

        {isPaymentsTestMode() && !clientSecret && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
            Test mode — use card <code className="font-mono">4242 4242 4242 4242</code> with any future expiry &amp; any CVC.
          </div>
        )}

        {!clientSecret && (
          <>
            <div className="rounded-lg border border-primary/30 bg-gradient-to-r from-primary/15 via-primary/10 to-primary/15 px-4 py-3 mt-2 flex items-center justify-center gap-2 shadow-sm">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-primary tracking-wide">
                Water Mitigation Vendor Promotional Pricing
              </span>
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="grid gap-4 md:grid-cols-3 mt-2">
              {PACKAGES.map((pkg) => {
                const discountPct = Math.round(
                  (1 - pkg.priceUsd / pkg.originalPriceUsd) * 100,
                );
                return (
                  <Card
                    key={pkg.id}
                    className="relative overflow-hidden p-5 flex flex-col gap-3 transition-all border-primary/20 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 bg-gradient-to-br from-card to-primary/5"
                  >
                    <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-1 rounded-bl-lg">
                      -{discountPct}%
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-primary">{pkg.credits}</span>
                      <span className="text-sm text-muted-foreground">credits</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-semibold text-primary">${pkg.priceUsd}</span>
                      <span className="text-sm text-muted-foreground line-through">
                        ${pkg.originalPriceUsd.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      onClick={() => handleSelect(pkg)}
                      disabled={loadingPackage !== null}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                      {loadingPackage === pkg.id ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        "Buy"
                      )}
                    </Button>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {clientSecret && !completed && (
          <div className="mt-2">
            <EmbeddedCheckoutProvider
              stripe={getStripe()}
              options={{ fetchClientSecret: async () => clientSecret, onComplete: handleCheckoutComplete }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
            <div className="mt-3 flex justify-start">
              <Button variant="ghost" size="sm" onClick={handleBack}>
                ← Choose a different package
              </Button>
            </div>
          </div>
        )}

        {completed && (
          <div className="py-8 flex flex-col items-center text-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Check className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Payment received</h3>
            <p className="text-sm text-muted-foreground">
              Your new balance: <span className="font-semibold text-foreground">{balance} credits</span>
            </p>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
