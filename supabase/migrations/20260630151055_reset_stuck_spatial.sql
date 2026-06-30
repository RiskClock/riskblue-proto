UPDATE public.analysis_requests
SET space_hierarchy_status = 'failed',
    space_hierarchy_error = 'Run timed out with no response — please retry.',
    space_hierarchy_updated_at = now()
WHERE id = '72792608-8fae-48a8-aaba-62afbfefa122'
  AND space_hierarchy_status = 'running';
