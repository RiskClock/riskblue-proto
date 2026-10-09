import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { toStorageSafeFileName } from "@/lib/utils";

export async function saveDeveloperProject(client: SupabaseClient<Database>, input: {
  projectId: string; requestId: string; userId: string; tenantId: string | null;
  name: string; address: string; city?: string | null; region?: string | null;
  details: Record<string, unknown>; image: File | null; drawings: File[];
}) {
  const check = (error: unknown) => { if (error) throw error; };
  const { error: projectError } = await client.from("projects").upsert({
    id: input.projectId, user_id: input.userId, tenant_id: input.tenantId,
    name: input.name.trim(), address_1: input.address.trim(), location: input.address.trim(),
    city: input.city, state: input.region, status: "draft", workbench_status: "draft",
    currency_code: "USD", credits_consumed: 0, project_data: input.details as Json,
  });
  check(projectError);
  const upload = async (file: File, path: string) => {
    const { error } = await client.storage.from("uploaded-drawings").upload(path, file, { upsert: true });
    check(error);
    return path;
  };
  let imagePath: string | null = null;
  if (input.image) imagePath = await upload(input.image, `${input.projectId}/intro/${toStorageSafeFileName(input.image.name)}`);
  if (input.drawings.length) {
    const { error } = await client.from("analysis_requests").upsert({
      id: input.requestId, project_id: input.projectId, user_id: input.userId,
      source_type: "manual_upload", status: "copying", file_count: input.drawings.length,
    });
    check(error);
    for (const [index, file] of input.drawings.entries()) {
      const path = await upload(file, `${input.projectId}/${input.requestId}/${index}_${toStorageSafeFileName(file.name)}`);
      // Stable IDs make retries update the same attachment instead of duplicating it.
      const driveId = `developer_${input.requestId}_${index}`;
      const { data: existing, error: lookupError } = await client.from("analysis_request_files").select("id")
        .eq("analysis_request_id", input.requestId).eq("drive_file_id", driveId).maybeSingle();
      check(lookupError);
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      const pageCount = isPdf ? await (await import("@/lib/pdfProcessor")).extractPdfPageCount(file) : null;
      const { error: fileError } = await client.from("analysis_request_files").upsert({
        ...(existing ? { id: existing.id } : {}), analysis_request_id: input.requestId,
        drive_file_id: driveId, name: file.name, mime_type: file.type || "application/octet-stream",
        size_bytes: file.size, relative_path: file.name, storage_path: path,
        copy_status: "copied", expected_page_count: pageCount,
      });
      check(fileError);
    }
    const { error: requestError } = await client.from("analysis_requests").update({
      status: "copied", file_count: input.drawings.length,
      total_size_bytes: input.drawings.reduce((sum, file) => sum + file.size, 0),
    }).eq("id", input.requestId);
    check(requestError);
  }
  const { error: finalError } = await client.from("projects").update({ project_data: {
    ...input.details, project_image_path: imagePath, project_image_bucket: imagePath ? "uploaded-drawings" : null,
  } as Json }).eq("id", input.projectId);
  check(finalError);
  return input.projectId;
}