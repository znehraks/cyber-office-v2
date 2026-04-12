import {
  expectRecord,
  expectString,
  parseStringRecord,
  parseUnknownRecord,
  readArray,
  readBoolean,
  readEnum,
  readNumber,
  readObject,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalObject,
  readOptionalString,
  readOptionalStringArray,
  readString,
  readStringArray,
} from "../lib/validation.js";

export type Priority = "P0" | "P1" | "P2" | "P3";
export type Tier = "low" | "standard" | "high" | "admin";
export type RoleKind = "control" | "utility" | "high" | "specialist";
export type RoleModel = "haiku" | "sonnet" | "opus";
export type RoleEffort = "low" | "medium" | "high";
export type RoutingCategory =
  | "quick"
  | "research"
  | "standard"
  | "architecture"
  | "critique"
  | "visual"
  | "visual-high"
  | "high-risk";
export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stalled";
export type IngressClaimStatus =
  | "claimed"
  | "materialized"
  | "failed"
  | "recovered";
export type EpicStatus = "open" | "paused" | "closed";
export type OutcomeKind =
  | "research_brief"
  | "plan_package"
  | "design_package"
  | "code_change";
export type PreMissionClaimStatus =
  | "claimed"
  | "awaiting_workspace"
  | "materialized"
  | "expired"
  | "cancelled";
export type PendingWorkspaceStatus =
  | "pending"
  | "resolved"
  | "expired"
  | "cancelled";

const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];
const JOB_STATUSES: JobStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "stalled",
];
const CLAIM_STATUSES: IngressClaimStatus[] = [
  "claimed",
  "materialized",
  "failed",
  "recovered",
];
const EPIC_STATUSES: EpicStatus[] = ["open", "paused", "closed"];
const OUTCOME_KINDS: OutcomeKind[] = [
  "research_brief",
  "plan_package",
  "design_package",
  "code_change",
];
const PRE_MISSION_CLAIM_STATUSES: PreMissionClaimStatus[] = [
  "claimed",
  "awaiting_workspace",
  "materialized",
  "expired",
  "cancelled",
];
const PENDING_WORKSPACE_STATUSES: PendingWorkspaceStatus[] = [
  "pending",
  "resolved",
  "expired",
  "cancelled",
];
const ROLE_KINDS: RoleKind[] = ["control", "utility", "high", "specialist"];
const ROLE_MODELS: RoleModel[] = ["haiku", "sonnet", "opus"];
const ROLE_TIERS: Tier[] = ["low", "standard", "high", "admin"];
const ROLE_EFFORTS: RoleEffort[] = ["low", "medium", "high"];

export interface ThreadRef {
  chatId: string;
  messageId: string;
}

export interface ThreadMissionBinding {
  chat_id: string;
  mission_id: string;
  updated_at: string;
}

export interface ProjectRegistryEntry {
  project_slug: string;
  display_name: string;
  discord_channel_id: string;
  obsidian_rel_dir: string;
}

export interface ProjectRegistryFile {
  projects: ProjectRegistryEntry[];
}

export interface ProjectRef extends ProjectRegistryEntry {
  obsidian_project_dir: string;
}

export interface EpicRecord {
  epic_id: string;
  project_slug: string;
  title: string;
  slug: string;
  discord_thread_id: string;
  status: EpicStatus;
  active_mission_id: string | null;
  obsidian_note_ref: string;
  created_at: string;
  updated_at: string;
}

export interface EpicThreadIndex {
  discord_thread_id: string;
  epic_id: string;
  updated_at: string;
}

export interface EpicSlugIndex {
  project_slug: string;
  epic_slug: string;
  epic_id: string;
  updated_at: string;
}

export interface PendingEpicResolutionCandidate {
  epic_id: string;
  title: string;
  slug: string;
  discord_thread_id: string;
}

export interface PendingEpicResolution {
  resolution_id: string;
  project_slug: string;
  channel_id: string;
  source_message_id: string;
  requesting_user_id: string;
  epic_title: string;
  request_body: string;
  request_text: string;
  candidates: PendingEpicResolutionCandidate[];
  requested_at: string;
  expires_at: string;
  updated_at: string;
}

export interface PreMissionClaim {
  canonical_key: string;
  key_hash: string;
  source: string;
  event_type: string;
  upstream_event_id: string;
  channel_id: string;
  requesting_user_id: string;
  status: PreMissionClaimStatus;
  created_at: string;
  updated_at: string;
  workspace_request_id: string | null;
  mission_id: string | null;
}

