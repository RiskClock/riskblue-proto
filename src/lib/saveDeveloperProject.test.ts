import { expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { saveDeveloperProject } from "./saveDeveloperProject";

test("saving attachments persists files without consuming credits or starting analysis", async () => {
  const writes: { table: string; values: any }[] = [];
  const uploads: string[] = [];
  const client = {
    from(table: string) {
      const builder: any = {
        upsert(values: any) { writes.push({ table, values }); return Promise.resolve({ error: null }); },
        update(values: any) { writes.push({ table, values }); return builder; },
        select() { return builder; }, eq() { return builder; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(resolve: any) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return builder;
    },
    storage: { from(bucket: string) { expect(bucket).toBe("uploaded-drawings"); return { upload(path: string) { uploads.push(path); return Promise.resolve({ error: null }); } }; } },
    rpc() { throw new Error("Save must not consume credits or run analysis"); },
    functions: { invoke() { throw new Error("Save must not start analysis"); } },
  } as unknown as SupabaseClient<Database>;
  await saveDeveloperProject(client, { projectId: "project", requestId: "request", userId: "user", tenantId: null,
    name: "Test", address: "Toronto", details: {}, image: new File(["image"], "image.png"), drawings: [new File(["drawing"], "drawing.png")],
  });
  expect(writes.find((write) => write.table === "projects")?.values.credits_consumed).toBe(0);
  expect(writes.filter((write) => write.table === "analysis_requests").at(-1)?.values.status).toBe("copied");
  expect(writes.find((write) => write.table === "analysis_request_files")?.values.storage_path).toBe("project/request/0_drawing.png");
  expect(uploads).toEqual(["project/intro/image.png", "project/request/0_drawing.png"]);
  expect(writes.at(-1)?.values.project_data.project_image_path).toBe("project/intro/image.png");
});