import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { openDatabase } from "../server/db.ts";
import { classifyLocally, recognizeProjectLocally } from "../server/classifier.ts";
import { DomainError } from "../server/domain.ts";
import { ContinuityService } from "../server/service.ts";
import { JUDGE_MODE_STEPS, JUDGE_MODE_TOTAL_SECONDS, clampJudgeStep, formatJudgeTime } from "../src/judgeMode.ts";

function createService() {
  return new ContinuityService(openDatabase(":memory:"));
}

function createProject(service: ContinuityService) {
  return service.createProject({
    name: "검증 프로젝트",
    summary: "핵심 불변식 검증",
    primaryGoal: "정본 오염을 방지한다.",
    recognitionSignals: ["검증"]
  });
}

function approveStructure(
  service: ContinuityService,
  projectId: string,
  operation: "update_registry" | "update_primary_goal" | "create_workstream" | "update_workstream" | "create_node" | "update_node",
  payload: Record<string, unknown>,
  targetId?: string
) {
  const proposal = service.createStructureProposal(projectId, {
    operation,
    targetId,
    payload,
    reason: "구조 불변식 테스트"
  });
  return service.approveStructureProposal(String(proposal.id));
}

test("승인 전 변경 후보는 Project Truth를 변경하지 않는다", () => {
  const service = createService();
  const project = createProject(service);
  const proposal = service.createProposal(String(project.id), {
    targetType: "truth",
    category: "decision",
    content: "승인 대기 중인 결정",
    verificationStatus: "confirmed",
    reason: "사용자 검토 필요"
  });

  assert.equal(service.getProjectState(String(project.id)).truth.length, 0);
  assert.equal(service.getProjectState(String(project.id)).proposals.length, 1);

  service.approveProposal(String(proposal.id));
  const state = service.getProjectState(String(project.id));
  assert.equal(state.truth.length, 1);
  assert.equal(state.proposals.length, 0);
  service.close();
});

test("conflicted 변경은 승인해도 정본을 덮어쓰지 않는다", () => {
  const service = createService();
  const project = createProject(service);
  const proposal = service.createProposal(String(project.id), {
    targetType: "truth",
    category: "decision",
    content: "서로 충돌하는 결정",
    verificationStatus: "conflicted",
    reason: "권위 있는 정보 충돌"
  });

  assert.throws(
    () => service.approveProposal(String(proposal.id)),
    (error) => error instanceof DomainError && error.message.includes("충돌 해결 전")
  );
  assert.equal(service.getProjectState(String(project.id)).truth.length, 0);
  assert.equal(service.getProjectState(String(project.id)).proposals.length, 1);
  service.close();
});

test("충돌 해결에서 기존 정본 유지를 선택하면 후보만 종료한다", () => {
  const service = createService();
  const project = createProject(service);
  const canonicalProposal = service.createProposal(String(project.id), {
    targetType: "truth",
    category: "product_direction",
    content: "기존 정본을 유지한다.",
    verificationStatus: "confirmed",
    reason: "초기 정본"
  });
  service.approveProposal(String(canonicalProposal.id));
  const canonical = service.getProjectState(String(project.id)).truth[0] as Record<string, unknown>;
  const conflict = service.createProposal(String(project.id), {
    targetType: "truth",
    targetId: String(canonical.id),
    category: "product_direction",
    content: "새 방향으로 바꾼다.",
    verificationStatus: "conflicted",
    reason: "기존 정본과 충돌"
  });

  service.resolveConflict(String(conflict.id), "keep_canonical", "기존 결정 유지");

  const state = service.getProjectState(String(project.id));
  const center = service.getConflictCenter(String(project.id));
  assert.equal((state.truth[0] as Record<string, unknown>).content, "기존 정본을 유지한다.");
  assert.equal(center.pending.length, 0);
  assert.equal(center.recentResolutions[0]?.decision, "keep_canonical");
  service.close();
});

test("이번 작업만 예외는 정본을 보존하고 Working Context에만 적용한다", () => {
  const service = createService();
  const project = createProject(service);
  const canonicalProposal = service.createProposal(String(project.id), {
    targetType: "truth",
    category: "policy",
    content: "항상 사용자 승인 후 배포한다.",
    verificationStatus: "confirmed",
    reason: "배포 정책"
  });
  service.approveProposal(String(canonicalProposal.id));
  const canonical = service.getProjectState(String(project.id)).truth[0] as Record<string, unknown>;
  const conflict = service.createProposal(String(project.id), {
    targetType: "truth",
    targetId: String(canonical.id),
    category: "policy",
    content: "이번 테스트 배포만 승인 없이 진행한다.",
    verificationStatus: "conflicted",
    reason: "일시적 예외 요청"
  });

  const resolution = service.resolveConflict(
    String(conflict.id),
    "temporary_exception",
    "이번 테스트에만 적용"
  );
  const context = service.assembleContext(String(project.id));
  const brief = service.buildContinuityBrief(String(project.id));

  assert.equal((service.getProjectState(String(project.id)).truth[0] as Record<string, unknown>).content, "항상 사용자 승인 후 배포한다.");
  assert.equal(context.workingExceptions.length, 1);
  assert.equal(brief.nonCanonical.temporaryExceptionCount, 1);
  assert.ok(brief.warnings.some((warning) => warning.source === "working_exception"));

  assert.ok("exceptionId" in resolution && resolution.exceptionId);
  service.closeWorkingException(String("exceptionId" in resolution ? resolution.exceptionId : ""));
  assert.equal(service.assembleContext(String(project.id)).workingExceptions.length, 0);
  service.close();
});

test("새 결정으로 교체는 명시적 해결 후 confirmed 정본으로 Commit한다", () => {
  const service = createService();
  const project = createProject(service);
  const canonicalProposal = service.createProposal(String(project.id), {
    targetType: "truth",
    category: "primary_channel",
    content: "웹을 기본 채널로 사용한다.",
    verificationStatus: "confirmed",
    reason: "초기 채널 결정"
  });
  service.approveProposal(String(canonicalProposal.id));
  const canonical = service.getProjectState(String(project.id)).truth[0] as Record<string, unknown>;
  const conflict = service.createProposal(String(project.id), {
    targetType: "truth",
    targetId: String(canonical.id),
    category: "primary_channel",
    content: "데스크톱 앱을 기본 채널로 사용한다.",
    verificationStatus: "conflicted",
    reason: "새 사용자 결정과 기존 정본 충돌"
  });

  service.resolveConflict(String(conflict.id), "apply_proposed", "새 채널로 명시적 교체");

  const truth = service.getProjectState(String(project.id)).truth[0] as Record<string, unknown>;
  const center = service.getConflictCenter(String(project.id));
  assert.equal(truth.content, "데스크톱 앱을 기본 채널로 사용한다.");
  assert.equal(truth.verification_status, "confirmed");
  assert.equal(truth.version, 2);
  assert.equal(center.recentResolutions[0]?.decision, "apply_proposed");
  assert.ok(service.getHistoryCenter(String(project.id)).timeline.some((event) => event.eventType === "conflict_resolution"));
  service.close();
});

