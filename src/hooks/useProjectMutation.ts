import { useCallback, useRef, useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { separateFields } from '@/lib/projectFieldConfig';
import { getUserFriendlyError } from '@/lib/errorHandling';

interface PendingUpdate {
  fields: Record<string, any>;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface UseProjectMutationOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  debounceMs?: number;
}

export const useProjectMutation = (
  projectId: string | undefined,
  options: UseProjectMutationOptions = {}
) => {
  const { toast } = useToast();
  const { onSuccess, onError, debounceMs = 300 } = options;
  
  const [isSaving, setIsSaving] = useState(false);
  const pendingUpdates = useRef<Record<string, any>>({});
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const flushPromise = useRef<Promise<void> | null>(null);

  // Execute the batched update
  const executeUpdate = useCallback(async (fields: Record<string, any>) => {
    if (!projectId || projectId === 'new') {
      console.log('[useProjectMutation] Skipping update - no project ID');
      return;
    }

    setIsSaving(true);
    
    try {
      const { tableFields, jsonFields } = separateFields(fields);
      
      // Only update if we have fields to update
      const hasTableFields = Object.keys(tableFields).length > 0;
      const hasJsonFields = Object.keys(jsonFields).length > 0;
      
      if (!hasTableFields && !hasJsonFields) {
        return;
      }

      // Build the update object
      let updateData: Record<string, any> = {};
      
      if (hasTableFields) {
        // Clean undefined/empty values from table fields
        Object.entries(tableFields).forEach(([key, value]) => {
          if (value !== undefined) {
            updateData[key] = value === '' ? null : value;
          }
        });
      }
      
      if (hasJsonFields) {
        // Fetch existing project_data to merge
        const { data: existing, error: fetchError } = await supabase
          .from('projects')
          .select('project_data')
          .eq('id', projectId)
          .single();
        
        if (fetchError) throw fetchError;
        
        const existingProjectData = (existing?.project_data as Record<string, any>) || {};
        updateData.project_data = { ...existingProjectData, ...jsonFields };
      }

      // Execute the update
      const { error } = await supabase
        .from('projects')
        .update(updateData)
        .eq('id', projectId);

      if (error) throw error;
      
      console.log('[useProjectMutation] Updated fields:', Object.keys(fields));
      onSuccess?.();
      
    } catch (error: any) {
      console.error('[useProjectMutation] Error:', error);
      toast({
        title: 'Save Error',
        description: getUserFriendlyError(error),
        variant: 'destructive',
      });
      onError?.(error);
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [projectId, toast, onSuccess, onError]);

  // Flush pending updates immediately
  const flush = useCallback(async () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    
    const updates = { ...pendingUpdates.current };
    pendingUpdates.current = {};
    
    if (Object.keys(updates).length > 0) {
      await executeUpdate(updates);
    }
  }, [executeUpdate]);

  // Flush pending updates on unmount to ensure changes are saved
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      // Flush synchronously on unmount
      const updates = { ...pendingUpdates.current };
      pendingUpdates.current = {};
      if (Object.keys(updates).length > 0 && projectId && projectId !== 'new') {
        // Fire and forget - we can't await in cleanup
        executeUpdate(updates).catch(console.error);
      }
    };
  }, [projectId, executeUpdate]);

  // Update a single field
  const updateField = useCallback(<T>(field: string, value: T) => {
    pendingUpdates.current[field] = value;
    
    // Clear existing timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    
    // Set new debounce timer
    debounceTimer.current = setTimeout(() => {
      const updates = { ...pendingUpdates.current };
      pendingUpdates.current = {};
      flushPromise.current = executeUpdate(updates);
    }, debounceMs);
  }, [executeUpdate, debounceMs]);

  // Update multiple fields at once
  const updateFields = useCallback((fields: Record<string, any>) => {
    Object.assign(pendingUpdates.current, fields);
    
    // Clear existing timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    
    // Set new debounce timer
    debounceTimer.current = setTimeout(() => {
      const updates = { ...pendingUpdates.current };
      pendingUpdates.current = {};
      flushPromise.current = executeUpdate(updates);
    }, debounceMs);
  }, [executeUpdate, debounceMs]);

  // Update immediately without debounce
  const updateFieldImmediate = useCallback(async <T>(field: string, value: T) => {
    // Clear any pending debounced updates for this field
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    
    // Merge with any pending updates
    const updates = { ...pendingUpdates.current, [field]: value };
    pendingUpdates.current = {};
    
    await executeUpdate(updates);
  }, [executeUpdate]);

  return {
    updateField,
    updateFields,
    updateFieldImmediate,
    flush,
    isSaving,
  };
};
