import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  COMPANY_LOGO_BUCKET,
  fetchCompanyLogos,
  type CompanyLogoRow,
} from "@/lib/brandLogo";

/** Deletes every stored logo for a company (rows + files). */
export async function purgeCompanyLogos(company: string) {
  const trimmed = (company || "").trim();
  if (!trimmed) return;
  const existing = await fetchCompanyLogos(trimmed);
  if (existing.length === 0) return;
  await supabase.from("company_logos").delete().in("id", existing.map((r) => r.id));
  await supabase.storage.from(COMPANY_LOGO_BUCKET).remove(existing.map((r) => r.storage_path));
}

/** Uploads a logo for a company, replacing whatever was there before. */
export async function uploadCompanyLogo(company: string, file: File) {
  const trimmed = (company || "").trim();
  if (!trimmed) throw new Error("Company name is required to store a logo.");
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company";
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${slug}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(COMPANY_LOGO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;

  await purgeCompanyLogos(trimmed);

  const { data: userRes } = await supabase.auth.getUser();
  const { error: insErr } = await supabase.from("company_logos").insert({
    company: trimmed,
    storage_path: path,
    is_current: true,
    updated_by: userRes?.user?.id ?? null,
  } as any);
  if (insErr) throw insErr;
}

/**
 * Company logo picker. Selection is staged locally — the parent commits it
 * (via `uploadCompanyLogo` / `purgeCompanyLogos`) when the form is saved, so a
 * logo can be chosen before the company name exists.
 */
export function CompanyLogoField({
  company,
  file,
  removed,
  onFileChange,
  onRemovedChange,
}: {
  company: string | null;
  file: File | null;
  removed: boolean;
  onFileChange: (f: File | null) => void;
  onRemovedChange: (removed: boolean) => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<CompanyLogoRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const requestRef = useRef(0);

  const trimmed = (company || "").trim();

  useEffect(() => {
    const token = ++requestRef.current;
    if (!trimmed) {
      setCurrent(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchCompanyLogos(trimmed)
      .then((next) => {
        if (requestRef.current !== token) return;
        setCurrent(next[0] ?? null);
      })
      .catch(() => {
        if (requestRef.current === token) setCurrent(null);
      })
      .finally(() => {
        if (requestRef.current === token) setLoading(false);
      });
  }, [trimmed]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const shownUrl = previewUrl ?? (removed ? null : current?.url ?? null);

  const pick = (f: File) => {
    if (!f.type.startsWith("image/")) {
      toast({ title: "Unsupported file", description: "Please upload an image file.", variant: "destructive" });
      return;
    }
    if (f.size > 4 * 1024 * 1024) {
      toast({ title: "File too large", description: "Logos must be 4 MB or smaller.", variant: "destructive" });
      return;
    }
    onRemovedChange(false);
    onFileChange(f);
  };

  const clear = () => {
    onFileChange(null);
    onRemovedChange(true);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="mt-1 flex items-center gap-3">
      <div className="h-14 w-24 shrink-0 rounded border border-dashed bg-muted/30 p-1 flex items-center justify-center">
        {loading && !shownUrl ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : shownUrl ? (
          <img src={shownUrl} alt="Company logo" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[10px] text-muted-foreground">No logo</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
        }}
      />

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            {shownUrl ? "Replace logo" : "Upload logo"}
          </Button>
          {shownUrl && (
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              <Trash2 className="h-4 w-4 mr-2 text-destructive" />
              Remove
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          The logo is saved when you save the company.
        </p>
      </div>
    </div>
  );
}
