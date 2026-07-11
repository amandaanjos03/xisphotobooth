
-- 1. event_secrets table
CREATE TABLE public.event_secrets (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  access_code text,
  access_code_hash text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_secrets TO authenticated;
GRANT ALL ON public.event_secrets TO service_role;
ALTER TABLE public.event_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_secrets_owner_all ON public.event_secrets
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.owner_id = auth.uid()));

CREATE POLICY event_secrets_master_all ON public.event_secrets
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- Backfill from existing columns
INSERT INTO public.event_secrets (event_id, access_code, access_code_hash)
SELECT id, access_code, access_code_hash
FROM public.events
WHERE access_code IS NOT NULL OR access_code_hash IS NOT NULL
ON CONFLICT (event_id) DO NOTHING;

-- Drop sensitive columns
ALTER TABLE public.events DROP COLUMN access_code;
ALTER TABLE public.events DROP COLUMN access_code_hash;

-- 2. Update verify_event_code to read from event_secrets
CREATE OR REPLACE FUNCTION private.verify_event_code(_slug text, _code text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    JOIN public.event_secrets s ON s.event_id = e.id
    WHERE e.slug = _slug
      AND s.access_code IS NOT NULL
      AND s.access_code = _code
  )
$$;

-- 3. Convert public SECURITY DEFINER helpers into SECURITY INVOKER wrappers
GRANT USAGE ON SCHEMA private TO authenticated, anon;

-- is_super_admin: move DEFINER to private, expose INVOKER wrapper
CREATE OR REPLACE FUNCTION private.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = _user_id) $$;
GRANT EXECUTE ON FUNCTION private.is_super_admin(uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$ SELECT private.is_super_admin(_user_id) $$;

-- increment_event_view
CREATE OR REPLACE FUNCTION private.increment_event_view(_slug text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ UPDATE public.events SET view_count = view_count + 1 WHERE slug = _slug $$;
GRANT EXECUTE ON FUNCTION private.increment_event_view(text) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.increment_event_view(_slug text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public
AS $$ SELECT private.increment_event_view(_slug) $$;

-- increment_event_download
CREATE OR REPLACE FUNCTION private.increment_event_download(_event_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ UPDATE public.events SET download_count = download_count + 1 WHERE id = _event_id $$;
GRANT EXECUTE ON FUNCTION private.increment_event_download(uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.increment_event_download(_event_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public
AS $$ SELECT private.increment_event_download(_event_id) $$;

-- list_admin_users
CREATE OR REPLACE FUNCTION private.list_admin_users()
RETURNS TABLE(user_id uuid, email text, created_at timestamptz, blocked boolean, is_master boolean, event_count bigint, photo_count bigint, view_count bigint, download_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT private.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, u.created_at, COALESCE(ur.blocked, false),
    EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = u.id),
    COALESCE((SELECT count(*) FROM public.events e WHERE e.owner_id = u.id), 0),
    COALESCE((SELECT count(*) FROM public.photos p JOIN public.events e ON e.id = p.event_id WHERE e.owner_id = u.id), 0),
    COALESCE((SELECT sum(e.view_count) FROM public.events e WHERE e.owner_id = u.id), 0),
    COALESCE((SELECT sum(e.download_count) FROM public.events e WHERE e.owner_id = u.id), 0)
  FROM auth.users u
  JOIN public.user_roles ur ON ur.user_id = u.id AND ur.role = 'admin'
  ORDER BY u.created_at DESC;
END; $$;
GRANT EXECUTE ON FUNCTION private.list_admin_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_admin_users()
RETURNS TABLE(user_id uuid, email text, created_at timestamptz, blocked boolean, is_master boolean, event_count bigint, photo_count bigint, view_count bigint, download_count bigint)
LANGUAGE sql SECURITY INVOKER SET search_path = public
AS $$ SELECT * FROM private.list_admin_users() $$;

-- set_admin_blocked
CREATE OR REPLACE FUNCTION private.set_admin_blocked(_user_id uuid, _blocked boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT private.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.user_roles SET blocked = _blocked WHERE user_id = _user_id AND role = 'admin';
END; $$;
GRANT EXECUTE ON FUNCTION private.set_admin_blocked(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_admin_blocked(_user_id uuid, _blocked boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public
AS $$ SELECT private.set_admin_blocked(_user_id, _blocked) $$;

-- set_allow_signups
CREATE OR REPLACE FUNCTION private.set_allow_signups(_allow boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT private.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.platform_settings SET allow_signups = _allow, updated_at = now() WHERE id = true;
END; $$;
GRANT EXECUTE ON FUNCTION private.set_allow_signups(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_allow_signups(_allow boolean)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public
AS $$ SELECT private.set_allow_signups(_allow) $$;

-- wipe_event_photos
CREATE OR REPLACE FUNCTION private.wipe_event_photos(_event_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _owner uuid; _deleted integer;
BEGIN
  SELECT owner_id INTO _owner FROM public.events WHERE id = _event_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'event not found'; END IF;
  IF _owner <> auth.uid() AND NOT private.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  WITH d AS (DELETE FROM public.photos WHERE event_id = _event_id RETURNING 1)
  SELECT count(*) INTO _deleted FROM d;
  RETURN _deleted;
END; $$;
GRANT EXECUTE ON FUNCTION private.wipe_event_photos(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.wipe_event_photos(_event_id uuid)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = public
AS $$ SELECT private.wipe_event_photos(_event_id) $$;

-- grant_master_for_amanda trigger fn: also convert to invoker wrapper
CREATE OR REPLACE FUNCTION private.grant_master_for_amanda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF lower(NEW.email) = 'amanda-anjos@live.com' THEN
    INSERT INTO public.super_admins (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.grant_master_for_amanda()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$ BEGIN RETURN private.grant_master_for_amanda(); END; $$;

-- Revoke default EXECUTE on the public wrappers' underlying DEFINER ancestors (already replaced above).
-- Ensure no lingering DEFINER on public wrappers:
ALTER FUNCTION public.is_super_admin(uuid) SECURITY INVOKER;
ALTER FUNCTION public.increment_event_view(text) SECURITY INVOKER;
ALTER FUNCTION public.increment_event_download(uuid) SECURITY INVOKER;
ALTER FUNCTION public.list_admin_users() SECURITY INVOKER;
ALTER FUNCTION public.set_admin_blocked(uuid, boolean) SECURITY INVOKER;
ALTER FUNCTION public.set_allow_signups(boolean) SECURITY INVOKER;
ALTER FUNCTION public.wipe_event_photos(uuid) SECURITY INVOKER;
ALTER FUNCTION public.grant_master_for_amanda() SECURITY INVOKER;
