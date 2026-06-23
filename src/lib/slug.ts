export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

export function uniqueSlug(base: string): string {
  const root = slugify(base) || "event";
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${root}-${suffix}`;
}
