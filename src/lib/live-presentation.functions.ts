import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PHOTO_URL_TTL = 60 * 60;

function photoStoragePath(url: string): string | null {
  const markers = ["/object/sign/event-photos/", "/object/public/event-photos/"];
  const marker = markers.find((candidate) => url.includes(candidate));
  if (!marker) return null;
  const encoded = url.slice(url.indexOf(marker) + marker.length).split("?")[0];
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

export const getLivePresentation = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ slug: z.string().min(1).max(160) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("id, name, slug, bg_url, theme_slug")
      .eq("slug", data.slug)
      .maybeSingle();
    if (eventError) throw eventError;
    if (!event) return null;

    const { data: photos, error: photosError } = await supabaseAdmin
      .from("photos")
      .select("id, photo_url, media_type, created_at")
      .eq("event_id", event.id)
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(200);
    if (photosError) throw photosError;

    const rows = photos ?? [];
    const paths = rows.map((photo) => photoStoragePath(photo.photo_url));
    const uniquePaths = Array.from(new Set(paths.filter((path): path is string => Boolean(path))));
    if (!uniquePaths.length) return { event, photos: rows };

    const { data: signed, error: signedError } = await supabaseAdmin.storage
      .from("event-photos")
      .createSignedUrls(uniquePaths, PHOTO_URL_TTL);
    if (signedError || !signed) throw signedError ?? new Error("Não foi possível abrir as fotos.");
    const signedByPath = new Map(
      signed.flatMap((item) => (item.path && item.signedUrl ? [[item.path, item.signedUrl]] : [])),
    );

    return {
      event,
      photos: rows.map((photo, index) => {
        const path = paths[index];
        const signedUrl = path ? signedByPath.get(path) : undefined;
        return signedUrl ? { ...photo, photo_url: signedUrl } : photo;
      }),
    };
  });