ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'image';
ALTER TABLE public.photos ADD CONSTRAINT photos_media_type_check CHECK (media_type IN ('image','video'));