
-- Add visible access code column for events; hide from anonymous guests.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS access_code TEXT;

-- Tighten column-level grants so anonymous visitors cannot read the code.
REVOKE SELECT ON public.events FROM anon;
GRANT SELECT (id, name, slug, date, frame_url, photo_count, created_at, owner_id) ON public.events TO anon;
-- Authenticated admins can read everything (RLS still applies on rows).
GRANT SELECT ON public.events TO authenticated;

-- Update verify_event_code to use the plaintext column when available,
-- falling back to the legacy hash for events created before this change.
CREATE OR REPLACE FUNCTION public.verify_event_code(_slug text, _code text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.events
    WHERE slug = _slug
      AND (
        (access_code IS NOT NULL AND access_code = _code)
        OR (access_code_hash IS NOT NULL AND access_code_hash = extensions.crypt(_code, access_code_hash))
      )
  );
$function$;
