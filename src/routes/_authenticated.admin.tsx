import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uniqueSlug } from "@/lib/slug";
import { uploadAndSign } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Camera, Plus, Share2, ImageIcon, Calendar, Loader2, Copy, Check, QrCode,
  ExternalLink, Trash2, KeyRound, LogOut, Pencil, Printer,
} from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import xisLogo from "@/assets/xis-logo.png.asset.json";

type PrintLayout = "portrait" | "landscape" | "a4";

type EventRow = {
  id: string;
  name: string;
  slug: string;
  date: string | null;
  frame_url: string | null;
  bg_url: string | null;
  description: string | null;
  print_layout: PrintLayout;
  photo_count: number;
  created_at: string;
  owner_id: string | null;
  access_code: string | null;
  access_code_hash: string | null;
};

const PRINT_LAYOUT_LABEL: Record<PrintLayout, string> = {
  portrait: "10x15 Retrato",
  landscape: "10x15 Paisagem",
  a4: "A4",
};

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminDashboard,
  head: () => ({ meta: [{ title: "Painel — Xis Photo Booth" }] }),
});

function generateAccessCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function AdminDashboard() {
  const { user } = Route.useRouteContext() as { user: { id: string; email?: string } };
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [shareFor, setShareFor] = useState<{ event: EventRow; code?: string } | null>(null);
  const [editing, setEditing] = useState<EventRow | null>(null);

  const eventsQ = useQuery({
    queryKey: ["events", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as EventRow[];
    },
  });

  const countsQ = useQuery({
    queryKey: ["photo-counts", user.id],
    queryFn: async () => {
      const ids = (eventsQ.data ?? []).map((e) => e.id);
      if (ids.length === 0) return {} as Record<string, number>;
      const { data, error } = await supabase
        .from("photos")
        .select("event_id")
        .in("event_id", ids);
      if (error) throw error;
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: { event_id: string }) => {
        m[r.event_id] = (m[r.event_id] ?? 0) + 1;
      });
      return m;
    },
    enabled: !!eventsQ.data,
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("events").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Evento excluído");
      qc.invalidateQueries({ queryKey: ["events", user.id] });
      qc.invalidateQueries({ queryKey: ["photo-counts", user.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    window.location.assign("/auth");
  }

  return (
    <div className="min-h-screen bg-blob">
      <header className="border-b border-border/60 backdrop-blur-sm bg-background/60 sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src={xisLogo.url} alt="Xis Photo Booth" className="h-12 w-auto" />
            <div className="hidden sm:block">
              <div className="text-xs text-muted-foreground">Painel do Administrador</div>
              {user.email && <div className="text-xs text-muted-foreground/80">{user.email}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-full gap-2">
                  <Plus className="size-4" />
                  <span className="hidden sm:inline">Novo evento</span>
                </Button>
              </DialogTrigger>
              <CreateEventDialog
                ownerId={user.id}
                onCreated={(event, code) => {
                  setCreateOpen(false);
                  setShareFor({ event, code });
                }}
              />
            </Dialog>
            <Button onClick={signOut} variant="ghost" size="icon" className="rounded-full" title="Sair">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-8 sm:mb-12">
          <h1 className="font-display text-4xl sm:text-5xl font-bold">Seus eventos</h1>
          <p className="mt-2 text-muted-foreground">
            Crie um evento, envie uma moldura e compartilhe o link com a senha para os convidados.
          </p>
        </div>

        {eventsQ.isLoading && (
          <div className="grid place-items-center py-20 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}

        {eventsQ.data && eventsQ.data.length === 0 && (
          <div className="card-soft p-10 text-center">
            <div className="mx-auto mb-4 size-14 rounded-2xl bg-accent grid place-items-center">
              <Camera className="size-7 text-accent-foreground" />
            </div>
            <h2 className="font-display text-2xl font-bold">Nenhum evento ainda</h2>
            <p className="mt-2 text-sm text-muted-foreground">Crie seu primeiro evento para abrir a cabine de fotos.</p>
            <Button onClick={() => setCreateOpen(true)} className="mt-6 rounded-full gap-2">
              <Plus className="size-4" /> Criar evento
            </Button>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {eventsQ.data?.map((ev) => (
            <article key={ev.id} className="card-soft overflow-hidden flex flex-col">
              <div className="aspect-[4/3] bg-muted relative overflow-hidden">
                {ev.frame_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ev.frame_url}
                    alt={`Moldura de ${ev.name}`}
                    className="absolute inset-0 size-full object-contain p-3 bg-[conic-gradient(at_30%_30%,oklch(0.93_0.05_98),oklch(0.97_0.03_98))]"
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                    <ImageIcon className="size-8" />
                  </div>
                )}
              </div>
              <div className="p-5 flex-1 flex flex-col gap-3">
                <div>
                  <h3 className="font-display text-xl font-bold leading-tight">{ev.name}</h3>
                  <div className="mt-1 text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
                    {ev.date && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="size-3.5" />
                        {new Date(ev.date).toLocaleDateString("pt-BR")}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <ImageIcon className="size-3.5" />
                      {countsQ.data?.[ev.id] ?? 0} fotos
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Printer className="size-3.5" />
                      {PRINT_LAYOUT_LABEL[ev.print_layout ?? "portrait"]}
                    </span>
                  </div>
                  {ev.description && (
                    <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{ev.description}</p>
                  )}
                  {ev.access_code && (
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary/10 border border-primary/20 px-3 py-1.5 text-sm">
                      <KeyRound className="size-3.5 text-primary" />
                      <span className="text-muted-foreground">Senha:</span>
                      <span className="font-display font-bold tracking-[0.25em] text-primary">{ev.access_code}</span>
                    </div>
                  )}
                </div>
                <div className="mt-auto flex items-center gap-2 flex-wrap">
                  <Button variant="secondary" size="sm" className="rounded-full gap-1.5" onClick={() => setShareFor({ event: ev })}>
                    <Share2 className="size-3.5" /> Compartilhar
                  </Button>
                  <Button variant="secondary" size="sm" className="rounded-full gap-1.5" onClick={() => setEditing(ev)}>
                    <Pencil className="size-3.5" /> Editar
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="rounded-full gap-1.5">
                    <Link to="/event/$slug" params={{ slug: ev.slug }}>
                      <ExternalLink className="size-3.5" /> Abrir
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto rounded-full text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Excluir "${ev.name}"? Isso remove todas as fotos do evento.`)) delMut.mutate(ev.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>

      <ShareDialog
        event={shareFor?.event ?? null}
        accessCode={shareFor?.code}
        onClose={() => setShareFor(null)}
      />

      <EditEventDialog
        event={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["events", user.id] });
        }}
      />
    </div>
  );
}

function EventFormFields({
  values, onChange,
}: {
  values: {
    name: string;
    date: string;
    photoCount: 1 | 2 | 3 | 4;
    description: string;
    printLayout: PrintLayout;
    frame: File | null;
    bg: File | null;
    framePreview: string | null;
    bgPreview: string | null;
    existingFrameUrl?: string | null;
    existingBgUrl?: string | null;
  };
  onChange: (patch: Partial<typeof values>) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="name">Nome do evento</Label>
        <Input id="name" value={values.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Aniversário da Amanda" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="date">Data do evento</Label>
        <Input id="date" type="date" value={values.date} onChange={(e) => onChange({ date: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="desc">Mensagem de boas-vindas (opcional)</Label>
        <Textarea
          id="desc"
          rows={3}
          value={values.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Boas-vindas ao casamento! Capture momentos e divirta-se."
        />
        <p className="text-xs text-muted-foreground">Aparece para os convidados na tela inicial da cabine.</p>
      </div>
      <div className="space-y-2">
        <Label>Fotos por moldura</Label>
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange({ photoCount: n as 1 | 2 | 3 | 4 })}
              className={`h-12 rounded-lg border text-base font-semibold transition ${
                values.photoCount === n
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="layout">Formato de impressão</Label>
        <select
          id="layout"
          value={values.printLayout}
          onChange={(e) => onChange({ printLayout: e.target.value as PrintLayout })}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="portrait">10x15 Retrato</option>
          <option value="landscape">10x15 Paisagem</option>
          <option value="a4">A4</option>
        </select>
        <p className="text-xs text-muted-foreground">Define o tamanho da composição final e da página de impressão.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="frame">Moldura (PNG transparente)</Label>
        <Input
          id="frame"
          type="file"
          accept="image/png,image/webp"
          onChange={(e) => onChange({ frame: e.target.files?.[0] ?? null })}
        />
        {(values.framePreview || values.existingFrameUrl) && (
          <div className="mt-2 aspect-[3/4] max-h-56 rounded-lg border border-border overflow-hidden bg-[conic-gradient(at_30%_30%,oklch(0.93_0.05_98),oklch(0.97_0.03_98))]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={values.framePreview ?? values.existingFrameUrl ?? ""} alt="Moldura" className="size-full object-contain" />
          </div>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="bg">Imagem de fundo do convidado (opcional)</Label>
        <Input
          id="bg"
          type="file"
          accept="image/*"
          onChange={(e) => onChange({ bg: e.target.files?.[0] ?? null })}
        />
        {(values.bgPreview || values.existingBgUrl) && (
          <div className="mt-2 aspect-video max-h-40 rounded-lg border border-border overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={values.bgPreview ?? values.existingBgUrl ?? ""} alt="Fundo" className="size-full object-cover" />
          </div>
        )}
        <p className="text-xs text-muted-foreground">Será aplicada como plano de fundo da página da cabine.</p>
      </div>
    </>
  );
}

function CreateEventDialog({
  ownerId, onCreated,
}: { ownerId: string; onCreated: (event: EventRow, code: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [photoCount, setPhotoCount] = useState<1 | 2 | 3 | 4>(4);
  const [description, setDescription] = useState("");
  const [printLayout, setPrintLayout] = useState<PrintLayout>("portrait");
  const [frame, setFrame] = useState<File | null>(null);
  const [bg, setBg] = useState<File | null>(null);
  const [framePreview, setFramePreview] = useState<string | null>(null);
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!frame) { setFramePreview(null); return; }
    const url = URL.createObjectURL(frame);
    setFramePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [frame]);

  useEffect(() => {
    if (!bg) { setBgPreview(null); return; }
    const url = URL.createObjectURL(bg);
    setBgPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [bg]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Informe o nome do evento");
    setBusy(true);
    try {
      const slug = uniqueSlug(name);
      const code = generateAccessCode();

      let frame_url: string | null = null;
      if (frame) {
        frame_url = await uploadAndSign("event-frames", `${slug}/${Date.now()}-${frame.name}`, frame, frame.type);
      }
      let bg_url: string | null = null;
      if (bg) {
        bg_url = await uploadAndSign("event-frames", `${slug}/bg-${Date.now()}-${bg.name}`, bg, bg.type);
      }
      const insert = {
        name: name.trim(),
        slug,
        date: date || null,
        frame_url,
        bg_url,
        description: description.trim() || null,
        print_layout: printLayout,
        photo_count: photoCount,
        owner_id: ownerId,
        access_code: code,
      };
      const { data, error } = await supabase
        .from("events")
        .insert(insert as never)
        .select("*")
        .single();
      if (error) throw error;
      toast.success("Evento criado");
      qc.invalidateQueries({ queryKey: ["events", ownerId] });
      onCreated(data as unknown as EventRow, code);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="font-display text-2xl">Criar novo evento</DialogTitle>
        <DialogDescription>
          Configure a cabine em segundos. Uma senha de 6 dígitos será gerada para você compartilhar
          com os convidados junto ao link.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <EventFormFields
          values={{
            name, date, photoCount, description, printLayout,
            frame, bg, framePreview, bgPreview,
          }}
          onChange={(p) => {
            if (p.name !== undefined) setName(p.name);
            if (p.date !== undefined) setDate(p.date);
            if (p.photoCount !== undefined) setPhotoCount(p.photoCount);
            if (p.description !== undefined) setDescription(p.description);
            if (p.printLayout !== undefined) setPrintLayout(p.printLayout);
            if (p.frame !== undefined) setFrame(p.frame);
            if (p.bg !== undefined) setBg(p.bg);
          }}
        />
        <DialogFooter>
          <Button type="submit" disabled={busy} className="rounded-full gap-2">
            {busy && <Loader2 className="size-4 animate-spin" />}
            Criar evento
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function EditEventDialog({
  event, onClose, onSaved,
}: { event: EventRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [photoCount, setPhotoCount] = useState<1 | 2 | 3 | 4>(4);
  const [description, setDescription] = useState("");
  const [printLayout, setPrintLayout] = useState<PrintLayout>("portrait");
  const [frame, setFrame] = useState<File | null>(null);
  const [bg, setBg] = useState<File | null>(null);
  const [framePreview, setFramePreview] = useState<string | null>(null);
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!event) return;
    setName(event.name);
    setDate(event.date ?? "");
    setPhotoCount((event.photo_count as 1 | 2 | 3 | 4) || 4);
    setDescription(event.description ?? "");
    setPrintLayout(event.print_layout ?? "portrait");
    setFrame(null);
    setBg(null);
  }, [event]);

  useEffect(() => {
    if (!frame) { setFramePreview(null); return; }
    const url = URL.createObjectURL(frame);
    setFramePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [frame]);

  useEffect(() => {
    if (!bg) { setBgPreview(null); return; }
    const url = URL.createObjectURL(bg);
    setBgPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [bg]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!event) return;
    if (!name.trim()) return toast.error("Informe o nome do evento");
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {
        name: name.trim(),
        date: date || null,
        photo_count: photoCount,
        description: description.trim() || null,
        print_layout: printLayout,
      };
      if (frame) {
        patch.frame_url = await uploadAndSign("event-frames", `${event.slug}/${Date.now()}-${frame.name}`, frame, frame.type);
      }
      if (bg) {
        patch.bg_url = await uploadAndSign("event-frames", `${event.slug}/bg-${Date.now()}-${bg.name}`, bg, bg.type);
      }
      const { error } = await supabase.from("events").update(patch as never).eq("id", event.id);
      if (error) throw error;
      toast.success("Evento atualizado");
      onSaved();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Editar evento</DialogTitle>
          <DialogDescription>Atualize os detalhes e personalizações da cabine.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <EventFormFields
            values={{
              name, date, photoCount, description, printLayout,
              frame, bg, framePreview, bgPreview,
              existingFrameUrl: event?.frame_url ?? null,
              existingBgUrl: event?.bg_url ?? null,
            }}
            onChange={(p) => {
              if (p.name !== undefined) setName(p.name);
              if (p.date !== undefined) setDate(p.date);
              if (p.photoCount !== undefined) setPhotoCount(p.photoCount);
              if (p.description !== undefined) setDescription(p.description);
              if (p.printLayout !== undefined) setPrintLayout(p.printLayout);
              if (p.frame !== undefined) setFrame(p.frame);
              if (p.bg !== undefined) setBg(p.bg);
            }}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy} className="rounded-full gap-2">
              {busy && <Loader2 className="size-4 animate-spin" />}
              Salvar alterações
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({
  event, accessCode, onClose,
}: { event: EventRow | null; accessCode?: string; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = event && typeof window !== "undefined"
    ? `${window.location.origin}/event/${event.slug}`
    : "";
  const codeToShow = accessCode ?? event?.access_code ?? null;

  useEffect(() => {
    if (!event || !url) return;
    QRCode.toDataURL(url, { width: 512, margin: 1, color: { dark: "#0e524a", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [event, url]);

  async function copyAll() {
    const text = codeToShow
      ? `${event?.name}\nLink: ${url}\nSenha: ${codeToShow}`
      : url;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copiado para a área de transferência");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2">
            <QrCode className="size-5" /> Compartilhar cabine
          </DialogTitle>
          <DialogDescription>
            Os convidados escaneiam este código ou abrem o link e informam a senha do evento{" "}
            <span className="font-semibold text-foreground">{event?.name}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-2xl bg-white p-3 shadow-sm border border-border">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR Code" className="size-56" />
            ) : (
              <div className="size-56 grid place-items-center"><Loader2 className="animate-spin" /></div>
            )}
          </div>

          {codeToShow ? (
            <div className="w-full rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 text-center">
              <div className="text-xs uppercase tracking-widest text-muted-foreground flex items-center justify-center gap-1.5">
                <KeyRound className="size-3.5" /> Senha do evento
              </div>
              <div className="mt-1 font-display text-4xl font-bold tracking-[0.4em] text-primary">
                {codeToShow}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Compartilhe com os convidados junto ao link. Você pode consultá-la a qualquer momento aqui.
              </p>
            </div>
          ) : (
            <div className="w-full rounded-xl border border-dashed border-border bg-muted/40 p-3 text-center text-xs text-muted-foreground">
              <KeyRound className="inline size-3.5 mr-1 -mt-0.5" />
              Este evento foi criado antes do armazenamento de senhas. Crie um novo evento para gerar uma senha visível.
            </div>
          )}

          <div className="w-full flex items-center gap-2 rounded-full border border-input bg-background px-3 py-2">
            <span className="truncate text-sm text-muted-foreground flex-1">{url}</span>
            <Button size="sm" variant="ghost" className="rounded-full gap-1.5" onClick={copyAll}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copiado" : codeToShow ? "Copiar tudo" : "Copiar link"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
