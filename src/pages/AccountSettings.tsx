import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Mail, Link2, Unlink } from "lucide-react";
import { EXTERNAL_PROVIDERS, startExternalAuth, unlinkExternalAuth, type ExternalProvider } from "@/lib/externalAuth";

const AccountSettings = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<ExternalProvider | null>(null);

  const { data: identities = [] } = useQuery({
    queryKey: ["external-identities", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_external_identities")
        .select("provider, email, linked_at")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const linked = p.get("linked");
    const err = p.get("external_error");
    if (linked) toast({ title: "Sign-in method linked", description: `You can now sign in with ${linked === "autodesk" ? "Autodesk" : "Procore"}.` });
    if (err) toast({ title: "Could not link account", description: err, variant: "destructive" });
    if (linked || err) window.history.replaceState(null, "", window.location.pathname);
  }, [toast]);

  const link = async (p: ExternalProvider) => {
    setBusy(p);
    try {
      await startExternalAuth(p, "link");
    } catch (e) {
      toast({ title: "Could not start linking", description: (e as Error).message, variant: "destructive" });
      setBusy(null);
    }
  };

  const unlink = async (p: ExternalProvider) => {
    setBusy(p);
    try {
      await unlinkExternalAuth(p);
      await qc.invalidateQueries({ queryKey: ["external-identities"] });
      toast({ title: "Sign-in method removed" });
    } catch (e) {
      toast({ title: "Could not unlink", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Account Settings</h1>
          <p className="text-muted-foreground mt-1">{user?.email}</p>
        </div>

        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Sign-in methods</h2>
            <p className="text-sm text-muted-foreground">
              Link Autodesk or Procore to sign in to this same account. Your companies, roles and projects stay the same.
            </p>
          </div>
          <div className="rounded-lg border border-border divide-y divide-border">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="font-medium text-foreground">Email</div>
                  <div className="text-sm text-muted-foreground">{user?.email}</div>
                </div>
              </div>
            </div>
            {EXTERNAL_PROVIDERS.map(({ id, label }) => {
              const linked = identities.find((i) => i.provider === id);
              return (
                <div key={id} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <Link2 className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="font-medium text-foreground">{label}</div>
                      <div className="text-sm text-muted-foreground">{linked ? `Linked${linked.email ? ` as ${linked.email}` : ""}` : "Not linked"}</div>
                    </div>
                  </div>
                  {linked ? (
                    <Button variant="outline" size="sm" disabled={busy === id} onClick={() => unlink(id)}>
                      <Unlink className="h-4 w-4 mr-2" /> Unlink
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy === id} onClick={() => link(id)}>
                      Link {label}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AccountSettings;
