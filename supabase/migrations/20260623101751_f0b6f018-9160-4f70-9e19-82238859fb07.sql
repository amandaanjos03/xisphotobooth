
DROP POLICY IF EXISTS photos_admin_update ON public.photos;
DROP POLICY IF EXISTS photos_admin_delete ON public.photos;

CREATE POLICY photos_owner_update ON public.photos
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = photos.event_id AND e.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = photos.event_id AND e.owner_id = auth.uid()));

CREATE POLICY photos_owner_delete ON public.photos
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = photos.event_id AND e.owner_id = auth.uid()));