test("History 복원은 현재 정본을 직접 바꾸지 않고 승인 후보를 만든다", () => {
  const service = createService();
  const project = createProject(service);
  const initial = service.createProposal(String(project.id), {
    targetType: "truth",
    category: "delivery_mode",
    content: "로컬 데모로 제공한다.",
    verificationStatus: "confirmed",
    reason: "초기 제공 방식"
  });
  service.approveProposal(String(initial.id));
  const truthId = String((service.getProjectState(String(project.id)).truth[0] as Record<string, unknown>).id);
  const update = service.createProposal(String(project.id), {
    targetType: "truth",
    targetId: truthId,
    category: "delivery_mode",
    content: "웹 데모로 제공한다.",
    verificationStatus: "confirmed",
    reason: "배포 방식 변경"
  });
  service.approveProposal(String(update.id));

  const history = service.getHistoryCenter(String(project.id));
  const updateEvent = history.timeline.find(
    (event) => event.eventType === "canonical_commit" && event.afterSnapshot?.content === "웹 데모로 제공한다."
  );
  assert.ok(updateEvent?.revertible);
  assert.equal(updateEvent.beforeSnapshot?.content, "로컬 데모로 제공한다.");

  const revert = service.createHistoryRevertProposal(String(project.id), String(updateEvent?.id));
  let state = service.getProjectState(String(project.id));
  assert.equal((state.truth[0] as Record<string, unknown>).content, "웹 데모로 제공한다.");
  assert.equal(state.proposals.length, 1);

  service.approveProposal(String(revert.proposal.id));
  state = service.getProjectState(String(project.id));
  assert.equal((state.truth[0] as Record<string, unknown>).content, "로컬 데모로 제공한다.");
  service.close();
});

test("History는 Exploration과 Checkpoint 운영 이벤트를 보존한다", () => {
  const service = createService();
  const project = createProject(service);
  const exploration = service.addExploration(String(project.id), "검토 후 종료할 아이디어");
  service.dismissExploration(String(project.id), String(exploration.id));
  service.saveCheckpoint(String(project.id), {
    stableState: "운영 이벤트 기록 지점",
    resumeInstruction: "History 확인"
  });
  service.clearCheckpoint(String(project.id));

  const eventTypes = service.getHistoryCenter(String(project.id)).timeline.map((event) => event.eventType);
  assert.ok(eventTypes.includes("exploration_added"));
  assert.ok(eventTypes.includes("exploration_dismissed"));
  assert.ok(eventTypes.includes("checkpoint_updated"));
  assert.ok(eventTypes.includes("checkpoint_cleared"));
  service.close();
});

test("unverified Next Action은 완료 상태로 만들 수 없다", () => {
  const service = createService();
  const project = createProject(service);

  assert.throws(
    () => service.createProposal(String(project.id), {
      targetType: "next_action",
      content: "검증되지 않은 테스트",
      verificationStatus: "unverified",
      itemStatus: "completed",
      reason: "실패 상태 재현"
    }),
    (error) => error instanceof DomainError && error.message.includes("완료로 기록")
  );
  assert.equal(service.getProjectState(String(project.id)).nextActions.length, 0);
  service.close();
});

test("Exploration 추가는 Truth를 변경하지 않는다", () => {
  const service = createService();
  const project = createProject(service);
  service.addExploration(String(project.id), "유료화 가능성을 생각해보자.");

  const state = service.getProjectState(String(project.id));
  assert.equal(state.exploration.length, 1);
  assert.equal(state.truth.length, 0);
  service.close();
});

test("Exploration 승격은 승인 전 open을 유지하고 승인 후에만 Truth로 이동한다", () => {
  const service = createService();
  const project = createProject(service);
  const exploration = service.addExploration(String(project.id), "오프라인 모드를 제품 원칙으로 검토한다.");
  const promotion = service.promoteExploration(
    String(project.id),
    String(exploration.id),
    "truth",
    "product_principle"
  );

  let state = service.getProjectState(String(project.id));
  assert.equal((state.exploration[0] as Record<string, unknown>).status, "open");
  assert.equal(state.truth.length, 0);
  assert.equal(state.proposals.length, 1);

  service.approveProposal(String(promotion.proposal.id));
  state = service.getProjectState(String(project.id));
  assert.equal((state.exploration[0] as Record<string, unknown>).status, "promoted");
  assert.equal((state.truth[0] as Record<string, unknown>).content, "오프라인 모드를 제품 원칙으로 검토한다.");
  service.close();
});

test("Exploration 승격 후보를 거절하면 Exploration은 open으로 남는다", () => {
  const service = createService();
  const project = createProject(service);
  const exploration = service.addExploration(String(project.id), "다음 주에 사용성 인터뷰를 검토한다.");
  const promotion = service.promoteExploration(
    String(project.id),
    String(exploration.id),
    "next_action"
  );

  service.rejectProposal(String(promotion.proposal.id));
  const state = service.getProjectState(String(project.id));
  assert.equal((state.exploration[0] as Record<string, unknown>).status, "open");
  assert.equal(state.nextActions.length, 0);
  service.close();
});

test("Exploration 종료는 정본 변경 없이 dismissed 상태만 남긴다", () => {
  const service = createService();
  const project = createProject(service);
  const exploration = service.addExploration(String(project.id), "폐기할 아이디어");

  service.dismissExploration(String(project.id), String(exploration.id));

  const state = service.getProjectState(String(project.id));
  assert.equal((state.exploration[0] as Record<string, unknown>).status, "dismissed");
  assert.equal(state.truth.length, 0);
  service.close();
});

test("Checkpoint는 프로젝트당 하나만 유지하고 최신 안정 지점으로 교체한다", () => {
  const service = createService();
  const project = createProject(service);
  service.saveCheckpoint(String(project.id), {
    stableState: "첫 안정 지점",
    resumeInstruction: "첫 작업을 재개한다."
  });
  service.saveCheckpoint(String(project.id), {
    stableState: "두 번째 안정 지점",
    unverifiedChanges: ["UI 검증 필요"],
    resumeInstruction: "두 번째 작업을 재개한다."
  });

  const checkpoint = service.getCheckpoint(String(project.id));
  assert.equal(checkpoint?.stableState, "두 번째 안정 지점");
  assert.deepEqual(checkpoint?.unverifiedChanges, ["UI 검증 필요"]);
  service.close();
});

test("복구 완료 후 Active Checkpoint를 명시적으로 해제할 수 있다", () => {
  const service = createService();
  const project = createProject(service);
  service.saveCheckpoint(String(project.id), {
    stableState: "검증 완료 지점",
    resumeInstruction: "다음 작업으로 이동"
  });

  service.clearCheckpoint(String(project.id));

  assert.equal(service.getCheckpoint(String(project.id)), null);
  assert.equal(service.recoverProject(String(project.id)).recovery.mode, "canonical_only");
  service.close();
});

