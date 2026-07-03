import { useEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Check, Plus, Trash2, X as XIcon } from "lucide-react";

export interface AnnotationMetadataPopoverProps {
  open: boolean;
  /** Anchor point in viewport (client) coordinates. */
  anchor: { x: number; y: number } | null;
  /** Small header label, e.g. "DCW-001 diameter". */
  title: string;
  /** Currently-stored metadata value (or null when unset). */
  currentValue: string | null;
  /** Distinct previously-used values for the same annotation type. */
  suggestions: string[];
  /** Field placeholder / display term (e.g. "pipe diameter"). */
  placeholder?: string;
  onCommit: (next: string | null) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Lightweight floating popover for capturing per-annotation metadata
 * (currently pipe diameter for DCW / Fire Suppression markers).
 *
 * Positioned absolutely at `anchor` in viewport coords; not tied to a
 * React parent. Dismisses on outside click / Escape.
 */
export function AnnotationMetadataPopover({
  open,
  anchor,
  title,
  currentValue,
  suggestions,
  placeholder = "Diameter (e.g. 50mm, 3/4\")",
  onCommit,
  onDelete,
  onClose,
}: AnnotationMetadataPopoverProps) {
  const [query, setQuery] = useState<string>("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Always open with an empty text field so typing filters/creates without
    // the user first clearing the pre-populated current value.
    if (!open) return;
    setQuery("");
  }, [open, currentValue]);

  useEffect(() => {
    if (!open) return;
    // Defer registration so the click that opened the popover doesn't
    // immediately dismiss it.
    const timer = window.setTimeout(() => {
      const onDown = (e: MouseEvent) => {
        if (!rootRef.current) return;
        if (!rootRef.current.contains(e.target as Node)) onClose();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
      cleanup = () => {
        document.removeEventListener("mousedown", onDown);
        document.removeEventListener("keydown", onKey);
      };
    }, 0);
    let cleanup: (() => void) | null = null;
    return () => {
      window.clearTimeout(timer);
      if (cleanup) cleanup();
    };
  }, [open, onClose]);

  const uniqueSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of suggestions) {
      const v = (s || "").trim();
      if (!v) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }, [suggestions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return uniqueSuggestions
      .filter((s) => !q || s.toLowerCase().includes(q))
      .slice(0, 30);
  }, [uniqueSuggestions, query]);

  const showCreate =
    query.trim().length > 0 &&
    !uniqueSuggestions.some(
      (s) => s.toLowerCase() === query.trim().toLowerCase(),
    );

  if (!open || !anchor) return null;

  const commit = (v: string) => {
    const trimmed = v.trim();
    onCommit(trimmed ? trimmed : null);
    onClose();
  };

  const POPOVER_WIDTH = 280;
  const POPOVER_MAX_HEIGHT = 340;
  const pad = 10;
  const vw =
    typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh =
    typeof window === "undefined" ? 1024 : window.innerHeight;
  const left = Math.max(
    pad,
    Math.min(anchor.x + pad, vw - POPOVER_WIDTH - pad),
  );
  const top = Math.max(
    pad,
    Math.min(anchor.y + pad, vh - POPOVER_MAX_HEIGHT - pad),
  );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={title}
      style={{
        position: "fixed",
        left,
        top,
        width: POPOVER_WIDTH,
        zIndex: 100,
      }}
      className="rounded-md border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95"
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b">
        <span className="text-xs font-medium truncate">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-0.5 rounded hover:bg-muted"
        >
          <XIcon className="h-3 w-3" />
        </button>
      </div>
      <Command shouldFilter={false}>
        <CommandInput
          autoFocus
          placeholder={placeholder}
          value={query}
          onValueChange={setQuery}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(query);
            }
          }}
        />
        <CommandList className="max-h-52">
          {filtered.length === 0 && !showCreate && !currentValue && (
            <CommandEmpty>No previous values.</CommandEmpty>
          )}
          <CommandGroup>
            {currentValue && (
              <CommandItem
                onSelect={() => commit("")}
                className="text-xs text-muted-foreground"
              >
                Clear value
              </CommandItem>
            )}
            {filtered.map((s) => {
              const isCurrent =
                !!currentValue && s.toLowerCase() === currentValue.toLowerCase();
              return (
                <CommandItem key={s} onSelect={() => commit(s)}>
                  <span className="flex-1 truncate">{s}</span>
                  {isCurrent && (
                    <Check
                      className="h-3.5 w-3.5 text-primary shrink-0"
                      aria-label="Current value"
                    />
                  )}
                </CommandItem>
              );
            })}
            {showCreate && (
              <CommandItem onSelect={() => commit(query)}>
                <Plus className="h-3 w-3 mr-2" />
                Use &quot;{query.trim()}&quot;
              </CommandItem>
            )}
          </CommandGroup>
        </CommandList>
      </Command>
      <div className="border-t p-1.5 flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-destructive hover:text-destructive"
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete annotation
        </Button>
      </div>
    </div>
  );
}
