import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ProjectProvider, useProject } from "@/contexts/ProjectContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProjectInfoStep } from "@/components/wizard/ProjectInfoStep";
import { ProjectMilestonesStep } from "@/components/wizard/ProjectMilestonesStep";
import { ConstructionDetailsStep } from "@/components/wizard/ConstructionDetailsStep";
import { CriticalAssetsStep } from "@/components/wizard/CriticalAssetsStep";
import { WaterSystemsStep } from "@/components/wizard/WaterSystemsStep";

import { ProcessesStep } from "@/components/wizard/ProcessesStep";
import { AWPEditModal } from "@/components/wizard/AWPEditModal";
import { MitigationResponsePlanStep } from "@/components/wizard/MitigationResponsePlanStep";
import { WaterMitigationGuidelinesStep } from "@/components/wizard/WaterMitigationGuidelinesStep";
import { CollaboratorManagementStep } from "@/components/wizard/CollaboratorManagementStep";
import { CollaboratorsModal } from "@/components/wizard/CollaboratorsModal";
import { RiskToleranceSelector, RiskTolerance } from "@/components/wizard/RiskToleranceSelector";
import { ProposalsStep } from "@/components/wizard/ProposalsStep";
import { ImplementationScheduleStep } from "@/components/wizard/ImplementationScheduleStep";
import { ProjectFilesUpload, DriveFileInfo } from "@/components/wizard/ProjectFilesUpload";
import { ResponsePlanUploadChat } from "@/components/ResponsePlanUploadChat";
import { Download, LogOut, FileText, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ProviderSelectionDialog } from "@/components/ProviderSelectionDialog";
import { Label } from "@/components/ui/label";
import { WaterRiskReport } from "@/components/reports/WaterRiskReport";
import { generateReportFilename } from "@/lib/reportGenerator";
import { useProjectRole } from "@/hooks/useProjectRole";
import { 
  AnalysisItem, 
  extractSelectedAssets, 
  extractSelectedSystems,
  mapToAssetName,
  mapToWaterSystemName,
  mapToProcessName,
  groupByCategory
} from "@/lib/analysisItemMapper";
import { PricingTier, calculateTieredControlCost, getSizeCategory, parseDurationMonths } from "@/lib/costCalculator";
import { calculateCriticalAssetDuration, calculateWaterSystemDuration } from "@/lib/durationCalculator";

interface ProjectData {
  [key: string]: any;
}

