
-- 1) Restrict access_code/access_code_hash from anonymous visitors via column-level grants
REVOKE SELECT ON public.events FROM anon;
GRANT SELECT (id, name, slug, date, frame_url, created_at, photo_count, owner_id, bg_url, description, print_layout, overlay_type, logo_url, logo_position, logo_size) ON public.events TO anon;

-- 2) Remove unrestricted guest delete on photos
DROP POLICY IF EXISTS photos_guest_delete_recent ON public.photos;

-- 3) Private schema for SECURITY DEFINER helpers
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO anon, authenticated;

-- has_role: move definer body into private, replace public function body with an INVOKER wrapper
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
REVOKE EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT private.has_role(_user_id, _role)
$$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- Note: has_role(_role, _user_id) overload (reverse arg order) is also referenced; recreate as invoker wrapper if present
DO $$
DECLARE
  fn_oid oid;
BEGIN
  SELECT p.oid INTO fn_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'has_role'
    AND pg_get_function_identity_arguments(p.oid) = '_role public.app_role, _user_id uuid';
  IF fn_oid IS NOT NULL THEN
    EXECUTE 'CREATE OR REPLACE FUNCTION public.has_role(_role public.app_role, _user_id uuid)
      RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $body$
        SELECT private.has_role(_user_id, _role)
      $body$';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.has_role(public.app_role, uuid) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.has_role(public.app_role, uuid) TO authenticated';
  END IF;
END $$;

-- verify_event_code: definer in private, invoker wrapper in public
CREATE OR REPLACE FUNCTION private.verify_event_code(_slug text, _code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events
    WHERE slug = _slug AND (
      (access_code IS NOT NULL AND access_code = _code)
      OR (access_code_hash IS NOT NULL AND access_code_hash = extensions.crypt(_code, access_code_hash))
    )
  );
$$;
REVOKE EXECUTE ON FUNCTION private.verify_event_code(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.verify_event_code(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.verify_event_code(_slug text, _code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT private.verify_event_code(_slug, _code)
$$;
REVOKE EXECUTE ON FUNCTION public.verify_event_code(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_event_code(text, text) TO anon, authenticated;

-- claim_admin_role: definer in private, invoker wrapper in public
CREATE OR REPLACE FUNCTION private.do_claim_admin_role(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.do_claim_admin_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.do_claim_admin_role(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_admin_role()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  PERFORM private.do_claim_admin_role(auth.uid());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_admin_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_admin_role() TO authenticated;

-- hash_event_code: move definer to private, replace public with invoker wrapper (kept for any internal callers)
CREATE OR REPLACE FUNCTION private.hash_event_code(_code text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT extensions.crypt(_code, extensions.gen_salt('bf'));
$$;
REVOKE EXECUTE ON FUNCTION private.hash_event_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.hash_event_code(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.hash_event_code(_code text)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT private.hash_event_code(_code)
$$;
REVOKE EXECUTE ON FUNCTION public.hash_event_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hash_event_code(text) TO authenticated;