test("Context Assembly는 권위 순서와 비정본 영역을 분리한다", () => {
  const service = createService();
  const project = service.ensureDemoProject();
  const context = service.assembleContext(String(project.id));

  assert.ok(context.authorityOrder.indexOf("working_exception") < context.authorityOrder.indexOf("project_truth"));
  assert.ok(context.authorityOrder.indexOf("project_truth") < context.authorityOrder.indexOf("current_state"));
  assert.ok(context.authorityOrder.indexOf("current_state") < context.authorityOrder.indexOf("active_checkpoint"));
  assert.ok(context.projectTruth.length > 0);
  assert.ok(context.exploration.length > 0);
  assert.ok(context.activeCheckpoint);
  service.close();
});

test("복구는 Checkpoint를 안내하지만 정본을 자동 변경하지 않는다", () => {
  const service = createService();
  const project = service.ensureDemoProject();
  const before = service.getProjectState(String(project.id)).truth;
  const recovery = service.recoverProject(String(project.id));
  const after = service.getProjectState(String(project.id)).truth;

  assert.equal(recovery.recovery.mode, "checkpoint_available");
  assert.deepEqual(after, before);
  service.close();
});

test("안전 폴백 분류기는 미확정 발언을 Exploration으로 보낸다", () => {
  const result = classifyLocally("유료화도 생각해보자.");
  assert.equal(result.target, "exploration");
  assert.equal(result.verificationStatus, "unverified");
});

test("안전 폴백 분류기는 명시적 확정을 Truth 후보로만 만든다", () => {
  const result = classifyLocally("유료화를 공식 제품 목표로 확정한다.");
  assert.equal(result.target, "truth_candidate");
  assert.equal(result.verificationStatus, "confirmed");
});

test("안전 폴백 분류기는 명시적 다음 작업을 분리한다", () => {
  const result = classifyLocally("다음 작업은 복구 E2E 테스트 구현이다.");
  assert.equal(result.target, "next_action");
  assert.equal(result.actionStatus, "pending");
});

test("프로젝트 인식은 명확한 신호가 있으면 High로 바로 식별한다", () => {
  const result = recognizeProjectLocally("Atlas 결제 모듈 작업 이어가자.", [
    {
      id: "atlas",
      name: "Atlas 결제 모듈 베타 릴리스",
      summary: "승인된 릴리스 상태 복구",
      primaryGoal: "결제 모듈 베타 릴리스를 안전하게 완료한다.",
      recognitionSignals: ["Atlas", "결제 모듈", "베타 릴리스"]
    }
  ]);

  assert.equal(result.confidence, "high");
  assert.equal(result.selectedProjectId, "atlas");
  assert.equal(result.requiresConfirmation, false);
});

test("프로젝트 인식은 애매한 신호만 있으면 Medium 확인을 요구한다", () => {
  const result = recognizeProjectLocally("해커톤 작업 계속하자.", [
    {
      id: "alpha",
      name: "연속성 실험",
      summary: "상태 복구 실험",
      primaryGoal: "복구 흐름 검증",
      recognitionSignals: ["해커톤"]
    }
  ]);

  assert.equal(result.confidence, "medium");
  assert.equal(result.selectedProjectId, null);
  assert.equal(result.suggestedProjectId, "alpha");
  assert.equal(result.requiresConfirmation, true);
});

test("프로젝트 인식 근거가 없으면 일반 대화로 유지한다", () => {
  const result = recognizeProjectLocally("오늘 날씨가 어때?", [
    {
      id: "logos",
      name: "LOGOS Continuity",
      summary: "정본 기반 복구",
      primaryGoal: "연속성 구조를 증명한다.",
      recognitionSignals: ["LOGOS", "해커톤"]
    }
  ]);

  assert.equal(result.confidence, "low");
  assert.equal(result.suggestedProjectId, null);
  assert.equal(result.candidates.length, 0);
});

test("Continuity Brief는 정본과 비정본 경고를 분리한다", () => {
  const service = createService();
  const project = service.ensureDemoProject();
  const brief = service.buildContinuityBrief(String(project.id));

  assert.ok(brief.canonicalTruth.length > 0);
  assert.equal(brief.nonCanonical.explorationCount, 1);
  assert.ok(brief.warnings.some((warning) => warning.source === "checkpoint"));
  assert.equal(brief.markdown.includes("베타 출시를 다음 주로"), false);
  assert.match(brief.markdown, /Exploration 1 item/);
  service.close();
});

test("데모 초기화는 사용자 프로젝트를 보존하고 데모만 재생성한다", () => {
  const service = createService();
  const firstDemo = service.ensureDemoProject();
  service.createProject({
    name: "LOGOS Continuity 해커톤 데모",
    summary: "이전 데모 데이터",
    primaryGoal: "이전 데모 목표"
  });
  const customProject = createProject(service);
  const resetDemo = service.resetDemoProject();
  const projects = service.listProjects();

  assert.notEqual(resetDemo.id, firstDemo.id);
  assert.ok(projects.some((project) => project.id === customProject.id));
  assert.equal(projects.filter((project) => project.name === "Atlas 결제 모듈 베타 릴리스").length, 1);
  assert.equal(projects.some((project) => project.name === "LOGOS Continuity 해커톤 데모"), false);
  service.close();
});

test("프로젝트 구조는 승인 전까지 정본 계층을 변경하지 않는다", () => {
  const service = createService();
  const project = createProject(service);
  const projectId = String(project.id);
  const proposal = service.createStructureProposal(projectId, {
    operation: "create_node",
    payload: {
      nodeType: "strategic_goal",
      title: "승인 후 생성되는 전략 목표",
      status: "active",
      verificationStatus: "confirmed"
    },
    reason: "사용자 승인 필요"
  });

  assert.equal(service.getProjectStructure(projectId).nodes.length, 0);
  assert.equal(service.getProjectStructure(projectId).pendingProposals.length, 1);
  service.approveStructureProposal(String(proposal.id));
  assert.equal(service.getProjectStructure(projectId).nodes.length, 1);
  assert.ok(service.getHistoryCenter(projectId).timeline.some((event) => event.eventType === "structure_commit"));
  service.close();
});

test("Milestone과 Task는 올바른 부모 계층 아래에서만 승인된다", () => {
  const service = createService();
  const project = createProject(service);
  const projectId = String(project.id);
  const invalid = service.createStructureProposal(projectId, {
    operation: "create_node",
    payload: {
      nodeType: "milestone",
      title: "부모 없는 마일스톤",
      status: "planned",
      verificationStatus: "confirmed"
    },
    reason: "잘못된 계층 검증"
  });

  assert.throws(
    () => service.approveStructureProposal(String(invalid.id)),
    (error) => error instanceof DomainError && error.message.includes("상위 항목")
  );
  assert.equal(service.getProjectStructure(projectId).nodes.length, 0);
  assert.equal(service.getProjectStructure(projectId).pendingProposals.length, 1);
  service.close();
});

