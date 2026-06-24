import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Unified document source loader.
 * Resolves a logical source descriptor into a Blob (for PDFs) or an image URL.
 *
 * Supported descriptors:
 *  - { kind: 'blob', blob }                          — already in memory
 *  - { kind: 'url', url }                            — direct URL (http(s) or data:)
 *  - { kind: 'drive', fileId, accessToken, mimeType? } — Google Drive
 *  - { kind: 'supabase-storage', bucket, path }      — Supabase storage signed URL
 */

export type DocumentSourceDescriptor =
  | { kind: "blob"; blob: Blob; mimeType?: string }
  | { kind: "url"; url: string; mimeType?: string }
  | {
      kind: "drive";
      fileId: string;
      accessToken: string;
      mimeType?: string;
      fileName?: string;
    }
  | { kind: "supabase-storage"; bucket: string; path: string; mimeType?: string };

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

// Module-level LRU cache for resolved blobs. Keyed by descriptor signature.
// Avoids re-downloading + re-signing storage URLs when reopening the same
// preview modal repeatedly.
const BLOB_CACHE_TTL_MS = 5 * 60 * 1000;
const BLOB_CACHE_MAX = 10;
type BlobCacheEntry = { blob: Blob; mime: string; ts: number };
const blobCache = new Map<string, BlobCacheEntry>();

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
  if (d.kind === "supabase-storage") return `ss:${d.bucket}:${d.path}`;
  if (d.kind === "url") return `url:${d.url}`;
  if (d.kind === "drive") return `drive:${d.fileId}`;
  return null; // blob — not cacheable
}

function readCache(key: string): BlobCacheEntry | null {
  const hit = blobCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > BLOB_CACHE_TTL_MS) {
    blobCache.delete(key);
    return null;
  }
  // refresh LRU order
  blobCache.delete(key);
  blobCache.set(key, hit);
  return hit;
}

function writeCache(key: string, entry: BlobCacheEntry) {
  blobCache.set(key, entry);
  if (blobCache.size > BLOB_CACHE_MAX) {
    const oldest = blobCache.keys().next().value;
    if (oldest) blobCache.delete(oldest);
  }
}

/**
 * Idle-time prefetch: download a descriptor's blob into the module-level LRU
 * cache so a subsequent useDocumentSource(descriptor) call hits cache and
 * resolves immediately. Safe to call repeatedly — no-op when already cached.
 * Errors are swallowed (best-effort warming).
 */
export async function prewarmDocumentSource(
  descriptor: DocumentSourceDescriptor
): Promise<void> {
  const cacheKey = descriptorKey(descriptor);
  if (!cacheKey) return;
  if (readCache(cacheKey)) return;
  try {
    let blob: Blob | null = null;
    let mimeType = (descriptor as any).mimeType ?? "application/octet-stream";
    if (descriptor.kind === "url") {
      const r = await fetchWithRetry(descriptor.url);
      if (!r.ok) return;
      blob = await r.blob();
      mimeType = descriptor.mimeType ?? blob.type ?? mimeType;
    } else if (descriptor.kind === "drive") {
      const isGoogleDoc = (descriptor.mimeType ?? "").includes("google-apps");
      const url = isGoogleDoc
        ? `https://www.googleapis.com/drive/v3/files/${descriptor.fileId}/export?mimeType=application/pdf`
        : `https://www.googleapis.com/drive/v3/files/${descriptor.fileId}?alt=media`;
      const r = await fetchWithRetry(url, {
        headers: { Authorization: `Bearer ${descriptor.accessToken}` },
      });
      if (!r.ok) return;
      blob = await r.blob();
      mimeType = isGoogleDoc ? "application/pdf" : descriptor.mimeType ?? blob.type ?? mimeType;
    } else if (descriptor.kind === "supabase-storage") {
      const { data, error: e } = await supabase.storage
        .from(descriptor.bucket)
        .createSignedUrl(descriptor.path, 3600);
      if (e || !data?.signedUrl) return;
      const r = await fetchWithRetry(data.signedUrl);
      if (!r.ok) return;
      blob = await r.blob();
      mimeType = descriptor.mimeType ?? blob.type ?? mimeType;
    }
    if (blob) writeCache(cacheKey, { blob, mime: mimeType, ts: Date.now() });
  } catch {
    // best-effort — ignore
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
        let blob: Blob | null = null;
        let directUrl: string | null = null;
        let mimeType =
          (descriptor as any).mimeType ?? "application/octet-stream";

        // Cache lookup
        const cacheKey = descriptorKey(descriptor);
        if (cacheKey) {
          const hit = readCache(cacheKey);
          if (hit) {
            blob = hit.blob;
            mimeType = (descriptor as any).mimeType ?? hit.mime ?? mimeType;
          }
        }

        if (!blob) {
          if (descriptor.kind === "blob") {
            blob = descriptor.blob;
            mimeType = descriptor.mimeType ?? blob.type ?? mimeType;
          } else if (descriptor.kind === "url") {
            const r = await fetchWithRetry(descriptor.url);
            if (!r.ok) throw new Error(`Failed to load: ${r.status}`);
            blob = await r.blob();
            mimeType = descriptor.mimeType ?? blob.type ?? mimeType;
          } else if (descriptor.kind === "drive") {
            const isGoogleDoc = (descriptor.mimeType ?? "").includes(
              "google-apps"
            );
            const url = isGoogleDoc
              ? `https://www.googleapis.com/drive/v3/files/${descriptor.fileId}/export?mimeType=application/pdf`
              : `https://www.googleapis.com/drive/v3/files/${descriptor.fileId}?alt=media`;
            const r = await fetchWithRetry(url, {
              headers: { Authorization: `Bearer ${descriptor.accessToken}` },
            });
            if (!r.ok) throw new Error(`Drive load failed: ${r.status}`);
            blob = await r.blob();
            mimeType = isGoogleDoc
              ? "application/pdf"
              : descriptor.mimeType ?? blob.type ?? mimeType;
          } else if (descriptor.kind === "supabase-storage") {
            const { data, error: e } = await supabase.storage
              .from(descriptor.bucket)
              .createSignedUrl(descriptor.path, 3600);
            if (e || !data?.signedUrl) {
              throw new Error(e?.message ?? "Failed to sign storage URL");
            }
            const r = await fetchWithRetry(data.signedUrl);
            if (!r.ok) throw new Error(`Storage fetch failed: ${r.status}`);
            blob = await r.blob();
            mimeType =
              descriptor.mimeType ?? blob.type ?? mimeType;
          }
          if (cacheKey && blob) {
            writeCache(cacheKey, { blob, mime: mimeType, ts: Date.now() });
          }
        }

        if (cancelled) return;

        const hintName =
          descriptor.kind === "drive" ? descriptor.fileName : undefined;
        const pdf = isPdfMime(mimeType, hintName);
        if (pdf && blob) {
          setResolved({
            kind: "pdf",
            pdfBlob: blob,
            mimeType: "application/pdf",
          });
        } else if (blob) {
          const objectUrl = URL.createObjectURL(blob);
          revokeUrl = objectUrl;
          setResolved({ kind: "image", imageUrl: objectUrl, mimeType });
        } else if (directUrl) {
          setResolved({ kind: "image", imageUrl: directUrl, mimeType });
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load source");
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
