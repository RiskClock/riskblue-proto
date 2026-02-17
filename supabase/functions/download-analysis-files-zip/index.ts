import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { JSZip } from "https://deno.land/x/jszip@0.11.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

    // Check if user is internal (@riskclock.com)
    const isInternal = user.email?.toLowerCase().endsWith("@riskclock.com") ?? false;
    if (!isInternal) {
      return new Response(
        JSON.stringify({ error: "Access denied. Internal users only." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const analysisRequestId = url.searchParams.get("analysisRequestId");
    
    if (!analysisRequestId) {
      return new Response(
        JSON.stringify({ error: "analysisRequestId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role for storage access
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get analysis request details including source_type
    const { data: request, error: reqError } = await adminSupabase
      .from("analysis_requests")
      .select("*, project:projects(name)")
      .eq("id", analysisRequestId)
      .single();

    if (reqError || !request) {
      return new Response(
        JSON.stringify({ error: "Analysis request not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine the correct storage bucket based on source_type
    const storageBucket = request.source_type === "manual_upload" 
      ? "uploaded-drawings" 
      : "drive-analysis-files";

    // Get all copied files
    const { data: files, error: filesError } = await adminSupabase
      .from("analysis_request_files")
      .select("*")
      .eq("analysis_request_id", analysisRequestId)
      .eq("copy_status", "copied");

    if (filesError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch files" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!files || files.length === 0) {
      return new Response(
        JSON.stringify({ error: "No files available for download" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create ZIP file
    const zip = new JSZip();
    
    for (const file of files) {
      if (!file.storage_path) continue;

      try {
        const { data: fileData, error: downloadError } = await adminSupabase.storage
          .from(storageBucket)
          .download(file.storage_path);

        if (downloadError || !fileData) {
          console.error(`Failed to download ${file.relative_path} from ${storageBucket}:`, downloadError);
          continue;
        }

        // Add to zip with relative path to preserve folder structure
        const arrayBuffer = await fileData.arrayBuffer();
        zip.addFile(file.relative_path, new Uint8Array(arrayBuffer));
      } catch (e) {
        console.error(`Error processing ${file.relative_path}:`, e);
      }
    }

    // Generate ZIP
    const zipContent = await zip.generateAsync({ type: "uint8array" });
    const projectName = request.project?.name || "project";
    const filename = `${projectName.replace(/[^a-zA-Z0-9]/g, "_")}_analysis_${analysisRequestId.slice(0, 8)}.zip`;

    return new Response(zipContent.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
