import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uploadAndSign } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Camera, Printer, Download, RotateCcw, Loader2, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { PhotoViewer, downloadPhoto, printPhoto } from "@/components/PhotoViewer";

type EventRow = {
  id: string;
  name: string;
  slug: string;
  date: string | null;
  frame_url: string | null;
  photo_count: number;
};

export const Route = createFileRoute("/event/$slug")({
  component: BoothPage,
  loader: async ({ params }) => {
    const { data, error } = await supabase
      .from("events")
      .select("id, name, slug, date, frame_url, photo_count")
      .eq("slug", params.slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    return { event: data as EventRow };
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
        <Button asChild className="mt-6 rounded-full"><Link to="/admin">Ir para o painel</Link></Button>
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

type Phase = "welcome" | "capture" | "composing" | "done";

function BoothPage() {
  const { event } = Route.useLoaderData();
  const [phase, setPhase] = useState<Phase>("welcome");
  const [finalUrl, setFinalUrl] = useState<string | null>(null);

  function reset() {
    setFinalUrl(null);
    setPhase("welcome");
  }

  return (
    <div className="min-h-screen bg-blob">
      <header className="no-print border-b border-border/50 bg-background/60 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link to="/admin" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Painel
          </Link>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Xis Photo Booth</div>
        </div>
      </header>

      {phase === "welcome" && <Welcome event={event} onStart={() => setPhase("capture")} />}
      {phase === "capture" && (
        <CaptureFlow
          event={event}
          onDone={(url) => { setFinalUrl(url); setPhase("done"); }}
          onCancel={reset}
          onComposing={() => setPhase("composing")}
        />
      )}
      {phase === "composing" && (
        <div className="grid place-items-center py-32 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <p className="mt-4 font-display text-lg">Montando sua composição…</p>
        </div>
      )}
      {phase === "done" && finalUrl && <DoneScreen event={event} url={finalUrl} onReset={reset} />}
    </div>
  );
}

function Welcome({ event, onStart }: { event: EventRow; onStart: () => void }) {
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
      <p className="mx-auto mt-6 max-w-md text-muted-foreground">
        Prepare-se — vamos capturar {event.photo_count} foto{event.photo_count === 1 ? "" : "s"} com contagem regressiva de 3 segundos. Capriche na pose!
      </p>
      <button
        onClick={onStart}
        className="mt-10 inline-flex items-center gap-3 rounded-full bg-primary px-10 py-5 sm:px-14 sm:py-6 text-xl sm:text-2xl font-semibold text-primary-foreground shadow-[0_20px_50px_-15px_oklch(0.42_0.075_188/0.55)] transition active:scale-95 hover:opacity-95"
      >
        <Camera className="size-6 sm:size-7" />
        Tirar Fotos
      </button>
      <AlbumGrid event={event} />
    </div>
  );
}

function AlbumGrid({ event }: { event: EventRow }) {
  const PAGE_SIZE = 12;
  const [page, setPage] = useState(0);
  const [viewing, setViewing] = useState<{ id: string; photo_url: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const q = useQuery({
    queryKey: ["photos", event.id, "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("photos")
        .select("id, photo_url")
        .eq("event_id", event.id)
        .eq("hidden", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as { id: string; photo_url: string }[];
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
        await downloadPhoto(photos[i].photo_url, `${event.slug}-${i + 1}.jpg`);
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
            {photos.length} foto{photos.length === 1 ? "" : "s"} • Página {safePage + 1} de {totalPages}
          </p>
        </div>
        <Button
          onClick={downloadAll}
          disabled={downloading}
          className="rounded-full gap-2"
          variant="secondary"
        >
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Baixar todas as imagens
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {slice.map((p, i) => {
          const absoluteIndex = safePage * PAGE_SIZE + i + 1;
          return (
            <div
              key={p.id}
              className="group relative aspect-square overflow-hidden rounded-xl bg-muted card-soft"
            >
              <button
                onClick={() => setViewing(p)}
                className="absolute inset-0 transition active:scale-95"
                aria-label={`Ver foto ${absoluteIndex}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.photo_url}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover transition-transform group-hover:scale-105"
                />
              </button>
              <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition">
                <button
                  onClick={() => printPhoto(p.photo_url)}
                  className="size-8 grid place-items-center rounded-full bg-background/90 backdrop-blur-sm shadow hover:bg-background"
                  aria-label="Imprimir"
                  title="Imprimir"
                >
                  <Printer className="size-4" />
                </button>
                <button
                  onClick={() => downloadPhoto(p.photo_url, `${event.slug}-${absoluteIndex}.jpg`)}
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

function CaptureFlow({
  event, onDone, onCancel, onComposing,
}: {
  event: EventRow;
  onDone: (url: string) => void;
  onCancel: () => void;
  onComposing: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [shotIndex, setShotIndex] = useState(0); // 0..4
  const [flash, setFlash] = useState(false);
  const [shots, setShots] = useState<string[]>([]); // dataURLs
  const [error, setError] = useState<string | null>(null);

  // Start camera
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
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
  }, []);

  const captureFrame = useCallback((): string => {
    const v = videoRef.current!;
    const canvas = document.createElement("canvas");
    canvas.width = TARGET_W;
    canvas.height = TARGET_H;
    const ctx = canvas.getContext("2d")!;
    // cover-crop the video into target rect
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
    // mirror selfie
    ctx.save();
    ctx.translate(TARGET_W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, TARGET_W, TARGET_H);
    ctx.restore();
    return canvas.toDataURL("image/jpeg", 0.92);
  }, []);

  // Sequence: 4 shots, 3s countdown each, 2s pause between
  useEffect(() => {
    if (!ready || error) return;
    if (shotIndex >= event.photo_count) return;

    let alive = true;
    const initialDelay = shotIndex === 0 ? 800 : 2000; // pause between

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
          // capture
          const data = captureFrame();
          setFlash(true);
          setTimeout(() => setFlash(false), 180);
          setShots((s) => [...s, data]);
          setShotIndex((i) => i + 1);
        }
      }, 1000);
    }, initialDelay);

    return () => { alive = false; clearTimeout(t0); };
  }, [ready, shotIndex, captureFrame, error]);

  // When all shots done, compose & upload
  useEffect(() => {
    if (shots.length < event.photo_count) return;
    onComposing();
    (async () => {
      try {
        const blob = await composeStrip(shots, event.frame_url, event.photo_count);
        const path = `${event.slug}/${Date.now()}.jpg`;
        const url = await uploadAndSign("event-photos", path, blob, "image/jpeg");
        await supabase.from("photos").insert({ event_id: event.id, photo_url: url });
        onDone(url);
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
          className="absolute inset-0 size-full object-cover [transform:scaleX(-1)] bg-black"
        />
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

        {/* shots strip */}
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

// Compose photo strip with frame overlay; supports 1, 2, 3 or 4 photos
async function composeStrip(shots: string[], frameUrl: string | null, count: number): Promise<Blob> {
  const cellW = 600, cellH = 800, gap = 24, pad = 36;

  // Layouts: cols x rows
  let cols = 1, rows = 1;
  if (count === 1) { cols = 1; rows = 1; }
  else if (count === 2) { cols = 1; rows = 2; }
  else if (count === 3) { cols = 1; rows = 3; }
  else { cols = 2; rows = 2; }

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

  if (frameUrl) {
    try {
      const frame = await loadImage(frameUrl, true);
      ctx.drawImage(frame, 0, 0, W, H);
    } catch (e) {
      console.warn("Frame failed to load", e);
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

function DoneScreen({ event, url, onReset }: { event: EventRow; url: string; onReset: () => void }) {
  function download() {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${event.slug}-${Date.now()}.jpg`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function print() { window.print(); }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-12">
      <div className="no-print text-center mb-6">
        <h2 className="font-display text-3xl sm:text-4xl font-bold">Ficou incrível! ✨</h2>
        <p className="mt-2 text-muted-foreground">Sua composição está pronta.</p>
      </div>

      <div className="print-area card-soft p-3 bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Sua composição de fotos" className="block w-full h-auto rounded-lg" crossOrigin="anonymous" />
      </div>

      <div className="no-print mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Button onClick={print} className="rounded-full gap-2 h-14 text-base" size="lg">
          <Printer className="size-5" /> Imprimir
        </Button>
        <Button onClick={download} variant="outline" className="rounded-full gap-2 h-14 text-base" size="lg">
          <Download className="size-5" /> Baixar
        </Button>
        <Button asChild variant="outline" className="rounded-full gap-2 h-14 text-base" size="lg">
          <Link to="/event/$slug/gallery" params={{ slug: event.slug }}>
            <Images className="size-5" /> Ver todas
          </Link>
        </Button>
        <Button onClick={onReset} variant="secondary" className="rounded-full gap-2 h-14 text-base" size="lg">
          <RotateCcw className="size-5" /> Novas Fotos
        </Button>
      </div>
    </div>
  );
}