test("상위 목표는 모든 하위 항목이 완료된 뒤에만 완료된다", () => {
  const service = createService();
  const project = createProject(service);
  const projectId = String(project.id);
  const goal = approveStructure(service, projectId, "create_node", {
    nodeType: "strategic_goal",
    title: "전략 목표",
    status: "active",
    verificationStatus: "confirmed"
  });
  const milestone = approveStructure(service, projectId, "create_node", {
    nodeType: "milestone",
    parentId: goal.targetId,
    title: "마일스톤",
    status: "active",
    verificationStatus: "confirmed"
  });
  const task = approveStructure(service, projectId, "create_node", {
    nodeType: "task",
    parentId: milestone.targetId,
    title: "남은 작업",
    status: "active",
    verificationStatus: "confirmed"
  });
  const earlyCompletion = service.createStructureProposal(projectId, {
    operation: "update_node",
    targetId: milestone.targetId,
    payload: { status: "completed" },
    reason: "너무 이른 완료"
  });

  assert.throws(
    () => service.approveStructureProposal(String(earlyCompletion.id)),
    (error) => error instanceof DomainError && error.message.includes("하위 항목")
  );
  service.rejectStructureProposal(String(earlyCompletion.id));
  approveStructure(service, projectId, "update_node", { status: "completed" }, task.targetId);
  approveStructure(service, projectId, "update_node", { status: "completed" }, milestone.targetId);
  approveStructure(service, projectId, "update_node", { status: "completed" }, goal.targetId);

  const structure = service.getProjectStructure(projectId);
  assert.ok(structure.nodes.every((node) => node.status === "completed"));
  service.close();
});

test("완료 상태는 confirmed 구조 항목에만 허용된다", () => {
  const service = createService();
  const project = createProject(service);
  const proposal = service.createStructureProposal(String(project.id), {
    operation: "create_node",
    payload: {
      nodeType: "strategic_goal",
      title: "검증되지 않은 완료 목표",
      status: "completed",
      verificationStatus: "unverified"
    },
    reason: "검증 상태 불변식"
  });

  assert.throws(
    () => service.approveStructureProposal(String(proposal.id)),
    (error) => error instanceof DomainError && error.message.includes("confirmed")
  );
  assert.equal(service.getProjectStructure(String(project.id)).nodes.length, 0);
  service.close();
});

test("Registry와 Workstream 연결도 승인 후에만 구조에 반영된다", () => {
  const service = createService();
  const project = createProject(service);
  const projectId = String(project.id);
  const registry = service.createStructureProposal(projectId, {
    operation: "update_registry",
    payload: {
      projectLocation: "drive://logos",
      currentFocus: "최종 데모 완성",
      relationships: ["Build Week"]
    },
    reason: "Project Index 갱신"
  });
  assert.equal(service.getProjectStructure(projectId).registry.currentFocus, "");
  service.approveStructureProposal(String(registry.id));
  const workstream = approveStructure(service, projectId, "create_workstream", {
    name: "Demo",
    description: "제출 흐름",
    status: "active"
  });
  approveStructure(service, projectId, "create_node", {
    nodeType: "strategic_goal",
    title: "데모 목표",
    status: "active",
    verificationStatus: "confirmed",
    workstreamId: workstream.targetId
  });

  const structure = service.getProjectStructure(projectId);
  assert.equal(structure.registry.currentFocus, "최종 데모 완성");
  assert.equal(structure.workstreams[0]?.name, "Demo");
  assert.equal(structure.nodes[0]?.workstreamId, workstream.targetId);
  service.close();
});

test("lifecycle proposal keeps the project active until approval", () => {
  const service = createService();
  const project = createProject(service);
  const projectId = String(project.id);
  const proposal = service.createLifecycleProposal(projectId, {
    targetStatus: "paused",
    reason: "Pause after demo recording",
    resumeInstruction: "Review judging feedback"
  });

  assert.equal(service.getProject(projectId).status, "active");
  assert.equal(service.getArchiveCenter(projectId).pendingProposals.length, 1);
  service.approveLifecycleProposal(String(proposal.id));
  assert.equal(service.getProject(projectId).status, "paused");
  assert.equal(service.getArchiveCenter(projectId).snapshots[0]?.status, "archived");
  service.close();
});

test("archive approval is blocked while canonical changes are pending", () => {
  const service = createService();
  const project = createProject(service);
  const projectId = String(project.id);
  service.createProposal(projectId, {
    targetType: "truth",
    category: "decision",
    content: "Pending decision",
    verificationStatus: "confirmed",
    reason: "Needs approval"
  });
  const lifecycle = service.createLifecycleProposal(projectId, {
    targetStatus: "dormant",
    reason: "No active work"
  });

  assert.equal(service.getArchiveCenter(projectId).safety.archiveReady, false);
  assert.throws(
    () => service.approveLifecycleProposal(String(lifecycle.id)),
    (error) => error instanceof DomainError && error.message.includes("blockers")
  );
  assert.equal(service.getProject(projectId).status, "active");
  service.close();
});

test("restoring a project preserves data and closes the latest archive snapshot", () => {
  const service = createService();
  const project = createProject(service);
  const projectId = String(project.id);
  const archive = service.createLifecycleProposal(projectId, {
    targetStatus: "abandoned",
    reason: "Direction ended",
    resumeInstruction: "Revalidate the primary goal before restarting"
  });
  service.approveLifecycleProposal(String(archive.id));
  const restore = service.createLifecycleProposal(projectId, {
    targetStatus: "active",
    reason: "Direction reopened"
  });
  service.approveLifecycleProposal(String(restore.id));

  const center = service.getArchiveCenter(projectId);
  assert.equal(center.project.status, "active");
  assert.equal(center.snapshots[0]?.status, "restored");
  assert.ok(center.snapshots[0]?.restoredAt);
  assert.ok(service.getHistoryCenter(projectId).timeline.some((event) => event.eventType === "project_restored"));
  service.close();
});

test("only one lifecycle proposal may be pending per project", () => {
  const service = createService();
  const project = createProject(service);
  const projectId = String(project.id);
  service.createLifecycleProposal(projectId, { targetStatus: "paused", reason: "First" });
  assert.throws(
    () => service.createLifecycleProposal(projectId, { targetStatus: "dormant", reason: "Second" }),
    (error) => error instanceof DomainError && error.message.includes("already pending")
  );
  service.close();
});

test("archived projects are read-only until restore approval", () => {
  const service = createService();
  const project = createProject(service);
  const projectId = String(project.id);
  const archive = service.createLifecycleProposal(projectId, {
    targetStatus: "paused",
    reason: "Freeze project state"
  });
  service.approveLifecycleProposal(String(archive.id));

  assert.throws(
    () => service.addExploration(projectId, "Must not be added"),
    (error) => error instanceof DomainError && error.message.includes("restore")
  );
  assert.throws(
    () => service.createStructureProposal(projectId, {
      operation: "create_node",
      payload: {
        nodeType: "strategic_goal",
        title: "Must not be added",
        status: "planned",
        verificationStatus: "confirmed"
      },
      reason: "Archived mutation"
    }),
    (error) => error instanceof DomainError && error.message.includes("restore")
  );
  service.close();
});

