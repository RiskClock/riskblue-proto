import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Upload, X } from "lucide-react";

interface UploadReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFiles: File[];
  accept: string;
  uploading?: boolean;
  title?: string;
  description?: string;
  onConfirm: (selected: File[]) => void | Promise<void>;
}

interface ReviewItem {
  file: File;
  selected: boolean;
  key: string;
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fileKey = (f: File) => `${f.name}__${f.size}__${f.lastModified}`;

export function UploadReviewModal({
  open,
  onOpenChange,
  initialFiles,
  accept,
  uploading,
  title = "Review files to upload",
  description = "Uncheck any files you don't want to upload. You can also add more files or drag-and-drop them here.",
  onConfirm,
}: UploadReviewModalProps) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Seed/merge initialFiles when modal opens or new files are appended
  useEffect(() => {
    if (!open) return;
    setItems((prev) => {
      const map = new Map(prev.map((it) => [it.key, it]));
      for (const f of initialFiles) {
        const k = fileKey(f);
        if (!map.has(k)) {
          map.set(k, { file: f, selected: true, key: k });
        }
      }
      return Array.from(map.values());
    });
  }, [open, initialFiles]);

  // Reset on close
  useEffect(() => {
    if (!open) setItems([]);
  }, [open]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    setItems((prev) => {
      const map = new Map(prev.map((it) => [it.key, it]));
      for (const f of arr) {
        const k = fileKey(f);
        if (!map.has(k)) {
          map.set(k, { file: f, selected: true, key: k });
        }
      }
      return Array.from(map.values());
    });
  }, []);

  const toggle = (key: string) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, selected: !it.selected } : it)));

  const remove = (key: string) =>
    setItems((prev) => prev.filter((it) => it.key !== key));

  const allSelected = items.length > 0 && items.every((it) => it.selected);
  const someSelected = items.some((it) => it.selected) && !allSelected;
  const selectedCount = items.filter((it) => it.selected).length;

  const toggleAll = () =>
    setItems((prev) => prev.map((it) => ({ ...it, selected: !allSelected })));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const handleConfirm = async () => {
    const selected = items.filter((it) => it.selected).map((it) => it.file);
    await onConfirm(selected);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!uploading) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground -mt-2">{description}</p>

        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="upload-review-select-all"
              checked={allSelected}
              indeterminate={someSelected}
              onCheckedChange={toggleAll}
              disabled={items.length === 0 || uploading}
            />
            <label htmlFor="upload-review-select-all" className="text-sm text-foreground cursor-pointer select-none">
              {selectedCount} of {items.length} selected
            </label>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add more files
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-md transition-colors ${
            isDragging ? "border-primary bg-primary/5" : "border-border"
          }`}
        >
          {items.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              <Upload className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Drop files here or click "Add more files"
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y">
              {items.map((it) => (
                <li
                  key={it.key}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40"
                >
                  <Checkbox
                    checked={it.selected}
                    onCheckedChange={() => toggle(it.key)}
                    disabled={uploading}
                  />
                  <div className="flex-1 min-w-0 text-sm truncate">{it.file.name}</div>
                  <div className="text-xs text-muted-foreground shrink-0">{formatBytes(it.file.size)}</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => remove(it.key)}
                    disabled={uploading}
                    title="Remove from list"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={selectedCount === 0 || uploading}>
            {uploading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            {uploading ? "Uploading…" : `Upload ${selectedCount} file${selectedCount === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
