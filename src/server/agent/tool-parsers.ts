import {
  parseArtistInfo,
  parseAuthStatus,
  parseSimilarArtists,
  parseWeeklyArtistChart,
  parseWeeklyTrackChart,
} from "@/server/lastfm/parsers";

export function parseMcpToolResult(params: {
  mcpToolName: string;
  text: string;
  args: Record<string, unknown>;
}) {
  const { mcpToolName, text, args } = params;

  try {
    switch (mcpToolName) {
      case "lastfm_auth_status": {
        return {
          kind: "auth_status",
          ...parseAuthStatus(text),
        };
      }
      case "get_weekly_artist_chart": {
        const rows = parseWeeklyArtistChart(text);
        return {
          kind: "weekly_artist_chart",
          from: args.from ?? null,
          to: args.to ?? null,
          count: rows.length,
          top: rows.slice(0, 12),
        };
      }
      case "get_weekly_track_chart": {
        const rows = parseWeeklyTrackChart(text);
        return {
          kind: "weekly_track_chart",
          from: args.from ?? null,
          to: args.to ?? null,
          count: rows.length,
          top: rows.slice(0, 12),
        };
      }
      case "get_similar_artists": {
        const rows = parseSimilarArtists(text);
        return {
          kind: "similar_artists",
          sourceArtist: typeof args.artist === "string" ? args.artist : null,
          count: rows.length,
          top: rows.slice(0, 15),
        };
      }
      case "get_artist_info": {
        const artist = parseArtistInfo(text);
        return {
          kind: "artist_info",
          artist: artist.artist,
          tags: artist.tags.slice(0, 12),
          similar: artist.similar.slice(0, 10),
          yourPlays: artist.yourPlays,
          bioSnippet: artist.bio.slice(0, 400),
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