export interface PendingWorkspaceRequest {
  workspace_request_id: string;
  project_slug: string;
  epic_id: string;
  epic_thread_id: string;
  requesting_user_id: string;
  source_message_id: string;
  original_request: string;
  outcome_kind: OutcomeKind;
  status: PendingWorkspaceStatus;
  workspace_path: string | null;
  requested_at: string;
  expires_at: string;
  updated_at: string;
}

export interface QueuedFollowUp {
  epic_thread_id: string;
  requesting_user_id: string;
  request_text: string;
  queued_at: string;
  updated_at: string;
}

export interface MissionBacklogItem {
  id: string | null;
  title: string;
  priority: Priority;
  status: string;
}

export interface MissionCloseout {
  status: string;
  status_required: boolean;
  next_steps_required: boolean;
  obsidian_note_required: boolean;
  required_reports: string[];
}

export interface Mission {
  mission_id: string;
  source: string;
  ingress_key: string | null;
  thread_ref: ThreadRef | null;
  project_ref: ProjectRef;
  epic_ref: EpicRecord;
  user_request: string;
  status: string;
  category: string;
  owner: string;
  priority_floor: Priority;
  created_at: string;
  updated_at: string;
  active_job_ids: string[];
  completed_job_ids: string[];
  failed_job_ids: string[];
  backlog: MissionBacklogItem[];
  final_artifacts: string[];
  closeout: MissionCloseout;
}

export interface MissionInput {
  missionId?: string | undefined;
  source?: string | undefined;
  ingressKey?: string | null | undefined;
  threadRef?: ThreadRef | null | undefined;
  projectRef?: ProjectRef | undefined;
  epicRef?: EpicRecord | undefined;
  userRequest: string;
  status?: string | undefined;
  category: string;
  owner?: string | undefined;
  priorityFloor: Priority;
  now?: string | undefined;
  activeJobIds?: string[] | undefined;
  completedJobIds?: string[] | undefined;
  failedJobIds?: string[] | undefined;
  backlog?: MissionBacklogItem[] | undefined;
  finalArtifacts?: string[] | undefined;
  closeout?: Partial<MissionCloseout> | undefined;
}

export interface JobInputShape {
  task: string;
  deliverable: string;
  constraints: string[];
  input_refs: string[];
}

export interface Job {
  job_id: string;
  base_job_id: string;
  mission_id: string;
  worker: string;
  model: string;
  tier: Tier;
  job_key: string;
  status: JobStatus;
  category: string;
  priority: Priority;
  attempt_no: number;
  input: JobInputShape;
  artifacts: string[];
  handoff_requests: string[];
  created_at: string;
  started_at: string | null;
  heartbeat_at: string | null;
  progress_at: string | null;
  finished_at: string | null;
  retry_count: number;
  max_retries: number;
  worker_pid_ref: string;
  packet_ref: string;
  report_status: Record<string, string>;
  retry_of: string | null;
  error?: string;
}

export interface CreateJobSpec {
  missionId: string;
  worker: string;
  category: string;
  priority: Priority;
  task: string;
  deliverable: string;
  constraints?: string[] | undefined;
  inputRefs?: string[] | undefined;
  jobKey?: string | undefined;
  attemptNo?: number | undefined;
  baseJobId?: string | undefined;
  retryCount?: number | undefined;
  maxRetries?: number | undefined;
  retryOf?: string | null | undefined;
  now?: string | undefined;
}

export interface PacketManifest {
  required_refs: string[];
  optional_refs: string[];
  code_refs: string[];
  acceptance_checks: string[];
  open_questions: string[];
  allowed_write_roots: string[];
  working_dir: string;
  outcome_kind?: OutcomeKind | undefined;
  canonical_deliverable_name?: string | undefined;
}

export interface JobKeyIndex {
  job_id: string;
  job_key: string;
}

export interface IngressPayload {
  source: string;
  eventType: string;
  upstreamEventId: string;
  threadRef?: ThreadRef | null | undefined;
  projectRef?: ProjectRef | undefined;
  epicRef?: EpicRecord | undefined;
  userRequest?: string | undefined;
  category?: string | undefined;
  priorityFloor?: Priority | undefined;
  firstSeenAt?: string | undefined;
  claimLeaseMs?: number | undefined;
  now?: string | undefined;
}

