import type { AppendEventOptions, EventRecord } from "../types/domain.js";

import {
  appendJsonl,
  createStampedId,
  nowIso,
  runtimePath,
} from "./runtime.js";

export async function appendEvent(
  root: string,
  eventName: string,
  payload: Record<string, unknown> = {},
  options: AppendEventOptions = {},
): Promise<EventRecord> {
  const ts = nowIso(options.now);
  const missionId =
    typeof payload["mission_id"] === "string" ? payload["mission_id"] : "";
  const jobId = typeof payload["job_id"] === "string" ? payload["job_id"] : "";
  const event: EventRecord = {
    event_id:
      options.eventId ??
      createStampedId("event", `${eventName}:${missionId}:${jobId}:${ts}`, ts),
    ts,
    event: eventName,
    causation_id: options.causationId ?? null,
    idempotency_key: options.idempotencyKey ?? null,
    ...payload,
  };

  await appendJsonl(runtimePath(root, "events", "events.jsonl"), event);
  return event;
}
