-- 1) Remove self-promotion to admin
DROP FUNCTION IF EXISTS public.claim_admin_role();
DROP FUNCTION IF EXISTS private.do_claim_admin_role(uuid);

-- 2) Remove hardcoded-email master trigger
DROP TRIGGER IF EXISTS on_auth_user_created_grant_master ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_updated_grant_master ON auth.users;
DROP FUNCTION IF EXISTS public.grant_master_for_amanda();
DROP FUNCTION IF EXISTS private.grant_master_for_amanda();

-- 3) Master-controlled admin role granting
CREATE OR REPLACE FUNCTION private.set_admin_role(_user_id uuid, _grant boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _grant THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, 'admin') ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role = 'admin';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_admin_role(_user_id uuid, _grant boolean)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$ SELECT private.set_admin_role(_user_id, _grant) $$;

REVOKE ALL ON FUNCTION public.set_admin_role(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_admin_role(uuid, boolean) TO authenticated;

-- Master can see accounts awaiting approval
CREATE OR REPLACE FUNCTION private.list_pending_users()
RETURNS TABLE(user_id uuid, email text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT u.id, u.email::text, u.created_at
    FROM auth.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'admin'
    )
    ORDER BY u.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_pending_users()
RETURNS TABLE(user_id uuid, email text, created_at timestamptz)
LANGUAGE sql
SET search_path = public
AS $$ SELECT * FROM private.list_pending_users() $$;

REVOKE ALL ON FUNCTION public.list_pending_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_users() TO authenticated;

-- 4) Event access passes (proof the guest knows the event code)
CREATE TABLE IF NOT EXISTS public.event_access_tokens (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '12 hours'
);

GRANT ALL ON public.event_access_tokens TO service_role;
ALTER TABLE public.event_access_tokens ENABLE ROW LEVEL SECURITY;
-- no policies: only reachable through the security-definer helpers below

CREATE INDEX IF NOT EXISTS event_access_tokens_event_idx ON public.event_access_tokens(event_id);

CREATE OR REPLACE FUNCTION private.issue_event_access(_slug text, _code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event public.events%ROWTYPE;
  _ok boolean := false;
  _token uuid;
BEGIN
  SELECT * INTO _event FROM public.events WHERE slug = _slug;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF auth.uid() IS NOT NULL
     AND (_event.owner_id = auth.uid() OR private.is_super_admin(auth.uid())) THEN
    _ok := true;
  ELSIF NOT _event.requires_code THEN
    _ok := true;
  ELSIF _code IS NOT NULL AND private.verify_event_code(_slug, _code) THEN
    _ok := true;
  END IF;

  IF NOT _ok THEN RETURN NULL; END IF;

  DELETE FROM public.event_access_tokens WHERE expires_at < now();
  INSERT INTO public.event_access_tokens (event_id) VALUES (_event.id) RETURNING token INTO _token;
  RETURN _token;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_event_access(_slug text, _code text DEFAULT NULL)
RETURNS uuid
LANGUAGE sql
SET search_path = public
AS $$ SELECT private.issue_event_access(_slug, _code) $$;

REVOKE ALL ON FUNCTION public.issue_event_access(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_event_access(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION private.has_event_access(_token uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_access_tokens t
    WHERE t.token = _token AND t.event_id = _event_id AND t.expires_at > now()
  )
$$;

CREATE OR REPLACE FUNCTION public.has_event_access(_token uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT private.has_event_access(_token, _event_id) $$;

REVOKE ALL ON FUNCTION public.has_event_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_event_access(uuid, uuid) TO anon, authenticated;

-- Validates a storage object path of the form "<access-token>/<file>"
CREATE OR REPLACE FUNCTION private.storage_path_has_access(_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _first text := split_part(_name, '/', 1);
BEGIN
  IF _first !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.event_access_tokens t
    WHERE t.token = _first::uuid AND t.expires_at > now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.storage_path_has_access(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT private.storage_path_has_access(_name) $$;

REVOKE ALL ON FUNCTION public.storage_path_has_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_path_has_access(text) TO anon, authenticated;

-- 5) Tie photo inserts to a verified access pass
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS access_token uuid;

DROP POLICY IF EXISTS photos_anon_insert ON public.photos;
CREATE POLICY photos_anon_insert ON public.photos
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    public.has_event_access(access_token, event_id)
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = photos.event_id
        AND (e.owner_id = auth.uid() OR public.is_super_admin(auth.uid()))
    )
  );

-- 6) Storage uploads require a valid access pass too
DROP POLICY IF EXISTS event_photos_anon_insert ON storage.objects;
CREATE POLICY event_photos_anon_insert ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'event-photos'
    AND public.storage_path_has_access(name)
  );
