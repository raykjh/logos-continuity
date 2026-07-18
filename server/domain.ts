export const verificationStatuses = ["confirmed", "unverified", "conflicted"] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];

export const projectStatuses = ["active", "paused", "dormant", "abandoned"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const actionStatuses = ["pending", "in_progress", "completed", "blocked"] as const;
export type ActionStatus = (typeof actionStatuses)[number];

export const proposalTargets = ["truth", "current_state", "next_action"] as const;
export type ProposalTarget = (typeof proposalTargets)[number];

export class DomainError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "DomainError";
    this.statusCode = statusCode;
  }
}

export function assertOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string
): asserts value is T {
  if (!allowed.includes(value as T)) {
    throw new DomainError(`${label} 값이 올바르지 않습니다: ${value}`);
  }
}

export function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainError(`${label}은(는) 비어 있을 수 없습니다.`);
  }
}

export function assertActionState(
  status: ActionStatus,
  verificationStatus: VerificationStatus
): void {
  if (status === "completed" && verificationStatus !== "confirmed") {
    throw new DomainError("unverified 또는 conflicted 작업은 완료로 기록할 수 없습니다.");
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
