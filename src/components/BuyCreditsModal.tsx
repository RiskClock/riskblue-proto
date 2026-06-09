import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Coins, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCredits } from "@/hooks/useCredits";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, stripeEnvironment } from "@/lib/stripe";

interface BuyCreditsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional message shown above the packages, e.g. "You're out of credits." */
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

export const BuyCreditsModal = ({ open, onOpenChange, reason }: BuyCreditsModalProps) => {
  const { toast } = useToast();
  const { balance, refetch } = useCredits();
  const [loadingPackage, setLoadingPackage] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setClientSecret(null);
      setSelectedPackage(null);
      setLoadingPackage(null);
      setAcceptedTerms(false);
    }
  }, [open]);

  // On successful checkout: dismiss the modal immediately and refresh balance
  // quietly in the background. Do NOT show a success screen or reload the page —
  // that interrupts whatever flow opened this modal (e.g. project creation).
  const handleCheckoutComplete = async () => {
    onOpenChange(false);
    // Poll a few times in case webhook is slow; updates via realtime/refetch.
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
                : `You currently have ${balance} credit${balance === 1 ? "" : "s"}. Scanning each document uses 1 credit.`}
          </DialogDescription>
        </DialogHeader>

        {!clientSecret && (
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
                  <span className="text-2xl font-semibold text-primary">${pkg.priceUsd.toLocaleString()}</span>
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
            ))}
          </div>
        )}

        {clientSecret && (
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
      </DialogContent>
    </Dialog>
  );
};
