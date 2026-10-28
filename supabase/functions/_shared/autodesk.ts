// Shared Autodesk Platform Services (Forma / ACC Docs) helpers.
// Tokens are always AES-GCM encrypted at rest in user_autodesk_tokens.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const APS = "https://developer.api.autodesk.com";

function keyBytes(hex: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(hex)) throw new Error("Invalid encryption key");
  return new Uint8Array((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));
}

export async function encryptToken(plaintext: string, hex: string) {
  const key = await crypto.subtle.importKey("raw", keyBytes(hex), { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

export async function decryptToken(encrypted: string, hex: string) {
  const key = await crypto.subtle.importKey("raw", keyBytes(hex), { name: "AES-GCM" }, false, ["decrypt"]);
  const all = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, key, all.slice(12));
  return new TextDecoder().decode(pt);
}

export class AutodeskAuthError extends Error {}

/** Returns a valid Autodesk access token for the user, refreshing (and re-encrypting) when needed. */
export async function getAutodeskAccessToken(admin: SupabaseClient, userId: string): Promise<string> {
  const keyHex = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");
  if (!keyHex) throw new Error("Token encryption unavailable");
  const { data: row } = await admin.from("user_autodesk_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!row) throw new AutodeskAuthError("Autodesk is not connected");

  const expiresAt = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;
  if (expiresAt - Date.now() > 2 * 60 * 1000) return await decryptToken(row.encrypted_access_token, keyHex);

  if (!row.encrypted_refresh_token) throw new AutodeskAuthError("Autodesk connection expired. Please reconnect.");
  const refresh = await decryptToken(row.encrypted_refresh_token, keyHex);
  const id = Deno.env.get("AUTODESK_CLIENT_ID") ?? "";
  const secret = Deno.env.get("AUTODESK_CLIENT_SECRET") ?? "";
  const resp = await fetch(`${APS}/authentication/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${id}:${secret}`)}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  });
  const tok = await resp.json().catch(() => ({}));
  if (!resp.ok || !tok.access_token) {
    console.error("[autodesk] refresh failed", resp.status);
    throw new AutodeskAuthError("Autodesk connection expired. Please reconnect.");
  }
  await admin.from("user_autodesk_tokens").update({
    encrypted_access_token: await encryptToken(tok.access_token, keyHex),
    encrypted_refresh_token: tok.refresh_token ? await encryptToken(tok.refresh_token, keyHex) : row.encrypted_refresh_token,
    token_expiry: new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return tok.access_token as string;
}

export async function aps(token: string, path: string, init: RequestInit = {}) {
  const resp = await fetch(path.startsWith("http") ? path : `${APS}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error(`[autodesk] ${init.method ?? "GET"} ${path} -> ${resp.status} ${text.slice(0, 300)}`);
    throw new Error(`Autodesk request failed (${resp.status})`);
  }
  if (resp.status === 204) return null;
  return await resp.json();
}

/** "urn:adsk.objects:os.object:bucket/objectKey" -> { bucket, objectKey } */
export function parseStorageUrn(urn: string) {
  const m = /^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/.exec(urn);
  if (!m) throw new Error("Unsupported Autodesk storage location");
  return { bucket: m[1], objectKey: m[2] };
}

/** Download the latest version of an item. */
export async function downloadItem(token: string, projectId: string, itemId: string) {
  const tip = await aps(token, `/data/v1/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(itemId)}/tip`);
  const urn = tip?.data?.relationships?.storage?.data?.id;
  if (!urn) throw new Error("This file has no downloadable version");
  const { bucket, objectKey } = parseStorageUrn(urn);
  const signed = await aps(token, `/oss/v2/buckets/${bucket}/objects/${encodeURIComponent(objectKey)}/signeds3download`);
  const resp = await fetch(signed.url);
  if (!resp.ok) throw new Error(`Autodesk download failed (${resp.status})`);
  return {
    bytes: new Uint8Array(await resp.arrayBuffer()),
    name: tip?.data?.attributes?.name as string | undefined,
  };
}

export const isDocsProject = (projectId: string) => projectId.startsWith("b.");