test("project relationships stay unchanged until approval", () => {
  const service = createService();
  const source = createProject(service);
  const target = service.createProject({
    name: "Target project",
    summary: "Receives a normalized relationship",
    primaryGoal: "Validate portfolio navigation"
  });
  const proposal = service.createRelationshipProposal(String(source.id), {
    operation: "create",
    targetProjectId: String(target.id),
    relationshipType: "supports",
    note: "Shares the continuity engine",
    reason: "Connect related delivery work"
  });

  assert.equal(service.getProjectIndex().relationships.length, 0);
  assert.equal(service.getProjectIndex().pendingProposals.length, 1);
  service.approveRelationshipProposal(String(proposal.id));
  const index = service.getProjectIndex();
  assert.equal(index.relationships.length, 1);
  assert.equal(index.relationships[0]?.relationshipType, "supports");
  assert.equal(index.pendingProposals.length, 0);
  assert.ok(service.getHistoryCenter(String(source.id)).timeline.some(
    (event) => event.eventType === "project_relationship_created"
  ));
  assert.ok(service.getHistoryCenter(String(target.id)).timeline.some(
    (event) => event.eventType === "project_relationship_created"
  ));
  service.close();
});

test("project relationships reject self links and duplicate candidates", () => {
  const service = createService();
  const source = createProject(service);
  const target = service.createProject({
    name: "Second project",
    summary: "Duplicate relationship target",
    primaryGoal: "Protect graph invariants"
  });
  assert.throws(
    () => service.createRelationshipProposal(String(source.id), {
      operation: "create",
      targetProjectId: String(source.id),
      relationshipType: "related_to",
      reason: "Invalid self link"
    }),
    (error) => error instanceof DomainError && error.message.includes("itself")
  );
  service.createRelationshipProposal(String(source.id), {
    operation: "create",
    targetProjectId: String(target.id),
    relationshipType: "depends_on",
    reason: "First candidate"
  });
  assert.throws(
    () => service.createRelationshipProposal(String(source.id), {
      operation: "create",
      targetProjectId: String(target.id),
      relationshipType: "depends_on",
      reason: "Duplicate candidate"
    }),
    (error) => error instanceof DomainError && error.message.includes("already pending")
  );
  service.close();
});

test("relationship removal is approval gated", () => {
  const service = createService();
  const source = createProject(service);
  const target = service.createProject({
    name: "Removal target",
    summary: "Relationship removal target",
    primaryGoal: "Validate safe unlinking"
  });
  const create = service.createRelationshipProposal(String(source.id), {
    operation: "create",
    targetProjectId: String(target.id),
    relationshipType: "supersedes",
    reason: "Create relation for removal test"
  });
  service.approveRelationshipProposal(String(create.id));
  const relationshipId = service.getProjectIndex().relationships[0]?.id;
  assert.ok(relationshipId);
  const remove = service.createRelationshipProposal(String(source.id), {
    operation: "remove",
    relationshipId,
    reason: "The replacement is no longer valid"
  });

  assert.equal(service.getProjectIndex().relationships.length, 1);
  service.approveRelationshipProposal(String(remove.id));
  assert.equal(service.getProjectIndex().relationships.length, 0);
  service.close();
});

test("pending relationship changes block archive and archived sources are read-only", () => {
  const service = createService();
  const source = createProject(service);
  const target = service.createProject({
    name: "Archive relation target",
    summary: "Tests archive integration",
    primaryGoal: "Keep graph changes consistent"
  });
  const relationship = service.createRelationshipProposal(String(source.id), {
    operation: "create",
    targetProjectId: String(target.id),
    relationshipType: "related_to",
    reason: "Pending graph change"
  });
  assert.equal(service.getArchiveCenter(String(source.id)).safety.pendingRelationships, 1);
  service.rejectRelationshipProposal(String(relationship.id));
  const archive = service.createLifecycleProposal(String(source.id), {
    targetStatus: "paused",
    reason: "Archive after graph queue clears"
  });
  service.approveLifecycleProposal(String(archive.id));
  assert.throws(
    () => service.createRelationshipProposal(String(source.id), {
      operation: "create",
      targetProjectId: String(target.id),
      relationshipType: "supports",
      reason: "Archived graph mutation"
    }),
    (error) => error instanceof DomainError && error.message.includes("restore")
  );
  service.close();
});

test("linked project context is reference-only and never merges into canonical state", () => {
  const service = createService();
  const canonical = createProject(service);
  const linked = service.createProject({
    name: "Linked delivery project",
    summary: "Provides external delivery context",
    primaryGoal: "Ship the companion experience"
  });
  const linkedTruth = service.createProposal(String(linked.id), {
    targetType: "truth",
    category: "delivery_rule",
    content: "Linked-only canonical fact",
    verificationStatus: "confirmed",
    reason: "Seed linked project truth"
  });
  service.approveProposal(String(linkedTruth.id));
  const linkedState = service.createProposal(String(linked.id), {
    targetType: "current_state",
    content: "Companion demo is ready",
    verificationStatus: "confirmed",
    reason: "Seed linked current state"
  });
  service.approveProposal(String(linkedState.id));
  const relationship = service.createRelationshipProposal(String(canonical.id), {
    operation: "create",
    targetProjectId: String(linked.id),
    relationshipType: "depends_on",
    note: "Demo handoff dependency",
    reason: "Expose related recovery signals"
  });

  assert.equal(service.getContextBridge(String(canonical.id)).references.length, 0);
  service.approveRelationshipProposal(String(relationship.id));
  const context = service.assembleContext(String(canonical.id));
  assert.equal(context.contextBoundary.mode, "reference_only");
  assert.equal(context.contextBoundary.linkedProjectCount, 1);
  assert.equal(context.linkedProjectReferences[0]?.canonicalImportAllowed, false);
  assert.equal(context.linkedProjectReferences[0]?.relationship.direction, "outgoing");
  assert.equal(context.linkedProjectReferences[0]?.referenceState.currentState?.summary, "Companion demo is ready");
  assert.equal(context.projectTruth.some((entry) => String((entry as Record<string, unknown>).content) === "Linked-only canonical fact"), false);
  assert.equal(context.currentState, null);
  assert.equal(context.authorityOrder.at(-1), "linked_project_reference");
  service.close();
});

test("context bridge exposes incoming direction without granting authority", () => {
  const service = createService();
  const source = createProject(service);
  const target = service.createProject({
    name: "Incoming bridge target",
    summary: "Receives an incoming project reference",
    primaryGoal: "Validate directional context"
  });
  const proposal = service.createRelationshipProposal(String(source.id), {
    operation: "create",
    targetProjectId: String(target.id),
    relationshipType: "supports",
    reason: "Create incoming bridge"
  });
  service.approveRelationshipProposal(String(proposal.id));

  const bridge = service.getContextBridge(String(target.id));
  assert.equal(bridge.references[0]?.relationship.direction, "incoming");
  assert.equal(bridge.references[0]?.project.id, source.id);
  assert.equal(bridge.references[0]?.canonicalImportAllowed, false);
  assert.match(bridge.rules.join(" "), /never merge/i);
  service.close();
});

