import { prisma } from "@/server/db";
import { getOrCreateVisitorSession } from "@/server/session";

type Params = {
  params: Promise<{ runId: string }>;
};

function toSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request, context: Params) {
  const { runId } = await context.params;
  const session = await getOrCreateVisitorSession();

  const run = await prisma.agentRun.findFirst({
    where: {
      id: runId,
      visitorSessionId: session.sessionId,
    },
  });

  if (!run) {
    return new Response("Run not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let sinceSeq = 0;

      const closeStream = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(poller);
        controller.close();
      };

      const pushEvent = (event: { seq: number; type: string; payloadJson: unknown; createdAt: Date }) => {
        if (closed) {
          return;
        }
        controller.enqueue(
          encoder.encode(
            toSse("agent_event", {
              seq: event.seq,
              type: event.type,
              payload: event.payloadJson,
              createdAt: event.createdAt,
            }),
          ),
        );
        sinceSeq = Math.max(sinceSeq, event.seq);
      };

      const backlog = await prisma.agentRunEvent.findMany({
        where: { runId },
        orderBy: { seq: "asc" },
      });

      for (const event of backlog) {
        pushEvent(event);
      }

      const poller = setInterval(async () => {
        if (closed) {
          return;
        }

        try {
          const [latestRun, newEvents] = await Promise.all([
            prisma.agentRun.findUnique({
              where: { id: runId },
              select: { status: true },
            }),
            prisma.agentRunEvent.findMany({
              where: {
                runId,
                seq: { gt: sinceSeq },
              },
              orderBy: { seq: "asc" },
              take: 100,
            }),
          ]);

          for (const event of newEvents) {
            pushEvent(event);
          }

          if (!latestRun || latestRun.status === "completed" || latestRun.status === "failed") {
            closeStream();
          }
        } catch {
          closeStream();
        }
      }, 2_000);

      const heartbeat = setInterval(() => {
        if (closed) {
          return;
        }
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

      const onAbort = () => {
        closeStream();
      };

      request.signal.addEventListener("abort", onAbort, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
