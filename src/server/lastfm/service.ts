import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import {
  getArtistInfo,
  getLibraryArtists,
  getRecentTracks,
  getSimilarArtists,
  getTopArtists,
  getTopTracks,
  getWeeklyArtistChart,
  getWeeklyChartList,
} from "@/lib/lastfm";
import { prisma } from "@/server/db";

type CacheOptions = {
  scope: string;
  method: string;
  params: Record<string, unknown>;
  ttlSeconds: number;
};

type WeeklyWindowArtist = {
  artistName: string;
  normalizedName: string;
  playcount: number;
};

type ParsedArtistInfo = {
  artistName: string;
  normalizedName: string;
  tags: string[];
  similarArtists: string[];
  listeners: number | null;
  userPlaycount: number | null;
  bio: string;
};

type ParsedSimilarArtist = {
  artistName: string;
  normalizedName: string;
  match: number;
};

function normalizeArtistName(value: string): string {
  return value.trim().toLowerCase();
}

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function makeCacheKey(options: CacheOptions): string {
  const payload = `${options.scope}::${options.method}::${JSON.stringify(options.params)}`;
  return createHash("sha256").update(payload).digest("hex");
}

async function readThroughCache<T>(options: CacheOptions, loader: () => Promise<T>): Promise<T> {
  const now = new Date();
  const cacheKey = makeCacheKey(options);

  const cached = await prisma.lastfmApiCache.findUnique({ where: { cacheKey } });
  if (cached && cached.expiresAt > now) {
    await prisma.lastfmApiCache.update({
      where: { cacheKey },
      data: {
        hitCount: { increment: 1 },
        lastAccessedAt: now,
      },
    });
    return cached.dataJson as T;
  }

  const data = await loader();
  const expiresAt = new Date(now.getTime() + options.ttlSeconds * 1000);

  await prisma.lastfmApiCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      scope: options.scope,
      method: options.method,
      paramsJson: options.params as Prisma.InputJsonValue,
      dataJson: data as Prisma.InputJsonValue,
      expiresAt,
      hitCount: 0,
      lastAccessedAt: now,
    },
    update: {
      dataJson: data as Prisma.InputJsonValue,
      expiresAt,
      lastAccessedAt: now,
    },
  });

  return data;
}

function parseWeeklyChartList(input: unknown): Array<{ from: number; to: number }> {
  const list =
    input && typeof input === "object"
      ? ((input as { weeklychartlist?: { chart?: unknown[] } }).weeklychartlist?.chart ?? [])
      : [];

  return (Array.isArray(list) ? list : [])
    .map((item) => {
      const from = toNumber((item as { from?: unknown }).from);
      const to = toNumber((item as { to?: unknown }).to);
      if (!from || !to) return null;
      return { from, to };
    })
    .filter((item): item is { from: number; to: number } => Boolean(item));
}

function parseWeeklyArtistChart(input: unknown): WeeklyWindowArtist[] {
  const artists =
    input && typeof input === "object"
      ? ((input as { weeklyartistchart?: { artist?: unknown[] } }).weeklyartistchart?.artist ?? [])
      : [];

  return (Array.isArray(artists) ? artists : [])
    .map((item) => {
      const artistName = readString((item as { name?: unknown }).name);
      const playcount = toNumber((item as { playcount?: unknown }).playcount) ?? 0;
      if (!artistName) return null;
      return {
        artistName,
        normalizedName: normalizeArtistName(artistName),
        playcount,
      };
    })
    .filter((item): item is WeeklyWindowArtist => Boolean(item));
}

