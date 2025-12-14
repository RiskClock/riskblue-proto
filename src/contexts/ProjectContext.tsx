import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { separateFields } from '@/lib/projectFieldConfig';
import { getUserFriendlyError } from '@/lib/errorHandling';

// Fields that should save immediately (discrete selections, not text inputs)
const IMMEDIATE_SAVE_FIELDS = [
  'project_type',
  'building_type',
  'tower_type',
  'has_podium',
  'underground_parking',
  'above_grade_parking',
  'has_builders_risk_policy',
  'structural_types',
  'riskTolerance',
  'selectedAssetInstances',
  'selectedAssetControls',
  'selectedSystemInstances',
  'selectedSystemControls',
  'selectedProcessInstances',
  'selectedProcessControls',
];

interface ProjectContextValue {
  projectId: string | undefined;
  projectData: Record<string, any>;
  setProjectData: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  updateField: (field: string, value: any) => void;
  updateFields: (fields: Record<string, any>) => void;
  isSaving: boolean;
  hasPendingChanges: boolean;
  flush: () => Promise<void>;
  isNewProject: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export const useProject = () => {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
};

interface ProjectProviderProps {
  children: React.ReactNode;
  projectId: string | undefined;
  initialData?: Record<string, any>;
}

export const ProjectProvider: React.FC<ProjectProviderProps> = ({ 
  children, 
  projectId,
  initialData = {}
}) => {
  const { toast } = useToast();
  const [projectData, setProjectData] = useState<Record<string, any>>(initialData);
  const [isSaving, setIsSaving] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  
  const pendingUpdates = useRef<Record<string, any>>({});
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const isNewProject = !projectId || projectId === 'new';

  // Update initial data when it changes (after fetch)
  useEffect(() => {
    if (Object.keys(initialData).length > 0) {
      setProjectData(initialData);
    }
  }, [initialData]);

  // Execute the batched update to database
  const executeUpdate = useCallback(async (fields: Record<string, any>): Promise<boolean> => {
    if (isNewProject) {
      console.log('[ProjectContext] Skipping update - new project');
      return false;
    }

    setIsSaving(true);
    
    try {
      const { tableFields, jsonFields } = separateFields(fields);
      
      const hasTableFields = Object.keys(tableFields).length > 0;
      const hasJsonFields = Object.keys(jsonFields).length > 0;
      
      if (!hasTableFields && !hasJsonFields) {
        return true;
      }

      let updateData: Record<string, any> = {};
      
      if (hasTableFields) {
        Object.entries(tableFields).forEach(([key, value]) => {
          if (value !== undefined) {
            updateData[key] = value === '' ? null : value;
          }
        });
      }
      
      if (hasJsonFields) {
        const { data: existing, error: fetchError } = await supabase
          .from('projects')
          .select('project_data')
          .eq('id', projectId)
          .single();
        
        if (fetchError) throw fetchError;
        
        const existingProjectData = (existing?.project_data as Record<string, any>) || {};
        updateData.project_data = { ...existingProjectData, ...jsonFields };
      }

      const { error } = await supabase
        .from('projects')
        .update(updateData)
        .eq('id', projectId);

      if (error) throw error;
      
      console.log('[ProjectContext] Saved fields:', Object.keys(fields));
      return true;
      
    } catch (error: any) {
      console.error('[ProjectContext] Save error:', error);
      toast({
        title: 'Save Error',
        description: getUserFriendlyError(error),
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsSaving(false);
      setHasPendingChanges(Object.keys(pendingUpdates.current).length > 0);
    }
  }, [projectId, isNewProject, toast]);

  // Flush all pending updates immediately
  const flush = useCallback(async (): Promise<void> => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    
    const updates = { ...pendingUpdates.current };
    pendingUpdates.current = {};
    setHasPendingChanges(false);
    
    if (Object.keys(updates).length > 0) {
      await executeUpdate(updates);
    }
  }, [executeUpdate]);

  // Update a single field
  const updateField = useCallback((field: string, value: any) => {
    // Update local state immediately for UI responsiveness
    setProjectData(prev => ({ ...prev, [field]: value }));
    
    // Check if this field should save immediately
    if (IMMEDIATE_SAVE_FIELDS.includes(field)) {
      // Clear any pending debounce and merge with pending updates
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      
      const updates = { ...pendingUpdates.current, [field]: value };
      pendingUpdates.current = {};
      setHasPendingChanges(false);
      
      executeUpdate(updates);
    } else {
      // Debounce text input fields
      pendingUpdates.current[field] = value;
      setHasPendingChanges(true);
      
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      
      debounceTimer.current = setTimeout(() => {
        const updates = { ...pendingUpdates.current };
        pendingUpdates.current = {};
        setHasPendingChanges(false);
        executeUpdate(updates);
      }, 500);
    }
  }, [executeUpdate]);

  // Update multiple fields at once
  const updateFields = useCallback((fields: Record<string, any>) => {
    // Update local state immediately
    setProjectData(prev => ({ ...prev, ...fields }));
    
    // Check if any field requires immediate save
    const hasImmediateField = Object.keys(fields).some(f => IMMEDIATE_SAVE_FIELDS.includes(f));
    
    if (hasImmediateField) {
      // Save immediately with all pending + new fields
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      
      const updates = { ...pendingUpdates.current, ...fields };
      pendingUpdates.current = {};
      setHasPendingChanges(false);
      
      executeUpdate(updates);
    } else {
      // Debounce
      Object.assign(pendingUpdates.current, fields);
      setHasPendingChanges(true);
      
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      
      debounceTimer.current = setTimeout(() => {
        const updates = { ...pendingUpdates.current };
        pendingUpdates.current = {};
        setHasPendingChanges(false);
        executeUpdate(updates);
      }, 500);
    }
  }, [executeUpdate]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      
      const updates = { ...pendingUpdates.current };
      pendingUpdates.current = {};
      
      if (Object.keys(updates).length > 0 && projectId && projectId !== 'new') {
        console.log('[ProjectContext] Flushing on unmount:', Object.keys(updates));
        
        // Fire and forget - execute the update
        const doUnmountSave = async () => {
          try {
            const { tableFields, jsonFields } = separateFields(updates);
            const hasTableFields = Object.keys(tableFields).length > 0;
            const hasJsonFields = Object.keys(jsonFields).length > 0;
            
            if (!hasTableFields && !hasJsonFields) return;
            
            let updateData: Record<string, any> = { ...tableFields };
            
            if (hasJsonFields) {
              const { data: existing } = await supabase
                .from('projects')
                .select('project_data')
                .eq('id', projectId)
                .single();
              
              const existingProjectData = (existing?.project_data as Record<string, any>) || {};
              updateData.project_data = { ...existingProjectData, ...jsonFields };
            }
            
            await supabase
              .from('projects')
              .update(updateData)
              .eq('id', projectId);
          } catch (err) {
            console.error('[ProjectContext] Unmount save error:', err);
          }
        };
        
        doUnmountSave();
      }
    };
  }, [projectId]);

  // Warn on page unload if there are pending changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasPendingChanges || Object.keys(pendingUpdates.current).length > 0) {
        // Attempt to flush before unload
        const updates = { ...pendingUpdates.current };
        if (Object.keys(updates).length > 0 && projectId && projectId !== 'new') {
          // Can't await here, but try to save
          executeUpdate(updates).catch(console.error);
        }
        
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasPendingChanges, projectId, executeUpdate]);

  const value: ProjectContextValue = {
    projectId,
    projectData,
    setProjectData,
    updateField,
    updateFields,
    isSaving,
    hasPendingChanges,
    flush,
    isNewProject,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
};