export interface IngressClaim {
  canonical_key: string;
  key_hash: string;
  source: string;
  event_type: string;
  upstream_event_id: string;
  status: IngressClaimStatus;
  mission_id: string;
  event_id: string;
  first_seen_at: string;
  leased_at: string;
  lease_expires_at: string;
  materialized_at: string | null;
  recovered_at: string | null;
  updated_at: string;
}

export interface ClaimIngressResult extends IngressClaim {
  created: boolean;
  keyHash: string;
}

export interface IngestResult {
  missionId: string;
  ingressKey: string;
  duplicate: boolean;
}

export interface ResultFile {
  outcome_kind: OutcomeKind;
  result_summary: string;
  completed_items: string[];
  remaining_work: string[];
  risks: string[];
  deliverable_refs: string[];
  key_findings?: string[] | undefined;
  recommended_next_steps?: string[] | undefined;
  documents_created?: string[] | undefined;
  decisions_made?: string[] | undefined;
  open_questions?: string[] | undefined;
  design_decisions?: string[] | undefined;
  handoff_notes?: string[] | undefined;
  workspace_ref?: string | undefined;
  changed_paths?: string[] | undefined;
  verification?: string[] | undefined;
  follow_up_tasks?: string[] | undefined;
}

export interface ReportInput {
  missionId: string;
  reportKey: string;
  stage: string;
  role: string;
  tier: string;
  assigneeRole?: string | undefined;
  assigneeTier?: string | undefined;
  requestBrief: string;
  requestSummary: string;
  snapshot: string;
  completed: string;
  transitionReason: string;
  next: string;
  evidence?: string | null | undefined;
  findings?: string | undefined;
}

export interface ReportRecord {
  reportId: string;
  mission_id: string;
  report_key: string;
  stage: string;
  role: string;
  tier: string;
  assignee_role: string | null;
  assignee_tier: string | null;
  request_brief: string;
  request_summary: string;
  snapshot: string;
  completed: string;
  transition_reason: string;
  findings: string;
  next: string;
  evidence: string | null;
  content: string;
  duplicate: boolean;
}

export interface CloseoutFile {
  status: string;
  obsidian_note_ref: string;
  completed_items: string[];
  next_steps: string[];
}

export interface EventRecord extends Record<string, unknown> {
  event_id: string;
  ts: string;
  event: string;
  causation_id: string | null;
  idempotency_key: string | null;
}