// Inner component that uses the ProjectContext
const ProjectWizardContent = () => {
  const { id } = useParams();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const { 
    projectData, 
    setProjectData, 
    updateField, 
    updateFields,
    isSaving, 
    hasPendingChanges,
    flush,
    isNewProject 
  } = useProject();
  
  // Check user's role for this project
  const { isAdmin, loading: roleLoading } = useProjectRole(id);
  
  const [activeTab, setActiveTab] = useState("guideline");
  const [loading, setLoading] = useState(false);
  const [isProcessingWebhook, setIsProcessingWebhook] = useState(false);
  const [isSavingNewProject, setIsSavingNewProject] = useState(false);
  const isWebhookCreatingProject = useRef(false);
  const justRestoredFromCache = useRef(false);
  const [showProviderDialog, setShowProviderDialog] = useState(false);
  const [showGuidelinesDialog, setShowGuidelinesDialog] = useState(false);
  const [showCollaboratorsModal, setShowCollaboratorsModal] = useState(false);
  const [analysisItems, setAnalysisItems] = useState<AnalysisItem[]>([]);
  
  // Lifted Google Drive state (shared between ProjectFilesUpload and MitigationControlsStep)
  const [driveFiles, setDriveFiles] = useState<DriveFileInfo[]>([]);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [driveConnected, setDriveConnected] = useState(false);
  
  // Risk tolerance state (shared across all AWP sections) - default to "high" (Essential package)
  const [riskTolerance, setRiskTolerance] = useState<RiskTolerance>(
    (projectData.riskTolerance as RiskTolerance) || "high"
  );
  
  // Track if user has manually overridden control selections
  const [hasManualOverride, setHasManualOverride] = useState(false);
  
  // AWP Edit Modal state - Bug 2: key forces remount for proper reset
  const [showAWPEditModal, setShowAWPEditModal] = useState(false);
  const [awpModalKey, setAwpModalKey] = useState(0);

  // Normalize asset name for counting (must match CriticalAssetsStep logic)
  const normalizeAssetName = (name: string): string => {
    const normalized = name.toLowerCase()
      .replace(/rooms?/g, 'room')
      .replace(/risers?/g, 'riser')
      .replace(/pits?/g, 'pit')
      .replace(/suites?/g, 'suite')
      .replace(/guest rooms?/g, 'suite')
      .replace(/kitchens?/g, 'kitchen')
      .replace(/washrooms?/g, 'washroom')
      .replace(/w\/c/g, 'washroom')
      .replace(/&/g, 'and')
      .replace(/,/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (normalized.includes('electrical') && normalized.includes('room')) return 'electrical rooms';
    if (normalized.includes('mechanical') && normalized.includes('room')) return 'mechanical rooms';
    if (normalized.includes('electrical') && normalized.includes('riser')) return 'electrical risers';
    if (normalized.includes('mechanical') && normalized.includes('riser')) return 'mechanical risers';
    if (normalized.includes('elevator') && normalized.includes('pit')) return 'elevator pits';
    if (normalized.includes('suite') || normalized.includes('guest')) return 'suites';
    if (normalized.includes('kitchen') || normalized.includes('washroom')) return 'kitchens and washrooms';
    if (normalized.includes('facade') || normalized.includes('envelope') || normalized.includes('exterior') || normalized.includes('roofing')) return 'facade envelope exterior and roofing';
    if (normalized.includes('mass timber') || normalized.includes('millwork')) return 'mass timber and millwork';
    
    return normalized;
  };

  // Normalize water system name for counting (must match WaterSystemsStep logic)
  const normalizeSystemName = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.includes('cold') && (lower.includes('domestic') || lower.includes('water'))) return 'domestic cold water';
    if (lower.includes('hot') && (lower.includes('domestic') || lower.includes('water'))) return 'domestic hot water';
    if (lower.includes('temporary') && lower.includes('water')) return 'temporary water run';
    if (lower.includes('main') && lower.includes('city') && lower.includes('water')) return 'main city water supply';
    if (lower.includes('hydronic')) return 'hydronics';
    if (lower.includes('fire') && (lower.includes('suppression') || lower.includes('protection') || lower.includes('sprinkler'))) return 'fire suppression system';
    if (lower.includes('sump') || lower.includes('storm drain') || lower.includes('drainage')) return 'sump pits storm drains and drainages';
    return lower.replace(/[,&]/g, '').replace(/\s+/g, ' ').trim();
  };

  // Normalize process name for counting (must match ProcessesStep logic)
  const normalizeProcessName = (name: string): string => {
    const lower = name.toLowerCase().trim();
    if (lower.includes('engineering')) return 'engineering process';
    if (lower.includes('contractor')) return 'contractor process';
    if (lower.includes('mechanical')) return 'mechanical contractor process';
    if (lower.includes('water mitigation') || lower.includes('vendor')) return 'water mitigation vendor process';
    return lower.replace(/[,&]/g, '').replace(/\s+/g, ' ').trim();
  };

  // Issue 23: Compute INSTANCE counts for subheadings (not unique class counts)
  const assetInstanceCount = useMemo(() => 
    analysisItems.filter(item => item.category === "Asset").length, 
    [analysisItems]
  );

  const waterSystemInstanceCount = useMemo(() => 
    analysisItems.filter(item => item.category === "Water System").length, 
    [analysisItems]
  );

  const processInstanceCount = useMemo(() => 
    analysisItems.filter(item => item.category === "Process").length, 
    [analysisItems]
  );

  // Fetch control costs from database (including monthly costs for full calculation)
  const { data: controlCosts = [] } = useQuery({
    queryKey: ['control-costs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mitigation_controls')
        .select('name, one_time_cost, monthly_maint_cost, risk_tolerance')
        .eq('is_active', true);
      if (error) throw error;
      return (data || []).map(c => ({
        name: c.name,
        oneTimeCost: Number(c.one_time_cost) || 0,
        monthlyCost: Number(c.monthly_maint_cost) || 0,
        riskTolerance: c.risk_tolerance || 3
      }));
    }
  });

  // Fetch control details for PDF report appendix
  const { data: controlDetails = [] } = useQuery({
    queryKey: ['control-details-for-report'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mitigation_controls')
        .select('name, action, description')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch pricing tiers for tiered cost calculation
  const { data: pricingTiers = [] } = useQuery({
    queryKey: ['control-pricing-tiers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('control_pricing_tiers')
        .select('*')
        .order('control_name, min_value');
      if (error) throw error;
      return data as PricingTier[];
    }
  });

  // Get project duration in months for cost calculation
  const projectDurationMonths = useMemo(() => {
    const startDate = projectData.construction_start_date;
    const endDate = projectData.construction_end_date;
    if (!startDate || !endDate) return 12; // Default to 12 months if not set
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    const months = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30));
    return Math.max(1, months);
  }, [projectData.construction_start_date, projectData.construction_end_date]);

  // Calculate total cost estimates, coverage, and control counts for risk tolerance levels using real control costs with tiered pricing
  // Uses the SAME mapper functions as CriticalAssetsStep/WaterSystemsStep for consistent class names and durations
  const { totalCostEstimates, coverageByLevel, controlCountsByLevel } = useMemo(() => {
    // Create a map of control name to {oneTimeCost, monthlyCost, riskTolerance}
    const controlMap = new Map<string, { oneTimeCost: number; monthlyCost: number; riskTolerance: number }>();
    controlCosts.forEach(c => controlMap.set(c.name, { 
      oneTimeCost: c.oneTimeCost, 
      monthlyCost: c.monthlyCost, 
      riskTolerance: c.riskTolerance 
    }));
    
    // Group analysis items by category using the same grouping as class-level components
    const { assets, waterSystems, processes } = groupByCategory(analysisItems);
    
    // Group items by their DATABASE class name (matching CriticalAssetsStep/WaterSystemsStep)
    const assetsByClass = new Map<string, AnalysisItem[]>();
    assets.forEach(item => {
      const className = mapToAssetName(item.name);
      if (className) {
        if (!assetsByClass.has(className)) assetsByClass.set(className, []);
        assetsByClass.get(className)!.push(item);
      }
    });
    
    const systemsByClass = new Map<string, AnalysisItem[]>();
    waterSystems.forEach(item => {
      const className = mapToWaterSystemName(item.name);
      if (className) {
        if (!systemsByClass.has(className)) systemsByClass.set(className, []);
        systemsByClass.get(className)!.push(item);
      }
    });
    
    const processesByClass = new Map<string, AnalysisItem[]>();
    processes.forEach(item => {
      const className = mapToProcessName(item.name);
      if (className) {
        if (!processesByClass.has(className)) processesByClass.set(className, []);
        processesByClass.get(className)!.push(item);
      }
    });
    
    // Calculate costs per tolerance level using tiered pricing
    let lowCost = 0;    // All controls (risk_tolerance 1, 2, 3)
    let mediumCost = 0; // Controls with risk_tolerance 2 or 3
    let highCost = 0;   // Only controls with risk_tolerance 3 (Essential)
    
    // Track coverage per level
    const lowAssets = new Set<string>();
    const lowSystems = new Set<string>();
    const lowProcesses = new Set<string>();
    const mediumAssets = new Set<string>();
    const mediumSystems = new Set<string>();
    const mediumProcesses = new Set<string>();
    const highAssets = new Set<string>();
    const highSystems = new Set<string>();
    const highProcesses = new Set<string>();
    
    // Track unique controls per level
    const lowControls = new Set<string>();
    const mediumControls = new Set<string>();
    const highControls = new Set<string>();
    
    // Helper to process instances for a class
    const processInstances = (
      instances: AnalysisItem[], 
      className: string, 
      durationMonths: number | null,
      category: "Asset" | "Water System" | "Process"
    ) => {
      const effectiveDuration = durationMonths ?? projectDurationMonths;
      
      instances.forEach(instance => {
        // Build instancePricingData exactly like CriticalAssetsStep does
        const additionalParams = (instance as any).additionalParameters;
        const instancePricingData = {
          width: instance.width,
          length: instance.length,
          areaSqft: instance.areaSqft ?? (instance as any).area_sqft ?? null,
          sizeCategory: instance.sizeCategory,
          pipeDiameterInches: additionalParams?.pipeDiameterInches ?? null,
          additionalParameters: additionalParams,
        };
        
        let hasLowControl = false;
        let hasMediumControl = false;
        let hasHighControl = false;
        
        (instance.controls || []).forEach(controlName => {
          const control = controlMap.get(controlName);
          if (control) {
            // Calculate cost using the SAME function as CriticalAssetsStep
            const totalCost = calculateTieredControlCost(
              controlName,
              instancePricingData,
              pricingTiers,
              control.oneTimeCost,
              control.monthlyCost,
              effectiveDuration,
              instance.name
            );
            
            lowCost += totalCost;
            lowControls.add(controlName);
            hasLowControl = true;
            
            if (control.riskTolerance >= 2) {
              mediumCost += totalCost;
              mediumControls.add(controlName);
              hasMediumControl = true;
            }
            if (control.riskTolerance >= 3) {
              highCost += totalCost;
              highControls.add(controlName);
              hasHighControl = true;
            }
          }
        });
        
        // Track coverage using instance name
        if (hasLowControl) {
          if (category === "Asset") lowAssets.add(instance.name);
          else if (category === "Water System") lowSystems.add(instance.name);
          else lowProcesses.add(instance.name);
        }
        if (hasMediumControl) {
          if (category === "Asset") mediumAssets.add(instance.name);
          else if (category === "Water System") mediumSystems.add(instance.name);
          else mediumProcesses.add(instance.name);
        }
        if (hasHighControl) {
          if (category === "Asset") highAssets.add(instance.name);
          else if (category === "Water System") highSystems.add(instance.name);
          else highProcesses.add(instance.name);
        }
      });
    };
    
    // Process assets - calculate duration ONCE per class (like CriticalAssetsStep does)
    assetsByClass.forEach((instances, className) => {
      const durationStr = calculateCriticalAssetDuration(className, projectData);
      const durationMonths = parseDurationMonths(durationStr);
      processInstances(instances, className, durationMonths, "Asset");
    });
    
    // Process water systems - calculate duration ONCE per class (like WaterSystemsStep does)
    systemsByClass.forEach((instances, className) => {
      const durationStr = calculateWaterSystemDuration(className, projectData);
      const durationMonths = parseDurationMonths(durationStr);
      processInstances(instances, className, durationMonths, "Water System");
    });
    
    // Process processes - use project duration
    processesByClass.forEach((instances, className) => {
      processInstances(instances, className, projectDurationMonths, "Process");
    });
    
    return {
      totalCostEstimates: { lowCost, mediumCost, highCost },
      coverageByLevel: {
        low: { assets: lowAssets.size, systems: lowSystems.size, processes: lowProcesses.size },
        medium: { assets: mediumAssets.size, systems: mediumSystems.size, processes: mediumProcesses.size },
        high: { assets: highAssets.size, systems: highSystems.size, processes: highProcesses.size }
      },
      controlCountsByLevel: {
        low: lowControls.size,
        medium: mediumControls.size,
        high: highControls.size
      }
    };
  }, [analysisItems, controlCosts, pricingTiers, projectDurationMonths, projectData]);

  // Calculate actual cost based on currently selected controls using tiered pricing
  // Uses class-specific durations (matching totalCostEstimates logic)
  const actualSelectedCost = useMemo(() => {
    const controlMap = new Map<string, { oneTimeCost: number; monthlyCost: number }>();
    controlCosts.forEach(c => controlMap.set(c.name, { oneTimeCost: c.oneTimeCost, monthlyCost: c.monthlyCost }));
    
    // Create a map from item ID to analysis item for quick lookup
    const itemMap = new Map<string, AnalysisItem>();
    analysisItems.forEach(item => itemMap.set(item.id, item));
    
    // Combine all selected controls from assets, water systems, and processes
    const allSelectedControls = new Set<string>([
      ...(projectData.selectedAssetControls || []),
      ...(projectData.selectedSystemControls || []),
      ...(projectData.selectedProcessControls || []),
    ]);
    
    // Pre-calculate durations per class (matching totalCostEstimates approach)
    const classDurationCache = new Map<string, number | null>();
    
    let totalCost = 0;
    allSelectedControls.forEach(compositeId => {
      // Extract instance ID and control name from "instanceId::controlName" format
      const [instanceId, controlName] = compositeId.includes('::') 
        ? [compositeId.split('::')[0], compositeId.split('::')[1]]
        : [null, compositeId];
      
      const control = controlMap.get(controlName);
      if (control) {
        // Get instance data for tiered pricing lookup
        const item = instanceId ? itemMap.get(instanceId) : null;
        
        // Determine the class name and duration based on category
        let durationMonths: number | null = null;
        
        if (item) {
          let className: string | null = null;
          
          if (item.category === 'Asset') {
            className = mapToAssetName(item.name);
            if (className && !classDurationCache.has(`asset:${className}`)) {
              const durationStr = calculateCriticalAssetDuration(className, projectData);
              classDurationCache.set(`asset:${className}`, parseDurationMonths(durationStr));
            }
            durationMonths = className ? classDurationCache.get(`asset:${className}`) ?? null : null;
          } else if (item.category === 'Water System') {
            className = mapToWaterSystemName(item.name);
            if (className && !classDurationCache.has(`system:${className}`)) {
              const durationStr = calculateWaterSystemDuration(className, projectData);
              classDurationCache.set(`system:${className}`, parseDurationMonths(durationStr));
            }
            durationMonths = className ? classDurationCache.get(`system:${className}`) ?? null : null;
          } else if (item.category === 'Process') {
            durationMonths = projectDurationMonths;
          }
        }
        
        // Build instance pricing data
        const additionalParams = (item as any)?.additionalParameters;
        const instancePricingData = {
          width: item?.width ?? null,
          length: item?.length ?? null,
          areaSqft: item?.areaSqft ?? (item as any)?.area_sqft ?? null,
          sizeCategory: item?.sizeCategory ?? null,
          pipeDiameterInches: additionalParams?.pipeDiameterInches ?? null,
          additionalParameters: additionalParams,
        };
        
        totalCost += calculateTieredControlCost(
          controlName,
          instancePricingData,
          pricingTiers,
          control.oneTimeCost,
          control.monthlyCost,
          durationMonths,  // Use class-specific duration instead of projectDurationMonths
          item?.name
        );
      }
    });
    
    return totalCost;
  }, [projectData.selectedAssetControls, projectData.selectedSystemControls, projectData.selectedProcessControls, controlCosts, pricingTiers, analysisItems, projectDurationMonths, projectData]);

  // Handle risk tolerance change
  const handleRiskToleranceChange = useCallback((newTolerance: RiskTolerance) => {
    setRiskTolerance(newTolerance);
    setHasManualOverride(false); // Reset manual override when selecting a package
    updateField('riskTolerance', newTolerance);
  }, [updateField]);

  // Callback for when controls are manually toggled
  const handleManualControlToggle = useCallback(() => {
    setHasManualOverride(true);
  }, []);

  // Sync riskTolerance from projectData when it loads
  useEffect(() => {
    if (projectData.riskTolerance && projectData.riskTolerance !== riskTolerance) {
      setRiskTolerance(projectData.riskTolerance as RiskTolerance);
    }
  }, [projectData.riskTolerance]);

  // Fetch analysis items when project loads
  useEffect(() => {
    const fetchAnalysisItems = async () => {
      if (!id || id === "new") return;
      try {
        const { data, error } = await supabase
          .from('project_analysis_items')
          .select('*')
          .eq('project_id', id);
        if (error) throw error;
        if (data) {
          const items: AnalysisItem[] = data.map(d => ({
            id: d.item_id,
            name: d.name,
            category: d.category as "Asset" | "Water System" | "Process",
            areaName: d.area_name,
            floor: d.floor,
            drawingCode: d.drawing_code,
            fileName: d.file_name,
            width: d.width ? Number(d.width) : null,
            length: d.length ? Number(d.length) : null,
            areaSqft: d.area_sqft ? Number(d.area_sqft) : null,
            sizeCategory: d.size_category as any,
            controls: d.controls || [],
            coordinates: d.coordinates as any,
            additionalParameters: (d as any).additional_parameters || undefined,
          }));
          setAnalysisItems(items);
        }
      } catch (error) {
        console.error("Error fetching analysis items:", error);
      }
    };
    fetchAnalysisItems();
  }, [id]);

  // Clean up any old localStorage cache on mount (from previous implementation)
  useEffect(() => {
    const oldCacheKey = `projectData_${id}`;
    localStorage.removeItem(oldCacheKey);
  }, [id]);

  // Check for and restore cached project data after OAuth redirect
  useEffect(() => {
    const oauthFlagKey = `oauthPending_${id}`;
    const cachedDataKey = `projectData_${id}`;
    
    // Only restore if we have the OAuth pending flag (set before redirect)
    const oauthPending = sessionStorage.getItem(oauthFlagKey);
    if (!oauthPending) {
      // No OAuth in progress, clear any stale cache
      sessionStorage.removeItem(cachedDataKey);
      return;
    }
    
    const cachedData = sessionStorage.getItem(cachedDataKey);
    if (cachedData) {
      try {
        const parsed = JSON.parse(cachedData);
        console.log("Restoring cached project data after OAuth redirect:", parsed);
        const { _cacheTimestamp, ...dataWithoutTimestamp } = parsed;
        setProjectData(dataWithoutTimestamp);
        // Set flag to prevent fetchProject from overwriting
        justRestoredFromCache.current = true;
        // Reset flag after a short delay to allow normal fetching later
        setTimeout(() => {
          justRestoredFromCache.current = false;
        }, 2000);
      } catch (e) {
        console.error("Failed to parse cached project data:", e);
      }
    }
    
    // Always clear both flags after checking
    sessionStorage.removeItem(oauthFlagKey);
    sessionStorage.removeItem(cachedDataKey);
  }, [id, setProjectData]);

  // saveProject for new project creation only
  const saveProject = useCallback(async (data: ProjectData) => {
    // Prevent saving if we're on "new" route and there's no name yet
    if (id === "new" && (!data.name || data.name.trim() === "" || data.name === "Untitled Project")) {
      return;
    }
    
    // Prevent concurrent project creation
    if (id === "new" && (isSavingNewProject || isWebhookCreatingProject.current)) {
      console.log("Preventing duplicate project creation - save already in progress");
      return;
    }
    
    const isCreatingNew = id === "new";
    if (isCreatingNew) {
      setIsSavingNewProject(true);
    }
    
    setLoading(true);
    try {
      // Extract only the fields that are columns in the projects table
      const {
        name,
        project_type,
        building_type,
        tower_type,
        total_floors,
        typical_floors,
        typical_floors_start,
        typical_floors_end,
        underground_parking,
        underground_parking_start,
        underground_parking_end,
        above_grade_parking,
        location,
        address_1,
        address_2,
        city,
        state,
        zip_code,
        country,
        construction_start_date,
        construction_end_date,
        has_builders_risk_policy,
        uploadedFiles,
        webhookResponse,
        ...otherData
      } = data;

      const tableData = {
        name,
        project_type,
        building_type,
        tower_type,
        total_floors: total_floors ? parseInt(total_floors) : null,
        typical_floors: typical_floors ? parseInt(typical_floors) : null,
        typical_floors_start,
        typical_floors_end,
        underground_parking,
        underground_parking_start,
        underground_parking_end,
        above_grade_parking,
        location,
        address_1,
        address_2,
        city,
        state,
        zip_code,
        country,
        construction_start_date: construction_start_date || null,
        construction_end_date: construction_end_date || null,
        has_builders_risk_policy,
      };

      // Remove undefined values and empty strings for date fields
      Object.keys(tableData).forEach(key => {
        const value = tableData[key as keyof typeof tableData];
        if (value === undefined || value === "") {
          delete tableData[key as keyof typeof tableData];
        }
      });

      if (id && id !== "new") {
        // For existing projects, use the context's updateFields
        await flush();
      } else {
        const { data: newProject, error } = await supabase
          .from("projects")
          .insert([{
            user_id: user?.id,
            name: name || "Untitled Project",
            ...tableData,
            project_data: otherData,
          }])
          .select()
          .single();
        
        if (error) throw error;
        
        // Navigate with replace to avoid back button issues
        navigate(`/project/${newProject.id}`, { replace: true });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      if (isCreatingNew) {
        setIsSavingNewProject(false);
      }
    }
  }, [id, isSavingNewProject, user?.id, navigate, toast, flush]);

  const handleStepUpdate = useCallback(async (stepData: any) => {
    try {
      // Update via context - this handles both local state and persistence
      updateFields(stepData);
    } catch (error) {
      console.error("Error in handleStepUpdate:", error);
    }
  }, [updateFields]);

  // Handler for SCHEDULE analysis - only fills project information fields
  const handleScheduleDataExtracted = async (extractedData: any) => {
    setIsProcessingWebhook(true);
    isWebhookCreatingProject.current = true;
    
    console.log("Schedule webhook data received:", extractedData);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const getTowerType = (towerConfig: string | undefined) => {
      if (!towerConfig) return projectData.tower_type;
      return towerConfig.replace("_tower", "");
    };

    // Map building_type directly (or fall back to height_category for backward compatibility)
    const getBuildingType = () => {
      // Check direct building_type first (new format)
      if (extractedData.building_type) {
        const type = extractedData.building_type.toLowerCase().replace(/ /g, '-');
        if (['mid-rise', 'high-rise'].includes(type)) {
          return type;
        }
      }
      // Fallback to height_category for backward compatibility
      if (extractedData.height_category) {
        const category = extractedData.height_category.toLowerCase().replace(/ /g, '-');
        if (['mid-rise', 'high-rise'].includes(category)) {
          return category;
        }
      }
      return projectData.building_type;
    };

    // Map structural_type object to array of selected type ids (new key names with boolean values)
    const getStructuralTypes = () => {
      const structuralData = extractedData.structural_type || extractedData.structural_types;
      if (structuralData && typeof structuralData === 'object') {
        // Map AI response keys (e.g., 'cast-in-place_reinforced_concrete') to our internal IDs
        const typeMapping: Record<string, string> = {
          'cast-in-place': 'cast-in-place',
          'cast-in-place_reinforced_concrete': 'cast-in-place',
          'precast': 'precast',
          'precast_concrete': 'precast',
          'steel': 'steel',
          'mass-timber': 'mass-timber',
          'mass_timber': 'mass-timber',
        };
        const selectedTypes: string[] = [];
        Object.entries(structuralData).forEach(([key, value]) => {
          const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');
          const mappedType = typeMapping[normalizedKey] || typeMapping[key];
          if (value === true && mappedType && !selectedTypes.includes(mappedType)) {
            selectedTypes.push(mappedType);
          }
        });
        return selectedTypes.length > 0 ? selectedTypes : projectData.structural_types;
      }
      return projectData.structural_types;
    };
    
    // Schedule analysis ONLY fills project info - no assets/water systems
    const mappedData = {
      // Basic project info
      name: extractedData.project_name || projectData.name,
      construction_start_date: extractedData.project_start_date || projectData.construction_start_date,
      construction_end_date: extractedData.project_end_date || projectData.construction_end_date,
      
      // Building details
      project_type: extractedData.construction_type
        ? extractedData.construction_type.toLowerCase().replace(/ /g, '-')
        : projectData.project_type,
      building_type: getBuildingType(),
      structural_types: getStructuralTypes(),
      has_podium: extractedData.has_podium !== undefined 
        ? extractedData.has_podium 
        : projectData.has_podium,
      tower_type: extractedData.tower_configuration 
        ? getTowerType(extractedData.tower_configuration)
        : projectData.tower_type,
      
      // Floor information
      total_floors: extractedData.total_floor_count || projectData.total_floors,
      typical_floors: extractedData.typical_floor_count || projectData.typical_floors,
      typical_floors_start: extractedData.typical_floor_start || projectData.typical_floors_start,
      typical_floors_end: extractedData.typical_floor_end || projectData.typical_floors_end,
      underground_parking: extractedData.underground_parking_present !== undefined 
        ? extractedData.underground_parking_present 
        : projectData.underground_parking,
      
      // Map milestones to flat field structure
      frame_start_date: extractedData.milestones?.structural_framing?.start || projectData.frame_start_date,
      frame_end_date: extractedData.milestones?.structural_framing?.finish || projectData.frame_end_date,
      enclosure_start_date: extractedData.milestones?.envelope?.start || projectData.enclosure_start_date,
      enclosure_end_date: extractedData.milestones?.envelope?.finish || projectData.enclosure_end_date,
      mep_start_date: extractedData.milestones?.MEP?.start || projectData.mep_start_date,
      mep_end_date: extractedData.milestones?.MEP?.finish || projectData.mep_end_date,
      elevators_start_date: extractedData.milestones?.elevators?.start || projectData.elevators_start_date,
      elevators_end_date: extractedData.milestones?.elevators?.finish || projectData.elevators_end_date,
      fire_start_date: extractedData.milestones?.fire_suppression_systems?.start || projectData.fire_start_date,
      fire_end_date: extractedData.milestones?.fire_suppression_systems?.finish || projectData.fire_end_date,
      interior_start_date: extractedData.milestones?.interior_finishes?.start || projectData.interior_start_date,
      interior_end_date: extractedData.milestones?.interior_finishes?.finish || projectData.interior_end_date,
    };

    // Update via context
    updateFields(mappedData);
    
    toast({
      title: "Project Info Updated",
      description: "Project information has been automatically updated from the uploaded schedule.",
    });
    
    isWebhookCreatingProject.current = false;
    setIsProcessingWebhook(false);
  };

  // Handler for DRAWING analysis - fills assets/water systems
  const handleDrawingDataExtracted = async (extractedData: any) => {
    setIsProcessingWebhook(true);
    isWebhookCreatingProject.current = true;
    
    console.log("handleDrawingDataExtracted called with:", extractedData);
    console.log("Current project ID:", id);
    
    // Validate project ID - must have a saved project before analysis
    if (!id || id === "new") {
      console.error("Cannot save analysis - project not yet saved. ID:", id);
      toast({
        title: "Save Project First",
        description: "Please save the project before running analysis.",
        variant: "destructive",
      });
      isWebhookCreatingProject.current = false;
      setIsProcessingWebhook(false);
      return;
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const items: AnalysisItem[] = extractedData.assets_water_systems_processes || [];
    console.log(`Received ${items.length} analysis items`);
    
    if (items.length === 0) {
      toast({
        title: "No Items Found",
        description: "No assets or water systems were detected in the drawings.",
      });
      isWebhookCreatingProject.current = false;
      setIsProcessingWebhook(false);
      return;
    }
    
    // Drawing analysis fills assets and water systems
    // IMPORTANT: Clear old instance/control selections so CriticalAssetsStep and WaterSystemsStep reinitialize with new items
    const mappedData = {
      selectedAssets: extractSelectedAssets(items),
      selectedSystems: extractSelectedSystems(items),
      // Clear stale selections from previous analysis - these will be reinitialized by child components
      selectedAssetInstances: [],
      selectedAssetControls: [],
      selectedWaterSystemInstances: [],
      selectedWaterSystemControls: [],
      selectedProcessInstances: [],
      selectedProcessControls: [],
    };

    // Update via context
    updateFields(mappedData);
    
    try {
      // Save the detailed analysis items to the database
      await saveAnalysisItems(id, items);
      setAnalysisItems(items);
      console.log("Analysis items saved and state updated");
      
      toast({
        title: "Drawing Analysis Complete",
        description: `Found and saved ${items.length} items: ${extractSelectedAssets(items).length} assets, ${extractSelectedSystems(items).length} water systems.`,
      });
    } catch (error) {
      console.error("Error saving drawing data:", error);
      toast({
        title: "Error",
        description: "Failed to save extracted data. Please try again.",
        variant: "destructive",
      });
    } finally {
      isWebhookCreatingProject.current = false;
      setIsProcessingWebhook(false);
    }
  };

  // Save analysis items to the database
  const saveAnalysisItems = async (projectId: string, items: AnalysisItem[]) => {
    console.log(`saveAnalysisItems called with projectId: ${projectId}, items count: ${items.length}`);
    
    if (!projectId || projectId === "new") {
      console.error("Cannot save analysis items: invalid project ID");
      throw new Error("Invalid project ID");
    }
    
    if (items.length === 0) {
      console.warn("No analysis items to save");
      return;
    }
    
    // Verify user is authenticated before attempting insert
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.error("Cannot save analysis items: user not authenticated");
      throw new Error("User not authenticated");
    }
    console.log("User authenticated, proceeding with save. User ID:", session.user.id);
    
    try {
      // First, delete existing items for this project
      const { error: deleteError } = await supabase
        .from('project_analysis_items')
        .delete()
        .eq('project_id', projectId);
      
      if (deleteError) {
        console.error("Error deleting existing analysis items:", deleteError);
      }

      // Insert new items - handle both area_sqft (snake_case from edge function) and areaSqft (camelCase)
      const itemsToInsert = items.map(item => {
        // Get area from either format
        const area = item.area_sqft ?? item.areaSqft ?? null;
        // Auto-derive size category if not provided
        const derivedSizeCategory = item.sizeCategory || getSizeCategory(area);
        
        return {
          project_id: projectId,
          item_id: item.id,
          name: item.name,
          category: item.category,
          area_name: item.areaName || null,
          floor: item.floor || null,
          drawing_code: item.drawingCode || null,
          file_name: item.fileName || null,
          width: item.width || null,
          length: item.length || null,
          area_sqft: area,
          size_category: derivedSizeCategory,
          controls: item.controls || [],
          coordinates: item.coordinates || null,
          additional_parameters: item.additionalParameters || null,
        };
      });

      console.log("Inserting analysis items:", itemsToInsert);
      
      const { data, error } = await supabase
        .from('project_analysis_items')
        .insert(itemsToInsert)
        .select();

      if (error) {
        console.error("Error saving analysis items:", error);
        throw error;
      } else {
        console.log(`Successfully saved ${data?.length || itemsToInsert.length} analysis items to database`);
      }
    } catch (error) {
      console.error("Error in saveAnalysisItems:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred while saving analysis items.",
        variant: "destructive",
      });
    }
  };

  // Cache project data to sessionStorage before OAuth redirect
  const handleBeforeOAuthRedirect = useCallback(async () => {
    if (id && Object.keys(projectData).length > 0) {
      console.log("Caching project data to sessionStorage before OAuth redirect...");
      const oauthFlagKey = `oauthPending_${id}`;
      const cachedDataKey = `projectData_${id}`;
      // Set flag to indicate OAuth is in progress
      sessionStorage.setItem(oauthFlagKey, 'true');
      const dataWithTimestamp = { ...projectData, _cacheTimestamp: Date.now() };
      sessionStorage.setItem(cachedDataKey, JSON.stringify(dataWithTimestamp));
      // Also try to flush pending changes
      if (id !== "new") {
        flush().catch(console.error);
      }
    }
  }, [id, projectData, flush]);

  return (
    <div className="min-h-screen bg-background">
      {/* Print-only header */}
      <div className="print-header">
        <img src={riskBlueLogo} alt="RiskBlue" />
      </div>
      
      <header className="sticky top-0 z-20 border-b bg-card no-print">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <img 
            src={riskBlueLogo} 
            alt="RiskBlue" 
            className="h-8 cursor-pointer" 
            onClick={() => navigate("/projects")}
          />
          <div className="flex items-center gap-6">
            {/* Saving indicator */}
            {(isSaving || hasPendingChanges) && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Saving...</span>
              </div>
            )}
            <button onClick={() => navigate("/projects")} className="text-foreground hover:text-primary">
              Projects
            </button>
            <button onClick={() => setShowProviderDialog(true)} className="text-foreground hover:text-primary">
              Solution Provider Portal
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Avatar className="cursor-pointer">
                  <AvatarFallback>{user?.email?.[0].toUpperCase()}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={signOut} className="cursor-pointer">
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 pb-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="sticky top-[73px] z-10 bg-background pt-8 pb-4 -mx-6 px-6 border-b">
            <div className="flex items-center gap-4 mb-2">
              <h2 className="text-md font-medium text-foreground">
                {projectData.name || "Unnamed Project"}
              </h2>
              {isAdmin && id && id !== "new" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCollaboratorsModal(true)}
                  className="flex items-center gap-2"
                >
                  <Users className="h-4 w-4" />
                  Manage Collaborators
                </Button>
              )}
            </div>
            <TabsList className="w-full justify-start">
              <TabsTrigger value="guideline">
                Water Risk Discovery {projectData.waterRiskDiscoveryComplete && "✅"}
              </TabsTrigger>
              <TabsTrigger value="plan">
                Water Mitigation Planning {projectData.waterMitigationPlanningComplete && "✅"}
              </TabsTrigger>
              <TabsTrigger value="response">Water Mitigation Execution</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="guideline" className="max-w-5xl mx-auto">
            <Accordion type="multiple" defaultValue={["basic-info", "assets-systems"]} className="space-y-4">
              <AccordionItem value="basic-info" className="border rounded-lg px-6">
                <AccordionTrigger className="text-lg font-semibold">
                  Project Info
                </AccordionTrigger>
                <AccordionContent className="space-y-8 pt-4">
                  {/* Schedule Analysis - right below Project Info header */}
                  <div className="space-y-4 mb-6">
                    <p className="text-sm text-muted-foreground">
                      Upload a Project Schedule file to automatically extract project details and milestones.
                    </p>
                    <ProjectFilesUpload 
                      projectId={id || "new"}
                      projectName={projectData.name}
                      onScheduleDataExtracted={handleScheduleDataExtracted}
                      isProcessingWebhook={isProcessingWebhook}
                      setIsProcessingWebhook={setIsProcessingWebhook}
                      driveFiles={[]}
                      setDriveFiles={() => {}}
                      driveAccessToken={null}
                      setDriveAccessToken={() => {}}
                      driveConnected={false}
                      setDriveConnected={() => {}}
                      onBeforeOAuthRedirect={handleBeforeOAuthRedirect}
                      mode="schedule"
                    />
                  </div>
                  
                  <div className="space-y-6">
                    <ProjectInfoStep />
                  </div>
                  
                  <div className="space-y-6 pt-6 border-t">
                    <h3 className="text-md font-medium">Milestones & Timelines</h3>
                    <ProjectMilestonesStep />
                  </div>
                  <div className="space-y-6 pt-6 border-t">
                    <ConstructionDetailsStep />
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Issue 12: Button inline with section title, not inside trigger */}
              <AccordionItem value="assets-systems" className="border rounded-lg px-6">
                <div className="flex items-center">
                  <AccordionTrigger className="text-lg font-semibold flex-1 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <span>Assets, Water Systems & Processes</span>
                      {/* Issue 23: Show instance count, not class count */}
                      {analysisItems.length > 0 && (
                        <span className="text-sm font-normal text-muted-foreground">
                          ({analysisItems.length})
                        </span>
                      )}
                    </div>
                  </AccordionTrigger>
                  <Button
                    variant="link"
                    size="sm"
                    className="text-blue-600 hover:text-blue-800 p-0 h-auto ml-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Bug 2: Increment key to force remount
                      setAwpModalKey(prev => prev + 1);
                      setShowAWPEditModal(true);
                    }}
                  >
                    {analysisItems.length === 0 ? "Add New" : "Edit List"}
                  </Button>
                </div>
                <AccordionContent className="space-y-8 pt-4">
                  {/* Empty state when no items */}
                  {analysisItems.length === 0 && (
                    <div className="text-center py-8 border rounded-lg bg-muted/30">
                      <p className="text-sm text-muted-foreground mb-2">
                        No assets, water systems, or processes have been added yet.
                      </p>
                      <p className="text-xs text-muted-foreground mb-4">
                        Click "Add New" to manually add items or connect a repository to analyze drawing files.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setAwpModalKey(prev => prev + 1);
                          setShowAWPEditModal(true);
                        }}
                      >
                        Add New
                      </Button>
                    </div>
                  )}

                  {/* Risk Tolerance Selector - applies to all AWP sections */}
                  <div className="space-y-6">
                    <h3 className="text-md font-medium">
                      Critical Assets
                      {assetInstanceCount > 0 && (
                        <span className="ml-2 text-muted-foreground font-normal">({assetInstanceCount})</span>
                      )}
                    </h3>
                    <CriticalAssetsStep 
                      onNext={handleStepUpdate} 
                      onBack={() => {}} 
                      isProcessingWebhook={isProcessingWebhook}
                      analysisItems={analysisItems}
                      driveFiles={driveFiles}
                      driveAccessToken={driveAccessToken}
                      riskTolerance={riskTolerance}
                      onManualControlToggle={handleManualControlToggle}
                    />
                  </div>
                  <div className="space-y-6 pt-6 border-t">
                    <h3 className="text-md font-medium">
                      Water Systems
                      {waterSystemInstanceCount > 0 && (
                        <span className="ml-2 text-muted-foreground font-normal">({waterSystemInstanceCount})</span>
                      )}
                    </h3>
                    <WaterSystemsStep 
                      onNext={handleStepUpdate} 
                      onBack={() => {}} 
                      isProcessingWebhook={isProcessingWebhook}
                      analysisItems={analysisItems}
                      driveFiles={driveFiles}
                      driveAccessToken={driveAccessToken}
                      riskTolerance={riskTolerance}
                      onManualControlToggle={handleManualControlToggle}
                    />
                  </div>
                  <div className="space-y-6 pt-6 border-t">
                    <h3 className="text-md font-medium">
                      Processes
                      {processInstanceCount > 0 && (
                        <span className="ml-2 text-muted-foreground font-normal">({processInstanceCount})</span>
                      )}
                    </h3>
                    <ProcessesStep 
                      analysisItems={analysisItems}
                      onNext={handleStepUpdate}
                      isProcessingWebhook={isProcessingWebhook}
                      driveFiles={driveFiles}
                      driveAccessToken={driveAccessToken}
                      riskTolerance={riskTolerance}
                      onManualControlToggle={handleManualControlToggle}
                    />
                  </div>
                  
                  {/* Implementation Level Selector - moved below Processes */}
                  <div className="pt-6 border-t">
                    <RiskToleranceSelector
                      value={riskTolerance}
                      onChange={handleRiskToleranceChange}
                      lowCost={totalCostEstimates.lowCost}
                      mediumCost={totalCostEstimates.mediumCost}
                      highCost={totalCostEstimates.highCost}
                      lowCoverage={coverageByLevel.low}
                      mediumCoverage={coverageByLevel.medium}
                      highCoverage={coverageByLevel.high}
                      controlCounts={controlCountsByLevel}
                      hasCustomSelection={hasManualOverride}
                    />
                    
                    {/* Cost Estimate - show package cost when not manually overridden */}
                    <div className="flex flex-col items-center justify-center py-6 px-4 bg-muted/30 rounded-lg border border-border mt-4">
                      <p className="text-sm text-muted-foreground mb-1">Estimated Implementation Cost</p>
                      <p className="text-3xl font-bold text-primary">
                        ${(hasManualOverride 
                          ? actualSelectedCost 
                          : totalCostEstimates[riskTolerance === 'low' ? 'lowCost' : riskTolerance === 'medium' ? 'mediumCost' : 'highCost']
                        ).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

            </Accordion>
            
            {/* Bottom Controls */}
            <div className="flex justify-between items-center pt-6">
              <Button variant="outline" onClick={() => {
                // Show preparing toast
                toast({
                  title: "Preparing report...",
                  description: "Please wait while the file is being prepared.",
                });
                
                const originalTitle = document.title;
                document.title = generateReportFilename(projectData.name || "unnamed_project", "WaterRiskDiscovery");
                
                // Create a temporary container for the report
                const reportContainer = document.createElement('div');
                reportContainer.className = 'print-report-container';
                document.body.appendChild(reportContainer);
                
                // Render the report (we'll do this via React portal in next step)
                const root = document.createElement('div');
                reportContainer.appendChild(root);
                
                // Import and render
                import('react-dom/client').then(({ createRoot }) => {
                  const reactRoot = createRoot(root);
                  reactRoot.render(<WaterRiskReport data={projectData} analysisItems={analysisItems} controlDetails={controlDetails} />);
                  
                  // Wait longer for images to load, then print
                  setTimeout(() => {
                    window.print();
                    document.title = originalTitle;
                    
                    // Cleanup after print
                    setTimeout(() => {
                      reactRoot.unmount();
                      document.body.removeChild(reportContainer);
                    }, 100);
                  }, 1500);
                });
              }}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="mark-complete"
                    checked={projectData.waterRiskDiscoveryComplete || false}
                    onChange={(e) => handleStepUpdate({ waterRiskDiscoveryComplete: e.target.checked })}
                    className="h-4 w-4 rounded border-input"
                  />
                  <Label htmlFor="mark-complete" className="cursor-pointer">Mark as Complete</Label>
                </div>
                <Button onClick={() => setActiveTab("plan")}>
                  Continue
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="plan" className="max-w-5xl mx-auto">
            {/* Water Mitigation Guideline Button */}
            <div className="flex justify-center mb-6">
              <Dialog open={showGuidelinesDialog} onOpenChange={setShowGuidelinesDialog}>
                <DialogTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="lg"
                    disabled={!projectData.waterRiskDiscoveryComplete}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Water Mitigation Guideline
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Water Risk Discovery</DialogTitle>
                  </DialogHeader>
                  <WaterMitigationGuidelinesStep 
                    data={projectData}
                    analysisItems={analysisItems}
                    onBack={() => {}}
                    onNext={() => {}}
                  />
                </DialogContent>
              </Dialog>
            </div>
            
            <CollaboratorManagementStep projectId={id || "new"} />
            
            <div className="mt-8">
              <ProposalsStep 
                data={{ ...projectData, projectId: id, userName: user?.email }}
                onBack={() => {}}
                onNext={(data) => handleStepUpdate(data)}
              />
            </div>
            
            {/* Bottom Controls */}
            <div className="flex justify-between items-center pt-6">
              <div />
              
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="mark-plan-complete"
                    checked={projectData.waterMitigationPlanningComplete || false}
                    onChange={(e) => handleStepUpdate({ waterMitigationPlanningComplete: e.target.checked })}
                    className="h-4 w-4 rounded border-input"
                  />
                  <Label htmlFor="mark-plan-complete" className="cursor-pointer">Mark as Complete</Label>
                </div>
                <Button onClick={() => setActiveTab("response")}>
                  Continue
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="response">
            <ImplementationScheduleStep data={projectData} analysisItems={analysisItems} />
            
            <div className="max-w-5xl mx-auto">
              <ResponsePlanUploadChat 
                projectId={id || "new"} 
                onDataExtracted={handleScheduleDataExtracted}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <ProviderSelectionDialog 
        open={showProviderDialog} 
        onOpenChange={setShowProviderDialog} 
      />
      
      {/* Bug 2: Key forces remount for proper state reset */}
      <AWPEditModal
        key={awpModalKey}
        isOpen={showAWPEditModal}
        onClose={() => setShowAWPEditModal(false)}
        analysisItems={analysisItems}
        onUpdateItems={async (items) => {
          setAnalysisItems(items);
          // Issue 14: Save to database
          if (id && id !== "new") {
            try {
              await saveAnalysisItems(id, items);
              toast({
                title: "Saved",
                description: `${items.length} item(s) saved successfully`,
              });
            } catch (error) {
              console.error("Error saving analysis items:", error);
            }
          }
          // Clear existing selections so they reinitialize with updated items
          updateFields({
            selectedAssetInstances: [],
            selectedAssetControls: [],
            selectedWaterSystemInstances: [],
            selectedWaterSystemControls: [],
            selectedProcessInstances: [],
            selectedProcessControls: [],
          });
        }}
        projectId={id || "new"}
        projectName={projectData.name}
        onBeforeOAuthRedirect={handleBeforeOAuthRedirect}
        onFilesLoaded={(files, accessToken) => {
          setDriveFiles(files);
          setDriveAccessToken(accessToken);
          setDriveConnected(true);
        }}
      />
      
      {/* Collaborators Modal */}
      <CollaboratorsModal
        isOpen={showCollaboratorsModal}
        onClose={() => setShowCollaboratorsModal(false)}
        projectId={id || ""}
        projectName={projectData.name || "Untitled Project"}
      />
    </div>
  );
};

