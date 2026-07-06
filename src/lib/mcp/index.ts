import { auth, defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";
import listProjectsTool from "./tools/list-projects";

// Build the OAuth issuer from the Supabase project ref inlined at build time.
// Vite replaces `import.meta.env.VITE_SUPABASE_PROJECT_ID` with a literal, so
// this stays import-safe (no runtime env read at module top level).
const projectRef =
  import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "riskclock-mcp",
  title: "RiskClock",
  version: "0.1.0",
  instructions:
    "Tools for the RiskClock app. Use `echo` to verify connectivity, and `list_projects` to list projects the signed-in user can access.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [echoTool, listProjectsTool],
});
