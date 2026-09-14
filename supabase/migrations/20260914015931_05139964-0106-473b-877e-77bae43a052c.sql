CREATE POLICY event_access_tokens_service_only ON public.event_access_tokens
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);