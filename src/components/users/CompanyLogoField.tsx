import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  COMPANY_LOGO_BUCKET,
  fetchCompanyLogos,
  type CompanyLogoRow,
} from "@/lib/brandLogo";

/**
 * Company logo picker/uploader shown under the Company dropdown in user
 * create/edit dialogs. Logos are stored per company and previously uploaded
 * logos are suggested whenever the same company is selected again.
 */
export function CompanyLogoField({ company }: { company: string | null }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CompanyLogoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // Guards against out-of-order responses when the company changes quickly.
  const requestRef = useRef(0);

  const trimmed = (company || "").trim();

  const load = async () => {
    const token = ++requestRef.current;
    if (!trimmed) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await fetchCompanyLogos(trimmed);
      if (requestRef.current !== token) return;
      setRows(next);
    } catch (e: any) {
      if (requestRef.current !== token) return;
      setRows([]);
      toast({ title: "Couldn't load logos", description: (e as any)?.message, variant: "destructive" });
    } finally {
      if (requestRef.current === token) setLoading(false);
    }
  };

  useEffect(() => {
    // Drop previous company's logos immediately so nothing stale is suggested.
    setRows([]);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed]);


  const makeCurrent = async (row: CompanyLogoRow) => {
    setBusy(true);
    try {
      await supabase.from("company_logos").update({ is_current: false }).ilike("company", trimmed);
      const { error } = await supabase
        .from("company_logos")
        .update({ is_current: true, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      toast({ title: "Couldn't set logo", description: (e as any)?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: CompanyLogoRow) => {
    setBusy(true);
    try {
      const { error } = await supabase.from("company_logos").delete().eq("id", row.id);
      if (error) throw error;
      await supabase.storage.from(COMPANY_LOGO_BUCKET).remove([row.storage_path]);
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

      const { data: userRes } = await supabase.auth.getUser();
      // Newly uploaded logos are only *suggested* — the user must click one to
      // make it the company's current logo.
      const { error: insErr } = await supabase.from("company_logos").insert({
        company: trimmed,
        storage_path: path,
        is_current: false,
        updated_by: userRes?.user?.id ?? null,
      } as any);
      if (insErr) throw insErr;
      await load();
      toast({ title: "Logo uploaded" });
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
        Select a company to manage its logo.
      </p>
    );
  }

  return (
    <div className="mt-1 space-y-2">
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading logos…
        </div>
      ) : rows.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className={cn(
                "group relative h-14 w-24 rounded border bg-muted/30 p-1 flex items-center justify-center",
                r.is_current ? "border-primary ring-1 ring-primary" : "border-border",
              )}
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => makeCurrent(r)}
                title={r.is_current ? "Current logo" : "Use this logo"}
                className="h-full w-full flex items-center justify-center"
              >
                <img src={r.url} alt="Company logo" className="max-h-full max-w-full object-contain" />
              </button>
              {r.is_current && (
                <span className="absolute -top-1.5 -left-1.5 rounded-full bg-primary text-primary-foreground p-0.5">
                  <Check className="h-3 w-3" />
                </span>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(r)}
                title="Remove logo"
                className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive text-destructive-foreground p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No logo uploaded for {trimmed} yet.</p>
      )}

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
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
        Upload logo
      </Button>
      <p className="text-[11px] text-muted-foreground">
        The selected logo replaces RiskBlue branding for everyone at this company.
      </p>
    </div>
  );
}
