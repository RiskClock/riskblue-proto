import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCached, putCached, touchCached } from "./documentCache";

/**
 * Unified document source loader.
 * Resolves a logical source descriptor into a Blob (for PDFs) or an image URL.
 *
 * Supported descriptors:
 *  - { kind: 'blob', blob }                          - already in memory
 *  - { kind: 'url', url }                            - direct URL (http(s) or data:)
 *  - { kind: 'drive', fileId, accessToken, mimeType? } - Google Drive
 *  - { kind: 'supabase-storage', bucket, path, version? } - Supabase storage signed URL
 *
 * `version` is a source-of-truth freshness token (e.g. row.updated_at). When
 * present, the cache key includes it so replacing the underlying object
 * forces a fresh download exactly once. Old entries are then LRU-evicted.
 */

export type DocumentSourceDescriptor =
  | { kind: "blob"; blob: Blob; mimeType?: string }
  | { kind: "url"; url: string; mimeType?: string; version?: string | number }
  | {
      kind: "drive";
      fileId: string;
      accessToken: string;
      mimeType?: string;
      fileName?: string;
      version?: string | number;
    }
  | {
      kind: "supabase-storage";
      bucket: string;
      path: string;
      mimeType?: string;
      version?: string | number;
    };

/** Marker prepended to error messages when the source blob is missing from storage. */
export const MISSING_SOURCE_ERROR = "__SOURCE_MISSING__";

function isMissingObjectError(msg: string | undefined): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    m.includes("object not found") ||
    m.includes("not_found") ||
    m.includes("notfound") ||
    m.includes("http 400") ||
    m.includes("http 404") ||
    m.includes("storage fetch failed: 400") ||
    m.includes("storage fetch failed: 404")
  );
}

export interface ResolvedSource {
  kind: "pdf" | "image";
  /** Present for PDFs; consumers feed it to usePdfPageRaster. */
  pdfBlob?: Blob;
  /** Present for image sources; consumers render via <img>. */
  imageUrl?: string;
  /** Best-known mime type. */
  mimeType: string;
}

function isPdfMime(mime: string | undefined, hintName?: string) {
  if (!mime && !hintName) return false;
  if (mime?.includes("pdf")) return true;
  if (mime?.includes("google-apps")) return true; // export to PDF
  if (hintName?.toLowerCase().endsWith(".pdf")) return true;
  return false;
}

// Tier-1 in-memory cache: synchronous hits for rapid reopens of the same PDF.
// Tier-2 (IndexedDB, via ./documentCache) survives page reloads and shares
// across all consumers (viewer + exporters).
const MEM_CACHE_MAX = 5;
type MemEntry = { blob: Blob; mime: string };
const memCache = new Map<string, MemEntry>();

function memGet(key: string): MemEntry | null {
  const hit = memCache.get(key);
  if (!hit) return null;
  // Promote LRU order.
  memCache.delete(key);
  memCache.set(key, hit);
  return hit;
}

function memPut(key: string, entry: MemEntry) {
  memCache.set(key, entry);
  if (memCache.size > MEM_CACHE_MAX) {
    const oldest = memCache.keys().next().value;
    if (oldest) memCache.delete(oldest);
  }
}

/**
 * Fetch with retry + exponential backoff. Retries on network-level failures
 * ("TypeError: Failed to fetch") and 5xx/429 responses. Large signed-URL
 * downloads (multi-MB PDFs from Supabase Storage) occasionally fail mid-flight
 * on flaky connections; a single retry usually rescues the open-modal flow.
 */
