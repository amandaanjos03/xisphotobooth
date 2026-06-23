import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uniqueSlug } from "@/lib/slug";
import { uploadAndSign } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Camera, Plus, Share2, ImageIcon, Calendar, Loader2, Copy, Check, QrCode, ExternalLink, Trash2, Images } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";

type EventRow = {
  id: string;
  name: string;
  slug: string;
  date: string | null;
  frame_url: string | null;
  created_at: string;
};

export const Route = createFileRoute("/admin")({
  component: AdminDashboard,
  head: () => ({ meta: [{ title: "Dashboard — Snapbooth" }] }),
});

function AdminDashboard() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [shareFor, setShareFor] = useState<EventRow | null>(null);

  const eventsQ = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as EventRow[];
    },
  });

  const countsQ = useQuery({
    queryKey: ["photo-counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("photos").select("event_id");
      if (error) throw error;
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: { event_id: string }) => {
        m[r.event_id] = (m[r.event_id] ?? 0) + 1;
      });
      return m;
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("events").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Event deleted");
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["photo-counts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-blob">
      <header className="border-b border-border/60 backdrop-blur-sm bg-background/60 sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-9 rounded-xl bg-primary text-primary-foreground grid place-items-center shadow-sm">
              <Camera className="size-5" />
            </div>
            <div>
              <div className="font-display text-lg font-bold leading-none">Snapbooth</div>
              <div className="text-xs text-muted-foreground">Admin Dashboard</div>
            </div>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-full gap-2">
                <Plus className="size-4" />
                <span className="hidden sm:inline">New event</span>
              </Button>
            </DialogTrigger>
            <CreateEventDialog onClose={() => setCreateOpen(false)} />
          </Dialog>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-8 sm:mb-12">
          <h1 className="font-display text-4xl sm:text-5xl font-bold">Your events</h1>
          <p className="mt-2 text-muted-foreground">
            Create an event, upload a frame, then share the link or QR code so guests can start snapping.
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
            <h2 className="font-display text-2xl font-bold">No events yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">Create your first event to launch a photo booth.</p>
            <Button onClick={() => setCreateOpen(true)} className="mt-6 rounded-full gap-2">
              <Plus className="size-4" /> Create event
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
                    alt={`${ev.name} frame`}
                    className="absolute inset-0 size-full object-contain p-3 bg-[conic-gradient(at_30%_30%,oklch(0.92_0.05_70),oklch(0.97_0.02_80))]"
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
                        {new Date(ev.date).toLocaleDateString()}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <ImageIcon className="size-3.5" />
                      {countsQ.data?.[ev.id] ?? 0} photos
                    </span>
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-2 flex-wrap">
                  <Button variant="secondary" size="sm" className="rounded-full gap-1.5" onClick={() => setShareFor(ev)}>
                    <Share2 className="size-3.5" /> Share
                  </Button>
                  <Button asChild variant="secondary" size="sm" className="rounded-full gap-1.5">
                    <Link to="/admin/event/$slug" params={{ slug: ev.slug }}>
                      <Images className="size-3.5" /> Gallery
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="rounded-full gap-1.5">
                    <Link to="/event/$slug" params={{ slug: ev.slug }}>
                      <ExternalLink className="size-3.5" /> Open
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto rounded-full text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Delete "${ev.name}"? This removes all its photos.`)) delMut.mutate(ev.id);
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

      <ShareDialog event={shareFor} onClose={() => setShareFor(null)} />
    </div>
  );
}

function CreateEventDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [frame, setFrame] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!frame) { setPreview(null); return; }
    const url = URL.createObjectURL(frame);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [frame]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Event name is required");
    setBusy(true);
    try {
      const slug = uniqueSlug(name);
      let frame_url: string | null = null;
      if (frame) {
        frame_url = await uploadAndSign("event-frames", `${slug}/${Date.now()}-${frame.name}`, frame, frame.type);
      }
      const { error } = await supabase.from("events").insert({
        name: name.trim(),
        slug,
        date: date || null,
        frame_url,
      });
      if (error) throw error;
      toast.success("Event created");
      qc.invalidateQueries({ queryKey: ["events"] });
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle className="font-display text-2xl">Create new event</DialogTitle>
        <DialogDescription>
          Set up the booth in seconds. You can upload a transparent PNG frame to overlay on photos.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Event name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Henrique's Birthday" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="date">Event date</Label>
          <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="frame">Frame overlay (transparent PNG)</Label>
          <Input
            id="frame"
            type="file"
            accept="image/png,image/webp"
            onChange={(e) => setFrame(e.target.files?.[0] ?? null)}
          />
          {preview && (
            <div className="mt-2 aspect-[3/4] max-h-56 rounded-lg border border-border overflow-hidden bg-[conic-gradient(at_30%_30%,oklch(0.92_0.05_70),oklch(0.97_0.02_80))]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Frame preview" className="size-full object-contain" />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            The frame is applied as an overlay across the full final photo strip.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} className="rounded-full gap-2">
            {busy && <Loader2 className="size-4 animate-spin" />}
            Create event
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function ShareDialog({ event, onClose }: { event: EventRow | null; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = event && typeof window !== "undefined"
    ? `${window.location.origin}/event/${event.slug}`
    : "";

  useEffect(() => {
    if (!event || !url) return;
    QRCode.toDataURL(url, { width: 512, margin: 1, color: { dark: "#2b1810", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [event, url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy link");
    }
  }

  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2">
            <QrCode className="size-5" /> Share booth
          </DialogTitle>
          <DialogDescription>
            Guests scan this code or open the link to launch the booth for{" "}
            <span className="font-semibold text-foreground">{event?.name}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-2xl bg-white p-3 shadow-sm border border-border">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR code" className="size-56" />
            ) : (
              <div className="size-56 grid place-items-center"><Loader2 className="animate-spin" /></div>
            )}
          </div>
          <div className="w-full flex items-center gap-2 rounded-full border border-input bg-background px-3 py-2">
            <span className="truncate text-sm text-muted-foreground flex-1">{url}</span>
            <Button size="sm" variant="ghost" className="rounded-full gap-1.5" onClick={copy}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
