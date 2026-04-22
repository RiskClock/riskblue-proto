import { useState } from "react";
import { ChevronRight, ChevronDown, Folder, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SPFolder {
  id: string;
  name: string;
}

interface SPFile {
  id: string;
  name: string;
}

interface FolderTreeProps {
  folders: SPFolder[];
  files?: SPFile[];
  loadChildren: (folderId: string) => Promise<{ folders: SPFolder[]; files: SPFile[] }>;
  selectable?: boolean;
  selectedFolderId?: string;
  onSelectFolder?: (folderId: string, folderName: string) => void;
  hideFiles?: boolean;
  level?: number;
}

interface NodeProps extends FolderTreeProps {
  folder: SPFolder;
}

function FolderNode({
  folder, loadChildren, selectable, selectedFolderId, onSelectFolder, hideFiles, level = 0,
}: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [children, setChildren] = useState<{ folders: SPFolder[]; files: SPFile[] } | null>(null);

  const isSelected = selectedFolderId === folder.id;

  const handleToggle = async () => {
    if (!expanded && !children) {
      setLoading(true);
      try { setChildren(await loadChildren(folder.id)); }
      catch (e) { console.error("Failed to load folder:", e); }
      finally { setLoading(false); }
    }
    setExpanded(!expanded);
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 py-1 px-2 rounded cursor-pointer hover:bg-muted/60 text-sm",
          isSelected && "bg-primary/10 text-primary",
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        <button onClick={handleToggle} className="p-0.5 hover:bg-muted rounded">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" />
            : expanded ? <ChevronDown className="w-3 h-3" />
            : <ChevronRight className="w-3 h-3" />}
        </button>
        <button
          className="flex items-center gap-1.5 flex-1 text-left"
          onClick={() => selectable && onSelectFolder?.(folder.id, folder.name)}
        >
          <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="truncate">{folder.name}</span>
        </button>
      </div>
      {expanded && children && (
        <>
          {children.folders.map((f) => (
            <FolderNode
              key={f.id} folder={f}
              folders={[]} loadChildren={loadChildren}
              selectable={selectable} selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder} hideFiles={hideFiles}
              level={level + 1}
            />
          ))}
          {!hideFiles && children.files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-1.5 py-1 px-2 text-xs text-muted-foreground"
              style={{ paddingLeft: `${(level + 1) * 16 + 18}px` }}
            >
              <FileText className="w-3 h-3 shrink-0" />
              <span className="truncate">{file.name}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function SharePointFolderTree(props: FolderTreeProps) {
  const { folders, files = [], hideFiles, level = 0 } = props;
  return (
    <div>
      {folders.map((f) => <FolderNode key={f.id} folder={f} {...props} level={level} />)}
      {!hideFiles && files.map((file) => (
        <div
          key={file.id}
          className="flex items-center gap-1.5 py-1 px-2 text-xs text-muted-foreground"
          style={{ paddingLeft: `${level * 16 + 18}px` }}
        >
          <FileText className="w-3 h-3 shrink-0" />
          <span className="truncate">{file.name}</span>
        </div>
      ))}
    </div>
  );
}
