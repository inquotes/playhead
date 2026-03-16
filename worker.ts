import handler, { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

type DiscoveryQueueMessage = {
  runId: string;
  mode: "analyze" | "recommend";
  enqueuedAt?: string;
};

type QueueMessage = {
  body: unknown;
  attempts: number;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
};

type QueueBatch = {
  queue: string;
  messages: QueueMessage[];
};

type QueueEnv = {
  WORKER_SELF_REFERENCE: {
    fetch: (request: Request) => Promise<Response>;
  };
  QUEUE_PROCESS_SECRET?: string;
  DISCOVERY_RUN_SWEEPER_SECRET?: string;
  WEEKLY_BACKFILL_RUN_SECRET?: string;
  BACKFILL_WORKFLOW_TRIGGER_SECRET?: string;
  WEEKLY_BACKFILL_WORKFLOW: WorkflowBinding<WeeklyBackfillWorkflowParams>;
};

type WorkflowInstanceStatus = {
  status: "queued" | "running" | "paused" | "errored" | "terminated" | "complete" | "waiting" | "waitingForPause" | "unknown";
  error?: { name: string; message: string };
  output?: unknown;
};

type WorkflowInstanceBinding = {
  id: string;
  status: () => Promise<WorkflowInstanceStatus>;
  restart: () => Promise<void>;
};

type WorkflowBinding<P> = {
  create: (options?: { id?: string; params?: P }) => Promise<WorkflowInstanceBinding>;
  get: (id: string) => Promise<WorkflowInstanceBinding>;
};

type WeeklyBackfillWorkflowParams = {
  userAccountId: string;
  username: string;
  trigger?: "update_now" | "recent_year_gate" | "watchdog" | "other";
};

type WeeklyStateResponse = {
  ok: boolean;
  terminal?: boolean;
  state?: {
    recentYearReadyAt?: string | null;
    fullHistoryReadyAt?: string | null;
    weeksDiscovered: number;
    weeksProcessed: number;
  };
  job?: {
    status: string;
    nextRunAt?: string | null;
  } | null;
  workflowState?: "running" | "waiting" | "errored" | "complete";
  message?: string;
};

type WeeklyRunResponse = {
  ok: boolean;
  processed?: number;
  reason?: "missing" | "terminal" | "not_ready" | "locked";
  message?: string;
};

const WORKFLOW_MAX_ITERATIONS = 600;
const WORKFLOW_SLEEP_SECONDS = 8;

function workflowInstanceId(userAccountId: string): string {
  return `weekly-backfill-${userAccountId}`;
}

function parseMessage(input: unknown): DiscoveryQueueMessage | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  const runId = typeof candidate.runId === "string" ? candidate.runId : null;
  const mode = candidate.mode === "analyze" || candidate.mode === "recommend" ? candidate.mode : null;
  const enqueuedAt = typeof candidate.enqueuedAt === "string" ? candidate.enqueuedAt : undefined;

  if (!runId || !mode) {
    return null;
  }

  return { runId, mode, enqueuedAt };
}

function expectedModeForQueue(queueName: string): "analyze" | "recommend" | null {
  if (queueName === "playhead-analyze-jobs") {
    return "analyze";
  }
  if (queueName === "playhead-recommend-jobs") {
    return "recommend";
  }
  return null;
}

async function dispatchQueuedRun(env: QueueEnv, message: DiscoveryQueueMessage): Promise<Response> {
  return env.WORKER_SELF_REFERENCE.fetch(
    new Request("https://internal/api/internal/queue/process", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.QUEUE_PROCESS_SECRET ? { "x-queue-secret": env.QUEUE_PROCESS_SECRET } : {}),
      },
      body: JSON.stringify(message),
    }),
  );
}

async function runStaleDiscoverySweep(env: QueueEnv): Promise<void> {
  const response = await env.WORKER_SELF_REFERENCE.fetch(
    new Request("https://internal/api/internal/jobs/discovery-runs/stale-sweeper", {
      method: "POST",
      headers: {
        ...(env.DISCOVERY_RUN_SWEEPER_SECRET ? { "x-run-sweeper-secret": env.DISCOVERY_RUN_SWEEPER_SECRET } : {}),
      },
    }),
  );

  if (!response.ok) {
    throw new Error(`Stale discovery sweeper failed with status ${response.status}.`);
  }
}

