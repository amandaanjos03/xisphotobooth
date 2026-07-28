
CREATE POLICY generic_frames_read ON storage.objects FOR SELECT
  USING (bucket_id = 'generic-frames');
CREATE POLICY generic_frames_master_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'generic-frames' AND public.is_super_admin(auth.uid()));
CREATE POLICY generic_frames_master_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'generic-frames' AND public.is_super_admin(auth.uid()))
  WITH CHECK (bucket_id = 'generic-frames' AND public.is_super_admin(auth.uid()));
CREATE POLICY generic_frames_master_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'generic-frames' AND public.is_super_admin(auth.uid()));
