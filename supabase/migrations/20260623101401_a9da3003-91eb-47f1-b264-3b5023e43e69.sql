
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS access_code_hash text;

-- Backfill existing events to the first existing admin so isolation is consistent
UPDATE public.events
SET owner_id = (SELECT user_id FROM public.user_roles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1)
WHERE owner_id IS NULL;

-- Replace global admin policies with per-owner policies
DROP POLICY IF EXISTS events_admin_insert ON public.events;
DROP POLICY IF EXISTS events_admin_update ON public.events;
DROP POLICY IF EXISTS events_admin_delete ON public.events;

CREATE POLICY events_owner_insert ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) AND owner_id = auth.uid());

CREATE POLICY events_owner_update ON public.events
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY events_owner_delete ON public.events
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- Allow guests/admins to delete a photo they just created (within 15 minutes)
DROP POLICY IF EXISTS photos_guest_delete_recent ON public.photos;
CREATE POLICY photos_guest_delete_recent ON public.photos
  FOR DELETE TO anon, authenticated
  USING (created_at > (now() - interval '15 minutes'));

-- Verify the access code for a given event slug
CREATE OR REPLACE FUNCTION public.verify_event_code(_slug text, _code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events
    WHERE slug = _slug
      AND access_code_hash IS NOT NULL
      AND access_code_hash = extensions.crypt(_code, access_code_hash)
  );
$$;
GRANT EXECUTE ON FUNCTION public.verify_event_code(text, text) TO anon, authenticated;

-- Hash an event access code (used by admins when creating events)
CREATE OR REPLACE FUNCTION public.hash_event_code(_code text)
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT extensions.crypt(_code, extensions.gen_salt('bf'));
$$;
GRANT EXECUTE ON FUNCTION public.hash_event_code(text) TO authenticated;

-- Self-claim admin role after first login (replaces manual provisioning).
-- Called from the client right after a confirmed user signs in.
CREATE OR REPLACE FUNCTION public.claim_admin_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_admin_role() TO authenticated;
