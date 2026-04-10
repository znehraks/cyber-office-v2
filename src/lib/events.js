import { appendJsonl, createStampedId, nowIso, runtimePath } from "./runtime.js";

export async function appendEvent(root, eventName, payload = {}, options = {}) {
  const ts = nowIso(options.now);
  const event = {
    event_id:
      options.eventId ??
      createStampedId("event", `${eventName}:${payload.mission_id ?? ""}:${payload.job_id ?? ""}:${ts}`, ts),
    ts,
    event: eventName,
    causation_id: options.causationId ?? null,
    idempotency_key: options.idempotencyKey ?? null,
    ...payload,
  };

  await appendJsonl(runtimePath(root, "events", "events.jsonl"), event);
  return event;
}
