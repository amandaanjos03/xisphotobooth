
-- Generic frames library
CREATE TABLE public.generic_frames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  image_url text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.generic_frames TO authenticated;
GRANT ALL ON public.generic_frames TO service_role;
ALTER TABLE public.generic_frames ENABLE ROW LEVEL SECURITY;
CREATE POLICY generic_frames_select_auth ON public.generic_frames FOR SELECT TO authenticated USING (true);
CREATE POLICY generic_frames_select_anon ON public.generic_frames FOR SELECT TO anon USING (true);
GRANT SELECT ON public.generic_frames TO anon;
CREATE POLICY generic_frames_master_all ON public.generic_frames FOR ALL TO authenticated
  USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));

-- Event frames (many per event)
CREATE TABLE public.event_frames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  frame_url text NOT NULL,
  name text,
  source text NOT NULL DEFAULT 'custom',
  position smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.event_frames TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.event_frames TO authenticated;
GRANT ALL ON public.event_frames TO service_role;
ALTER TABLE public.event_frames ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_frames_select ON public.event_frames FOR SELECT USING (true);
CREATE POLICY event_frames_owner_all ON public.event_frames FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_frames.event_id AND e.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_frames.event_id AND e.owner_id = auth.uid()));
CREATE POLICY event_frames_master_all ON public.event_frames FOR ALL TO authenticated
  USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE INDEX event_frames_event_id_idx ON public.event_frames(event_id);

-- Instagram filter link on events
ALTER TABLE public.events ADD COLUMN instagram_filter_url text;

-- Realtime for photos
ALTER PUBLICATION supabase_realtime ADD TABLE public.photos;