test("recovery and Continuity Brief label linked projects as non-canonical", () => {
  const service = createService();
  const source = createProject(service);
  const linked = service.createProject({
    name: "Brief reference project",
    summary: "Appears only in the reference section",
    primaryGoal: "Keep brief boundaries visible"
  });
  const proposal = service.createRelationshipProposal(String(source.id), {
    operation: "create",
    targetProjectId: String(linked.id),
    relationshipType: "related_to",
    reason: "Show linked context in recovery"
  });
  service.approveRelationshipProposal(String(proposal.id));

  const recovery = service.recoverProject(String(source.id));
  const brief = service.buildContinuityBrief(String(source.id));
  assert.equal(recovery.bridge.linkedProjectCount, 1);
  assert.equal(recovery.bridge.mode, "reference_only");
  assert.equal(brief.nonCanonical.linkedReferenceCount, 1);
  assert.equal(brief.linkedProjectReferences.length, 1);
  assert.match(brief.markdown, /Linked Project References \(Non-Canonical\)/);
  assert.match(brief.markdown, /never merge/i);
  service.close();
});

test("context promotion creates an unverified proposal without changing canonical state", () => {
  const service = createService();
  const target = createProject(service);
  const source = service.createProject({
    name: "Promotion source",
    summary: "Supplies confirmed external context",
    primaryGoal: "Prove safe cross-project promotion"
  });
  const sourceState = service.createProposal(String(source.id), {
    targetType: "current_state",
    content: "Source delivery is ready",
    verificationStatus: "confirmed",
    reason: "Seed promotable state"
  });
  service.approveProposal(String(sourceState.id));
  const relation = service.createRelationshipProposal(String(target.id), {
    operation: "create",
    targetProjectId: String(source.id),
    relationshipType: "depends_on",
    reason: "Connect promotion source"
  });
  const approvedRelation = service.approveRelationshipProposal(String(relation.id));
  const result = service.createContextPromotion(String(target.id), {
    relationshipId: approvedRelation.relationship.id,
    sourceProjectId: String(source.id),
    sourceType: "current_state",
    reason: "Review source readiness in this project"
  });

  assert.equal(service.getProjectState(String(target.id)).currentState, null);
  assert.equal(result.proposal.proposedVerification, "unverified");
  assert.equal(result.canonicalChanged, false);
  const center = service.getContextPromotionCenter(String(target.id));
  assert.equal(center.pendingPromotions.length, 1);
  assert.equal(center.pendingPromotions[0]?.sourceSnapshot.content, "Source delivery is ready");
  service.close();
});

test("approving context promotion commits provenance but preserves unverified status", () => {
  const service = createService();
  const target = createProject(service);
  const source = service.createProject({
    name: "Truth promotion source",
    summary: "Supplies linked truth",
    primaryGoal: "Preserve source provenance"
  });
  const sourceTruth = service.createProposal(String(source.id), {
    targetType: "truth",
    category: "delivery_rule",
    content: "Record the final demo in one take",
    verificationStatus: "confirmed",
    reason: "Seed source truth"
  });
  service.approveProposal(String(sourceTruth.id));
  const sourceTruthId = String((service.getProjectState(String(source.id)).truth[0] as Record<string, unknown>).id);
  const relation = service.createRelationshipProposal(String(target.id), {
    operation: "create",
    targetProjectId: String(source.id),
    relationshipType: "supports",
    reason: "Connect truth source"
  });
  const approvedRelation = service.approveRelationshipProposal(String(relation.id));
  const promotion = service.createContextPromotion(String(target.id), {
    relationshipId: approvedRelation.relationship.id,
    sourceProjectId: String(source.id),
    sourceType: "truth",
    sourceId: sourceTruthId,
    reason: "Evaluate the linked demo rule"
  });
  service.approveProposal(String(promotion.proposal.id));

  const promotedTruth = service.getProjectState(String(target.id)).truth[0] as Record<string, unknown>;
  assert.equal(promotedTruth.content, "Record the final demo in one take");
  assert.equal(promotedTruth.verification_status, "unverified");
  const center = service.getContextPromotionCenter(String(target.id));
  assert.equal(center.pendingPromotions.length, 0);
  assert.equal(center.recentPromotions[0]?.status, "committed");
  assert.ok(service.getHistoryCenter(String(source.id)).timeline.some(
    (event) => event.eventType === "context_reference_promoted"
  ));
  service.close();
});

test("rejecting context promotion cancels provenance without canonical change", () => {
  const service = createService();
  const target = createProject(service);
  const source = service.createProject({
    name: "Action promotion source",
    summary: "Supplies a linked next action",
    primaryGoal: "Test promotion rejection"
  });
  const sourceAction = service.createProposal(String(source.id), {
    targetType: "next_action",
    content: "Publish the companion checklist",
    verificationStatus: "confirmed",
    itemStatus: "pending",
    reason: "Seed source action"
  });
  service.approveProposal(String(sourceAction.id));
  const sourceActionId = String((service.getProjectState(String(source.id)).nextActions[0] as Record<string, unknown>).id);
  const relation = service.createRelationshipProposal(String(target.id), {
    operation: "create",
    targetProjectId: String(source.id),
    relationshipType: "related_to",
    reason: "Connect action source"
  });
  const approvedRelation = service.approveRelationshipProposal(String(relation.id));
  const promotion = service.createContextPromotion(String(target.id), {
    relationshipId: approvedRelation.relationship.id,
    sourceProjectId: String(source.id),
    sourceType: "next_action",
    sourceId: sourceActionId,
    reason: "Consider linked publication work"
  });
  service.rejectProposal(String(promotion.proposal.id));

  assert.equal(service.getProjectState(String(target.id)).nextActions.length, 0);
  assert.equal(service.getContextPromotionCenter(String(target.id)).recentPromotions[0]?.status, "cancelled");
  service.close();
});

test("promotion provenance retains its project relationship", () => {
  const service = createService();
  const target = createProject(service);
  const source = service.createProject({
    name: "Promotion race source",
    summary: "Tests relationship lifecycle safety",
    primaryGoal: "Keep promotion provenance reachable"
  });
  const sourceState = service.createProposal(String(source.id), {
    targetType: "current_state",
    content: "Source state for race test",
    verificationStatus: "confirmed",
    reason: "Seed race state"
  });
  service.approveProposal(String(sourceState.id));
  const relation = service.createRelationshipProposal(String(target.id), {
    operation: "create",
    targetProjectId: String(source.id),
    relationshipType: "depends_on",
    reason: "Connect race source"
  });
  const approvedRelation = service.approveRelationshipProposal(String(relation.id));
  const promotion = service.createContextPromotion(String(target.id), {
    relationshipId: approvedRelation.relationship.id,
    sourceProjectId: String(source.id),
    sourceType: "current_state",
    reason: "Create pending promotion"
  });
  service.approveProposal(String(promotion.proposal.id));

  assert.throws(
    () => service.createRelationshipProposal(String(target.id), {
      operation: "remove",
      relationshipId: approvedRelation.relationship.id,
      reason: "Unsafe removal"
    }),
    (error) => error instanceof DomainError && error.message.includes("provenance depends")
  );
  service.close();
});

