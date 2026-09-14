import { supabase } from "@/integrations/supabase/client";

// Frames/logos/backgrounds are non-sensitive branding assets reused by every guest.
const LONG_LIVED = 60 * 60 * 24 * 365;
// Guest media is sensitive: short-lived URLs so hidden/deleted photos stop resolving.
export const PHOTO_URL_TTL = 60 * 60; // 1 hour

type Bucket = "event-frames" | "event-photos" | "generic-frames";

export async function uploadAndSign(
  bucket: Bucket,
  path: string,
  file: Blob,
  contentType?: string,
): Promise<string> {
  const up = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType: contentType ?? (file as File).type ?? "application/octet-stream",
  });
  if (up.error) throw up.error;
  const ttl = bucket === "event-photos" ? PHOTO_URL_TTL : LONG_LIVED;
  const signed = await supabase.storage.from(bucket).createSignedUrl(path, ttl);
  if (signed.error || !signed.data) throw signed.error ?? new Error("Signed URL failed");
  return signed.data.signedUrl;
}

/** Extracts the object path inside a bucket from a (possibly expired) signed URL. */
export function storagePathFromUrl(url: string, bucket: Bucket = "event-photos"): string | null {
  const markers = [`/object/sign/${bucket}/`, `/object/public/${bucket}/`];
  const marker = markers.find((candidate) => url.includes(candidate));
  if (!marker) return null;
  const rest = url.slice(url.indexOf(marker) + marker.length).split("?")[0];
  if (!rest) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

export async function refreshPhotoUrlsStrict<T extends { photo_url: string }>(
  rows: T[],
): Promise<T[]> {
  if (!rows.length) return rows;
  const paths = rows.map((row) => storagePathFromUrl(row.photo_url));
  const unique = Array.from(new Set(paths.filter((path): path is string => Boolean(path))));
  if (!unique.length) return rows;
  const { data, error } = await supabase.storage
    .from("event-photos")
    .createSignedUrls(unique, PHOTO_URL_TTL);
  if (error || !data) throw error ?? new Error("Não foi possível carregar as mídias do evento.");
  const signedByPath = new Map<string, string>();
  data.forEach((item) => {
    if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
  });
  return rows.map((row, index) => {
    const path = paths[index];
    const signedUrl = path ? signedByPath.get(path) : undefined;
    return signedUrl ? { ...row, photo_url: signedUrl } : row;
  });
}

/**
 * Re-signs stored photo URLs with a short TTL so that revoked, hidden or deleted
 * media can no longer be reached through an old long-lived link.
 */
export async function refreshPhotoUrls<T extends { photo_url: string }>(rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const paths = rows.map((r) => storagePathFromUrl(r.photo_url));
  const unique = Array.from(new Set(paths.filter((p): p is string => !!p)));
  if (!unique.length) return rows;
  const { data, error } = await supabase.storage
    .from("event-photos")
    .createSignedUrls(unique, PHOTO_URL_TTL);
  if (error || !data) return rows;
  const map = new Map<string, string>();
  data.forEach((d) => {
    if (d.path && d.signedUrl) map.set(d.path, d.signedUrl);
  });
  return rows.map((r, i) => {
    const p = paths[i];
    const fresh = p ? map.get(p) : undefined;
    return fresh ? { ...r, photo_url: fresh } : r;
  });
}
