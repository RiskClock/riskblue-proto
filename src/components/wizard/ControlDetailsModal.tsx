import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

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

          {/* Author & Responsible */}
          {(control.author || control.responsible) && (
            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              {control.author && (
                <div>
                  <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Author</label>
                  <p className="text-sm font-medium mt-1">{control.author}</p>
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
