ALTER TABLE public.events 
  ADD COLUMN IF NOT EXISTS bg_url text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS print_layout text NOT NULL DEFAULT 'portrait';

ALTER TABLE public.events
  ADD CONSTRAINT events_print_layout_chk
  CHECK (print_layout IN ('portrait','landscape','a4'));

GRANT SELECT (id, name, slug, date, frame_url, photo_count, created_at, owner_id, bg_url, description, print_layout) ON public.events TO anon;