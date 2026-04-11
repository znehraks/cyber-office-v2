import type { RoleDefinition, RoutingCategory } from "../types/domain.js";

export const LEGACY_SPECIALIST_ROLES: string[] = [
  "researcher",
  "creative-brainstormer",
  "fullstack-dev",
  "app-dev",
  "qa",
  "ui-ux-designer",
  "ai-creator",
  "3d-modeler",
  "ar-xr-master",
  "n8n-automator",
  "devil-advocate",
  "legal-reviewer",
  "writer",
  "marketer",
  "sales",
  "asset-manager",
];

export const ALLOWED_HIGH_ROLES: string[] = [
  "planner-high",
  "researcher-high",
  "devil-advocate-high",
  "legal-reviewer-high",
  "ui-ux-designer-high",
];

export const ROUTING_RULES: Record<RoutingCategory, string> = {
  quick: "explore-low",
  research: "researcher",
  standard: "fullstack-dev",
  architecture: "planner-high",
  critique: "devil-advocate-high",
  visual: "ui-ux-designer",
  "visual-high": "ui-ux-designer-high",
  "high-risk": "planner-high",
};

function createSpecialistRole(name: string): RoleDefinition {
  return {
    name,
    kind: "specialist",
    model: name === "writer" || name === "asset-manager" ? "haiku" : "sonnet",
    tier: name === "writer" || name === "asset-manager" ? "low" : "standard",
    effort: "medium",
    sourceRole: name,
    description: `${name} specialist role`,
  };
}

export const ROLE_REGISTRY: RoleDefinition[] = [
  {
    name: "ceo",
    kind: "control",
    model: "sonnet",
    tier: "standard",
    effort: "medium",
    sourceRole: "ceo",
    description:
      "사용자 요청을 mission/job으로 분해하고 role / tier를 밝히며 보고하는 오케스트레이터",
  },
  {
    name: "god",
    kind: "control",
    model: "sonnet",
    tier: "admin",
    effort: "medium",
    sourceRole: "god",
    description:
      "관리자 전용 운영자. 공개 ingress가 아니라 recovery와 override를 담당",
  },
  {
    name: "explore-low",
    kind: "utility",
    model: "haiku",
    tier: "low",
    effort: "low",
    sourceRole: "researcher",
    description: "빠른 triage, lightweight fact gathering, quick checks 전용",
  },
  {
    name: "planner-high",
    kind: "high",
    model: "opus",
    tier: "high",
    effort: "high",
    sourceRole: "ceo",
    description:
      "고난도 설계 판단, 구조 분해, 리스크가 큰 architecture work 전용",
  },
  {
    name: "researcher-high",
    kind: "high",
    model: "opus",
    tier: "high",
    effort: "high",
    sourceRole: "researcher",
    description: "깊은 조사와 대안 비교가 필요한 high-risk research 전용",
  },
  {
    name: "devil-advocate-high",
    kind: "high",
    model: "opus",
    tier: "high",
    effort: "high",
    sourceRole: "devil-advocate",
    description: "구조적 반례 검토와 리스크 식별 전용",
  },
  {
    name: "legal-reviewer-high",
    kind: "high",
    model: "opus",
    tier: "high",
    effort: "high",
    sourceRole: "legal-reviewer",
    description: "고위험 법률/정책 검토 전용",
  },
  {
    name: "ui-ux-designer-high",
    kind: "high",
    model: "opus",
    tier: "high",
    effort: "high",
    sourceRole: "ui-ux-designer",
    description: "고난도 UI/UX 전략과 중요한 visual review 전용",
  },
  ...LEGACY_SPECIALIST_ROLES.map((name) => createSpecialistRole(name)),
];

export function findRole(roleName: string): RoleDefinition {
  const role = ROLE_REGISTRY.find((item) => item.name === roleName);
  if (!role) {
    throw new Error(`Unknown role: ${roleName}`);
  }
  return role;
}
