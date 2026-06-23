ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
CREATE POLICY "photos_update" ON public.photos FOR UPDATE USING (true) WITH CHECK (true);