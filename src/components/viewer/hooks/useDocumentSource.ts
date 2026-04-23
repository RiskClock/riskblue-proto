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

        if (descriptor.kind === "blob") {
          blob = descriptor.blob;
          mimeType = descriptor.mimeType ?? blob.type ?? mimeType;
        } else if (descriptor.kind === "url") {
          const r = await fetch(descriptor.url);
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
          const r = await fetch(url, {
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
          const r = await fetch(data.signedUrl);
          if (!r.ok) throw new Error(`Storage fetch failed: ${r.status}`);
          blob = await r.blob();
          mimeType =
            descriptor.mimeType ?? blob.type ?? mimeType;
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
