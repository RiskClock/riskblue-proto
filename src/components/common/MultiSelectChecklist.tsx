import { useState } from "react";
import { ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function MultiSelectChecklist({
  options,
  selected,
  onChange,
  allLabel,
  emptyLabel = "No options",
  searchable = false,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  allLabel: string;
  emptyLabel?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const allValues = options.map((o) => o.value);
  const allChecked = options.length > 0 && selected.length === options.length;
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const toggle = (value: string) => {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value));
    else onChange([...selected, value]);
  };

  const triggerLabel =
    selected.length === 0
      ? allLabel
      : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label || selected[0]
      : `${selected.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="mt-1 w-full justify-between font-normal h-9">
          <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
            {triggerLabel}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="p-2 border-b flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => onChange(allChecked ? [] : allValues)}
            disabled={options.length === 0}
          >
            {allChecked ? "Uncheck all" : "Check all"}
          </button>
          {selected.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => onChange([])}
            >
              Clear
            </button>
          )}
        </div>
        {searchable && options.length > 5 && (
          <div className="p-2 border-b">
            <Input
              placeholder="Search..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        )}
        <div
          className="max-h-56 overflow-auto p-1 overscroll-contain"
          onWheel={(e) => e.stopPropagation()}
        >
          {filtered.length === 0 && (
            <div className="px-2 py-3 text-sm text-muted-foreground">{emptyLabel}</div>
          )}
          {filtered.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted text-left"
              >
                <Checkbox checked={checked} className="pointer-events-none" />
                <span className="truncate flex-1">{o.label}</span>
                {checked && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default MultiSelectChecklist;