// Wrapper component that provides project data loading and the context
const ProjectWizard = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [initialData, setInitialData] = useState<ProjectData>({});
  const [isLoading, setIsLoading] = useState(true);
  const [projectId, setProjectId] = useState<string | undefined>(id);
  const isCreatingProject = useRef(false);

  // Create a new project immediately when navigating to /project/new
  useEffect(() => {
    const createNewProject = async () => {
      if (id !== "new" || !user || isCreatingProject.current) {
        return;
      }
      
      isCreatingProject.current = true;
      console.log('[ProjectWizard] Creating new project for user:', user.id);
      
      try {
        const { data: newProject, error } = await supabase
          .from("projects")
          .insert([{
            user_id: user.id,
            name: "Untitled Project",
            status: "draft",
            country: null, // Explicitly set to null to avoid any database defaults
          }])
          .select()
          .single();
        
        if (error) throw error;
        
        console.log('[ProjectWizard] New project created:', newProject.id);
        
        // Navigate to the new project URL (replace to avoid back button going to /new)
        navigate(`/project/${newProject.id}`, { replace: true });
      } catch (error: any) {
        console.error('[ProjectWizard] Error creating project:', error);
        toast({
          title: "Error creating project",
          description: getUserFriendlyError(error),
          variant: "destructive",
        });
        isCreatingProject.current = false;
      }
    };

    createNewProject();
  }, [id, user, navigate, toast]);

  // Fetch project data on mount (for existing projects)
  useEffect(() => {
    const fetchProject = async () => {
      if (!id || id === "new") {
        // Don't set loading false yet - we're creating a new project
        return;
      }
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setIsLoading(false);
        return;
      }
      
      try {
        const { data, error } = await supabase
          .from("projects")
          .select("*")
          .eq("id", id)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          setIsLoading(false);
          return;
        }
        
        const { project_data, created_at, updated_at, user_id, id: dbProjectId, ...tableColumns } = data;
        const mergedData = {
          ...tableColumns,
          ...(project_data as ProjectData || {}),
        };
        
        setProjectId(dbProjectId);
        setInitialData(mergedData);
      } catch (error: any) {
        console.error("Error fetching project:", error);
        toast({
          title: "Error",
          description: getUserFriendlyError(error),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchProject();
  }, [id, toast]);

  // Show loading while creating new project or fetching existing
  if (isLoading || id === "new") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">
            {id === "new" ? "Creating project..." : "Loading project..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ProjectProvider projectId={projectId} initialData={initialData}>
      <ProjectWizardContent />
    </ProjectProvider>
  );
};

export default ProjectWizard;
