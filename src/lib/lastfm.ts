import "server-only";
import { createHash } from "crypto";

const LASTFM_API_BASE = "https://ws.audioscrobbler.com/2.0/";

type JsonRecord = Record<string, unknown>;

type LastfmCallParams = {
  method: string;
  params?: Record<string, string | number | boolean | undefined | null>;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getEnv(name: "LASTFM_API_KEY" | "LASTFM_API_SECRET"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

export function getLastfmApiKey(): string {
  return getEnv("LASTFM_API_KEY");
}

export function getLastfmApiSecret(): string {
  return getEnv("LASTFM_API_SECRET");
}

function signLastfmParams(params: Record<string, string>): string {
  const payload = Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}${params[key]}`)
    .join("");

  return createHash("md5").update(`${payload}${getLastfmApiSecret()}`).digest("hex");
}

async function callLastfm<T extends JsonRecord>({ method, params = {} }: LastfmCallParams): Promise<T> {
  const query = new URLSearchParams({
    method,
    api_key: getLastfmApiKey(),
    format: "json",
  });

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    query.set(key, String(value));
  }

  const maxAttempts = 3;
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await fetch(`${LASTFM_API_BASE}?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      const data = (await response.json()) as JsonRecord;

      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
          await delay(220 * attempt);
          continue;
        }
        throw new Error(`Last.fm request failed (${response.status}): ${JSON.stringify(data)}`);
      }

      if (typeof data.error === "number" || typeof data.error === "string") {
        const code = Number(data.error);
        if ((code === 8 || code === 11 || code === 16 || code === 29) && attempt < maxAttempts) {
          await delay(220 * attempt);
          continue;
        }
        throw new Error(`Last.fm API error (${String(data.error)}): ${String(data.message ?? "Unknown error")}`);
      }

      return data as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown Last.fm fetch error.");
      if (attempt >= maxAttempts) {
        break;
      }
      await delay(220 * attempt);
    }
  }

  throw lastError ?? new Error("Last.fm request failed.");
}

export type LastfmTopArtistsParams = {
  user: string;
  period?: "overall" | "7day" | "1month" | "3month" | "6month" | "12month";
  limit?: number;
  page?: number;
};

export type LastfmUserInfoParams = {
  user: string;
};

export async function getUserInfo(params: LastfmUserInfoParams) {
  return callLastfm<{ user: JsonRecord }>({
    method: "user.getInfo",
    params,
  });
}

export async function getTopArtists(params: LastfmTopArtistsParams) {
  return callLastfm<{ topartists: JsonRecord }>({
    method: "user.getTopArtists",
    params,
  });
}

export type LastfmRecentTracksParams = {
  user: string;
  limit?: number;
  page?: number;
  from?: number;
  to?: number;
  extended?: 0 | 1;
};

export async function getRecentTracks(params: LastfmRecentTracksParams) {
  return callLastfm<{ recenttracks: JsonRecord }>({
    method: "user.getRecentTracks",
    params,
  });
}

export type LastfmTopTracksParams = {
  user: string;
  period?: "overall" | "7day" | "1month" | "3month" | "6month" | "12month";
  limit?: number;
  page?: number;
};

export async function getTopTracks(params: LastfmTopTracksParams) {
  return callLastfm<{ toptracks: JsonRecord }>({
    method: "user.getTopTracks",
    params,
  });
}

export type LastfmArtistInfoParams = {
  artist: string;
  user?: string;
  autocorrect?: 0 | 1;
  lang?: string;
};

export async function getArtistInfo(params: LastfmArtistInfoParams) {
  return callLastfm<{ artist: JsonRecord }>({
    method: "artist.getInfo",
    params,
  });
}

export type LastfmSimilarArtistsParams = {
  artist: string;
  limit?: number;
  autocorrect?: 0 | 1;
};

export async function getSimilarArtists(params: LastfmSimilarArtistsParams) {
  return callLastfm<{ similarartists: JsonRecord }>({
    method: "artist.getSimilar",
    params,
  });
}

export type LastfmTopAlbumsParams = {
  artist: string;
  limit?: number;
  autocorrect?: 0 | 1;
};

export async function getTopAlbums(params: LastfmTopAlbumsParams) {
  return callLastfm<{ topalbums: JsonRecord }>({
    method: "artist.getTopAlbums",
    params,
  });
}

export type LastfmLibraryArtistsParams = {
  user: string;
  limit?: number;
  page?: number;
};

export async function getLibraryArtists(params: LastfmLibraryArtistsParams) {
  return callLastfm<{ artists: JsonRecord }>({
    method: "library.getArtists",
    params,
  });
}

export type LastfmWeeklyArtistChartParams = {
  user: string;
  from?: number;
  to?: number;
};

export async function getWeeklyArtistChart(params: LastfmWeeklyArtistChartParams) {
  return callLastfm<{ weeklyartistchart: JsonRecord }>({
    method: "user.getWeeklyArtistChart",
    params,
  });
}

export async function getWeeklyChartList(params: { user: string }) {
  return callLastfm<{ weeklychartlist: JsonRecord }>({
    method: "user.getWeeklyChartList",
    params,
  });
}

export async function getAuthSession(token: string) {
  const baseParams = {
    api_key: getLastfmApiKey(),
    method: "auth.getSession",
    token,
  };

  const query = new URLSearchParams({
    ...baseParams,
    api_sig: signLastfmParams(baseParams),
    format: "json",
  });

  const response = await fetch(`${LASTFM_API_BASE}?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  const data = (await response.json()) as JsonRecord;
  if (!response.ok || typeof data.error === "number" || typeof data.error === "string") {
    throw new Error(`Last.fm auth.getSession failed: ${String(data.message ?? response.statusText)}`);
  }

  return data as {
    session?: {
      name?: string;
      key?: string;
      subscriber?: number | string;
    };
  };
}
