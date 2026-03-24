"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { AuthenticatedNav } from "@/components/authenticated-nav";
import {
  type ConnectionStatus,
  type HistoryAnalysisResponse,
  type Recommendation,
  type RangeOptionId,
  type SavedArtistRecord,
  type UsernameValidationResponse,
  jsonFetch,
  uniqueArtists,
  normalizeArtistName,
} from "./types";
import { discoveryReducer, initialState } from "./reducer";
import { useDiscoveryRun } from "./use-discovery-run";
import { LandingView } from "./landing-view";
import { TimeSelectView } from "./time-select-view";
import { AnalyzingView } from "./analyzing-view";
import { ClustersView } from "./clusters-view";
import { ClusterDetailView } from "./cluster-detail-view";

export function DiscoveryApp() {
  const [state, dispatch] = useReducer(discoveryReducer, initialState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const onEvents = useCallback(
    (events: import("./types").AgentLiveEvent[]) => {
      dispatch({ type: "APPEND_LIVE_EVENTS", events });
    },
    [],
  );
  const { startPolling } = useDiscoveryRun({ onEvents });

  const username = state.status?.user?.displayName ?? state.status?.user?.lastfmUsername ?? "listener";
  const selfUsername = state.status?.user?.lastfmUsername ?? null;
  const displayAnalysisUsername = state.analysis.targetUsername ?? username;

  const selectedLane = useMemo(
    () => state.analysis.lanes.find((lane) => lane.id === state.analysis.selectedLaneId) ?? null,
    [state.analysis.lanes, state.analysis.selectedLaneId],
  );

  const sidebarCoreArtists = useMemo(() => {
    if (!selectedLane) return [];
    return uniqueArtists(selectedLane.artists);
  }, [selectedLane]);

  const sidebarMoreArtists = useMemo(() => {
    if (!selectedLane) return [];
    const coreSet = new Set(sidebarCoreArtists.map((a) => a.toLowerCase()));
    return uniqueArtists(selectedLane.memberArtists ?? []).filter((a) => !coreSet.has(a.toLowerCase()));
  }, [selectedLane, sidebarCoreArtists]);

  const selectedLaneHasSeedData = useMemo(() => {
    if (!selectedLane) return false;
    return (
      uniqueArtists(selectedLane.artists).length > 0 ||
      uniqueArtists(selectedLane.memberArtists ?? []).length > 0 ||
      (selectedLane.similarHints?.length ?? 0) > 0
    );
  }, [selectedLane]);

  const recRuns = state.recommendation.runs;
  const recommendationByLane = useMemo(() => {
    const latestByLane = new Map<string, (typeof recRuns)[number]>();
    for (const run of recRuns) {
      const existing = latestByLane.get(run.selectedLane);
      if (!existing || new Date(run.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
        latestByLane.set(run.selectedLane, run);
      }
    }
    return latestByLane;
  }, [recRuns]);

  const savedArtistNameSet = useMemo(() => {
    return new Set(state.savedArtists.map((item) => item.normalizedName));
  }, [state.savedArtists]);

  const currentYear = new Date().getUTCFullYear();
  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let year = currentYear; year >= 2000; year -= 1) {
      years.push(year);
    }
    return years;
  }, [currentYear]);

  const customRangeIsValid = useMemo(() => {
    const { startYear, startMonth, endYear, endMonth } = state.customRange;
    if (!startYear || !startMonth || !endYear || !endMonth) return false;
    return startYear * 100 + startMonth <= endYear * 100 + endMonth;
  }, [state.customRange]);

  const analyzeSteps = useMemo(() => {
    const events = new Set(state.liveEvents.map((e) => e.type));
    return [
      {
        id: "snapshot",
        label: "Collecting listening history",
        state: events.has("snapshot_completed") ? "done" : events.has("snapshot_started") ? "active" : "pending",
      },
      {
        id: "lanes",
        label: "Building taste lanes",
        state: events.has("lane_synthesis_completed") ? "done" : events.has("lane_synthesis_started") ? "active" : "pending",
      },
      {
        id: "finalize",
        label: "Finalizing analysis",
        state: events.has("run_completed") ? "done" : events.size > 0 ? "active" : "pending",
      },
    ] as const;
  }, [state.liveEvents]);

  const recommendSteps = useMemo(() => {
    const events = new Set(state.liveEvents.map((e) => e.type));
    return [
      {
        id: "context",
        label: "Loading lane context",
        state: events.has("recommendation_context_loaded") ? "done" : "pending",
      },
      {
        id: "known-history",
        label: "Scanning known listening history",
        state:
          events.has("recommendation_known_history_completed")
            ? "done"
            : events.has("recommendation_known_history_started")
              ? "active"
              : "pending",
      },
      {
        id: "expand",
        label: "Finding and ranking recommendations",
        state:
          events.has("recommendation_expansion_completed")
            ? "done"
            : events.has("recommendation_expansion_started")
              ? "active"
              : "pending",
      },
      {
        id: "finalize",
        label: "Finalizing recommendations",
        state: events.has("run_completed") ? "done" : events.size > 0 ? "active" : "pending",
      },
    ] as const;
  }, [state.liveEvents]);

  const progress = useMemo(() => {
    const steps = state.view === "analyzing" ? analyzeSteps : recommendSteps;
    const doneCount = steps.filter((s) => s.state === "done").length;
    return Math.round((doneCount / steps.length) * 100);
  }, [analyzeSteps, recommendSteps, state.view]);

  // --- Init effect ---
  useEffect(() => {
    async function hydrateFromHistory(analysisRunIdParam: string, recRunId: string | null) {
      dispatch({ type: "SET_BUSY", busy: true });
      dispatch({ type: "SET_ERROR", error: null });
      try {
        const data = await jsonFetch<HistoryAnalysisResponse>(`/api/history/analysis/${analysisRunIdParam}`);
        const runs = data.recommendationRuns ?? [];
        const hydratedRec = recRunId ? (runs.find((r) => r.id === recRunId) ?? null) : null;
        dispatch({
          type: "HYDRATE_COMPLETE",
          runId: data.analysisRunId,
          targetUsername: data.targetUsername,
          rangeLabel: data.range.label,
          lanes: data.lanes ?? [],
          summary: data.summary ?? null,
          runs,
          hydratedRec,
        });
      } catch (err) {
        dispatch({ type: "SET_ERROR", error: err instanceof Error ? err.message : "Could not load saved analysis." });
        dispatch({ type: "SET_BUSY", busy: false });
      }
    }

    void (async () => {
      try {
        const search = new URLSearchParams(window.location.search);
        const authConnected = search.get("auth") === "connected";

        await jsonFetch<{ ok: true }>("/api/session", { cache: "no-store" });

        const fetchAuthStatus = async () => {
          return jsonFetch<ConnectionStatus & { ok: true }>(`/api/auth/me?ts=${Date.now()}`, { cache: "no-store" });
        };

        let nextStatus = await fetchAuthStatus();
        if (authConnected && !nextStatus.isAuthenticated) {
          for (let attempt = 0; attempt < 8; attempt += 1) {
            await new Promise<void>((resolve) => {
              setTimeout(resolve, 750);
            });
            nextStatus = await fetchAuthStatus();
            if (nextStatus.isAuthenticated) break;
          }
        }

        dispatch({ type: "SET_STATUS", status: nextStatus });

        if (nextStatus.isAuthenticated) {
          const saved = await jsonFetch<{ ok: true; savedArtists: SavedArtistRecord[] }>("/api/saved-artists");
          dispatch({ type: "SET_SAVED_ARTISTS", savedArtists: saved.savedArtists ?? [] });
        }

        const analysisRunId = search.get("analysisRunId");
        const recommendationRunId = search.get("recommendationRunId");
        if (nextStatus.isAuthenticated && analysisRunId) {
          await hydrateFromHistory(analysisRunId, recommendationRunId);
        }

        if (authConnected) {
          search.delete("auth");
          const nextQuery = search.toString();
          const nextUrl = nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname;
          window.history.replaceState({}, "", nextUrl);
        }

        const authError = search.get("error");
        if (authError) {
          if (authError === "auth_failed") {
            dispatch({ type: "SET_ERROR", error: "Could not complete Last.fm authentication. Please try again." });
          } else if (authError === "invalid_state") {
            dispatch({ type: "SET_ERROR", error: "Authentication session expired. Please connect again." });
          } else if (authError === "server_config") {
            dispatch({ type: "SET_ERROR", error: "Server configuration issue. Please check env settings." });
          } else {
            dispatch({ type: "SET_ERROR", error: authError.replace(/_/g, " ") });
          }
        }
      } catch (err) {
        dispatch({ type: "SET_ERROR", error: err instanceof Error ? err.message : "Unable to initialize." });
      }
    })();
  }, []);

  function startConnect() {
    dispatch({ type: "SET_BUSY", busy: true });
    dispatch({ type: "SET_ERROR", error: null });
    window.location.href = "/api/auth/lastfm/start?next=/";
  }

  function goToRecommendations() {
    dispatch({ type: "SET_ERROR", error: null });
    dispatch({ type: "SET_VIEW", view: "time-select" });
  }

  async function validateTargetUsername() {
    const s = stateRef.current;
    const trimmed = s.target.usernameInput.trim();
    if (!trimmed) {
      dispatch({ type: "SET_TARGET_VALIDATION", validationState: "error", message: "Enter a Last.fm username first.", resolved: null });
      return;
    }

    const self = s.status?.user?.lastfmUsername ?? null;
    if (self && trimmed.toLowerCase() === self) {
      dispatch({ type: "SET_TARGET_VALIDATION", validationState: "error", message: "That is your account. Use Analyze My Taste instead.", resolved: null });
      return;
    }

    dispatch({ type: "SET_TARGET_VALIDATION", validationState: "validating", message: null, resolved: null });

    try {
      const result = await jsonFetch<UsernameValidationResponse>("/api/lastfm/validate-username", {
        method: "POST",
        body: JSON.stringify({ username: trimmed }),
      });
      dispatch({ type: "SET_TARGET_VALIDATION", validationState: "valid", message: `Validated as ${result.username}.`, resolved: result.normalizedUsername });
    } catch {
      dispatch({ type: "SET_TARGET_VALIDATION", validationState: "error", message: "Could not verify that Last.fm username.", resolved: null });
    }
  }

  async function runAnalysis() {
    const s = stateRef.current;
    const targetUsername = s.target.mode ? s.target.usernameResolved : selfUsername;
    dispatch({ type: "ANALYSIS_START", targetUsername });

    if (s.target.mode) {
      if (s.target.validationState !== "valid" || !s.target.usernameResolved) {
        dispatch({ type: "ANALYSIS_VALIDATION_FAIL", error: "Validate a different Last.fm username before running analysis." });
        return;
      }
    }

    let requestBody: { preset: RangeOptionId; from?: number; to?: number; targetUsername?: string } = { preset: s.selectedRange };
    if (s.target.mode) {
      requestBody.targetUsername = s.target.usernameResolved!;
    }

    if (s.selectedRange === "custom") {
      const { startYear, startMonth, endYear, endMonth } = s.customRange;
      if (!customRangeIsValid || !startYear || !startMonth || !endYear || !endMonth) {
        dispatch({ type: "ANALYSIS_VALIDATION_FAIL", error: "Please choose a valid start and end month." });
        return;
      }
      const from = Math.floor(Date.UTC(startYear, startMonth - 1, 1, 0, 0, 0) / 1000);
      const to = Math.floor(Date.UTC(endYear, endMonth, 0, 23, 59, 59) / 1000);
      requestBody = { preset: "custom", from, to };
    }

    try {
      const start = await jsonFetch<{ ok: true; runId: string }>("/api/discovery/analyze/start", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });

      dispatch({ type: "SET_ACTIVE_RUN", runId: start.runId });
      const data = await startPolling(start.runId);

      const resolvedTarget = data.targetUsername ?? targetUsername ?? null;
      dispatch({
        type: "ANALYSIS_COMPLETE",
        runId: data.analysisRunId ?? null,
        targetUsername: resolvedTarget,
        rangeLabel: data.range?.label ?? null,
        lanes: data.lanes ?? [],
        summary: data.summary ?? null,
      });
      setTimeout(() => dispatch({ type: "GO_TO_CLUSTERS" }), 250);
    } catch (err) {
      dispatch({ type: "ANALYSIS_FAIL", error: err instanceof Error ? err.message : "Analysis failed." });
      return;
    }

    dispatch({ type: "SET_ACTIVE_RUN", runId: null });
    dispatch({ type: "SET_BUSY", busy: false });
  }

  async function runRecommendations() {
    const s = stateRef.current;
    const { runId, selectedLaneId, lanes } = s.analysis;
    if (!runId || !selectedLaneId) return;

    const lane = lanes.find((l) => l.id === selectedLaneId);
    const hasLaneSeedData =
      Boolean(lane && uniqueArtists(lane.artists).length > 0) ||
      Boolean(lane && uniqueArtists(lane.memberArtists ?? []).length > 0) ||
      Boolean((lane?.similarHints?.length ?? 0) > 0);

    if (!hasLaneSeedData) {
      dispatch({ type: "SET_ERROR", error: "No recommendation seed data is available for this lane. Try another lane or a broader analysis window." });
      return;
    }

    dispatch({ type: "RECOMMEND_START" });

    try {
      const start = await jsonFetch<{ ok: true; runId: string }>("/api/discovery/recommend/start", {
        method: "POST",
        body: JSON.stringify({ analysisRunId: runId, laneId: selectedLaneId, limit: 4 }),
      });

      dispatch({ type: "SET_ACTIVE_RUN", runId: start.runId });
      const data = await startPolling(start.runId);

      dispatch({
        type: "RECOMMEND_COMPLETE",
        items: data.recommendations ?? [],
        knownHistoryMessage: data.knownHistoryMessage ?? null,
        runId: data.recommendationRunId ?? null,
        laneId: selectedLaneId,
      });
    } catch (err) {
      dispatch({ type: "RECOMMEND_FAIL", error: err instanceof Error ? err.message : "Could not generate recommendations." });
    }
  }

  async function saveArtist(rec: Recommendation) {
    const s = stateRef.current;
    if (!s.status?.isAuthenticated) return;
    const artistName = rec.artist;
    const normalized = normalizeArtistName(artistName);
    if (savedArtistNameSet.has(normalized)) return;

    dispatch({ type: "SET_SAVING_ARTIST", name: artistName });

    const selectedLaneId = s.analysis.selectedLaneId;
    const selectedRecommendationRunId = selectedLaneId ? (recommendationByLane.get(selectedLaneId)?.id ?? undefined) : undefined;
    const recommendationChips = [rec.matchSource, ...(rec.tags ?? [])]
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item, index, list) => list.findIndex((c) => c.toLowerCase() === item.toLowerCase()) === index)
      .slice(0, 3);

    try {
      const data = await jsonFetch<{ ok: true; savedArtist: SavedArtistRecord }>("/api/saved-artists", {
        method: "POST",
        body: JSON.stringify({
          artistName,
          savedFromRecommendationRunId: selectedRecommendationRunId,
          savedFromAnalysisRunId: s.analysis.runId ?? undefined,
          savedFromLaneId: selectedLaneId ?? undefined,
          savedFromTargetUsername: s.analysis.targetUsername ?? selfUsername ?? undefined,
          recommendationContext: {
            blurb: rec.blurb ?? rec.reason,
            recommendedAlbum: rec.recommendedAlbum ?? null,
            chips: recommendationChips,
          },
        }),
      });

      dispatch({ type: "ADD_SAVED_ARTIST", artist: data.savedArtist });
    } catch (err) {
      dispatch({ type: "SET_SAVE_ERROR", error: err instanceof Error ? err.message : "Could not save artist." });
    }
  }

  function onOpenLane(lane: import("./types").Lane) {
    const cachedRun = recommendationByLane.get(lane.id);
    dispatch({ type: "OPEN_LANE", laneId: lane.id, cachedRun });
  }

  return (
    <div className="mp-shell">
      {(state.view !== "landing" || state.status?.isAuthenticated) && (
        <header className="mp-topbar">
          <button className="mp-brand" onClick={() => dispatch({ type: "SET_VIEW", view: "landing" })}>
            PLAYHEAD
          </button>
          {state.status?.isAuthenticated ? (
            <div className="mp-topbar-right">
              <AuthenticatedNav />
            </div>
          ) : null}
        </header>
      )}

      {state.error && <div className="mp-error">{state.error}</div>}

      {state.view === "landing" && (
        <LandingView
          status={state.status}
          username={username}
          busy={state.busy}
          onConnect={startConnect}
          onGetRecommendations={goToRecommendations}
        />
      )}

      {state.view === "time-select" && (
        <TimeSelectView
          selectedRange={state.selectedRange}
          customRange={state.customRange}
          target={state.target}
          busy={state.busy}
          isAuthenticated={state.status?.isAuthenticated ?? false}
          yearOptions={yearOptions}
          customRangeIsValid={customRangeIsValid}
          dispatch={dispatch}
          onAnalyze={runAnalysis}
          onValidateTarget={validateTargetUsername}
          onBack={() => dispatch({ type: "SET_VIEW", view: "landing" })}
        />
      )}

      {state.view === "analyzing" && (
        <AnalyzingView
          displayUsername={displayAnalysisUsername}
          steps={analyzeSteps}
          progress={progress}
        />
      )}

      {state.view === "clusters" && (
        <ClustersView
          displayUsername={displayAnalysisUsername}
          rangeLabel={state.analysis.rangeLabel}
          summary={state.analysis.summary}
          lanes={state.analysis.lanes}
          onOpenLane={onOpenLane}
          onBack={() => dispatch({ type: "SET_VIEW", view: "time-select" })}
        />
      )}

      {state.view === "cluster-detail" && selectedLane && (
        <ClusterDetailView
          lane={selectedLane}
          coreArtists={sidebarCoreArtists}
          moreArtists={sidebarMoreArtists}
          hasSeedData={selectedLaneHasSeedData}
          recommendations={state.recommendation.items}
          showingCached={state.recommendation.showingCached}
          knownHistoryMessage={state.recommendation.knownHistoryMessage}
          busy={state.busy}
          activeRunId={state.activeRunId}
          recommendSteps={recommendSteps}
          savedArtistNameSet={savedArtistNameSet}
          savingArtistName={state.savingArtistName}
          saveError={state.saveError}
          onRunRecommendations={runRecommendations}
          onSaveArtist={saveArtist}
          onBack={() => dispatch({ type: "SET_VIEW", view: "clusters" })}
        />
      )}
    </div>
  );
}
