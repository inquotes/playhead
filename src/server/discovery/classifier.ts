import type { ArtistWithTags, Lane } from "@/server/discovery/types";

const LANE_DEFINITIONS = [
  {
    id: "post-punk-indie",
    name: "Post-Punk / Indie Rock",
    description: "Angular guitars, punchy rhythms, and art-punk edge.",
    keywords: [
      "post-punk",
      "indie rock",
      "art punk",
      "crank wave",
      "punk rock",
      "garage punk",
      "new wave",
      "noise rock",
    ],
  },
  {
    id: "dance-pop-electronic",
    name: "Dance Pop / Electronic",
    description: "Club-ready hooks, synth-forward production, and high-energy pop.",
    keywords: [
      "electronic",
      "dance",
      "electropop",
      "synthpop",
      "techno",
      "big beat",
      "hyperpop",
      "pop",
      "house",
    ],
  },
  {
    id: "dream-ambient",
    name: "Dreamy / Ambient Textures",
    description: "Atmospheric soundscapes, ethereal voices, and reflective moods.",
    keywords: [
      "dream pop",
      "shoegaze",
      "ambient",
      "downtempo",
      "ethereal",
      "bedroom pop",
      "alternative rnb",
      "rnb",
    ],
  },
  {
    id: "experimental-leftfield",
    name: "Experimental / Leftfield",
    description: "Boundary-pushing textures, odd structures, and adventurous production.",
    keywords: ["experimental", "avant-garde", "glitch", "industrial", "idm", "art rock"],
  },
];

function scoreArtistAgainstLane(tags: string[], keywords: string[]): number {
  let score = 0;
  for (const tag of tags) {
    for (const keyword of keywords) {
      if (tag.includes(keyword)) {
        score += 1;
      }
    }
  }
  return score;
}

export function classifyLanes(artists: ArtistWithTags[]): Lane[] {
  const laneBuckets = new Map<
    string,
    {
      lane: (typeof LANE_DEFINITIONS)[number];
      artists: Array<{ artist: string; plays: number; tags: string[] }>;
      tagCounts: Map<string, number>;
      totalPlays: number;
    }
  >();

  for (const def of LANE_DEFINITIONS) {
    laneBuckets.set(def.id, {
      lane: def,
      artists: [],
      tagCounts: new Map(),
      totalPlays: 0,
    });
  }

  for (const entry of artists) {
    let bestLaneId = "dance-pop-electronic";
    let bestScore = -1;

    for (const lane of LANE_DEFINITIONS) {
      const laneScore = scoreArtistAgainstLane(entry.tags, lane.keywords);
      if (laneScore > bestScore) {
        bestScore = laneScore;
        bestLaneId = lane.id;
      }
    }

    const bucket = laneBuckets.get(bestLaneId);
    if (!bucket) continue;

    bucket.artists.push({ artist: entry.artist, plays: entry.plays, tags: entry.tags });
    bucket.totalPlays += entry.plays;
    for (const tag of entry.tags) {
      bucket.tagCounts.set(tag, (bucket.tagCounts.get(tag) ?? 0) + entry.plays);
    }
  }

  const lanes: Lane[] = [];

  for (const { lane, artists: laneArtists, tagCounts, totalPlays } of laneBuckets.values()) {
    if (laneArtists.length === 0) continue;

    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag);

    const topArtists = laneArtists
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 8)
      .map((item) => item.artist);

    lanes.push({
      id: lane.id,
      name: lane.name,
      description: lane.description,
      whyThisLane: `Clustered by repeated tags and artist overlap around ${lane.name.toLowerCase()}.`,
      confidence: 0.55,
      artists: topArtists,
      tags: topTags,
      totalPlays,
    });
  }

  return lanes.sort((a, b) => b.totalPlays - a.totalPlays).slice(0, 4);
}
