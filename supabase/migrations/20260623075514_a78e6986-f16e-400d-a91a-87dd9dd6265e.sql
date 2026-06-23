
-- 1. Role enum + user_roles table
CREATE TYPE public.app_role AS ENUM ('admin');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_can_read_own_roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 2. has_role security-definer helper
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 3. Lock down events: read public, writes admin-only
DROP POLICY IF EXISTS events_insert ON public.events;
DROP POLICY IF EXISTS events_update ON public.events;
DROP POLICY IF EXISTS events_delete ON public.events;

CREATE POLICY "events_admin_insert"
ON public.events
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "events_admin_update"
ON public.events
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "events_admin_delete"
ON public.events
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 4. Lock down photos: read public, anon INSERT (booth) stays, UPDATE/DELETE admin-only
DROP POLICY IF EXISTS photos_insert ON public.photos;
DROP POLICY IF EXISTS photos_update ON public.photos;
DROP POLICY IF EXISTS photos_delete ON public.photos;

-- attendees at the booth are anonymous; insert must reference a real event
CREATE POLICY "photos_anon_insert"
ON public.photos
FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.events e WHERE e.id = photos.event_id)
);

CREATE POLICY "photos_admin_update"
ON public.photos
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "photos_admin_delete"
ON public.photos
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 5. Storage policies
-- event-frames: only admins may write
DROP POLICY IF EXISTS event_frames_public_insert ON storage.objects;
DROP POLICY IF EXISTS event_frames_public_update ON storage.objects;
DROP POLICY IF EXISTS event_frames_public_delete ON storage.objects;

CREATE POLICY "event_frames_admin_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'event-frames' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "event_frames_admin_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'event-frames' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'event-frames' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "event_frames_admin_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'event-frames' AND public.has_role(auth.uid(), 'admin'));

-- event-photos: anon INSERT (booth), admin-only UPDATE/DELETE
DROP POLICY IF EXISTS event_photos_public_insert ON storage.objects;
DROP POLICY IF EXISTS event_photos_public_update ON storage.objects;
DROP POLICY IF EXISTS event_photos_public_delete ON storage.objects;

CREATE POLICY "event_photos_anon_insert"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'event-photos');

CREATE POLICY "event_photos_admin_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'event-photos' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'event-photos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "event_photos_admin_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'event-photos' AND public.has_role(auth.uid(), 'admin'));
