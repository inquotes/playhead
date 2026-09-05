export const DISCOVERY_PLAYCOUNT_THRESHOLD = 10;

export type ArtistPlaycount = {
  artistName: string;
  normalizedName: string;
  playcount: number;
};

export function normalizeArtistName(value: string): string {
  return value.trim().toLowerCase();
}

export function uniqueArtists(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const artist = value.trim();
    if (!artist) continue;

    const normalizedName = normalizeArtistName(artist);
    if (seen.has(normalizedName)) continue;

    seen.add(normalizedName);
    unique.push(artist);
  }

  return unique;
}

export function mergeArtistPlaycounts(
  base: ArtistPlaycount[],
  delta: ArtistPlaycount[],
): ArtistPlaycount[] {
  const merged = new Map(base.map((row) => [row.normalizedName, { ...row }]));

  for (const row of delta) {
    const existing = merged.get(row.normalizedName);
    if (existing) {
      existing.playcount += row.playcount;
    } else {
      merged.set(row.normalizedName, { ...row });
    }
  }

  return [...merged.values()].sort((a, b) => b.playcount - a.playcount);
}
