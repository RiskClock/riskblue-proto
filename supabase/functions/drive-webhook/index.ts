import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// This endpoint receives POST notifications from Google Drive when watched files change.
// No JWT verification - Google sends these directly.

serve(async (req) => {
  // Google may send a sync message on initial watch setup
  const channelId = req.headers.get("X-Goog-Channel-ID");
  const resourceId = req.headers.get("X-Goog-Resource-ID");
  const resourceState = req.headers.get("X-Goog-Resource-State");

  console.log("Drive webhook received:", { channelId, resourceId, resourceState });

  // Sync messages don't indicate a change
  if (resourceState === "sync") {
    return new Response("OK", { status: 200 });
  }

  if (!channelId) {
    return new Response("Missing channel ID", { status: 400 });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate channel exists in our records
    const { data: channel, error: channelError } = await adminSupabase
      .from("drive_watch_channels")
      .select("drive_file_id")
      .eq("channel_id", channelId)
      .single();

    if (channelError || !channel) {
      console.error("Unknown channel:", channelId);
      return new Response("Unknown channel", { status: 404 });
    }

    // Flag the corresponding default prompt as stale
    const { error: updateError } = await adminSupabase
      .from("awp_class_prompts")
      .update({ is_stale: true })
      .eq("drive_file_id", channel.drive_file_id);

    if (updateError) {
      console.error("Failed to flag prompt as stale:", updateError);
    } else {
      console.log(`Flagged default prompts for file ${channel.drive_file_id} as stale`);
    }

    // Also flag triage prompts as stale if the file matches
    const { error: triageUpdateError } = await adminSupabase
      .from("awp_class_prompts")
      .update({ triage_is_stale: true })
      .eq("triage_drive_file_id", channel.drive_file_id);

    if (triageUpdateError) {
      console.error("Failed to flag triage prompt as stale:", triageUpdateError);
    } else {
      console.log(`Flagged triage prompts for file ${channel.drive_file_id} as stale`);
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Internal error", { status: 500 });
  }
});
