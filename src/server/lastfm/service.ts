import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import {
  getArtistInfo,
  getLibraryArtists,
  getRecentTracks,
  getSimilarArtists,
  getTopAlbums,
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

type ParsedTopAlbum = {
  albumName: string;
  playcount: number;
};

type LastfmPeriodPreset = "7d" | "1m" | "6m" | "1y";

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

function parseTopAlbumsPayload(payload: unknown): ParsedTopAlbum[] {
  const albums =
    payload && typeof payload === "object"
      ? ((payload as { topalbums?: { album?: unknown[] } }).topalbums?.album ?? [])
      : [];

  return (Array.isArray(albums) ? albums : [])
    .map((item) => {
      const albumName = readString((item as { name?: unknown }).name);
      const playcount = toNumber((item as { playcount?: unknown }).playcount) ?? 0;
      if (!albumName) return null;
      return { albumName, playcount };
    })
    .filter((item): item is ParsedTopAlbum => Boolean(item));
}

function parseTopArtistsPayload(payload: unknown): Array<{ artistName: string; normalizedName: string; playcount: number }> {
  const artists =
    payload && typeof payload === "object" ? ((payload as { topartists?: { artist?: unknown[] } }).topartists?.artist ?? []) : [];

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

function toLastfmPeriod(preset: LastfmPeriodPreset): "7day" | "1month" | "6month" | "12month" {
  switch (preset) {
    case "7d":
      return "7day";
    case "1m":
      return "1month";
    case "6m":
      return "6month";
    case "1y":
      return "12month";
  }
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

export async function getLatestWeeklyChartBoundary(params: {
  username: string;
}): Promise<number | null> {
  const username = params.username.trim();
  const scope = username.toLowerCase();

  const chartListRaw = await readThroughCache(
    {
      scope,
      method: "user.getWeeklyChartList",
      params: { user: username },
      ttlSeconds: 60 * 30,
    },
    () => getWeeklyChartList({ user: username }),
  );

  const weeks = parseWeeklyChartList(chartListRaw);
  return weeks[0]?.to ?? null;
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
      const maxPagesToRead = 24;
      const byArtist = new Map<string, { artistName: string; normalizedName: string; playcount: number }>();

      let page = 1;
      let totalPages = 1;
      while (page <= totalPages && page <= maxPagesToRead) {
        const response = await getLibraryArtists({ user: username, limit: 500, page });
        const parsed = parseLibraryArtists(response);
        const attr = (response.artists as { "@attr"?: { totalPages?: unknown } } | undefined)?.["@attr"];
        const parsedTotalPages = toNumber(attr?.totalPages);
        if (parsedTotalPages && parsedTotalPages > 0) {
          totalPages = Math.floor(parsedTotalPages);
        }

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

        page += 1;
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

export async function getKnownArtistsLite(params: {
  username: string;
  limit?: number;
}): Promise<Array<{ artistName: string; normalizedName: string; playcount: number }>> {
  const username = params.username.trim();
  const scope = username.toLowerCase();
  const limit = Math.max(50, Math.min(500, params.limit ?? 300));

  return readThroughCache(
    {
      scope,
      method: "user.knownArtistsLite",
      params: { user: username, limit },
      ttlSeconds: 60 * 60,
    },
    async () => {
      const response = await getTopArtists({ user: username, period: "overall", limit });
      return parseTopArtistsPayload(response);
    },
  );
}

export async function getTopArtistsForPreset(params: {
  username: string;
  preset: LastfmPeriodPreset;
  limit?: number;
}): Promise<WeeklyWindowArtist[]> {
  const username = params.username.trim();
  const scope = username.toLowerCase();
  const limit = Math.max(30, Math.min(500, params.limit ?? 120));
  const period = toLastfmPeriod(params.preset);

  return readThroughCache(
    {
      scope,
      method: "user.topArtistsPreset",
      params: { user: username, preset: params.preset, period, limit },
      ttlSeconds: 60 * 30,
    },
    async () => {
      const response = await getTopArtists({ user: username, period, limit });
      return parseTopArtistsPayload(response);
    },
  );
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

export async function getRecentArtistCounts(params: {
  username: string;
  from: number;
  to: number;
}): Promise<Array<{ artistName: string; normalizedName: string; playcount: number }>> {
  const username = params.username.trim();
  const scope = username.toLowerCase();
  const from = Math.floor(params.from);
  const to = Math.floor(params.to);

  if (!username || from >= to) {
    return [];
  }

  return readThroughCache(
    {
      scope,
      method: "user.recentArtistAggregate",
      params: { user: username, from, to },
      ttlSeconds: 60 * 10,
    },
    async () => {
      const byArtist = new Map<string, { artistName: string; normalizedName: string; playcount: number }>();
      const maxPagesToRead = 100;
      let page = 1;
      let totalPages = 1;

      while (page <= totalPages && page <= maxPagesToRead) {
        const response = await getRecentTracks({
          user: username,
          from,
          to,
          limit: 200,
          page,
          extended: 0,
        });
        const recenttracksNode = response.recenttracks as
          | {
              track?: unknown[];
              "@attr"?: { totalPages?: unknown };
            }
          | undefined;

        const tracks = Array.isArray(recenttracksNode?.track) ? recenttracksNode.track : [];
        const parsedTotalPages = toNumber(recenttracksNode?.["@attr"]?.totalPages);
        if (parsedTotalPages && parsedTotalPages > 0) {
          totalPages = Math.floor(parsedTotalPages);
        }

        if (tracks.length === 0) {
          break;
        }

        for (const track of tracks) {
          const artistNode = (track as { artist?: unknown }).artist;
          const artistName =
            typeof artistNode === "string"
              ? readString(artistNode)
              : readString((artistNode as { "#text"?: unknown } | undefined)?.["#text"]);
          if (!artistName) continue;

          const normalizedName = normalizeArtistName(artistName);
          const existing = byArtist.get(normalizedName);
          if (existing) {
            existing.playcount += 1;
          } else {
            byArtist.set(normalizedName, {
              artistName,
              normalizedName,
              playcount: 1,
            });
          }
        }

        page += 1;
      }

      return [...byArtist.values()].sort((a, b) => b.playcount - a.playcount);
    },
  );
}

export async function getArtistTopAlbumSuggestion(params: {
  artistName: string;
}): Promise<string | null> {
  const artistName = params.artistName.trim();
  if (!artistName) return null;

  const scope = `artist:${normalizeArtistName(artistName)}`;
  const albums = await readThroughCache(
    {
      scope,
      method: "artist.getTopAlbums",
      params: { artist: artistName },
      ttlSeconds: 60 * 60 * 24 * 14,
    },
    async () => {
      const raw = await getTopAlbums({ artist: artistName, limit: 8, autocorrect: 1 });
      return parseTopAlbumsPayload(raw);
    },
  );

  const top = albums[0];
  return top?.albumName ?? null;
}
