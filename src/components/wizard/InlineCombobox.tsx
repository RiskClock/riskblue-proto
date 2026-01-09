import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface ComboboxOption {
  value: string;
  category: string;
}

interface InlineComboboxProps {
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export interface InlineComboboxRef {
  focus: () => void;
}

export const InlineCombobox = forwardRef<InlineComboboxRef, InlineComboboxProps>(({
  value,
  options,
  onChange,
  placeholder = "Select...",
  className,
  onKeyDown,
}, ref) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  // When inside a modal, portal to the dialog content so wheel scrolling works reliably.
  useEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;

    const dialogEl = el.closest('[role="dialog"]') as HTMLElement | null;
    setPortalContainer(dialogEl);
  }, [open]);

  const groupedOptions = useMemo(
    () =>
      options.reduce((acc, opt) => {
        if (!acc[opt.category]) acc[opt.category] = [];
        acc[opt.category].push(opt);
        return acc;
      }, {} as Record<string, ComboboxOption[]>),
    [options],
  );

  // Expose focus method via ref
  useImperativeHandle(ref, () => ({
    focus: () => triggerRef.current?.focus(),
  }), []);

  // Handle keydown - forward Tab events when dropdown is closed
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && onKeyDown) {
      onKeyDown(e);
    }
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          ref={triggerRef}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-6 w-full min-w-0 justify-between px-2 text-xs font-normal", className)}
          onKeyDown={handleKeyDown}
        >
          <span className="min-w-0 flex-1 truncate text-left">{value || placeholder}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal container={portalContainer ?? undefined}>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className={cn(
            "z-[99999] w-[280px] rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none",
          )}
        >
          <Command>
            <CommandInput placeholder="Search AWP..." className="h-9" />
            <CommandList
              className="overscroll-contain"
              onWheel={(e) => {
                // prevent the underlying table (or modal) from stealing the scroll wheel
                e.stopPropagation();
              }}
            >
              <CommandEmpty>No option found.</CommandEmpty>
              {Object.entries(groupedOptions).map(([category, items]) => (
                <CommandGroup key={category} heading={category}>
                  {items.map((opt) => (
                    <CommandItem
                      key={opt.value}
                      value={opt.value}
                      onSelect={(currentValue) => {
                        onChange(currentValue);
                        setOpen(false);
                      }}
                      className="text-xs"
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4 shrink-0",
                          value === opt.value ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="min-w-0 flex-1 break-words">{opt.value}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
});

InlineCombobox.displayName = "InlineCombobox";

