import { supabase } from "@/integrations/supabase/client";

export type AgentName = "Scout" | "Risk Radar" | "Spatial Architect";

export type AcquireAgentLockResult =
  | { ok: true; runId: string; busy?: false; agent?: string; email?: string; message?: string }
  | { ok: false; runId?: undefined; busy: boolean; agent?: string; email?: string; message: string };


/**
 * Try to claim the single per-project agent slot. Only one agent (Scout,
 * Risk Radar, Spatial Architect) may run per project at a time; runs with no
 * heartbeat for 15 minutes are treated as stale server-side.
 */
export async function acquireAgentLock(
  projectId: string,
  agent: AgentName,
  analysisRequestId?: string | null,
): Promise<AcquireAgentLockResult> {
  const { data, error } = await supabase.rpc("acquire_agent_run" as any, {
    p_project_id: projectId,
    p_agent: agent,
    p_analysis_request_id: analysisRequestId ?? null,
  });
  if (error) {
    return { ok: false, busy: false, message: error.message };
  }
  const res = (data ?? {}) as {
    acquired?: boolean;
    run_id?: string;
    reason?: string;
    agent?: string;
    email?: string;
  };
  if (res.acquired && res.run_id) return { ok: true, runId: res.run_id };
  if (res.reason === "busy") {
    return {
      ok: false,
      busy: true,
      agent: res.agent,
      email: res.email ?? undefined,
      message: `${res.agent ?? "An agent"} is currently running for this project. Triggered by: ${res.email ?? "unknown"}`,
    };
  }
  return {
    ok: false,
    busy: false,
    message:
      res.reason === "forbidden"
        ? "You do not have permission to run agents on this project."
        : "Could not start the agent. Please sign in again.",
  };
}

/** Keep the lock alive while a long-running agent works. Returns a stop fn. */
export function startAgentHeartbeat(runId: string, intervalMs = 60_000): () => void {
  const id = setInterval(() => {
    void supabase.rpc("heartbeat_agent_run" as any, { p_run_id: runId });
  }, intervalMs);
  return () => clearInterval(id);
}

export async function releaseAgentLock(
  runId: string,
  status: "completed" | "failed" | "cancelled" = "completed",
  error?: string | null,
): Promise<void> {
  await supabase.rpc("complete_agent_run" as any, {
    p_run_id: runId,
    p_status: status,
    p_error: error ?? null,
  });
}

/** Internal users only: clear any stuck running agent for a project. */
export async function forceReleaseAgentLocks(projectId: string): Promise<number> {
  const { data, error } = await supabase.rpc("force_release_agent_runs" as any, {
    p_project_id: projectId,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}
