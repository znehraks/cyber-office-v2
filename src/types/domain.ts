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
const ROLE_KINDS: RoleKind[] = ["control", "utility", "high", "specialist"];
const ROLE_MODELS: RoleModel[] = ["haiku", "sonnet", "opus"];
const ROLE_TIERS: Tier[] = ["low", "standard", "high", "admin"];
const ROLE_EFFORTS: RoleEffort[] = ["low", "medium", "high"];

export interface ThreadRef {
  chatId: string;
  messageId: string;
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

export interface ReportInput {
  missionId: string;
  reportKey: string;
  stage: string;
  role: string;
  tier: string;
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
  claudeBin?: string | undefined;
  extraArgs?: string[] | undefined;
  now?: string | undefined;
  onReport?: ((report: ReportRecord) => Promise<void>) | undefined;
}

export function parseThreadRef(value: unknown): ThreadRef {
  const record = expectRecord(value, "thread_ref");
  return {
    chatId: readString(record, "chatId", "thread_ref"),
    messageId: readString(record, "messageId", "thread_ref"),
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
