ALTER TABLE public.events
ADD COLUMN slideshow_interval_seconds smallint NOT NULL DEFAULT 5
CONSTRAINT events_slideshow_interval_seconds_check CHECK (slideshow_interval_seconds BETWEEN 2 AND 60);