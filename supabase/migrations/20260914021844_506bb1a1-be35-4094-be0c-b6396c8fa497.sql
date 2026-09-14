ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS card_text text,
  ADD COLUMN IF NOT EXISTS card_logo_url text;

GRANT SELECT (id, name, slug, date, frame_url, created_at, photo_count, bg_url, description, print_layout, overlay_type, logo_url, logo_position, logo_size, requires_code, view_count, download_count, instagram_filter_url, theme_slug, card_text, card_logo_url)
ON public.events TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;