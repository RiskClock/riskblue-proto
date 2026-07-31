import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Allow invocation via service role key for one-off internal operations
    const fromServiceRole = authHeader === `Bearer ${supabaseServiceKey}`;

    if (!fromServiceRole) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const isInternal = user.email?.toLowerCase().endsWith("@riskclock.com") ?? false;
      if (!isInternal) {
        return new Response(
          JSON.stringify({ error: "Access denied. Internal users only." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return await performClone(req, supabaseUrl, supabaseServiceKey);
  } catch (error) {
    console.error("clone-project error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function performClone(req: Request, supabaseUrl: string, supabaseServiceKey: string): Promise<Response> {
  try {
    const { sourceProjectId, targetName } = await req.json();
    if (!sourceProjectId || !targetName) {
      return new Response(
        JSON.stringify({ error: "sourceProjectId and targetName are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    // Create the database clone in a single transaction
    const { data: cloneResult, error: cloneError } = await adminSupabase.rpc(
      "clone_project",
      {
        p_source_project_id: sourceProjectId,
        p_target_name: targetName,
      }
    );

    if (cloneError) {
      console.error("clone_project RPC error:", cloneError);
      return new Response(
        JSON.stringify({ error: cloneError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const targetProjectId = cloneResult as string;

    // Fetch the new analysis request and file to determine storage paths
    const { data: targetRequest, error: targetReqError } = await adminSupabase
      .from("analysis_requests")
      .select("id, source_type")
      .eq("project_id", targetProjectId)
      .single();

    if (targetReqError || !targetRequest) {
      return new Response(
        JSON.stringify({ error: "Failed to locate cloned analysis request" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: targetFiles, error: targetFilesError } = await adminSupabase
      .from("analysis_request_files")
      .select("id, storage_path, relative_path, analysis_request_id")
      .eq("analysis_request_id", targetRequest.id);

    if (targetFilesError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch cloned files" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const bucket = targetRequest.source_type === "manual_upload"
      ? "uploaded-drawings"
      : "drive-analysis-files";

    const storage = adminSupabase.storage.from(bucket);
    const copiedPaths: { old: string; new: string }[] = [];

    for (const file of targetFiles || []) {
      if (!file.storage_path) continue;

      const newPath = `${targetProjectId}/${targetRequest.id}/${file.relative_path}`;

      try {
        const { error: copyError } = await storage.copy(file.storage_path, newPath);
        if (copyError) {
          console.error(`Failed to copy ${file.storage_path} to ${newPath}:`, copyError);
          continue;
        }
        copiedPaths.push({ old: file.storage_path, new: newPath });
      } catch (e) {
        console.error(`Error copying ${file.storage_path}:`, e);
      }
    }

    // Update file storage paths
    for (const { new: newPath, old: oldPath } of copiedPaths) {
      await adminSupabase
        .from("analysis_request_files")
        .update({ storage_path: newPath })
        .eq("storage_path", oldPath)
        .eq("analysis_request_id", targetRequest.id);
    }

    // Update sheet storage paths that reference the old file path
    for (const { new: newPath, old: oldPath } of copiedPaths) {
      await adminSupabase
        .from("analysis_request_sheets")
        .update({ storage_path: newPath })
        .eq("storage_path", oldPath)
        .eq("analysis_request_id", targetRequest.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        projectId: targetProjectId,
        copiedFiles: copiedPaths.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("clone-project error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
