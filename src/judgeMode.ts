export type JudgeTarget = "command" | "session" | "intake" | "conflict" | "operations" | "history" | "context";

export interface JudgeStep {
  id: string;
  target: JudgeTarget;
  eyebrow: string;
  title: string;
  durationSeconds: number;
  narration: string;
  proof: string;
  actionLabel: string;
  sampleInput?: string;
}

export const JUDGE_MODE_STEPS: JudgeStep[] = [
  {
    id: "portfolio-priority",
    target: "command",
    eyebrow: "00:00 · PORTFOLIO",
    title: "위험부터 보여줍니다",
    durationSeconds: 20,
    narration: "LOGOS는 모든 프로젝트를 기억하는 데서 끝나지 않고, 지금 가장 먼저 해결할 연속성 위험을 계산합니다.",
    proof: "건강 점수, 설명 가능한 감점, 우선순위와 권장 Center를 한 화면에서 확인합니다.",
    actionLabel: "Command Center 열기"
  },
  {
    id: "session-recovery",
    target: "session",
    eyebrow: "00:20 · RECOVERY",
    title: "새 세션에서 정확히 복구합니다",
    durationSeconds: 30,
    narration: "프로젝트 이름을 정확히 입력하지 않아도 신호를 기반으로 식별하고, 정본과 중단 지점을 Continuity Brief로 복구합니다.",
    proof: "High/Medium/Low 식별과 권위가 분리된 Recovery Checkpoint를 확인합니다.",
    actionLabel: "새 세션 복구 열기",
    sampleInput: "LOGOS 해커톤 작업 이어가자"
  },
  {
    id: "safe-classification",
    target: "intake",
    eyebrow: "00:50 · SAFE ROUTING",
    title: "아이디어는 정본을 오염시키지 않습니다",
    durationSeconds: 25,
    narration: "GPT-5.6은 발언을 분류하지만 직접 Commit하지 않습니다. 미확정 생각은 Exploration에만 저장됩니다.",
    proof: "API 키가 없어도 동일한 안전 규칙을 따르는 결정론적 폴백으로 시연할 수 있습니다.",
    actionLabel: "분류 입력으로 이동",
    sampleInput: "유료화도 생각해보자."
  },
  {
    id: "conflict-resolution",
    target: "conflict",
    eyebrow: "01:15 · CONFLICT",
    title: "충돌은 사람이 범위를 결정합니다",
    durationSeconds: 35,
    narration: "기존 정본과 양립하지 않는 주장은 자동 덮어쓰기하지 않고 비교 가능한 충돌 후보가 됩니다.",
    proof: "기존 유지, 이번 작업만 예외, 승인 후 새 결정 Commit의 세 경로를 보여줍니다.",
    actionLabel: "Conflict Center 열기",
    sampleInput: "LOGOS를 즉시 범용 지식관리 제품으로 전환한다."
  },
  {
    id: "state-operations",
    target: "operations",
    eyebrow: "01:50 · OPERATIONS",
    title: "현재 상태와 다음 행동도 승인 기반입니다",
    durationSeconds: 25,
    narration: "Current State, Next Action, Exploration과 Checkpoint를 한 운영 화면에서 관리합니다.",
    proof: "변경 후보와 실제 정본을 분리하고, 중단 복구 지점을 명시적으로 갱신합니다.",
    actionLabel: "State Operations 열기"
  },
  {
    id: "history-provenance",
    target: "history",
    eyebrow: "02:15 · PROVENANCE",
    title: "모든 결정의 이유를 추적합니다",
    durationSeconds: 20,
    narration: "Commit, 충돌 해결, Checkpoint와 Exploration의 변경 전후 및 이유를 감사 가능한 이력으로 남깁니다.",
    proof: "과거 복원도 직접 덮어쓰지 않고 새로운 승인 후보가 됩니다.",
    actionLabel: "History Center 열기"
  },
  {
    id: "assembled-context",
    target: "context",
    eyebrow: "02:35 · HANDOFF",
    title: "마지막에는 안전한 컨텍스트를 전달합니다",
    durationSeconds: 15,
    narration: "검증된 정본, 현재 상태, 다음 행동과 비정본 경고를 권위 순서대로 조립해 다음 세션으로 넘깁니다.",
    proof: "일반 회상이 아니라 출처와 검증 상태를 가진 연속성 계층이라는 점을 마무리합니다.",
    actionLabel: "Assembled Context 열기"
  }
];

export const JUDGE_MODE_TOTAL_SECONDS = JUDGE_MODE_STEPS.reduce(
  (total, step) => total + step.durationSeconds,
  0
);

export function clampJudgeStep(index: number): number {
  return Math.min(Math.max(Math.trunc(index), 0), JUDGE_MODE_STEPS.length - 1);
}

export function formatJudgeTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.trunc(seconds));
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}
