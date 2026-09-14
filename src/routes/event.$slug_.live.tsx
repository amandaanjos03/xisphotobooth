import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getLivePresentation } from "@/lib/live-presentation.functions";
import { normalizeEventTheme, type EventThemeSlug } from "@/lib/event-theme";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  SwitchCamera,
} from "lucide-react";

type EventRow = {
  id: string;
  name: string;
  slug: string;
  bg_url: string | null;
  card_logo_url: string | null;
  slideshow_interval_seconds: number;
  theme_slug: EventThemeSlug;
};
type PhotoRow = { id: string; photo_url: string; media_type: string; created_at: string };

export const Route = createFileRoute("/event/$slug_/live")({
  component: LiveSlideshow,
  loader: ({ params }) => ({ slug: params.slug }),
  head: () => ({
    meta: [
      { title: "Apresentação ao vivo — Xis Photo Booth" },
      { name: "description", content: "Fotos do evento atualizadas ao vivo para projeção." },
      { property: "og:title", content: "Apresentação ao vivo — Xis Photo Booth" },
      { property: "og:description", content: "Fotos do evento atualizadas ao vivo para projeção." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function LiveSlideshow() {
  const { slug } = Route.useLoaderData();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [ownedEvents, setOwnedEvents] = useState<Array<Pick<EventRow, "name" | "slug">>>([]);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "live" | "polling">("connecting");
  const [previous, setPrevious] = useState<PhotoRow | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const fetchPresentation = useServerFn(getLivePresentation);

  const loadPhotos = useCallback(async () => {
    const result = await fetchPresentation({ data: { slug } });
    if (!result) throw new Error("Evento não encontrado.");
    const rows = result.photos as PhotoRow[];
    rows.forEach((photo) => seenRef.current.add(photo.id));
    setPhotos(rows);
    return result;
  }, [fetchPresentation, slug]);

  const loadEvent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadPhotos();
      const data = result.event;
      const nextEvent = { ...data, theme_slug: normalizeEventTheme(data.theme_slug) } as EventRow;
      setEvent(nextEvent);
      seenRef.current.clear();
      result.photos.forEach((photo) => seenRef.current.add(photo.id));
      setIdx(0);
    } catch (loadError) {
      if (loadError instanceof Error && loadError.message === "Evento não encontrado.") {
        setError("Evento não encontrado.");
      } else {
        setError("As fotos não puderam ser carregadas. Tente novamente.");
      }
    }
    setLoading(false);
  }, [loadPhotos]);

  useEffect(() => {
    loadEvent();
  }, [loadEvent]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: events } = await supabase
        .from("events")
        .select("name, slug")
        .eq("owner_id", data.user.id)
        .order("created_at", { ascending: false });
      setOwnedEvents((events ?? []) as Array<Pick<EventRow, "name" | "slug">>);
    });
  }, []);

  useEffect(() => {
    if (!event) return;
    const channel = supabase
      .channel(`live-${event.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "photos", filter: `event_id=eq.${event.id}` },
        (payload) => {
          const p = payload.new as PhotoRow & { hidden?: boolean };
          if (p.hidden || seenRef.current.has(p.id)) return;
          seenRef.current.add(p.id);
          loadPhotos()
            .then(() => setIdx(0))
            .catch(() => setConnection("polling"));
        },
      )
      .subscribe((status) => setConnection(status === "SUBSCRIBED" ? "live" : "connecting"));
    const poll = window.setInterval(() => {
      loadPhotos()
        .then(() => setConnection((current) => (current === "live" ? current : "polling")))
        .catch(() => setConnection("polling"));
    }, 10000);
    return () => {
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [event, loadPhotos]);

  // Auto-advance using the interval configured for this event.
  useEffect(() => {
    if (photos.length < 2 || paused || !event) return;
    const intervalMs = Math.max(2, Math.min(60, event.slideshow_interval_seconds ?? 5)) * 1000;
    const t = setInterval(() => setIdx((i) => (i + 1) % photos.length), intervalMs);
    return () => clearInterval(t);
  }, [event, paused, photos.length]);

  const current = photos[idx];
  useEffect(() => {
    if (idx >= photos.length) setIdx(0);
  }, [idx, photos.length]);
  useEffect(() => {
    if (!current) return;
    setPrevious((old) =>
      old?.id === current.id ? old : (photos[(idx - 1 + photos.length) % photos.length] ?? null),
    );
    const timer = window.setTimeout(() => setPrevious(null), 950);
    return () => window.clearTimeout(timer);
  }, [current, idx, photos]);

  useEffect(() => {
    const next = photos[(idx + 1) % photos.length];
    if (next && next.media_type !== "video") new Image().src = next.photo_url;
  }, [idx, photos]);

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const bg = useMemo(
    () =>
      event?.bg_url
        ? {
            backgroundImage: `linear-gradient(var(--event-wash), var(--event-wash)), url("${event.bg_url}")`,
          }
        : undefined,
    [event?.bg_url],
  );

  const move = (direction: number) =>
    setIdx((value) => (value + direction + photos.length) % photos.length);
  const changeEvent = (nextSlug: string) => {
    if (!nextSlug || nextSlug === slug) return;
    navigate({ to: "/event/$slug/live", params: { slug: nextSlug } });
  };

  if (!event)
    return (
      <div className="min-h-screen grid place-items-center bg-background px-5 text-center">
        {loading ? (
          <Loader2 className="size-9 animate-spin text-primary" />
        ) : (
          <div>
            <h1 className="font-display text-3xl font-bold">{error ?? "Evento não encontrado"}</h1>
            <Button className="mt-5 gap-2" onClick={loadEvent}>
              <RefreshCw /> Tentar novamente
            </Button>
          </div>
        )}
      </div>
    );

  return (
    <div
      className={`event-theme theme-${normalizeEventTheme(event.theme_slug)} min-h-screen w-full bg-cover bg-center flex flex-col overflow-hidden`}
      style={bg}
    >
      <header className="relative z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 bg-background/55 backdrop-blur-md border-b border-border/40 sm:flex sm:px-6">
        <div className="min-w-0">
          {event.card_logo_url ? (
            <img
              src={event.card_logo_url}
              alt={event.name}
              className="h-8 w-auto max-w-full object-contain object-left sm:h-11"
            />
          ) : (
            <div className="font-display truncate text-lg font-bold sm:text-2xl">{event.name}</div>
          )}
          <div className="text-[11px] uppercase text-muted-foreground inline-flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${connection === "live" ? "bg-accent animate-pulse" : "bg-muted-foreground"}`}
            />
            {connection === "live"
              ? "Ao vivo"
              : connection === "polling"
                ? "Atualizando"
                : "Conectando"}{" "}
            · {photos.length}
          </div>
        </div>
        <div className="col-span-2 flex min-w-0 items-center gap-1.5 sm:col-span-1 sm:ml-auto">
          {ownedEvents.length > 1 && (
            <label className="flex h-9 min-w-0 flex-1 items-center gap-1 rounded-md border border-border bg-background/70 px-2 sm:w-auto sm:max-w-56 sm:flex-none sm:gap-2">
              <SwitchCamera className="size-4 shrink-0" />
              <span className="sr-only">Trocar evento</span>
              <select
                value={slug}
                onChange={(e) => changeEvent(e.target.value)}
                className="min-w-0 w-full truncate bg-transparent text-xs outline-none sm:max-w-48 sm:text-sm"
              >
                {ownedEvents.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            title={paused ? "Continuar" : "Pausar"}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? <Play /> : <Pause />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            title="Tela cheia"
            onClick={() =>
              document.fullscreenElement
                ? document.exitFullscreen()
                : document.documentElement.requestFullscreen()
            }
          >
            {isFullscreen ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
      </header>

      <main className="relative flex-1 grid place-items-center p-3 sm:p-8 min-h-0">
        {loading ? (
          <Loader2 className="size-8 animate-spin text-primary" />
        ) : error ? (
          <div className="text-center">
            <p>{error}</p>
            <Button variant="secondary" className="mt-4 gap-2" onClick={loadEvent}>
              <RefreshCw /> Tentar novamente
            </Button>
          </div>
        ) : !current ? (
          <div className="text-center text-foreground/80">
            <div className="font-display text-3xl sm:text-5xl font-bold">
              Aguardando as primeiras fotos…
            </div>
            <p className="mt-3 text-sm sm:text-base">
              Assim que alguém tirar uma foto, ela aparece aqui.
            </p>
          </div>
        ) : (
          <>
            {previous && previous.id !== current.id && (
              <LiveMedia
                media={previous}
                className="absolute inset-3 sm:inset-8 m-auto opacity-0 transition-opacity duration-700"
              />
            )}
            <LiveMedia media={current} className="live-photo-enter relative z-10" />
            {photos.length > 1 && (
              <>
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute left-3 sm:left-6 z-20 rounded-full bg-background/65 backdrop-blur"
                  onClick={() => move(-1)}
                  title="Anterior"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute right-3 sm:right-6 z-20 rounded-full bg-background/65 backdrop-blur"
                  onClick={() => move(1)}
                  title="Próxima"
                >
                  <ChevronRight />
                </Button>
              </>
            )}
          </>
        )}
      </main>

      {photos.length > 1 && (
        <footer className="relative z-20 px-4 sm:px-6 py-3 bg-background/55 backdrop-blur-md border-t border-border/40">
          <div className="flex gap-2 overflow-x-auto justify-start sm:justify-center">
            {photos.slice(0, 20).map((p, i) => (
              <Button
                key={p.id}
                variant="ghost"
                size="icon"
                onClick={() => setIdx(i)}
                className={`shrink-0 size-12 sm:size-14 rounded-md p-0 overflow-hidden border-2 transition ${
                  i === idx
                    ? "border-primary opacity-100"
                    : "border-transparent opacity-55 hover:opacity-100"
                }`}
              >
                {p.media_type === "video" ? (
                  <video src={p.photo_url} muted className="size-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photo_url} alt="" className="size-full object-cover" />
                )}
              </Button>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}

function LiveMedia({ media, className }: { media: PhotoRow; className?: string }) {
  const common = `${className ?? ""} max-h-full max-w-full rounded-lg object-contain shadow-2xl`;
  return media.media_type === "video" ? (
    <video
      key={media.id}
      src={media.photo_url}
      autoPlay
      muted
      playsInline
      loop
      className={common}
    />
  ) : (
    <img key={media.id} src={media.photo_url} alt="Foto do evento" className={common} />
  );
}