test("provenance drift monitor detects source changes and blocks archive", () => {
  const service = createService();
  const target = createProject(service);
  const source = service.createProject({
    name: "Drift source",
    summary: "Supplies monitored context",
    primaryGoal: "Detect source changes"
  });
  const sourceState = service.createProposal(String(source.id), {
    targetType: "current_state",
    content: "Source state version one",
    verificationStatus: "confirmed",
    reason: "Seed drift source"
  });
  service.approveProposal(String(sourceState.id));
  const relation = service.createRelationshipProposal(String(target.id), {
    operation: "create",
    targetProjectId: String(source.id),
    relationshipType: "depends_on",
    reason: "Connect drift source"
  });
  const approvedRelation = service.approveRelationshipProposal(String(relation.id));
  const promotion = service.createContextPromotion(String(target.id), {
    relationshipId: approvedRelation.relationship.id,
    sourceProjectId: String(source.id),
    sourceType: "current_state",
    reason: "Monitor source state"
  });
  service.approveProposal(String(promotion.proposal.id));

  assert.equal(service.getProvenanceDriftCenter(String(target.id)).stats.stablePromotions, 1);
  const changedState = service.createProposal(String(source.id), {
    targetType: "current_state",
    content: "Source state version two",
    verificationStatus: "confirmed",
    reason: "Advance source state"
  });
  service.approveProposal(String(changedState.id));

  const driftCenter = service.getProvenanceDriftCenter(String(target.id));
  assert.equal(driftCenter.stats.activeDrifts, 1);
  assert.equal(driftCenter.activeDrifts[0]?.severity, "medium");
  assert.deepEqual(driftCenter.activeDrifts[0]?.driftFields, ["content"]);
  assert.equal(driftCenter.activeDrifts[0]?.currentSnapshot?.content, "Source state version two");
  assert.equal(service.getArchiveCenter(String(target.id)).safety.unresolvedDrifts, 1);
  assert.equal(service.getArchiveCenter(String(target.id)).safety.archiveReady, false);
  service.close();
});

test("acknowledged drift reopens when the source changes again", () => {
  const service = createService();
  const target = createProject(service);
  const source = service.createProject({
    name: "Reopening drift source",
    summary: "Changes more than once",
    primaryGoal: "Validate fingerprint acknowledgements"
  });
  const seedState = service.createProposal(String(source.id), {
    targetType: "current_state",
    content: "Baseline source state",
    verificationStatus: "confirmed",
    reason: "Seed source state"
  });
  service.approveProposal(String(seedState.id));
  const relation = service.createRelationshipProposal(String(target.id), {
    operation: "create",
    targetProjectId: String(source.id),
    relationshipType: "supports",
    reason: "Connect monitored source"
  });
  const approvedRelation = service.approveRelationshipProposal(String(relation.id));
  const promotion = service.createContextPromotion(String(target.id), {
    relationshipId: approvedRelation.relationship.id,
    sourceProjectId: String(source.id),
    sourceType: "current_state",
    reason: "Create monitored promotion"
  });
  service.approveProposal(String(promotion.proposal.id));
  const secondState = service.createProposal(String(source.id), {
    targetType: "current_state",
    content: "Second source state",
    verificationStatus: "confirmed",
    reason: "First source change"
  });
  service.approveProposal(String(secondState.id));
  const firstDrift = service.getProvenanceDriftCenter(String(target.id)).activeDrifts[0];
  assert.ok(firstDrift);
  service.acknowledgeProvenanceDrift(String(target.id), firstDrift.id, "Reviewed second source state");
  assert.equal(service.getProvenanceDriftCenter(String(target.id)).stats.acknowledgedDrifts, 1);
  assert.equal(service.getProvenanceDriftCenter(String(target.id)).stats.activeDrifts, 0);

  const thirdState = service.createProposal(String(source.id), {
    targetType: "current_state",
    content: "Third source state",
    verificationStatus: "confirmed",
    reason: "Second source change"
  });
  service.approveProposal(String(thirdState.id));
  const reopened = service.getProvenanceDriftCenter(String(target.id));
  assert.equal(reopened.stats.activeDrifts, 1);
  assert.equal(reopened.stats.acknowledgedDrifts, 0);
  assert.notEqual(reopened.activeDrifts[0]?.fingerprint, firstDrift.fingerprint);
  assert.ok(service.getHistoryCenter(String(target.id)).timeline.some(
    (event) => event.eventType === "provenance_drift_acknowledged"
  ));
  service.close();
});

test("command center ranks canonical conflicts first with explainable penalties", () => {
  const service = createService();
  const stableProject = createProject(service);
  service.saveCheckpoint(String(stableProject.id), {
    stableState: "Stable command center baseline",
    unverifiedChanges: [],
    resumeInstruction: "Continue the next confirmed action"
  });
  const riskyProject = service.createProject({
    name: "Conflict command project",
    summary: "Contains a canonical conflict",
    primaryGoal: "Validate portfolio priority"
  });
  service.createProposal(String(riskyProject.id), {
    targetType: "truth",
    category: "decision",
    content: "Conflicting direction",
    verificationStatus: "conflicted",
    reason: "Exercise command center ranking"
  });

  const center = service.getContinuityCommandCenter();
  const first = center.priorityQueue[0];
  const stable = center.projects.find((item) => item.project.id === stableProject.id);

  assert.equal(first?.project.id, riskyProject.id);
  assert.equal(first?.priority, 100);
  assert.equal(first?.recommendedCenter, "conflict");
  assert.equal(first?.healthState, "critical");
  assert.equal(first?.signals.conflictedProposals, 1);
  assert.equal(first?.penalties.conflicts, 18);
  assert.equal(first?.penalties.approvals, 3);
  assert.equal(stable?.healthScore, 100);
  assert.equal(stable?.healthState, "stable");
  service.close();
});

