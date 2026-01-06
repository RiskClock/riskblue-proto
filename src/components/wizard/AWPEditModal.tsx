import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Trash2, Pencil, ChevronDown, FolderOpen, Paperclip, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { countByCategory } from "@/lib/analysisItemMapper";
import { supabase } from "@/integrations/supabase/client";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { AWPItemEditModal } from "./AWPItemEditModal";
import { RepositoryConnectionDialog } from "./RepositoryConnectionDialog";
import { InlineCombobox } from "./InlineCombobox";
import { useAWPOptions, isAssetName, isWaterSystemName, getCategoryForName } from "@/hooks/useAWPOptions";
import {
  generateNextId,
  sqftToSqm,
  sqmToSqft,
  inchesToMm,
  mmToInches,
} from "@/lib/awpIdGenerator";

// Bug 6: Use public folder paths for preloading
const googleDriveIcon = "/icons/icon_googledrive.png";
const procoreIcon = "/icons/icon_procore.png";

interface AWPEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysisItems: AnalysisItem[];
  onUpdateItems: (items: AnalysisItem[]) => void;
  projectId: string;
  projectName?: string;
  onBeforeOAuthRedirect?: () => Promise<void>;
  onFilesLoaded?: (files: any[], accessToken: string) => void;
  initialNewItems?: AnalysisItem[]; // Phase 5: Pre-populate from analysis results
}

type AreaUnit = "sqft" | "sqm";
type PipeUnit = "in" | "mm";

interface NewRowItem {
  tempId: string;
  name: string;
  areaName: string;
  floor: string;
  drawingCode: string;
  areaSqft: number | null;
  pipeDiameterInches: number | null;
  pipeDiameterMM: number | null;
  drawingFile: File | null; // Phase 3: Drawing upload
  drawingUrl: string | null; // Phase 3: Existing drawing URL
}

interface ChangesSummary {
  edited: { id: string; name: string; areaName?: string }[];
  removed: { id: string; name: string; areaName?: string }[];
  added: { name: string; areaName?: string }[];
}

// Create empty row helper
const createEmptyRow = (): NewRowItem => ({
  tempId: `NEW-${Date.now()}-${Math.random()}`,
  name: "",
  areaName: "",
  floor: "",
  drawingCode: "",
  areaSqft: null,
  pipeDiameterInches: null,
  pipeDiameterMM: null,
  drawingFile: null,
  drawingUrl: null,
});

// Convert AnalysisItem to NewRowItem for pre-population
const analysisItemToNewRow = (item: AnalysisItem): NewRowItem => ({
  tempId: `NEW-${Date.now()}-${Math.random()}-${item.id}`,
  name: item.name,
  areaName: item.areaName || "",
  floor: item.floor || "",
  drawingCode: item.drawingCode || "",
  areaSqft: item.areaSqft || null,
  pipeDiameterInches: (item.additionalParameters as any)?.pipeDiameterInches || null,
  pipeDiameterMM: (item.additionalParameters as any)?.pipeDiameterMM || null,
  drawingFile: null,
  drawingUrl: item.drawingUrl || null,
});

