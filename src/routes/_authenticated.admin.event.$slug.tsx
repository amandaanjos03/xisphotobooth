import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Eye, EyeOff, Trash2, Loader2, ImageIcon, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { PhotoViewer, downloadPhoto } from "@/components/PhotoViewer";

type EventRow = {
  id: string;
  name: string;
  slug: string;
  owner_id: string | null;
};


type PhotoRow = {
  id: string;
  event_id: string;
  photo_url: string;
  hidden: boolean;
  created_at: string;
  media_type: "image" | "video";
};

export const Route = createFileRoute("/_authenticated/admin/event/$slug")({
  component: AdminEventGallery,
  loader: async ({ params }) => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) throw notFound();
    const { data, error } = await supabase
      .from("events")
      .select("id, name, slug, owner_id")
      .eq("slug", params.slug)
      .eq("owner_id", uid)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw notFound();
    return { event: data as EventRow };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.event.name} — Galeria` : "Galeria" }],
  }),

  notFoundComponent: () => (
    <div className="min-h-screen bg-blob grid place-items-center px-4">
      <div className="card-soft p-8 max-w-md text-center">
        <h1 className="font-display text-3xl font-bold">Evento não encontrado</h1>
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

function extractStoragePath(signedUrl: string): string | null {
  // Format: .../storage/v1/object/sign/event-photos/<path>?token=...
  const m = signedUrl.match(/\/object\/sign\/event-photos\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}


function AdminEventGallery() {
  const { event } = Route.useLoaderData();
  const qc = useQueryClient();
  const [viewing, setViewing] = useState<PhotoRow | null>(null);

  const photosQ = useQuery({
    queryKey: ["photos", event.id, "admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("photos")
        .select("*")
        .eq("event_id", event.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PhotoRow[];
    },
  });

  const toggleHidden = useMutation({
    mutationFn: async (p: PhotoRow) => {
      const { error } = await supabase
        .from("photos")
        .update({ hidden: !p.hidden })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photos", event.id, "admin"] });
      qc.invalidateQueries({ queryKey: ["photos", event.id, "public"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delPhoto = useMutation({
    mutationFn: async (p: PhotoRow) => {
      // Try storage cleanup but don't fail the delete if it errors (RLS/permissions).
      try {
        const path = extractStoragePath(p.photo_url);
        if (path) await supabase.storage.from("event-photos").remove([path]);
      } catch { /* ignore storage cleanup errors */ }
      const { error } = await supabase.from("photos").delete().eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Foto excluída");
      qc.invalidateQueries({ queryKey: ["photos", event.id, "admin"] });
      qc.invalidateQueries({ queryKey: ["photos", event.id, "all"] });
      qc.invalidateQueries({ queryKey: ["photo-counts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delAllPhotos = useMutation({
    mutationFn: async (ps: PhotoRow[]) => {
      try {
        const paths = ps
          .map((p) => extractStoragePath(p.photo_url))
          .filter((x): x is string => !!x);
        if (paths.length) await supabase.storage.from("event-photos").remove(paths);
      } catch { /* ignore storage cleanup errors */ }
      const { error } = await supabase.rpc("wipe_event_photos" as never, { _event_id: event.id } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Álbum esvaziado");
      qc.invalidateQueries({ queryKey: ["photos", event.id, "admin"] });
      qc.invalidateQueries({ queryKey: ["photos", event.id, "all"] });
      qc.invalidateQueries({ queryKey: ["photo-counts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function downloadAll(photos: PhotoRow[]) {
    for (let i = 0; i < photos.length; i++) {
      await downloadPhoto(photos[i].photo_url, `${event.slug}-${i + 1}.jpg`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const photos = photosQ.data ?? [];

  return (
    <div className="min-h-screen bg-blob">
      <header className="border-b border-border/60 backdrop-blur-sm bg-background/60 sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
          <Link to="/admin" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Painel
          </Link>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full gap-1.5"
              disabled={photos.length === 0}
              onClick={() => downloadAll(photos)}
            >
              <Download className="size-3.5" /> Salvar todas
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="rounded-full gap-1.5"
              disabled={photos.length === 0 || delAllPhotos.isPending}
              onClick={() => {
                if (confirm(`Tem certeza? Isso excluirá permanentemente todas as ${photos.length} mídias deste evento e liberará o espaço no armazenamento.`)) {
                  delAllPhotos.mutate(photos);
                }
              }}
            >
              {delAllPhotos.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Limpar Álbum
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-8">
          <h1 className="font-display text-4xl sm:text-5xl font-bold">{event.name}</h1>
          <p className="mt-2 text-muted-foreground">
            {photos.length} {photos.length === 1 ? "foto capturada" : "fotos capturadas"}. Fotos ocultas não aparecem na galeria pública.
          </p>
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
            <h2 className="font-display text-2xl font-bold">Nenhuma foto ainda</h2>
            <p className="mt-2 text-sm text-muted-foreground">As fotos tiradas na cabine aparecerão aqui.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p, i) => {
            const isVideo = p.media_type === "video";
            const ext = isVideo ? (p.photo_url.includes(".webm") ? "webm" : "mp4") : "jpg";
            return (
            <article key={p.id} className="card-soft overflow-hidden flex flex-col">
              <button
                type="button"
                onClick={() => {
                  if (isVideo) window.open(p.photo_url, "_blank", "noopener");
                  else setViewing(p);
                }}
                className={`relative aspect-square bg-muted w-full text-left transition active:scale-[0.99] ${p.hidden ? "opacity-50" : ""}`}
                title={isVideo ? "Abrir vídeo" : "Ampliar"}
              >
                {isVideo ? (
                  <video src={p.photo_url} muted playsInline preload="metadata" className="absolute inset-0 size-full object-cover" />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={p.photo_url} alt="" className="absolute inset-0 size-full object-cover" />
                )}
                <span className="absolute top-2 right-2 rounded-full bg-background/80 backdrop-blur px-2 py-1 text-[10px] font-semibold uppercase tracking-wide">
                  {isVideo ? "Vídeo" : "Foto"}
                </span>
                {p.hidden && (
                  <div className="absolute top-2 left-2 rounded-full bg-background/90 backdrop-blur px-2.5 py-1 text-xs font-semibold inline-flex items-center gap-1">
                    <EyeOff className="size-3" /> Oculta
                  </div>
                )}
              </button>
              <div className="p-3 flex items-center gap-1.5">
                <div className="text-xs text-muted-foreground flex-1 truncate">
                  {new Date(p.created_at).toLocaleString()}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="rounded-full size-9"
                  title={p.hidden ? "Mostrar na galeria pública" : "Ocultar da galeria pública"}
                  onClick={() => toggleHidden.mutate(p)}
                >
                  {p.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="rounded-full size-9"
                  title="Baixar"
                  onClick={() => downloadPhoto(p.photo_url, `${event.slug}-${i + 1}.${ext}`)}
                >
                  <Download className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="rounded-full size-9 text-muted-foreground hover:text-destructive"
                  title="Excluir"
                  onClick={() => {
                    if (confirm("Excluir esta mídia permanentemente?")) delPhoto.mutate(p);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </article>
            );
          })}
        </div>
      </main>
      <PhotoViewer
        url={viewing?.photo_url ?? null}
        filename={`${event.slug}-${viewing?.id ?? ""}.jpg`}
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
      />
    </div>
  );
}
