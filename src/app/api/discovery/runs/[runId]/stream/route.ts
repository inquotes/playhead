import { prisma } from "@/server/db";
import { subscribeAgentRunEvents } from "@/server/agent/events";
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
      const backlog = await prisma.agentRunEvent.findMany({
        where: { runId },
        orderBy: { seq: "asc" },
      });

      for (const event of backlog) {
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
      }

      const unsubscribe = subscribeAgentRunEvents(runId, (event) => {
        controller.enqueue(encoder.encode(toSse("agent_event", event)));
      });

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

      const onAbort = () => {
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
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
