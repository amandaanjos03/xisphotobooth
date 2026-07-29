import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uploadAndSign } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, ShieldCheck, Lock, Unlock, Users, Image as ImageIcon, Eye, Download as DownloadIcon, Calendar, Trash2, Upload, Frame } from "lucide-react";
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

  const pendingQ = useQuery({
    queryKey: ["master", "pending"],
    enabled: allowed === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_pending_users" as never);
      if (error) throw error;
      return (data ?? []) as { user_id: string; email: string; created_at: string }[];
    },
  });

  const roleMut = useMutation({
    mutationFn: async (vars: { uid: string; grant: boolean }) => {
      const { error } = await supabase.rpc("set_admin_role" as never, { _user_id: vars.uid, _grant: vars.grant } as never);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.grant ? "Acesso de administrador concedido" : "Acesso removido");
      qc.invalidateQueries({ queryKey: ["master", "admins"] });
      qc.invalidateQueries({ queryKey: ["master", "pending"] });
    },
    onError: (e: Error) => toast.error(e.message),
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

        <h2 className="font-display text-2xl font-bold mt-10 mb-4">Contas aguardando aprovação</h2>
        <p className="-mt-3 mb-4 text-sm text-muted-foreground">
          Novas contas não recebem permissão automaticamente. Aprove aqui quem pode criar eventos.
        </p>
        {pendingQ.isLoading && <div className="grid place-items-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}
        {pendingQ.data?.length === 0 && (
          <div className="card-soft p-4 text-sm text-muted-foreground">Nenhuma conta pendente.</div>
        )}
        <div className="grid gap-3">
          {(pendingQ.data ?? []).map((u) => (
            <article key={u.user_id} className="card-soft p-4 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="font-display font-bold">{u.email}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Criada em {new Date(u.created_at).toLocaleDateString("pt-BR")}
                </div>
              </div>
              <Button
                size="sm"
                className="rounded-full gap-1.5"
                disabled={roleMut.isPending}
                onClick={() => roleMut.mutate({ uid: u.user_id, grant: true })}
              >
                <ShieldCheck className="size-3.5" /> Aprovar como admin
              </Button>
            </article>
          ))}
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
              {!a.is_master && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full gap-1.5 text-destructive"
                  disabled={roleMut.isPending}
                  onClick={() => roleMut.mutate({ uid: a.user_id, grant: false })}
                >
                  <Trash2 className="size-3.5" /> Remover admin
                </Button>
              )}
            </article>
          ))}
        </div>
        <GenericFramesLibrary userId={user.id} />
      </main>
    </div>
  );
}

type GenericFrame = { id: string; name: string; image_url: string; created_at: string };

function GenericFramesLibrary({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const framesQ = useQuery({
    queryKey: ["generic_frames"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generic_frames")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as GenericFrame[];
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("generic_frames").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Moldura removida");
      qc.invalidateQueries({ queryKey: ["generic_frames"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name.trim()) return toast.error("Informe nome e arquivo");
    setBusy(true);
    try {
      const url = await uploadAndSign("generic-frames" as never, `${Date.now()}-${file.name}`, file, file.type);
      const { error } = await supabase.from("generic_frames").insert({
        name: name.trim(), image_url: url, created_by: userId,
      } as never);
      if (error) throw error;
      toast.success("Moldura enviada");
      setName(""); setFile(null);
      qc.invalidateQueries({ queryKey: ["generic_frames"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  const frames = framesQ.data ?? [];

  return (
    <section className="mt-12">
      <h2 className="font-display text-2xl font-bold mb-1 flex items-center gap-2">
        <Frame className="size-5 text-primary" /> Biblioteca de molduras
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Molduras genéricas disponíveis para todos os administradores usarem nos seus eventos.
      </p>

      <form onSubmit={upload} className="card-soft p-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end mb-5">
        <div className="space-y-1.5">
          <Label htmlFor="frame-name">Nome</Label>
          <Input id="frame-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Casamento clássico" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="frame-file">Arquivo PNG</Label>
          <Input id="frame-file" type="file" accept="image/png,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <Button type="submit" disabled={busy} className="rounded-full gap-2">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Enviar
        </Button>
      </form>

      {framesQ.isLoading ? (
        <div className="grid place-items-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : frames.length === 0 ? (
        <div className="card-soft p-8 text-center text-sm text-muted-foreground">Nenhuma moldura na biblioteca ainda.</div>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {frames.map((f) => (
            <article key={f.id} className="card-soft overflow-hidden">
              <div className="aspect-square bg-[conic-gradient(at_30%_30%,oklch(0.93_0.05_98),oklch(0.97_0.03_98))] relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.image_url} alt={f.name} className="absolute inset-0 size-full object-contain p-2" />
              </div>
              <div className="p-3 flex items-center gap-2">
                <div className="flex-1 min-w-0 truncate text-sm font-semibold">{f.name}</div>
                <Button size="icon" variant="ghost" className="rounded-full size-8 text-muted-foreground hover:text-destructive"
                  onClick={() => { if (confirm(`Remover "${f.name}"?`)) delMut.mutate(f.id); }}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
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
