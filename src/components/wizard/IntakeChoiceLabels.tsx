import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function IntakeChoiceLabels({ labels, value, onChange }: {
  labels: string[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="mt-6 grid grid-cols-3 gap-2 text-base">
      {labels.map((label, index) => (
        <Button key={label} variant="ghost" onClick={() => onChange(index)} aria-pressed={value === index}
          className={cn("h-10 whitespace-normal px-2 py-1 text-sm leading-tight transition-colors sm:text-base hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground", value === index ? "text-foreground" : "text-muted-foreground")}>
          {label}
        </Button>
      ))}
    </div>
  );
}