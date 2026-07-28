import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

type EventRow = { id: string; name: string; slug: string; bg_url: string | null };
type PhotoRow = { id: string; photo_url: string; media_type: string; created_at: string };

export const Route = createFileRoute("/event/$slug/live")({
  component: LiveSlideshow,
  loader: async ({ params }) => {
    const { data, error } = await supabase
      .from("events")
      .select("id, name, slug, bg_url")
      .eq("slug", params.slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    return { event: data as EventRow };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.event.name} — Ao vivo` : "Ao vivo" }],
  }),
  notFoundComponent: () => (
    <div className="min-h-screen bg-blob grid place-items-center px-4">
      <div className="card-soft p-8 max-w-md text-center">
        <h1 className="font-display text-3xl font-bold">Evento não encontrado</h1>
      </div>
    </div>
  ),
});

function LiveSlideshow() {
  const { event } = Route.useLoaderData();
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const seenRef = useRef<Set<string>>(new Set());

  // Initial fetch (latest 100 non-hidden).
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("photos")
        .select("id, photo_url, media_type, created_at")
        .eq("event_id", event.id)
        .eq("hidden", false)
        .order("created_at", { ascending: false })
        .limit(100);
      const rows = (data ?? []) as PhotoRow[];
      rows.forEach((p) => seenRef.current.add(p.id));
      setPhotos(rows);
      setLoading(false);
    })();
  }, [event.id]);

  // Realtime subscription: new photos go to the front of the queue.
  useEffect(() => {
    const channel = supabase
      .channel(`live-${event.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "photos", filter: `event_id=eq.${event.id}` },
        (payload) => {
          const p = payload.new as PhotoRow;
          if (p.hidden || seenRef.current.has(p.id)) return;
          seenRef.current.add(p.id);
          setPhotos((prev) => [p, ...prev].slice(0, 200));
          setIdx(0);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [event.id]);

  // Auto-advance every 5s.
  useEffect(() => {
    if (photos.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % photos.length), 5000);
    return () => clearInterval(t);
  }, [photos.length]);

  const current = photos[idx];
  const bg = useMemo(
    () => (event.bg_url ? { backgroundImage: `url(${event.bg_url})` } : undefined),
    [event.bg_url],
  );

  return (
    <div
      className="min-h-screen w-full bg-black text-white bg-cover bg-center flex flex-col"
      style={bg}
    >
      <header className="px-6 py-4 flex items-center justify-between bg-black/40 backdrop-blur-sm">
        <div className="font-display text-xl sm:text-2xl font-bold truncate">{event.name}</div>
        <div className="text-xs uppercase tracking-widest opacity-80 inline-flex items-center gap-2">
          <span className="size-2 rounded-full bg-red-500 animate-pulse" /> Ao vivo · {photos.length}
        </div>
      </header>

      <main className="flex-1 grid place-items-center p-4 sm:p-8">
        {loading ? (
          <Loader2 className="size-8 animate-spin opacity-70" />
        ) : !current ? (
          <div className="text-center opacity-80">
            <div className="font-display text-3xl sm:text-5xl font-bold">Aguardando as primeiras fotos…</div>
            <p className="mt-3 text-sm sm:text-base">Assim que alguém tirar uma foto, ela aparece aqui.</p>
          </div>
        ) : current.media_type === "video" ? (
          <video
            key={current.id}
            src={current.photo_url}
            autoPlay
            muted
            playsInline
            loop
            className="max-h-[80vh] max-w-full rounded-2xl shadow-2xl"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={current.id}
            src={current.photo_url}
            alt=""
            className="max-h-[80vh] max-w-full rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-700"
          />
        )}
      </main>

      {photos.length > 1 && (
        <footer className="px-6 py-3 bg-black/40 backdrop-blur-sm">
          <div className="flex gap-2 overflow-x-auto">
            {photos.slice(0, 20).map((p, i) => (
              <button
                key={p.id}
                onClick={() => setIdx(i)}
                className={`shrink-0 size-14 rounded-lg overflow-hidden border-2 transition ${
                  i === idx ? "border-white" : "border-transparent opacity-60 hover:opacity-100"
                }`}
              >
                {p.media_type === "video" ? (
                  <video src={p.photo_url} muted className="size-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photo_url} alt="" className="size-full object-cover" />
                )}
              </button>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