function retryDelaySeconds(attempts: number): number {
  const clampedAttempts = Math.max(1, Math.min(attempts, 6));
  return Math.min(300, 5 * 2 ** clampedAttempts);
}

async function triggerWeeklyBackfillWorkflow(request: Request, env: QueueEnv): Promise<Response> {
  const secret = env.BACKFILL_WORKFLOW_TRIGGER_SECRET;
  if (secret) {
    const provided = request.headers.get("x-workflow-trigger-secret");
    if (!provided || provided !== secret) {
      return new Response(JSON.stringify({ ok: false, message: "Unauthorized." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  let payload: WeeklyBackfillWorkflowParams;
  try {
    const parsed = (await request.json()) as Partial<WeeklyBackfillWorkflowParams>;
    const userAccountId = typeof parsed.userAccountId === "string" ? parsed.userAccountId.trim() : "";
    const username = typeof parsed.username === "string" ? parsed.username.trim() : "";
    const trigger =
      parsed.trigger === "update_now" || parsed.trigger === "recent_year_gate" || parsed.trigger === "watchdog" || parsed.trigger === "other"
        ? parsed.trigger
        : "other";

    if (!userAccountId || !username) {
      return new Response(JSON.stringify({ ok: false, message: "userAccountId and username are required." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    payload = { userAccountId, username, trigger };
  } catch {
    return new Response(JSON.stringify({ ok: false, message: "Invalid JSON payload." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const instanceId = workflowInstanceId(payload.userAccountId);
  let action: "created" | "reused" | "restarted" = "created";

  try {
    const instance = await env.WEEKLY_BACKFILL_WORKFLOW.create({
      id: instanceId,
      params: payload,
    });
    const status = await instance.status();
    return new Response(JSON.stringify({ ok: true, instanceId: instance.id, action, status }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create workflow instance.";
    const duplicateId = message.toLowerCase().includes("already") || message.toLowerCase().includes("exists");
    if (!duplicateId) {
      return new Response(JSON.stringify({ ok: false, message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const instance = await env.WEEKLY_BACKFILL_WORKFLOW.get(instanceId);
      const status = await instance.status();
      if (status.status === "errored" || status.status === "terminated" || status.status === "complete") {
        await instance.restart();
        action = "restarted";
      } else {
        action = "reused";
      }

      const latestStatus = await instance.status();
      return new Response(JSON.stringify({ ok: true, instanceId: instance.id, action, status: latestStatus }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (secondaryError) {
      const secondaryMessage = secondaryError instanceof Error ? secondaryError.message : "Failed to access existing workflow instance.";
      return new Response(JSON.stringify({ ok: false, message: secondaryMessage }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
}

export class WeeklyBackfillWorkflow extends WorkflowEntrypoint<QueueEnv, WeeklyBackfillWorkflowParams> {
  private async callInternal(path: string, init: RequestInit): Promise<Response> {
    return this.env.WORKER_SELF_REFERENCE.fetch(
      new Request(`https://internal${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(this.env.WEEKLY_BACKFILL_RUN_SECRET ? { "x-runner-secret": this.env.WEEKLY_BACKFILL_RUN_SECRET } : {}),
          ...(init.headers ?? {}),
        },
      }),
    );
  }

  async run(event: WorkflowEvent<WeeklyBackfillWorkflowParams>, step: WorkflowStep) {
    const payload = event.payload;
    if (!payload.userAccountId || !payload.username) {
      throw new Error("Workflow payload is missing userAccountId or username.");
    }

    await step.do(
      "enqueue-backfill-job",
      {
        retries: { limit: 5, delay: "5 seconds", backoff: "exponential" },
        timeout: "2 minutes",
      },
      async () => {
        const response = await this.callInternal("/api/internal/jobs/weekly-backfill/enqueue", {
          method: "POST",
          body: JSON.stringify({
            userAccountId: payload.userAccountId,
            username: payload.username,
            priority: 200,
          }),
        });
        if (!response.ok) {
          throw new Error(`Enqueue failed with status ${response.status}.`);
        }
        return { queued: true };
      },
    );

    for (let iteration = 0; iteration < WORKFLOW_MAX_ITERATIONS; iteration += 1) {
      const runResult = await step.do(
        `run-dispatch-${iteration}`,
        {
          retries: { limit: 3, delay: "4 seconds", backoff: "linear" },
          timeout: "2 minutes",
        },
        async () => {
          const response = await this.callInternal("/api/internal/jobs/weekly-backfill/run", {
            method: "POST",
            body: JSON.stringify({
              userAccountId: payload.userAccountId,
              limit: 1,
            }),
          });

          if (!response.ok) {
            throw new Error(`Dispatcher run failed with status ${response.status}.`);
          }

          return (await response.json()) as WeeklyRunResponse;
        },
      );

      if (!runResult.ok) {
        throw new Error(runResult.message ?? "Backfill run step failed.");
      }

      const state = await step.do(
        `read-state-${iteration}`,
        {
          retries: { limit: 3, delay: "3 seconds", backoff: "linear" },
          timeout: "2 minutes",
        },
        async () => {
          const response = await this.callInternal(
            `/api/internal/jobs/weekly-backfill/state?userAccountId=${encodeURIComponent(payload.userAccountId)}`,
            {
              method: "GET",
            },
          );

          if (!response.ok) {
            throw new Error(`State read failed with status ${response.status}.`);
          }

          return (await response.json()) as WeeklyStateResponse;
        },
      );

      if (!state.ok) {
        throw new Error(state.message ?? "Backfill workflow state read failed.");
      }

      if (state.job?.status === "failed_permanent") {
        throw new Error("Backfill reached failed_permanent state.");
      }

      if (state.terminal || state.state?.fullHistoryReadyAt) {
        return {
          completed: true,
          fullHistoryReadyAt: state.state?.fullHistoryReadyAt ?? null,
          recentYearReadyAt: state.state?.recentYearReadyAt ?? null,
          weeksProcessed: state.state?.weeksProcessed ?? 0,
          weeksDiscovered: state.state?.weeksDiscovered ?? 0,
        };
      }

      if ((runResult.processed ?? 0) > 0 && state.workflowState === "running") {
        continue;
      }

      const nextRunAtMs = state.job?.nextRunAt ? new Date(state.job.nextRunAt).getTime() : NaN;
      const waitSeconds = Number.isFinite(nextRunAtMs)
        ? Math.max(1, Math.min(60, Math.ceil((nextRunAtMs - Date.now()) / 1000)))
        : WORKFLOW_SLEEP_SECONDS;

      await step.sleep(`wait-before-next-iteration-${iteration}`, `${waitSeconds} seconds`);
    }

    throw new Error("Backfill workflow exceeded iteration budget before completion.");
  }
}

export default {
  async fetch(request: Request, env: QueueEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/__internal/workflows/weekly-backfill/trigger") {
      return triggerWeeklyBackfillWorkflow(request, env);
    }
    return handler.fetch(request, env, ctx);
  },
  async queue(batch: QueueBatch, env: QueueEnv) {
    const expectedMode = expectedModeForQueue(batch.queue);
    for (const message of batch.messages) {
      const payload = parseMessage(message.body);
      if (!payload || !expectedMode || payload.mode !== expectedMode) {
        message.ack();
        continue;
      }

      try {
        const response = await dispatchQueuedRun(env, payload);
        if (response.ok || response.status < 500) {
          message.ack();
        } else {
          message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
        }
      } catch (error) {
        void error;
        message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      }
    }
  },
  async scheduled(_controller: ScheduledController, env: QueueEnv, _ctx: ExecutionContext) {
    await runStaleDiscoverySweep(env);
  },
};

export { DOQueueHandler, DOShardedTagCache };
