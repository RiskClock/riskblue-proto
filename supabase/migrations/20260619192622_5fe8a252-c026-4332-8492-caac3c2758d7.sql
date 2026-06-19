-- 1. Drop the three crons tied to the old automated workflow
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN (
  'process-analysis-jobs-30s',
  'process-analysis-jobs-every-30s',
  'watchdog-stalled-pipelines'
);

-- 2. Purge accumulated logs (debug-only, nothing reads from them)
TRUNCATE TABLE net._http_response;
TRUNCATE TABLE cron.job_run_details;