test("command center prioritizes provenance drift above ordinary approvals", () => {
  const service = createService();
  const target = createProject(service);
  const source = service.createProject({
    name: "Command drift source",
    summary: "Supplies promoted context",
    primaryGoal: "Change after context promotion"
  });
  const approvalProject = service.createProject({
    name: "Approval queue project",
    summary: "Contains an ordinary approval",
    primaryGoal: "Remain below active drift"
  });
  const sourceState = service.createProposal(String(source.id), {
    targetType: "current_state",
    content: "Command source version one",
    verificationStatus: "confirmed",
    reason: "Seed command drift source"
  });
  service.approveProposal(String(sourceState.id));
  const relation = service.createRelationshipProposal(String(target.id), {
    operation: "create",
    targetProjectId: String(source.id),
    relationshipType: "depends_on",
    reason: "Connect command drift source"
  });
  const approvedRelation = service.approveRelationshipProposal(String(relation.id));
  const promotion = service.createContextPromotion(String(target.id), {
    relationshipId: approvedRelation.relationship.id,
    sourceProjectId: String(source.id),
    sourceType: "current_state",
    reason: "Promote monitored command context"
  });
  service.approveProposal(String(promotion.proposal.id));
  const changedState = service.createProposal(String(source.id), {
    targetType: "current_state",
    content: "Command source version two",
    verificationStatus: "confirmed",
    reason: "Trigger command drift"
  });
  service.approveProposal(String(changedState.id));
  service.createProposal(String(approvalProject.id), {
    targetType: "truth",
    category: "decision",
    content: "Ordinary pending approval",
    verificationStatus: "confirmed",
    reason: "Compare portfolio priority"
  });

  const center = service.getContinuityCommandCenter();
  const driftItem = center.projects.find((item) => item.project.id === target.id);
  const approvalItem = center.projects.find((item) => item.project.id === approvalProject.id);

  assert.equal(driftItem?.priority, 90);
  assert.equal(driftItem?.recommendedCenter, "drift");
  assert.equal(driftItem?.signals.activeDrifts, 1);
  assert.equal(approvalItem?.priority, 80);
  assert.ok((driftItem?.priority ?? 0) > (approvalItem?.priority ?? 0));
  service.close();
});

test("command center routes missing checkpoints and inactive projects correctly", () => {
  const service = createService();
  const activeProject = createProject(service);
  const inactiveProject = service.createProject({
    name: "Paused command project",
    summary: "Needs lifecycle review",
    primaryGoal: "Validate inactive routing"
  });
  const lifecycle = service.createLifecycleProposal(String(inactiveProject.id), {
    targetStatus: "paused",
    reason: "Pause for command center test",
    resumeInstruction: "Review before resuming"
  });
  service.approveLifecycleProposal(String(lifecycle.id));

  const center = service.getContinuityCommandCenter();
  const active = center.projects.find((item) => item.project.id === activeProject.id);
  const inactive = center.projects.find((item) => item.project.id === inactiveProject.id);

  assert.equal(active?.healthScore, 95);
  assert.equal(active?.priority, 40);
  assert.equal(active?.recommendedCenter, "operations");
  assert.ok(active?.issues.some((issue) => issue.type === "missing_checkpoint"));
  assert.equal(inactive?.priority, 50);
  assert.equal(inactive?.recommendedCenter, "archive");
  assert.ok(!inactive?.issues.some((issue) => issue.type === "missing_checkpoint"));
  service.close();
});

test("judge mode stays within three minutes and covers the core safety story", () => {
  assert.equal(JUDGE_MODE_STEPS.length, 7);
  assert.ok(JUDGE_MODE_TOTAL_SECONDS <= 180);
  assert.equal(new Set(JUDGE_MODE_STEPS.map((step) => step.id)).size, JUDGE_MODE_STEPS.length);
  assert.deepEqual(
    JUDGE_MODE_STEPS.map((step) => step.target),
    ["command", "session", "intake", "conflict", "operations", "history", "context"]
  );
  assert.ok(JUDGE_MODE_STEPS.every((step) => step.narration && step.proof && step.actionLabel));
  assert.equal(clampJudgeStep(-1), 0);
  assert.equal(clampJudgeStep(99), JUDGE_MODE_STEPS.length - 1);
  assert.equal(formatJudgeTime(JUDGE_MODE_TOTAL_SECONDS), "02:15");
  assert.ok(JUDGE_MODE_STEPS.every((step) => step.durationSeconds <= 23));
});

test("submission evidence separates verified artifacts from external actions", () => {
  const service = createService();
  createProject(service);

  const evidence = service.getSubmissionEvidence({
    configured: false,
    model: "gpt-5.6",
    fallback: "deterministic-rules"
  });
  const gptRequirement = evidence.requirements.find((item) => item.id === "gpt-live");
  const videoRequirement = evidence.requirements.find((item) => item.id === "public-video");

  assert.equal(evidence.event.track, "Work and Productivity");
  assert.equal(evidence.readiness.total, 13);
  assert.equal(evidence.readiness.ready, 6);
  assert.equal(evidence.readiness.blocked, 1);
  assert.equal(gptRequirement?.status, "blocked");
  assert.equal(videoRequirement?.status, "action_required");
  assert.match(evidence.markdown, /How Codex and GPT-5\.6 Contributed/);
  assert.match(evidence.markdown, /\/feedback Codex Session ID/);
  assert.match(evidence.narrative.testingInstructions, /Local Safe Mode/);
  service.close();
});

test("submission evidence marks live GPT-5.6 configuration as ready", () => {
  const service = createService();
  createProject(service);

  const evidence = service.getSubmissionEvidence({
    configured: true,
    model: "gpt-5.6",
    fallback: "deterministic-rules"
  }, true, true, "https://github.com/raykjh/logos-continuity");
  const gptRequirement = evidence.requirements.find((item) => item.id === "gpt-live");
  const accessRequirement = evidence.requirements.find((item) => item.id === "test-access");
  const repositoryRequirement = evidence.requirements.find((item) => item.id === "repository-url");

  assert.equal(gptRequirement?.status, "ready");
  assert.equal(accessRequirement?.status, "ready");
  assert.equal(repositoryRequirement?.status, "ready");
  assert.equal(evidence.readiness.ready, 9);
  assert.equal(evidence.readiness.blocked, 0);
  assert.equal(evidence.judgePackage.available, true);
  assert.equal(evidence.judgePackage.downloadUrl, "/api/submission-evidence/judge-package");
  assert.match(gptRequirement?.evidence ?? "", /gpt-5\.6/);
  service.close();
});

test("public deployment contract uses Node 24, safe secrets, and Render health checks", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  const renderBlueprint = readFileSync("render.yaml", "utf8");
  const serverEntry = readFileSync("server/index.ts", "utf8");
  const buildWeekLog = readFileSync("docs/BUILD_WEEK_BUILD_LOG.md", "utf8");
  const license = readFileSync("LICENSE", "utf8");

  assert.match(dockerfile, /FROM node:24-bookworm-slim/);
  assert.match(dockerfile, /pnpm exec tsc --noEmit && pnpm exec vite build/);
  assert.match(dockerfile, /HOST=0\.0\.0\.0/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.ok(!dockerfile.includes("OPENAI_API_KEY"));
  assert.match(renderBlueprint, /runtime: docker/);
  assert.match(renderBlueprint, /plan: free/);
  assert.match(renderBlueprint, /healthCheckPath: \/api\/health/);
  assert.match(renderBlueprint, /REPOSITORY_URL/);
  assert.ok(!renderBlueprint.includes("OPENAI_API_KEY"));
  assert.match(serverEntry, /process\.env\.HOST \?\? "127\.0\.0\.1"/);
  assert.match(buildWeekLog, /Timestamped Repository Evidence/);
  assert.match(license, /MIT License/);
});
