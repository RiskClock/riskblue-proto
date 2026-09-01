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

/**
 * Company logo uploader. A company has exactly one logo: uploading a new file
 * overrides (and deletes) whatever was there before. Logos are never shared
 * between companies, so no suggestions are shown.
 */
export function CompanyLogoField({ company }: { company: string | null }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<CompanyLogoRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // Guards against out-of-order responses when the company changes quickly.
  const requestRef = useRef(0);

  const trimmed = (company || "").trim();

  const load = async () => {
    const token = ++requestRef.current;
    if (!trimmed) {
      setCurrent(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await fetchCompanyLogos(trimmed);
      if (requestRef.current !== token) return;
      setCurrent(next[0] ?? null);
    } catch (e: any) {
      if (requestRef.current !== token) return;
      setCurrent(null);
      toast({ title: "Couldn't load logo", description: (e as any)?.message, variant: "destructive" });
    } finally {
      if (requestRef.current === token) setLoading(false);
    }
  };

  useEffect(() => {
    setCurrent(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed]);

  /** Deletes every stored logo for this company (rows + files). */
  const purgeExisting = async () => {
    const existing = await fetchCompanyLogos(trimmed);
    if (existing.length === 0) return;
    await supabase.from("company_logos").delete().in("id", existing.map((r) => r.id));
    await supabase.storage.from(COMPANY_LOGO_BUCKET).remove(existing.map((r) => r.storage_path));
  };

  const remove = async () => {
    setBusy(true);
    try {
      await purgeExisting();
      await load();
    } catch (e: any) {
      toast({ title: "Couldn't remove logo", description: (e as any)?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    if (!trimmed) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Unsupported file", description: "Please upload an image file.", variant: "destructive" });
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast({ title: "File too large", description: "Logos must be 4 MB or smaller.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company";
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${slug}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(COMPANY_LOGO_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      // A new upload always overrides the previous logo.
      await purgeExisting();

      const { data: userRes } = await supabase.auth.getUser();
      const { error: insErr } = await supabase.from("company_logos").insert({
        company: trimmed,
        storage_path: path,
        is_current: true,
        updated_by: userRes?.user?.id ?? null,
      } as any);
      if (insErr) throw insErr;
      await load();
      toast({ title: "Logo updated" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: (e as any)?.message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (!trimmed) {
    return (
      <p className="text-xs text-muted-foreground mt-1">
        Enter a company name to upload a logo.
      </p>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-3">
      <div className="h-14 w-24 shrink-0 rounded border border-dashed bg-muted/30 p-1 flex items-center justify-center">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : current ? (
          <img src={current.url} alt={`${trimmed} logo`} className="max-h-full max-w-full object-contain" />
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
          if (f) upload(f);
        }}
      />

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            {current ? "Replace logo" : "Upload logo"}
          </Button>
          {current && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
              <Trash2 className="h-4 w-4 mr-2 text-destructive" />
              Remove
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Uploading a new file replaces the existing logo for {trimmed}.
        </p>
      </div>
    </div>
  );
}
