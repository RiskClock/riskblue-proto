import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ThreatOverviewCardProps {
  code: string;
  name: string;
  count: number;
  children?: ReactNode;
}

export function ThreatOverviewCard({ code, name, count, children }: ThreatOverviewCardProps) {
  return (
    <div className="overflow-hidden rounded border bg-card text-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-help bg-report-header px-2 py-1 text-xs font-semibold text-report-header-foreground">
            {code}
          </div>
        </TooltipTrigger>
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
      <div className="px-2 pt-2 text-2xl font-bold tabular-nums text-primary">{count}</div>
      <div className="min-h-10 px-2 pb-2 text-[11px] text-muted-foreground">{name}</div>
      {children}
    </div>
  );
}