async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  attempts = 3
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(input, init);
      if (r.ok) return r;
      if (r.status >= 500 || r.status === 429) {
        lastErr = new Error(`HTTP ${r.status}`);
      } else {
        return r; // non-retryable
      }
    } catch (e) {
      lastErr = e; // network error
    }
    if (i < attempts - 1) {
      await new Promise((res) => setTimeout(res, 400 * Math.pow(2, i)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
}

function descriptorKey(d: DocumentSourceDescriptor): string | null {
  const version = (d as any).version;
  const versionSuffix = version != null ? `@v=${version}` : "";
  if (d.kind === "supabase-storage") return `ss:${d.bucket}:${d.path}${versionSuffix}`;
  if (d.kind === "url") return `url:${d.url}${versionSuffix}`;
  if (d.kind === "drive") return `drive:${d.fileId}${versionSuffix}`;
  return null; // blob - not cacheable
}

/**
 * Resolve a descriptor to a { blob, mime } pair. Shared cache path used by
 * both the React hook and non-React callers (exporters). Throws on failure.
 */
export async function resolveDocumentSource(
  descriptor: DocumentSourceDescriptor
): Promise<{ blob: Blob; mime: string }> {
  const cacheKey = descriptorKey(descriptor);
  const declaredMime = (descriptor as any).mimeType as string | undefined;
  const defaultMime = declaredMime ?? "application/octet-stream";

  if (cacheKey) {
    const memHit = memGet(cacheKey);
    if (memHit) return { blob: memHit.blob, mime: declaredMime ?? memHit.mime };
    const idbHit = await getCached(cacheKey);
    if (idbHit) {
      memPut(cacheKey, { blob: idbHit.blob, mime: idbHit.mime });
      touchCached(cacheKey);
      return { blob: idbHit.blob, mime: declaredMime ?? idbHit.mime };
    }
  }

  let blob: Blob;
  let mime = defaultMime;

  if (descriptor.kind === "blob") {
    blob = descriptor.blob;
    mime = declaredMime ?? blob.type ?? mime;
  } else if (descriptor.kind === "url") {
    const r = await fetchWithRetry(descriptor.url);
    if (!r.ok) throw new Error(`Failed to load: ${r.status}`);
    blob = await r.blob();
    mime = declaredMime ?? blob.type ?? mime;
  } else if (descriptor.kind === "drive") {
    const isGoogleDoc = (descriptor.mimeType ?? "").includes("google-apps");
    const url = isGoogleDoc
      ? `https://www.googleapis.com/drive/v3/files/${descriptor.fileId}/export?mimeType=application/pdf`
      : `https://www.googleapis.com/drive/v3/files/${descriptor.fileId}?alt=media`;
    const r = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${descriptor.accessToken}` },
    });
    if (!r.ok) throw new Error(`Drive load failed: ${r.status}`);
    blob = await r.blob();
    mime = isGoogleDoc ? "application/pdf" : declaredMime ?? blob.type ?? mime;
  } else {
    // supabase-storage
    const { data, error: e } = await supabase.storage
      .from(descriptor.bucket)
      .createSignedUrl(descriptor.path, 3600);
    if (e || !data?.signedUrl) {
      throw new Error(e?.message ?? "Failed to sign storage URL");
    }
    const r = await fetchWithRetry(data.signedUrl);
    if (!r.ok) throw new Error(`Storage fetch failed: ${r.status}`);
    blob = await r.blob();
    mime = declaredMime ?? blob.type ?? mime;
  }

  if (cacheKey) {
    memPut(cacheKey, { blob, mime });
    // Fire-and-forget IDB write.
    void putCached({ key: cacheKey, blob, mime });
  }

  return { blob, mime };
}

/**
 * Idle-time prefetch: warm the cache so a subsequent modal open resolves
 * immediately. Safe to call repeatedly - no-op when already cached. Errors
 * are swallowed (best-effort warming).
 */
export async function prewarmDocumentSource(
  descriptor: DocumentSourceDescriptor
): Promise<void> {
  const cacheKey = descriptorKey(descriptor);
  if (!cacheKey) return;
  if (memGet(cacheKey)) return;
  // Cheap async check against IDB before we hit the network.
  const idbHit = await getCached(cacheKey);
  if (idbHit) {
    memPut(cacheKey, { blob: idbHit.blob, mime: idbHit.mime });
    touchCached(cacheKey);
    return;
  }
  try {
    await resolveDocumentSource(descriptor);
  } catch {
    // best-effort - ignore
  }
}

export function useDocumentSource(
  descriptor: DocumentSourceDescriptor | null,
  enabled: boolean = true
) {
  const [resolved, setResolved] = useState<ResolvedSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let revokeUrl: string | null = null;

    if (!descriptor || !enabled) {
      setResolved(null);
      return;
    }

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const { blob, mime } = await resolveDocumentSource(descriptor);
        if (cancelled) return;
        const hintName =
          descriptor.kind === "drive" ? descriptor.fileName : undefined;
        const pdf = isPdfMime(mime, hintName);
        if (pdf) {
          setResolved({ kind: "pdf", pdfBlob: blob, mimeType: "application/pdf" });
        } else {
          const objectUrl = URL.createObjectURL(blob);
          revokeUrl = objectUrl;
          setResolved({ kind: "image", imageUrl: objectUrl, mimeType: mime });
        }
      } catch (e) {
        if (!cancelled) {
          const raw = e instanceof Error ? e.message : "Failed to load source";
          setError(isMissingObjectError(raw) ? MISSING_SOURCE_ERROR : raw);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [JSON.stringify(descriptor), enabled]);

  return { resolved, loading, error };
}
