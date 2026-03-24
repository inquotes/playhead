import type {
  ViewState,
  ConnectionStatus,
  RangeOptionId,
  Lane,
  Recommendation,
  HistoryRecommendationRun,
  SavedArtistRecord,
  AgentLiveEvent,
} from "./types";

export type DiscoveryState = {
  view: ViewState;
  status: ConnectionStatus | null;

  selectedRange: RangeOptionId;
  customRange: {
    phase: "start" | "end";
    startYear: number | null;
    startMonth: number | null;
    endYear: number | null;
    endMonth: number | null;
  };

  target: {
    mode: boolean;
    usernameInput: string;
    usernameResolved: string | null;
    validationState: "idle" | "validating" | "valid" | "error";
    validationMessage: string | null;
  };

  analysis: {
    runId: string | null;
    rangeLabel: string | null;
    targetUsername: string | null;
    summary: string | null;
    lanes: Lane[];
    selectedLaneId: string | null;
  };

  recommendation: {
    items: Recommendation[];
    runs: HistoryRecommendationRun[];
    showingCached: boolean;
    knownHistoryMessage: string | null;
  };

  savedArtists: SavedArtistRecord[];
  savingArtistName: string | null;
  saveError: string | null;

  busy: boolean;
  error: string | null;
  activeRunId: string | null;
  liveEvents: AgentLiveEvent[];
};

export const initialState: DiscoveryState = {
  view: "landing",
  status: null,

  selectedRange: "6m",
  customRange: {
    phase: "start",
    startYear: null,
    startMonth: null,
    endYear: null,
    endMonth: null,
  },

  target: {
    mode: false,
    usernameInput: "",
    usernameResolved: null,
    validationState: "idle",
    validationMessage: null,
  },

  analysis: {
    runId: null,
    rangeLabel: null,
    targetUsername: null,
    summary: null,
    lanes: [],
    selectedLaneId: null,
  },

  recommendation: {
    items: [],
    runs: [],
    showingCached: false,
    knownHistoryMessage: null,
  },

  savedArtists: [],
  savingArtistName: null,
  saveError: null,

  busy: false,
  error: null,
  activeRunId: null,
  liveEvents: [],
};

export type DiscoveryAction =
  | { type: "SET_STATUS"; status: ConnectionStatus }
  | { type: "SET_SAVED_ARTISTS"; savedArtists: SavedArtistRecord[] }
  | { type: "SET_VIEW"; view: ViewState }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "SET_BUSY"; busy: boolean }
  | { type: "SET_SELECTED_RANGE"; range: RangeOptionId }
  | { type: "SET_CUSTOM_PHASE"; phase: "start" | "end" }
  | { type: "SET_CUSTOM_START_YEAR"; year: number | null }
  | { type: "SET_CUSTOM_START_MONTH"; month: number | null }
  | { type: "SET_CUSTOM_END_YEAR"; year: number | null }
  | { type: "SET_CUSTOM_END_MONTH"; month: number | null }
  | { type: "ADVANCE_CUSTOM_TO_END" }
  | { type: "SET_TARGET_MODE"; mode: boolean }
  | { type: "SET_TARGET_INPUT"; value: string }
  | { type: "SET_TARGET_VALIDATION"; validationState: "idle" | "validating" | "valid" | "error"; message: string | null; resolved: string | null }
  | { type: "RESET_TARGET_USER" }
  | { type: "ANALYSIS_START"; targetUsername: string | null }
  | { type: "ANALYSIS_VALIDATION_FAIL"; error: string }
  | { type: "ANALYSIS_COMPLETE"; runId: string | null; targetUsername: string | null; rangeLabel: string | null; lanes: Lane[]; summary: string | null }
  | { type: "ANALYSIS_FAIL"; error: string }
  | { type: "SET_ACTIVE_RUN"; runId: string | null }
  | { type: "APPEND_LIVE_EVENTS"; events: AgentLiveEvent[] }
  | { type: "RECOMMEND_START" }
  | { type: "RECOMMEND_COMPLETE"; items: Recommendation[]; knownHistoryMessage: string | null; runId: string | null; laneId: string }
  | { type: "RECOMMEND_FAIL"; error: string }
  | { type: "OPEN_LANE"; laneId: string; cachedRun: HistoryRecommendationRun | undefined }
  | { type: "HYDRATE_COMPLETE"; runId: string; targetUsername: string | null; rangeLabel: string; lanes: Lane[]; summary: string | null; runs: HistoryRecommendationRun[]; hydratedRec: HistoryRecommendationRun | null }
  | { type: "ADD_SAVED_ARTIST"; artist: SavedArtistRecord }
  | { type: "SET_SAVING_ARTIST"; name: string | null }
  | { type: "SET_SAVE_ERROR"; error: string | null }
  | { type: "GO_TO_CLUSTERS" };

