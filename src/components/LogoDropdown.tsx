import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import riskBlueLogo from "@/assets/logo-riskblue.png";
import riskRedLogo from "@/assets/logo-riskred.png";

export function LogoDropdown() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isHovered, setIsHovered] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [interest, setInterest] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogoClick = () => {
    navigate("/projects");
  };

  const handleRiskRedClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsHovered(false);
    setShowModal(true);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    // Simulate a brief delay for submission
    await new Promise((resolve) => setTimeout(resolve, 500));
    setIsSubmitting(false);
    setShowModal(false);
    setInterest("");
    toast({
      title: "Thank you for your interest!",
      description: "We'll be in touch soon with more information about RiskRed.",
    });
  };

  return (
    <>
      <div
        className="relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Main logo - clickable to go to projects */}
        <div
          className="flex items-center gap-1 cursor-pointer"
          onClick={handleLogoClick}
        >
          <img src={riskBlueLogo} alt="RiskBlue" className="h-8" />
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-opacity duration-200 ${
              isHovered ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>

        {/* Dropdown menu on hover */}
        {isHovered && (
          <div
            className="absolute top-full left-0 mt-1 bg-card border border-border rounded-md shadow-lg z-50 min-w-[200px] animate-in fade-in-0 zoom-in-95 duration-150"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <button
              onClick={handleRiskRedClick}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted transition-colors rounded-md"
            >
              <img src={riskRedLogo} alt="RiskRed" className="h-6" />
              <span className="text-sm text-foreground">
                RiskRed <span className="text-muted-foreground">(Preview)</span>
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Request Preview Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <img src={riskRedLogo} alt="RiskRed" className="h-6" />
              Request Preview
            </DialogTitle>
            <DialogDescription>
              RiskRed is our upcoming fire risk management solution. Interested
              in learning more? Let us know and we'll reach out with early
              access details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label
                htmlFor="interest"
                className="text-sm font-medium text-foreground"
              >
                What interests you about RiskRed? (optional)
              </label>
              <Textarea
                id="interest"
                placeholder="Tell us about your fire risk management needs..."
                value={interest}
                onChange={(e) => setInterest(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowModal(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
