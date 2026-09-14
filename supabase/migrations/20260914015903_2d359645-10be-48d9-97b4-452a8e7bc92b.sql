ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS theme_slug text NOT NULL DEFAULT 'minimal'
  CHECK (theme_slug IN ('kpop-warrior', 'kids', 'jungle', 'neon-party', 'elegant', 'minimal'));

REVOKE SELECT ON TABLE public.events FROM anon;
GRANT SELECT (
  id, name, slug, date, frame_url, photo_count, created_at, bg_url,
  description, print_layout, overlay_type, logo_url, logo_position,
  logo_size, requires_code, instagram_filter_url, theme_slug
) ON public.events TO anon;
GRANT SELECT ON TABLE public.events TO authenticated;
GRANT ALL ON TABLE public.events TO service_role;

DROP POLICY IF EXISTS photos_select ON public.photos;
CREATE POLICY photos_select ON public.photos
  FOR SELECT TO anon, authenticated
  USING (
    hidden = false
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = photos.event_id
        AND (e.owner_id = auth.uid() OR public.is_super_admin(auth.uid()))
    )
  );

REVOKE SELECT ON TABLE public.photos FROM anon;
GRANT SELECT (id, event_id, photo_url, created_at, hidden, media_type) ON public.photos TO anon;
GRANT SELECT ON TABLE public.photos TO authenticated;
GRANT ALL ON TABLE public.photos TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'photos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.photos;
  END IF;
END
$$;