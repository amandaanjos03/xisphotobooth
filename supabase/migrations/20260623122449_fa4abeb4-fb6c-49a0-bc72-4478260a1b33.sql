ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS overlay_type TEXT NOT NULL DEFAULT 'frame',
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS logo_position TEXT NOT NULL DEFAULT 'bottom',
  ADD COLUMN IF NOT EXISTS logo_size SMALLINT NOT NULL DEFAULT 25;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_overlay_type_check;
ALTER TABLE public.events ADD CONSTRAINT events_overlay_type_check CHECK (overlay_type IN ('frame','logo'));
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_logo_position_check;
ALTER TABLE public.events ADD CONSTRAINT events_logo_position_check CHECK (logo_position IN ('top','bottom','left','right'));