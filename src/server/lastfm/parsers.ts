export type ParsedArtistPlay = {
  artist: string;
  plays: number;
};

export type ParsedTrackPlay = {
  artist: string;
  track: string;
  plays: number;
};

export type ParsedArtistInfo = {
  artist: string;
  tags: string[];
  similar: string[];
  bio: string;
  yourPlays: number;
};

export type ParsedSimilarArtist = {
  artist: string;
  match: number;
};

export function parseAuthStatus(text: string): {
  authenticated: boolean;
  username: string | null;
} {
  const authenticated = /Authentication Status:\s*Authenticated/i.test(text);
  const usernameMatch = text.match(/Authenticated as:\*\*\s*([^\n]+)/i);

  return {
    authenticated,
    username: usernameMatch?.[1]?.trim() ?? null,
  };
}

export function parseWeeklyArtistChart(text: string): ParsedArtistPlay[] {
  const rows = text.split("\n");
  const parsed: ParsedArtistPlay[] = [];

  for (const line of rows) {
    const match = line.match(/^\d+\.\s+(.+?)\s+\((\d+)\s+plays\)$/);
    if (!match) continue;

    parsed.push({
      artist: match[1].trim(),
      plays: Number(match[2]),
    });
  }

  return parsed;
}

export function parseWeeklyTrackChart(text: string): ParsedTrackPlay[] {
  const rows = text.split("\n");
  const parsed: ParsedTrackPlay[] = [];

  for (const line of rows) {
    const match = line.match(/^\d+\.\s+(.+?)\s+-\s+(.+?)\s+\((\d+)\s+plays\)$/);
    if (!match) continue;

    parsed.push({
      artist: match[1].trim(),
      track: match[2].trim(),
      plays: Number(match[3]),
    });
  }

  return parsed;
}

export function parseArtistInfo(text: string): ParsedArtistInfo {
  const artist = text.match(/\*\*Artist:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "Unknown";

  const tagsLine = text.match(/\*\*Tags:\*\*\s*([^\n]+)/)?.[1] ?? "";
  const tags = tagsLine
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

  const similarLine = text.match(/\*\*Similar Artists:\*\*\s*([^\n]+)/)?.[1] ?? "";
  const similar = similarLine
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  const yourPlays = Number(text.match(/Your plays:\s*(\d+)/i)?.[1] ?? 0);

  const bio = text.match(/\*\*Bio:\*\*([\s\S]*?)(?:\n\n|$)/)?.[1]?.trim() ?? "";

  return {
    artist,
    tags,
    similar,
    bio,
    yourPlays,
  };
}

export function parseSimilarArtists(text: string): ParsedSimilarArtist[] {
  const rows = text.split("\n");
  const parsed: ParsedSimilarArtist[] = [];

  for (const line of rows) {
    const match = line.match(/^•\s+(.+?)\s+\((\d+)%\s+match\)$/);
    if (!match) continue;

    parsed.push({
      artist: match[1].trim(),
      match: Number(match[2]),
    });
  }

  return parsed;
}

export function detectFirstRecentYear(bio: string): number | null {
  const yearMatches = bio.match(/\b(19\d{2}|20\d{2})\b/g);
  if (!yearMatches || yearMatches.length === 0) {
    return null;
  }

  const years = yearMatches.map((value) => Number(value)).filter((year) => year >= 1950 && year <= 2035);
  if (years.length === 0) return null;
  return Math.min(...years);
}
