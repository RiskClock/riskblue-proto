import { Check, Clock, FilePlus2, ScanSearch, Users, Mail, Trophy, ArrowRight } from "lucide-react";
import { developerProgress } from "@/lib/developerProgress";
import { cn } from "@/lib/utils";

const STEPS = [
  { label: "Create Project", icon: FilePlus2 },
  { label: "RiskBlue Threat Analysis", icon: ScanSearch },
  { label: "Select Vendors", icon: Users },
  { label: "Vendors Bid", icon: Mail },
  { label: "Review and Award", icon: Trophy },
];

export function DeveloperProjectStepper({ isExisting, status, vendorCount }: { isExisting: boolean; status?: string; vendorCount: number }) {
  const progress = developerProgress(isExisting, status, vendorCount);
  return (
    <nav aria-label="Project progress" className="border-b border-border bg-background px-6 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl overflow-x-auto pb-2">
        <ol className="flex min-w-[920px] items-start">
          {STEPS.map((step, index) => {
            const completed = index < progress.currentStep;
            const current = index === progress.currentStep;
            const waiting = current && progress.waiting;
            const Icon = completed ? Check : waiting ? Clock : step.icon;
            return (
              <li key={step.label} aria-current={current ? "step" : undefined} className="flex min-w-0 flex-1 items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col items-center gap-3 text-center">
                  <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground", completed && "project-step-completed", current && !waiting && "project-step-current", waiting && "project-step-waiting")}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className={cn("text-sm leading-5", current || completed ? "font-semibold text-foreground" : "text-muted-foreground")}>{step.label}</span>
                  <span className="text-xs text-muted-foreground">{completed ? "Completed" : waiting ? "Waiting for drawings" : current ? "Current step" : "Upcoming"}</span>
                </div>
                {index < STEPS.length - 1 && <ArrowRight aria-hidden="true" className="mt-3 h-4 w-4 shrink-0 text-muted-foreground" />}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}