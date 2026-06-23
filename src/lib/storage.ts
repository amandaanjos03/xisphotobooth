import { supabase } from "@/integrations/supabase/client";

// Long-lived signed URLs (≈10 years). Buckets are private; RLS permits anon read.
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

export async function uploadAndSign(
  bucket: "event-frames" | "event-photos",
  path: string,
  file: Blob,
  contentType?: string,
): Promise<string> {
  const up = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType: contentType ?? (file as File).type ?? "application/octet-stream",
  });
  if (up.error) throw up.error;
  const signed = await supabase.storage.from(bucket).createSignedUrl(path, TEN_YEARS);
  if (signed.error || !signed.data) throw signed.error ?? new Error("Signed URL failed");
  return signed.data.signedUrl;
}
