import { useCallback, useEffect, useRef } from "react";
import type { AgentLiveEvent, AgentRun, RunResult } from "./types";
import { jsonFetch } from "./types";

export function useDiscoveryRun(options: {
  onEvents: (events: AgentLiveEvent[]) => void;
}): {
  startPolling: (runId: string) => Promise<RunResult>;
  cancel: () => void;
} {
  const onEventsRef = useRef(options.onEvents);
  useEffect(() => {
    onEventsRef.current = options.onEvents;
  });

  const pollingRef = useRef(false);
  const cancelRef = useRef<(() => void) | null>(null);

  const cancel = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    pollingRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      cancel();
    };
  }, [cancel]);

  const startPolling = useCallback(
    (runId: string): Promise<RunResult> => {
      cancel();
      pollingRef.current = true;

      return new Promise<RunResult>((resolve, reject) => {
        let settled = false;
        const maxWaitMs = 210_000;
        let sinceSeq = 0;
        let pollDelayMs = 2_000;
        let consecutiveFailures = 0;
        let pollHandle: ReturnType<typeof setTimeout> | null = null;

        const scheduleNextPoll = (delayMs: number) => {
          pollHandle = setTimeout(() => {
            void pollOnce();
          }, delayMs);
        };

        const finish = () => {
          if (pollHandle) {
            clearTimeout(pollHandle);
          }
          clearTimeout(timeoutHandle);
          pollingRef.current = false;
          cancelRef.current = null;
        };

        cancelRef.current = () => {
          if (settled) return;
          settled = true;
          finish();
          reject(new Error("Polling cancelled."));
        };

        const pollOnce = async () => {
          try {
            const status = await jsonFetch<{
              ok: true;
              run: AgentRun;
              events: AgentLiveEvent[];
              latestSeq: number;
            }>(`/api/discovery/runs/${runId}?includeEvents=1&sinceSeq=${sinceSeq}&limit=120`);

            consecutiveFailures = 0;

            if (status.events.length > 0) {
              onEventsRef.current(status.events);
            }

            sinceSeq = Math.max(sinceSeq, status.latestSeq);

            if (status.run.status === "completed") {
              settled = true;
              finish();
              resolve((status.run.result ?? {}) as RunResult);
              return;
            }

            if (status.run.status === "failed") {
              settled = true;
              finish();
              reject(new Error(status.run.errorMessage ?? "Run failed."));
              return;
            }

            pollDelayMs = Math.min(5_000, Math.round(pollDelayMs * 1.2));
            if (!settled) {
              scheduleNextPoll(pollDelayMs);
            }
          } catch (error) {
            if (settled) return;

            const message = error instanceof Error ? error.message : "Failed to fetch run status.";
            if (message === "Run not found.") {
              settled = true;
              finish();
              reject(new Error(message));
              return;
            }

            consecutiveFailures += 1;
            pollDelayMs = Math.min(5_000, Math.round(pollDelayMs * 1.3));
            if (consecutiveFailures >= 4) {
              settled = true;
              finish();
              reject(error instanceof Error ? error : new Error("Failed to fetch run status."));
              return;
            }

            scheduleNextPoll(pollDelayMs);
          }
        };

        const timeoutHandle = setTimeout(() => {
          if (settled) return;
          settled = true;
          finish();
          reject(new Error("This run took longer than expected and was stopped. Please try again."));
        }, maxWaitMs);

        scheduleNextPoll(0);
      });
    },
    [cancel],
  );

  return { startPolling, cancel };
}
