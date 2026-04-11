import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  ClaimIngressResult,
  IngestResult,
  IngressClaim,
  IngressPayload,
  Mission,
} from "../types/domain.js";
import { parseIngressClaim } from "../types/domain.js";
import { appendEvent } from "./events.js";
import { createMission, readMission, upsertMission } from "./missions.js";
import {
  createStampedId,
  exists,
  hashValue,
  nowIso,
  openExclusive,
  readJson,
  runtimePath,
  writeJson,
} from "./runtime.js";

export function createIngressKey({
  source,
  eventType,
  upstreamEventId,
}: Pick<IngressPayload, "source" | "eventType" | "upstreamEventId">): string {
  return `v1:${source}:${eventType}:${upstreamEventId}`;
}

function ingressClaimFile(root: string, keyHash: string): string {
  return runtimePath(root, "ingress", `${keyHash}.json`);
}

function buildClaimRecord(input: IngressPayload): IngressClaim {
  const canonicalKey = createIngressKey(input);
  const firstSeenAt = nowIso(input.firstSeenAt);
  const keyHash = hashValue(canonicalKey);
  const leaseMs = input.claimLeaseMs ?? 60_000;
  const missionId = createStampedId("mission", canonicalKey, firstSeenAt);
  const eventId = createStampedId("event", canonicalKey, firstSeenAt);

  return {
    canonical_key: canonicalKey,
    key_hash: keyHash,
    source: input.source,
    event_type: input.eventType,
    upstream_event_id: input.upstreamEventId,
    status: "claimed",
    mission_id: missionId,
    event_id: eventId,
    first_seen_at: firstSeenAt,
    leased_at: firstSeenAt,
    lease_expires_at: new Date(Date.parse(firstSeenAt) + leaseMs).toISOString(),
    materialized_at: null,
    recovered_at: null,
    updated_at: firstSeenAt,
  };
}

export async function claimIngress(
  root: string,
  input: IngressPayload,
): Promise<ClaimIngressResult> {
  const claim = buildClaimRecord(input);
  const claimPath = ingressClaimFile(root, claim.key_hash);

  try {
    const handle = await openExclusive(claimPath);
    await handle.writeFile(`${JSON.stringify(claim, null, 2)}\n`, "utf8");
    await handle.close();
    return { ...claim, created: true, keyHash: claim.key_hash };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    ) {
      throw error;
    }

    const existing = await readJson(claimPath, parseIngressClaim);
    return { ...existing, created: false, keyHash: existing.key_hash };
  }
}

export async function ingestIngressEvent(
  root: string,
  payload: IngressPayload,
): Promise<IngestResult> {
  const claim = await claimIngress(root, payload);
  const existingMission: Mission | null = await readMission(
    root,
    claim.mission_id,
  );
  const duplicate = !claim.created;

  if (!existingMission) {
    const mission = createMission({
      missionId: claim.mission_id,
      ingressKey: claim.canonical_key,
      source: payload.source,
      threadRef: payload.threadRef ?? null,
      userRequest: payload.userRequest ?? "",
      category: payload.category ?? "standard",
      priorityFloor: payload.priorityFloor ?? "P1",
      now: payload.now,
    });
    await upsertMission(root, mission, { now: payload.now });

    const materialized: IngressClaim = {
      ...claim,
      status: "materialized",
      materialized_at: nowIso(payload.now),
      updated_at: nowIso(payload.now),
    };
    await writeJson(ingressClaimFile(root, claim.key_hash), materialized);
    await appendEvent(
      root,
      "ingress.materialized",
      {
        mission_id: mission.mission_id,
        event_id: claim.event_id,
        ingress_key: claim.canonical_key,
      },
      { now: payload.now, idempotencyKey: claim.canonical_key },
    );
    return {
      missionId: mission.mission_id,
      ingressKey: claim.canonical_key,
      duplicate,
    };
  }

  return {
    missionId: existingMission.mission_id,
    ingressKey: claim.canonical_key,
    duplicate: true,
  };
}

export async function recoverStaleIngressClaims(
  root: string,
  options: { staleAfterMs?: number; now?: string } = {},
): Promise<IngressClaim[]> {
  const ingressDir = runtimePath(root, "ingress");
  const files = await fs.readdir(ingressDir);
  const staleAfterMs = options.staleAfterMs ?? 60_000;
  const now = Date.parse(nowIso(options.now));
  const recovered: IngressClaim[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }

    const claimPath = path.join(ingressDir, file);
    const claim = await readJson(claimPath, parseIngressClaim, null);
    if (!claim || claim.status !== "claimed") {
      continue;
    }

    const leaseExpires = Date.parse(
      claim.lease_expires_at ?? claim.first_seen_at,
    );
    const firstSeen = Date.parse(claim.first_seen_at);
    const expired = !Number.isNaN(leaseExpires) && leaseExpires <= now;
    const staleByAge =
      !Number.isNaN(firstSeen) && now - firstSeen >= staleAfterMs;
    if (!expired && !staleByAge) {
      continue;
    }

    const next: IngressClaim = {
      ...claim,
      status: "recovered",
      recovered_at: nowIso(options.now),
      updated_at: nowIso(options.now),
    };
    await writeJson(claimPath, next);
    recovered.push(next);
  }

  return recovered;
}
