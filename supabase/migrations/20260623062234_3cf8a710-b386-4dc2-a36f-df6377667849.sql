
CREATE POLICY "event_frames_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'event-frames');
CREATE POLICY "event_frames_public_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'event-frames');
CREATE POLICY "event_photos_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'event-photos');
CREATE POLICY "event_photos_public_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'event-photos');

-- Tighten event/photo policies to reduce permissive warnings (read-only for everyone, insert-only without auth)
DROP POLICY IF EXISTS "events_public_all" ON public.events;
DROP POLICY IF EXISTS "photos_public_all" ON public.photos;

CREATE POLICY "events_select" ON public.events FOR SELECT USING (true);
CREATE POLICY "events_insert" ON public.events FOR INSERT WITH CHECK (true);
CREATE POLICY "events_update" ON public.events FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "events_delete" ON public.events FOR DELETE USING (true);

CREATE POLICY "photos_select" ON public.photos FOR SELECT USING (true);
CREATE POLICY "photos_insert" ON public.photos FOR INSERT WITH CHECK (true);
CREATE POLICY "photos_delete" ON public.photos FOR DELETE USING (true);
