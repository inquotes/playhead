"use client";

import { useEffect, useMemo, useState } from "react";

type ConnectionStatus = {
  status: "disconnected" | "pending" | "connected" | "error";
  lastfmUsername: string | null;
  hasConnection: boolean;
  authErrorCode: string | null;
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
};

type Recommendation = {
  artist: string;
  score: number;
  reason: string;
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
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usernameInput, setUsernameInput] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<AgentLiveEvent[]>([]);

  const username = status?.lastfmUsername ?? "listener";
  const selectedLane = useMemo(() => lanes.find((lane) => lane.id === selectedLaneId) ?? null, [lanes, selectedLaneId]);

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
    void initialize();
  }, []);

  async function initialize() {
    try {
      await jsonFetch<{ ok: true }>("/api/session");
      const nextStatus = await jsonFetch<ConnectionStatus & { ok: true }>("/api/lastfm/connect/status");
      setStatus(nextStatus);
      if (nextStatus.lastfmUsername) {
        setUsernameInput(nextStatus.lastfmUsername);
        if (nextStatus.status === "connected") {
          setView("time-select");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to initialize.");
    }
  }

  async function startConnect() {
    setBusy(true);
    setError(null);
    try {
      const result = await jsonFetch<{ ok: true; status: string; lastfmUsername?: string }>("/api/lastfm/connect/start", {
        method: "POST",
        body: JSON.stringify({ username: usernameInput.trim() }),
      });
      if (result.status === "connected") {
        const nextStatus = await jsonFetch<ConnectionStatus & { ok: true }>("/api/lastfm/connect/status");
        setStatus(nextStatus);
        setView("time-select");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not validate this Last.fm username.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await jsonFetch<{ ok: true }>("/api/lastfm/disconnect", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setStatus({ status: "disconnected", lastfmUsername: null, hasConnection: false, authErrorCode: null });
      setAnalysisRunId(null);
      setAnalysisRangeLabel(null);
      setLanes([]);
      setSelectedLaneId(null);
      setAnalysisSummary(null);
      setRecommendations([]);
      setView("landing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  }

  async function runAnalysis() {
    setView("analyzing");
    setBusy(true);
    setError(null);
    setRecommendations([]);
    setLiveEvents([]);

    let requestBody: { preset: RangeOptionId; from?: number; to?: number } = { preset: selectedRange };
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
      setAnalysisRangeLabel(data.range?.label ?? null);
      const nextLanes = data.lanes ?? [];
      setLanes(nextLanes);
      setSelectedLaneId(nextLanes[0]?.id ?? null);
      setAnalysisSummary(data.summary ?? null);
      setTimeout(() => setView("clusters"), 250);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
      setView("time-select");
    } finally {
      setActiveRunId(null);
      setBusy(false);
    }
  }

  async function runRecommendations() {
    if (!analysisRunId || !selectedLaneId) return;

    setBusy(true);
    setError(null);
    setRecommendations([]);
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
      range?: { label?: string };
      lanes: Lane[];
      summary?: string;
      recommendations: Recommendation[];
    }>((resolve, reject) => {
      let settled = false;
      const seenSeq = new Set<number>();

      const unsubscribe = subscribeRun(runId, (event) => {
        if (seenSeq.has(event.seq)) return;
        seenSeq.add(event.seq);
        setLiveEvents((prev) => [...prev, event].slice(-40));
      });

      const finish = () => {
        unsubscribe();
        clearInterval(poll);
      };

      const poll = setInterval(async () => {
        try {
          const status = await jsonFetch<{ ok: true; run: AgentRun }>(`/api/discovery/runs/${runId}`);
          if (status.run.status === "completed") {
            settled = true;
            finish();
            resolve((status.run.result ?? {}) as {
              analysisRunId?: string;
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
    setRecommendations([]);
    setView("cluster-detail");
  }

  return (
    <div className="mp-shell">
      {view !== "landing" && (
        <header className="mp-topbar">
          <button className="mp-brand" onClick={() => setView("landing")}>
            RESONANCE
          </button>
          <div className="mp-topbar-right">
            <span className="mp-kicker">ACTIVE USER</span>
            <span className="mp-pill">{username}</span>
            <button className="mp-link" onClick={disconnect} disabled={busy}>
              Disconnect
            </button>
          </div>
        </header>
      )}

      {error && <div className="mp-error">{error}</div>}

      {view === "landing" && (
        <main className="mp-landing">
          <div className="mp-grid-bg" />
          <section className="mp-landing-card">
            <p className="mp-kicker">LISTENING ANALYSIS CONSOLE</p>
            <h1>Discover artists you do not know yet.</h1>
            <p>Recommendations based on what you already love, optimized for what is missing from your history.</p>
            <div className="mp-actions-row">
              <input
                className="mp-input"
                value={usernameInput}
                onChange={(event) => setUsernameInput(event.target.value)}
                placeholder="Last.fm username"
              />
            </div>
            <div className="mp-actions-row">
              <button className="mp-button mp-button-primary" onClick={startConnect} disabled={busy || !usernameInput.trim()}>
                Begin
              </button>
            </div>
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
                disabled={busy || status?.status !== "connected" || (selectedRange === "custom" && !customRangeIsValid)}
              >
                Analyze My Taste
              </button>
            </div>
          </section>
        </main>
      )}

      {view === "analyzing" && (
        <main className="mp-page mp-analyzing">
          <section className="mp-analyzing-card">
            <p className="mp-kicker mp-pulse">PROCESSING</p>
            <h2>Analyzing {username}&apos;s listening history...</h2>
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
            <h2>{username}&apos;s Listening Clusters</h2>
            {analysisRangeLabel && <p className="mp-muted">Analysis based on listening activity from {analysisRangeLabel.toLowerCase()}.</p>}
            {analysisSummary && <p className="mp-summary">{analysisSummary}</p>}

            <div className="mp-divider" />
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

            {!busy && recommendations.length === 0 && (
              <div className="mp-center-cta mp-detail-cta">
                <button className="mp-button mp-button-primary" onClick={runRecommendations}>
                  Get Recommendations
                </button>
              </div>
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
              {recommendations.map((rec, idx) => (
                <article key={rec.artist} className={`mp-rec-card ${idx === 0 ? "is-featured" : ""}`}>
                  <h3>{rec.artist}</h3>
                  <p>{rec.reason}</p>
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
