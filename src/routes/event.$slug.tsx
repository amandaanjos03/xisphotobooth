import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uploadAndSign } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Camera, Printer, Download, RotateCcw, Loader2,
  ChevronLeft, ChevronRight, Upload, KeyRound, Trash2,
  RefreshCw, Maximize2, Minimize2, Video, Square, Play,
} from "lucide-react";
import { toast } from "sonner";
import { PhotoViewer, downloadPhoto, printPhoto } from "@/components/PhotoViewer";

type PrintLayout = "portrait" | "landscape" | "a4";
type OverlayType = "frame" | "logo";
type LogoPosition = "top" | "bottom" | "left" | "right";

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
  overlay_type: OverlayType;
  logo_url: string | null;
  logo_position: LogoPosition;
  logo_size: number;
  requires_code: boolean;
};

export const Route = createFileRoute("/event/$slug")({
  component: BoothPage,
  loader: async ({ params }) => {
    const { data, error } = await supabase
      .from("events")
      .select("id, name, slug, date, frame_url, bg_url, description, print_layout, photo_count, overlay_type, logo_url, logo_position, logo_size, requires_code")
      .eq("slug", params.slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    return { event: data as unknown as EventRow };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.event.name} — Xis Photo Booth` : "Xis Photo Booth" },
      { name: "description", content: "Sorria e capture uma lembrança." },
    ],
  }),
  notFoundComponent: () => (
    <div className="min-h-screen bg-blob grid place-items-center px-4">
      <div className="card-soft p-8 max-w-md text-center">
        <h1 className="font-display text-3xl font-bold">Evento não encontrado</h1>
        <p className="mt-2 text-muted-foreground">Este link de cabine é inválido ou foi removido.</p>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen bg-blob grid place-items-center px-4">
      <div className="card-soft p-8 max-w-md text-center">
        <h1 className="font-display text-2xl font-bold">Ops, algo deu errado</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </div>
    </div>
  ),
});

type Phase = "welcome" | "capture" | "upload" | "record-video" | "composing" | "done";
type UploadSource = "camera" | "gallery";
type MediaType = "image" | "video";

const ACCESS_KEY_PREFIX = "xis:access:";

function BoothPage() {
  const { event } = Route.useLoaderData();
  const [phase, setPhase] = useState<Phase>("welcome");
  const [uploadSource, setUploadSource] = useState<UploadSource>("gallery");
  const [finalPhoto, setFinalPhoto] = useState<{ id: string; url: string; mediaType: MediaType } | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Persist unlock in sessionStorage so refreshing the kiosk doesn't re-prompt the guest.
  // If signed in as an admin, skip the access gate entirely.
  // If the event doesn't require a code, unlock immediately.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!event.requires_code) {
      setUnlocked(true);
      setCheckingAuth(false);
      return;
    }
    if (window.sessionStorage.getItem(ACCESS_KEY_PREFIX + event.slug) === "1") {
      setUnlocked(true);
      setCheckingAuth(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!cancelled && userData.user) {
        const { data: roleRow } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userData.user.id)
          .eq("role", "admin")
          .maybeSingle();
        if (!cancelled && roleRow) {
          setUnlocked(true);
        }
      }
      if (!cancelled) setCheckingAuth(false);
    })();
    return () => { cancelled = true; };
  }, [event.slug, event.requires_code]);

  function reset() {
    setFinalPhoto(null);
    setPhase("welcome");
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-blob grid place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!unlocked) {
    return <AccessGate event={event} onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <div
      className="min-h-screen bg-blob bg-cover bg-center bg-no-repeat"
      style={event.bg_url ? { backgroundImage: `linear-gradient(oklch(0.965 0.05 98 / 0.78), oklch(0.965 0.05 98 / 0.88)), url("${event.bg_url}")` } : undefined}
    >
      <PrintPageStyle layout={event.print_layout ?? "portrait"} />
      <header className="no-print border-b border-border/50 bg-background/60 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3 flex items-center justify-end gap-2">
          <FullScreenToggle />
          <div className="text-xs uppercase tracking-widest text-muted-foreground hidden sm:block">Xis Photo Booth</div>
        </div>
      </header>

      {phase === "welcome" && (
        <Welcome
          event={event}
          onStart={() => setPhase("capture")}
          onUpload={(src) => { setUploadSource(src); setPhase("upload"); }}
          onRecordVideo={() => setPhase("record-video")}
        />
      )}
      {phase === "capture" && (
        <CaptureFlow
          event={event}
          onDone={(photo) => { setFinalPhoto({ ...photo, mediaType: "image" }); setPhase("done"); }}
          onCancel={reset}
          onComposing={() => setPhase("composing")}
        />
      )}
      {phase === "upload" && (
        <UploadFlow
          event={event}
          source={uploadSource}
          onDone={(item) => { setFinalPhoto(item); setPhase("done"); }}
          onCancel={reset}
          onComposing={() => setPhase("composing")}
        />
      )}
      {phase === "record-video" && (
        <RecordVideoFlow
          event={event}
          onDone={(item) => { setFinalPhoto(item); setPhase("done"); }}
          onCancel={reset}
          onUploading={() => setPhase("composing")}
        />
      )}
      {phase === "composing" && (
        <div className="grid place-items-center py-32 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <p className="mt-4 font-display text-lg">Enviando sua mídia…</p>
        </div>
      )}
      {phase === "done" && finalPhoto && (
        <DoneScreen event={event} photo={finalPhoto} onReset={reset} />
      )}
    </div>
  );
}

function PrintPageStyle({ layout }: { layout: PrintLayout }) {
  useEffect(() => {
    const id = "dyn-print-page";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    const size =
      layout === "landscape" ? "15cm 10cm" :
      layout === "a4" ? "A4" :
      "10cm 15cm";
    el.innerHTML = `@media print { @page { size: ${size}; margin: 0; } }`;
    return () => { el?.remove(); };
  }, [layout]);
  return null;
}

function FullScreenToggle() {
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Button onClick={toggle} variant="ghost" size="sm" className="rounded-full gap-1.5">
      {isFs ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      <span className="hidden sm:inline">{isFs ? "Sair da tela cheia" : "Tela cheia"}</span>
    </Button>
  );
}

function AccessGate({ event, onUnlock }: { event: EventRow; onUnlock: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc(
      "verify_event_code" as never,
      { _slug: event.slug, _code: code.trim() } as never,
    );
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data === true) {
      window.sessionStorage.setItem(ACCESS_KEY_PREFIX + event.slug, "1");
      onUnlock();
    } else {
      toast.error("Senha incorreta. Confira com o anfitrião do evento.");
    }
  }

  return (
    <div className="min-h-screen bg-blob grid place-items-center px-4">
      <div className="card-soft p-8 max-w-md w-full text-center">
        <div className="mx-auto size-14 rounded-2xl bg-accent grid place-items-center">
          <KeyRound className="size-7 text-accent-foreground" />
        </div>
        <h1 className="mt-4 font-display text-3xl font-bold">{event.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Informe a senha do evento que o anfitrião compartilhou junto com o link.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <Label htmlFor="code" className="sr-only">Senha do evento</Label>
          <Input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="text-center text-3xl tracking-[0.4em] h-16 font-display"
            maxLength={12}
            required
          />
          <Button type="submit" disabled={busy} className="w-full rounded-full h-12 text-base">
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Entrar na cabine"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Welcome({
  event, onStart, onUpload, onRecordVideo,
}: { event: EventRow; onStart: () => void; onUpload: (src: UploadSource) => void; onRecordVideo: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-20 text-center">
      <div className="inline-flex items-center gap-2 rounded-full bg-accent/60 px-4 py-1.5 text-sm font-medium text-accent-foreground">
        <Camera className="size-3.5" /> Cabine de Fotos
      </div>
      <h1 className="mt-6 font-display text-5xl sm:text-7xl font-bold leading-tight">{event.name}</h1>
      {event.date && (
        <p className="mt-3 text-muted-foreground text-lg">
          {new Date(event.date).toLocaleDateString("pt-BR", { dateStyle: "long" })}
        </p>
      )}
      {event.description ? (
        <p className="mx-auto mt-6 max-w-xl text-foreground/80 whitespace-pre-wrap">
          {event.description}
        </p>
      ) : (
        <p className="mx-auto mt-6 max-w-md text-muted-foreground">
          Prepare-se — vamos capturar {event.photo_count} foto{event.photo_count === 1 ? "" : "s"} com contagem regressiva de 3 segundos. Você também pode gravar um vídeo curto ou enviar mídias do seu dispositivo.
        </p>
      )}
      <div className="mt-10 flex flex-col items-center justify-center gap-3">
        <button
          onClick={onStart}
          className="inline-flex items-center gap-3 rounded-full bg-primary px-10 py-5 sm:px-14 sm:py-6 text-xl sm:text-2xl font-semibold text-primary-foreground shadow-[0_20px_50px_-15px_oklch(0.42_0.075_188/0.55)] transition active:scale-95 hover:opacity-95"
        >
          <Camera className="size-6 sm:size-7" />
          Tirar Fotos (com cabine)
        </button>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto justify-center">
          <button
            onClick={onRecordVideo}
            className="inline-flex items-center gap-2 rounded-full bg-secondary px-6 py-3 text-base font-semibold text-secondary-foreground border border-border transition active:scale-95 hover:bg-accent"
          >
            <Video className="size-4" /> Gravar Vídeo
          </button>
          <button
            onClick={() => onUpload("gallery")}
            className="inline-flex items-center gap-2 rounded-full bg-secondary px-6 py-3 text-base font-semibold text-secondary-foreground border border-border transition active:scale-95 hover:bg-accent"
          >
            <Upload className="size-4" /> Enviar Foto ou Vídeo
          </button>
        </div>
      </div>
      <AlbumGrid event={event} />
    </div>
  );
}

function AlbumGrid({ event }: { event: EventRow }) {
  const PAGE_SIZE = 12;
  const [page, setPage] = useState(0);
  const [viewing, setViewing] = useState<{ id: string; photo_url: string; media_type: MediaType } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const q = useQuery({
    queryKey: ["photos", event.id, "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("photos")
        .select("id, photo_url, media_type")
        .eq("event_id", event.id)
        .eq("hidden", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as { id: string; photo_url: string; media_type: MediaType }[];
    },
    refetchOnWindowFocus: false,
  });

  if (q.isLoading) {
    return (
      <div className="mt-12 grid place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const photos = q.data ?? [];
  if (photos.length === 0) return null;

  const totalPages = Math.max(1, Math.ceil(photos.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const slice = photos.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  async function downloadAll() {
    setDownloading(true);
    try {
      for (let i = 0; i < photos.length; i++) {
        const ext = photos[i].media_type === "video" ? "mp4" : "jpg";
        await downloadPhoto(photos[i].photo_url, `${event.slug}-${i + 1}.${ext}`);
        await new Promise((r) => setTimeout(r, 250));
      }
      toast.success("Download iniciado");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mt-14 text-left">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold">Álbum do evento</h2>
          <p className="text-sm text-muted-foreground">
            {photos.length} item{photos.length === 1 ? "" : "s"} • Página {safePage + 1} de {totalPages}
          </p>
        </div>
        <Button
          onClick={downloadAll}
          disabled={downloading}
          className="rounded-full gap-2"
          variant="secondary"
        >
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Baixar todas as mídias
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {slice.map((p, i) => {
          const absoluteIndex = safePage * PAGE_SIZE + i + 1;
          const isVideo = p.media_type === "video";
          const ext = isVideo ? "mp4" : "jpg";
          return (
            <div
              key={p.id}
              className="group relative aspect-square overflow-hidden rounded-xl bg-muted card-soft"
            >
              <button
                onClick={() => {
                  if (isVideo) window.open(p.photo_url, "_blank", "noopener");
                  else setViewing(p);
                }}
                className="absolute inset-0 transition active:scale-95"
                aria-label={`Ver mídia ${absoluteIndex}`}
              >
                {isVideo ? (
                  <>
                    <video
                      src={p.photo_url}
                      preload="metadata"
                      muted
                      playsInline
                      className="size-full object-cover"
                    />
                    <div className="absolute inset-0 grid place-items-center bg-black/30">
                      <div className="size-12 rounded-full bg-white/90 grid place-items-center">
                        <Play className="size-5 text-foreground" />
                      </div>
                    </div>
                  </>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={p.photo_url}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover transition-transform group-hover:scale-105"
                  />
                )}
              </button>
              <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition">
                {!isVideo && (
                  <button
                    onClick={() => printPhoto(p.photo_url)}
                    className="size-8 grid place-items-center rounded-full bg-background/90 backdrop-blur-sm shadow hover:bg-background"
                    aria-label="Imprimir"
                    title="Imprimir"
                  >
                    <Printer className="size-4" />
                  </button>
                )}
                <button
                  onClick={() => downloadPhoto(p.photo_url, `${event.slug}-${absoluteIndex}.${ext}`)}
                  className="size-8 grid place-items-center rounded-full bg-background/90 backdrop-blur-sm shadow hover:bg-background"
                  aria-label="Baixar"
                  title="Baixar"
                >
                  <Download className="size-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
          >
            <ChevronLeft className="size-4" /> Anterior
          </Button>
          <span className="text-sm text-muted-foreground px-2">
            {safePage + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
          >
            Próxima <ChevronRight className="size-4" />
          </Button>
        </div>
      )}

      <PhotoViewer
        url={viewing?.photo_url ?? null}
        filename={`${event.slug}-${viewing?.id ?? ""}.jpg`}
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
      />
    </div>
  );
}

const TARGET_W = 720;
const TARGET_H = 960; // 3:4 portrait per shot

async function finalizeAndUpload(
  shots: string[],
  event: EventRow,
  count: number,
): Promise<{ id: string; url: string }> {
  const blob = await composeStrip(shots, event, count);
  const path = `${event.slug}/${Date.now()}.jpg`;
  const url = await uploadAndSign("event-photos", path, blob, "image/jpeg");
  const { data, error } = await supabase
    .from("photos")
    .insert({ event_id: event.id, photo_url: url })
    .select("id")
    .single();
  if (error) throw error;
  return { id: (data as { id: string }).id, url };
}

function CaptureFlow({
  event, onDone, onCancel, onComposing,
}: {
  event: EventRow;
  onDone: (photo: { id: string; url: string }) => void;
  onCancel: () => void;
  onComposing: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [shotIndex, setShotIndex] = useState(0);
  const [flash, setFlash] = useState(false);
  const [shots, setShots] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    (async () => {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (e) {
        setError((e as Error).message || "Acesso à câmera negado");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  async function flipCamera() {
    setSwitching(true);
    setFacing((f) => (f === "user" ? "environment" : "user"));
    setTimeout(() => setSwitching(false), 400);
  }

  const mirror = facing === "user";

  const captureFrame = useCallback((): string => {
    const v = videoRef.current!;
    const canvas = document.createElement("canvas");
    canvas.width = TARGET_W;
    canvas.height = TARGET_H;
    const ctx = canvas.getContext("2d")!;
    const vw = v.videoWidth, vh = v.videoHeight;
    const targetRatio = TARGET_W / TARGET_H;
    const videoRatio = vw / vh;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (videoRatio > targetRatio) {
      sw = vh * targetRatio;
      sx = (vw - sw) / 2;
    } else {
      sh = vw / targetRatio;
      sy = (vh - sh) / 2;
    }
    ctx.save();
    if (mirror) {
      ctx.translate(TARGET_W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, TARGET_W, TARGET_H);
    ctx.restore();
    return canvas.toDataURL("image/jpeg", 0.92);
  }, [mirror]);

  useEffect(() => {
    if (!ready || error) return;
    if (shotIndex >= event.photo_count) return;

    let alive = true;
    const initialDelay = shotIndex === 0 ? 800 : 2000;

    const t0 = setTimeout(() => {
      if (!alive) return;
      let n = 3;
      setCountdown(n);
      const tick = setInterval(() => {
        n -= 1;
        if (!alive) return;
        if (n > 0) {
          setCountdown(n);
        } else {
          clearInterval(tick);
          setCountdown(null);
          const data = captureFrame();
          setFlash(true);
          setTimeout(() => setFlash(false), 180);
          setShots((s) => [...s, data]);
          setShotIndex((i) => i + 1);
        }
      }, 1000);
    }, initialDelay);

    return () => { alive = false; clearTimeout(t0); };
  }, [ready, shotIndex, captureFrame, error, event.photo_count]);

  useEffect(() => {
    if (shots.length < event.photo_count) return;
    onComposing();
    (async () => {
      try {
        const photo = await finalizeAndUpload(shots, event, event.photo_count);
        onDone(photo);
      } catch (e) {
        toast.error((e as Error).message);
        onCancel();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots]);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="card-soft p-8">
          <h2 className="font-display text-2xl font-bold">Câmera indisponível</h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <p className="mt-2 text-sm text-muted-foreground">Permita o acesso à câmera e tente novamente.</p>
          <Button onClick={onCancel} className="mt-6 rounded-full">Voltar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      <div className="card-soft overflow-hidden relative aspect-[3/4] sm:aspect-[4/3]">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`absolute inset-0 size-full object-cover bg-black ${mirror ? "[transform:scaleX(-1)]" : ""}`}
        />
        <button
          type="button"
          onClick={flipCamera}
          disabled={switching}
          className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur px-3 py-2 text-white text-sm hover:bg-black/70 transition disabled:opacity-50"
          title="Alternar câmera"
        >
          <RefreshCw className={`size-4 ${switching ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Alternar câmera</span>
        </button>
        {flash && <div className="absolute inset-0 bg-white animate-[pulse_180ms_ease-out]" />}
        {countdown !== null && (
          <div className="absolute inset-0 grid place-items-center bg-black/30">
            <div
              key={countdown}
              className="font-display text-white font-black text-[14rem] leading-none drop-shadow-[0_8px_30px_rgba(0,0,0,0.5)] animate-in zoom-in-50 duration-300"
            >
              {countdown}
            </div>
          </div>
        )}

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 p-2 rounded-2xl bg-black/40 backdrop-blur-sm">
          {Array.from({ length: event.photo_count }, (_, i) => i).map((i) => (
            <div key={i} className="size-14 sm:size-16 rounded-md overflow-hidden border-2 border-white/70 bg-black/30">
              {shots[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shots[i]} alt="" className="size-full object-cover" />
              ) : (
                <div className="size-full grid place-items-center text-white/70 text-xs font-semibold">{i + 1}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {ready ? `Foto ${Math.min(shotIndex + 1, event.photo_count)} de ${event.photo_count}` : "Iniciando câmera…"}
        </div>
        <Button variant="ghost" onClick={onCancel} className="rounded-full">Cancelar</Button>
      </div>
    </div>
  );
}

function UploadFlow({
  event, source, onDone, onCancel, onComposing,
}: {
  event: EventRow;
  source: UploadSource;
  onDone: (item: { id: string; url: string; mediaType: MediaType }) => void;
  onCancel: () => void;
  onComposing: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<{ url: string; isVideo: boolean }[]>([]);
  const [busy, setBusy] = useState(false);

  // Open picker right away so guests don't see an empty intermediate screen.
  useEffect(() => {
    inputRef.current?.click();
  }, []);

  useEffect(() => {
    if (files.length === 0) { setPreviews([]); return; }
    const items = files.map((f) => ({ url: URL.createObjectURL(f), isVideo: f.type.startsWith("video/") }));
    setPreviews(items);
    return () => items.forEach((p) => URL.revokeObjectURL(p.url));
  }, [files]);

  const hasVideo = files.some((f) => f.type.startsWith("video/"));

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const arr = Array.from(list).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (arr.length === 0) return;
    // If a video is selected, only keep one file (videos uploaded as-is)
    const video = arr.find((f) => f.type.startsWith("video/"));
    if (video) {
      setFiles([video]);
    } else {
      setFiles(arr.slice(0, event.photo_count));
    }
  }

  async function readAsDataUrl(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = TARGET_W;
      canvas.height = TARGET_H;
      const ctx = canvas.getContext("2d")!;
      const ir = img.width / img.height, tr = TARGET_W / TARGET_H;
      let sw = img.width, sh = img.height, sx = 0, sy = 0;
      if (ir > tr) { sw = img.height * tr; sx = (img.width - sw) / 2; }
      else { sh = img.width / tr; sy = (img.height - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TARGET_W, TARGET_H);
      return canvas.toDataURL("image/jpeg", 0.92);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function submit() {
    if (files.length === 0) return toast.error("Selecione ao menos uma mídia");
    setBusy(true);
    onComposing();
    try {
      if (hasVideo) {
        const file = files[0];
        const result = await uploadVideoAndInsert(file, event);
        onDone({ ...result, mediaType: "video" });
      } else {
        const shots = await Promise.all(files.map(readAsDataUrl));
        while (shots.length < event.photo_count) shots.push(shots[shots.length - 1]);
        const photo = await finalizeAndUpload(shots, event, event.photo_count);
        onDone({ ...photo, mediaType: "image" });
      }
    } catch (e) {
      toast.error((e as Error).message);
      onCancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-8 sm:py-12">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple={event.photo_count > 1}
        {...(source === "camera" ? { capture: "environment" as const } : {})}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="card-soft p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-2xl bg-accent grid place-items-center">
            <Upload className="size-6 text-accent-foreground" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold leading-tight">Enviar foto ou vídeo</h2>
            <p className="text-sm text-muted-foreground">
              Escolha imagens (até {event.photo_count}) para aplicar a moldura do evento, ou um vídeo que será publicado como está no álbum.
            </p>
          </div>
        </div>

        {previews.length > 0 && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {previews.map((p, i) => (
              <div key={i} className="aspect-[3/4] rounded-lg overflow-hidden bg-muted">
                {p.isVideo ? (
                  <video src={p.url} className="size-full object-cover" muted playsInline />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={p.url} alt={`Mídia ${i + 1}`} className="size-full object-cover" />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="rounded-full gap-2"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-4" />
            {previews.length === 0 ? "Escolher arquivo" : "Trocar seleção"}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={busy || files.length === 0}
            className="rounded-full gap-2"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Enviar para a galeria"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} className="rounded-full ml-auto">
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}

async function uploadVideoAndInsert(
  file: Blob,
  event: EventRow,
  ext?: string,
): Promise<{ id: string; url: string }> {
  const fileExt = ext ?? (file.type.includes("webm") ? "webm" : "mp4");
  const path = `${event.slug}/${Date.now()}.${fileExt}`;
  const url = await uploadAndSign("event-photos", path, file, file.type || "video/mp4");
  const { data, error } = await supabase
    .from("photos")
    .insert({ event_id: event.id, photo_url: url, media_type: "video" } as never)
    .select("id")
    .single();
  if (error) throw error;
  return { id: (data as { id: string }).id, url };
}

// ---- Video overlay helpers (frame/logo applied to videos) ----

function pickVideoMime(): string {
  const candidates = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

async function loadOverlay(event: EventRow): Promise<HTMLImageElement | null> {
  try {
    const overlayType = event.overlay_type ?? "frame";
    if (overlayType === "frame" && event.frame_url) return await loadImage(event.frame_url, true);
    if (overlayType === "logo" && event.logo_url) return await loadImage(event.logo_url, true);
  } catch (e) {
    console.warn("Overlay failed to load", e);
  }
  return null;
}

function drawVideoOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: HTMLImageElement,
  event: EventRow,
  W: number,
  H: number,
) {
  const overlayType = event.overlay_type ?? "frame";
  if (overlayType === "frame") {
    ctx.drawImage(overlay, 0, 0, W, H);
    return;
  }
  const sizePct = Math.max(5, Math.min(80, event.logo_size ?? 25)) / 100;
  const position: LogoPosition = event.logo_position ?? "bottom";
  const horizontal = position === "top" || position === "bottom";
  const ratio = overlay.width / overlay.height;
  let finalW: number, finalH: number;
  if (horizontal) {
    finalH = H * sizePct;
    finalW = finalH * ratio;
  } else {
    finalW = W * sizePct;
    finalH = finalW / ratio;
  }
  const margin = Math.round(Math.min(W, H) * 0.03);
  const maxW = W - margin * 2;
  const maxH = H - margin * 2;
  const scale = Math.min(1, maxW / finalW, maxH / finalH);
  finalW *= scale; finalH *= scale;
  let x = (W - finalW) / 2;
  let y = (H - finalH) / 2;
  if (position === "top") y = margin;
  else if (position === "bottom") y = H - finalH - margin;
  else if (position === "left") x = margin;
  else if (position === "right") x = W - finalW - margin;
  ctx.drawImage(overlay, x, y, finalW, finalH);
}

/**
 * Records a source <video> element to a Blob, compositing the event's overlay
 * (frame or logo) on top of each frame. Optionally mixes audio tracks.
 */
function recordVideoWithOverlay(
  source: HTMLVideoElement,
  audioTracks: MediaStreamTrack[],
  event: EventRow,
  overlay: HTMLImageElement | null,
  controls: { onStop?: (cb: () => void) => void; stopOnEnded?: boolean },
): Promise<{ blob: Blob; ext: "mp4" | "webm" }> {
  return new Promise((resolve, reject) => {
    const W = source.videoWidth || 1280;
    const H = source.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    let rafId = 0;
    const draw = () => {
      try {
        ctx.drawImage(source, 0, 0, W, H);
        if (overlay) drawVideoOverlay(ctx, overlay, event, W, H);
      } catch { /* frame not ready */ }
      rafId = requestAnimationFrame(draw);
    };
    draw();

    const canvasStream = canvas.captureStream(30);
    const outStream = new MediaStream();
    canvasStream.getVideoTracks().forEach((t) => outStream.addTrack(t));
    audioTracks.forEach((t) => outStream.addTrack(t));

    const mime = pickVideoMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(outStream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
      cancelAnimationFrame(rafId);
      reject(e as Error);
      return;
    }
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      cancelAnimationFrame(rafId);
      canvasStream.getTracks().forEach((t) => t.stop());
      const type = rec.mimeType || "video/webm";
      const ext: "mp4" | "webm" = type.includes("mp4") ? "mp4" : "webm";
      resolve({ blob: new Blob(chunks, { type }), ext });
    };
    rec.onerror = (e) => reject(new Error((e as unknown as { error?: { message?: string } }).error?.message || "Erro ao gravar"));

    const stop = () => { if (rec.state !== "inactive") rec.stop(); };
    controls.onStop?.(stop);
    if (controls.stopOnEnded) source.addEventListener("ended", stop, { once: true });

    rec.start();
  });
}

async function transcodeUploadedVideoWithOverlay(file: File, event: EventRow): Promise<{ blob: Blob; ext: "mp4" | "webm" }> {
  const overlay = await loadOverlay(event);
  if (!overlay) {
    const ext: "mp4" | "webm" = file.type.includes("webm") ? "webm" : "mp4";
    return { blob: file, ext };
  }

  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.src = url;
  v.playsInline = true;
  v.crossOrigin = "anonymous";
  // Keep playback silent in UI but capture audio from the element.
  v.volume = 0;

  await new Promise<void>((resolve, reject) => {
    v.onloadedmetadata = () => resolve();
    v.onerror = () => reject(new Error("Não foi possível ler o vídeo enviado"));
  });

  let audioTracks: MediaStreamTrack[] = [];
  try {
    const stream = (v as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    if (stream) audioTracks = stream.getAudioTracks();
  } catch { /* ignore */ }

  await v.play();
  try {
    return await recordVideoWithOverlay(v, audioTracks, event, overlay, { stopOnEnded: true });
  } finally {
    try { v.pause(); } catch { /* ignore */ }
    URL.revokeObjectURL(url);
  }
}



function RecordVideoFlow({
  event, onDone, onCancel, onUploading,
}: {
  event: EventRow;
  onDone: (item: { id: string; url: string; mediaType: MediaType }) => void;
  onCancel: () => void;
  onUploading: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const MAX_SECONDS = 30;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    (async () => {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (e) {
        setError((e as Error).message || "Acesso à câmera negado");
      }
    })();
    return () => {
      cancelled = true;
      try { recorderRef.current?.state === "recording" && recorderRef.current?.stop(); } catch {}
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      setElapsed((e) => {
        const next = e + 1;
        if (next >= MAX_SECONDS) stopRecording();
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  function pickMime(): string {
    const candidates = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    for (const c of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
    }
    return "";
  }

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mime = pickMime();
    try {
      const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const type = rec.mimeType || "video/webm";
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes("mp4") ? "mp4" : "webm";
        onUploading();
        try {
          const result = await uploadVideoAndInsert(blob, event, ext);
          onDone({ ...result, mediaType: "video" });
        } catch (e) {
          toast.error((e as Error).message);
          onCancel();
        }
      };
      rec.start();
      recorderRef.current = rec;
      setElapsed(0);
      setRecording(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    setRecording(false);
  }

  async function flipCamera() {
    if (recording) return;
    setFacing((f) => (f === "user" ? "environment" : "user"));
  }

  const mirror = facing === "user";

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="card-soft p-8">
          <h2 className="font-display text-2xl font-bold">Câmera indisponível</h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <p className="mt-2 text-sm text-muted-foreground">Permita o acesso à câmera e ao microfone para gravar vídeos.</p>
          <Button onClick={onCancel} className="mt-6 rounded-full">Voltar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      <div className="card-soft overflow-hidden relative aspect-[3/4] sm:aspect-video bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`absolute inset-0 size-full object-cover bg-black ${mirror ? "[transform:scaleX(-1)]" : ""}`}
        />
        <button
          type="button"
          onClick={flipCamera}
          disabled={recording}
          className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur px-3 py-2 text-white text-sm hover:bg-black/70 transition disabled:opacity-50"
          title="Alternar câmera"
        >
          <RefreshCw className="size-4" />
          <span className="hidden sm:inline">Alternar câmera</span>
        </button>
        {recording && (
          <div className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-full bg-red-600 px-3 py-1.5 text-white text-sm font-semibold">
            <span className="size-2 rounded-full bg-white animate-pulse" />
            REC {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")} / 0:{MAX_SECONDS}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {ready ? (recording ? "Gravando…" : "Pronto para gravar (até 30s)") : "Iniciando câmera…"}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onCancel} className="rounded-full" disabled={recording}>
            Cancelar
          </Button>
          {!recording ? (
            <Button onClick={startRecording} disabled={!ready} className="rounded-full gap-2 bg-red-600 hover:bg-red-600/90">
              <Video className="size-4" /> Iniciar gravação
            </Button>
          ) : (
            <Button onClick={stopRecording} className="rounded-full gap-2">
              <Square className="size-4" /> Parar e enviar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Compose photo strip with frame or logo overlay; layout adapts to print format.
async function composeStrip(
  shots: string[],
  event: EventRow,
  count: number,
): Promise<Blob> {
  const layout: PrintLayout = event.print_layout ?? "portrait";
  const cellW = 600, cellH = 800, gap = 24, pad = 36;

  let cols = 1, rows = 1;
  if (layout === "landscape") {
    if (count === 1) { cols = 1; rows = 1; }
    else if (count === 2) { cols = 2; rows = 1; }
    else if (count === 3) { cols = 3; rows = 1; }
    else { cols = 2; rows = 2; }
  } else if (layout === "a4") {
    if (count === 1) { cols = 1; rows = 1; }
    else if (count === 2) { cols = 1; rows = 2; }
    else if (count === 3) { cols = 1; rows = 3; }
    else { cols = 2; rows = 2; }
  } else {
    if (count === 1) { cols = 1; rows = 1; }
    else if (count === 2) { cols = 1; rows = 2; }
    else if (count === 3) { cols = 1; rows = 3; }
    else { cols = 2; rows = 2; }
  }

  const W = cellW * cols + gap * (cols - 1) + pad * 2;
  const H = cellH * rows + gap * (rows - 1) + pad * 2;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#fdf6d9");
  grad.addColorStop(1, "#f1e3a8");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const positions: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions.push([pad + c * (cellW + gap), pad + r * (cellH + gap)]);
    }
  }

  const imgs = await Promise.all(shots.slice(0, count).map((s) => loadImage(s)));
  imgs.forEach((img, i) => {
    const [x, y] = positions[i];
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - 6, y - 6, cellW + 12, cellH + 12);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellW, cellH);
    ctx.clip();
    drawCover(ctx, img, x, y, cellW, cellH);
    ctx.restore();
  });

  const overlayType = event.overlay_type ?? "frame";

  if (overlayType === "frame" && event.frame_url) {
    try {
      const frame = await loadImage(event.frame_url, true);
      ctx.drawImage(frame, 0, 0, W, H);
    } catch (e) {
      console.warn("Frame failed to load", e);
    }
  } else if (overlayType === "logo" && event.logo_url) {
    try {
      const logo = await loadImage(event.logo_url, true);
      const sizePct = Math.max(5, Math.min(80, event.logo_size ?? 25)) / 100;
      const position: LogoPosition = event.logo_position ?? "bottom";
      const horizontal = position === "top" || position === "bottom";
      const targetW = horizontal ? W * sizePct * (logo.width / logo.height) : W * sizePct;
      const targetH = horizontal ? H * sizePct : H * sizePct * (logo.height / logo.width);
      // Constrain so logo never exceeds canvas
      const maxW = W - pad * 2;
      const maxH = H - pad * 2;
      const scale = Math.min(1, maxW / targetW, maxH / targetH);
      const finalW = targetW * scale;
      const finalH = targetH * scale;
      const margin = 24;
      let x = (W - finalW) / 2;
      let y = (H - finalH) / 2;
      if (position === "top") y = margin;
      else if (position === "bottom") y = H - finalH - margin;
      else if (position === "left") x = margin;
      else if (position === "right") x = W - finalW - margin;
      ctx.drawImage(logo, x, y, finalW, finalH);
    } catch (e) {
      console.warn("Logo failed to load", e);
    }
  }

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Compose failed")), "image/jpeg", 0.92),
  );
}


function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ir = img.width / img.height, tr = w / h;
  let sw = img.width, sh = img.height, sx = 0, sy = 0;
  if (ir > tr) { sw = img.height * tr; sx = (img.width - sw) / 2; }
  else { sh = img.width / tr; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function loadImage(src: string, cors = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}

function DoneScreen({
  event, photo, onReset,
}: { event: EventRow; photo: { id: string; url: string; mediaType: MediaType }; onReset: () => void }) {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const isVideo = photo.mediaType === "video";

  function download() {
    const ext = isVideo ? (photo.url.includes(".webm") ? "webm" : "mp4") : "jpg";
    const a = document.createElement("a");
    a.href = photo.url;
    a.download = `${event.slug}-${Date.now()}.${ext}`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function print() { window.print(); }

  async function deleteSelf() {
    if (!confirm("Excluir esta mídia que você acabou de enviar? Essa ação não pode ser desfeita.")) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("photos").delete().eq("id", photo.id);
      if (error) throw error;
      toast.success("Mídia removida");
      qc.invalidateQueries({ queryKey: ["photos", event.id, "all"] });
      onReset();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-12">
      <div className="no-print text-center mb-6">
        <h2 className="font-display text-3xl sm:text-4xl font-bold">
          {isVideo ? "Vídeo enviado! 🎬" : "Ficou incrível! ✨"}
        </h2>
        <p className="mt-2 text-muted-foreground">
          {isVideo ? "Seu vídeo foi publicado no álbum do evento." : "Sua composição está pronta e foi adicionada ao álbum."}
        </p>
      </div>

      <div className={`print-area print-${event.print_layout ?? "portrait"} card-soft p-3 bg-white`}>
        {isVideo ? (
          <video src={photo.url} controls playsInline className="block w-full h-auto rounded-lg bg-black" />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={photo.url} alt="Sua composição de fotos" className="block w-full h-auto rounded-lg" crossOrigin="anonymous" />
        )}
      </div>

      <div className="no-print mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {!isVideo && (
          <Button onClick={print} className="rounded-full gap-2 h-14 text-base" size="lg">
            <Printer className="size-5" /> Imprimir
          </Button>
        )}
        <Button onClick={download} variant="outline" className="rounded-full gap-2 h-14 text-base" size="lg">
          <Download className="size-5" /> Baixar
        </Button>
        <Button onClick={onReset} variant="secondary" className="rounded-full gap-2 h-14 text-base" size="lg">
          <RotateCcw className="size-5" /> {isVideo ? "Nova mídia" : "Novas Fotos"}
        </Button>
      </div>

      <div className="no-print mt-4 text-center">
        <Button
          onClick={deleteSelf}
          disabled={deleting}
          variant="ghost"
          className="rounded-full gap-2 text-muted-foreground hover:text-destructive"
        >
          {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          Excluir esta mídia
        </Button>
      </div>
    </div>
  );
}
