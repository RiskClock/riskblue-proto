-- Allow multiple split_pdf_chunk rows per parent file (they only differ by page_from/page_to).
DROP INDEX IF EXISTS public.analysis_pipeline_jobs_request_file_class_kind_uq;
CREATE UNIQUE INDEX analysis_pipeline_jobs_request_file_class_kind_uq
  ON public.analysis_pipeline_jobs (analysis_request_id, file_id, awp_class_name, job_kind)
  WHERE sheet_id IS NULL AND job_kind <> 'split_pdf_chunk';