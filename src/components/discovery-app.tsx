"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type ConnectionStatus = {
  isAuthenticated: boolean;
  user: {
    id: string;
    lastfmUsername: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
};

type Lane = {
  id: string;
  name: string;
  description: string;
  whyThisLane: string;
  confidence: number;
  artists: string[];
  tags: string[];
  totalPlays: number;
  memberArtists?: string[];
  similarHints?: Array<{ artistName: string; normalizedName: string; supportSeeds: string[]; aggregateMatch: number }>;
};

type Recommendation = {
  artist: string;
  score: number;
  reason?: string;
  blurb?: string;
  recommendedAlbum?: string | null;
  matchSource: string;
  tags: string[];
};

type AgentRun = {
  id: string;
  mode: "analyze" | "recommend";
  status: "queued" | "running" | "completed" | "failed";
  result: unknown;
  errorMessage: string | null;
};

type UsernameValidationResponse = {
  ok: true;
  username: string;
  normalizedUsername: string;
};

type HistoryRecommendationRun = {
  id: string;
  selectedLane: string;
  createdAt: string;
  strategyNote: string | null;
  recommendations: Recommendation[];
};

type HistoryAnalysisResponse = {
  ok: true;
  analysisRunId: string;
  targetUsername: string | null;
  range: {
    from: number;
    to: number;
    label: string;
  };
  summary: string | null;
  lanes: Lane[];
  recommendationRuns: HistoryRecommendationRun[];
};

type AgentLiveEvent = {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type ViewState = "landing" | "time-select" | "analyzing" | "clusters" | "cluster-detail";

const RANGE_OPTIONS = [
  { id: "7d", label: "Last 7 Days", desc: "Recent rotation" },
  { id: "6m", label: "Last 6 Months", desc: "Seasonal taste" },
  { id: "1y", label: "Last Year", desc: "Full portrait" },
  { id: "custom", label: "Select Your Own Time Range", desc: "Month-level range" },
] as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

type RangeOptionId = (typeof RANGE_OPTIONS)[number]["id"];

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const data = (await response.json()) as T & { ok?: boolean; message?: string };
  if (!response.ok || ("ok" in data && data.ok === false)) {
    throw new Error((data as { message?: string }).message ?? "Request failed.");
  }
  return data;
}

