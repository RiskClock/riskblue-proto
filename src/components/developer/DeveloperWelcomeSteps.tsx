import { useState } from "react";
import { FilePlus2, ScanSearch, Users, Mail, Trophy, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS = [
  { title: "Define Project", icon: FilePlus2, body: "Set your target protection level and upload (or delegate) project drawings." },
  { title: "AI Threat Extraction", icon: ScanSearch, body: "RiskBlue securely analyzes your drawings to extract a standardized list of risk areas." },
  { title: "Select Vendors", icon: Users, body: "Review the threat summary and select specialists." },
  { title: "Receive Bids", icon: Mail, body: "Vendors review the extracted risk areas and submit itemized proposals." },
  { title: "Evaluate & Award", icon: Trophy, body: "Compare incoming bids side-by-side and select the best partner for your build." },
];

export function DeveloperWelcomeSteps() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-3 border-t border-border pt-2">
      <p className="mb-2 text-sm font-medium text-muted-foreground">Overall Process</p>
      <div className="min-w-0 overflow-x-auto pb-1">
      <ol id="developer-welcome-workflow" className="grid min-w-[960px] grid-cols-5 gap-6">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <div className="flex h-8 items-center gap-2">
              <span className="font-serif text-xl text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
              <h3 className={cn("flex items-center gap-2 text-base text-foreground", expanded ? "font-semibold" : "font-normal")}>{step.title}<step.icon className="h-4 w-4 shrink-0" aria-hidden="true" /></h3>
            </div>
            <div inert={!expanded ? true : undefined} aria-hidden={!expanded} className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none", expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
              <div className="overflow-hidden"><p className="pt-2 text-base leading-relaxed text-muted-foreground">{step.body}</p></div>
            </div>
          </li>
        ))}
      </ol>
      </div>
      <div className="mt-1 flex justify-center">
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={expanded ? "Collapse workflow descriptions" : "Expand workflow descriptions"} aria-expanded={expanded} aria-controls="developer-welcome-workflow" onClick={() => setExpanded(!expanded)}>
        <ChevronDown className={cn("h-4 w-4 transition-transform duration-300 motion-reduce:transition-none", expanded && "rotate-180")} />
      </Button>
      </div>
    </div>
  );
}