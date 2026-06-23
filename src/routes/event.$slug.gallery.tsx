import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, ImageIcon, Camera, Download } from "lucide-react";
import { toast } from "sonner";
import { PhotoViewer, downloadPhoto } from "@/components/PhotoViewer";

type EventRow = {
  id: string;
  name: string;
  slug: string;
};

type PhotoRow = {
  id: string;
  photo_url: string;
  created_at: string;
};

export const Route = createFileRoute("/event/$slug/gallery")({
  component: PublicGallery,
  loader: async ({ params }) => {
    const { data, error } = await supabase
      .from("events")
      .select("id, name, slug")
      .eq("slug", params.slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    return { event: data as EventRow };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.event.name} — Gallery` : "Gallery" }],
  }),
  notFoundComponent: () => (
    <div className="min-h-screen bg-blob grid place-items-center px-4">
      <div className="card-soft p-8 max-w-md text-center">
        <h1 className="font-display text-3xl font-bold">Event not found</h1>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen bg-blob grid place-items-center px-4">
      <div className="card-soft p-8 max-w-md text-center">
        <h1 className="font-display text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </div>
    </div>
  ),
});

async function downloadPhoto(url: string, filename: string) {
  try {
    const r = await fetch(url);
    const blob = await r.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

const PAGE_SIZE = 24;

function PublicGallery() {
  const { event } = Route.useLoaderData();
  const [open, setOpen] = useState<PhotoRow | null>(null);
  const [page, setPage] = useState(0);

  const photosQ = useQuery({
    queryKey: ["photos", event.id, "public", page],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error, count } = await supabase
        .from("photos")
        .select("id, photo_url, created_at", { count: "exact" })
        .eq("event_id", event.id)
        .eq("hidden", false)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as PhotoRow[], count: count ?? 0 };
    },
  });

  const photos = photosQ.data?.rows ?? [];
  const total = photosQ.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-blob">
      <header className="border-b border-border/50 bg-background/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link
            to="/event/$slug"
            params={{ slug: event.slug }}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Booth
          </Link>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Gallery</div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-8 text-center">
          <h1 className="font-display text-4xl sm:text-5xl font-bold">{event.name}</h1>
          <p className="mt-2 text-muted-foreground">
            {total} memor{total === 1 ? "y" : "ies"} from this event
          </p>
          <Button asChild className="mt-6 rounded-full gap-2">
            <Link to="/event/$slug" params={{ slug: event.slug }}>
              <Camera className="size-4" /> Take new photos
            </Link>
          </Button>
        </div>

        {photosQ.isLoading && (
          <div className="grid place-items-center py-20 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}

        {!photosQ.isLoading && photos.length === 0 && (
          <div className="card-soft p-10 text-center">
            <div className="mx-auto mb-4 size-14 rounded-2xl bg-accent grid place-items-center">
              <ImageIcon className="size-7 text-accent-foreground" />
            </div>
            <h2 className="font-display text-2xl font-bold">No photos yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">Be the first to snap a memory!</p>
          </div>
        )}

        <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p) => (
            <button
              key={p.id}
              onClick={() => setOpen(p)}
              className="group relative aspect-square overflow-hidden rounded-xl bg-muted card-soft transition active:scale-95"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.photo_url}
                alt=""
                loading="lazy"
                className="absolute inset-0 size-full object-cover transition-transform group-hover:scale-105"
              />
            </button>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button
              variant="secondary"
              className="rounded-full"
              disabled={page === 0 || photosQ.isFetching}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">
              Página {page + 1} de {totalPages}
            </span>
            <Button
              variant="secondary"
              className="rounded-full"
              disabled={page >= totalPages - 1 || photosQ.isFetching}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Próxima
            </Button>
          </div>
        )}
      </main>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-2xl p-3">
          {open && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={open.photo_url} alt="" className="w-full h-auto rounded-lg" />
              <Button
                onClick={() => downloadPhoto(open.photo_url, `${event.slug}-${open.id}.jpg`)}
                className="rounded-full gap-2 w-full"
              >
                <Download className="size-4" /> Download
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
