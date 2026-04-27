import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { ControlVendors } from "@/hooks/useControlVendorOfferings";

interface ControlDetails {
  name: string;
  description?: string;
  action?: string;
  author?: string;
  responsible?: string;
  category?: string;
  points?: number;
  oneTimeCost?: number;
  monthlyMaintCost?: number;
  vendors?: ControlVendors;
}

interface ControlDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  control: ControlDetails | null;
}

export const ControlDetailsModal = ({
  isOpen,
  onClose,
  control
}: ControlDetailsModalProps) => {
  if (!control) return null;

  const formatCost = (cost?: number) => {
    if (!cost) return '$0';
    if (cost >= 1000000) return `$${(cost / 1000000).toFixed(1)}M`;
    if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}K`;
    return `$${cost}`;
  };

  // Build the author/vendors display.
  const vendors = control.vendors;
  const companies = vendors?.companies || (control.author ? [control.author] : []);
  const renderVendor = (companyName: string) => {
    const subs = vendors?.subOptionsByCompany.get(companyName.toLowerCase()) || [];
    if (subs.length === 0) return companyName;
    return `${companyName} (${subs.join(", ")})`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{control.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Category & Points */}
          <div className="flex items-center gap-2 flex-wrap">
            {control.category && (
              <Badge variant="outline" className="text-xs">
                {control.category}
              </Badge>
            )}
            {control.points !== undefined && control.points > 0 && (
              <Badge className="text-xs bg-emerald-500 text-white">
                {control.points} derisk pts
              </Badge>
            )}
            {(control.oneTimeCost !== undefined || control.monthlyMaintCost !== undefined) && (
              <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
                {formatCost(control.oneTimeCost || 0)} + {formatCost(control.monthlyMaintCost || 0)}/mo
              </Badge>
            )}
          </div>

          {/* Description */}
          {control.description && (
            <div>
              <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Description</label>
              <p className="text-sm mt-1 leading-relaxed">{control.description}</p>
            </div>
          )}

          {/* Action */}
          {control.action && (
            <div>
              <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Action</label>
              <p className="text-sm mt-1 leading-relaxed">{control.action}</p>
            </div>
          )}

          {/* Author / Vendors & Responsible */}
          {(companies.length > 0 || control.responsible) && (
            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              {companies.length > 0 && (
                <div>
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    {companies.length > 1 ? `Authors (${companies.length})` : "Author"}
                  </label>
                  <div className="text-sm font-medium mt-1 space-y-0.5">
                    {companies.map((c) => (
                      <div key={c}>{renderVendor(c)}</div>
                    ))}
                  </div>
                </div>
              )}
              {control.responsible && (
                <div>
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Responsible</label>
                  <p className="text-sm font-medium mt-1">{control.responsible}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
