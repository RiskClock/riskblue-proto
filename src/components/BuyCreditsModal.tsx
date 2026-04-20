import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Coins, Loader2, Check } from "lucide-react";
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
  id: "pack_5" | "pack_20" | "pack_50";
  credits: number;
  priceUsd: number;
  perCredit: number;
  highlight?: boolean;
}

const PACKAGES: (CreditPackage & { originalPriceUsd: number })[] = [
  { id: "pack_5", credits: 5, priceUsd: 80, perCredit: 16, originalPriceUsd: 500 },
  { id: "pack_20", credits: 20, priceUsd: 300, perCredit: 15, originalPriceUsd: 2000 },
  { id: "pack_50", credits: 50, priceUsd: 700, perCredit: 14, originalPriceUsd: 5000 },
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
            <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-center text-sm font-semibold text-primary mt-2">
              Early Partnership Pricing
            </div>
            <div className="grid gap-4 md:grid-cols-3 mt-2">
              {PACKAGES.map((pkg) => (
                <Card
                  key={pkg.id}
                  className="relative p-5 flex flex-col gap-3 transition-all"
                >
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold">{pkg.credits}</span>
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
                    variant="outline"
                    onClick={() => handleSelect(pkg)}
                    disabled={loadingPackage !== null}
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
              ))}
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