export interface AppendEventOptions {
  now?: string | undefined;
  eventId?: string | undefined;
  causationId?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface SupervisorLease {
  owner_pid: string;
  leased_at: string;
  lease_expires_at: string;
  taken_over: boolean;
}

export interface SupervisorLeaseOptions {
  ownerPid: string;
  now?: string | undefined;
  leaseMs?: number | undefined;
  isOwnerAlive?: ((ownerPid: string) => boolean) | undefined;
}

export interface SupervisorTickOptions extends SupervisorLeaseOptions {
  staleIngressAfterMs?: number | undefined;
  staleAfterMs?: number | undefined;
}

export interface RoleDefinition {
  name: string;
  kind: RoleKind;
  model: RoleModel;
  tier: Tier;
  effort: RoleEffort;
  sourceRole: string;
  description: string;
}

export interface RoleRegistryFile {
  legacy_roles: string[];
  allowed_high_roles: string[];
  routing_rules: Record<string, string>;
  roles: RoleDefinition[];
}

export interface McpConfig {
  mcpServers: Record<string, unknown>;
}

export interface RoutingDecision {
  category: RoutingCategory;
  worker: string;
  tier: Tier;
  rationale: string;
}

export interface GodCommand {
  command: "status" | "doctor" | "supervisor";
  args: string[];
}

export interface WorkerRunResult {
  status: "completed";
  jobId: string;
  artifactDir: string;
  summaryPath: string;
}

export interface SmokeOptions {
  claudeBin?: string | undefined;
  extraArgs?: string[] | undefined;
  now?: string | undefined;
  messageId?: string | undefined;
  request?: string | undefined;
}

export interface ExecuteMissionOptions {
  source?: string | undefined;
  eventType?: string | undefined;
  messageId?: string | undefined;
  chatId?: string | undefined;
  request?: string | undefined;
  projectRef?: ProjectRef | undefined;
  epicRef?: EpicRecord | undefined;
  claudeBin?: string | undefined;
  extraArgs?: string[] | undefined;
  now?: string | undefined;
  onReport?: ((report: ReportRecord) => Promise<void>) | undefined;
  outcomeKind?: OutcomeKind | undefined;
  workspacePath?: string | undefined;
  testScenario?: "retry-once" | undefined;
}

export function parseThreadRef(value: unknown): ThreadRef {
  const record = expectRecord(value, "thread_ref");
  return {
    chatId: readString(record, "chatId", "thread_ref"),
    messageId: readString(record, "messageId", "thread_ref"),
  };
}

export function parseThreadMissionBinding(
  value: unknown,
): ThreadMissionBinding {
  const record = expectRecord(value, "thread_mission_binding");
  return {
    chat_id: readString(record, "chat_id", "thread_mission_binding"),
    mission_id: readString(record, "mission_id", "thread_mission_binding"),
    updated_at: readString(record, "updated_at", "thread_mission_binding"),
  };
}

export function parseProjectRegistryEntry(
  value: unknown,
): ProjectRegistryEntry {
  const record = expectRecord(value, "project_registry_entry");
  return {
    project_slug: readString(record, "project_slug", "project_registry_entry"),
    display_name: readString(record, "display_name", "project_registry_entry"),
    discord_channel_id: readString(
      record,
      "discord_channel_id",
      "project_registry_entry",
    ),
    obsidian_rel_dir: readString(
      record,
      "obsidian_rel_dir",
      "project_registry_entry",
    ),
  };
}

export function parseProjectRegistryFile(value: unknown): ProjectRegistryFile {
  const record = expectRecord(value, "project_registry");
  return {
    projects: readArray(record, "projects", "project_registry", (item) =>
      parseProjectRegistryEntry(item),
    ),
  };
}

export function parseProjectRef(value: unknown): ProjectRef {
  const record = expectRecord(value, "project_ref");
  return {
    project_slug: readString(record, "project_slug", "project_ref"),
    display_name: readString(record, "display_name", "project_ref"),
    discord_channel_id: readString(record, "discord_channel_id", "project_ref"),
    obsidian_rel_dir: readString(record, "obsidian_rel_dir", "project_ref"),
    obsidian_project_dir: readString(
      record,
      "obsidian_project_dir",
      "project_ref",
    ),
  };
}

export function parseEpicRecord(value: unknown): EpicRecord {
  const record = expectRecord(value, "epic");
  return {
    epic_id: readString(record, "epic_id", "epic"),
    project_slug: readString(record, "project_slug", "epic"),
    title: readString(record, "title", "epic"),
    slug: readString(record, "slug", "epic"),
    discord_thread_id: readString(record, "discord_thread_id", "epic"),
    status: readEnum(record, "status", EPIC_STATUSES, "epic"),
    active_mission_id: readOptionalString(record, "active_mission_id", "epic"),
    obsidian_note_ref: readString(record, "obsidian_note_ref", "epic"),
    created_at: readString(record, "created_at", "epic"),
    updated_at: readString(record, "updated_at", "epic"),
  };
}

export function parseEpicThreadIndex(value: unknown): EpicThreadIndex {
  const record = expectRecord(value, "epic_thread_index");
  return {
    discord_thread_id: readString(
      record,
      "discord_thread_id",
      "epic_thread_index",
    ),
    epic_id: readString(record, "epic_id", "epic_thread_index"),
    updated_at: readString(record, "updated_at", "epic_thread_index"),
  };
}

export function parseEpicSlugIndex(value: unknown): EpicSlugIndex {
  const record = expectRecord(value, "epic_slug_index");
  return {
    project_slug: readString(record, "project_slug", "epic_slug_index"),
    epic_slug: readString(record, "epic_slug", "epic_slug_index"),
    epic_id: readString(record, "epic_id", "epic_slug_index"),
    updated_at: readString(record, "updated_at", "epic_slug_index"),
  };
}

export function parsePendingEpicResolutionCandidate(
  value: unknown,
): PendingEpicResolutionCandidate {
  const record = expectRecord(value, "pending_epic_resolution_candidate");
  return {
    epic_id: readString(record, "epic_id", "pending_epic_resolution_candidate"),
    title: readString(record, "title", "pending_epic_resolution_candidate"),
    slug: readString(record, "slug", "pending_epic_resolution_candidate"),
    discord_thread_id: readString(
      record,
      "discord_thread_id",
      "pending_epic_resolution_candidate",
    ),
  };
}

export function parsePendingEpicResolution(
  value: unknown,
): PendingEpicResolution {
  const record = expectRecord(value, "pending_epic_resolution");
  return {
    resolution_id: readString(
      record,
      "resolution_id",
      "pending_epic_resolution",
    ),
    project_slug: readString(record, "project_slug", "pending_epic_resolution"),
    channel_id: readString(record, "channel_id", "pending_epic_resolution"),
    source_message_id: readString(
      record,
      "source_message_id",
      "pending_epic_resolution",
    ),
    requesting_user_id: readString(
      record,
      "requesting_user_id",
      "pending_epic_resolution",
    ),
    epic_title: readString(record, "epic_title", "pending_epic_resolution"),
    request_body: readString(record, "request_body", "pending_epic_resolution"),
    request_text: readString(record, "request_text", "pending_epic_resolution"),
    candidates: readArray(
      record,
      "candidates",
      "pending_epic_resolution",
      (item) => parsePendingEpicResolutionCandidate(item),
    ),
    requested_at: readString(record, "requested_at", "pending_epic_resolution"),
    expires_at: readString(record, "expires_at", "pending_epic_resolution"),
    updated_at: readString(record, "updated_at", "pending_epic_resolution"),
  };
}

export function parsePreMissionClaim(value: unknown): PreMissionClaim {
  const record = expectRecord(value, "pre_mission_claim");
  return {
    canonical_key: readString(record, "canonical_key", "pre_mission_claim"),
    key_hash: readString(record, "key_hash", "pre_mission_claim"),
    source: readString(record, "source", "pre_mission_claim"),
    event_type: readString(record, "event_type", "pre_mission_claim"),
    upstream_event_id: readString(
      record,
      "upstream_event_id",
      "pre_mission_claim",
    ),
    channel_id: readString(record, "channel_id", "pre_mission_claim"),
    requesting_user_id: readString(
      record,
      "requesting_user_id",
      "pre_mission_claim",
    ),
    status: readEnum(
      record,
      "status",
      PRE_MISSION_CLAIM_STATUSES,
      "pre_mission_claim",
    ),
    created_at: readString(record, "created_at", "pre_mission_claim"),
    updated_at: readString(record, "updated_at", "pre_mission_claim"),
    workspace_request_id: readOptionalString(
      record,
      "workspace_request_id",
      "pre_mission_claim",
    ),
    mission_id: readOptionalString(record, "mission_id", "pre_mission_claim"),
  };
}

export function parsePendingWorkspaceRequest(
  value: unknown,
): PendingWorkspaceRequest {
  const record = expectRecord(value, "pending_workspace_request");
  return {
    workspace_request_id: readString(
      record,
      "workspace_request_id",
      "pending_workspace_request",
    ),
    project_slug: readString(
      record,
      "project_slug",
      "pending_workspace_request",
    ),
    epic_id: readString(record, "epic_id", "pending_workspace_request"),
    epic_thread_id: readString(
      record,
      "epic_thread_id",
      "pending_workspace_request",
    ),
    requesting_user_id: readString(
      record,
      "requesting_user_id",
      "pending_workspace_request",
    ),
    source_message_id: readString(
      record,
      "source_message_id",
      "pending_workspace_request",
    ),
    original_request: readString(
      record,
      "original_request",
      "pending_workspace_request",
    ),
    outcome_kind: readEnum(
      record,
      "outcome_kind",
      OUTCOME_KINDS,
      "pending_workspace_request",
    ),
    status: readEnum(
      record,
      "status",
      PENDING_WORKSPACE_STATUSES,
      "pending_workspace_request",
    ),
    workspace_path: readOptionalString(
      record,
      "workspace_path",
      "pending_workspace_request",
    ),
    requested_at: readString(
      record,
      "requested_at",
      "pending_workspace_request",
    ),
    expires_at: readString(record, "expires_at", "pending_workspace_request"),
    updated_at: readString(record, "updated_at", "pending_workspace_request"),
  };
}

export function parseQueuedFollowUp(value: unknown): QueuedFollowUp {
  const record = expectRecord(value, "queued_follow_up");
  return {
    epic_thread_id: readString(record, "epic_thread_id", "queued_follow_up"),
    requesting_user_id: readString(
      record,
      "requesting_user_id",
      "queued_follow_up",
    ),
    request_text: readString(record, "request_text", "queued_follow_up"),
    queued_at: readString(record, "queued_at", "queued_follow_up"),
    updated_at: readString(record, "updated_at", "queued_follow_up"),
  };
}

export function parseMissionBacklogItem(value: unknown): MissionBacklogItem {
  const record = expectRecord(value, "backlog_item");
  return {
    id: readOptionalString(record, "id", "backlog_item"),
    title: readString(record, "title", "backlog_item"),
    priority: readEnum(record, "priority", PRIORITIES, "backlog_item"),
    status: readString(record, "status", "backlog_item"),
  };
}

export function parseMissionCloseout(value: unknown): MissionCloseout {
  const record = expectRecord(value, "mission.closeout");
  return {
    status: readString(record, "status", "mission.closeout"),
    status_required: readBoolean(record, "status_required", "mission.closeout"),
    next_steps_required: readBoolean(
      record,
      "next_steps_required",
      "mission.closeout",
    ),
    obsidian_note_required: readBoolean(
      record,
      "obsidian_note_required",
      "mission.closeout",
    ),
    required_reports: readStringArray(
      record,
      "required_reports",
      "mission.closeout",
    ),
  };
}

export function parseMission(value: unknown): Mission {
  const record = expectRecord(value, "mission");
  return {
    mission_id: readString(record, "mission_id", "mission"),
    source: readString(record, "source", "mission"),
    ingress_key: readOptionalString(record, "ingress_key", "mission"),
    thread_ref: readOptionalObject(
      record,
      "thread_ref",
      "mission",
      parseThreadRef,
    ),
    project_ref: readObject(record, "project_ref", "mission", parseProjectRef),
    epic_ref: readObject(record, "epic_ref", "mission", parseEpicRecord),
    user_request: readString(record, "user_request", "mission"),
    status: readString(record, "status", "mission"),
    category: readString(record, "category", "mission"),
    owner: readString(record, "owner", "mission"),
    priority_floor: readEnum(record, "priority_floor", PRIORITIES, "mission"),
    created_at: readString(record, "created_at", "mission"),
    updated_at: readString(record, "updated_at", "mission"),
    active_job_ids: readStringArray(record, "active_job_ids", "mission"),
    completed_job_ids: readStringArray(record, "completed_job_ids", "mission"),
    failed_job_ids: readStringArray(record, "failed_job_ids", "mission"),
    backlog: readArray(record, "backlog", "mission", (item) =>
      parseMissionBacklogItem(item),
    ),
    final_artifacts: readStringArray(record, "final_artifacts", "mission"),
    closeout: readObject(record, "closeout", "mission", parseMissionCloseout),
  };
}

export function parseJobInput(value: unknown): JobInputShape {
  const record = expectRecord(value, "job.input");
  return {
    task: readString(record, "task", "job.input"),
    deliverable: readString(record, "deliverable", "job.input"),
    constraints: readOptionalStringArray(record, "constraints", "job.input"),
    input_refs: readOptionalStringArray(record, "input_refs", "job.input"),
  };
}

export function parseJob(value: unknown): Job {
  const record = expectRecord(value, "job");
  const error = readOptionalString(record, "error", "job");
  const parsed: Job = {
    job_id: readString(record, "job_id", "job"),
    base_job_id: readString(record, "base_job_id", "job"),
    mission_id: readString(record, "mission_id", "job"),
    worker: readString(record, "worker", "job"),
    model: readString(record, "model", "job"),
    tier: readEnum(record, "tier", ROLE_TIERS, "job"),
    job_key: readString(record, "job_key", "job"),
    status: readEnum(record, "status", JOB_STATUSES, "job"),
    category: readString(record, "category", "job"),
    priority: readEnum(record, "priority", PRIORITIES, "job"),
    attempt_no: readNumber(record, "attempt_no", "job"),
    input: readObject(record, "input", "job", parseJobInput),
    artifacts: readOptionalStringArray(record, "artifacts", "job"),
    handoff_requests: readOptionalStringArray(
      record,
      "handoff_requests",
      "job",
    ),
    created_at: readString(record, "created_at", "job"),
    started_at: readOptionalString(record, "started_at", "job"),
    heartbeat_at: readOptionalString(record, "heartbeat_at", "job"),
    progress_at: readOptionalString(record, "progress_at", "job"),
    finished_at: readOptionalString(record, "finished_at", "job"),
    retry_count: readNumber(record, "retry_count", "job"),
    max_retries: readNumber(record, "max_retries", "job"),
    worker_pid_ref: readString(record, "worker_pid_ref", "job"),
    packet_ref: readString(record, "packet_ref", "job"),
    report_status: parseStringRecord(
      record["report_status"],
      "job.report_status",
    ),
    retry_of: readOptionalString(record, "retry_of", "job"),
  };

  if (error !== null) {
    parsed.error = error;
  }
  return parsed;
}

export function parsePacketManifest(value: unknown): PacketManifest {
  const record = expectRecord(value, "packet");
  return {
    required_refs: readStringArray(record, "required_refs", "packet"),
    optional_refs: readOptionalStringArray(record, "optional_refs", "packet"),
    code_refs: readOptionalStringArray(record, "code_refs", "packet"),
    acceptance_checks: readOptionalStringArray(
      record,
      "acceptance_checks",
      "packet",
    ),
    open_questions: readOptionalStringArray(record, "open_questions", "packet"),
    allowed_write_roots: readOptionalStringArray(
      record,
      "allowed_write_roots",
      "packet",
    ),
    working_dir: readString(record, "working_dir", "packet"),
    outcome_kind:
      readOptionalString(record, "outcome_kind", "packet") === null
        ? undefined
        : readEnum(record, "outcome_kind", OUTCOME_KINDS, "packet"),
    canonical_deliverable_name:
      readOptionalString(record, "canonical_deliverable_name", "packet") ??
      undefined,
  };
}

export function parseJobKeyIndex(value: unknown): JobKeyIndex {
  const record = expectRecord(value, "job_key_index");
  return {
    job_id: readString(record, "job_id", "job_key_index"),
    job_key: readString(record, "job_key", "job_key_index"),
  };
}

export function parseIngressClaim(value: unknown): IngressClaim {
  const record = expectRecord(value, "ingress_claim");
  return {
    canonical_key: readString(record, "canonical_key", "ingress_claim"),
    key_hash: readString(record, "key_hash", "ingress_claim"),
    source: readString(record, "source", "ingress_claim"),
    event_type: readString(record, "event_type", "ingress_claim"),
    upstream_event_id: readString(record, "upstream_event_id", "ingress_claim"),
    status: readEnum(record, "status", CLAIM_STATUSES, "ingress_claim"),
    mission_id: readString(record, "mission_id", "ingress_claim"),
    event_id: readString(record, "event_id", "ingress_claim"),
    first_seen_at: readString(record, "first_seen_at", "ingress_claim"),
    leased_at: readString(record, "leased_at", "ingress_claim"),
    lease_expires_at: readString(record, "lease_expires_at", "ingress_claim"),
    materialized_at: readOptionalString(
      record,
      "materialized_at",
      "ingress_claim",
    ),
    recovered_at: readOptionalString(record, "recovered_at", "ingress_claim"),
    updated_at: readString(record, "updated_at", "ingress_claim"),
  };
}

export function parseReportRecord(value: unknown): ReportRecord {
  const record = expectRecord(value, "report");
  const stage = readString(record, "stage", "report");
  const completed = readString(record, "completed", "report");
  const findings = readOptionalString(record, "findings", "report") ?? "";
  const next = readString(record, "next", "report");
  const requestBrief =
    readOptionalString(record, "request_brief", "report") ?? stage;
  const requestSummary =
    readOptionalString(record, "request_summary", "report") ?? completed;
  const transitionReason =
    readOptionalString(record, "transition_reason", "report") ??
    (findings === "" ? next : findings);
  const evidence = readOptionalString(record, "evidence", "report");
  const snapshot =
    readOptionalString(record, "snapshot", "report") ??
    `${stage} 단계 진행 상황입니다. ${transitionReason}`;
  return {
    reportId: readString(record, "reportId", "report"),
    mission_id: readString(record, "mission_id", "report"),
    report_key: readString(record, "report_key", "report"),
    stage,
    role: readString(record, "role", "report"),
    tier: readString(record, "tier", "report"),
    assignee_role: readOptionalString(record, "assignee_role", "report"),
    assignee_tier: readOptionalString(record, "assignee_tier", "report"),
    request_brief: requestBrief,
    request_summary: requestSummary,
    snapshot,
    completed,
    transition_reason: transitionReason,
    findings,
    next,
    evidence,
    content: readString(record, "content", "report"),
    duplicate: readBoolean(record, "duplicate", "report"),
  };
}

export function parseCloseoutFile(value: unknown): CloseoutFile {
  const record = expectRecord(value, "closeout");
  return {
    status: readString(record, "status", "closeout"),
    obsidian_note_ref: readString(record, "obsidian_note_ref", "closeout"),
    completed_items: readOptionalStringArray(
      record,
      "completed_items",
      "closeout",
    ),
    next_steps: readOptionalStringArray(record, "next_steps", "closeout"),
  };
}

export function parseResultFile(value: unknown): ResultFile {
  const record = expectRecord(value, "result");
  return {
    outcome_kind: readEnum(record, "outcome_kind", OUTCOME_KINDS, "result"),
    result_summary: readString(record, "result_summary", "result"),
    completed_items: readStringArray(record, "completed_items", "result"),
    remaining_work: readOptionalStringArray(record, "remaining_work", "result"),
    risks: readOptionalStringArray(record, "risks", "result"),
    deliverable_refs: readStringArray(record, "deliverable_refs", "result"),
    key_findings: readOptionalStringArray(record, "key_findings", "result"),
    recommended_next_steps: readOptionalStringArray(
      record,
      "recommended_next_steps",
      "result",
    ),
    documents_created: readOptionalStringArray(
      record,
      "documents_created",
      "result",
    ),
    decisions_made: readOptionalStringArray(record, "decisions_made", "result"),
    open_questions: readOptionalStringArray(record, "open_questions", "result"),
    design_decisions: readOptionalStringArray(
      record,
      "design_decisions",
      "result",
    ),
    handoff_notes: readOptionalStringArray(record, "handoff_notes", "result"),
    workspace_ref:
      readOptionalString(record, "workspace_ref", "result") ?? undefined,
    changed_paths: readOptionalStringArray(record, "changed_paths", "result"),
    verification: readOptionalStringArray(record, "verification", "result"),
    follow_up_tasks: readOptionalStringArray(
      record,
      "follow_up_tasks",
      "result",
    ),
  };
}

export function parseSupervisorLease(value: unknown): SupervisorLease {
  const record = expectRecord(value, "supervisor_lease");
  return {
    owner_pid: readString(record, "owner_pid", "supervisor_lease"),
    leased_at: readString(record, "leased_at", "supervisor_lease"),
    lease_expires_at: readString(
      record,
      "lease_expires_at",
      "supervisor_lease",
    ),
    taken_over: readBoolean(record, "taken_over", "supervisor_lease"),
  };
}

export function parseRoleDefinition(value: unknown): RoleDefinition {
  const record = expectRecord(value, "role");
  return {
    name: readString(record, "name", "role"),
    kind: readEnum(record, "kind", ROLE_KINDS, "role"),
    model: readEnum(record, "model", ROLE_MODELS, "role"),
    tier: readEnum(record, "tier", ROLE_TIERS, "role"),
    effort: readEnum(record, "effort", ROLE_EFFORTS, "role"),
    sourceRole: readString(record, "sourceRole", "role"),
    description: readString(record, "description", "role"),
  };
}

export function parseRoleRegistryFile(value: unknown): RoleRegistryFile {
  const record = expectRecord(value, "role_registry");
  return {
    legacy_roles: readStringArray(record, "legacy_roles", "role_registry"),
    allowed_high_roles: readStringArray(
      record,
      "allowed_high_roles",
      "role_registry",
    ),
    routing_rules: parseStringRecord(
      record["routing_rules"],
      "role_registry.routing_rules",
    ),
    roles: readArray(record, "roles", "role_registry", (item) =>
      parseRoleDefinition(item),
    ),
  };
}

export function parseMcpConfig(value: unknown): McpConfig {
  const record = expectRecord(value, "mcp_config");
  const mcpServersValue = record["mcpServers"];
  const mcpServers =
    mcpServersValue === undefined
      ? {}
      : parseUnknownRecord(mcpServersValue, "mcp_config.mcpServers");
  return { mcpServers };
}

export function parseStringListFile(value: unknown, label: string): string[] {
  const record = expectRecord(value, label);
  return readArray(record, "items", label, (item) =>
    expectString(item, `${label}.items`),
  );
}