function uniqueArtists(list: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const artist of list) {
    const trimmed = artist.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

export function DiscoveryApp() {
  const [view, setView] = useState<ViewState>("landing");
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [selectedRange, setSelectedRange] = useState<RangeOptionId>("6m");
  const [customPhase, setCustomPhase] = useState<"start" | "end">("start");
  const [customStartYear, setCustomStartYear] = useState<number | null>(null);
  const [customStartMonth, setCustomStartMonth] = useState<number | null>(null);
  const [customEndYear, setCustomEndYear] = useState<number | null>(null);
  const [customEndMonth, setCustomEndMonth] = useState<number | null>(null);
  const [analysisRunId, setAnalysisRunId] = useState<string | null>(null);
  const [analysisRangeLabel, setAnalysisRangeLabel] = useState<string | null>(null);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recommendationRuns, setRecommendationRuns] = useState<HistoryRecommendationRun[]>([]);
  const [showingCachedRecommendations, setShowingCachedRecommendations] = useState(false);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<AgentLiveEvent[]>([]);
  const [targetMode, setTargetMode] = useState(false);
  const [targetUsernameInput, setTargetUsernameInput] = useState("");
  const [targetUsernameResolved, setTargetUsernameResolved] = useState<string | null>(null);
  const [targetValidationState, setTargetValidationState] = useState<"idle" | "validating" | "valid" | "error">("idle");
  const [targetValidationMessage, setTargetValidationMessage] = useState<string | null>(null);
  const [analysisTargetUsername, setAnalysisTargetUsername] = useState<string | null>(null);

  const username = status?.user?.displayName ?? status?.user?.lastfmUsername ?? "listener";
  const selfUsername = status?.user?.lastfmUsername ?? null;
  const selectedLane = useMemo(() => lanes.find((lane) => lane.id === selectedLaneId) ?? null, [lanes, selectedLaneId]);
  const selectedLaneHasSeedData = useMemo(() => {
    if (!selectedLane) return false;
    return (
      uniqueArtists(selectedLane.artists).length > 0 ||
      uniqueArtists(selectedLane.memberArtists ?? []).length > 0 ||
      (selectedLane.similarHints?.length ?? 0) > 0
    );
  }, [selectedLane]);
  const recommendationByLane = useMemo(() => {
    const latestByLane = new Map<string, HistoryRecommendationRun>();
    for (const run of recommendationRuns) {
      const existing = latestByLane.get(run.selectedLane);
      if (!existing || new Date(run.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
        latestByLane.set(run.selectedLane, run);
      }
    }
    return latestByLane;
  }, [recommendationRuns]);
  const displayAnalysisUsername = analysisTargetUsername ?? username;

  const currentYear = new Date().getUTCFullYear();
  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let year = currentYear; year >= 2000; year -= 1) {
      years.push(year);
    }
    return years;
  }, [currentYear]);

  const customRangeIsValid = useMemo(() => {
    if (!customStartYear || !customStartMonth || !customEndYear || !customEndMonth) return false;
    const startKey = customStartYear * 100 + customStartMonth;
    const endKey = customEndYear * 100 + customEndMonth;
    return startKey <= endKey;
  }, [customStartYear, customStartMonth, customEndYear, customEndMonth]);

  const analyzeSteps = useMemo(() => {
    const events = new Set(liveEvents.map((event) => event.type));
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
  }, [liveEvents]);

  const recommendSteps = useMemo(() => {
    const events = new Set(liveEvents.map((event) => event.type));
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
  }, [liveEvents]);

  const progress = useMemo(() => {
    const steps = view === "analyzing" ? analyzeSteps : recommendSteps;
    const doneCount = steps.filter((step) => step.state === "done").length;
    return Math.round((doneCount / steps.length) * 100);
  }, [analyzeSteps, recommendSteps, view]);

  useEffect(() => {
    void (async () => {
      try {
        await jsonFetch<{ ok: true }>("/api/session");
        const nextStatus = await jsonFetch<ConnectionStatus & { ok: true }>("/api/auth/me");
        setStatus(nextStatus);

        const search = new URLSearchParams(window.location.search);
        const analysisRunId = search.get("analysisRunId");
        const recommendationRunId = search.get("recommendationRunId");
        if (nextStatus.isAuthenticated && analysisRunId) {
          await hydrateFromHistory(analysisRunId, recommendationRunId);
        }

        const authError = search.get("error");
        if (authError) {
          if (authError === "auth_failed") {
            setError("Could not complete Last.fm authentication. Please try again.");
          } else if (authError === "invalid_state") {
            setError("Authentication session expired. Please connect again.");
          } else if (authError === "server_config") {
            setError("Server configuration issue. Please check env settings.");
          } else {
            setError(authError.replace(/_/g, " "));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to initialize.");
      }
    })();
  }, []);

  async function hydrateFromHistory(analysisRunIdParam: string, recommendationRunId: string | null) {
    setBusy(true);
    setError(null);
    try {
      const data = await jsonFetch<HistoryAnalysisResponse>(`/api/history/analysis/${analysisRunIdParam}`);
      setAnalysisRunId(data.analysisRunId);
      setAnalysisTargetUsername(data.targetUsername);
      setAnalysisRangeLabel(data.range.label);
      setLanes(data.lanes ?? []);
      setAnalysisSummary(data.summary ?? null);
      const historyRecommendationRuns = data.recommendationRuns ?? [];
      setRecommendationRuns(historyRecommendationRuns);

      const hydratedRec = recommendationRunId
        ? historyRecommendationRuns.find((run) => run.id === recommendationRunId) ?? null
        : null;

      if (hydratedRec) {
        setSelectedLaneId(hydratedRec.selectedLane);
        setRecommendations(hydratedRec.recommendations ?? []);
        setShowingCachedRecommendations(true);
        setView("cluster-detail");
      } else {
        setSelectedLaneId(data.lanes[0]?.id ?? null);
        setRecommendations([]);
        setShowingCachedRecommendations(false);
        setView("clusters");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load saved analysis.");
    } finally {
      setBusy(false);
    }
  }

  async function startConnect() {
    setBusy(true);
    setError(null);
    window.location.href = "/api/auth/lastfm/start?next=/";
  }

  function goToRecommendations() {
    setError(null);
    setView("time-select");
  }

  function resetTargetUser() {
    setTargetMode(false);
    setTargetUsernameInput("");
    setTargetUsernameResolved(null);
    setTargetValidationState("idle");
    setTargetValidationMessage(null);
  }

  async function validateTargetUsername() {
    const trimmed = targetUsernameInput.trim();
    if (!trimmed) {
      setTargetValidationState("error");
      setTargetValidationMessage("Enter a Last.fm username first.");
      setTargetUsernameResolved(null);
      return;
    }

    if (selfUsername && trimmed.toLowerCase() === selfUsername) {
      setTargetValidationState("error");
      setTargetValidationMessage("That is your account. Use Analyze My Taste instead.");
      setTargetUsernameResolved(null);
      return;
    }

    setTargetValidationState("validating");
    setTargetValidationMessage(null);
    setTargetUsernameResolved(null);

    try {
      const result = await jsonFetch<UsernameValidationResponse>("/api/lastfm/validate-username", {
        method: "POST",
        body: JSON.stringify({ username: trimmed }),
      });
      setTargetValidationState("valid");
      setTargetValidationMessage(`Validated as ${result.username}.`);
      setTargetUsernameResolved(result.normalizedUsername);
    } catch {
      setTargetValidationState("error");
      setTargetValidationMessage("Could not verify that Last.fm username.");
      setTargetUsernameResolved(null);
    }
  }

  async function runAnalysis() {
    setAnalysisTargetUsername(targetMode ? targetUsernameResolved : selfUsername);
    setView("analyzing");
    setBusy(true);
    setError(null);
    setRecommendations([]);
    setRecommendationRuns([]);
    setShowingCachedRecommendations(false);
    setLiveEvents([]);

    let requestBody: { preset: RangeOptionId; from?: number; to?: number; targetUsername?: string } = { preset: selectedRange };
    if (targetMode) {
      if (targetValidationState !== "valid" || !targetUsernameResolved) {
        setError("Validate a different Last.fm username before running analysis.");
        setView("time-select");
        setBusy(false);
        return;
      }
      requestBody.targetUsername = targetUsernameResolved;
    }

    if (selectedRange === "custom") {
      if (!customRangeIsValid || !customStartYear || !customStartMonth || !customEndYear || !customEndMonth) {
        setError("Please choose a valid start and end month.");
        setView("time-select");
        setBusy(false);
        return;
      }

      const from = Math.floor(Date.UTC(customStartYear, customStartMonth - 1, 1, 0, 0, 0) / 1000);
      const to = Math.floor(Date.UTC(customEndYear, customEndMonth, 0, 23, 59, 59) / 1000);
      requestBody = { preset: "custom", from, to };
    }

    try {
      const start = await jsonFetch<{ ok: true; runId: string }>("/api/discovery/analyze/start", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });

      setActiveRunId(start.runId);
      setLiveEvents([]);
      const data = await waitForRunResult(start.runId);

      setAnalysisRunId(data.analysisRunId ?? null);
      setAnalysisTargetUsername(data.targetUsername ?? (targetMode ? targetUsernameResolved : selfUsername) ?? null);
      setAnalysisRangeLabel(data.range?.label ?? null);
      const nextLanes = data.lanes ?? [];
      setLanes(nextLanes);
      setSelectedLaneId(nextLanes[0]?.id ?? null);
      setAnalysisSummary(data.summary ?? null);
      setTimeout(() => setView("clusters"), 250);
    } catch (err) {
      setAnalysisTargetUsername(null);
      setError(err instanceof Error ? err.message : "Analysis failed.");
      setView("time-select");
    } finally {
      setActiveRunId(null);
      setBusy(false);
    }
  }

  async function runRecommendations() {
    if (!analysisRunId || !selectedLaneId) return;

    const lane = lanes.find((item) => item.id === selectedLaneId);
    const hasLaneSeedData =
      Boolean(lane && uniqueArtists(lane.artists).length > 0) ||
      Boolean(lane && uniqueArtists(lane.memberArtists ?? []).length > 0) ||
      Boolean((lane?.similarHints?.length ?? 0) > 0);

    if (!hasLaneSeedData) {
      setRecommendations([]);
      setShowingCachedRecommendations(false);
      setError("No recommendation seed data is available for this lane. Try another lane or a broader analysis window.");
      return;
    }

    setBusy(true);
    setError(null);
    setShowingCachedRecommendations(false);
    setLiveEvents([]);

    try {
      const start = await jsonFetch<{ ok: true; runId: string }>("/api/discovery/recommend/start", {
        method: "POST",
        body: JSON.stringify({
          analysisRunId,
          laneId: selectedLaneId,
          limit: 4,
        }),
      });

      setActiveRunId(start.runId);
      const data = await waitForRunResult(start.runId);
      setRecommendations(data.recommendations ?? []);
      const recommendationRunId = data.recommendationRunId;
      if (typeof recommendationRunId === "string" && recommendationRunId.length > 0) {
        setRecommendationRuns((prev) => {
          const filtered = prev.filter((run) => run.selectedLane !== selectedLaneId);
          return [
            {
              id: recommendationRunId,
              selectedLane: selectedLaneId,
              createdAt: new Date().toISOString(),
              strategyNote: null,
              recommendations: data.recommendations ?? [],
            },
            ...filtered,
          ];
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate recommendations.");
    } finally {
      setActiveRunId(null);
      setBusy(false);
    }
  }

  function subscribeRun(runId: string, onEvent: (event: AgentLiveEvent) => void): () => void {
    const source = new EventSource(`/api/discovery/runs/${runId}/stream`);
    source.addEventListener("agent_event", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as AgentLiveEvent;
        onEvent(payload);
      } catch {
        // ignore malformed payload
      }
    });

    return () => {
      source.close();
    };
  }

  async function waitForRunResult(runId: string) {
    return new Promise<{
      analysisRunId?: string;
      recommendationRunId?: string;
      targetUsername?: string;
      range?: { label?: string };
      lanes: Lane[];
      summary?: string;
      recommendations: Recommendation[];
    }>((resolve, reject) => {
      let settled = false;
      const seenSeq = new Set<number>();
      const maxWaitMs = 210_000;

      const unsubscribe = subscribeRun(runId, (event) => {
        if (seenSeq.has(event.seq)) return;
        seenSeq.add(event.seq);
        setLiveEvents((prev) => [...prev, event].slice(-40));
      });

      const finish = () => {
        unsubscribe();
        clearInterval(poll);
        clearTimeout(timeoutHandle);
      };

      const timeoutHandle = setTimeout(() => {
        if (settled) return;
        settled = true;
        finish();
        reject(new Error("This run took longer than expected and was stopped. Please try again."));
      }, maxWaitMs);

      const poll = setInterval(async () => {
        try {
          const status = await jsonFetch<{ ok: true; run: AgentRun }>(`/api/discovery/runs/${runId}`);
          if (status.run.status === "completed") {
            settled = true;
            finish();
            resolve((status.run.result ?? {}) as {
              analysisRunId?: string;
              recommendationRunId?: string;
              targetUsername?: string;
              range?: { label?: string };
              lanes: Lane[];
              summary?: string;
              recommendations: Recommendation[];
            });
            return;
          }

          if (status.run.status === "failed") {
            settled = true;
            finish();
            reject(new Error(status.run.errorMessage ?? "Run failed."));
          }
        } catch (error) {
          if (!settled) {
            settled = true;
            finish();
            reject(error instanceof Error ? error : new Error("Failed to fetch run status."));
          }
        }
      }, 5000);
    });
  }

  function onOpenLane(lane: Lane) {
    setSelectedLaneId(lane.id);
    const cachedRun = recommendationByLane.get(lane.id);
    setRecommendations(cachedRun?.recommendations ?? []);
    setShowingCachedRecommendations(Boolean(cachedRun));
    setView("cluster-detail");
  }

  return (
    <div className="mp-shell">
      {view !== "landing" && (
        <header className="mp-topbar">
          <button className="mp-brand" onClick={() => setView("landing")}>
            PLAYHEAD
          </button>
          <div className="mp-topbar-right">
            <span className="mp-kicker">ACTIVE USER</span>
            <Link href="/profile" className="mp-pill mp-pill-link">
              {username}
            </Link>
          </div>
        </header>
      )}

      {error && <div className="mp-error">{error}</div>}

      {view === "landing" && (
        <main className="mp-landing">
          <section className="mp-landing-card">
            <p className="mp-kicker">PLAYHEAD</p>
            <h1>Discover artists you do not know yet.</h1>
            <p>Recommendations based on what you already love, optimized for what is missing from your history.</p>
            <div className="mp-actions-row">
              {status?.isAuthenticated ? (
                <button className="mp-button mp-button-primary" onClick={goToRecommendations} disabled={busy}>
                  Get Recommendations
                </button>
              ) : (
                <button className="mp-button mp-button-primary" onClick={startConnect} disabled={busy}>
                  Connect Last.fm
                </button>
              )}
            </div>
            {status?.isAuthenticated && (
              <p className="mp-kicker mp-auth-label">
                Logged in as{" "}
                <Link href="/profile" className="mp-auth-link">
                  {username}
                </Link>
              </p>
            )}
          </section>
        </main>
      )}

      {view === "time-select" && (
        <main className="mp-page">
          <section className="mp-panel mp-panel-narrow">
            <button className="mp-back" onClick={() => setView("landing")}>
              ← Back
            </button>
            <p className="mp-kicker">SELECT LISTENING WINDOW</p>
            <h2>How far back should we look?</h2>
            <p className="mp-muted">Choose a listening window for lane analysis.</p>

            <div className="mp-range-grid">
              {RANGE_OPTIONS.map((range) => (
                <button
                  key={range.id}
                  className={`mp-range-card ${selectedRange === range.id ? "is-selected" : ""}`}
                  onClick={() => setSelectedRange(range.id)}
                >
                  <span>{range.label}</span>
                  <small>{range.desc}</small>
                </button>
              ))}
            </div>

            {selectedRange === "custom" && (
              <section className="mp-custom-range">
                <p className="mp-kicker">MONTH-LEVEL RANGE</p>
                {customPhase === "start" ? (
                  <>
                    <p className="mp-muted">Pick your start month (earliest January 2000).</p>
                    <div className="mp-custom-grid">
                      <select className="mp-select" value={customStartYear ?? ""} onChange={(e) => setCustomStartYear(Number(e.target.value))}>
                        <option value="">Start year</option>
                        {yearOptions.map((year) => (
                          <option key={`start-year-${year}`} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>
                      <select
                        className="mp-select"
                        value={customStartMonth ?? ""}
                        onChange={(e) => setCustomStartMonth(Number(e.target.value))}
                        disabled={!customStartYear}
                      >
                        <option value="">Start month</option>
                        {MONTHS.map((month, idx) => (
                          <option key={`start-month-${month}`} value={idx + 1}>
                            {month}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mp-actions-row mp-actions-left">
                      <button
                        className="mp-button mp-button-ghost"
                        onClick={() => {
                          if (!customStartYear || !customStartMonth) return;
                          setCustomEndYear(customStartYear);
                          setCustomEndMonth(customStartMonth);
                          setCustomPhase("end");
                        }}
                        disabled={!customStartYear || !customStartMonth}
                      >
                        Continue to end month
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mp-muted">Now pick your end month. Range is inclusive by full month.</p>
                    <div className="mp-custom-grid">
                      <select className="mp-select" value={customEndYear ?? ""} onChange={(e) => setCustomEndYear(Number(e.target.value))}>
                        <option value="">End year</option>
                        {yearOptions.map((year) => (
                          <option key={`end-year-${year}`} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>
                      <select
                        className="mp-select"
                        value={customEndMonth ?? ""}
                        onChange={(e) => setCustomEndMonth(Number(e.target.value))}
                        disabled={!customEndYear}
                      >
                        <option value="">End month</option>
                        {MONTHS.map((month, idx) => (
                          <option key={`end-month-${month}`} value={idx + 1}>
                            {month}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mp-actions-row mp-actions-left">
                      <button className="mp-button mp-button-ghost" onClick={() => setCustomPhase("start")}>
                        Edit start month
                      </button>
                    </div>
                    {!customRangeIsValid && customEndYear && customEndMonth && (
                      <p className="mp-inline-error">End month must be after or equal to the start month.</p>
                    )}
                  </>
                )}
              </section>
            )}

            <div className="mp-center-cta">
              <button
                className="mp-button mp-button-primary"
                onClick={runAnalysis}
                disabled={
                  busy ||
                  !status?.isAuthenticated ||
                  (selectedRange === "custom" && !customRangeIsValid) ||
                  (targetMode && targetValidationState !== "valid")
                }
              >
                {targetMode ? "Analyze This User" : "Analyze My Taste"}
              </button>
            </div>

            <div className="mp-actions-row mp-actions-left mp-target-toggle-row">
              {!targetMode ? (
                <button className="mp-button mp-button-ghost mp-button-compact" onClick={() => setTargetMode(true)} disabled={busy}>
                  Analyze a different user
                </button>
              ) : (
                <button className="mp-button mp-button-ghost mp-button-compact" onClick={resetTargetUser} disabled={busy}>
                  Use my account instead
                </button>
              )}
            </div>

            {targetMode && (
              <section className="mp-target-user-panel">
                <label className="mp-kicker" htmlFor="target-username-input">
                  TARGET LAST.FM USERNAME
                </label>
                <div className="mp-target-user-row">
                  <input
                    id="target-username-input"
                    className="mp-input"
                    value={targetUsernameInput}
                    onChange={(event) => {
                      setTargetUsernameInput(event.target.value);
                      setTargetValidationState("idle");
                      setTargetValidationMessage(null);
                      setTargetUsernameResolved(null);
                    }}
                    placeholder="username"
                  />
                  <button
                    className="mp-button mp-button-ghost mp-button-compact"
                    onClick={validateTargetUsername}
                    disabled={busy || targetValidationState === "validating"}
                  >
                    {targetValidationState === "validating" ? "Validating..." : "Validate"}
                  </button>
                </div>
                {targetValidationMessage && (
                  <p className={`mp-target-note ${targetValidationState === "error" ? "is-error" : ""}`}>
                    {targetValidationMessage}
                  </p>
                )}
              </section>
            )}
          </section>
        </main>
      )}

      {view === "analyzing" && (
        <main className="mp-page mp-analyzing">
          <section className="mp-analyzing-card">
            <p className="mp-kicker mp-pulse">PROCESSING</p>
            <h2>Analyzing {displayAnalysisUsername}&apos;s listening history...</h2>
            <div className="mp-status-lines">
              {analyzeSteps.map((step) => (
                <div key={step.id} className={`mp-status-line is-${step.state}`}>
                  <span />
                  <p>{step.label}</p>
                </div>
              ))}
            </div>
            <div className="mp-progress-track">
              <div className="mp-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </section>
        </main>
      )}

      {view === "clusters" && (
        <main className="mp-page">
          <section className="mp-panel mp-panel-wide">
            <button className="mp-back" onClick={() => setView("time-select")}>
              ← Back to time selection
            </button>
            <p className="mp-kicker">TASTE ANALYSIS</p>
            <h2>{displayAnalysisUsername}&apos;s Listening Clusters</h2>
            {analysisRangeLabel && <p className="mp-muted">Analysis based on listening activity from {analysisRangeLabel.toLowerCase()}.</p>}
            {analysisSummary && <p className="mp-summary">{analysisSummary}</p>}

            <div className="mp-divider" />
            {lanes.length === 0 ? (
              <p className="mp-muted">No listening history was found for this time window. Go back and choose a broader date range.</p>
            ) : (
              <div className="mp-cluster-list">
                {lanes.map((lane, idx) => (
                  <button key={lane.id} className="mp-cluster-card" onClick={() => onOpenLane(lane)}>
                    <div>
                      <p className="mp-kicker">CLUSTER {String(idx + 1).padStart(2, "0")}</p>
                      <h3>{lane.name}</h3>
                      <small>{uniqueArtists(lane.artists).length} core artists · {lane.totalPlays} plays</small>
                    </div>
                    <p>{lane.description}</p>
                    <div className="mp-tag-wrap">
                      {uniqueArtists(lane.artists).slice(0, 7).map((artist) => (
                        <span key={`${lane.id}-${artist.toLowerCase()}`} className="mp-tag">
                          {artist}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      {view === "cluster-detail" && selectedLane && (
        <main className="mp-detail-layout">
          <aside className="mp-detail-sidebar">
            <button className="mp-back" onClick={() => setView("clusters")}>
              ← All Clusters
            </button>
            <h2>{selectedLane.name}</h2>
            <p className="mp-muted">{selectedLane.description}</p>

            <div className="mp-block">
              <p className="mp-kicker">CORE ARTISTS</p>
              {uniqueArtists(selectedLane.artists).length > 0 ? (
                <div className="mp-tag-wrap">
                  {uniqueArtists(selectedLane.artists).map((artist) => (
                    <span key={`${selectedLane.id}-${artist.toLowerCase()}`} className="mp-tag">
                      {artist}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mp-muted">No clear lane artists found yet. Try rerunning analysis.</p>
              )}
            </div>

            <div className="mp-divider" />

            <div className="mp-meta-stack">
              <div>
                <p className="mp-kicker">TOTAL PLAYS</p>
                <strong>{selectedLane.totalPlays}</strong>
              </div>
              <div>
                <p className="mp-kicker">CORE TAGS</p>
                <strong>{selectedLane.tags.slice(0, 2).join(" + ") || "n/a"}</strong>
              </div>
            </div>
          </aside>

          <section className="mp-detail-main">
            <p className="mp-kicker">NEW FOR YOU</p>
            <h1>Recommended Artists</h1>
            <p className="mp-muted">Artists that match this cluster and are still likely underexplored in your history.</p>

            {showingCachedRecommendations && (
              <div className="mp-actions-row mp-actions-left">
                <p className="mp-kicker">Showing saved recommendations</p>
                <button className="mp-button mp-button-ghost mp-button-compact" onClick={runRecommendations} disabled={busy}>
                  Refresh recs
                </button>
              </div>
            )}

            {!busy && recommendations.length === 0 && selectedLaneHasSeedData && (
              <div className="mp-center-cta mp-detail-cta">
                <button className="mp-button mp-button-primary" onClick={runRecommendations}>
                  Get Recommendations
                </button>
              </div>
            )}

            {!busy && recommendations.length === 0 && !selectedLaneHasSeedData && (
              <p className="mp-muted">This lane has no recommendation seed data in the selected time window. Try another lane or rerun analysis with a broader window.</p>
            )}

            {busy && activeRunId && (
              <div className="mp-progress-block">
                <p className="mp-kicker">BUILDING RECOMMENDATIONS</p>
                <div className="mp-status-lines mp-status-compact">
                  {recommendSteps.map((step) => (
                    <div key={step.id} className={`mp-status-line is-${step.state}`}>
                      <span />
                      <p>{step.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mp-rec-grid">
              {recommendations.map((rec) => (
                <article key={rec.artist} className="mp-rec-card">
                  <h3>
                    <a
                      className="mp-rec-artist-link"
                      href={`https://www.last.fm/music/${encodeURIComponent(rec.artist)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {rec.artist}
                    </a>
                  </h3>
                  <p>{rec.blurb ?? rec.reason ?? "A strong fit for this lane."}</p>
                  {rec.recommendedAlbum && <small>Start with album: {rec.recommendedAlbum}</small>}
                  <small>Seeded from {rec.matchSource}</small>
                </article>
              ))}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
