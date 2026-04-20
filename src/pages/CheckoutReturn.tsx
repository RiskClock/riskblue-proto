import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useCredits } from "@/hooks/useCredits";

export default function CheckoutReturn() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const navigate = useNavigate();
  const { balance, refetch } = useCredits();
  const [open, setOpen] = useState(true);

  // Quietly poll in the background so the balance updates after the webhook lands.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 8; i++) {
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 1000));
        await refetch();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refetch, sessionId]);

  const handleClose = () => {
    setOpen(false);
    navigate("/projects");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Check className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center">
            {sessionId ? "Payment received" : "No payment session found"}
          </DialogTitle>
          <DialogDescription className="text-center">
            {sessionId ? (
              <>
                Your new balance:{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {balance} credits
                </span>
              </>
            ) : (
              "Return to your projects to continue."
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button onClick={handleClose}>Back to projects</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
