import { useState } from "react";
import { ChevronRight, FolderOpen, Loader2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface FolderNode {
  id: number;
  name: string;
}

interface FileNode {
  id: number;
  name: string;
}

interface SubfolderData {
  folders: FolderNode[];
  files: FileNode[];
  loaded: boolean;
}

interface ProcoreFolderTreeProps {
  folders: FolderNode[];
  loadSubfolder: (folderId: string) => Promise<{ folders?: FolderNode[]; files?: FileNode[] }>;
  selectable?: boolean;
  selectedFolderId?: string;
  onSelectFolder?: (folderId: string) => void;
  hideFiles?: boolean;
  depth?: number;
}

export const ProcoreFolderTree = ({
  folders,
  loadSubfolder,
  selectable = false,
  selectedFolderId,
  onSelectFolder,
  hideFiles = false,
  depth = 0,
}: ProcoreFolderTreeProps) => {
  const [expandedMap, setExpandedMap] = useState<Map<number, SubfolderData>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());

  const handleToggle = async (folder: FolderNode) => {
    const existing = expandedMap.get(folder.id);

    // If already loaded, just toggle
    if (existing?.loaded) {
      const next = new Map(expandedMap);
      next.delete(folder.id);
      setExpandedMap(next);
      return;
    }

    // Load subfolder contents
    setLoadingIds((prev) => new Set(prev).add(folder.id));
    try {
      const data = await loadSubfolder(String(folder.id));
      setExpandedMap((prev) => {
        const next = new Map(prev);
        next.set(folder.id, {
          folders: data.folders || [],
          files: data.files || [],
          loaded: true,
        });
        return next;
      });
    } catch (err) {
      console.error("Failed to load subfolder:", err);
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(folder.id);
        return next;
      });
    }
  };

  const handleSelect = (folder: FolderNode) => {
    onSelectFolder?.(String(folder.id));
  };

  return (
    <div className="space-y-0.5">
      {folders.map((folder) => {
        const isExpanded = expandedMap.has(folder.id);
        const isLoading = loadingIds.has(folder.id);
        const subData = expandedMap.get(folder.id);
        const isSelected = selectable && selectedFolderId === String(folder.id);

        return (
          <div key={folder.id}>
            <div
              className={cn(
                "flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-sm hover:bg-muted/50 transition-colors w-full min-w-0",
                isSelected && "bg-primary/10 ring-1 ring-primary/30"
              )}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              <button
                type="button"
                onClick={() => handleToggle(folder)}
                className="flex items-center justify-center w-4 h-4 shrink-0"
              >
                {isLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                ) : (
                  <ChevronRight
                    className={cn(
                      "w-3 h-3 text-muted-foreground transition-transform",
                      isExpanded && "rotate-90"
                    )}
                  />
                )}
              </button>
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span
                  className={cn("truncate min-w-0", selectable && "cursor-pointer")}
                  onClick={() => (selectable ? handleSelect(folder) : handleToggle(folder))}
                >
                  {folder.name}
                </span>
              </div>
              {selectable && (
                <button
                  type="button"
                  onClick={() => handleSelect(folder)}
                  className={cn(
                    "text-xs px-1.5 py-0.5 rounded shrink-0 ml-1",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {isSelected ? "Selected" : "Select"}
                </button>
              )}
            </div>

            {/* Expanded children */}
            {isExpanded && subData && (
              <div>
                {subData.folders.length > 0 && (
                  <ProcoreFolderTree
                    folders={subData.folders}
                    loadSubfolder={loadSubfolder}
                    selectable={selectable}
                    selectedFolderId={selectedFolderId}
                    onSelectFolder={onSelectFolder}
                    hideFiles={hideFiles}
                    depth={depth + 1}
                  />
                )}
                {!hideFiles && subData.files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-1.5 py-1 px-2 text-sm text-muted-foreground"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
                  >
                    <FileText className="w-3 h-3 shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </div>
                ))}
                {subData.folders.length === 0 && subData.files.length === 0 && (
                  <div
                    className="text-xs text-muted-foreground py-1 px-2 italic"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
                  >
                    Empty folder
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
