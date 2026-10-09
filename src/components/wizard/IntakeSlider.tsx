import { useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

export function IntakeSlider({ label, value, max, ticks, onChange, onCommit, disabled }: {
  label: string; value: number; max: number; ticks: number;
  onChange: (value: number) => void; onCommit: (value: number) => void; disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  return <div className="relative py-3">
    <SliderPrimitive.Root aria-label={label} value={[value]} min={0} max={max} step={max === 2 ? 1 : 100_000} disabled={disabled}
      className="relative z-10 flex h-6 w-full touch-none select-none items-center"
      onPointerDown={() => setDragging(true)} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}
      onValueChange={([next]) => onChange(next)} onValueCommit={([next]) => { setDragging(false); onCommit(next); }}>
      <SliderPrimitive.Track className="relative h-px w-full grow bg-border">
        <SliderPrimitive.Range className="absolute h-full bg-foreground" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb aria-label={label} className={cn("block border-foreground bg-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", dragging ? "h-5 w-5 rounded-full border-2" : "h-4 w-0.5 rounded-none border-0 bg-foreground")} />
    </SliderPrimitive.Root>
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-5 flex justify-between">
      {Array.from({ length: ticks }, (_, index) => <span key={index} className={cn("w-px bg-muted-foreground/50", index % 10 === 0 || ticks === 3 ? "h-4" : "h-2")} />)}
    </div>
  </div>;
}