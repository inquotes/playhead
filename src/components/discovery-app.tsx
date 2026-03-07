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
  firstKnownYear: number | null;
  isLikelyNewEra: boolean;
};

type AgentTraceStep = {
  index: number;
  toolName: string;
  arguments: Record<string, unknown>;
  status: "success" | "error" | "budget_skipped";
  durationMs: number;
  preview: string;
};

type AgentTrace = {
  toolCallsUsed: number;
  maxToolCalls: number;
  terminationReason: "final" | "budget_exhausted" | "timeout" | "error";
  steps: AgentTraceStep[];
};

type AgentRun = {
  id: string;
  mode: "analyze" | "recommend";
  status: "queued" | "running" | "completed" | "failed";
  toolCallsUsed: number;
  maxToolCalls: number;
  timeoutMs: number;
  terminationReason: string | null;
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
  { id: "7d", label: "7 Days", desc: "Recent rotation" },
  { id: "1m", label: "1 Month", desc: "Monthly patterns" },
  { id: "6m", label: "6 Months", desc: "Seasonal taste" },
  { id: "1y", label: "1 Year", desc: "Full portrait" },
  { id: "summer2025", label: "Summer 2025", desc: "Jun-Aug 2025" },
] as const;

const STATUS_LINES = [
  "Scanning your listening history...",
  "Identifying taste clusters...",
  "Mapping artist relationships...",
  "Preparing new recommendations...",
];

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

