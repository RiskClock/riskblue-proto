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

export interface AnnotationMetadataField {
  key: string;
  label: string;
  placeholder?: string;
  currentValue: string | null;
  suggestions: string[];
}

export interface AnnotationMetadataPopoverProps {
  open: boolean;
  /** Anchor point in viewport (client) coordinates. */
  anchor: { x: number; y: number } | null;
  /** Small header label, e.g. "DCW-001 attributes". */
  title: string;
  /** One entry per metadata attribute (e.g. pipe size, type). */
  fields: AnnotationMetadataField[];
  onCommit: (key: string, next: string | null) => void | Promise<void>;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Lightweight floating popover for capturing per-annotation metadata.
 * Supports one or more free-text attributes (e.g. pipe size, type) with
 * suggestion lists sourced from previously-used values.
 */
export function AnnotationMetadataPopover({
  open,
  anchor,
  title,
  fields,
  onCommit,
  onDelete,
  onClose,
}: AnnotationMetadataPopoverProps) {
  const [activeKey, setActiveKey] = useState<string>(fields[0]?.key ?? "");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setActiveKey(fields[0]?.key ?? "");
  }, [open, fields]);

  useEffect(() => {
    if (!open) return;
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

  if (!open || !anchor || fields.length === 0) return null;

  const POPOVER_WIDTH = 280;
  const POPOVER_MAX_HEIGHT = 380;
  const pad = 10;
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 1024 : window.innerHeight;
  const left = Math.max(
    pad,
    Math.min(anchor.x + pad, vw - POPOVER_WIDTH - pad),
  );
  const top = Math.max(
    pad,
    Math.min(anchor.y + pad, vh - POPOVER_MAX_HEIGHT - pad),
  );

  const activeField =
    fields.find((f) => f.key === activeKey) ?? fields[0];

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
      {fields.length > 1 && (
        <div className="flex border-b bg-muted/40">
          {fields.map((f) => {
            const isActive = f.key === activeField.key;
            const hasValue = !!(f.currentValue && f.currentValue.trim());
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setActiveKey(f.key)}
                className={
                  "flex-1 px-2 py-1.5 text-[11px] font-medium border-r last:border-r-0 transition-colors " +
                  (isActive
                    ? "bg-background text-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted")
                }
              >
                <span className="truncate">{f.label}</span>
                {hasValue && (
                  <span className="ml-1 text-primary" aria-hidden>•</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <FieldSection
        key={activeField.key}
        field={activeField}
        onCommit={(next) => onCommit(activeField.key, next)}
      />
      <div className="border-t p-1.5 flex justify-start">
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

interface FieldSectionProps {
  field: AnnotationMetadataField;
  onCommit: (next: string | null) => void;
}

function FieldSection({ field, onCommit }: FieldSectionProps) {
  const [query, setQuery] = useState<string>("");
  useEffect(() => {
    setQuery("");
  }, [field.key]);

  const uniqueSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of field.suggestions) {
      const v = (s || "").trim();
      if (!v) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }, [field.suggestions]);

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

  const commit = (v: string) => {
    const trimmed = v.trim();
    onCommit(trimmed ? trimmed : null);
  };

  return (
    <Command shouldFilter={false}>
      <CommandInput
        autoFocus
        placeholder={field.placeholder ?? field.label}
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
        {filtered.length === 0 && !showCreate && !field.currentValue && (
          <CommandEmpty>No previous values.</CommandEmpty>
        )}
        <CommandGroup>
          {field.currentValue && (
            <CommandItem
              onSelect={() => commit("")}
              className="text-xs text-muted-foreground"
            >
              Clear value
            </CommandItem>
          )}
          {filtered.map((s) => {
            const isCurrent =
              !!field.currentValue &&
              s.toLowerCase() === field.currentValue.toLowerCase();
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
  );
}
