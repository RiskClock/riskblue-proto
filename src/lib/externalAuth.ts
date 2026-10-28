import { supabase } from "@/integrations/supabase/client";

export type ExternalProvider = "autodesk" | "procore";

export const EXTERNAL_PROVIDERS: { id: ExternalProvider; label: string }[] = [
  { id: "autodesk", label: "Autodesk" },
  { id: "procore", label: "Procore" },
];

const fnUrl = (action: string) =>
  `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/external-auth?action=${action}`;

async function call(action: string, body: unknown) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(fnUrl(action), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}

/** Redirects the browser to the provider. mode "link" requires a signed-in session. */
export async function startExternalAuth(provider: ExternalProvider, mode: "login" | "link") {
  const { authUrl } = await call("start", { provider, mode, appOrigin: window.location.origin });
  window.location.assign(authUrl);
}

export async function unlinkExternalAuth(provider: ExternalProvider) {
  await call("unlink", { provider });
}