function parseArtistInfoPayload(payload: unknown): ParsedArtistInfo {
  const artistNode = payload && typeof payload === "object" ? (payload as { artist?: Record<string, unknown> }).artist : undefined;

  const artistName = readString(artistNode?.name);
  const tagsNode = (artistNode?.tags as { tag?: unknown[] } | undefined)?.tag ?? [];
  const similarNode = (artistNode?.similar as { artist?: unknown[] } | undefined)?.artist ?? [];
  const listeners = toNumber((artistNode?.stats as { listeners?: unknown } | undefined)?.listeners);
  const userPlaycount = toNumber((artistNode?.stats as { userplaycount?: unknown } | undefined)?.userplaycount);
  const bio = readString((artistNode?.bio as { summary?: unknown } | undefined)?.summary);

  return {
    artistName,
    normalizedName: normalizeArtistName(artistName),
    tags: (Array.isArray(tagsNode) ? tagsNode : [])
      .map((tag) => readString((tag as { name?: unknown }).name).toLowerCase())
      .filter(Boolean)
      .slice(0, 16),
    similarArtists: (Array.isArray(similarNode) ? similarNode : [])
      .map((entry) => readString((entry as { name?: unknown }).name))
      .filter(Boolean)
      .slice(0, 14),
    listeners,
    userPlaycount,
    bio,
  };
}

function parseSimilarArtistsPayload(payload: unknown): ParsedSimilarArtist[] {
  const artists =
    payload && typeof payload === "object"
      ? ((payload as { similarartists?: { artist?: unknown[] } }).similarartists?.artist ?? [])
      : [];

  return (Array.isArray(artists) ? artists : [])
    .map((item) => {
      const artistName = readString((item as { name?: unknown }).name);
      const matchValue = toNumber((item as { match?: unknown }).match) ?? 0;
      if (!artistName) return null;
      const normalized = normalizeArtistName(artistName);
      return {
        artistName,
        normalizedName: normalized,
        match: matchValue <= 1 ? matchValue * 100 : matchValue,
      };
    })
    .filter((item): item is ParsedSimilarArtist => Boolean(item));
}

function parseLibraryArtists(payload: unknown): Array<{ artistName: string; normalizedName: string; playcount: number }> {
  const artists = payload && typeof payload === "object" ? ((payload as { artists?: { artist?: unknown[] } }).artists?.artist ?? []) : [];

  return (Array.isArray(artists) ? artists : [])
    .map((item) => {
      const artistName = readString((item as { name?: unknown }).name);
      const playcount = toNumber((item as { playcount?: unknown }).playcount) ?? 0;
      if (!artistName) return null;
      return {
        artistName,
        normalizedName: normalizeArtistName(artistName),
        playcount,
      };
    })
    .filter((item): item is { artistName: string; normalizedName: string; playcount: number } => Boolean(item));
}

export async function validateLastfmUser(username: string): Promise<void> {
  const cleaned = username.trim();
  if (!cleaned) {
    throw new Error("Last.fm username is required.");
  }

  await readThroughCache(
    {
      scope: cleaned.toLowerCase(),
      method: "user.validate",
      params: { username: cleaned },
      ttlSeconds: 300,
    },
    async () => {
      const recent = await getRecentTracks({ user: cleaned, limit: 1 });
      const topArtists = await getTopArtists({ user: cleaned, period: "overall", limit: 1 });
      return { recenttracks: recent.recenttracks, topartists: topArtists.topartists };
    },
  );
}

export async function getAggregatedWeeklyArtists(params: {
  username: string;
  from: number;
  to: number;
}): Promise<WeeklyWindowArtist[]> {
  const username = params.username.trim();
  const scope = username.toLowerCase();

  return readThroughCache(
    {
      scope,
      method: "user.weeklyArtistAggregate",
      params,
      ttlSeconds: 60 * 60,
    },
    async () => {
      const chartListRaw = await readThroughCache(
        {
          scope,
          method: "user.getWeeklyChartList",
          params: { user: username },
          ttlSeconds: 60 * 60 * 6,
        },
        () => getWeeklyChartList({ user: username }),
      );

      const weeks = parseWeeklyChartList(chartListRaw).filter((week) => week.to >= params.from && week.from <= params.to);

      const aggregate = new Map<string, WeeklyWindowArtist>();
      for (const week of weeks) {
        const weekRaw = await readThroughCache(
          {
            scope,
            method: "user.getWeeklyArtistChart",
            params: { user: username, from: week.from, to: week.to },
            ttlSeconds: 60 * 60 * 12,
          },
          () => getWeeklyArtistChart({ user: username, from: week.from, to: week.to }),
        );

        for (const row of parseWeeklyArtistChart(weekRaw)) {
          const existing = aggregate.get(row.normalizedName);
          if (existing) {
            existing.playcount += row.playcount;
          } else {
            aggregate.set(row.normalizedName, { ...row });
          }
        }
      }

      return [...aggregate.values()].sort((a, b) => b.playcount - a.playcount);
    },
  );
}

