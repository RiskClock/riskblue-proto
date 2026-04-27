import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, X, Tags as TagsIcon } from "lucide-react";
import { tagStyle } from "@/lib/tagColor";

interface TagOption {
  id: string;
  name: string;
}

interface Props {
  selected: string[]; // tag names
  onChange: (next: string[]) => void;
  available: TagOption[];
  placeholder?: string;
  triggerClassName?: string;
}

export function TagChip({
  name,
  onRemove,
  size = "sm",
}: {
  name: string;
  onRemove?: () => void;
  size?: "sm" | "md";
}) {
  const s = tagStyle(name);
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border font-medium " +
        (size === "md" ? "px-2.5 py-0.5 text-xs" : "px-2 py-0.5 text-[11px]")
      }
      style={{ backgroundColor: s.background, borderColor: s.border, color: s.color }}
    >
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full hover:bg-black/10 p-0.5"
          aria-label={`Remove ${name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export function TagPicker({
  selected,
  onChange,
  available,
  placeholder = "Add tags",
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedLower = useMemo(
    () => new Set(selected.map((s) => s.toLowerCase())),
    [selected]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return available
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [available, query]);

  const showCreate =
    query.trim().length > 0 &&
    !available.some((t) => t.name.toLowerCase() === query.trim().toLowerCase());

  const toggle = (name: string) => {
    if (selectedLower.has(name.toLowerCase())) {
      onChange(selected.filter((s) => s.toLowerCase() !== name.toLowerCase()));
    } else {
      onChange([...selected, name]);
    }
  };

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((name) => (
            <TagChip
              key={name}
              name={name}
              size="md"
              onRemove={() =>
                onChange(selected.filter((s) => s.toLowerCase() !== name.toLowerCase()))
              }
            />
          ))}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={triggerClassName || "h-8"}
            type="button"
          >
            <TagsIcon className="h-3.5 w-3.5 mr-1.5" />
            {placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-72" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search or create tag..."
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>No tags found.</CommandEmpty>
              <CommandGroup>
                {filtered.map((t) => {
                  const isSelected = selectedLower.has(t.name.toLowerCase());
                  return (
                    <CommandItem
                      key={t.id}
                      onSelect={() => toggle(t.name)}
                      className="flex items-center justify-between"
                    >
                      <TagChip name={t.name} size="md" />
                      {isSelected && <span className="text-xs text-muted-foreground">Selected</span>}
                    </CommandItem>
                  );
                })}
                {showCreate && (
                  <CommandItem
                    onSelect={() => {
                      toggle(query.trim());
                      setQuery("");
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create "{query.trim()}"
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
