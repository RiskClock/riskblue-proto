import { Bug } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AgentActionBarProps {
  label: string;
  icon: React.ReactNode;
  onAction: () => void;
  onDebug: () => void;
  debugLabel: string;
  disabled?: boolean;
}

export function AgentActionBar({ label, icon, onAction, onDebug, debugLabel, disabled }: AgentActionBarProps) {
  return (
    <div className="p-3 border-b shrink-0 flex items-center gap-1">
      <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={onAction} disabled={disabled}>
        {icon}{label}
      </Button>
      <Button size="sm" variant="outline" className="h-8 w-8 p-0 shrink-0" onClick={onDebug} aria-label={debugLabel} title={debugLabel}>
        <Bug className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}