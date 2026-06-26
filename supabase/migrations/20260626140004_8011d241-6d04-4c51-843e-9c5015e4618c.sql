
-- 1. Super admins table
CREATE TABLE IF NOT EXISTS public.super_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.super_admins TO authenticated;
GRANT ALL ON public.super_admins TO service_role;
ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self read super_admin" ON public.super_admins
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 2. Blocked flag on admin roles
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false;

-- 3. Platform settings singleton
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  allow_signups boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_settings TO anon, authenticated;
GRANT ALL ON public.platform_settings TO service_role;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads settings" ON public.platform_settings FOR SELECT TO anon, authenticated USING (true);
INSERT INTO public.platform_settings (id, allow_signups) VALUES (true, true)
  ON CONFLICT (id) DO NOTHING;

-- 4. Event counters
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS download_count integer NOT NULL DEFAULT 0;

-- 5. is_super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = _user_id) $$;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

-- 6. Auto-grant master role to amanda-anjos@live.com
CREATE OR REPLACE FUNCTION public.grant_master_for_amanda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF lower(NEW.email) = 'amanda-anjos@live.com' THEN
    INSERT INTO public.super_admins (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created_grant_master ON auth.users;
CREATE TRIGGER on_auth_user_created_grant_master
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.grant_master_for_amanda();
DROP TRIGGER IF EXISTS on_auth_user_updated_grant_master ON auth.users;
CREATE TRIGGER on_auth_user_updated_grant_master
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.grant_master_for_amanda();

-- Backfill now for existing user
INSERT INTO public.super_admins (user_id)
  SELECT id FROM auth.users WHERE lower(email) = 'amanda-anjos@live.com'
  ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role)
  SELECT id, 'admin'::app_role FROM auth.users WHERE lower(email) = 'amanda-anjos@live.com'
  ON CONFLICT (user_id, role) DO NOTHING;

-- 7. Counters RPCs (callable by anyone, increment only)
CREATE OR REPLACE FUNCTION public.increment_event_view(_slug text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ UPDATE public.events SET view_count = view_count + 1 WHERE slug = _slug $$;
REVOKE ALL ON FUNCTION public.increment_event_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_event_view(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.increment_event_download(_event_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ UPDATE public.events SET download_count = download_count + 1 WHERE id = _event_id $$;
REVOKE ALL ON FUNCTION public.increment_event_download(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_event_download(uuid) TO anon, authenticated;

-- 8. Master controls
CREATE OR REPLACE FUNCTION public.set_admin_blocked(_user_id uuid, _blocked boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.user_roles SET blocked = _blocked WHERE user_id = _user_id AND role = 'admin';
END;
$$;
REVOKE ALL ON FUNCTION public.set_admin_blocked(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_admin_blocked(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_allow_signups(_allow boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.platform_settings SET allow_signups = _allow, updated_at = now() WHERE id = true;
END;
$$;
REVOKE ALL ON FUNCTION public.set_allow_signups(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_allow_signups(boolean) TO authenticated;

-- 9. List admins with stats (master only)
CREATE OR REPLACE FUNCTION public.list_admin_users()
RETURNS TABLE (
  user_id uuid, email text, created_at timestamptz, blocked boolean,
  is_master boolean, event_count bigint, photo_count bigint,
  view_count bigint, download_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT
    u.id, u.email::text, u.created_at, COALESCE(ur.blocked, false),
    EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = u.id),
    COALESCE((SELECT count(*) FROM public.events e WHERE e.owner_id = u.id), 0),
    COALESCE((SELECT count(*) FROM public.photos p JOIN public.events e ON e.id = p.event_id WHERE e.owner_id = u.id), 0),
    COALESCE((SELECT sum(e.view_count) FROM public.events e WHERE e.owner_id = u.id), 0),
    COALESCE((SELECT sum(e.download_count) FROM public.events e WHERE e.owner_id = u.id), 0)
  FROM auth.users u
  JOIN public.user_roles ur ON ur.user_id = u.id AND ur.role = 'admin'
  ORDER BY u.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.list_admin_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_admin_users() TO authenticated;

-- 10. Wipe all photos of an event (owner or master)
CREATE OR REPLACE FUNCTION public.wipe_event_photos(_event_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _owner uuid;
  _deleted integer;
BEGIN
  SELECT owner_id INTO _owner FROM public.events WHERE id = _event_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'event not found'; END IF;
  IF _owner <> auth.uid() AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  WITH d AS (DELETE FROM public.photos WHERE event_id = _event_id RETURNING 1)
  SELECT count(*) INTO _deleted FROM d;
  RETURN _deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.wipe_event_photos(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wipe_event_photos(uuid) TO authenticated;

-- 11. Master can read all admin role rows (for the dashboard)
DROP POLICY IF EXISTS master_reads_all_roles ON public.user_roles;
CREATE POLICY master_reads_all_roles ON public.user_roles
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

-- 12. Block blocked admins from creating/updating events
DROP POLICY IF EXISTS events_owner_insert ON public.events;
CREATE POLICY events_owner_insert ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    AND owner_id = auth.uid()
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role='admin' AND ur.blocked)
  );

-- 13. Master can manage all events
DROP POLICY IF EXISTS events_master_all ON public.events;
CREATE POLICY events_master_all ON public.events
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
