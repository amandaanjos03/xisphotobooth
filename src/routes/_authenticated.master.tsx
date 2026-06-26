import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, ShieldCheck, Lock, Unlock, Users, Image as ImageIcon, Eye, Download as DownloadIcon, Calendar } from "lucide-react";
import { toast } from "sonner";
import xisLogo from "@/assets/xis-logo.png.asset.json";

type AdminRow = {
  user_id: string;
  email: string;
  created_at: string;
  blocked: boolean;
  is_master: boolean;
  event_count: number;
  photo_count: number;
  view_count: number;
  download_count: number;
};

export const Route = createFileRoute("/_authenticated/master")({
  component: MasterDashboard,
  head: () => ({ meta: [{ title: "Master — Xis Photo Booth" }] }),
});

function MasterDashboard() {
  const { user } = Route.useRouteContext() as { user: { id: string; email?: string } };
  const qc = useQueryClient();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.from("super_admins").select("user_id").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setAllowed(!!data); });
    return () => { cancelled = true; };
  }, [user.id]);

  const adminsQ = useQuery({
    queryKey: ["master", "admins"],
    enabled: allowed === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_admin_users" as never);
      if (error) throw error;
      return (data ?? []) as AdminRow[];
    },
  });

  const settingsQ = useQuery({
    queryKey: ["platform_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("platform_settings").select("allow_signups").eq("id", true).maybeSingle();
      if (error) throw error;
      return data as { allow_signups: boolean } | null;
    },
  });

  const blockMut = useMutation({
    mutationFn: async (vars: { uid: string; blocked: boolean }) => {
      const { error } = await supabase.rpc("set_admin_blocked" as never, { _user_id: vars.uid, _blocked: vars.blocked } as never);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.blocked ? "Administrador bloqueado" : "Administrador desbloqueado");
      qc.invalidateQueries({ queryKey: ["master", "admins"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const signupsMut = useMutation({
    mutationFn: async (allow: boolean) => {
      const { error } = await supabase.rpc("set_allow_signups" as never, { _allow: allow } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuração atualizada");
      qc.invalidateQueries({ queryKey: ["platform_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (allowed === null) {
    return <div className="min-h-screen grid place-items-center bg-blob"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!allowed) {
    return (
      <div className="min-h-screen bg-blob grid place-items-center px-4">
        <div className="card-soft p-8 max-w-md text-center">
          <h1 className="font-display text-2xl font-bold">Acesso restrito</h1>
          <p className="mt-2 text-sm text-muted-foreground">Esta área é exclusiva para o administrador master.</p>
          <Button asChild className="mt-6 rounded-full"><Link to="/admin">Voltar ao painel</Link></Button>
        </div>
      </div>
    );
  }

  const admins = adminsQ.data ?? [];
  const totals = admins.reduce(
    (a, r) => ({
      users: a.users + 1,
      events: a.events + Number(r.event_count),
      photos: a.photos + Number(r.photo_count),
      views: a.views + Number(r.view_count),
      downloads: a.downloads + Number(r.download_count),
    }),
    { users: 0, events: 0, photos: 0, views: 0, downloads: 0 },
  );

  return (
    <div className="min-h-screen bg-blob">
      <header className="border-b border-border/60 backdrop-blur-sm bg-background/60 sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <img src={xisLogo.url} alt="Xis Photo Booth" className="h-10 w-auto" />
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              <span className="font-display text-sm font-semibold">Master</span>
            </div>
          </div>
          <Link to="/admin" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Painel admin
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
        <h1 className="font-display text-4xl sm:text-5xl font-bold">Visão geral da plataforma</h1>
        <p className="mt-2 text-muted-foreground">Métricas agregadas de todos os administradores e eventos.</p>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-6">
          <StatCard icon={<Users className="size-4" />} label="Admins" value={totals.users} />
          <StatCard icon={<Calendar className="size-4" />} label="Eventos" value={totals.events} />
          <StatCard icon={<ImageIcon className="size-4" />} label="Fotos/Vídeos" value={totals.photos} />
          <StatCard icon={<Eye className="size-4" />} label="Acessos" value={totals.views} />
          <StatCard icon={<DownloadIcon className="size-4" />} label="Downloads" value={totals.downloads} />
        </div>

        <div className="card-soft p-5 mt-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-display font-bold">Cadastro público de administradores</div>
            <div className="text-sm text-muted-foreground">
              {settingsQ.data?.allow_signups ? "Aberto — qualquer pessoa pode criar conta." : "Fechado — somente convites diretos."}
            </div>
          </div>
          <Button
            variant={settingsQ.data?.allow_signups ? "secondary" : "default"}
            className="rounded-full"
            disabled={signupsMut.isPending || !settingsQ.data}
            onClick={() => signupsMut.mutate(!settingsQ.data!.allow_signups)}
          >
            {settingsQ.data?.allow_signups ? "Desativar cadastros" : "Permitir cadastros"}
          </Button>
        </div>

        <h2 className="font-display text-2xl font-bold mt-10 mb-4">Administradores</h2>
        {adminsQ.isLoading && <div className="grid place-items-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>}

        <div className="grid gap-3">
          {admins.map((a) => (
            <article key={a.user_id} className="card-soft p-4 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2">
                  <span className="font-display font-bold">{a.email}</span>
                  {a.is_master && <span className="text-[10px] uppercase tracking-wider bg-primary/10 text-primary rounded-full px-2 py-0.5">Master</span>}
                  {a.blocked && <span className="text-[10px] uppercase tracking-wider bg-destructive/10 text-destructive rounded-full px-2 py-0.5">Bloqueado</span>}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Desde {new Date(a.created_at).toLocaleDateString("pt-BR")}
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span title="Eventos"><Calendar className="size-3.5 inline mr-1" />{a.event_count}</span>
                <span title="Fotos"><ImageIcon className="size-3.5 inline mr-1" />{a.photo_count}</span>
                <span title="Acessos"><Eye className="size-3.5 inline mr-1" />{a.view_count}</span>
                <span title="Downloads"><DownloadIcon className="size-3.5 inline mr-1" />{a.download_count}</span>
              </div>
              {!a.is_master && (
                <Button
                  size="sm"
                  variant={a.blocked ? "default" : "secondary"}
                  className="rounded-full gap-1.5"
                  disabled={blockMut.isPending}
                  onClick={() => blockMut.mutate({ uid: a.user_id, blocked: !a.blocked })}
                >
                  {a.blocked ? <><Unlock className="size-3.5" /> Desbloquear</> : <><Lock className="size-3.5" /> Bloquear</>}
                </Button>
              )}
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="card-soft p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
        {icon}{label}
      </div>
      <div className="font-display text-2xl font-bold mt-1">{value.toLocaleString("pt-BR")}</div>
    </div>
  );
}
