import { isPaymentsTestMode } from "@/lib/stripe";

/**
 * Sitewide banner that appears whenever the published frontend is using a
 * Stripe TEST publishable key (pk_test_...). Renders nothing in live mode.
 *
 * Per Lovable payments knowledge, this should sit at the very top of the
 * page layout so it spans full width.
 */
export const PaymentTestModeBanner = () => {
  if (!isPaymentsTestMode()) return null;

  return (
    <div
      role="status"
      className="w-full border-b border-warning/40 bg-warning/15 px-4 py-2 text-center text-xs text-warning-foreground no-print"
    >
      <span className="font-semibold">Test mode</span>
      <span className="mx-1.5">-</span>
      All payments in this preview are simulated. Use card{" "}
      <code className="font-mono px-1 py-0.5 rounded bg-background/60 border border-border">
        4242 4242 4242 4242
      </code>{" "}
      with any future expiry &amp; any CVC.
    </div>
  );
};
