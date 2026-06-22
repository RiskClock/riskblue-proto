// Lazily renders a single-page PDF for an analysis_request_sheets row whose
// storage_path is NULL. Loads the parent file, extracts the requested page
// with pdf-lib, uploads to the appropriate bucket, and updates the sheet row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const { data: { user } } = await admin.auth.getUser(auth.replace("Bearer ", ""));
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { sheetId } = await req.json() as { sheetId?: string };
    if (!sheetId) return json({ error: "Missing sheetId" }, 400);

    const { data: sheet, error: sErr } = await admin
      .from("analysis_request_sheets")
      .select("id, parent_file_id, page_index, storage_path, name")
      .eq("id", sheetId)
      .maybeSingle();
    if (sErr || !sheet) return json({ error: "Sheet not found" }, 404);

    if ((sheet as any).storage_path) {
      return json({ storage_path: (sheet as any).storage_path, already: true });
    }

    const parentFileId = (sheet as any).parent_file_id as string;
    const pageNumber = (sheet as any).page_index as number;

    const { data: parent, error: pErr } = await admin
      .from("analysis_request_files")
      .select(
        "id, name, storage_path, analysis_request_id, analysis_requests!inner(source_type, project_id)",
      )
      .eq("id", parentFileId)
      .single();
    if (pErr || !parent) return json({ error: "Parent file not found" }, 404);

    const parentStoragePath: string | null = (parent as any).storage_path;
    if (!parentStoragePath) return json({ error: "Parent file has no storage_path" }, 400);

    const sourceType = (parent as any).analysis_requests?.source_type;
    const bucket = sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";
    const requestId: string = (parent as any).analysis_request_id;
    const projectId: string = (parent as any).analysis_requests?.project_id;

    const { data: blob, error: dlErr } = await admin.storage.from(bucket).download(parentStoragePath);
    if (dlErr || !blob) return json({ error: `Download failed: ${dlErr?.message ?? "unknown"}` }, 500);

    const ab = await blob.arrayBuffer();
    let srcDoc: any;
    try {
      srcDoc = await PDFDocument.load(ab, { ignoreEncryption: true });
    } catch (e: any) {
      return json({ error: `pdf-lib load failed: ${e?.message ?? String(e)}` }, 500);
    }

    const pageIndex = pageNumber - 1;
    if (pageIndex < 0 || pageIndex >= srcDoc.getPageCount()) {
      return json({ error: `Page ${pageNumber} out of range` }, 400);
    }

    const newDoc = await PDFDocument.create();
    const [copied] = await newDoc.copyPages(srcDoc, [pageIndex]);
    newDoc.addPage(copied);
    const bytes = await newDoc.save();

    // Match the splitter's storage path convention used during normal pipeline.
    const sheetPrefix = `${projectId}/${requestId}/${parentFileId}`;
    const storagePath = `${sheetPrefix}/page-${String(pageNumber).padStart(4, "0")}.pdf`;

    const { error: upErr } = await admin.storage.from(bucket).upload(
      storagePath,
      new Blob([bytes], { type: "application/pdf" }),
      { contentType: "application/pdf", upsert: true },
    );
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);

    await admin
      .from("analysis_request_sheets")
      .update({ storage_path: storagePath } as any)
      .eq("id", sheetId);

    return json({ storage_path: storagePath, bucket });
  } catch (e: any) {
    console.error("[render-sheet-page] error", e);
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
});
