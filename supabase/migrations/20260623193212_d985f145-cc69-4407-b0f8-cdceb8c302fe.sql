
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS requires_code boolean NOT NULL DEFAULT true;

GRANT SELECT (requires_code) ON public.events TO anon;