export function DiscoveryApp() {
  const [view, setView] = useState<ViewState>("landing");
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [selectedRange, setSelectedRange] = useState<RangeOptionId>("6m");
  const [analysisRunId, setAnalysisRunId] = useState<string | null>(null);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [strategyNote, setStrategyNote] = useState<string | null>(null);
  const [analysisTrace, setAnalysisTrace] = useState<AgentTrace | null>(null);
  const [recommendationTrace, setRecommendationTrace] = useState<AgentTrace | null>(null);
  const [newPreferred, setNewPreferred] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<AgentLiveEvent[]>([]);

  const username = status?.lastfmUsername ?? "listener";
  const selectedLane = useMemo(() => lanes.find((lane) => lane.id === selectedLaneId) ?? null, [lanes, selectedLaneId]);

  useEffect(() => {
    void initialize();
  }, []);

  async function initialize() {
    try {
      await jsonFetch<{ ok: true }>("/api/session");
      const nextStatus = await jsonFetch<ConnectionStatus & { ok: true }>("/api/lastfm/connect/status");
      setStatus(nextStatus);
      if (nextStatus.status === "connected") {
        setView("time-select");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to initialize.");
    }
  }

  async function startConnect() {
    setBusy(true);
    setError(null);
    try {
      const result = await jsonFetch<{ ok: true; loginUrl: string }>("/api/lastfm/connect/start", {
        method: "POST",
        body: JSON.stringify({}),
      });
      window.location.href = result.loginUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Last.fm connection.");
      setBusy(false);
    }
  }

  async function verifyConnect() {
    setBusy(true);
    setError(null);
    try {
      await jsonFetch<{ ok: true }>("/api/lastfm/connect/verify", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const nextStatus = await jsonFetch<ConnectionStatus & { ok: true }>("/api/lastfm/connect/status");
      setStatus(nextStatus);
      if (nextStatus.status === "connected") {
        setView("time-select");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify Last.fm login.");
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
      setLanes([]);
      setSelectedLaneId(null);
      setAnalysisSummary(null);
      setStrategyNote(null);
      setAnalysisTrace(null);
      setRecommendationTrace(null);
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
    setProgress(0);
    setStrategyNote(null);
    setRecommendationTrace(null);
    setRecommendations([]);

    const interval = window.setInterval(() => {
      setProgress((p) => (p >= 92 ? p : p + 2));
    }, 85);

    try {
      const start = await jsonFetch<{ ok: true; runId: string }>("/api/discovery/analyze/start", {
        method: "POST",
        body: JSON.stringify({ preset: selectedRange }),
      });

      setActiveRunId(start.runId);
      setLiveEvents([]);
      const data = await waitForRunResult(start.runId);

      setAnalysisRunId(data.analysisRunId ?? null);
      const nextLanes = data.lanes ?? [];
      setLanes(nextLanes);
      setSelectedLaneId(nextLanes[0]?.id ?? null);
      setAnalysisSummary((data as { summary?: string }).summary ?? null);
      setAnalysisTrace(data.trace ?? null);
      setProgress(100);
      setTimeout(() => setView("clusters"), 300);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
      setView("time-select");
    } finally {
      window.clearInterval(interval);
      setActiveRunId(null);
      setBusy(false);
    }
  }

  async function runRecommendations() {
    if (!analysisRunId || !selectedLaneId) return;

    setBusy(true);
    setError(null);
    setRecommendations([]);

    try {
      const start = await jsonFetch<{ ok: true; runId: string }>("/api/discovery/recommend/start", {
        method: "POST",
        body: JSON.stringify({
          analysisRunId,
          laneId: selectedLaneId,
          newPreferred,
          limit: 5,
        }),
      });

      setActiveRunId(start.runId);
      setLiveEvents([]);

      const data = await waitForRunResult(start.runId);

      setRecommendations(data.recommendations ?? []);
      setStrategyNote(data.strategyNote ?? null);
      setRecommendationTrace(data.trace ?? null);
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
        // Ignore malformed event payload.
      }
    });

    source.onerror = () => {
      // Keep trying; EventSource auto-reconnects.
    };

    return () => {
      source.close();
    };
  }

  async function waitForRunResult(runId: string) {
    return new Promise<{
      analysisRunId?: string;
      lanes: Lane[];
      summary?: string;
      notablePatterns?: string[];
      trace?: AgentTrace;
      recommendations: Recommendation[];
      strategyNote?: string;
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
              lanes: Lane[];
              summary?: string;
              notablePatterns?: string[];
              trace?: AgentTrace;
              recommendations: Recommendation[];
              strategyNote?: string;
            });
            return;
          }

          if (status.run.status === "failed") {
            settled = true;
            finish();
            reject(new Error(status.run.errorMessage ?? "Agent run failed."));
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
            <p>
              We analyze your Last.fm patterns, split your taste into lanes, and recommend artists that fit a lane but are missing from your history.
            </p>
            <div className="mp-actions-row">
              <button className="mp-button mp-button-primary" onClick={startConnect} disabled={busy}>
                Connect Last.fm
              </button>
              <button className="mp-button mp-button-ghost" onClick={verifyConnect} disabled={busy}>
                I finished login, verify
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
            <p className="mp-muted">Longer windows reveal deeper patterns. Shorter windows show recent obsessions.</p>
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
            <div className="mp-center-cta">
              <button className="mp-button mp-button-primary" onClick={runAnalysis} disabled={busy || status?.status !== "connected"}>
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
            <h2>Analyzing {username}&apos;s listening DNA...</h2>
            <div className="mp-status-lines">
              {STATUS_LINES.map((line, idx) => (
                <div key={line} className="mp-status-line" style={{ animationDelay: `${idx * 0.5}s` }}>
                  <span />
                  <p>{line}</p>
                </div>
              ))}
            </div>
            <div className="mp-progress-track">
              <div className="mp-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            {liveEvents.length > 0 && (
              <details className="mp-trace" open>
                <summary>Live Agent Activity ({liveEvents.length})</summary>
                <div className="mp-trace-list">
                  {liveEvents.slice(-8).map((event) => (
                    <div key={`${event.seq}-${event.type}`} className="mp-trace-item">
                      <strong>
                        #{event.seq} {event.type}
                      </strong>
                      <p>{typeof event.payload.message === "string" ? event.payload.message : JSON.stringify(event.payload).slice(0, 170)}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
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
            <p className="mp-muted">We identified {lanes.length} patterns in your listening history.</p>
            {analysisSummary && <p className="mp-summary">{analysisSummary}</p>}
            {analysisTrace && (
              <details className="mp-trace">
                <summary>
                  Agent trace: {analysisTrace.toolCallsUsed}/{analysisTrace.maxToolCalls} tools, {analysisTrace.terminationReason}
                </summary>
                <div className="mp-trace-list">
                  {analysisTrace.steps.map((step) => (
                    <div key={`${step.index}-${step.toolName}`} className="mp-trace-item">
                      <strong>
                        {step.index}. {step.toolName}
                      </strong>
                      <span>
                        {step.status} · {step.durationMs}ms
                      </span>
                      <p>{step.preview}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div className="mp-divider" />
            <div className="mp-cluster-list">
              {lanes.map((lane, idx) => (
                <button key={lane.id} className="mp-cluster-card" onClick={() => onOpenLane(lane)}>
                  <div>
                    <p className="mp-kicker">CLUSTER {String(idx + 1).padStart(2, "0")}</p>
                    <h3>{lane.name}</h3>
                    <small>{lane.artists.length} core artists · {lane.totalPlays} plays</small>
                  </div>
                  <p>{lane.description}</p>
                </button>
              ))}
            </div>
          </section>
        </main>
      )}

      {view === "cluster-detail" && selectedLane && (
        <main className="mp-detail-layout">
          <aside className="mp-detail-sidebar">
            <button className="mp-back" onClick={() => setView("clusters")}>← All Clusters</button>
            <h2>{selectedLane.name}</h2>
            <p className="mp-muted">{selectedLane.description}</p>
            <p className="mp-lane-why">{selectedLane.whyThisLane}</p>

            <div className="mp-block">
              <p className="mp-kicker">ARTISTS YOU KNOW</p>
              {selectedLane.artists.length > 0 ? (
                <div className="mp-tag-wrap">
                  {selectedLane.artists.map((artist) => (
                    <span key={artist} className="mp-tag">{artist}</span>
                  ))}
                </div>
              ) : (
                <p className="mp-muted">No clearly matched known artists for this lane yet. Try rerunning analysis.</p>
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
              <div>
                <p className="mp-kicker">AI CONFIDENCE</p>
                <strong>{Math.round(selectedLane.confidence * 100)}%</strong>
              </div>
            </div>
          </aside>

          <section className="mp-detail-main">
            <p className="mp-kicker">NEW FOR YOU</p>
            <h1>Recommended Artists</h1>
            <p className="mp-muted">Artists that match this cluster but are not in your listening history yet.</p>

            <label className="mp-checkbox-row">
              <input type="checkbox" checked={newPreferred} onChange={(event) => setNewPreferred(event.target.checked)} />
              <span>Prefer newer artists, but allow strong older gap-fills</span>
            </label>

            <div className="mp-actions-row">
              <button className="mp-button mp-button-primary" onClick={runRecommendations} disabled={busy}>
                {recommendations.length > 0 ? "Refresh Recommendations" : "Get Recommendations"}
              </button>
            </div>

            {busy && activeRunId && liveEvents.length > 0 && (
              <details className="mp-trace" open>
                <summary>Live Agent Activity ({liveEvents.length})</summary>
                <div className="mp-trace-list">
                  {liveEvents.slice(-8).map((event) => (
                    <div key={`${event.seq}-${event.type}`} className="mp-trace-item">
                      <strong>
                        #{event.seq} {event.type}
                      </strong>
                      <p>{typeof event.payload.message === "string" ? event.payload.message : JSON.stringify(event.payload).slice(0, 170)}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {strategyNote && <p className="mp-summary">{strategyNote}</p>}

            {recommendationTrace && (
              <details className="mp-trace">
                <summary>
                  Agent trace: {recommendationTrace.toolCallsUsed}/{recommendationTrace.maxToolCalls} tools, {recommendationTrace.terminationReason}
                </summary>
                <div className="mp-trace-list">
                  {recommendationTrace.steps.map((step) => (
                    <div key={`${step.index}-${step.toolName}`} className="mp-trace-item">
                      <strong>
                        {step.index}. {step.toolName}
                      </strong>
                      <span>
                        {step.status} · {step.durationMs}ms
                      </span>
                      <p>{step.preview}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="mp-rec-grid">
              {recommendations.map((rec, idx) => (
                <article key={rec.artist} className={`mp-rec-card ${idx === 0 ? "is-featured" : ""}`}>
                  <span className="mp-chip">{rec.firstKnownYear ? `Since ${rec.firstKnownYear}` : "Lane Match"}</span>
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
