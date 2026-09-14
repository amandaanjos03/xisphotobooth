import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { refreshPhotoUrlsStrict } from "@/lib/storage";
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
  theme_slug: EventThemeSlug;
};
type PhotoRow = { id: string; photo_url: string; media_type: string; created_at: string };

export const Route = createFileRoute("/event/$slug/live")({
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

  const loadPhotos = useCallback(async (eventId: string, initial = false) => {
    const { data, error: photosError } = await supabase
      .from("photos")
      .select("id, photo_url, media_type, created_at")
      .eq("event_id", eventId)
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(200);
    if (photosError) throw photosError;
    const rows = await refreshPhotoUrlsStrict((data ?? []) as PhotoRow[]);
    rows.forEach((photo) => seenRef.current.add(photo.id));
    setPhotos((current) => (initial ? rows : mergePhotos(rows, current)));
  }, []);

  const loadEvent = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: eventError } = await supabase
      .from("events")
      .select("id, name, slug, bg_url, theme_slug")
      .eq("slug", slug)
      .maybeSingle();
    if (eventError) {
      setError("Não foi possível abrir este evento agora.");
      setLoading(false);
      return;
    }
    if (!data) {
      setError("Evento não encontrado.");
      setLoading(false);
      return;
    }
    const nextEvent = { ...data, theme_slug: normalizeEventTheme(data.theme_slug) } as EventRow;
    setEvent(nextEvent);
    seenRef.current.clear();
    setIdx(0);
    try {
      await loadPhotos(nextEvent.id, true);
    } catch {
      setError("As fotos não puderam ser carregadas. Tente novamente.");
    }
    setLoading(false);
  }, [loadPhotos, slug]);

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
          refreshPhotoUrlsStrict([p])
            .then(([fresh]) => {
              if (!fresh) return;
              const image = fresh.media_type === "video" ? null : new Image();
              if (image) image.src = fresh.photo_url;
              setPhotos((current) =>
                [fresh, ...current.filter((item) => item.id !== fresh.id)].slice(0, 200),
              );
              setIdx(0);
            })
            .catch(() => setConnection("polling"));
        },
      )
      .subscribe((status) => setConnection(status === "SUBSCRIBED" ? "live" : "connecting"));
    const poll = window.setInterval(() => {
      loadPhotos(event.id)
        .then(() => setConnection((current) => (current === "live" ? current : "polling")))
        .catch(() => setConnection("polling"));
    }, 10000);
    return () => {
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [event, loadPhotos]);

  // Auto-advance every 5s.
  useEffect(() => {
    if (photos.length < 2 || paused) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % photos.length), 5000);
    return () => clearInterval(t);
  }, [paused, photos.length]);

  const current = photos[idx];
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
      <header className="relative z-20 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 bg-background/55 backdrop-blur-md border-b border-border/40">
        <div className="min-w-0">
          <div className="font-display text-lg sm:text-2xl font-bold truncate">{event.name}</div>
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
        <div className="flex items-center gap-1.5">
          {ownedEvents.length > 1 && (
            <label className="hidden sm:flex items-center gap-2 rounded-md border border-border bg-background/70 px-2 h-9">
              <SwitchCamera className="size-4" />
              <span className="sr-only">Trocar evento</span>
              <select
                value={slug}
                onChange={(e) => changeEvent(e.target.value)}
                className="max-w-48 bg-transparent text-sm outline-none"
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
            title={paused ? "Continuar" : "Pausar"}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? <Play /> : <Pause />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
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

function mergePhotos(incoming: PhotoRow[], current: PhotoRow[]) {
  const byId = new Map(current.map((photo) => [photo.id, photo]));
  incoming.forEach((photo) => byId.set(photo.id, photo));
  return Array.from(byId.values())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 200);
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
