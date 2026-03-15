// @ts-ignore generated during OpenNext build
import handler, { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

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
};

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

function retryDelaySeconds(attempts: number): number {
  const clampedAttempts = Math.max(1, Math.min(attempts, 6));
  return Math.min(300, 5 * 2 ** clampedAttempts);
}

export default {
  fetch: handler.fetch,
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
};

export { DOQueueHandler, DOShardedTagCache };
