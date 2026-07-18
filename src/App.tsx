import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { JUDGE_MODE_STEPS, JUDGE_MODE_TOTAL_SECONDS, clampJudgeStep, formatJudgeTime } from "./judgeMode";

type Verification = "confirmed" | "unverified" | "conflicted";
type ProjectStatus = "active" | "paused" | "dormant" | "abandoned";

interface Project {
  id: string;
  name: string;
  summary: string;
  primaryGoal: string;
  status: ProjectStatus;
  recognitionSignals: string[];
}

interface TruthEntry {
  id: string;
  category: string;
  content: string;
  verification_status: Verification;
  version: number;
}

interface ActionEntry {
  id: string;
  content: string;
  status: string;
  verification_status: Verification;
}

interface ExplorationEntry {
  id: string;
  content: string;
  status: string;
}

interface Proposal {
  id: string;
  target_type: string;
  target_id: string | null;
  category: string | null;
  proposed_content: string;
  proposed_verification: Verification;
  reason: string;
}

interface Checkpoint {
  stableState: string;
  unverifiedChanges: string[];
  resumeInstruction: string;
  updatedAt: string;
}

interface ProjectState {
  project: Project;
  truth: TruthEntry[];
  currentState: null | {
    summary: string;
    verification_status: Verification;
  };
  nextActions: ActionEntry[];
  exploration: ExplorationEntry[];
  checkpoint: Checkpoint | null;
  proposals: Proposal[];
}

interface LinkedProjectReference {
  relationship: {
    id: string;
    direction: "incoming" | "outgoing";
    relationshipType: RelationshipType;
    note: string;
  };
  project: Project;
  referenceState: {
    currentState: null | {
      summary: string;
      verificationStatus: Verification;
      updatedAt: string;
    };
    checkpoint: Checkpoint | null;
    nextActions: Array<{
      id: string;
      content: string;
      status: string;
      verificationStatus: Verification;
      updatedAt: string;
    }>;
    confirmedSignals: Array<{
      id: string;
      category: string;
      content: string;
      version: number;
      committedAt: string;
    }>;
  };
  canonicalImportAllowed: false;
}

interface ContextBoundary {
  mode: "reference_only";
  canonicalProjectId: string;
  linkedProjectCount?: number;
  rules: string[];
}

interface RecoveryResult {
  context: Record<string, unknown> & {
    contextBoundary?: ContextBoundary;
    linkedProjectReferences?: LinkedProjectReference[];
  };
  bridge?: {
    mode: "reference_only";
    linkedProjectCount: number;
    rule: string;
  };
  recovery: {
    mode: string;
    stableState?: string;
    unverifiedChanges?: string[];
    resumeInstruction?: string;
    rule: string;
  };
}

interface AiStatus {
  configured: boolean;
  model: string;
  fallback: string;
}

interface IntakeResult {
  classification: {
    target: string;
    confidence: string;
    verificationStatus: Verification;
    category: string;
    rationale: string;
    source: "gpt-5.6" | "local_fallback";
    model: string;
  };
  outcome: {
    type: string;
  };
}

interface RecognitionCandidate {
  projectId: string;
  projectName: string;
  summary: string;
  score: number;
  matchedSignals: string[];
}

interface ProjectRecognitionResult {
  confidence: "high" | "medium" | "low";
  suggestedProjectId: string | null;
  selectedProjectId: string | null;
  requiresConfirmation: boolean;
  rationale: string;
  candidates: RecognitionCandidate[];
  source: "gpt-5.6" | "local_fallback";
  model: string;
}

interface ContinuityBrief {
  generatedAt: string;
  project: Project;
  canonicalTruth: Array<{
    category: string;
    content: string;
    verificationStatus: Verification;
    version: number;
  }>;
  currentState: null | {
    summary: string;
    verificationStatus: Verification;
  };
  nextActions: Array<{
    id: string;
    content: string;
    status: string;
    verificationStatus: Verification;
  }>;
  checkpoint: Checkpoint | null;
  workingExceptions: Array<{
    id: string;
    targetType: string;
    content: string;
    reason: string;
    createdAt: string;
  }>;
  warnings: Array<{
    source: string;
    content: string;
    verificationStatus: Verification;
  }>;
  nonCanonical: {
    explorationCount: number;
    pendingProposalCount: number;
    temporaryExceptionCount: number;
    linkedReferenceCount: number;
  };
  contextBoundary: ContextBoundary;
  linkedProjectReferences: LinkedProjectReference[];
  markdown: string;
}

type ConflictDecision = "keep_canonical" | "temporary_exception" | "apply_proposed";

interface ConflictCenterState {
  pending: Array<{
    proposal: Proposal;
    canonical: {
      exists: boolean;
      targetId: string | null;
      content: string | null;
      verificationStatus: Verification | null;
      itemStatus: string | null;
      version: number | null;
    };
  }>;
  activeExceptions: Array<{
    id: string;
    projectId: string;
    sourceProposalId: string;
    targetType: string;
    content: string;
    reason: string;
    status: string;
    createdAt: string;
  }>;
  recentResolutions: Array<{
    id: string;
    proposalId: string;
    decision: ConflictDecision;
    note: string;
    createdAt: string;
  }>;
}

interface HistoryEvent {
  id: string;
  projectId: string;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  sourceType: string;
  sourceId: string | null;
  metadata: Record<string, unknown>;
  revertible: boolean;
  createdAt: string;
}

interface HistoryCenterState {
  timeline: HistoryEvent[];
  stats: {
    total: number;
    canonicalCommits: number;
    conflictResolutions: number;
    operationalEvents: number;
    revertible: number;
  };
}

type StructureOperation =
  | "update_registry"
  | "update_primary_goal"
  | "create_workstream"
  | "update_workstream"
  | "create_node"
  | "update_node";

interface Workstream {
  id: string;
  name: string;
  description: string;
  status: "active" | "paused";
}

interface StructureNode {
  id: string;
  parentId: string | null;
  workstreamId: string | null;
  nodeType: "strategic_goal" | "milestone" | "task";
  title: string;
  description: string;
  status: "planned" | "active" | "completed" | "blocked";
  verificationStatus: Verification;
  sortOrder: number;
}

interface StructureGoal extends StructureNode {
  milestones: Array<StructureNode & { tasks: StructureNode[] }>;
}

interface StructureProposal {
  id: string;
  operation: StructureOperation;
  targetId: string | null;
  payload: Record<string, unknown>;
  reason: string;
  createdAt: string;
}

interface ProjectStructureState {
  project: Project;
  registry: {
    projectId: string;
    projectLocation: string;
    currentFocus: string;
    lastMeaningfulUpdate: string | null;
    relationships: string[];
  };
  workstreams: Workstream[];
  nodes: StructureNode[];
  hierarchy: StructureGoal[];
  pendingProposals: StructureProposal[];
}

interface ArchiveCenterState {
  project: Project;
  manifest: {
    truthEntries: number;
    nextActions: number;
    openNextActions: number;
    openExploration: number;
    historyEvents: number;
    structureNodes: number;
    checkpoint: null | {
      stableState: string;
      resumeInstruction: string;
      updatedAt: string;
    };
  };
  safety: {
    pendingCanonical: number;
    pendingStructure: number;
    activeExceptions: number;
    pendingRelationships: number;
    unresolvedDrifts: number;
    blockers: string[];
    archiveReady: boolean;
  };
  pendingProposals: Array<{
    id: string;
    targetStatus: ProjectStatus;
    reason: string;
    resumeInstruction: string;
    createdAt: string;
  }>;
  snapshots: Array<{
    id: string;
    previousStatus: ProjectStatus;
    archivedStatus: Exclude<ProjectStatus, "active">;
    manifest: Record<string, unknown>;
    reason: string;
    resumeInstruction: string;
    status: "archived" | "restored";
    archivedAt: string;
    restoredAt: string | null;
  }>;
}

type RelationshipType = "depends_on" | "supports" | "related_to" | "supersedes";

interface ProjectIndexState {
  generatedAt: string;
  stats: {
    totalProjects: number;
    activeProjects: number;
    archivedProjects: number;
    relationships: number;
    pendingApprovals: number;
  };
  projects: Array<Project & {
    currentFocus: string;
    projectLocation: string;
    truthCount: number;
    openActionCount: number;
    pendingApprovalCount: number;
    activeExceptionCount: number;
    relationshipCount: number;
    hasCheckpoint: boolean;
  }>;
  relationships: Array<{
    id: string;
    sourceProjectId: string;
    sourceProjectName: string;
    targetProjectId: string;
    targetProjectName: string;
    relationshipType: RelationshipType;
    note: string;
    createdAt: string;
    updatedAt: string;
  }>;
  pendingProposals: Array<{
    id: string;
    projectId: string;
    sourceProjectName: string;
    operation: "create" | "remove";
    relationshipId: string | null;
    targetProjectId: string | null;
    targetProjectName: string;
    relationshipType: RelationshipType | null;
    note: string;
    reason: string;
    createdAt: string;
  }>;
}

interface ContextPromotionRecord {
  id: string;
  projectId: string;
  sourceProjectId: string;
  sourceProjectName: string;
  relationshipId: string;
  sourceType: "truth" | "current_state" | "next_action";
  sourceId: string | null;
  sourceSnapshot: Record<string, unknown>;
  proposalId: string;
  status: "pending" | "committed" | "cancelled";
  createdAt: string;
  resolvedAt: string | null;
  proposal: {
    id: string;
    targetType: "truth" | "current_state" | "next_action";
    category: string | null;
    content: string;
    verificationStatus: Verification;
    itemStatus: string | null;
    reason: string;
    status: "pending" | "approved" | "rejected";
  };
}

interface ContextPromotionCenterState {
  project: Project;
  boundary: {
    mode: "reference_only";
    rule: string;
  };
  references: LinkedProjectReference[];
  pendingPromotions: ContextPromotionRecord[];
  recentPromotions: ContextPromotionRecord[];
}

interface ProvenanceDriftRecord {
  id: string;
  projectId: string;
  sourceProjectId: string;
  sourceProjectName: string;
  relationshipId: string;
  sourceType: "truth" | "current_state" | "next_action";
  sourceId: string | null;
  sourceSnapshot: Record<string, unknown>;
  proposalId: string;
  status: "committed";
  baselineSnapshot: Record<string, unknown>;
  currentSnapshot: Record<string, unknown> | null;
  driftState: "stable" | "changed" | "missing";
  driftFields: string[];
  severity: "none" | "low" | "medium" | "high" | "critical";
  fingerprint: string;
  acknowledged: boolean;
  acknowledgement: null | {
    note: string;
    acknowledgedAt: string;
  };
}

interface ProvenanceDriftCenterState {
  project: Project;
  scannedAt: string;
  stats: {
    monitoredPromotions: number;
    activeDrifts: number;
    acknowledgedDrifts: number;
    stablePromotions: number;
    criticalDrifts: number;
  };
  activeDrifts: ProvenanceDriftRecord[];
  acknowledgedDrifts: ProvenanceDriftRecord[];
  stablePromotions: ProvenanceDriftRecord[];
}

interface CommandCenterProject {
  project: Project;
  healthScore: number;
  healthState: "stable" | "attention" | "critical";
  priority: number;
  recommendedCenter: "project" | "archive" | "operations" | "index" | "structure" | "promotion" | "conflict" | "drift";
  recommendedAction: string;
  issues: Array<{
    type: string;
    count: number;
    severity: string;
  }>;
  signals: {
    pendingApprovals: number;
    pendingCanonical: number;
    pendingStructure: number;
    pendingLifecycle: number;
    pendingRelationships: number;
    pendingContextPromotions: number;
    conflictedProposals: number;
    activeExceptions: number;
    activeDrifts: number;
    criticalDrifts: number;
    blockedActions: number;
    openActions: number;
    unverifiedCanonical: number;
    hasCheckpoint: boolean;
    checkpointAgeDays: number | null;
    checkpointStale: boolean;
  };
  penalties: Record<string, number>;
}

interface ContinuityCommandCenterState {
  generatedAt: string;
  stats: {
    totalProjects: number;
    stableProjects: number;
    attentionProjects: number;
    criticalProjects: number;
    averageHealth: number;
    totalOpenIssues: number;
  };
  priorityQueue: CommandCenterProject[];
  projects: CommandCenterProject[];
}

type SubmissionRequirementStatus = "ready" | "action_required" | "blocked";

interface SubmissionEvidenceState {
  generatedAt: string;
  event: {
    name: string;
    deadline: string;
    track: string;
    officialSources: string[];
  };
  readiness: {
    score: number;
    total: number;
    ready: number;
    actionRequired: number;
    blocked: number;
  };
  portfolio: {
    projects: number;
    averageHealth: number;
    openIssues: number;
  };
  judgePackage: {
    available: boolean;
    filename: string;
    downloadUrl: string | null;
    requirement: string;
    installRequired: boolean;
  };
  narrative: {
    title: string;
    tagline: string;
    track: string;
    shortDescription: string;
    fullDescription: string;
    testingInstructions: string;
  };
  features: string[];
  contributions: Array<{ owner: string; summary: string }>;
  architecture: Array<{ layer: string; evidence: string }>;
  requirements: Array<{
    id: string;
    category: string;
    label: string;
    status: SubmissionRequirementStatus;
    critical: boolean;
    evidence: string;
    action: string;
  }>;
  markdown: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers }
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "요청에 실패했습니다.");
  return body;
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`status status--${value}`}>{value.replace("_", " ")}</span>;
}

function snapshotText(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) return "none";
  if (snapshot.exists === false) return "none";
  for (const key of ["content", "summary", "stableState", "name", "status"]) {
    if (typeof snapshot[key] === "string" && snapshot[key]) return String(snapshot[key]);
  }
  return JSON.stringify(snapshot);
}

