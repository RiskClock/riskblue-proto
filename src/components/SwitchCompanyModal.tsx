import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Building2, Loader2 } from "lucide-react";
import { useMyTenants, useTenant } from "@/contexts/TenantContext";
import { useQuery } from "@tanstack/react-query";
import { fetchCompanyLogoUrl } from "@/lib/brandLogo";

const CompanyLogo = ({ name }: { name: string }) => {
  const { data: url } = useQuery({
    queryKey: ["company-logo", (name || "").toLowerCase()],
    queryFn: () => fetchCompanyLogoUrl(name),
    enabled: !!name,
    staleTime: 60_000,
  });
  if (!url) return <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />;
  return <img src={url} alt={`${name} logo`} className="h-5 w-12 shrink-0 object-contain object-left" />;
};

interface SwitchCompanyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SwitchCompanyModal = ({ open, onOpenChange }: SwitchCompanyModalProps) => {
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const { data: tenants = [], isLoading } = useMyTenants();

  const handleSelect = (id: string) => {
    onOpenChange(false);
    navigate(`/t/${id}/projects`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Switch Company</DialogTitle>
          <DialogDescription>Choose the company you want to work in.</DialogDescription>
        </DialogHeader>
        <div
          className="space-y-1 max-h-[60vh] overflow-y-auto -mr-2 pr-2"
          onWheel={(e) => e.stopPropagation()}
        >
          {isLoading && (
            <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading companies...
            </div>
          )}
          {!isLoading && tenants.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              You don't belong to any company yet.
            </p>
          )}
          {tenants.map((t) => (
            <Button
              key={t.id}
              variant="ghost"
              className="w-full justify-start gap-2 h-auto py-2.5"
              onClick={() => handleSelect(t.id)}
            >
              <CompanyLogo name={t.name} />
              <span className="truncate flex-1 text-left">{t.name}</span>
              <Badge variant="secondary" className="capitalize">{t.role}</Badge>
              {t.id === tenantId && <Check className="h-4 w-4 text-primary shrink-0" />}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
