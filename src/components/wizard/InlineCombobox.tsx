import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

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
}

export const InlineCombobox = ({
  value,
  options,
  onChange,
  placeholder = "Type to search...",
  className,
}: InlineComboboxProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });

  // Filter options based on search
  const filteredOptions = options.filter(
    (opt) => !search || opt.value.toLowerCase().includes(search.toLowerCase())
  );

  // Group options by category
  const groupedOptions = filteredOptions.reduce((acc, opt) => {
    if (!acc[opt.category]) acc[opt.category] = [];
    acc[opt.category].push(opt);
    return acc;
  }, {} as Record<string, ComboboxOption[]>);

  // Flat list for keyboard navigation
  const flatOptions = Object.values(groupedOptions).flat();

  // Update dropdown position when opening
  const updatePosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: Math.max(280, rect.width),
      });
    }
  }, []);

  // Handle open/close
  useEffect(() => {
    if (isOpen) {
      updatePosition();
      setHighlightedIndex(0);
    }
  }, [isOpen, updatePosition]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setSearch("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Reset highlighted index when filtered options change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [search]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < flatOptions.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case "Enter":
        e.preventDefault();
        if (flatOptions[highlightedIndex]) {
          onChange(flatOptions[highlightedIndex].value);
          setIsOpen(false);
          setSearch("");
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setSearch("");
        break;
      case "Tab":
        setIsOpen(false);
        setSearch("");
        break;
    }
  };

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearch("");
    inputRef.current?.focus();
  };

  // Track running index for highlighting across groups
  let runningIndex = 0;

  const dropdown = isOpen ? (
    <div
      ref={dropdownRef}
      className="fixed z-[9999] bg-popover border rounded-md shadow-lg max-h-[300px] overflow-auto"
      style={{
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: dropdownPosition.width,
      }}
    >
      {flatOptions.length === 0 ? (
        <div className="py-4 text-center text-sm text-muted-foreground">
          No type found.
        </div>
      ) : (
        Object.entries(groupedOptions).map(([category, opts]) => (
          <div key={category}>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50">
              {category}
            </div>
            {opts.map((opt) => {
              const currentIndex = runningIndex++;
              const isHighlighted = currentIndex === highlightedIndex;
              const isSelected = value === opt.value;

              return (
                <div
                  key={opt.value}
                  className={cn(
                    "flex items-center justify-between px-2 py-1.5 text-xs cursor-pointer",
                    isHighlighted && "bg-accent text-accent-foreground",
                    !isHighlighted && "hover:bg-accent/50"
                  )}
                  onClick={() => handleSelect(opt.value)}
                  onMouseEnter={() => setHighlightedIndex(currentIndex)}
                >
                  <span className="truncate">{opt.value}</span>
                  <Check
                    className={cn("h-3 w-3 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                  />
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  ) : null;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Input
        ref={inputRef}
        className="h-6 text-xs px-2 pr-6"
        placeholder={placeholder}
        value={isOpen ? search : value}
        onChange={(e) => {
          setSearch(e.target.value);
          if (!isOpen) setIsOpen(true);
        }}
        onFocus={() => {
          setIsOpen(true);
          setSearch("");
        }}
        onKeyDown={handleKeyDown}
      />
      <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 opacity-50 pointer-events-none" />
      {createPortal(dropdown, document.body)}
    </div>
  );
};
