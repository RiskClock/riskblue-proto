import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
  const filteredOptions = useMemo(() => 
    options.filter(
      (opt) => !search || opt.value.toLowerCase().includes(search.toLowerCase())
    ),
    [options, search]
  );

  // Group options by category
  const groupedOptions = useMemo(() => 
    filteredOptions.reduce((acc, opt) => {
      if (!acc[opt.category]) acc[opt.category] = [];
      acc[opt.category].push(opt);
      return acc;
    }, {} as Record<string, ComboboxOption[]>),
    [filteredOptions]
  );

  // Pre-compute flat list with indices for consistent highlighting
  const flatOptionsWithMeta = useMemo(() => {
    let index = 0;
    const result: Array<{ opt: ComboboxOption; index: number; category: string }> = [];
    Object.entries(groupedOptions).forEach(([category, opts]) => {
      opts.forEach((opt) => {
        result.push({ opt, index: index++, category });
      });
    });
    return result;
  }, [groupedOptions]);

  // Update dropdown position when opening - use fixed positioning relative to viewport
  const updatePosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4, // Fixed positioning - no scrollY needed
        left: rect.left,
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
          prev < flatOptionsWithMeta.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case "Enter":
        e.preventDefault();
        if (flatOptionsWithMeta[highlightedIndex]) {
          onChange(flatOptionsWithMeta[highlightedIndex].opt.value);
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

  // Group the flat list back for rendering with categories
  const groupedForRender = useMemo(() => {
    const groups: Record<string, Array<{ opt: ComboboxOption; index: number }>> = {};
    flatOptionsWithMeta.forEach((item) => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push({ opt: item.opt, index: item.index });
    });
    return groups;
  }, [flatOptionsWithMeta]);

  const dropdown = isOpen ? (
    <div
      ref={dropdownRef}
      className="fixed bg-popover border border-border rounded-md shadow-lg max-h-[300px] overflow-auto"
      style={{
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: dropdownPosition.width,
        zIndex: 99999,
      }}
    >
      {flatOptionsWithMeta.length === 0 ? (
        <div className="py-4 text-center text-sm text-muted-foreground">
          No type found.
        </div>
      ) : (
        Object.entries(groupedForRender).map(([category, items]) => (
          <div key={category}>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50">
              {category}
            </div>
            {items.map(({ opt, index }) => {
              const isHighlighted = index === highlightedIndex;
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
                  onMouseEnter={() => setHighlightedIndex(index)}
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
