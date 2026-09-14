export type EventThemeSlug =
  | "kpop-warrior"
  | "kids"
  | "jungle"
  | "neon-party"
  | "elegant"
  | "minimal";

export const EVENT_THEMES: Array<{
  slug: EventThemeSlug;
  name: string;
  description: string;
  swatches: [string, string, string];
}> = [
  {
    slug: "kpop-warrior",
    name: "K-pop Guerreiro",
    description: "Elétrico, dramático e vibrante",
    swatches: ["theme-swatch-kpop-a", "theme-swatch-kpop-b", "theme-swatch-kpop-c"],
  },
  {
    slug: "kids",
    name: "Infantil",
    description: "Alegre, colorido e divertido",
    swatches: ["theme-swatch-kids-a", "theme-swatch-kids-b", "theme-swatch-kids-c"],
  },
  {
    slug: "jungle",
    name: "Selva",
    description: "Tropical, natural e aventureiro",
    swatches: ["theme-swatch-jungle-a", "theme-swatch-jungle-b", "theme-swatch-jungle-c"],
  },
  {
    slug: "neon-party",
    name: "Festa Neon",
    description: "Noturno, intenso e luminoso",
    swatches: ["theme-swatch-neon-a", "theme-swatch-neon-b", "theme-swatch-neon-c"],
  },
  {
    slug: "elegant",
    name: "Elegante",
    description: "Sofisticado, clássico e discreto",
    swatches: ["theme-swatch-elegant-a", "theme-swatch-elegant-b", "theme-swatch-elegant-c"],
  },
  {
    slug: "minimal",
    name: "Minimalista",
    description: "Claro, moderno e atemporal",
    swatches: ["theme-swatch-minimal-a", "theme-swatch-minimal-b", "theme-swatch-minimal-c"],
  },
];

export function normalizeEventTheme(value: string | null | undefined): EventThemeSlug {
  return EVENT_THEMES.some((theme) => theme.slug === value) ? (value as EventThemeSlug) : "minimal";
}