export const AWPEditModal = ({
  isOpen,
  onClose,
  analysisItems,
  onUpdateItems,
  projectId,
  projectName,
  onBeforeOAuthRedirect,
  onFilesLoaded,
  initialNewItems,
}: AWPEditModalProps) => {
  // Fetch AWP options from DB
  const { data: awpOptions = [] } = useAWPOptions();
  
  // Hidden file input refs for drawing uploads
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  // Original items for comparison
  const [originalItems, setOriginalItems] = useState<AnalysisItem[]>([]);
  
  // Existing items (left pane)
  const [existingItems, setExistingItems] = useState<AnalysisItem[]>([]);
  
  // Track deleted item IDs
  const [deletedItemIds, setDeletedItemIds] = useState<Set<string>>(new Set());
  
  // New items being added (right pane) - now as table rows
  const [newRows, setNewRows] = useState<NewRowItem[]>([createEmptyRow()]);
  
  // Edit modal state
  const [editingItem, setEditingItem] = useState<AnalysisItem | null>(null);
  
  // Save confirmation state
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [changesSummary, setChangesSummary] = useState<ChangesSummary | null>(null);
  
  // Issue 15: Discard confirmation state
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  
  // Units for new rows
  const [areaUnit, setAreaUnit] = useState<AreaUnit>("sqft");
  const [pipeUnit, setPipeUnit] = useState<PipeUnit>("in");
  
  // Repository connection dialog
  const [showRepositoryDialog, setShowRepositoryDialog] = useState(false);
  const [repositoryType, setRepositoryType] = useState<"google-drive" | "procore" | null>(null);
  
  // Phase 5: Analysis state
  const [analyzingFiles, setAnalyzingFiles] = useState(false);
  const { toast } = useToast();

  // Preload icons from public folder
  useLayoutEffect(() => {
    const img1 = new Image();
    img1.src = "/icons/icon_googledrive.png";
    const img2 = new Image();
    img2.src = "/icons/icon_procore.png";
  }, []);

  // Initialize/reset ALL state when modal opens
  useEffect(() => {
    if (isOpen) {
      // Deep copy each item to prevent reference equality issues
      const deepCopyItems = analysisItems.map(item => JSON.parse(JSON.stringify(item)));
      setOriginalItems(deepCopyItems);
      setExistingItems(analysisItems.map(item => JSON.parse(JSON.stringify(item))));
      setDeletedItemIds(new Set());
      
      // Phase 5: Pre-populate with initialNewItems if provided
      if (initialNewItems && initialNewItems.length > 0) {
        const prePopulatedRows = initialNewItems.map(item => analysisItemToNewRow(item));
        setNewRows([...prePopulatedRows, createEmptyRow()]);
      } else {
        setNewRows([createEmptyRow()]); // Fresh default row
      }
      
      setChangesSummary(null);
      setShowSaveConfirmation(false);
      setShowDiscardConfirm(false);
      setEditingItem(null);
      setAreaUnit("sqft");
      setPipeUnit("in");
    }
  }, [isOpen, analysisItems, initialNewItems]);

  // Visible existing items (excluding deleted)
  const visibleExistingItems = useMemo(() => 
    existingItems.filter(item => !deletedItemIds.has(item.id)), [existingItems, deletedItemIds]);

  // Check if any item needs Size or Pipe column
  const hasAssets = useMemo(() => 
    visibleExistingItems.some(item => isAssetName(awpOptions, item.name)) || newRows.some(row => isAssetName(awpOptions, row.name)), 
    [visibleExistingItems, newRows, awpOptions]);
  const hasWaterSystems = useMemo(() => 
    visibleExistingItems.some(item => isWaterSystemName(awpOptions, item.name)) || newRows.some(row => isWaterSystemName(awpOptions, row.name)), 
    [visibleExistingItems, newRows, awpOptions]);

  // All class options for combobox - from DB
  const allClassOptions = useMemo(() => 
    awpOptions.map(opt => ({ value: opt.name, category: opt.category })),
    [awpOptions]);

  // Issue 24: Fix hasUnsavedChanges to not trigger on empty default row
  const hasUnsavedChanges = useMemo(() => {
    // Check for edits to existing items
    const hasEdits = existingItems.some((current) => {
      const original = originalItems.find(o => o.id === current.id);
      return original && JSON.stringify(current) !== JSON.stringify(original);
    });
    
    // Check for deletions
    const hasDeletions = deletedItemIds.size > 0;
    
    // Check for additions - only count rows with a type selected (row.name is the class type)
    const hasAdditions = newRows.some(row => row.name.trim() !== '');
    
    return hasEdits || hasDeletions || hasAdditions;
  }, [existingItems, originalItems, deletedItemIds, newRows]);

  // Add new row
  const handleAddRow = useCallback(() => {
    const newRow = createEmptyRow();
    setNewRows(prev => [...prev, newRow]);
  }, []);

  // Update a new row field
  const updateNewRow = useCallback((tempId: string, field: keyof NewRowItem, value: any) => {
    setNewRows(prev => prev.map(row => {
      if (row.tempId !== tempId) return row;
      return { ...row, [field]: value };
    }));
  }, []);

  // Delete a new row
  const deleteNewRow = useCallback((tempId: string) => {
    setNewRows(prev => {
      const filtered = prev.filter(row => row.tempId !== tempId);
      // Always keep at least one row
      return filtered.length === 0 ? [createEmptyRow()] : filtered;
    });
  }, []);

  // Handle edit item save
  const handleEditSave = useCallback((updatedItem: AnalysisItem) => {
    setExistingItems(prev => prev.map(item => 
      item.id === editingItem?.id ? updatedItem : item
    ));
    setEditingItem(null);
  }, [editingItem]);

  // Handle delete (mark for deletion without confirmation)
  const handleDelete = useCallback((itemId: string) => {
    setDeletedItemIds(prev => new Set([...prev, itemId]));
  }, []);

  // Handle area change for new row
  const handleNewRowAreaChange = useCallback((tempId: string, value: string) => {
    const numValue = parseFloat(value) || null;
    if (areaUnit === "sqft") {
      updateNewRow(tempId, "areaSqft", numValue);
    } else {
      updateNewRow(tempId, "areaSqft", numValue ? sqmToSqft(numValue) : null);
    }
  }, [areaUnit, updateNewRow]);

  // Handle pipe diameter change for new row
  const handleNewRowPipeChange = useCallback((tempId: string, value: string) => {
    const numValue = parseFloat(value) || null;
    if (pipeUnit === "in") {
      updateNewRow(tempId, "pipeDiameterInches", numValue);
      updateNewRow(tempId, "pipeDiameterMM", numValue ? inchesToMm(numValue) : null);
    } else {
      updateNewRow(tempId, "pipeDiameterMM", numValue);
      updateNewRow(tempId, "pipeDiameterInches", numValue ? mmToInches(numValue) : null);
    }
  }, [pipeUnit, updateNewRow]);

  // Get displayed value for new row area
  const getNewRowAreaDisplay = useCallback((row: NewRowItem) => {
    if (!row.areaSqft) return "";
    return areaUnit === "sqft" ? row.areaSqft : sqftToSqm(row.areaSqft);
  }, [areaUnit]);

  // Get displayed value for new row pipe
  const getNewRowPipeDisplay = useCallback((row: NewRowItem) => {
    if (pipeUnit === "in") {
      return row.pipeDiameterInches || "";
    }
    return row.pipeDiameterMM || "";
  }, [pipeUnit]);

  // Calculate changes summary
  const calculateChanges = useCallback((): ChangesSummary => {
    const edited: ChangesSummary["edited"] = [];
    const removed: ChangesSummary["removed"] = [];
    const added: ChangesSummary["added"] = [];

    // Find edited items
    existingItems.forEach(current => {
      if (deletedItemIds.has(current.id)) return;
      const original = originalItems.find(o => o.id === current.id);
      if (original) {
        const hasChanges = JSON.stringify(current) !== JSON.stringify(original);
        if (hasChanges) {
          edited.push({ id: current.id, name: current.name, areaName: current.areaName });
        }
      }
    });

    // Find removed items
    deletedItemIds.forEach(id => {
      const original = originalItems.find(o => o.id === id);
      if (original) {
        removed.push({ id: original.id, name: original.name, areaName: original.areaName });
      }
    });

    // Find added items
    newRows.filter(row => row.name).forEach(row => {
      added.push({ name: row.name, areaName: row.areaName });
    });

    return { edited, removed, added };
  }, [existingItems, originalItems, deletedItemIds, newRows]);

  // Issue 15: Handle close with unsaved changes check
  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      setChangesSummary(calculateChanges());
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [hasUnsavedChanges, calculateChanges, onClose]);

  // Handle save click - show confirmation if there are changes
  const handleSaveClick = useCallback(() => {
    const changes = calculateChanges();
    const hasChanges = changes.edited.length > 0 || changes.removed.length > 0 || changes.added.length > 0;
    
    if (hasChanges) {
      setChangesSummary(changes);
      setShowSaveConfirmation(true);
    } else {
      onClose();
    }
  }, [calculateChanges, onClose]);

  // Phase 3: Handle drawing file selection
  const handleDrawingFileChange = useCallback((tempId: string, file: File | null) => {
    updateNewRow(tempId, "drawingFile", file);
    if (file) {
      updateNewRow(tempId, "drawingUrl", null); // Clear URL when new file selected
    }
  }, [updateNewRow]);

  // Phase 3: Remove drawing from row
  const handleRemoveDrawing = useCallback((tempId: string) => {
    updateNewRow(tempId, "drawingFile", null);
    updateNewRow(tempId, "drawingUrl", null);
  }, [updateNewRow]);

  // Issue 22: Confirm save - generate IDs incrementally to avoid duplicates
  // Phase 3: Upload drawings to storage
  // Phase 5: Auto-assign default controls based on class name
  const handleConfirmSave = useCallback(async () => {
    // Filter out deleted items
    const remainingItems = existingItems.filter(item => !deletedItemIds.has(item.id));
    
    // Convert new rows to AnalysisItems - accumulate items for proper ID generation
    const allCurrentItems = [...remainingItems];
    const newItems: AnalysisItem[] = [];
    
    // Fetch control mappings for auto-assignment
    const { fetchControlMappings } = await import("@/lib/controlAutoAssignment");
    const { byName: controlMappings } = await fetchControlMappings();
    
    // Phase 3: Upload drawings and collect URLs
    const rowsWithDrawings = newRows.filter(row => row.name && row.drawingFile);
    const uploadPromises = rowsWithDrawings.map(async (row) => {
      const file = row.drawingFile!;
      const fileName = `${projectId}/${Date.now()}-${file.name}`;
      const { data, error } = await supabase.storage
        .from('awp-drawings')
        .upload(fileName, file);
      
      if (error) {
        console.error('Error uploading drawing:', error);
        return { tempId: row.tempId, url: null };
      }
      
      const { data: urlData } = supabase.storage
        .from('awp-drawings')
        .getPublicUrl(data.path);
      
      return { tempId: row.tempId, url: urlData.publicUrl };
    });
    
    const uploadResults = await Promise.all(uploadPromises);
    const drawingUrlMap = new Map(uploadResults.map(r => [r.tempId, r.url]));
    
    for (const row of newRows.filter(row => row.name)) {
      const category = getCategoryForName(awpOptions, row.name);
      // Issue 22: Pass accumulated items so each new item gets incrementing ID
      const id = generateNextId(row.name, allCurrentItems);
      
      // Phase 5: Get default controls for this class
      const defaultControls = controlMappings.get(row.name) || [];
      
      // Phase 3: Get drawing URL (uploaded or existing)
      const drawingUrl = drawingUrlMap.get(row.tempId) || row.drawingUrl || undefined;
      
      const newItem: AnalysisItem = {
        id,
        name: row.name,
        category: category || "Asset",
        areaName: row.areaName || undefined,
        floor: row.floor || undefined,
        drawingCode: row.drawingCode || undefined,
        fileName: undefined,
        areaSqft: row.areaSqft || undefined,
        width: undefined,
        length: undefined,
        sizeCategory: undefined,
        coordinates: undefined,
        controls: defaultControls, // Auto-assigned default controls
        drawingUrl, // Phase 3: Drawing URL
        additionalParameters: row.pipeDiameterInches ? {
          pipeDiameterInches: row.pipeDiameterInches,
          pipeDiameterMM: row.pipeDiameterMM,
        } : undefined,
      };
      
      // Add to accumulated list for next ID generation
      allCurrentItems.push(newItem);
      newItems.push(newItem);
    }

    const allItems = [...remainingItems, ...newItems];
    onUpdateItems(allItems);
    setShowSaveConfirmation(false);
    onClose();
  }, [existingItems, deletedItemIds, newRows, onUpdateItems, onClose, projectId]);

  // Get size display for existing item
  const getItemSizeDisplay = (item: AnalysisItem) => {
    const sqft = item.areaSqft || (item as any)?.area_sqft;
    return sqft ? `${Math.round(sqft)} ft²` : "-";
  };

  // Get pipe display for existing item
  const getItemPipeDisplay = (item: AnalysisItem) => {
    const params = item.additionalParameters as any;
    if (params?.pipeDiameterInches) {
      return `${params.pipeDiameterInches}"`;
    }
    return "-";
  };

  // Phase 5: Handle repository files loaded - trigger analysis and populate Add New Items pane
  const handleRepositoryFilesLoaded = useCallback(async (files: any[], accessToken: string) => {
    setShowRepositoryDialog(false);
    setRepositoryType(null);
    
    // Pass files to parent for state sync
    if (onFilesLoaded) {
      onFilesLoaded(files, accessToken);
    }
    
    // Validate project is saved before analysis
    if (!projectId || projectId === "new") {
      toast({
        title: "Save Project First",
        description: "Please save the project before running analysis. Enter a project name and save.",
        variant: "destructive",
      });
      return;
    }
    
    if (files.length === 0) {
      toast({
        title: "No Files",
        description: "No files found in the folder.",
      });
      return;
    }
    
    // Start analysis
    setAnalyzingFiles(true);
    
    try {
      // Get or create file search store ID
      const { data: projectData } = await supabase
        .from("projects")
        .select("filesearch_store_id")
        .eq("id", projectId)
        .single();
      
      let fileSearchStoreId = projectData?.filesearch_store_id;
      
      if (!fileSearchStoreId) {
        const storeResponse = await supabase.functions.invoke("create-filesearch-store", {
          body: { projectId },
        });
        if (storeResponse.data?.storeId) {
          fileSearchStoreId = storeResponse.data.storeId;
          await supabase
            .from("projects")
            .update({ filesearch_store_id: fileSearchStoreId })
            .eq("id", projectId);
        }
      }
      
      // Invoke analysis edge function
      const response = await supabase.functions.invoke("analyze-drive-files", {
        body: {
          files,
          accessToken,
          filesearch_store_id: fileSearchStoreId,
        },
      });
      
      if (response.error) {
        throw new Error(response.error.message);
      }
      
      const data = response.data;
      if (data.error) {
        throw new Error(data.error);
      }
      
      // Parse results - handle both response formats
      const assetsWaterSystemsProcesses: AnalysisItem[] = Array.isArray(data.analysis)
        ? data.analysis
        : (data.assets_water_systems_processes || []);
      
      if (assetsWaterSystemsProcesses.length === 0) {
        toast({
          title: "No Items Found",
          description: "The analysis did not detect any assets, water systems, or processes in the files.",
        });
        return;
      }
      
      // Convert to NewRowItem and add to the Add New Items pane
      const newRowItems = assetsWaterSystemsProcesses.map(item => analysisItemToNewRow(item));
      setNewRows(prev => {
        // Remove empty default row if present, then add new items + fresh empty row
        const nonEmpty = prev.filter(row => row.name.trim() !== "");
        return [...nonEmpty, ...newRowItems, createEmptyRow()];
      });
      
      const counts = countByCategory(assetsWaterSystemsProcesses);
      toast({
        title: "Analysis Complete",
        description: `Found ${counts.assets} assets, ${counts.waterSystems} water systems, ${counts.processes} processes. Review and save to confirm.`,
      });
    } catch (error) {
      console.error("Analysis error:", error);
      toast({
        title: "Analysis Error",
        description: error instanceof Error ? error.message : "Failed to analyze files",
        variant: "destructive",
      });
    } finally {
      setAnalyzingFiles(false);
    }
  }, [onFilesLoaded, projectId, toast]);

  // Determine column count for colSpan
  const getColSpan = () => {
    let cols = 5; // Name, Type, ID, Floor, Actions
    if (hasAssets) cols++;
    if (hasWaterSystems) cols++;
    return cols;
  };

  // Issue 17: Get column span for right pane
  const getRightColSpan = () => {
    let cols = 4; // Name, Type, Floor, Actions
    if (hasAssets) cols++;
    if (hasWaterSystems) cols++;
    return cols;
  };

  return (
    <>
      {/* Issue 15: Use handleClose for onOpenChange */}
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        {/* Issue 13: Increased modal width to 95vw */}
        <DialogContent className="max-w-[95vw] w-full h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Assets, Water Systems, and Processes List</DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 flex gap-4 overflow-hidden">
            {/* Left Pane - Existing Items Table - Issue 25: table-fixed for stable widths */}
            <div className="w-3/5 flex flex-col border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted/50 text-sm font-medium">
                Existing Items ({visibleExistingItems.length})
              </div>
              <div className="flex-1 overflow-auto">
                <Table className="table-fixed">
                  {/* Issue 25: Fixed column widths with min-w for stability */}
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-[130px] min-w-[130px] py-2 text-xs">Name</TableHead>
                      <TableHead className="w-[200px] min-w-[200px] py-2 text-xs">Type</TableHead>
                      <TableHead className="w-[90px] min-w-[90px] py-2 text-xs">ID</TableHead>
                      <TableHead className="w-[60px] min-w-[60px] py-2 text-xs">Floor</TableHead>
                      {hasAssets && <TableHead className="w-[80px] min-w-[80px] py-2 text-xs">Size</TableHead>}
                      {hasWaterSystems && <TableHead className="w-[70px] min-w-[70px] py-2 text-xs">Pipe Ø</TableHead>}
                      <TableHead className="w-[80px] min-w-[80px] py-2 text-xs">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Issue 25: Fixed column widths with min-w for stability */}
                    {visibleExistingItems.map((item) => (
                      <TableRow key={item.id} className="h-8">
                        <TableCell className="py-1 px-2 w-[130px] min-w-[130px]">
                          <span className="text-xs truncate block" title={item.areaName}>
                            {item.areaName || "-"}
                          </span>
                        </TableCell>
                        <TableCell className="py-1 px-2 w-[200px] min-w-[200px]">
                          <span className="text-xs truncate block" title={item.name}>
                            {item.name}
                          </span>
                        </TableCell>
                        <TableCell className="py-1 px-2 font-mono text-xs w-[90px] min-w-[90px]">{item.id}</TableCell>
                        <TableCell className="py-1 px-2 text-xs w-[60px] min-w-[60px]">{item.floor || "-"}</TableCell>
                        {hasAssets && (
                          <TableCell className="py-1 px-2 text-xs w-[80px] min-w-[80px]">
                            {isAssetName(awpOptions, item.name) ? getItemSizeDisplay(item) : "-"}
                          </TableCell>
                        )}
                        {hasWaterSystems && (
                          <TableCell className="py-1 px-2 text-xs w-[70px] min-w-[70px]">
                            {isWaterSystemName(awpOptions, item.name) ? getItemPipeDisplay(item) : "-"}
                          </TableCell>
                        )}
                        <TableCell className="py-1 px-2 w-[80px]">
                          <div className="flex gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setEditingItem(item)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(item.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {visibleExistingItems.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={getColSpan()} className="text-center py-8 text-muted-foreground text-xs">
                          No existing items
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Right Pane - Add New Items - Issue 25: table-fixed for stable widths */}
            <div className="w-2/5 flex flex-col border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted/50 text-sm font-medium">
                Add New Items
              </div>
              
              <div className="flex-1 overflow-auto">
                <Table className="table-fixed">
                  {/* Issue 17: Reordered columns - Issue 25: Fixed widths with min-w */}
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-[100px] min-w-[100px] py-2 text-xs">Name</TableHead>
                      <TableHead className="w-[130px] min-w-[130px] py-2 text-xs">Type</TableHead>
                      <TableHead className="w-[40px] min-w-[40px] py-2 text-xs">Fl</TableHead>
                      <TableHead className="w-[50px] min-w-[50px] py-2 text-xs">Drawing</TableHead>
                      {hasAssets && <TableHead className="w-[60px] min-w-[60px] py-2 text-xs">Size</TableHead>}
                      {hasWaterSystems && <TableHead className="w-[50px] min-w-[50px] py-2 text-xs">Pipe</TableHead>}
                      <TableHead className="w-[36px] min-w-[36px] py-2 text-xs"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {newRows.map((row) => {
                      const isAsset = row.name ? isAssetName(awpOptions, row.name) : false;
                      const isWaterSystem = row.name ? isWaterSystemName(awpOptions, row.name) : false;
                      
                      return (
                        <TableRow key={row.tempId} className="h-8">
                          {/* Issue 17: Name column first - Issue 25: fixed width with min-w */}
                          <TableCell className="py-1 px-1 w-[100px] min-w-[100px]">
                            <Input
                              className="h-6 text-xs px-2"
                              placeholder="Name"
                              value={row.areaName}
                              onChange={(e) => updateNewRow(row.tempId, "areaName", e.target.value)}
                            />
                          </TableCell>
                          
                          {/* Type field using InlineCombobox with portal */}
                          <TableCell className="py-1 px-1 w-[150px] min-w-[150px]">
                            <InlineCombobox
                              value={row.name}
                              options={allClassOptions}
                              onChange={(val) => updateNewRow(row.tempId, "name", val)}
                              placeholder="Type to search..."
                            />
                          </TableCell>
                          
                          {/* Floor */}
                          <TableCell className="py-1 px-1 w-[40px] min-w-[40px]">
                            <Input
                              className="h-6 text-xs px-1"
                              placeholder="Fl"
                              value={row.floor}
                              onChange={(e) => updateNewRow(row.tempId, "floor", e.target.value)}
                            />
                          </TableCell>
                          
                          {/* Phase 3: Drawing upload */}
                          <TableCell className="py-1 px-1 w-[50px] min-w-[50px]">
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png"
                              className="hidden"
                              ref={(el) => { if (el) fileInputRefs.current.set(row.tempId, el); }}
                              onChange={(e) => handleDrawingFileChange(row.tempId, e.target.files?.[0] || null)}
                            />
                            {row.drawingFile || row.drawingUrl ? (
                              <div className="flex items-center gap-0.5">
                                <Paperclip className="h-3 w-3 text-green-600" />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-4 w-4 p-0"
                                  onClick={() => handleRemoveDrawing(row.tempId)}
                                >
                                  <X className="h-2.5 w-2.5 text-muted-foreground" />
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => fileInputRefs.current.get(row.tempId)?.click()}
                              >
                                <Paperclip className="h-3 w-3 text-muted-foreground" />
                              </Button>
                            )}
                          </TableCell>
                          
                          {/* Size (Assets) - Issue 25: fixed width with min-w */}
                          {hasAssets && (
                            <TableCell className="py-1 px-1 w-[70px] min-w-[70px]">
                              {isAsset ? (
                                <Input
                                  type="number"
                                  className="h-6 text-xs px-2"
                                  placeholder="ft²"
                                  value={getNewRowAreaDisplay(row)}
                                  onChange={(e) => handleNewRowAreaChange(row.tempId, e.target.value)}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                          )}
                          
                          {/* Pipe Diameter (Water Systems) - Issue 25: fixed width with min-w */}
                          {hasWaterSystems && (
                            <TableCell className="py-1 px-1 w-[60px] min-w-[60px]">
                              {isWaterSystem ? (
                                <Input
                                  type="number"
                                  className="h-6 text-xs px-2"
                                  placeholder="in"
                                  value={getNewRowPipeDisplay(row)}
                                  onChange={(e) => handleNewRowPipeChange(row.tempId, e.target.value)}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                          )}
                          
                          {/* Delete - Issue 25: fixed width with min-w */}
                          <TableCell className="py-1 px-1 w-[40px] min-w-[40px]">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              onClick={() => deleteNewRow(row.tempId)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                
                {/* Issue 12: Removed border-t from Add Row button */}
                <div className="p-2">
                  <Button onClick={handleAddRow} size="sm" variant="outline" className="w-full">
                    <Plus className="w-3 h-3 mr-1" /> Add Row
                  </Button>
                </div>
              </div>
              
              {/* Docked Analyze Drawing Files section */}
              <div className="p-3 border-t bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {analyzingFiles ? "Analyzing files..." : "Analyze Drawing Files"}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1" disabled={analyzingFiles}>
                        {analyzingFiles ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FolderOpen className="w-3.5 h-3.5" />
                        )}
                        {analyzingFiles ? "Analyzing..." : "Connect Repository"}
                        <ChevronDown className="w-3 h-3 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem 
                        onClick={() => {
                          setRepositoryType("google-drive");
                          setShowRepositoryDialog(true);
                        }}
                        className="gap-2"
                      >
                        <img src={googleDriveIcon} alt="" className="w-4 h-4" />
                        Google Drive
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        disabled
                        className="gap-2 opacity-50"
                      >
                        <img src={procoreIcon} alt="" className="w-4 h-4" />
                        <span>Procore</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">Coming Soon</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </div>

          {/* Footer - Issue 15: Use handleClose instead of onClose */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSaveClick}>
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Item Modal */}
      {editingItem && (
        <AWPItemEditModal
          isOpen={!!editingItem}
          onClose={() => setEditingItem(null)}
          item={editingItem}
          allItems={existingItems}
          onSave={handleEditSave}
        />
      )}

      {/* Repository Connection Dialog */}
      {repositoryType === "google-drive" && (
        <RepositoryConnectionDialog
          isOpen={showRepositoryDialog}
          onClose={() => {
            setShowRepositoryDialog(false);
            setRepositoryType(null);
          }}
          projectId={projectId}
          projectName={projectName}
          onFilesLoaded={handleRepositoryFilesLoaded}
          onBeforeOAuthRedirect={onBeforeOAuthRedirect}
        />
      )}

      {/* Issue 15: Discard Confirmation Dialog */}
      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Changes?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>You have unsaved changes. Are you sure you want to discard them?</p>
                
                {changesSummary?.edited.length ? (
                  <div>
                    <span className="font-medium text-foreground">Pending edits ({changesSummary.edited.length}):</span>
                    <ul className="list-disc list-inside mt-1 text-muted-foreground">
                      {changesSummary.edited.map((item, i) => (
                        <li key={i} className="truncate">{item.areaName || item.name} ({item.id})</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {changesSummary?.removed.length ? (
                  <div>
                    <span className="font-medium text-destructive">Pending removals ({changesSummary.removed.length}):</span>
                    <ul className="list-disc list-inside mt-1 text-muted-foreground">
                      {changesSummary.removed.map((item, i) => (
                        <li key={i} className="truncate">{item.areaName || item.name} ({item.id})</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {changesSummary?.added.length ? (
                  <div>
                    <span className="font-medium text-green-600">Pending additions ({changesSummary.added.length}):</span>
                    <ul className="list-disc list-inside mt-1 text-muted-foreground">
                      {changesSummary.added.map((item, i) => (
                        <li key={i} className="truncate">{item.areaName || item.name}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setShowDiscardConfirm(false); onClose(); }}>
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save Confirmation Dialog */}
      <AlertDialog open={showSaveConfirmation} onOpenChange={setShowSaveConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Changes</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                {changesSummary?.edited.length ? (
                  <div>
                    <span className="font-medium text-foreground">Edited ({changesSummary.edited.length}):</span>
                    <ul className="list-disc list-inside mt-1 text-muted-foreground">
                      {changesSummary.edited.map((item, i) => (
                        <li key={i} className="truncate">{item.areaName || item.name} ({item.id})</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {changesSummary?.removed.length ? (
                  <div>
                    <span className="font-medium text-destructive">Removed ({changesSummary.removed.length}):</span>
                    <ul className="list-disc list-inside mt-1 text-muted-foreground">
                      {changesSummary.removed.map((item, i) => (
                        <li key={i} className="truncate">{item.areaName || item.name} ({item.id})</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {changesSummary?.added.length ? (
                  <div>
                    <span className="font-medium text-green-600">Added ({changesSummary.added.length}):</span>
                    <ul className="list-disc list-inside mt-1 text-muted-foreground">
                      {changesSummary.added.map((item, i) => (
                        <li key={i} className="truncate">{item.areaName || item.name}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSave}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