export function discoveryReducer(state: DiscoveryState, action: DiscoveryAction): DiscoveryState {
  switch (action.type) {
    case "SET_STATUS":
      return { ...state, status: action.status };

    case "SET_SAVED_ARTISTS":
      return { ...state, savedArtists: action.savedArtists };

    case "SET_VIEW":
      return { ...state, view: action.view };

    case "SET_ERROR":
      return { ...state, error: action.error };

    case "SET_BUSY":
      return { ...state, busy: action.busy };

    case "SET_SELECTED_RANGE":
      return { ...state, selectedRange: action.range };

    case "SET_CUSTOM_PHASE":
      return { ...state, customRange: { ...state.customRange, phase: action.phase } };

    case "SET_CUSTOM_START_YEAR":
      return { ...state, customRange: { ...state.customRange, startYear: action.year } };

    case "SET_CUSTOM_START_MONTH":
      return { ...state, customRange: { ...state.customRange, startMonth: action.month } };

    case "SET_CUSTOM_END_YEAR":
      return { ...state, customRange: { ...state.customRange, endYear: action.year } };

    case "SET_CUSTOM_END_MONTH":
      return { ...state, customRange: { ...state.customRange, endMonth: action.month } };

    case "ADVANCE_CUSTOM_TO_END":
      return {
        ...state,
        customRange: {
          ...state.customRange,
          endYear: state.customRange.startYear,
          endMonth: state.customRange.startMonth,
          phase: "end",
        },
      };

    case "SET_TARGET_MODE":
      return { ...state, target: { ...state.target, mode: action.mode } };

    case "SET_TARGET_INPUT":
      return {
        ...state,
        target: {
          ...state.target,
          usernameInput: action.value,
          validationState: "idle",
          validationMessage: null,
          usernameResolved: null,
        },
      };

    case "SET_TARGET_VALIDATION":
      return {
        ...state,
        target: {
          ...state.target,
          validationState: action.validationState,
          validationMessage: action.message,
          usernameResolved: action.resolved,
        },
      };

    case "RESET_TARGET_USER":
      return {
        ...state,
        target: {
          mode: false,
          usernameInput: "",
          usernameResolved: null,
          validationState: "idle",
          validationMessage: null,
        },
      };

    case "ANALYSIS_START":
      return {
        ...state,
        view: "analyzing",
        busy: true,
        error: null,
        recommendation: { items: [], runs: [], showingCached: false, knownHistoryMessage: null },
        liveEvents: [],
        analysis: { ...state.analysis, targetUsername: action.targetUsername },
      };

    case "ANALYSIS_VALIDATION_FAIL":
      return { ...state, error: action.error, view: "time-select", busy: false };

    case "ANALYSIS_COMPLETE":
      return {
        ...state,
        analysis: {
          runId: action.runId,
          targetUsername: action.targetUsername,
          rangeLabel: action.rangeLabel,
          summary: action.summary,
          lanes: action.lanes,
          selectedLaneId: action.lanes[0]?.id ?? null,
        },
      };

    case "ANALYSIS_FAIL":
      return {
        ...state,
        analysis: { ...state.analysis, targetUsername: null },
        error: action.error,
        view: "time-select",
        activeRunId: null,
        busy: false,
      };

    case "SET_ACTIVE_RUN":
      return { ...state, activeRunId: action.runId };

    case "APPEND_LIVE_EVENTS": {
      const seen = new Set(state.liveEvents.map((e) => e.seq));
      const additions = action.events.filter((e) => !seen.has(e.seq));
      if (additions.length === 0) return state;
      return { ...state, liveEvents: [...state.liveEvents, ...additions].slice(-40) };
    }

    case "RECOMMEND_START":
      return {
        ...state,
        busy: true,
        error: null,
        recommendation: { ...state.recommendation, showingCached: false },
        liveEvents: [],
      };

    case "RECOMMEND_COMPLETE": {
      const runs = state.recommendation.runs;
      const updatedRuns =
        typeof action.runId === "string" && action.runId.length > 0
          ? [
              {
                id: action.runId,
                selectedLane: action.laneId,
                createdAt: new Date().toISOString(),
                strategyNote: null,
                recommendations: action.items,
              },
              ...runs.filter((r) => r.selectedLane !== action.laneId),
            ]
          : runs;
      return {
        ...state,
        recommendation: {
          items: action.items,
          runs: updatedRuns,
          showingCached: false,
          knownHistoryMessage: action.knownHistoryMessage,
        },
        activeRunId: null,
        busy: false,
      };
    }

    case "RECOMMEND_FAIL":
      return { ...state, error: action.error, activeRunId: null, busy: false };

    case "OPEN_LANE":
      return {
        ...state,
        analysis: { ...state.analysis, selectedLaneId: action.laneId },
        recommendation: {
          ...state.recommendation,
          items: action.cachedRun?.recommendations ?? [],
          knownHistoryMessage: null,
          showingCached: Boolean(action.cachedRun),
        },
        view: "cluster-detail",
      };

    case "HYDRATE_COMPLETE": {
      const hydratedRec = action.hydratedRec;
      return {
        ...state,
        analysis: {
          runId: action.runId,
          targetUsername: action.targetUsername,
          rangeLabel: action.rangeLabel,
          summary: action.summary,
          lanes: action.lanes,
          selectedLaneId: hydratedRec ? hydratedRec.selectedLane : (action.lanes[0]?.id ?? null),
        },
        recommendation: {
          items: hydratedRec?.recommendations ?? [],
          runs: action.runs,
          showingCached: Boolean(hydratedRec),
          knownHistoryMessage: null,
        },
        view: hydratedRec ? "cluster-detail" : "clusters",
        busy: false,
      };
    }

    case "ADD_SAVED_ARTIST": {
      const exists = state.savedArtists.some(
        (item) => item.id === action.artist.id || item.normalizedName === action.artist.normalizedName,
      );
      if (exists) return { ...state, savingArtistName: null };
      return { ...state, savedArtists: [action.artist, ...state.savedArtists], savingArtistName: null };
    }

    case "SET_SAVING_ARTIST":
      return { ...state, savingArtistName: action.name, saveError: null };

    case "SET_SAVE_ERROR":
      return { ...state, saveError: action.error, savingArtistName: null };

    case "GO_TO_CLUSTERS":
      return { ...state, view: "clusters" };

    default:
      return state;
  }
}