export async function getArtistProfile(params: {
  artistName: string;
  username: string;
}): Promise<ParsedArtistInfo> {
  const artistName = params.artistName.trim();
  const scope = params.username.trim().toLowerCase();

  const raw = await readThroughCache(
    {
      scope,
      method: "artist.getInfo",
      params: { artist: artistName, user: params.username },
      ttlSeconds: 60 * 60 * 24 * 14,
    },
    () => getArtistInfo({ artist: artistName, user: params.username, autocorrect: 1 }),
  );

  return parseArtistInfoPayload(raw);
}

export async function getSimilarArtistProfiles(params: {
  artistName: string;
  username: string;
  limit: number;
}): Promise<ParsedSimilarArtist[]> {
  const scope = params.username.trim().toLowerCase();
  const raw = await readThroughCache(
    {
      scope,
      method: "artist.getSimilar",
      params: { artist: params.artistName, limit: params.limit },
      ttlSeconds: 60 * 60 * 24 * 7,
    },
    () => getSimilarArtists({ artist: params.artistName, limit: params.limit, autocorrect: 1 }),
  );

  return parseSimilarArtistsPayload(raw);
}

export async function getKnownArtists(params: { username: string }): Promise<Array<{ artistName: string; normalizedName: string; playcount: number }>> {
  const username = params.username.trim();
  const scope = username.toLowerCase();

  const library = await readThroughCache(
    {
      scope,
      method: "user.knownArtists",
      params: { user: username },
      ttlSeconds: 60 * 60 * 6,
    },
    async () => {
      const pagesToRead = 4;
      const byArtist = new Map<string, { artistName: string; normalizedName: string; playcount: number }>();

      for (let page = 1; page <= pagesToRead; page += 1) {
        const response = await getLibraryArtists({ user: username, limit: 500, page });
        const parsed = parseLibraryArtists(response);
        if (parsed.length === 0) {
          break;
        }

        for (const row of parsed) {
          const existing = byArtist.get(row.normalizedName);
          if (existing) {
            existing.playcount = Math.max(existing.playcount, row.playcount);
          } else {
            byArtist.set(row.normalizedName, row);
          }
        }

        if (parsed.length < 500) {
          break;
        }
      }

      if (byArtist.size === 0) {
        const fallback = await getTopArtists({ user: username, period: "overall", limit: 300 });
        const rows =
          ((fallback.topartists as { artist?: unknown[] }).artist ?? [])
            .map((item) => {
              const artistName = readString((item as { name?: unknown }).name);
              const playcount = toNumber((item as { playcount?: unknown }).playcount) ?? 0;
              if (!artistName) return null;
              return { artistName, normalizedName: normalizeArtistName(artistName), playcount };
            })
            .filter((item): item is { artistName: string; normalizedName: string; playcount: number } => Boolean(item));

        for (const row of rows) {
          byArtist.set(row.normalizedName, row);
        }
      }

      return [...byArtist.values()].sort((a, b) => b.playcount - a.playcount);
    },
  );

  return library;
}

export async function getTopTrackSummary(username: string): Promise<Array<{ artist: string; track: string; playcount: number }>> {
  const scope = username.trim().toLowerCase();

  return readThroughCache(
    {
      scope,
      method: "user.getTopTracks",
      params: { user: username, period: "6month" },
      ttlSeconds: 60 * 60,
    },
    async () => {
      const response = await getTopTracks({ user: username, period: "6month", limit: 60 });
      const rows = ((response.toptracks as { track?: unknown[] }).track ?? []) as unknown[];

      return rows
        .map((item) => {
          const artist = readString((item as { artist?: { name?: unknown } }).artist?.name);
          const track = readString((item as { name?: unknown }).name);
          const playcount = toNumber((item as { playcount?: unknown }).playcount) ?? 0;
          if (!artist || !track) return null;
          return { artist, track, playcount };
        })
        .filter((item): item is { artist: string; track: string; playcount: number } => Boolean(item));
    },
  );
}
