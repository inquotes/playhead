import { EventEmitter } from "events";

export type AgentRunStreamEvent = {
  runId: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function publishAgentRunEvent(event: AgentRunStreamEvent) {
  emitter.emit(event.runId, event);
}

export function subscribeAgentRunEvents(
  runId: string,
  listener: (event: AgentRunStreamEvent) => void,
): () => void {
  emitter.on(runId, listener);
  return () => {
    emitter.off(runId, listener);
  };
}