function SectionTitle({ eyebrow, title, count }: { eyebrow: string; title: string; count?: number }) {
  return (
    <div className="section-title">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {typeof count === "number" && <strong>{count.toString().padStart(2, "0")}</strong>}
    </div>
  );
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [state, setState] = useState<ProjectState | null>(null);
  const [recovery, setRecovery] = useState<RecoveryResult | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("정본과 임시 상태를 분리해 표시합니다.");
  const [explorationText, setExplorationText] = useState("");
  const [proposalText, setProposalText] = useState("");
  const [proposalCategory, setProposalCategory] = useState("product_direction");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({
    configured: false,
    model: "gpt-5.6",
    fallback: "deterministic-rules"
  });
  const [intakeText, setIntakeText] = useState("");
  const [intakeResult, setIntakeResult] = useState<IntakeResult | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [recognition, setRecognition] = useState<ProjectRecognitionResult | null>(null);
  const [brief, setBrief] = useState<ContinuityBrief | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictCenter, setConflictCenter] = useState<ConflictCenterState | null>(null);
  const [conflictTargetId, setConflictTargetId] = useState("");
  const [conflictText, setConflictText] = useState("");
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [currentStateDraft, setCurrentStateDraft] = useState("");
  const [currentStateVerification, setCurrentStateVerification] = useState<Verification>("confirmed");
  const [newActionText, setNewActionText] = useState("");
  const [checkpointStable, setCheckpointStable] = useState("");
  const [checkpointUnverified, setCheckpointUnverified] = useState("");
  const [checkpointResume, setCheckpointResume] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCenter, setHistoryCenter] = useState<HistoryCenterState | null>(null);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [structureOpen, setStructureOpen] = useState(false);
  const [structure, setStructure] = useState<ProjectStructureState | null>(null);
  const [registryLocation, setRegistryLocation] = useState("");
  const [registryFocus, setRegistryFocus] = useState("");
  const [registryRelationships, setRegistryRelationships] = useState("");
  const [primaryGoalDraft, setPrimaryGoalDraft] = useState("");
  const [workstreamName, setWorkstreamName] = useState("");
  const [workstreamDescription, setWorkstreamDescription] = useState("");
  const [nodeType, setNodeType] = useState<StructureNode["nodeType"]>("strategic_goal");
  const [nodeParent, setNodeParent] = useState("");
  const [nodeWorkstream, setNodeWorkstream] = useState("");
  const [nodeTitle, setNodeTitle] = useState("");
  const [nodeDescription, setNodeDescription] = useState("");
  const [nodeStatus, setNodeStatus] = useState<StructureNode["status"]>("planned");
  const [nodeVerification, setNodeVerification] = useState<Verification>("confirmed");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveCenter, setArchiveCenter] = useState<ArchiveCenterState | null>(null);
  const [lifecycleTarget, setLifecycleTarget] = useState<ProjectStatus>("paused");
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [lifecycleResume, setLifecycleResume] = useState("");
  const [indexOpen, setIndexOpen] = useState(false);
  const [projectIndex, setProjectIndex] = useState<ProjectIndexState | null>(null);
  const [relationshipTarget, setRelationshipTarget] = useState("");
  const [relationshipType, setRelationshipType] = useState<RelationshipType>("related_to");
  const [relationshipNote, setRelationshipNote] = useState("");
  const [relationshipReason, setRelationshipReason] = useState("");
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [promotionCenter, setPromotionCenter] = useState<ContextPromotionCenterState | null>(null);
  const [promotionReason, setPromotionReason] = useState("");
  const [driftOpen, setDriftOpen] = useState(false);
  const [driftCenter, setDriftCenter] = useState<ProvenanceDriftCenterState | null>(null);
  const [driftNote, setDriftNote] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandCenter, setCommandCenter] = useState<ContinuityCommandCenterState | null>(null);
  const [judgeActive, setJudgeActive] = useState(false);
  const [judgeStepIndex, setJudgeStepIndex] = useState(0);
  const [judgeElapsed, setJudgeElapsed] = useState(0);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [submissionEvidence, setSubmissionEvidence] = useState<SubmissionEvidenceState | null>(null);

  const loadProjects = useCallback(async () => {
    const result = await request<Project[]>("/api/projects");
    setProjects(result);
    setSelectedId((current) => current || result[0]?.id || "");
  }, []);

  const loadState = useCallback(async (projectId: string) => {
    if (!projectId) return;
    const result = await request<ProjectState>(`/api/projects/${projectId}/state`);
    setState(result);
  }, []);

  const loadConflictCenter = useCallback(async (projectId: string) => {
    if (!projectId) return;
    const result = await request<ConflictCenterState>(`/api/projects/${projectId}/conflicts`);
    setConflictCenter(result);
  }, []);

  const loadHistoryCenter = useCallback(async (projectId: string) => {
    if (!projectId) return;
    const result = await request<HistoryCenterState>(`/api/projects/${projectId}/history`);
    setHistoryCenter(result);
  }, []);

  const loadStructure = useCallback(async (projectId: string) => {
    if (!projectId) return null;
    const result = await request<ProjectStructureState>(`/api/projects/${projectId}/structure`);
    setStructure(result);
    return result;
  }, []);

  const loadArchiveCenter = useCallback(async (projectId: string) => {
    if (!projectId) return null;
    const result = await request<ArchiveCenterState>(`/api/projects/${projectId}/archive`);
    setArchiveCenter(result);
    return result;
  }, []);

  const loadProjectIndex = useCallback(async () => {
    const result = await request<ProjectIndexState>("/api/project-index");
    setProjectIndex(result);
    return result;
  }, []);

  const loadPromotionCenter = useCallback(async (projectId: string) => {
    if (!projectId) return null;
    const result = await request<ContextPromotionCenterState>(`/api/projects/${projectId}/context-promotions`);
    setPromotionCenter(result);
    return result;
  }, []);

  const loadDriftCenter = useCallback(async (projectId: string) => {
    if (!projectId) return null;
    const result = await request<ProvenanceDriftCenterState>(`/api/projects/${projectId}/provenance-drift`);
    setDriftCenter(result);
    return result;
  }, []);

  const loadCommandCenter = useCallback(async () => {
    const result = await request<ContinuityCommandCenterState>("/api/command-center");
    setCommandCenter(result);
    return result;
  }, []);

  const loadSubmissionEvidence = useCallback(async () => {
    const result = await request<SubmissionEvidenceState>("/api/submission-evidence");
    setSubmissionEvidence(result);
    return result;
  }, []);

  useEffect(() => {
    loadProjects().catch((error: Error) => setNotice(error.message));
    request<AiStatus>("/api/ai/status")
      .then(setAiStatus)
      .catch((error: Error) => setNotice(error.message));
  }, [loadProjects]);

  useEffect(() => {
    if (!selectedId) return;
    setState(null);
    setRecovery(null);
    setContextOpen(false);
    setExplorationText("");
    setProposalText("");
    setProposalCategory("product_direction");
    setIntakeText("");
    setIntakeResult(null);
    setConflictOpen(false);
    setConflictCenter(null);
    setConflictTargetId("");
    setConflictText("");
    setOperationsOpen(false);
    setCurrentStateDraft("");
    setCurrentStateVerification("confirmed");
    setNewActionText("");
    setCheckpointStable("");
    setCheckpointUnverified("");
    setCheckpointResume("");
    setHistoryOpen(false);
    setHistoryCenter(null);
    setHistoryFilter("all");
    setStructureOpen(false);
    setStructure(null);
    setRegistryLocation("");
    setRegistryFocus("");
    setRegistryRelationships("");
    setPrimaryGoalDraft("");
    setWorkstreamName("");
    setWorkstreamDescription("");
    setNodeType("strategic_goal");
    setNodeParent("");
    setNodeWorkstream("");
    setNodeTitle("");
    setNodeDescription("");
    setNodeStatus("planned");
    setNodeVerification("confirmed");
    setArchiveOpen(false);
    setArchiveCenter(null);
    setLifecycleTarget("paused");
    setLifecycleReason("");
    setLifecycleResume("");
    setIndexOpen(false);
    setProjectIndex(null);
    setRelationshipTarget("");
    setRelationshipType("related_to");
    setRelationshipNote("");
    setRelationshipReason("");
    setPromotionOpen(false);
    setPromotionCenter(null);
    setPromotionReason("");
    setDriftOpen(false);
    setDriftCenter(null);
    setDriftNote("");
    setCommandOpen(false);
    setCommandCenter(null);
    setEvidenceOpen(false);
    setSubmissionEvidence(null);
    Promise.all([loadState(selectedId), loadDriftCenter(selectedId)])
      .catch((error: Error) => setNotice(error.message));
  }, [loadDriftCenter, loadState, selectedId]);

  useEffect(() => {
    if (!judgeActive) return;
    const timer = window.setInterval(() => setJudgeElapsed((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [judgeActive]);

  const verificationCounts = useMemo(() => {
    const entries = [
      ...(state?.truth ?? []).map((item) => item.verification_status),
      ...(state?.nextActions ?? []).map((item) => item.verification_status),
      ...(state?.currentState ? [state.currentState.verification_status] : [])
    ];
    return {
      confirmed: entries.filter((item) => item === "confirmed").length,
      unverified: entries.filter((item) => item === "unverified").length,
      conflicted: entries.filter((item) => item === "conflicted").length
    };
  }, [state]);

  const visibleHistory = useMemo(() => {
    const timeline = historyCenter?.timeline ?? [];
    if (historyFilter === "canonical") {
      return timeline.filter((event) => ["canonical_commit", "legacy_commit"].includes(event.eventType));
    }
    if (historyFilter === "conflict") {
      return timeline.filter((event) => event.eventType === "conflict_resolution");
    }
    if (historyFilter === "operations") {
      return timeline.filter((event) =>
        !["canonical_commit", "legacy_commit", "conflict_resolution"].includes(event.eventType)
      );
    }
    return timeline;
  }, [historyCenter, historyFilter]);

  async function runAction(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      setNotice(success);
      await loadState(selectedId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "작업에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function addExploration(event: FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      await request(`/api/projects/${selectedId}/exploration`, {
        method: "POST",
        body: JSON.stringify({ content: explorationText })
      });
      setExplorationText("");
    }, "Exploration으로 저장했습니다. Project Truth는 변경되지 않았습니다.");
  }

  async function createProposal(event: FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      await request(`/api/projects/${selectedId}/proposals`, {
        method: "POST",
        body: JSON.stringify({
          targetType: "truth",
          category: proposalCategory,
          content: proposalText,
          verificationStatus: "confirmed",
          reason: "사용자가 검토할 정본 변경 후보"
        })
      });
      setProposalText("");
    }, "변경 후보를 만들었습니다. 승인 전까지 정본은 유지됩니다.");
  }

  async function decideProposal(proposalId: string, decision: "approve" | "reject") {
    await runAction(async () => {
      await request(`/api/proposals/${proposalId}/${decision}`, { method: "POST", body: "{}" });
    }, decision === "approve" ? "승인된 변경을 정본에 Commit했습니다." : "변경 후보를 거절했습니다.");
  }

  async function openConflictCenter() {
    setBusy(true);
    try {
      await loadConflictCenter(selectedId);
      setConflictTargetId((current) => current || state?.truth[0]?.id || "");
      setConflictOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "충돌 정보를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function createConflictCandidate(event: FormEvent) {
    event.preventDefault();
    const target = state?.truth.find((entry) => entry.id === conflictTargetId);
    if (!target) return;
    setBusy(true);
    try {
      await request(`/api/projects/${selectedId}/proposals`, {
        method: "POST",
        body: JSON.stringify({
          targetType: "truth",
          targetId: target.id,
          category: target.category,
          content: conflictText,
          verificationStatus: "conflicted",
          reason: "현재 Project Truth와 양립하지 않아 사용자 결정 필요"
        })
      });
      setConflictText("");
      await Promise.all([loadState(selectedId), loadConflictCenter(selectedId)]);
      setNotice("충돌 후보를 만들었습니다. 정본은 변경되지 않았습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "충돌 후보 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveConflict(
    proposalId: string,
    decision: ConflictDecision,
    note: string
  ) {
    setBusy(true);
    try {
      await request(`/api/conflicts/${proposalId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision, note })
      });
      await Promise.all([loadState(selectedId), loadConflictCenter(selectedId)]);
      const message =
        decision === "keep_canonical"
          ? "기존 정본을 유지하고 충돌 후보를 종료했습니다."
          : decision === "temporary_exception"
            ? "정본은 유지하고 이번 작업용 임시 예외를 활성화했습니다."
            : "새 결정을 confirmed 정본으로 교체하고 이력을 기록했습니다.";
      setNotice(message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "충돌 해결에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function closeWorkingException(exceptionId: string) {
    setBusy(true);
    try {
      await request(`/api/exceptions/${exceptionId}/close`, { method: "POST", body: "{}" });
      await loadConflictCenter(selectedId);
      setNotice("임시 예외를 종료했습니다. 기존 정본은 그대로 유지됩니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "임시 예외 종료에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function openOperationsCenter() {
    setCurrentStateDraft(state?.currentState?.summary ?? "");
    setCurrentStateVerification(state?.currentState?.verification_status ?? "confirmed");
    setNewActionText("");
    setCheckpointStable(state?.checkpoint?.stableState ?? state?.currentState?.summary ?? "");
    setCheckpointUnverified(state?.checkpoint?.unverifiedChanges.join("\n") ?? "");
    setCheckpointResume(state?.checkpoint?.resumeInstruction ?? state?.nextActions[0]?.content ?? "");
    setOperationsOpen(true);
  }

  async function createCurrentStateCandidate(event: FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      await request(`/api/projects/${selectedId}/proposals`, {
        method: "POST",
        body: JSON.stringify({
          targetType: "current_state",
          content: currentStateDraft,
          verificationStatus: currentStateVerification,
          reason: "State Operations Center에서 생성한 Current State 변경 후보"
        })
      });
    }, "Current State 변경 후보를 만들었습니다. 승인 전까지 기존 상태를 유지합니다.");
  }

  async function createNextActionCandidate(event: FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      await request(`/api/projects/${selectedId}/proposals`, {
        method: "POST",
        body: JSON.stringify({
          targetType: "next_action",
          content: newActionText,
          verificationStatus: "confirmed",
          itemStatus: "pending",
          reason: "State Operations Center에서 생성한 Next Action 후보"
        })
      });
      setNewActionText("");
    }, "Next Action 후보를 승인 대기열에 추가했습니다.");
  }

  async function transitionAction(action: ActionEntry, status: string) {
    await runAction(async () => {
      await request(`/api/projects/${selectedId}/proposals`, {
        method: "POST",
        body: JSON.stringify({
          targetType: "next_action",
          targetId: action.id,
          content: action.content,
          verificationStatus: action.verification_status,
          itemStatus: status,
          reason: `Next Action 상태를 ${status}(으)로 전환`
        })
      });
    }, `${status} 전환 후보를 만들었습니다. 승인 후 반영됩니다.`);
  }

  async function promoteExploration(entryId: string, targetType: "truth" | "current_state" | "next_action") {
    await runAction(async () => {
      await request(`/api/projects/${selectedId}/exploration/${entryId}/promote`, {
        method: "POST",
        body: JSON.stringify({ targetType, category: "promoted_idea" })
      });
    }, "Exploration 승격 후보를 만들었습니다. 승인 전에는 open 상태를 유지합니다.");
  }

  async function dismissExploration(entryId: string) {
    await runAction(async () => {
      await request(`/api/projects/${selectedId}/exploration/${entryId}/dismiss`, {
        method: "POST",
        body: "{}"
      });
    }, "Exploration을 dismissed로 종료했습니다. 정본은 변경되지 않았습니다.");
  }

  async function saveCheckpointFromOperations(event: FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      await request(`/api/projects/${selectedId}/checkpoint`, {
        method: "POST",
        body: JSON.stringify({
          stableState: checkpointStable,
          unverifiedChanges: checkpointUnverified
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
          resumeInstruction: checkpointResume
        })
      });
    }, "Active Checkpoint를 최신 안정 지점으로 교체했습니다.");
  }

  async function clearCheckpointFromOperations() {
    await runAction(async () => {
      await request(`/api/projects/${selectedId}/checkpoint/clear`, {
        method: "POST",
        body: "{}"
      });
      setCheckpointStable("");
      setCheckpointUnverified("");
      setCheckpointResume("");
    }, "복구가 완료되어 Active Checkpoint를 해제했습니다.");
  }

  function hydrateStructureDrafts(result: ProjectStructureState) {
    setRegistryLocation(result.registry.projectLocation);
    setRegistryFocus(result.registry.currentFocus);
    setRegistryRelationships(result.registry.relationships.join("\n"));
    setPrimaryGoalDraft(result.project.primaryGoal);
  }

  async function openStructureCenter() {
    setBusy(true);
    try {
      const result = await loadStructure(selectedId);
      if (result) hydrateStructureDrafts(result);
      setStructureOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "프로젝트 구조를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function createStructureCandidate(
    operation: StructureOperation,
    payload: Record<string, unknown>,
    reason: string,
    targetId?: string
  ) {
    setBusy(true);
    try {
      await request(`/api/projects/${selectedId}/structure/proposals`, {
        method: "POST",
        body: JSON.stringify({ operation, targetId, payload, reason })
      });
      await loadStructure(selectedId);
      setNotice("구조 변경 후보를 만들었습니다. 승인 전에는 현재 구조를 유지합니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "구조 변경 후보 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function proposeRegistryUpdate(event: FormEvent) {
    event.preventDefault();
    await createStructureCandidate(
      "update_registry",
      {
        projectLocation: registryLocation,
        currentFocus: registryFocus,
        relationships: registryRelationships.split("\n").map((item) => item.trim()).filter(Boolean)
      },
      "Structure Center에서 Project Registry 갱신"
    );
  }

  async function proposePrimaryGoalUpdate(event: FormEvent) {
    event.preventDefault();
    await createStructureCandidate(
      "update_primary_goal",
      { primaryGoal: primaryGoalDraft },
      "Structure Center에서 Primary Goal 갱신",
      selectedId
    );
  }

  async function proposeWorkstream(event: FormEvent) {
    event.preventDefault();
    await createStructureCandidate(
      "create_workstream",
      { name: workstreamName, description: workstreamDescription, status: "active" },
      "Structure Center에서 교차 Workstream 생성"
    );
    setWorkstreamName("");
    setWorkstreamDescription("");
  }

  async function proposeNode(event: FormEvent) {
    event.preventDefault();
    await createStructureCandidate(
      "create_node",
      {
        nodeType,
        parentId: nodeType === "strategic_goal" ? null : nodeParent,
        workstreamId: nodeWorkstream || null,
        title: nodeTitle,
        description: nodeDescription,
        status: nodeStatus,
        verificationStatus: nodeVerification
      },
      "Structure Center에서 목표 계층 항목 생성"
    );
    setNodeTitle("");
    setNodeDescription("");
  }

  async function proposeNodeStatus(node: StructureNode, status: StructureNode["status"]) {
    await createStructureCandidate(
      "update_node",
      { status, verificationStatus: node.verificationStatus },
      `${node.nodeType} 상태를 ${status}(으)로 전환`,
      node.id
    );
  }

  async function promoteTaskToNextAction(node: StructureNode) {
    await runAction(async () => {
      await request(`/api/projects/${selectedId}/proposals`, {
        method: "POST",
        body: JSON.stringify({
          targetType: "next_action",
          content: node.title,
          verificationStatus: node.verificationStatus,
          itemStatus: "pending",
          reason: `Project Structure Task ${node.id}에서 실행 후보 생성`
        })
      });
    }, "Task를 Next Action 승인 후보로 연결했습니다.");
  }

  async function decideStructureProposal(proposalId: string, decision: "approve" | "reject") {
    setBusy(true);
    try {
      await request(`/api/structure-proposals/${proposalId}/${decision}`, {
        method: "POST",
        body: "{}"
      });
      const result = await loadStructure(selectedId);
      await Promise.all([loadState(selectedId), loadProjects(), loadHistoryCenter(selectedId)]);
      if (result) hydrateStructureDrafts(result);
      setNotice(decision === "approve" ? "구조 변경을 승인하고 History에 기록했습니다." : "구조 변경 후보를 거절했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "구조 변경 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function openArchiveCenter() {
    setBusy(true);
    try {
      const result = await loadArchiveCenter(selectedId);
      if (result) {
        setLifecycleTarget(result.project.status === "active" ? "paused" : "active");
        setLifecycleResume(result.manifest.checkpoint?.resumeInstruction ?? "");
      }
      setLifecycleReason("");
      setArchiveOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "보관 정보를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function openCommandCenter() {
    setBusy(true);
    try {
      await loadCommandCenter();
      setCommandOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Continuity Command Center를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function openSubmissionEvidence() {
    setBusy(true);
    try {
      await loadSubmissionEvidence();
      setEvidenceOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Submission Evidence를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function copySubmissionEvidence() {
    if (!submissionEvidence) return;
    try {
      await navigator.clipboard.writeText(submissionEvidence.markdown);
      setNotice("영문 Submission Evidence Markdown을 복사했습니다.");
    } catch {
      setNotice("클립보드 복사에 실패했습니다. Markdown을 다운로드해 주세요.");
    }
  }

  function downloadSubmissionEvidence() {
    if (!submissionEvidence) return;
    const blob = new Blob([submissionEvidence.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "LOGOS_CONTINUITY_SUBMISSION_EVIDENCE.md";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Submission Evidence Markdown 파일을 생성했습니다.");
  }

  function followCommandRecommendation(item: CommandCenterProject) {
    setCommandOpen(false);
    if (item.project.id !== selectedId) {
      setSelectedId(item.project.id);
      setNotice(`${item.project.name} 프로젝트를 열었습니다. Command Center 권장 작업: ${item.recommendedAction}`);
      return;
    }
    if (item.recommendedCenter === "conflict") openConflictCenter();
    if (item.recommendedCenter === "drift") openDriftCenter();
    if (item.recommendedCenter === "promotion") openPromotionCenter();
    if (item.recommendedCenter === "structure") openStructureCenter();
    if (item.recommendedCenter === "index") openProjectIndex();
    if (item.recommendedCenter === "operations") openOperationsCenter();
    if (item.recommendedCenter === "archive") openArchiveCenter();
    if (item.recommendedCenter === "project") {
      setNotice(item.recommendedAction);
    }
  }

  async function openProjectIndex() {
    setBusy(true);
    try {
      const result = await loadProjectIndex();
      const firstTarget = result.projects.find((project) => project.id !== selectedId);
      setRelationshipTarget(firstTarget?.id ?? "");
      setIndexOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Project Index를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function openPromotionCenter() {
    setBusy(true);
    try {
      await loadPromotionCenter(selectedId);
      setPromotionOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Context Promotion Center를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function createContextPromotion(
    reference: LinkedProjectReference,
    sourceType: "truth" | "current_state" | "next_action",
    sourceId?: string
  ) {
    if (!promotionReason.trim()) {
      setNotice("연결 맥락을 승격하려는 이유를 먼저 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      await request(`/api/projects/${selectedId}/context-promotions`, {
        method: "POST",
        body: JSON.stringify({
          relationshipId: reference.relationship.id,
          sourceProjectId: reference.project.id,
          sourceType,
          sourceId,
          reason: promotionReason
        })
      });
      await Promise.all([loadPromotionCenter(selectedId), loadState(selectedId)]);
      setPromotionReason("");
      setNotice("연결 맥락을 unverified 승인 후보로 만들었습니다. 정본은 아직 변경되지 않았습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "연결 맥락 승격 후보 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function decideContextPromotion(proposalId: string, decision: "approve" | "reject") {
    setBusy(true);
    try {
      await request(`/api/proposals/${proposalId}/${decision}`, { method: "POST", body: "{}" });
      await Promise.all([
        loadPromotionCenter(selectedId),
        loadState(selectedId),
        loadHistoryCenter(selectedId),
        loadDriftCenter(selectedId)
      ]);
      setNotice(decision === "approve"
        ? "연결 맥락 승격을 승인했습니다. 출처가 History에 보존됩니다."
        : "연결 맥락 승격 후보를 거절했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "연결 맥락 승격 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function openDriftCenter() {
    setBusy(true);
    try {
      await loadDriftCenter(selectedId);
      setDriftOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Provenance Drift Monitor를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function acknowledgeDrift(promotionId: string) {
    if (!driftNote.trim()) {
      setNotice("드리프트 확인 내용을 먼저 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      await request(`/api/projects/${selectedId}/provenance-drift/${promotionId}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ note: driftNote })
      });
      await Promise.all([
        loadDriftCenter(selectedId),
        loadArchiveCenter(selectedId),
        loadHistoryCenter(selectedId)
      ]);
      setDriftNote("");
      setNotice("현재 provenance drift를 확인 처리했습니다. 원본이 다시 바뀌면 경고가 재개됩니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "드리프트 확인 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function createRelationshipCandidate(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !relationshipTarget) return;
    setBusy(true);
    try {
      await request(`/api/projects/${selectedId}/relationship-proposals`, {
        method: "POST",
        body: JSON.stringify({
          operation: "create",
          targetProjectId: relationshipTarget,
          relationshipType,
          note: relationshipNote,
          reason: relationshipReason
        })
      });
      await loadProjectIndex();
      setRelationshipNote("");
      setRelationshipReason("");
      setNotice("프로젝트 관계 후보를 만들었습니다. 승인 전까지 그래프는 유지됩니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "관계 후보 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function createRelationshipRemoval(relationshipId: string) {
    setBusy(true);
    try {
      await request(`/api/projects/${selectedId}/relationship-proposals`, {
        method: "POST",
        body: JSON.stringify({
          operation: "remove",
          relationshipId,
          reason: "Project Index에서 관계 해제 요청"
        })
      });
      await loadProjectIndex();
      setNotice("관계 해제 후보를 만들었습니다. 승인 전까지 연결은 유지됩니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "관계 해제 후보 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function decideRelationshipProposal(proposalId: string, decision: "approve" | "reject") {
    setBusy(true);
    try {
      await request(`/api/relationship-proposals/${proposalId}/${decision}`, { method: "POST" });
      await Promise.all([loadProjectIndex(), loadProjects()]);
      setNotice(decision === "approve" ? "프로젝트 관계 변경을 승인했습니다." : "프로젝트 관계 후보를 거절했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "관계 후보 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function createLifecycleCandidate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await request(`/api/projects/${selectedId}/lifecycle/proposals`, {
        method: "POST",
        body: JSON.stringify({
          targetStatus: lifecycleTarget,
          reason: lifecycleReason,
          resumeInstruction: lifecycleResume
        })
      });
      await loadArchiveCenter(selectedId);
      setLifecycleReason("");
      setNotice("수명주기 변경 후보를 만들었습니다. 승인 전까지 프로젝트 상태는 유지됩니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "수명주기 변경 후보 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function decideLifecycleProposal(proposalId: string, decision: "approve" | "reject") {
    setBusy(true);
    try {
      await request(`/api/lifecycle-proposals/${proposalId}/${decision}`, {
        method: "POST",
        body: "{}"
      });
      const result = await loadArchiveCenter(selectedId);
      await Promise.all([loadState(selectedId), loadProjects(), loadHistoryCenter(selectedId)]);
      if (result) setLifecycleTarget(result.project.status === "active" ? "paused" : "active");
      setNotice(decision === "approve"
        ? "프로젝트 수명주기를 승인하고 보관 스냅샷과 History를 기록했습니다."
        : "수명주기 변경 후보를 거절했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "수명주기 변경 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function openHistoryCenter() {
    setBusy(true);
    try {
      await loadHistoryCenter(selectedId);
      setHistoryFilter("all");
      setHistoryOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "History를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function createHistoryRevert(eventId: string) {
    setBusy(true);
    try {
      await request(`/api/projects/${selectedId}/history/${eventId}/revert`, {
        method: "POST",
        body: "{}"
      });
      await Promise.all([loadState(selectedId), loadHistoryCenter(selectedId)]);
      setNotice("과거 상태를 직접 덮어쓰지 않고 승인 대기 복원 후보로 만들었습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "복원 후보 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function resumeProject(projectId: string) {
    setBusy(true);
    try {
      const [recoveryResult, briefResult] = await Promise.all([
        request<RecoveryResult>(`/api/projects/${projectId}/recover`, {
          method: "POST",
          body: "{}"
        }),
        request<ContinuityBrief>(`/api/projects/${projectId}/brief`)
      ]);
      setSelectedId(projectId);
      await loadState(projectId);
      setRecovery(recoveryResult);
      setBrief(briefResult);
      setSessionOpen(false);
      setBriefOpen(true);
      setNotice("프로젝트를 식별하고 정본 기반 Continuity Brief를 복구했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "복구에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function recognizeSession(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request<ProjectRecognitionResult>("/api/sessions/recognize", {
        method: "POST",
        body: JSON.stringify({ query: sessionQuery })
      });
      setRecognition(result);
      setNotice(
        result.confidence === "high"
          ? "프로젝트를 높은 신뢰도로 식별했습니다."
          : result.confidence === "medium"
            ? "복구 전에 프로젝트 확인이 필요합니다."
            : "프로젝트 근거가 부족해 일반 대화로 유지합니다."
      );
      if (result.confidence === "high" && result.selectedProjectId) {
        await resumeProject(result.selectedProjectId);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "프로젝트 인식에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function copyBrief() {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(brief.markdown);
      setNotice("Continuity Brief를 Markdown으로 복사했습니다.");
    } catch {
      setNotice("클립보드 복사에 실패했습니다. 브리프 내용을 직접 선택해 주세요.");
    }
  }

  async function processIntake(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request<IntakeResult>(`/api/projects/${selectedId}/intake`, {
        method: "POST",
        body: JSON.stringify({ text: intakeText })
      });
      setIntakeResult(result);
      await loadState(selectedId);
      if (result.outcome.type === "exploration_saved") {
        setNotice("미확정 발언을 Exploration에 저장했습니다. Truth는 유지됩니다.");
      } else if (result.outcome.type === "proposal_created") {
        setNotice("정본 후보를 승인 대기열에 추가했습니다. 아직 Commit되지 않았습니다.");
      } else {
        setNotice("일반 대화로 분류해 프로젝트 정본을 변경하지 않았습니다.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "분류에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function resetDemo() {
    setBusy(true);
    try {
      const project = await request<Project>("/api/demo/reset", { method: "POST", body: "{}" });
      await loadProjects();
      setSelectedId(project.id);
      await loadState(project.id);
      setIntakeText("");
      setIntakeResult(null);
      setNotice("Build Week 데모를 초기 상태로 복원했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "데모 초기화에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function closeJudgeSurfaces() {
    setCommandOpen(false);
    setDriftOpen(false);
    setPromotionOpen(false);
    setIndexOpen(false);
    setArchiveOpen(false);
    setStructureOpen(false);
    setHistoryOpen(false);
    setOperationsOpen(false);
    setConflictOpen(false);
    setContextOpen(false);
    setSessionOpen(false);
    setBriefOpen(false);
    setNewProjectOpen(false);
    setEvidenceOpen(false);
  }

  async function focusJudgeStep(index: number) {
    const nextIndex = clampJudgeStep(index);
    const step = JUDGE_MODE_STEPS[nextIndex];
    setJudgeStepIndex(nextIndex);
    closeJudgeSurfaces();
    if (step.target === "command") await openCommandCenter();
    if (step.target === "session") {
      setSessionQuery(step.sampleInput ?? "");
      setRecognition(null);
      setSessionOpen(true);
    }
    if (step.target === "intake") {
      setIntakeText(step.sampleInput ?? "");
      window.setTimeout(() => document.querySelector(".intake-console")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
    }
    if (step.target === "conflict") {
      setConflictText(step.sampleInput ?? "");
      await openConflictCenter();
    }
    if (step.target === "operations") openOperationsCenter();
    if (step.target === "history") await openHistoryCenter();
    if (step.target === "context") setContextOpen(true);
  }

  async function startJudgeMode() {
    setJudgeActive(true);
    setJudgeElapsed(0);
    setJudgeStepIndex(0);
    await focusJudgeStep(0);
    setNotice("Judge Mode를 시작했습니다. 안내 순서대로 3분 데모를 진행하세요.");
  }

  function stopJudgeMode() {
    setJudgeActive(false);
    closeJudgeSurfaces();
    setNotice("Judge Mode를 종료했습니다.");
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const project = await request<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          summary: form.get("summary"),
          primaryGoal: form.get("primaryGoal"),
          recognitionSignals: String(form.get("signals") ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        })
      });
      await loadProjects();
      setSelectedId(project.id);
      setNewProjectOpen(false);
      setNotice("명시적 요청으로 새 프로젝트를 생성했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "프로젝트 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return <main className="loading">LOGOS가 정본을 조립하고 있습니다.</main>;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <strong>LOGOS</strong>
            <span>Continuity</span>
          </div>
        </div>

        <div className="nav-label">PROJECT REGISTRY</div>
        <nav className="project-list">
          {projects.map((project) => (
            <button
              className={project.id === selectedId ? "project-button is-active" : "project-button"}
              key={project.id}
              onClick={() => setSelectedId(project.id)}
            >
              <span className="project-dot" />
              <span>
                <strong>{project.name}</strong>
                <small>{project.status}</small>
              </span>
            </button>
          ))}
        </nav>
        <button className="new-project" onClick={() => setNewProjectOpen(true)}>+ 새 프로젝트</button>

        <div className="sidebar-foot">
          <span>LOCAL STATE ENGINE</span>
          <strong>SQLite · approval gated</strong>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="crumb">Continuity / <strong>{state.project.name}</strong></div>
          <div className="top-actions">
            <span className="notice">{notice}</span>
            <button className="ghost-button" disabled={busy} onClick={resetDemo}>데모 초기화</button>
            <button className={judgeActive ? "judge-button is-active" : "judge-button"} disabled={busy} onClick={judgeActive ? stopJudgeMode : startJudgeMode}>{judgeActive ? "심사 종료" : "심사 모드"}</button>
            <button className="submission-button" disabled={busy} onClick={openSubmissionEvidence}>제출</button>
            <button className="command-button" disabled={busy} onClick={openCommandCenter}>커맨드</button>
            <button className="index-button" disabled={busy} onClick={openProjectIndex}>인덱스</button>
            <button className="promotion-button" disabled={busy} onClick={openPromotionCenter}>승격</button>
            <button className={driftCenter?.stats.activeDrifts ? "drift-button has-drift" : "drift-button"} disabled={busy} onClick={openDriftCenter}>드리프트 <b>{driftCenter?.stats.activeDrifts ?? 0}</b></button>
            <button className="archive-button" disabled={busy} onClick={openArchiveCenter}>보관</button>
            <button className="structure-button" disabled={busy} onClick={openStructureCenter}>구조</button>
            <button className="operations-button" disabled={busy} onClick={openOperationsCenter}>상태 운영</button>
            <button className="history-button" disabled={busy} onClick={openHistoryCenter}>이력</button>
            <button
              className={state.proposals.some((item) => item.proposed_verification === "conflicted") ? "conflict-button has-conflicts" : "conflict-button"}
              disabled={busy}
              onClick={openConflictCenter}
            >충돌 해결 <b>{state.proposals.filter((item) => item.proposed_verification === "conflicted").length}</b></button>
            <button className="ghost-button" onClick={() => setContextOpen(true)}>Context 보기</button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => {
                setSessionQuery("");
                setRecognition(null);
                setSessionOpen(true);
              }}
            >새 세션 시작</button>
          </div>
        </header>

        <section className="hero">
          <div>
            <span className="kicker">PRIMARY GOAL</span>
            <h1>{state.project.primaryGoal}</h1>
            <p>{state.project.summary}</p>
            <div className="signal-row">
              {state.project.recognitionSignals.map((signal) => <span key={signal}>#{signal}</span>)}
            </div>
          </div>
          <div className="confidence-panel">
            <span>STATE INTEGRITY</span>
            <div className="integrity-score">{verificationCounts.conflicted === 0 ? "SAFE" : "REVIEW"}</div>
            <dl>
              <div><dt>confirmed</dt><dd>{verificationCounts.confirmed}</dd></div>
              <div><dt>unverified</dt><dd>{verificationCounts.unverified}</dd></div>
              <div><dt>conflicted</dt><dd>{verificationCounts.conflicted}</dd></div>
            </dl>
          </div>
        </section>

        {recovery && (
          <>
            <section className="recovery-banner">
              <div className="pulse" />
              <div>
                <span>NEW SESSION RECOVERY</span>
                <strong>{recovery.recovery.stableState ?? "정본 기반 복구"}</strong>
                <p>{recovery.recovery.resumeInstruction ?? recovery.recovery.rule}</p>
              </div>
              <StatusBadge value={recovery.recovery.mode} />
            </section>
            {(recovery.bridge?.linkedProjectCount ?? recovery.context.linkedProjectReferences?.length ?? 0) > 0 && (
              <section className="context-bridge-banner">
                <div><span>REFERENCE-ONLY BRIDGE</span><strong>{recovery.bridge?.linkedProjectCount ?? recovery.context.linkedProjectReferences?.length} linked project(s)</strong></div>
                <p>{recovery.bridge?.rule ?? "연결 프로젝트는 탐색 참고 정보이며 현재 프로젝트 정본으로 병합되지 않습니다."}</p>
                <StatusBadge value="reference_only" />
              </section>
            )}
          </>
        )}

        <section className="intake-console">
          <div className="intake-heading">
            <div>
              <span>GPT-5.6 CONTINUITY ROUTER</span>
              <h2>한 문장으로 상태를 분류합니다</h2>
              <p>모델은 분류와 변경 후보만 만들며, Project Truth는 사용자 승인 전까지 유지됩니다.</p>
            </div>
            <div className={aiStatus.configured ? "ai-live" : "ai-fallback"}>
              <i />
              <span>{aiStatus.configured ? "GPT-5.6 LIVE" : "LOCAL SAFE MODE"}</span>
              <small>{aiStatus.configured ? aiStatus.model : "OPENAI_API_KEY 필요"}</small>
            </div>
          </div>
          <form className="intake-form" onSubmit={processIntake}>
            <div className="example-row">
              <span>TRY</span>
              <button type="button" onClick={() => setIntakeText("유료화도 생각해보자.")}>미확정 아이디어</button>
              <button type="button" onClick={() => setIntakeText("유료화를 공식 제품 목표로 확정한다.")}>명시적 확정</button>
              <button type="button" onClick={() => setIntakeText("다음 작업은 복구 E2E 테스트 구현이다.")}>다음 작업</button>
            </div>
            <div className="intake-entry">
              <textarea
                value={intakeText}
                onChange={(event) => setIntakeText(event.target.value)}
                placeholder="프로젝트에 반영할 발언을 입력하세요."
                required
              />
              <button disabled={busy}>분류하고 안전하게 반영</button>
            </div>
          </form>
          {intakeResult && (
            <div className="classification-result">
              <div>
                <span>CLASSIFIED AS</span>
                <strong>{intakeResult.classification.target.replace("_", " ")}</strong>
              </div>
              <StatusBadge value={intakeResult.classification.verificationStatus} />
              <dl>
                <div><dt>confidence</dt><dd>{intakeResult.classification.confidence}</dd></div>
                <div><dt>source</dt><dd>{intakeResult.classification.model}</dd></div>
              </dl>
              <p>{intakeResult.classification.rationale}</p>
            </div>
          )}
        </section>

        <div className="dashboard-grid">
          <section className="panel truth-panel">
            <SectionTitle eyebrow="CANONICAL" title="Project Truth" count={state.truth.length} />
            <div className="truth-list">
              {state.truth.map((item) => (
                <article key={item.id} className="truth-item">
                  <div className="truth-meta">
                    <span>{item.category}</span>
                    <small>v{item.version}</small>
                  </div>
                  <p>{item.content}</p>
                  <StatusBadge value={item.verification_status} />
                </article>
              ))}
            </div>
          </section>

          <section className="panel state-panel">
            <SectionTitle eyebrow="RIGHT NOW" title="Current State" />
            <div className="current-state">
              <div className="state-line" />
              <p>{state.currentState?.summary ?? "아직 Current State가 없습니다."}</p>
              {state.currentState && <StatusBadge value={state.currentState.verification_status} />}
            </div>
            <div className="subhead">NEXT ACTIONS</div>
            <div className="action-list">
              {state.nextActions.map((action, index) => (
                <article key={action.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{action.content}</strong><small>{action.status}</small></div>
                  <StatusBadge value={action.verification_status} />
                </article>
              ))}
            </div>
          </section>

          <section className="panel exploration-panel">
            <SectionTitle eyebrow="NON-CANONICAL" title="Exploration" count={state.exploration.length} />
            <p className="panel-note">아이디어는 이곳에 머물며 Truth를 자동 변경하지 않습니다.</p>
            <div className="exploration-list">
              {state.exploration.map((item) => (
                <article key={item.id}>
                  <span>?</span>
                  <p>{item.content}</p>
                  <small>{item.status}</small>
                </article>
              ))}
            </div>
            <form className="inline-form" onSubmit={addExploration}>
              <input
                value={explorationText}
                onChange={(event) => setExplorationText(event.target.value)}
                placeholder="예: 유료화도 생각해보자"
                required
              />
              <button disabled={busy}>탐색으로 저장</button>
            </form>
          </section>

          <section className="panel checkpoint-panel">
            <SectionTitle eyebrow="INTERRUPTION RECOVERY" title="Active Checkpoint" />
            {state.checkpoint ? (
              <>
                <div className="checkpoint-path">
                  <span>LAST STABLE POINT</span>
                  <strong>{state.checkpoint.stableState}</strong>
                </div>
                <div className="warning-box">
                  <span>UNVERIFIED</span>
                  <ul>{state.checkpoint.unverifiedChanges.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div className="resume-box">
                  <span>RESUME</span>
                  <p>{state.checkpoint.resumeInstruction}</p>
                </div>
              </>
            ) : <p className="empty">활성 Checkpoint가 없습니다.</p>}
          </section>

          <section className="panel proposal-panel">
            <SectionTitle eyebrow="APPROVAL GATE" title="Truth 변경 후보" count={state.proposals.length} />
            <form className="proposal-form" onSubmit={createProposal}>
              <input value={proposalCategory} onChange={(event) => setProposalCategory(event.target.value)} aria-label="범주" />
              <textarea
                value={proposalText}
                onChange={(event) => setProposalText(event.target.value)}
                placeholder="확정할 정본 변경 내용을 입력하세요."
                required
              />
              <button disabled={busy}>승인 대기열에 추가</button>
            </form>
            <div className="proposal-list">
              {state.proposals.length === 0 && <p className="empty">대기 중인 변경 후보가 없습니다.</p>}
              {state.proposals.map((proposal) => (
                <article key={proposal.id}>
                  <div><span>{proposal.category ?? proposal.target_type}</span><StatusBadge value={proposal.proposed_verification} /></div>
                  <p>{proposal.proposed_content}</p>
                  <small>{proposal.reason}</small>
                  <footer>
                    {proposal.proposed_verification === "conflicted" ? (
                      <button className="resolve" onClick={openConflictCenter}>Conflict Center에서 비교</button>
                    ) : (
                      <>
                        <button onClick={() => decideProposal(proposal.id, "reject")}>거절</button>
                        <button className="approve" onClick={() => decideProposal(proposal.id, "approve")}>승인 후 Commit</button>
                      </>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          </section>
        </div>
      </main>

      {judgeActive && (
        <aside className="judge-panel" aria-label="Judge Mode guide">
          <header>
            <div><span>GUIDED DEMO</span><strong>JUDGE MODE</strong></div>
            <div className={judgeElapsed > 180 ? "judge-timer is-over" : "judge-timer"}><span>ELAPSED</span><strong>{formatJudgeTime(judgeElapsed)}</strong></div>
            <button aria-label="Judge Mode 닫기" onClick={stopJudgeMode}>×</button>
          </header>
          <div className="judge-progress"><i style={{ width: `${((judgeStepIndex + 1) / JUDGE_MODE_STEPS.length) * 100}%` }} /></div>
          <div className="judge-step-meta"><span>STEP {judgeStepIndex + 1} / {JUDGE_MODE_STEPS.length}</span><span>{JUDGE_MODE_STEPS[judgeStepIndex].eyebrow}</span><span>{formatJudgeTime(JUDGE_MODE_TOTAL_SECONDS)} TARGET</span></div>
          <section>
            <h3>{JUDGE_MODE_STEPS[judgeStepIndex].title}</h3>
            <p>{JUDGE_MODE_STEPS[judgeStepIndex].narration}</p>
            <div><span>JUDGE PROOF</span><p>{JUDGE_MODE_STEPS[judgeStepIndex].proof}</p></div>
            {JUDGE_MODE_STEPS[judgeStepIndex].sampleInput && <blockquote>{JUDGE_MODE_STEPS[judgeStepIndex].sampleInput}</blockquote>}
          </section>
          <button className="judge-focus" disabled={busy} onClick={() => focusJudgeStep(judgeStepIndex)}>{JUDGE_MODE_STEPS[judgeStepIndex].actionLabel}</button>
          <footer>
            <button disabled={judgeStepIndex === 0 || busy} onClick={() => focusJudgeStep(judgeStepIndex - 1)}>이전</button>
            <button className="judge-reset" disabled={busy} onClick={resetDemo}>데모 초기화</button>
            <button className="judge-next" disabled={judgeStepIndex === JUDGE_MODE_STEPS.length - 1 || busy} onClick={() => focusJudgeStep(judgeStepIndex + 1)}>{judgeStepIndex === JUDGE_MODE_STEPS.length - 1 ? "데모 완료" : "다음 단계"}</button>
          </footer>
        </aside>
      )}

      {evidenceOpen && submissionEvidence && (
        <div className="modal-backdrop" onClick={() => setEvidenceOpen(false)}>
          <section className="evidence-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><span>SUBMISSION EVIDENCE CENTER</span><h2>공식 요건과 제출 증빙을 한곳에서 점검합니다</h2><p>자동으로 확인한 구현 증빙과 사용자가 완료해야 할 외부 제출 작업을 구분합니다. 준비도 점수는 완료되지 않은 항목을 숨기지 않습니다.</p></div>
              <button onClick={() => setEvidenceOpen(false)}>×</button>
            </header>

            <div className="evidence-overview">
              <div className="evidence-score"><strong>{submissionEvidence.readiness.score}</strong><span>READINESS</span></div>
              <div><span>READY</span><strong>{submissionEvidence.readiness.ready}</strong></div>
              <div><span>ACTION</span><strong>{submissionEvidence.readiness.actionRequired}</strong></div>
              <div className={submissionEvidence.readiness.blocked > 0 ? "alert" : ""}><span>BLOCKED</span><strong>{submissionEvidence.readiness.blocked}</strong></div>
              <div><span>DEADLINE</span><strong>JUL 22 · 09:00 KST</strong></div>
              <div><span>TRACK</span><strong>{submissionEvidence.event.track}</strong></div>
            </div>

            <div className="evidence-layout">
              <section className="evidence-requirements">
                <div className="evidence-title"><div><span>OFFICIAL REQUIREMENTS</span><h3>제출 준비 상태</h3></div><strong>{submissionEvidence.readiness.total}</strong></div>
                <div className="evidence-list">
                  {submissionEvidence.requirements.map((item) => (
                    <article className={`evidence-item evidence-item--${item.status}`} key={item.id}>
                      <header><span>{item.category}</span><StatusBadge value={item.status} /></header>
                      <h4>{item.label}</h4>
                      <p>{item.evidence}</p>
                      <small>NEXT · {item.action}</small>
                    </article>
                  ))}
                </div>
              </section>

              <aside className="evidence-copy">
                <div className="evidence-title"><div><span>ENGLISH SUBMISSION COPY</span><h3>{submissionEvidence.narrative.title}</h3></div><StatusBadge value="ready" /></div>
                <blockquote>{submissionEvidence.narrative.tagline}</blockquote>
                <section><span>PROJECT DESCRIPTION</span><p>{submissionEvidence.narrative.fullDescription}</p></section>
                <section><span>CORE FEATURES</span><ul>{submissionEvidence.features.map((feature) => <li key={feature}>{feature}</li>)}</ul></section>
                <section><span>CONTRIBUTION MATRIX</span>{submissionEvidence.contributions.map((item) => <article key={item.owner}><strong>{item.owner}</strong><p>{item.summary}</p></article>)}</section>
                <section><span>ARCHITECTURE</span>{submissionEvidence.architecture.map((item) => <article key={item.layer}><strong>{item.layer}</strong><p>{item.evidence}</p></article>)}</section>
                <section><span>TESTING INSTRUCTIONS</span><p>{submissionEvidence.narrative.testingInstructions}</p></section>
              </aside>
            </div>

            <footer>
              <div>{submissionEvidence.event.officialSources.map((source) => <a href={source} key={source} rel="noreferrer" target="_blank">OFFICIAL ↗</a>)}</div>
              {submissionEvidence.judgePackage.available && submissionEvidence.judgePackage.downloadUrl && <button className="judge-package-download" onClick={() => window.location.assign(submissionEvidence.judgePackage.downloadUrl!)}>Judge Build ZIP</button>}
              <button onClick={downloadSubmissionEvidence}>Markdown 다운로드</button>
              <button className="primary-button" onClick={copySubmissionEvidence}>영문 Evidence 복사</button>
            </footer>
          </section>
        </div>
      )}

      {commandOpen && commandCenter && (
        <div className="modal-backdrop" onClick={() => setCommandOpen(false)}>
          <section className="command-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><span>CONTINUITY COMMAND CENTER</span><h2>전체 프로젝트의 다음 위험을 우선순위화합니다</h2><p>점수는 충돌, 드리프트, 예외, 승인 대기, blocked action, Checkpoint 상태의 설명 가능한 감점 합계입니다.</p></div>
              <button onClick={() => setCommandOpen(false)}>×</button>
            </header>

            <div className="command-stats">
              <div><span>PROJECTS</span><strong>{commandCenter.stats.totalProjects}</strong></div>
              <div><span>AVG HEALTH</span><strong>{commandCenter.stats.averageHealth}</strong></div>
              <div><span>STABLE</span><strong>{commandCenter.stats.stableProjects}</strong></div>
              <div><span>ATTENTION</span><strong>{commandCenter.stats.attentionProjects}</strong></div>
              <div className={commandCenter.stats.criticalProjects > 0 ? "alert" : ""}><span>CRITICAL</span><strong>{commandCenter.stats.criticalProjects}</strong></div>
              <div><span>OPEN ISSUES</span><strong>{commandCenter.stats.totalOpenIssues}</strong></div>
            </div>

            <section className="command-queue">
              <div className="command-title"><div><span>PRIORITY QUEUE</span><h3>지금 먼저 처리할 프로젝트</h3></div><strong>{commandCenter.priorityQueue.length}</strong></div>
              {commandCenter.priorityQueue.map((item, index) => (
                <article className={`command-project command-project--${item.healthState}`} key={item.project.id}>
                  <div className="command-rank">{String(index + 1).padStart(2, "0")}</div>
                  <div className="command-health"><strong>{item.healthScore}</strong><span>{item.healthState}</span></div>
                  <div className="command-project-main">
                    <header><div><StatusBadge value={item.project.status} /><small>PRIORITY {item.priority}</small></div><h4>{item.project.name}</h4></header>
                    <p>{item.recommendedAction}</p>
                    <div className="command-issues">
                      {item.issues.length === 0 && <span className="stable">no active risk</span>}
                      {item.issues.map((issue) => <span className={issue.severity} key={issue.type}>{issue.type.replace("_", " ")} · {issue.count}</span>)}
                    </div>
                    <div className="command-signals">
                      <span>OPEN {item.signals.openActions}</span><span>APPROVAL {item.signals.pendingApprovals}</span><span>VERIFY {item.signals.unverifiedCanonical}</span><span>CHECKPOINT {item.signals.hasCheckpoint ? item.signals.checkpointStale ? `${item.signals.checkpointAgeDays}d stale` : "ready" : "missing"}</span>
                    </div>
                    {Object.values(item.penalties).some((value) => value > 0) && <small className="command-penalties">{Object.entries(item.penalties).filter(([, value]) => value > 0).map(([key, value]) => `${key} -${value}`).join(" · ")}</small>}
                  </div>
                  <footer><button disabled={busy} onClick={() => followCommandRecommendation(item)}>{item.project.id === selectedId && item.recommendedCenter !== "project" ? `${item.recommendedCenter} 열기` : "프로젝트 열기"}</button></footer>
                </article>
              ))}
            </section>
          </section>
        </div>
      )}

      {driftOpen && driftCenter && (
        <div className="modal-backdrop" onClick={() => setDriftOpen(false)}>
          <section className="drift-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><span>PROVENANCE DRIFT MONITOR</span><h2>승격 이후 원본 맥락의 변화를 감시합니다</h2><p>확인은 경고를 숨길 뿐 정본을 자동 변경하지 않으며, 원본이 다시 바뀌면 새 경고가 생성됩니다.</p></div>
              <button onClick={() => setDriftOpen(false)}>×</button>
            </header>

            <div className="drift-stats">
              <div><span>MONITORED</span><strong>{driftCenter.stats.monitoredPromotions}</strong></div>
              <div className={driftCenter.stats.activeDrifts > 0 ? "alert" : ""}><span>ACTIVE DRIFT</span><strong>{driftCenter.stats.activeDrifts}</strong></div>
              <div><span>CRITICAL</span><strong>{driftCenter.stats.criticalDrifts}</strong></div>
              <div><span>ACKNOWLEDGED</span><strong>{driftCenter.stats.acknowledgedDrifts}</strong></div>
              <div><span>STABLE</span><strong>{driftCenter.stats.stablePromotions}</strong></div>
            </div>

            <label className="drift-note">확인 메모<textarea value={driftNote} onChange={(event) => setDriftNote(event.target.value)} placeholder="현재 프로젝트에서 이 차이를 어떻게 처리할지 기록" /></label>

            <section className="drift-active">
              <div className="drift-title"><div><span>ACTIVE ALERTS</span><h3>확인이 필요한 provenance drift</h3></div><strong>{driftCenter.activeDrifts.length}</strong></div>
              {driftCenter.activeDrifts.length === 0 && <p className="empty">확인이 필요한 provenance drift가 없습니다.</p>}
              {driftCenter.activeDrifts.map((drift) => (
                <article key={drift.id}>
                  <header><div><StatusBadge value={drift.severity} /><small>{drift.sourceProjectName} · {drift.sourceType.replace("_", " ")}</small></div><span>{drift.driftState}</span></header>
                  <div className="drift-diff"><section><span>BASELINE</span><p>{snapshotText(drift.baselineSnapshot)}</p></section><b>→</b><section><span>CURRENT SOURCE</span><p>{snapshotText(drift.currentSnapshot)}</p></section></div>
                  <div className="drift-fields">{drift.driftFields.map((field) => <span key={field}>{field}</span>)}</div>
                  <footer><button onClick={() => { setDriftOpen(false); openPromotionCenter(); }}>새 승격 후보 검토</button><button className="acknowledge" disabled={busy || !driftNote.trim()} onClick={() => acknowledgeDrift(drift.id)}>현재 차이 확인</button></footer>
                </article>
              ))}
            </section>

            {driftCenter.acknowledgedDrifts.length > 0 && (
              <section className="drift-acknowledged">
                <div className="drift-title"><div><span>ACKNOWLEDGED</span><h3>확인된 차이</h3></div><strong>{driftCenter.acknowledgedDrifts.length}</strong></div>
                {driftCenter.acknowledgedDrifts.map((drift) => <article key={drift.id}><StatusBadge value={drift.severity} /><div><p>{snapshotText(drift.currentSnapshot)}</p><small>{drift.acknowledgement?.note} · {drift.sourceProjectName}</small></div></article>)}
              </section>
            )}

            {driftCenter.stablePromotions.length > 0 && (
              <section className="drift-stable">
                <div className="drift-title"><div><span>STABLE PROVENANCE</span><h3>원본과 일치하는 승격</h3></div><strong>{driftCenter.stablePromotions.length}</strong></div>
                {driftCenter.stablePromotions.map((drift) => <article key={drift.id}><StatusBadge value="stable" /><p>{snapshotText(drift.currentSnapshot)}</p><small>{drift.sourceProjectName} · {drift.sourceType.replace("_", " ")}</small></article>)}
              </section>
            )}
          </section>
        </div>
      )}

      {promotionOpen && promotionCenter && (
        <div className="modal-backdrop" onClick={() => setPromotionOpen(false)}>
          <section className="promotion-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><span>CONTEXT PROMOTION CENTER</span><h2>연결 맥락을 출처가 있는 승인 후보로 가져옵니다</h2><p>외부 프로젝트의 confirmed 항목도 현재 프로젝트에서는 unverified로 시작합니다.</p></div>
              <button onClick={() => setPromotionOpen(false)}>×</button>
            </header>

            <div className="promotion-rule">
              <StatusBadge value={promotionCenter.boundary.mode} />
              <p>{promotionCenter.boundary.rule}</p>
              <strong>{promotionCenter.references.length} LINKED PROJECTS</strong>
            </div>

            <label className="promotion-reason">승격 이유<textarea value={promotionReason} onChange={(event) => setPromotionReason(event.target.value)} placeholder="현재 프로젝트에서 이 맥락을 검토해야 하는 이유" /></label>

            <div className="promotion-reference-grid">
              {promotionCenter.references.length === 0 && <p className="empty">승인된 프로젝트 관계가 없어 승격할 참고 맥락이 없습니다.</p>}
              {promotionCenter.references.map((reference) => (
                <article className="promotion-reference" key={reference.relationship.id}>
                  <header><div><small>{reference.relationship.direction} · {reference.relationship.relationshipType.replace("_", " ")}</small><h3>{reference.project.name}</h3></div><StatusBadge value={reference.project.status} /></header>
                  {reference.relationship.note && <p className="promotion-note">{reference.relationship.note}</p>}

                  {reference.referenceState.currentState && (
                    <section>
                      <div><span>CURRENT STATE</span><StatusBadge value={reference.referenceState.currentState.verificationStatus} /></div>
                      <p>{reference.referenceState.currentState.summary}</p>
                      <button disabled={busy || !promotionReason.trim()} onClick={() => createContextPromotion(reference, "current_state")}>unverified 후보로 승격</button>
                    </section>
                  )}

                  {reference.referenceState.confirmedSignals.map((signal) => (
                    <section key={signal.id}>
                      <div><span>TRUTH · {signal.category}</span><StatusBadge value="confirmed" /></div>
                      <p>{signal.content}</p>
                      <button disabled={busy || !promotionReason.trim()} onClick={() => createContextPromotion(reference, "truth", signal.id)}>unverified 후보로 승격</button>
                    </section>
                  ))}

                  {reference.referenceState.nextActions.map((action) => (
                    <section key={action.id}>
                      <div><span>NEXT ACTION · {action.status}</span><StatusBadge value={action.verificationStatus} /></div>
                      <p>{action.content}</p>
                      <button disabled={busy || !promotionReason.trim()} onClick={() => createContextPromotion(reference, "next_action", action.id)}>unverified 후보로 승격</button>
                    </section>
                  ))}

                  {!reference.referenceState.currentState && reference.referenceState.confirmedSignals.length === 0 && reference.referenceState.nextActions.length === 0 && <p className="empty">승격 가능한 confirmed 참고 항목이 없습니다.</p>}
                </article>
              ))}
            </div>

            <section className="promotion-queue">
              <div className="promotion-title"><div><span>APPROVAL QUEUE</span><h3>출처 보존 승격 후보</h3></div><strong>{promotionCenter.pendingPromotions.length}</strong></div>
              {promotionCenter.pendingPromotions.length === 0 && <p className="empty">대기 중인 Context 승격 후보가 없습니다.</p>}
              {promotionCenter.pendingPromotions.map((promotion) => (
                <article key={promotion.id}>
                  <div><StatusBadge value={promotion.proposal.verificationStatus} /><small>{promotion.sourceProjectName} · {promotion.sourceType.replace("_", " ")}</small><p>{promotion.proposal.content}</p><span>{promotion.proposal.reason}</span></div>
                  <footer><button disabled={busy} onClick={() => decideContextPromotion(promotion.proposalId, "reject")}>거절</button><button className="approve" disabled={busy} onClick={() => decideContextPromotion(promotion.proposalId, "approve")}>승인 후 Commit</button></footer>
                </article>
              ))}
            </section>

            {promotionCenter.recentPromotions.length > 0 && (
              <section className="promotion-history">
                <div className="promotion-title"><div><span>PROVENANCE</span><h3>최근 승격 처리</h3></div><strong>{promotionCenter.recentPromotions.length}</strong></div>
                {promotionCenter.recentPromotions.map((promotion) => <article key={promotion.id}><StatusBadge value={promotion.status} /><p>{promotion.proposal.content}</p><small>{promotion.sourceProjectName} · {promotion.sourceType.replace("_", " ")}</small></article>)}
              </section>
            )}
          </section>
        </div>
      )}

      {indexOpen && projectIndex && (
        <div className="modal-backdrop" onClick={() => setIndexOpen(false)}>
          <section className="index-modal" onClick={(event) => event.stopPropagation()}>
            <header className="index-header">
              <div><span>PROJECT INDEX & RELATIONSHIP MAP</span><h2>프로젝트 전체 상태와 연결을 탐색합니다</h2><p>관계 생성과 해제는 승인 후 반영되며 양쪽 프로젝트 History에 기록됩니다.</p></div>
              <button onClick={() => setIndexOpen(false)}>×</button>
            </header>

            <div className="index-stats">
              <div><span>PROJECTS</span><strong>{projectIndex.stats.totalProjects}</strong></div>
              <div><span>ACTIVE</span><strong>{projectIndex.stats.activeProjects}</strong></div>
              <div><span>ARCHIVED</span><strong>{projectIndex.stats.archivedProjects}</strong></div>
              <div><span>RELATIONS</span><strong>{projectIndex.stats.relationships}</strong></div>
              <div className={projectIndex.stats.pendingApprovals > 0 ? "attention" : ""}><span>PENDING</span><strong>{projectIndex.stats.pendingApprovals}</strong></div>
            </div>

            <div className="index-layout">
              <section className="index-projects">
                <div className="index-section-title"><span>PORTFOLIO</span><h3>프로젝트 상태 인덱스</h3></div>
                <div className="index-project-grid">
                  {projectIndex.projects.map((project) => (
                    <article className={project.id === selectedId ? "index-project-card selected" : "index-project-card"} key={project.id}>
                      <header><StatusBadge value={project.status} /><small>{project.hasCheckpoint ? "CHECKPOINT" : "NO CHECKPOINT"}</small></header>
                      <h4>{project.name}</h4><p>{project.currentFocus || project.summary}</p>
                      <dl>
                        <div><dt>TRUTH</dt><dd>{project.truthCount}</dd></div>
                        <div><dt>OPEN</dt><dd>{project.openActionCount}</dd></div>
                        <div><dt>APPROVAL</dt><dd>{project.pendingApprovalCount}</dd></div>
                        <div><dt>LINKS</dt><dd>{project.relationshipCount}</dd></div>
                      </dl>
                      {project.id !== selectedId && <button onClick={() => { setSelectedId(project.id); setIndexOpen(false); }}>이 프로젝트 열기</button>}
                    </article>
                  ))}
                </div>
              </section>

              <aside className="index-map-panel">
                <div className="index-section-title"><span>RELATIONSHIP MAP</span><h3>정규화된 프로젝트 연결</h3></div>
                <div className="relationship-list">
                  {projectIndex.relationships.length === 0 && <p className="empty">아직 승인된 프로젝트 관계가 없습니다.</p>}
                  {projectIndex.relationships.map((relationship) => (
                    <article key={relationship.id}>
                      <div><strong>{relationship.sourceProjectName}</strong><span>{relationship.relationshipType.replace("_", " ")} →</span><strong>{relationship.targetProjectName}</strong></div>
                      {relationship.note && <p>{relationship.note}</p>}
                      {relationship.sourceProjectId === selectedId && <button disabled={busy} onClick={() => createRelationshipRemoval(relationship.id)}>해제 후보</button>}
                    </article>
                  ))}
                </div>

                <form className="relationship-form" onSubmit={createRelationshipCandidate}>
                  <span>NEW RELATIONSHIP CANDIDATE</span>
                  {projectIndex.projects.filter((project) => project.id !== selectedId).length === 0 ? (
                    <p className="empty">관계를 만들려면 다른 프로젝트가 하나 이상 필요합니다.</p>
                  ) : (
                    <>
                      <label>대상 프로젝트<select value={relationshipTarget} onChange={(event) => setRelationshipTarget(event.target.value)}>{projectIndex.projects.filter((project) => project.id !== selectedId).map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
                      <label>관계 유형<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value as RelationshipType)}><option value="depends_on">depends on</option><option value="supports">supports</option><option value="related_to">related to</option><option value="supersedes">supersedes</option></select></label>
                      <label>관계 설명<input value={relationshipNote} onChange={(event) => setRelationshipNote(event.target.value)} placeholder="두 프로젝트가 연결되는 이유" /></label>
                      <label>변경 이유<textarea value={relationshipReason} onChange={(event) => setRelationshipReason(event.target.value)} required /></label>
                      <button className="primary-button" disabled={busy || state.project.status !== "active"}>승인 후보 만들기</button>
                    </>
                  )}
                </form>
              </aside>
            </div>

            <section className="index-pending">
              <div className="index-section-title"><span>APPROVAL QUEUE</span><h3>관계 변경 후보</h3></div>
              {projectIndex.pendingProposals.length === 0 && <p className="empty">대기 중인 관계 변경 후보가 없습니다.</p>}
              {projectIndex.pendingProposals.map((proposal) => (
                <article key={proposal.id}>
                  <div><StatusBadge value={proposal.operation} /><strong>{proposal.sourceProjectName}</strong><span>{proposal.relationshipType?.replace("_", " ") ?? "relationship"} →</span><strong>{proposal.targetProjectName}</strong><p>{proposal.reason}</p></div>
                  <footer><button disabled={busy} onClick={() => decideRelationshipProposal(proposal.id, "reject")}>거절</button><button className="approve" disabled={busy} onClick={() => decideRelationshipProposal(proposal.id, "approve")}>승인 후 반영</button></footer>
                </article>
              ))}
            </section>
          </section>
        </div>
      )}

      {archiveOpen && archiveCenter && (
        <div className="modal-backdrop" onClick={() => setArchiveOpen(false)}>
          <section className="archive-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>ARCHIVE & LIFECYCLE CENTER</span>
                <h2>프로젝트를 삭제하지 않고 안전하게 보관합니다</h2>
                <p>보관과 복원 모두 승인 후 반영되며, 매니페스트와 복귀 지시가 History에 남습니다.</p>
              </div>
              <button onClick={() => setArchiveOpen(false)}>×</button>
            </header>

            <div className="archive-status-grid">
              <div><span>CURRENT STATUS</span><strong>{archiveCenter.project.status}</strong></div>
              <div><span>TRUTH</span><strong>{archiveCenter.manifest.truthEntries}</strong></div>
              <div><span>OPEN ACTIONS</span><strong>{archiveCenter.manifest.openNextActions}</strong></div>
              <div><span>HISTORY</span><strong>{archiveCenter.manifest.historyEvents}</strong></div>
              <div><span>STRUCTURE</span><strong>{archiveCenter.manifest.structureNodes}</strong></div>
              <div><span>ARCHIVE READY</span><strong className={archiveCenter.safety.archiveReady ? "is-safe" : "is-blocked"}>{archiveCenter.safety.archiveReady ? "YES" : "BLOCKED"}</strong></div>
            </div>

            <div className="archive-workspace">
              <form className="archive-proposal-card" onSubmit={createLifecycleCandidate}>
                <div className="archive-title"><span>LIFECYCLE PROPOSAL</span><StatusBadge value={archiveCenter.project.status} /></div>
                <label>전환 상태
                  <select value={lifecycleTarget} onChange={(event) => setLifecycleTarget(event.target.value as ProjectStatus)}>
                    {archiveCenter.project.status === "active" ? (
                      <><option value="paused">paused</option><option value="dormant">dormant</option><option value="abandoned">abandoned</option></>
                    ) : <option value="active">active · restore</option>}
                  </select>
                </label>
                <label>변경 이유<textarea value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} required /></label>
                <label>복귀 지시<textarea value={lifecycleResume} onChange={(event) => setLifecycleResume(event.target.value)} placeholder="다시 시작할 때 가장 먼저 확인할 내용" /></label>
                <button disabled={busy || archiveCenter.pendingProposals.length > 0}>승인 대기열에 추가</button>
              </form>

              <section className="archive-safety-card">
                <div className="archive-title"><span>SAFETY GATE</span><strong>{archiveCenter.safety.blockers.length}</strong></div>
                {archiveCenter.safety.blockers.length === 0 ? (
                  <div className="archive-ready"><b>READY</b><p>미결 승인과 활성 예외가 없습니다. 보관 스냅샷을 만들 수 있습니다.</p></div>
                ) : (
                  <div className="archive-blockers">
                    {archiveCenter.safety.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
                  </div>
                )}
                <dl>
                  <div><dt>Canonical approvals</dt><dd>{archiveCenter.safety.pendingCanonical}</dd></div>
                  <div><dt>Structure approvals</dt><dd>{archiveCenter.safety.pendingStructure}</dd></div>
                  <div><dt>Working exceptions</dt><dd>{archiveCenter.safety.activeExceptions}</dd></div>
                  <div><dt>Open exploration</dt><dd>{archiveCenter.manifest.openExploration}</dd></div>
                </dl>
                {archiveCenter.manifest.checkpoint && (
                  <div className="archive-checkpoint">
                    <span>ACTIVE CHECKPOINT</span>
                    <strong>{archiveCenter.manifest.checkpoint.stableState}</strong>
                    <p>{archiveCenter.manifest.checkpoint.resumeInstruction}</p>
                  </div>
                )}
              </section>
            </div>

            <section className="archive-queue">
              <div className="archive-section-title"><div><span>LIFECYCLE APPROVAL QUEUE</span><h3>승인 전에는 현재 상태를 유지합니다</h3></div><strong>{archiveCenter.pendingProposals.length}</strong></div>
              {archiveCenter.pendingProposals.length === 0 && <p className="empty">대기 중인 수명주기 변경 후보가 없습니다.</p>}
              {archiveCenter.pendingProposals.map((proposal) => (
                <article key={proposal.id}>
                  <div><StatusBadge value={proposal.targetStatus} /><time>{new Date(proposal.createdAt).toLocaleString()}</time></div>
                  <strong>{archiveCenter.project.status} → {proposal.targetStatus}</strong>
                  <p>{proposal.reason}</p>
                  {proposal.resumeInstruction && <small>{proposal.resumeInstruction}</small>}
                  <footer><button disabled={busy} onClick={() => decideLifecycleProposal(proposal.id, "reject")}>거절</button><button className="approve" disabled={busy} onClick={() => decideLifecycleProposal(proposal.id, "approve")}>승인 후 적용</button></footer>
                </article>
              ))}
            </section>

            <section className="archive-history">
              <div className="archive-section-title"><div><span>ARCHIVE SNAPSHOTS</span><h3>삭제 없는 보관 기록</h3></div><strong>{archiveCenter.snapshots.length}</strong></div>
              {archiveCenter.snapshots.length === 0 && <p className="empty">아직 보관 스냅샷이 없습니다.</p>}
              <div className="archive-snapshot-list">
                {archiveCenter.snapshots.map((snapshot) => (
                  <article key={snapshot.id}>
                    <header><div><StatusBadge value={snapshot.status} /><strong>{snapshot.previousStatus} → {snapshot.archivedStatus}</strong></div><time>{new Date(snapshot.archivedAt).toLocaleString()}</time></header>
                    <p>{snapshot.reason}</p>
                    <div className="snapshot-counts">
                      <span>truth {String(snapshot.manifest.truthEntries ?? 0)}</span>
                      <span>actions {String(snapshot.manifest.nextActions ?? 0)}</span>
                      <span>history {String(snapshot.manifest.historyEvents ?? 0)}</span>
                      <span>nodes {String(snapshot.manifest.structureNodes ?? 0)}</span>
                    </div>
                    {snapshot.resumeInstruction && <small>RESUME · {snapshot.resumeInstruction}</small>}
                  </article>
                ))}
              </div>
            </section>
          </section>
        </div>
      )}

      {structureOpen && structure && (
        <div className="modal-backdrop" onClick={() => setStructureOpen(false)}>
          <section className="structure-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>PROJECT STRUCTURE CENTER</span>
                <h2>목표를 실행 가능한 계층으로 운영합니다</h2>
                <p>Registry → Primary Goal → Strategic Goal → Milestone → Task를 승인 기반으로 연결합니다.</p>
              </div>
              <button onClick={() => setStructureOpen(false)}>×</button>
            </header>

            <div className="structure-overview">
              <div><span>CURRENT FOCUS</span><strong>{structure.registry.currentFocus || "not set"}</strong></div>
              <div><span>WORKSTREAMS</span><strong>{structure.workstreams.length}</strong></div>
              <div><span>GOAL NODES</span><strong>{structure.nodes.length}</strong></div>
              <div><span>PENDING</span><strong>{structure.pendingProposals.length}</strong></div>
            </div>

            <div className="structure-editors">
              <form className="structure-card" onSubmit={proposeRegistryUpdate}>
                <div className="structure-card-title"><span>01 / PROJECT REGISTRY</span><StatusBadge value="canonical" /></div>
                <label>프로젝트 위치<input value={registryLocation} onChange={(event) => setRegistryLocation(event.target.value)} required /></label>
                <label>현재 초점<textarea value={registryFocus} onChange={(event) => setRegistryFocus(event.target.value)} required /></label>
                <label>관계 — 한 줄에 하나<textarea value={registryRelationships} onChange={(event) => setRegistryRelationships(event.target.value)} /></label>
                <button disabled={busy}>Registry 변경 후보</button>
              </form>

              <form className="structure-card" onSubmit={proposePrimaryGoalUpdate}>
                <div className="structure-card-title"><span>02 / PRIMARY GOAL</span><StatusBadge value="canonical" /></div>
                <label>최상위 목적<textarea value={primaryGoalDraft} onChange={(event) => setPrimaryGoalDraft(event.target.value)} required /></label>
                <p className="structure-note">Primary Goal은 프로젝트당 하나이며 승인 후에만 교체됩니다.</p>
                <button disabled={busy}>Primary Goal 변경 후보</button>
              </form>

              <form className="structure-card" onSubmit={proposeWorkstream}>
                <div className="structure-card-title"><span>03 / WORKSTREAM</span><strong>{structure.workstreams.length}</strong></div>
                <label>이름<input value={workstreamName} onChange={(event) => setWorkstreamName(event.target.value)} placeholder="예: Product & Demo" required /></label>
                <label>설명<textarea value={workstreamDescription} onChange={(event) => setWorkstreamDescription(event.target.value)} /></label>
                <button disabled={busy}>Workstream 후보 추가</button>
                <div className="workstream-chips">
                  {structure.workstreams.map((workstream) => (
                    <span key={workstream.id}>{workstream.name}<small>{workstream.status}</small></span>
                  ))}
                </div>
              </form>

              <form className="structure-card node-editor" onSubmit={proposeNode}>
                <div className="structure-card-title"><span>04 / GOAL NODE</span><strong>{structure.nodes.length}</strong></div>
                <div className="structure-field-row">
                  <label>유형<select value={nodeType} onChange={(event) => { setNodeType(event.target.value as StructureNode["nodeType"]); setNodeParent(""); }}>
                    <option value="strategic_goal">Strategic Goal</option>
                    <option value="milestone">Milestone</option>
                    <option value="task">Task</option>
                  </select></label>
                  <label>상태<select value={nodeStatus} onChange={(event) => setNodeStatus(event.target.value as StructureNode["status"])}>
                    <option value="planned">planned</option><option value="active">active</option><option value="blocked">blocked</option><option value="completed">completed</option>
                  </select></label>
                  <label>검증<select value={nodeVerification} onChange={(event) => setNodeVerification(event.target.value as Verification)}>
                    <option value="confirmed">confirmed</option><option value="unverified">unverified</option><option value="conflicted">conflicted</option>
                  </select></label>
                </div>
                {nodeType !== "strategic_goal" && (
                  <label>상위 항목<select value={nodeParent} onChange={(event) => setNodeParent(event.target.value)} required>
                    <option value="">선택</option>
                    {structure.nodes
                      .filter((node) => node.nodeType === (nodeType === "milestone" ? "strategic_goal" : "milestone"))
                      .map((node) => <option value={node.id} key={node.id}>{node.title}</option>)}
                  </select></label>
                )}
                <label>Workstream<select value={nodeWorkstream} onChange={(event) => setNodeWorkstream(event.target.value)}>
                  <option value="">없음</option>{structure.workstreams.map((workstream) => <option key={workstream.id} value={workstream.id}>{workstream.name}</option>)}
                </select></label>
                <label>제목<input value={nodeTitle} onChange={(event) => setNodeTitle(event.target.value)} required /></label>
                <label>설명<textarea value={nodeDescription} onChange={(event) => setNodeDescription(event.target.value)} /></label>
                <button disabled={busy}>계층 항목 후보 추가</button>
              </form>
            </div>

            <section className="structure-tree-section">
              <div className="structure-section-title"><div><span>CANONICAL HIERARCHY</span><h3>Strategic Goals · Milestones · Tasks</h3></div><strong>{structure.hierarchy.length}</strong></div>
              {structure.hierarchy.length === 0 && <p className="empty">승인된 목표 계층이 없습니다.</p>}
              <div className="structure-tree">
                {structure.hierarchy.map((goal) => (
                  <article className="goal-branch" key={goal.id}>
                    <header>
                      <div><span>STRATEGIC GOAL</span><h4>{goal.title}</h4></div>
                      <div><StatusBadge value={goal.verificationStatus} /><small>{goal.status}</small></div>
                    </header>
                    <p>{goal.description}</p>
                    <footer>
                      {goal.status !== "active" && <button disabled={busy} onClick={() => proposeNodeStatus(goal, "active")}>활성 후보</button>}
                      {goal.status !== "completed" && <button disabled={busy} onClick={() => proposeNodeStatus(goal, "completed")}>완료 후보</button>}
                    </footer>
                    <div className="milestone-list">
                      {goal.milestones.map((milestone) => (
                        <article className="milestone-branch" key={milestone.id}>
                          <header><div><span>MILESTONE</span><h5>{milestone.title}</h5></div><div><StatusBadge value={milestone.verificationStatus} /><small>{milestone.status}</small></div></header>
                          <p>{milestone.description}</p>
                          <footer>
                            {milestone.status !== "active" && <button disabled={busy} onClick={() => proposeNodeStatus(milestone, "active")}>활성 후보</button>}
                            {milestone.status !== "completed" && <button disabled={busy} onClick={() => proposeNodeStatus(milestone, "completed")}>완료 후보</button>}
                          </footer>
                          <div className="task-list">
                            {milestone.tasks.map((task) => (
                              <article key={task.id}>
                                <div><span>TASK</span><strong>{task.title}</strong></div>
                                <div><StatusBadge value={task.verificationStatus} /><small>{task.status}</small></div>
                                <footer>
                                  {task.status !== "active" && task.status !== "completed" && <button disabled={busy} onClick={() => proposeNodeStatus(task, "active")}>진행 후보</button>}
                                  {task.status !== "completed" && <button disabled={busy} onClick={() => proposeNodeStatus(task, "completed")}>완료 후보</button>}
                                  <button className="task-action" disabled={busy || task.verificationStatus !== "confirmed"} onClick={() => promoteTaskToNextAction(task)}>Next Action 후보</button>
                                </footer>
                              </article>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="structure-approval">
              <div className="structure-section-title"><div><span>STRUCTURE APPROVAL QUEUE</span><h3>승인 전에는 계층을 변경하지 않습니다</h3></div><strong>{structure.pendingProposals.length}</strong></div>
              {structure.pendingProposals.length === 0 && <p className="empty">대기 중인 구조 변경 후보가 없습니다.</p>}
              <div className="structure-proposals">
                {structure.pendingProposals.map((proposal) => (
                  <article key={proposal.id}>
                    <div><span>{proposal.operation.replaceAll("_", " ")}</span><time>{new Date(proposal.createdAt).toLocaleString()}</time></div>
                    <strong>{String(proposal.payload.title ?? proposal.payload.name ?? proposal.payload.primaryGoal ?? proposal.payload.currentFocus ?? proposal.payload.status ?? "structure update")}</strong>
                    <p>{proposal.reason}</p>
                    <footer><button disabled={busy} onClick={() => decideStructureProposal(proposal.id, "reject")}>거절</button><button className="approve" disabled={busy} onClick={() => decideStructureProposal(proposal.id, "approve")}>승인 후 Commit</button></footer>
                  </article>
                ))}
              </div>
            </section>
          </section>
        </div>
      )}

      {historyOpen && historyCenter && (
        <div className="modal-backdrop" onClick={() => setHistoryOpen(false)}>
          <section className="history-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>HISTORY & PROVENANCE CENTER</span>
                <h2>변경의 이유와 결과를 추적합니다</h2>
                <p>복원은 현재 정본을 직접 바꾸지 않고 승인 대기 후보를 생성합니다.</p>
              </div>
              <button onClick={() => setHistoryOpen(false)}>×</button>
            </header>

            <div className="history-stats">
              <div><span>TOTAL EVENTS</span><strong>{historyCenter.stats.total}</strong></div>
              <div><span>CANONICAL</span><strong>{historyCenter.stats.canonicalCommits}</strong></div>
              <div><span>CONFLICTS</span><strong>{historyCenter.stats.conflictResolutions}</strong></div>
              <div><span>OPERATIONS</span><strong>{historyCenter.stats.operationalEvents}</strong></div>
              <div><span>RESTORABLE</span><strong>{historyCenter.stats.revertible}</strong></div>
            </div>

            <div className="history-toolbar">
              {[
                ["all", "전체"],
                ["canonical", "정본 Commit"],
                ["conflict", "충돌 해결"],
                ["operations", "운영 이벤트"]
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={historyFilter === value ? "is-active" : ""}
                  onClick={() => setHistoryFilter(value)}
                >{label}</button>
              ))}
            </div>

            <div className="history-timeline">
              {visibleHistory.length === 0 && <p className="empty">선택한 범주의 이력이 없습니다.</p>}
              {visibleHistory.map((event) => (
                <article key={event.id} className={`history-event event-${event.eventType}`}>
                  <div className="history-rail"><i /><span /></div>
                  <div className="history-event-body">
                    <header>
                      <div>
                        <StatusBadge value={event.eventType} />
                        {event.targetType && <small>{event.targetType.replace("_", " ")}</small>}
                      </div>
                      <time>{new Date(event.createdAt).toLocaleString()}</time>
                    </header>
                    <h3>{event.summary}</h3>
                    {(event.beforeSnapshot || event.afterSnapshot) && (
                      <div className="history-diff">
                        <section>
                          <span>BEFORE</span>
                          <p>{snapshotText(event.beforeSnapshot)}</p>
                        </section>
                        <b>→</b>
                        <section>
                          <span>AFTER</span>
                          <p>{snapshotText(event.afterSnapshot)}</p>
                        </section>
                      </div>
                    )}
                    <footer>
                      <div>
                        <span>{event.sourceType.replace("_", " ")}</span>
                        {typeof event.metadata.reason === "string" && <small>{event.metadata.reason}</small>}
                      </div>
                      {event.revertible && (
                        <button disabled={busy} onClick={() => createHistoryRevert(event.id)}>
                          이 상태로 복원 후보
                        </button>
                      )}
                    </footer>
                  </div>
                </article>
              ))}
            </div>

            {state.proposals.length > 0 && (
              <div className="history-pending-banner">
                <span>PENDING APPROVAL</span>
                <strong>{state.proposals.length}개의 변경 후보가 정본 반영을 기다립니다.</strong>
                <button onClick={() => { setHistoryOpen(false); openOperationsCenter(); }}>승인 대기열 열기</button>
              </div>
            )}
          </section>
        </div>
      )}

      {operationsOpen && (
        <div className="modal-backdrop" onClick={() => setOperationsOpen(false)}>
          <section className="operations-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>STATE OPERATIONS CENTER</span>
                <h2>현재 상태를 안전하게 운영합니다</h2>
                <p>정본 변경은 후보와 승인을 거치고, Exploration과 Checkpoint는 각자의 역할을 유지합니다.</p>
              </div>
              <button onClick={() => setOperationsOpen(false)}>×</button>
            </header>

            <div className="operations-grid">
              <section className="operation-card current-operation">
                <div className="operation-title"><span>01 / CURRENT STATE</span><StatusBadge value={state.currentState?.verification_status ?? "empty"} /></div>
                <form onSubmit={createCurrentStateCandidate}>
                  <textarea
                    value={currentStateDraft}
                    onChange={(event) => setCurrentStateDraft(event.target.value)}
                    placeholder="현재 실제 진행 상태"
                    required
                  />
                  <select
                    aria-label="Current State 검증 상태"
                    value={currentStateVerification}
                    onChange={(event) => setCurrentStateVerification(event.target.value as Verification)}
                  >
                    <option value="confirmed">confirmed</option>
                    <option value="unverified">unverified</option>
                    <option value="conflicted">conflicted</option>
                  </select>
                  <button disabled={busy}>변경 후보 생성</button>
                </form>
                <small>승인 전에는 기존 Current State가 유지됩니다.</small>
              </section>

              <section className="operation-card action-operation">
                <div className="operation-title"><span>02 / NEXT ACTIONS</span><strong>{state.nextActions.length}</strong></div>
                <form onSubmit={createNextActionCandidate}>
                  <input
                    value={newActionText}
                    onChange={(event) => setNewActionText(event.target.value)}
                    placeholder="새 Next Action"
                    required
                  />
                  <button disabled={busy}>후보 추가</button>
                </form>
                <div className="operation-action-list">
                  {state.nextActions.map((action) => (
                    <article key={action.id}>
                      <div><StatusBadge value={action.verification_status} /><small>{action.status}</small></div>
                      <p>{action.content}</p>
                      <footer>
                        {action.status !== "in_progress" && action.status !== "completed" && (
                          <button disabled={busy} onClick={() => transitionAction(action, "in_progress")}>진행 시작</button>
                        )}
                        {action.status !== "blocked" && action.status !== "completed" && (
                          <button disabled={busy} onClick={() => transitionAction(action, "blocked")}>차단</button>
                        )}
                        {action.status !== "completed" && (
                          <button
                            className="complete"
                            disabled={busy || action.verification_status !== "confirmed"}
                            onClick={() => transitionAction(action, "completed")}
                          >완료</button>
                        )}
                      </footer>
                    </article>
                  ))}
                </div>
              </section>

              <section className="operation-card exploration-operation">
                <div className="operation-title"><span>03 / EXPLORATION</span><strong>{state.exploration.filter((item) => item.status === "open").length}</strong></div>
                <p className="operation-note">승격은 즉시 이동이 아니라 승인 대기 후보를 만듭니다.</p>
                <div className="operation-exploration-list">
                  {state.exploration.filter((item) => item.status === "open").length === 0 && <p className="empty">열린 Exploration이 없습니다.</p>}
                  {state.exploration.filter((item) => item.status === "open").map((item) => (
                    <article key={item.id}>
                      <p>{item.content}</p>
                      <footer>
                        <button disabled={busy} onClick={() => promoteExploration(item.id, "truth")}>Truth 후보</button>
                        <button disabled={busy} onClick={() => promoteExploration(item.id, "next_action")}>Next Action</button>
                        <button disabled={busy} onClick={() => promoteExploration(item.id, "current_state")}>Current State</button>
                        <button className="dismiss" disabled={busy} onClick={() => dismissExploration(item.id)}>종료</button>
                      </footer>
                    </article>
                  ))}
                </div>
              </section>

              <section className="operation-card checkpoint-operation">
                <div className="operation-title"><span>04 / ACTIVE CHECKPOINT</span><StatusBadge value={state.checkpoint ? "active" : "empty"} /></div>
                <form onSubmit={saveCheckpointFromOperations}>
                  <label>마지막 안정 지점<textarea value={checkpointStable} onChange={(event) => setCheckpointStable(event.target.value)} required /></label>
                  <label>미검증 변경 — 한 줄에 하나<textarea value={checkpointUnverified} onChange={(event) => setCheckpointUnverified(event.target.value)} /></label>
                  <label>재개 지시<textarea value={checkpointResume} onChange={(event) => setCheckpointResume(event.target.value)} required /></label>
                  <div>
                    <button disabled={busy}>Checkpoint 갱신</button>
                    <button type="button" className="clear-checkpoint" disabled={busy || !state.checkpoint} onClick={clearCheckpointFromOperations}>복구 완료 · 해제</button>
                  </div>
                </form>
              </section>
            </div>

            <section className="operations-approval">
              <div className="operation-title"><span>APPROVAL QUEUE</span><strong>{state.proposals.length}</strong></div>
              {state.proposals.length === 0 && <p className="empty">운영 변경 후보가 없습니다.</p>}
              <div className="operations-proposals">
                {state.proposals.map((proposal) => (
                  <article key={proposal.id}>
                    <div><span>{proposal.target_type.replace("_", " ")}</span><StatusBadge value={proposal.proposed_verification} /></div>
                    <p>{proposal.proposed_content}</p>
                    <footer>
                      {proposal.proposed_verification === "conflicted" ? (
                        <button className="open-conflict" onClick={() => { setOperationsOpen(false); openConflictCenter(); }}>Conflict Center</button>
                      ) : (
                        <>
                          <button disabled={busy} onClick={() => decideProposal(proposal.id, "reject")}>거절</button>
                          <button className="approve" disabled={busy} onClick={() => decideProposal(proposal.id, "approve")}>승인 후 Commit</button>
                        </>
                      )}
                    </footer>
                  </article>
                ))}
              </div>
            </section>
          </section>
        </div>
      )}

      {conflictOpen && conflictCenter && (
        <div className="modal-backdrop" onClick={() => setConflictOpen(false)}>
          <section className="conflict-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>CONFLICT RESOLUTION CENTER</span>
                <h2>자동 덮어쓰기 없이 결정합니다</h2>
                <p>정본과 충돌 후보를 비교하고 적용 범위를 명시적으로 선택합니다.</p>
              </div>
              <button onClick={() => setConflictOpen(false)}>×</button>
            </header>

            <div className="resolution-rules">
              <div><strong>01</strong><span>기존 정본 유지</span><small>후보만 종료</small></div>
              <div><strong>02</strong><span>이번 작업만 예외</span><small>정본은 보존</small></div>
              <div><strong>03</strong><span>새 결정으로 교체</span><small>승인 후 Commit</small></div>
            </div>

            <form className="conflict-create" onSubmit={createConflictCandidate}>
              <div>
                <span>DEMO / MANUAL CONFLICT</span>
                <strong>기존 Truth에 충돌 후보 만들기</strong>
                <p>실제 분류 결과가 conflicted일 때도 동일한 해결 흐름으로 들어옵니다.</p>
              </div>
              <select
                aria-label="충돌 대상 Truth"
                value={conflictTargetId}
                onChange={(event) => setConflictTargetId(event.target.value)}
                required
              >
                <option value="" disabled>정본 선택</option>
                {state.truth.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.category} · v{entry.version}</option>
                ))}
              </select>
              <textarea
                value={conflictText}
                onChange={(event) => setConflictText(event.target.value)}
                placeholder="기존 정본과 양립하지 않는 새 주장을 입력하세요."
                required
              />
              <button disabled={busy || state.truth.length === 0}>충돌 후보 생성</button>
            </form>

            <div className="conflict-section-title">
              <div><span>PENDING DECISIONS</span><h3>해결 대기 충돌</h3></div>
              <strong>{conflictCenter.pending.length.toString().padStart(2, "0")}</strong>
            </div>

            <div className="conflict-list">
              {conflictCenter.pending.length === 0 && (
                <p className="empty conflict-empty">해결 대기 중인 충돌이 없습니다.</p>
              )}
              {conflictCenter.pending.map(({ proposal, canonical }) => (
                <article key={proposal.id} className="conflict-case">
                  <div className="conflict-compare">
                    <section className="canonical-side">
                      <span>CURRENT CANONICAL</span>
                      <div><StatusBadge value={canonical.verificationStatus ?? "missing"} />{canonical.version && <small>v{canonical.version}</small>}</div>
                      <p>{canonical.content ?? "연결된 기존 정본이 없습니다."}</p>
                    </section>
                    <div className="versus">VS</div>
                    <section className="proposed-side">
                      <span>CONFLICTED PROPOSAL</span>
                      <StatusBadge value="conflicted" />
                      <p>{proposal.proposed_content}</p>
                      <small>{proposal.reason}</small>
                    </section>
                  </div>
                  <footer>
                    <button
                      disabled={busy}
                      onClick={() => resolveConflict(proposal.id, "keep_canonical", "기존 정본을 계속 유지")}
                    >기존 정본 유지<small>후보 종료</small></button>
                    <button
                      className="temporary"
                      disabled={busy}
                      onClick={() => resolveConflict(proposal.id, "temporary_exception", "이번 작업에만 제한적으로 적용")}
                    >이번 작업만 예외<small>정본 유지</small></button>
                    <button
                      className="replace"
                      disabled={busy}
                      onClick={() => resolveConflict(proposal.id, "apply_proposed", "사용자의 명시적 결정으로 정본 교체")}
                    >새 결정으로 교체<small>confirmed Commit</small></button>
                  </footer>
                </article>
              ))}
            </div>

            <div className="conflict-lower-grid">
              <section className="exception-list">
                <div className="mini-title"><span>ACTIVE EXCEPTIONS</span><strong>{conflictCenter.activeExceptions.length}</strong></div>
                {conflictCenter.activeExceptions.length === 0 && <p className="empty">활성 임시 예외가 없습니다.</p>}
                {conflictCenter.activeExceptions.map((exception) => (
                  <article key={exception.id}>
                    <div><StatusBadge value="unverified" /><small>{exception.targetType}</small></div>
                    <p>{exception.content}</p>
                    <button disabled={busy} onClick={() => closeWorkingException(exception.id)}>예외 종료</button>
                  </article>
                ))}
              </section>
              <section className="resolution-history">
                <div className="mini-title"><span>RECENT RESOLUTIONS</span><strong>{conflictCenter.recentResolutions.length}</strong></div>
                {conflictCenter.recentResolutions.length === 0 && <p className="empty">아직 해결 기록이 없습니다.</p>}
                {conflictCenter.recentResolutions.map((resolution) => (
                  <article key={resolution.id}>
                    <StatusBadge value={resolution.decision} />
                    <p>{resolution.note || "사용자 결정으로 해결"}</p>
                    <small>{new Date(resolution.createdAt).toLocaleString()}</small>
                  </article>
                ))}
              </section>
            </div>
          </section>
        </div>
      )}

      {contextOpen && (
        <div className="modal-backdrop" onClick={() => setContextOpen(false)}>
          <section className="context-modal" onClick={(event) => event.stopPropagation()}>
            <header><div><span>ASSEMBLED CONTEXT</span><h2>새 세션 입력 컨텍스트</h2></div><button onClick={() => setContextOpen(false)}>×</button></header>
            <p>권위 순서에 따라 Project Truth와 Current State를 먼저 조립하고, 연결 프로젝트는 가장 낮은 reference-only 영역으로 격리합니다.</p>
            <button className="primary-button" onClick={async () => {
              const result = await request<RecoveryResult["context"]>(`/api/projects/${selectedId}/context`);
              setRecovery({
                context: result,
                bridge: result.contextBoundary ? {
                  mode: result.contextBoundary.mode,
                  linkedProjectCount: result.contextBoundary.linkedProjectCount ?? result.linkedProjectReferences?.length ?? 0,
                  rule: "연결 프로젝트는 참고 맥락이며 현재 프로젝트 정본으로 자동 병합되지 않습니다."
                } : undefined,
                recovery: { mode: "context_only", rule: "Context Assembly 완료" }
              });
            }}>최신 컨텍스트 조립</button>
            {recovery?.context.contextBoundary && (
              <div className="context-boundary-card">
                <div><span>BOUNDARY MODE</span><StatusBadge value={recovery.context.contextBoundary.mode} /></div>
                <strong>{recovery.context.contextBoundary.linkedProjectCount ?? recovery.context.linkedProjectReferences?.length ?? 0} linked project reference(s)</strong>
                <ul>{recovery.context.contextBoundary.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
              </div>
            )}
            <pre>{JSON.stringify(recovery?.context ?? { message: "복구 또는 조립을 실행하세요." }, null, 2)}</pre>
          </section>
        </div>
      )}

      {sessionOpen && (
        <div className="modal-backdrop" onClick={() => setSessionOpen(false)}>
          <section className="session-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>NEW SESSION</span>
                <h2>어떤 작업을 이어갈까요?</h2>
              </div>
              <button onClick={() => setSessionOpen(false)}>×</button>
            </header>
            <p>
              프로젝트를 억지로 연결하지 않습니다. High는 바로 복구하고, Medium은 확인하며,
              Low는 일반 대화로 유지합니다.
            </p>
            <form onSubmit={recognizeSession}>
              <div className="session-examples">
                <button type="button" onClick={() => setSessionQuery("LOGOS 해커톤 작업 이어가자.")}>명확한 프로젝트</button>
                <button type="button" onClick={() => setSessionQuery("지난번 해커톤 작업 계속하자.")}>확인이 필요한 표현</button>
                <button type="button" onClick={() => setSessionQuery("오늘 집중력을 높이는 방법을 알려줘.")}>일반 대화</button>
              </div>
              <textarea
                value={sessionQuery}
                onChange={(event) => {
                  setSessionQuery(event.target.value);
                  setRecognition(null);
                }}
                placeholder="예: LOGOS 해커톤 작업 이어가자"
                required
              />
              <button className="primary-button" disabled={busy}>프로젝트 식별</button>
            </form>

            {recognition && (
              <div className={`recognition-result confidence-${recognition.confidence}`}>
                <div className="recognition-summary">
                  <span>RECOGNITION CONFIDENCE</span>
                  <strong>{recognition.confidence}</strong>
                  <small>{recognition.model}</small>
                  <p>{recognition.rationale}</p>
                </div>

                {recognition.confidence === "low" ? (
                  <div className="general-conversation">
                    <strong>프로젝트에 연결하지 않습니다.</strong>
                    <p>현재 요청은 일반 대화로 유지되며 어떤 정본도 읽거나 변경하지 않습니다.</p>
                    <button onClick={() => setSessionOpen(false)}>일반 대화로 계속</button>
                  </div>
                ) : (
                  <div className="candidate-list">
                    {recognition.candidates.map((candidate) => (
                      <button
                        key={candidate.projectId}
                        disabled={busy}
                        onClick={() => resumeProject(candidate.projectId)}
                      >
                        <span>
                          <strong>{candidate.projectName}</strong>
                          <small>{candidate.summary}</small>
                        </span>
                        <span className="candidate-signals">
                          {candidate.matchedSignals.length > 0
                            ? candidate.matchedSignals.map((signal) => `#${signal}`).join(" ")
                            : "사용자 확인 필요"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {briefOpen && brief && (
        <div className="modal-backdrop" onClick={() => setBriefOpen(false)}>
          <section className="brief-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>CONTINUITY BRIEF</span>
                <h2>{brief.project.name}</h2>
                <p>{brief.project.primaryGoal}</p>
              </div>
              <button onClick={() => setBriefOpen(false)}>×</button>
            </header>

            <div className="brief-status-row">
              <div><span>CANONICAL TRUTH</span><strong>{brief.canonicalTruth.length}</strong></div>
              <div><span>NEXT ACTIONS</span><strong>{brief.nextActions.length}</strong></div>
              <div className={brief.warnings.length > 0 ? "has-warning" : ""}>
                <span>VERIFY</span><strong>{brief.warnings.length}</strong>
              </div>
              <div><span>NON-CANONICAL</span><strong>{brief.nonCanonical.explorationCount + brief.nonCanonical.pendingProposalCount + brief.nonCanonical.temporaryExceptionCount}</strong></div>
              <div><span>LINKED REF</span><strong>{brief.nonCanonical.linkedReferenceCount}</strong></div>
            </div>

            <div className="brief-grid">
              <section>
                <span>CURRENT STATE</span>
                <p>{brief.currentState?.summary ?? "현재 상태 없음"}</p>
                {brief.currentState && <StatusBadge value={brief.currentState.verificationStatus} />}
              </section>
              <section>
                <span>RESUME FROM</span>
                <p>{brief.checkpoint?.stableState ?? "Project Truth와 Current State"}</p>
                <small>{brief.checkpoint?.resumeInstruction ?? "첫 Next Action부터 이어갑니다."}</small>
              </section>
            </div>

            {brief.linkedProjectReferences.length > 0 && (
              <section className="brief-bridge">
                <header><div><span>LINKED PROJECT REFERENCES</span><strong>탐색 전용 · 정본 병합 금지</strong></div><StatusBadge value={brief.contextBoundary.mode} /></header>
                <div>
                  {brief.linkedProjectReferences.map((reference) => (
                    <article key={reference.relationship.id}>
                      <div><small>{reference.relationship.direction}</small><b>{reference.relationship.relationshipType.replace("_", " ")}</b><StatusBadge value={reference.project.status} /></div>
                      <h4>{reference.project.name}</h4>
                      <p>{reference.referenceState.currentState?.summary ?? reference.project.summary}</p>
                      <small>{reference.referenceState.checkpoint?.resumeInstruction ?? "Checkpoint reference 없음"}</small>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="brief-actions">
              <span>NEXT ACTIONS</span>
              {brief.nextActions.length === 0 && <p className="empty">활성 작업이 없습니다.</p>}
              {brief.nextActions.map((action, index) => (
                <article key={action.id}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <p>{action.content}</p>
                  <StatusBadge value={action.verificationStatus} />
                </article>
              ))}
            </section>

            {brief.warnings.length > 0 && (
              <section className="brief-warnings">
                <span>REQUIRES VERIFICATION — 정본으로 단정하지 않음</span>
                {brief.warnings.map((warning, index) => (
                  <article key={`${warning.source}-${index}`}>
                    <StatusBadge value={warning.verificationStatus} />
                    <p>{warning.content}</p>
                    <small>{warning.source.replace("_", " ")}</small>
                  </article>
                ))}
              </section>
            )}

            <footer>
              <button className="ghost-button" onClick={copyBrief}>Markdown 복사</button>
              <button className="primary-button" onClick={() => setBriefOpen(false)}>이 지점에서 작업 재개</button>
            </footer>
          </section>
        </div>
      )}

      {newProjectOpen && (
        <div className="modal-backdrop" onClick={() => setNewProjectOpen(false)}>
          <form className="project-modal" onSubmit={createProject} onClick={(event) => event.stopPropagation()}>
            <header><div><span>EXPLICIT CREATION</span><h2>새 프로젝트</h2></div><button type="button" onClick={() => setNewProjectOpen(false)}>×</button></header>
            <label>이름<input name="name" required /></label>
            <label>요약<textarea name="summary" required /></label>
            <label>Primary Goal<textarea name="primaryGoal" required /></label>
            <label>인식 신호<input name="signals" placeholder="쉼표로 구분" /></label>
            <button className="primary-button" disabled={busy}>프로젝트 생성</button>
          </form>
        </div>
      )}
    </div>
  );
}
