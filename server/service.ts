import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  actionStatuses,
  assertActionState,
  assertNonEmpty,
  assertOneOf,
  DomainError,
  nowIso,
  projectStatuses,
  proposalTargets,
  verificationStatuses,
  type ActionStatus,
  type ProjectStatus,
  type ProposalTarget,
  type VerificationStatus
} from "./domain.ts";

type Row = Record<string, unknown>;

export interface ProjectInput {
  name: string;
  summary: string;
  primaryGoal: string;
  status?: ProjectStatus;
  recognitionSignals?: string[];
}

export interface ProposalInput {
  targetType: ProposalTarget;
  targetId?: string;
  category?: string;
  content: string;
  verificationStatus: VerificationStatus;
  itemStatus?: ActionStatus;
  reason: string;
}

export interface CheckpointInput {
  stableState: string;
  unverifiedChanges?: string[];
  resumeInstruction: string;
}

export type SubmissionRequirementStatus = "ready" | "action_required" | "blocked";

export interface SubmissionRequirement {
  id: string;
  category: "project" | "video" | "repository" | "openai" | "access";
  label: string;
  status: SubmissionRequirementStatus;
  critical: boolean;
  evidence: string;
  action: string;
}

export interface SubmissionAiStatus {
  configured: boolean;
  model: string;
  fallback: string;
}

export const structureOperations = [
  "update_registry",
  "update_primary_goal",
  "create_workstream",
  "update_workstream",
  "create_node",
  "update_node"
] as const;
export type StructureOperation = (typeof structureOperations)[number];

export interface StructureProposalInput {
  operation: StructureOperation;
  targetId?: string;
  payload: Record<string, unknown>;
  reason: string;
}

export interface LifecycleProposalInput {
  targetStatus: ProjectStatus;
  reason: string;
  resumeInstruction?: string;
}

export const relationshipTypes = [
  "depends_on",
  "supports",
  "related_to",
  "supersedes"
] as const;
export type RelationshipType = (typeof relationshipTypes)[number];
export type RelationshipOperation = "create" | "remove";

export interface RelationshipProposalInput {
  operation: RelationshipOperation;
  relationshipId?: string;
  targetProjectId?: string;
  relationshipType?: RelationshipType;
  note?: string;
  reason: string;
}

export type ContextPromotionSource = "truth" | "current_state" | "next_action";

export interface ContextPromotionInput {
  relationshipId: string;
  sourceProjectId: string;
  sourceType: ContextPromotionSource;
  sourceId?: string;
  reason: string;
}

const nodeTypes = ["strategic_goal", "milestone", "task"] as const;
const nodeStatuses = ["planned", "active", "completed", "blocked"] as const;
const workstreamStatuses = ["active", "paused"] as const;
type NodeType = (typeof nodeTypes)[number];
type NodeStatus = (typeof nodeStatuses)[number];

export const conflictDecisions = [
  "keep_canonical",
  "temporary_exception",
  "apply_proposed"
] as const;
export type ConflictDecision = (typeof conflictDecisions)[number];

interface ApprovedConflictResolution {
  decision: "apply_proposed";
  note: string;
  canonicalSnapshot: string;
}

interface HistoryEventInput {
  projectId: string;
  eventType: string;
  targetType?: string | null;
  targetId?: string | null;
  summary: string;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  sourceType: string;
  sourceId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapProject(row: Row) {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    primaryGoal: row.primary_goal,
    status: row.status,
    recognitionSignals: parseJson<string[]>(row.recognition_signals, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRegistry(row: Row | undefined, projectId: string) {
  return {
    projectId,
    projectLocation: row ? String(row.project_location) : "local://logos-continuity",
    currentFocus: row ? String(row.current_focus) : "",
    lastMeaningfulUpdate: row?.last_meaningful_update
      ? String(row.last_meaningful_update)
      : null,
    relationships: parseJson<string[]>(row?.relationships, []),
    updatedAt: row?.updated_at ? String(row.updated_at) : null
  };
}

function mapWorkstream(row: Row) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    name: String(row.name),
    description: String(row.description),
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapProjectNode(row: Row) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    workstreamId: row.workstream_id ? String(row.workstream_id) : null,
    nodeType: String(row.node_type),
    title: String(row.title),
    description: String(row.description),
    status: String(row.status),
    verificationStatus: String(row.verification_status),
    sortOrder: Number(row.sort_order),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapProjectRelationship(row: Row) {
  return {
    id: String(row.id),
    sourceProjectId: String(row.source_project_id),
    targetProjectId: String(row.target_project_id),
    relationshipType: String(row.relationship_type) as RelationshipType,
    note: String(row.note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapRelationshipProposal(row: Row) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    operation: String(row.operation) as RelationshipOperation,
    relationshipId: row.relationship_id ? String(row.relationship_id) : null,
    targetProjectId: row.target_project_id ? String(row.target_project_id) : null,
    relationshipType: row.relationship_type ? String(row.relationship_type) as RelationshipType : null,
    note: String(row.note),
    reason: String(row.reason),
    status: String(row.status),
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null
  };
}

function mapContextPromotion(row: Row) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    sourceProjectId: String(row.source_project_id),
    relationshipId: String(row.relationship_id),
    sourceType: String(row.source_type) as ContextPromotionSource,
    sourceId: row.source_id ? String(row.source_id) : null,
    sourceSnapshot: parseJson<Record<string, unknown>>(row.source_snapshot, {}),
    proposalId: String(row.proposal_id),
    status: String(row.status),
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null
  };
}

export class ContinuityService {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  private recordHistoryEvent(input: HistoryEventInput) {
    const event = {
      id: randomUUID(),
      createdAt: input.createdAt ?? nowIso()
    };
    this.database
      .prepare(`
        INSERT INTO history_events (
          id, project_id, event_type, target_type, target_id, summary,
          before_snapshot, after_snapshot, source_type, source_id, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.id,
        input.projectId,
        input.eventType,
        input.targetType ?? null,
        input.targetId ?? null,
        input.summary,
        input.beforeSnapshot === undefined ? null : JSON.stringify(input.beforeSnapshot),
        input.afterSnapshot === undefined ? null : JSON.stringify(input.afterSnapshot),
        input.sourceType,
        input.sourceId ?? null,
        JSON.stringify(input.metadata ?? {}),
        event.createdAt
      );
    return event;
  }

  close(): void {
    this.database.close();
  }

  listProjects() {
    return this.database
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all()
      .map((row) => mapProject(row as Row));
  }

  getProjectIndex() {
    const projects = this.listProjects().map((project) => {
      const projectId = String(project.id);
      const counts = this.database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM truth_entries WHERE project_id = ?) AS truth_count,
          (SELECT COUNT(*) FROM next_actions WHERE project_id = ? AND status <> 'completed') AS open_action_count,
          (SELECT COUNT(*) FROM change_proposals WHERE project_id = ? AND status = 'pending') +
          (SELECT COUNT(*) FROM structure_proposals WHERE project_id = ? AND status = 'pending') +
          (SELECT COUNT(*) FROM lifecycle_proposals WHERE project_id = ? AND status = 'pending') +
          (SELECT COUNT(*) FROM project_relationship_proposals
             WHERE status = 'pending' AND (project_id = ? OR target_project_id = ?)) AS pending_approval_count,
          (SELECT COUNT(*) FROM working_exceptions WHERE project_id = ? AND status = 'active') AS active_exception_count,
          (SELECT COUNT(*) FROM project_relationships
             WHERE source_project_id = ? OR target_project_id = ?) AS relationship_count,
          (SELECT COUNT(*) FROM checkpoints WHERE project_id = ?) AS checkpoint_count
      `).get(
        projectId, projectId, projectId, projectId, projectId, projectId, projectId,
        projectId, projectId, projectId, projectId
      ) as Row;
      const registry = this.database
        .prepare("SELECT current_focus, project_location FROM project_registry_details WHERE project_id = ?")
        .get(projectId) as Row | undefined;
      return {
        ...project,
        currentFocus: registry ? String(registry.current_focus) : "",
        projectLocation: registry ? String(registry.project_location) : "local://logos-continuity",
        truthCount: Number(counts.truth_count),
        openActionCount: Number(counts.open_action_count),
        pendingApprovalCount: Number(counts.pending_approval_count),
        activeExceptionCount: Number(counts.active_exception_count),
        relationshipCount: Number(counts.relationship_count),
        hasCheckpoint: Number(counts.checkpoint_count) > 0
      };
    });
    const projectNames = new Map(projects.map((project) => [String(project.id), String(project.name)]));
    const relationships = this.database
      .prepare("SELECT * FROM project_relationships ORDER BY updated_at DESC")
      .all()
      .map((row) => {
        const relationship = mapProjectRelationship(row as Row);
        return {
          ...relationship,
          sourceProjectName: projectNames.get(relationship.sourceProjectId) ?? "Unknown project",
          targetProjectName: projectNames.get(relationship.targetProjectId) ?? "Unknown project"
        };
      });
    const pendingProposals = this.database
      .prepare(`
        SELECT * FROM project_relationship_proposals
        WHERE status = 'pending'
        ORDER BY created_at DESC
      `)
      .all()
      .map((row) => {
        const proposal = mapRelationshipProposal(row as Row);
        const relationship = proposal.relationshipId
          ? relationships.find((item) => item.id === proposal.relationshipId)
          : null;
        const targetProjectId = proposal.targetProjectId ?? relationship?.targetProjectId ?? null;
        return {
          ...proposal,
          sourceProjectName: projectNames.get(proposal.projectId) ?? "Unknown project",
          targetProjectName: targetProjectId
            ? projectNames.get(targetProjectId) ?? "Unknown project"
            : "Unknown project"
        };
      });
    return {
      generatedAt: nowIso(),
      stats: {
        totalProjects: projects.length,
        activeProjects: projects.filter((project) => project.status === "active").length,
        archivedProjects: projects.filter((project) => project.status !== "active").length,
        relationships: relationships.length,
        pendingApprovals: pendingProposals.length
      },
      projects,
      relationships,
      pendingProposals
    };
  }

  getContinuityCommandCenter() {
    const generatedAt = nowIso();
    const now = Date.parse(generatedAt);
    const projects = this.listProjects().map((project) => {
      const projectId = String(project.id);
      const readCount = (sql: string, ...parameters: string[]) => Number((
        this.database.prepare(sql).get(...parameters) as Row
      ).count);
      const pendingCanonical = readCount(
        "SELECT COUNT(*) AS count FROM change_proposals WHERE project_id = ? AND status = 'pending'",
        projectId
      );
      const conflictedProposals = readCount(
        "SELECT COUNT(*) AS count FROM change_proposals WHERE project_id = ? AND status = 'pending' AND proposed_verification = 'conflicted'",
        projectId
      );
      const pendingStructure = readCount(
        "SELECT COUNT(*) AS count FROM structure_proposals WHERE project_id = ? AND status = 'pending'",
        projectId
      );
      const pendingLifecycle = readCount(
        "SELECT COUNT(*) AS count FROM lifecycle_proposals WHERE project_id = ? AND status = 'pending'",
        projectId
      );
      const pendingRelationships = readCount(`
        SELECT COUNT(*) AS count FROM project_relationship_proposals
        WHERE status = 'pending' AND (project_id = ? OR target_project_id = ?)
      `, projectId, projectId);
      const pendingContextPromotions = readCount(
        "SELECT COUNT(*) AS count FROM context_promotions WHERE project_id = ? AND status = 'pending'",
        projectId
      );
      const activeExceptions = readCount(
        "SELECT COUNT(*) AS count FROM working_exceptions WHERE project_id = ? AND status = 'active'",
        projectId
      );
      const blockedActions = readCount(
        "SELECT COUNT(*) AS count FROM next_actions WHERE project_id = ? AND status = 'blocked'",
        projectId
      );
      const openActions = readCount(
        "SELECT COUNT(*) AS count FROM next_actions WHERE project_id = ? AND status <> 'completed'",
        projectId
      );
      const unverifiedCanonical = readCount(`
        SELECT
          (SELECT COUNT(*) FROM truth_entries WHERE project_id = ? AND verification_status <> 'confirmed') +
          (SELECT COUNT(*) FROM current_state WHERE project_id = ? AND verification_status <> 'confirmed') +
          (SELECT COUNT(*) FROM next_actions WHERE project_id = ? AND verification_status <> 'confirmed') AS count
      `, projectId, projectId, projectId);
      const drift = this.getProvenanceDriftCenter(projectId);
      const checkpoint = this.getCheckpoint(projectId);
      const checkpointAgeDays = checkpoint
        ? Math.max(0, Math.floor((now - Date.parse(String(checkpoint.updatedAt))) / 86_400_000))
        : null;
      const checkpointStale = checkpointAgeDays !== null && checkpointAgeDays >= 14;
      const pendingApprovals = pendingCanonical + pendingStructure + pendingLifecycle + pendingRelationships;
      const penalties = {
        conflicts: conflictedProposals * 18,
        criticalDrift: drift.stats.criticalDrifts * 15,
        drift: drift.stats.activeDrifts * 12,
        exceptions: activeExceptions * 10,
        blockedActions: blockedActions * 8,
        unverified: Math.min(12, unverifiedCanonical * 3),
        approvals: Math.min(15, pendingApprovals * 3),
        checkpoint: project.status === "active" && !checkpoint ? 5 : checkpointStale ? 6 : 0
      };
      const healthScore = Math.max(0, 100 - Object.values(penalties).reduce((sum, value) => sum + value, 0));
      let priority = 0;
      let recommendedCenter = "project";
      let recommendedAction = "Continuity is stable. Continue the highest-priority Next Action.";
      if (project.status !== "active") {
        priority = 50;
        recommendedCenter = "archive";
        recommendedAction = `Review the ${String(project.status)} lifecycle state before new mutations.`;
      }
      if (checkpointStale && priority < 35) {
        priority = 35;
        recommendedCenter = "operations";
        recommendedAction = `Refresh the ${checkpointAgeDays}-day-old recovery Checkpoint.`;
      }
      if (!checkpoint && project.status === "active" && priority < 40) {
        priority = 40;
        recommendedCenter = "operations";
        recommendedAction = "Create an Active Checkpoint for interruption recovery.";
      }
      if (blockedActions > 0 && priority < 65) {
        priority = 65;
        recommendedCenter = "operations";
        recommendedAction = `Resolve ${blockedActions} blocked Next Action(s).`;
      }
      if (pendingLifecycle > 0 && priority < 70) {
        priority = 70;
        recommendedCenter = "archive";
        recommendedAction = `Resolve ${pendingLifecycle} lifecycle approval(s).`;
      }
      if (pendingRelationships > 0 && priority < 72) {
        priority = 72;
        recommendedCenter = "index";
        recommendedAction = `Resolve ${pendingRelationships} project relationship approval(s).`;
      }
      if (pendingStructure > 0 && priority < 75) {
        priority = 75;
        recommendedCenter = "structure";
        recommendedAction = `Resolve ${pendingStructure} structure approval(s).`;
      }
      if (pendingCanonical > 0 && priority < 80) {
        priority = 80;
        recommendedCenter = pendingContextPromotions > 0 ? "promotion" : "operations";
        recommendedAction = `Resolve ${pendingCanonical} canonical approval(s).`;
      }
      if (activeExceptions > 0 && priority < 85) {
        priority = 85;
        recommendedCenter = "conflict";
        recommendedAction = `Close or formalize ${activeExceptions} active working exception(s).`;
      }
      if (drift.stats.activeDrifts > 0 && priority < 90) {
        priority = 90;
        recommendedCenter = "drift";
        recommendedAction = `Review ${drift.stats.activeDrifts} active provenance drift alert(s).`;
      }
      if (drift.stats.criticalDrifts > 0) {
        priority = 95;
        recommendedCenter = "drift";
        recommendedAction = `Restore provenance for ${drift.stats.criticalDrifts} missing source item(s).`;
      }
      if (conflictedProposals > 0) {
        priority = 100;
        recommendedCenter = "conflict";
        recommendedAction = `Resolve ${conflictedProposals} canonical conflict(s) before continuing.`;
      }
      const issues = [
        conflictedProposals > 0 ? { type: "conflict", count: conflictedProposals, severity: "critical" } : null,
        drift.stats.activeDrifts > 0 ? { type: "drift", count: drift.stats.activeDrifts, severity: drift.stats.criticalDrifts > 0 ? "critical" : "high" } : null,
        activeExceptions > 0 ? { type: "exception", count: activeExceptions, severity: "high" } : null,
        pendingApprovals > 0 ? { type: "approval", count: pendingApprovals, severity: "medium" } : null,
        blockedActions > 0 ? { type: "blocked_action", count: blockedActions, severity: "medium" } : null,
        !checkpoint && project.status === "active" ? { type: "missing_checkpoint", count: 1, severity: "low" } : null,
        checkpointStale ? { type: "stale_checkpoint", count: 1, severity: "low" } : null
      ].filter((issue): issue is { type: string; count: number; severity: string } => Boolean(issue));
      const healthState = conflictedProposals > 0 || drift.stats.criticalDrifts > 0 || healthScore < 50
        ? "critical"
        : healthScore < 85 || issues.length > 0 ? "attention" : "stable";
      return {
        project,
        healthScore,
        healthState,
        priority,
        recommendedCenter,
        recommendedAction,
        issues,
        signals: {
          pendingApprovals,
          pendingCanonical,
          pendingStructure,
          pendingLifecycle,
          pendingRelationships,
          pendingContextPromotions,
          conflictedProposals,
          activeExceptions,
          activeDrifts: drift.stats.activeDrifts,
          criticalDrifts: drift.stats.criticalDrifts,
          blockedActions,
          openActions,
          unverifiedCanonical,
          hasCheckpoint: Boolean(checkpoint),
          checkpointAgeDays,
          checkpointStale
        },
        penalties
      };
    });
    const priorityQueue = [...projects].sort((left, right) =>
      right.priority - left.priority || left.healthScore - right.healthScore ||
      String(left.project.name).localeCompare(String(right.project.name))
    );
    const averageHealth = projects.length
      ? Math.round(projects.reduce((sum, project) => sum + project.healthScore, 0) / projects.length)
      : 100;
    return {
      generatedAt,
      stats: {
        totalProjects: projects.length,
        stableProjects: projects.filter((project) => project.healthState === "stable").length,
        attentionProjects: projects.filter((project) => project.healthState === "attention").length,
        criticalProjects: projects.filter((project) => project.healthState === "critical").length,
        averageHealth,
        totalOpenIssues: projects.reduce((sum, project) => sum + project.issues.length, 0)
      },
      priorityQueue,
      projects
    };
  }

  getSubmissionEvidence(
    aiStatus: SubmissionAiStatus,
    distributionReady = false,
    distributionDownloadable = distributionReady,
    repositoryUrl = ""
  ) {
    const generatedAt = nowIso();
    const projects = this.listProjects();
    const commandCenter = this.getContinuityCommandCenter();
    const publicRepositoryUrl = repositoryUrl.trim();
    const requirements: SubmissionRequirement[] = [
      {
        id: "working-project",
        category: "project",
        label: "Working project built with Codex",
        status: projects.length > 0 ? "ready" : "blocked",
        critical: true,
        evidence: `${projects.length} runnable project(s) are available through the local SQLite application.`,
        action: projects.length > 0 ? "Keep the demo state reproducible." : "Create and verify a runnable project."
      },
      {
        id: "track",
        category: "project",
        label: "Single category selected",
        status: "ready",
        critical: true,
        evidence: "Work and Productivity",
        action: "Use the same track in the Devpost submission form."
      },
      {
        id: "english-description",
        category: "project",
        label: "English project description",
        status: "ready",
        critical: true,
        evidence: "A title, tagline, short description, full description, feature list, and testing instructions are included in this evidence pack.",
        action: "Paste the generated English copy into Devpost and the repository README."
      },
      {
        id: "guided-demo",
        category: "video",
        label: "Under-three-minute demo plan",
        status: "ready",
        critical: true,
        evidence: "Optional Judge Mode provides a seven-step 02:15 guided flow with no step longer than 23 seconds.",
        action: "Rehearse once, then record the guided flow."
      },
      {
        id: "gpt-live",
        category: "openai",
        label: "GPT-5.6 live usage verified",
        status: aiStatus.configured ? "ready" : "blocked",
        critical: true,
        evidence: aiStatus.configured
          ? `${aiStatus.model} is configured for project recognition and safe statement classification.`
          : `The app is currently using ${aiStatus.fallback}; live GPT-5.6 evidence has not been captured.`,
        action: aiStatus.configured
          ? "Capture the GPT-5.6 LIVE badge and one classification result in the video."
          : "Add OPENAI_API_KEY, run one recognition and classification flow, and capture the GPT-5.6 LIVE result."
      },
      {
        id: "public-video",
        category: "video",
        label: "Public YouTube video under three minutes",
        status: "action_required",
        critical: true,
        evidence: "The in-app recording script is ready; an uploaded public video URL is still required.",
        action: "Record, upload publicly to YouTube, and add the URL to Devpost."
      },
      {
        id: "audio-disclosure",
        category: "video",
        label: "Audio explains product, Codex, and GPT-5.6",
        status: "action_required",
        critical: true,
        evidence: "The judge script contains the product and model story, but the final recording must include spoken audio.",
        action: "Use voiceover; a music-only screencast is insufficient."
      },
      {
        id: "repository-url",
        category: "repository",
        label: "Repository URL available to judges",
        status: publicRepositoryUrl ? "ready" : "action_required",
        critical: true,
        evidence: publicRepositoryUrl
          ? `Public judge-accessible repository: ${publicRepositoryUrl}`
          : "Local source and installation instructions exist; a judge-accessible repository URL is not stored in the app.",
        action: publicRepositoryUrl
          ? "Use this repository URL in Devpost."
          : "Publish the repository or share the private repository with the required judging accounts."
      },
      {
        id: "codex-collaboration",
        category: "repository",
        label: "Codex collaboration and human decisions documented",
        status: "ready",
        critical: true,
        evidence: "The generated contribution matrix separates Codex acceleration, human product decisions, and GPT-5.6 runtime responsibilities.",
        action: "Keep this distinction in the final README."
      },
      {
        id: "feedback-session",
        category: "openai",
        label: "/feedback Codex Session ID",
        status: "action_required",
        critical: true,
        evidence: "The core build thread exists, but its /feedback Session ID must be generated by the user.",
        action: "Run /feedback in the primary Codex build thread and paste the Session ID into Devpost."
      },
      {
        id: "test-access",
        category: "access",
        label: "Free judging and testing path",
        status: distributionReady ? "ready" : "action_required",
        critical: true,
        evidence: distributionReady
          ? "A no-install Portable Judge Build and a free Render Docker Blueprint are available with deterministic seeded demo data."
          : "Local install instructions and seeded demo data are ready; a hosted demo or downloadable test build is still recommended.",
        action: distributionReady
          ? "Deploy render.yaml or upload the portable ZIP, then add the public judge-accessible URL to Devpost."
          : "Run pnpm package:judge, then publish the generated ZIP through a free judge-accessible link."
      },
      {
        id: "new-work-evidence",
        category: "repository",
        label: "Build Week work distinguished from prior work",
        status: "ready",
        critical: true,
        evidence: "Timestamped commits and docs/BUILD_WEEK_BUILD_LOG.md distinguish the implemented Build Week work from the earlier product design.",
        action: "Keep the Build Week log linked from the public README and Devpost description."
      },
      {
        id: "english-video",
        category: "video",
        label: "English submission materials or translations",
        status: "action_required",
        critical: true,
        evidence: "English text copy is generated; the Korean-first demo still needs English narration or subtitles.",
        action: "Record in English or add complete English subtitles and testing instructions."
      }
    ];
    const statusCounts = {
      ready: requirements.filter((item) => item.status === "ready").length,
      actionRequired: requirements.filter((item) => item.status === "action_required").length,
      blocked: requirements.filter((item) => item.status === "blocked").length
    };
    const narrative = {
      title: "LOGOS Continuity",
      tagline: "Approval-gated, provenance-aware continuity for long-running AI work.",
      track: "Work and Productivity",
      shortDescription: "LOGOS Continuity replaces fragile conversational recall with a local continuity layer that separates verified project truth, current state, exploration, conflicts, next actions, and recovery checkpoints.",
      fullDescription: "LOGOS Continuity helps people resume complex AI-assisted work without letting uncertain memories silently become facts. It identifies the right project in a new session, assembles an authority-ordered Continuity Brief, and requires explicit approval before canonical state changes. Conflicts become visible decisions, linked project context remains reference-only until promoted, and provenance drift is monitored after promotion. A portfolio Command Center ranks the most urgent continuity risks, while an optional 2:15 Judge Mode demonstrates the complete workflow.",
      testingInstructions: "Install dependencies with pnpm, run pnpm dev, open http://127.0.0.1:5173, select the seeded Atlas release project, and start the optional Judge Mode. The deterministic Local Safe Mode works without an API key; set OPENAI_API_KEY to demonstrate the GPT-5.6 LIVE recognition and classification path."
    };
    const features = [
      "High/Medium/Low project recognition and authority-ordered session recovery",
      "Approval-gated Project Truth, Current State, Next Actions, and structure changes",
      "Three-way conflict resolution without silent canonical overwrites",
      "Context promotion with immutable provenance and drift monitoring",
      "Portfolio health scoring and risk routing through Continuity Command Center",
      "Optional seven-step 2:15 Judge Mode with safe sample inputs and no automatic approvals"
    ];
    const contributions = [
      {
        owner: "Codex",
        summary: "Accelerated schema design, API and UI implementation, safety invariants, automated tests, browser QA, and submission tooling."
      },
      {
        owner: "Human",
        summary: "Defined the product problem, canonical-truth safety principle, Work and Productivity track, feature priorities, conflict semantics, and final demo narrative."
      },
      {
        owner: "GPT-5.6",
        summary: "Performs runtime project recognition and structured statement classification; all outputs remain constrained by approval gates and local deterministic safety rules."
      }
    ];
    const architecture = [
      { layer: "Experience", evidence: "React dashboard, operational Centers, Command Center, and Judge Mode" },
      { layer: "Continuity", evidence: "Authority ordering, conflict policy, Context Assembly, recovery briefs, and provenance drift" },
      { layer: "Intelligence", evidence: `${aiStatus.model} structured recognition/classification with ${aiStatus.fallback} fallback` },
      { layer: "State", evidence: "Local SQLite transactions, approval-gated commits, immutable history, and archive snapshots" }
    ];
    const requirementLines = requirements.map((item) =>
      `- [${item.status === "ready" ? "x" : " "}] ${item.label} — ${item.status.toUpperCase()}\n  - Evidence: ${item.evidence}\n  - Next: ${item.action}`
    );
    const markdown = [
      `# ${narrative.title}`,
      "",
      `> ${narrative.tagline}`,
      "",
      `**Track:** ${narrative.track}`,
      "",
      "## Project Description",
      "",
      narrative.fullDescription,
      "",
      "## Core Features",
      "",
      ...features.map((feature) => `- ${feature}`),
      "",
      "## How Codex and GPT-5.6 Contributed",
      "",
      ...contributions.map((item) => `- **${item.owner}:** ${item.summary}`),
      "",
      "## Architecture Evidence",
      "",
      ...architecture.map((item) => `- **${item.layer}:** ${item.evidence}`),
      "",
      "## Testing Instructions",
      "",
      narrative.testingInstructions,
      "",
      "## Submission Readiness",
      "",
      ...requirementLines,
      "",
      "## Official Sources",
      "",
      "- https://openai.com/build-week/",
      "- https://openai.devpost.com/rules",
      "- https://openai.devpost.com/details/faqs"
    ].join("\n");
    return {
      generatedAt,
      event: {
        name: "OpenAI Build Week",
        deadline: "2026-07-21 17:00 PDT / 2026-07-22 09:00 KST",
        track: narrative.track,
        officialSources: [
          "https://openai.com/build-week/",
          "https://openai.devpost.com/rules",
          "https://openai.devpost.com/details/faqs"
        ]
      },
      readiness: {
        score: Math.round((statusCounts.ready / requirements.length) * 100),
        total: requirements.length,
        ...statusCounts
      },
      portfolio: {
        projects: projects.length,
        averageHealth: commandCenter.stats.averageHealth,
        openIssues: commandCenter.stats.totalOpenIssues
      },
      judgePackage: {
        available: distributionReady,
        filename: "LOGOS-Continuity-Judge.zip",
        downloadUrl: distributionDownloadable ? "/api/submission-evidence/judge-package" : null,
        requirement: "Node.js 24 or newer",
        installRequired: false
      },
      narrative,
      features,
      contributions,
      architecture,
      requirements,
      markdown
    };
  }

  createRelationshipProposal(projectId: string, input: RelationshipProposalInput) {
    this.requireActiveProject(projectId);
    assertOneOf(input.operation, ["create", "remove"] as const, "relationship operation");
    assertNonEmpty(input.reason, "relationship change reason");
    let relationshipId: string | null = null;
    let targetProjectId: string | null = null;
    let relationshipType: RelationshipType | null = null;
    let note = String(input.note ?? "").trim();

    if (input.operation === "create") {
      targetProjectId = String(input.targetProjectId ?? "").trim();
      relationshipType = input.relationshipType ?? "related_to";
      assertNonEmpty(targetProjectId, "target project");
      assertOneOf(relationshipType, relationshipTypes, "relationship type");
      this.getProject(targetProjectId);
      if (targetProjectId === projectId) throw new DomainError("A project cannot relate to itself.");
      const duplicate = this.database.prepare(`
        SELECT id FROM project_relationships
        WHERE source_project_id = ? AND target_project_id = ? AND relationship_type = ?
      `).get(projectId, targetProjectId, relationshipType);
      if (duplicate) throw new DomainError("This project relationship already exists.");
      const pending = this.database.prepare(`
        SELECT id FROM project_relationship_proposals
        WHERE project_id = ? AND target_project_id = ? AND relationship_type = ?
          AND operation = 'create' AND status = 'pending'
      `).get(projectId, targetProjectId, relationshipType);
      if (pending) throw new DomainError("The same relationship candidate is already pending.");
    } else {
      relationshipId = String(input.relationshipId ?? "").trim();
      assertNonEmpty(relationshipId, "relationship");
      const relationship = this.database.prepare(`
        SELECT * FROM project_relationships WHERE id = ? AND source_project_id = ?
      `).get(relationshipId, projectId) as Row | undefined;
      if (!relationship) throw new DomainError("Only an outgoing relationship can be removed by this project.", 404);
      const existingPromotion = this.database.prepare(`
        SELECT id FROM context_promotions
        WHERE relationship_id = ?
      `).get(relationshipId);
      if (existingPromotion) {
        throw new DomainError("This relationship is retained because context promotion provenance depends on it.");
      }
      targetProjectId = String(relationship.target_project_id);
      relationshipType = String(relationship.relationship_type) as RelationshipType;
      note = String(relationship.note);
      const pending = this.database.prepare(`
        SELECT id FROM project_relationship_proposals
        WHERE relationship_id = ? AND operation = 'remove' AND status = 'pending'
      `).get(relationshipId);
      if (pending) throw new DomainError("A removal candidate is already pending for this relationship.");
    }

    const proposal = {
      id: randomUUID(), projectId, operation: input.operation, relationshipId,
      targetProjectId, relationshipType, note, reason: input.reason.trim(),
      status: "pending", createdAt: nowIso()
    };
    this.database.prepare(`
      INSERT INTO project_relationship_proposals (
        id, project_id, operation, relationship_id, target_project_id,
        relationship_type, note, reason, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      proposal.id, proposal.projectId, proposal.operation, proposal.relationshipId,
      proposal.targetProjectId, proposal.relationshipType, proposal.note,
      proposal.reason, proposal.createdAt
    );
    return proposal;
  }

  approveRelationshipProposal(proposalId: string) {
    const proposal = this.database.prepare(`
      SELECT * FROM project_relationship_proposals WHERE id = ? AND status = 'pending'
    `).get(proposalId) as Row | undefined;
    if (!proposal) throw new DomainError("Pending relationship proposal not found.", 404);
    const projectId = String(proposal.project_id);
    this.requireActiveProject(projectId);
    const operation = String(proposal.operation) as RelationshipOperation;
    const timestamp = nowIso();
    let relationship: ReturnType<typeof mapProjectRelationship>;

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      if (operation === "create") {
        const targetProjectId = String(proposal.target_project_id);
        const relationshipType = String(proposal.relationship_type) as RelationshipType;
        this.getProject(targetProjectId);
        const row = {
          id: randomUUID(), sourceProjectId: projectId, targetProjectId,
          relationshipType, note: String(proposal.note), createdAt: timestamp, updatedAt: timestamp
        };
        this.database.prepare(`
          INSERT INTO project_relationships (
            id, source_project_id, target_project_id, relationship_type, note, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          row.id, row.sourceProjectId, row.targetProjectId, row.relationshipType,
          row.note, row.createdAt, row.updatedAt
        );
        relationship = row;
      } else {
        const existing = this.database.prepare(`
          SELECT * FROM project_relationships WHERE id = ? AND source_project_id = ?
        `).get(String(proposal.relationship_id), projectId) as Row | undefined;
        if (!existing) throw new DomainError("Relationship to remove no longer exists.", 404);
        relationship = mapProjectRelationship(existing);
        const existingPromotion = this.database.prepare(`
          SELECT id FROM context_promotions
          WHERE relationship_id = ?
        `).get(relationship.id);
        if (existingPromotion) {
          throw new DomainError("This relationship is retained because context promotion provenance depends on it.");
        }
        this.database.prepare("DELETE FROM project_relationships WHERE id = ?").run(relationship.id);
      }
      this.database.prepare(`
        UPDATE project_relationship_proposals SET status = 'approved', resolved_at = ? WHERE id = ?
      `).run(timestamp, proposalId);
      this.database.prepare("UPDATE projects SET updated_at = ? WHERE id IN (?, ?)")
        .run(timestamp, relationship.sourceProjectId, relationship.targetProjectId);
      const eventType = operation === "create" ? "project_relationship_created" : "project_relationship_removed";
      const summary = `${operation === "create" ? "Created" : "Removed"} ${relationship.relationshipType} relationship`;
      for (const relatedProjectId of [relationship.sourceProjectId, relationship.targetProjectId]) {
        this.recordHistoryEvent({
          projectId: relatedProjectId,
          eventType,
          targetType: "project_relationship",
          targetId: relationship.id,
          summary,
          beforeSnapshot: operation === "remove" ? relationship : null,
          afterSnapshot: operation === "create" ? relationship : null,
          sourceType: "relationship_proposal",
          sourceId: proposalId,
          metadata: { role: relatedProjectId === projectId ? "source" : "target" },
          createdAt: timestamp
        });
      }
      this.database.exec("COMMIT;");
      return { proposalId, operation, relationship };
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  rejectRelationshipProposal(proposalId: string) {
    const proposal = this.database.prepare(`
      SELECT * FROM project_relationship_proposals WHERE id = ? AND status = 'pending'
    `).get(proposalId) as Row | undefined;
    if (!proposal) throw new DomainError("Pending relationship proposal not found.", 404);
    const timestamp = nowIso();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database.prepare(`
        UPDATE project_relationship_proposals SET status = 'rejected', resolved_at = ? WHERE id = ?
      `).run(timestamp, proposalId);
      this.recordHistoryEvent({
        projectId: String(proposal.project_id),
        eventType: "project_relationship_rejected",
        targetType: "project_relationship",
        targetId: proposal.relationship_id ? String(proposal.relationship_id) : null,
        summary: `Rejected ${String(proposal.operation)} relationship candidate`,
        beforeSnapshot: mapRelationshipProposal(proposal),
        sourceType: "relationship_proposal",
        sourceId: proposalId,
        createdAt: timestamp
      });
      this.database.exec("COMMIT;");
      return { proposalId, status: "rejected", resolvedAt: timestamp };
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  createProject(input: ProjectInput) {
    assertNonEmpty(input.name, "프로젝트 이름");
    assertNonEmpty(input.summary, "프로젝트 요약");
    assertNonEmpty(input.primaryGoal, "Primary Goal");
    const status = input.status ?? "active";
    assertOneOf(status, projectStatuses, "프로젝트 상태");

    const id = randomUUID();
    const timestamp = nowIso();
    this.database
      .prepare(`
        INSERT INTO projects (
          id, name, summary, primary_goal, status, recognition_signals, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.name.trim(),
        input.summary.trim(),
        input.primaryGoal.trim(),
        status,
        JSON.stringify(input.recognitionSignals ?? []),
        timestamp,
        timestamp
      );
    this.database
      .prepare(`
        INSERT INTO project_registry_details (
          project_id, project_location, current_focus, last_meaningful_update,
          relationships, updated_at
        ) VALUES (?, 'local://logos-continuity', '', ?, '[]', ?)
      `)
      .run(id, timestamp, timestamp);

    this.recordHistoryEvent({
      projectId: id,
      eventType: "project_created",
      targetType: "project",
      targetId: id,
      summary: `Project created: ${input.name.trim()}`,
      afterSnapshot: {
        name: input.name.trim(),
        summary: input.summary.trim(),
        primaryGoal: input.primaryGoal.trim(),
        status
      },
      sourceType: "user_action",
      createdAt: timestamp
    });

    return this.getProject(id);
  }

  getProject(projectId: string) {
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as
      | Row
      | undefined;
    if (!row) throw new DomainError("프로젝트를 찾을 수 없습니다.", 404);
    return mapProject(row);
  }

  private requireActiveProject(projectId: string) {
    const project = this.getProject(projectId);
    if (project.status !== "active") {
      throw new DomainError(`Project is ${String(project.status)}. Approve a restore before changing its state.`);
    }
    return project;
  }

  private getArchiveManifest(projectId: string) {
    const count = (table: string, condition = "") => Number((this.database
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ? ${condition}`)
      .get(projectId) as Row).count);
    const checkpoint = this.database
      .prepare("SELECT stable_state, resume_instruction, updated_at FROM checkpoints WHERE project_id = ?")
      .get(projectId) as Row | undefined;
    return {
      truthEntries: count("truth_entries"),
      nextActions: count("next_actions"),
      openNextActions: count("next_actions", "AND status <> 'completed'"),
      openExploration: count("exploration_entries", "AND status = 'open'"),
      historyEvents: count("history_events"),
      structureNodes: count("project_nodes"),
      checkpoint: checkpoint
        ? {
            stableState: String(checkpoint.stable_state),
            resumeInstruction: String(checkpoint.resume_instruction),
            updatedAt: String(checkpoint.updated_at)
          }
        : null
    };
  }

  private getArchiveBlockers(projectId: string) {
    const pendingCanonical = Number((this.database
      .prepare("SELECT COUNT(*) AS count FROM change_proposals WHERE project_id = ? AND status = 'pending'")
      .get(projectId) as Row).count);
    const pendingStructure = Number((this.database
      .prepare("SELECT COUNT(*) AS count FROM structure_proposals WHERE project_id = ? AND status = 'pending'")
      .get(projectId) as Row).count);
    const activeExceptions = Number((this.database
      .prepare("SELECT COUNT(*) AS count FROM working_exceptions WHERE project_id = ? AND status = 'active'")
      .get(projectId) as Row).count);
    const pendingRelationships = Number((this.database
      .prepare(`
        SELECT COUNT(*) AS count FROM project_relationship_proposals
        WHERE status = 'pending' AND (project_id = ? OR target_project_id = ?)
      `)
      .get(projectId, projectId) as Row).count);
    const unresolvedDrifts = this.getProvenanceDriftCenter(projectId).stats.activeDrifts;
    const blockers = [
      pendingCanonical > 0 ? `${pendingCanonical} canonical approval(s) pending` : null,
      pendingStructure > 0 ? `${pendingStructure} structure approval(s) pending` : null,
      activeExceptions > 0 ? `${activeExceptions} working exception(s) active` : null,
      pendingRelationships > 0 ? `${pendingRelationships} relationship approval(s) pending` : null,
      unresolvedDrifts > 0 ? `${unresolvedDrifts} provenance drift(s) unresolved` : null
    ].filter((item): item is string => Boolean(item));
    return {
      pendingCanonical,
      pendingStructure,
      activeExceptions,
      pendingRelationships,
      unresolvedDrifts,
      blockers
    };
  }

  getArchiveCenter(projectId: string) {
    const project = this.getProject(projectId);
    const manifest = this.getArchiveManifest(projectId);
    const safety = this.getArchiveBlockers(projectId);
    const pendingProposals = this.database
      .prepare(`
        SELECT * FROM lifecycle_proposals
        WHERE project_id = ? AND status = 'pending'
        ORDER BY created_at DESC
      `)
      .all(projectId)
      .map((row) => {
        const item = row as Row;
        return {
          id: String(item.id),
          projectId: String(item.project_id),
          targetStatus: String(item.target_status),
          reason: String(item.reason),
          resumeInstruction: String(item.resume_instruction),
          createdAt: String(item.created_at)
        };
      });
    const snapshots = this.database
      .prepare("SELECT * FROM archive_snapshots WHERE project_id = ? ORDER BY archived_at DESC LIMIT 20")
      .all(projectId)
      .map((row) => {
        const item = row as Row;
        return {
          id: String(item.id),
          previousStatus: String(item.previous_status),
          archivedStatus: String(item.archived_status),
          manifest: parseJson<Record<string, unknown>>(item.manifest, {}),
          reason: String(item.reason),
          resumeInstruction: String(item.resume_instruction),
          status: String(item.status),
          archivedAt: String(item.archived_at),
          restoredAt: item.restored_at ? String(item.restored_at) : null
        };
      });
    return {
      project,
      manifest,
      safety: { ...safety, archiveReady: safety.blockers.length === 0 },
      pendingProposals,
      snapshots
    };
  }

  createLifecycleProposal(projectId: string, input: LifecycleProposalInput) {
    const project = this.getProject(projectId);
    assertOneOf(input.targetStatus, projectStatuses, "Project lifecycle status");
    assertNonEmpty(input.reason, "Lifecycle change reason");
    if (String(project.status) === input.targetStatus) {
      throw new DomainError("Project is already in the requested lifecycle status.");
    }
    const existing = this.database
      .prepare("SELECT id FROM lifecycle_proposals WHERE project_id = ? AND status = 'pending'")
      .get(projectId);
    if (existing) throw new DomainError("A lifecycle proposal is already pending for this project.");
    const proposal = {
      id: randomUUID(),
      projectId,
      targetStatus: input.targetStatus,
      reason: input.reason.trim(),
      resumeInstruction: input.resumeInstruction?.trim() ?? "",
      createdAt: nowIso()
    };
    this.database.prepare(`
      INSERT INTO lifecycle_proposals (
        id, project_id, target_status, reason, resume_instruction, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      proposal.id, proposal.projectId, proposal.targetStatus, proposal.reason,
      proposal.resumeInstruction, proposal.createdAt
    );
    return proposal;
  }

  approveLifecycleProposal(proposalId: string) {
    const proposal = this.database
      .prepare("SELECT * FROM lifecycle_proposals WHERE id = ? AND status = 'pending'")
      .get(proposalId) as Row | undefined;
    if (!proposal) throw new DomainError("Pending lifecycle proposal was not found.", 404);
    const projectId = String(proposal.project_id);
    const targetStatus = String(proposal.target_status) as ProjectStatus;
    const before = this.getProject(projectId);
    if (String(before.status) === targetStatus) {
      throw new DomainError("Project lifecycle status changed before this proposal was approved.");
    }
    if (targetStatus !== "active") {
      const safety = this.getArchiveBlockers(projectId);
      if (safety.blockers.length > 0) {
        throw new DomainError(`Resolve archive blockers first: ${safety.blockers.join(", ")}`);
      }
    }
    const timestamp = nowIso();
    const manifest = this.getArchiveManifest(projectId);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?")
        .run(targetStatus, timestamp, projectId);
      let snapshotId: string | null = null;
      if (targetStatus === "active") {
        const latest = this.database.prepare(`
          SELECT id FROM archive_snapshots
          WHERE project_id = ? AND status = 'archived'
          ORDER BY archived_at DESC LIMIT 1
        `).get(projectId) as Row | undefined;
        if (latest) {
          snapshotId = String(latest.id);
          this.database
            .prepare("UPDATE archive_snapshots SET status = 'restored', restored_at = ? WHERE id = ?")
            .run(timestamp, snapshotId);
        }
      } else {
        snapshotId = randomUUID();
        this.database.prepare(`
          INSERT INTO archive_snapshots (
            id, project_id, previous_status, archived_status, manifest, reason,
            resume_instruction, status, archived_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'archived', ?)
        `).run(
          snapshotId, projectId, String(before.status), targetStatus, JSON.stringify(manifest),
          String(proposal.reason), String(proposal.resume_instruction), timestamp
        );
      }
      this.database
        .prepare("UPDATE lifecycle_proposals SET status = 'approved', resolved_at = ? WHERE id = ?")
        .run(timestamp, proposalId);
      const after = this.getProject(projectId);
      this.recordHistoryEvent({
        projectId,
        eventType: targetStatus === "active" ? "project_restored" : "project_archived",
        targetType: "project",
        targetId: projectId,
        summary: `Project lifecycle: ${String(before.status)} → ${targetStatus}`,
        beforeSnapshot: before,
        afterSnapshot: after,
        sourceType: "lifecycle_proposal",
        sourceId: proposalId,
        metadata: {
          reason: String(proposal.reason),
          resumeInstruction: String(proposal.resume_instruction),
          snapshotId,
          manifest
        },
        createdAt: timestamp
      });
      const result = { proposalId, project: after, snapshotId, resolvedAt: timestamp };
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  rejectLifecycleProposal(proposalId: string) {
    const proposal = this.database
      .prepare("SELECT * FROM lifecycle_proposals WHERE id = ? AND status = 'pending'")
      .get(proposalId) as Row | undefined;
    if (!proposal) throw new DomainError("Pending lifecycle proposal was not found.", 404);
    const timestamp = nowIso();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare("UPDATE lifecycle_proposals SET status = 'rejected', resolved_at = ? WHERE id = ?")
        .run(timestamp, proposalId);
      this.recordHistoryEvent({
        projectId: String(proposal.project_id),
        eventType: "lifecycle_proposal_rejected",
        targetType: "project",
        targetId: String(proposal.project_id),
        summary: `Lifecycle proposal rejected: ${String(proposal.target_status)}`,
        afterSnapshot: { targetStatus: proposal.target_status },
        sourceType: "lifecycle_proposal",
        sourceId: proposalId,
        metadata: { reason: String(proposal.reason) },
        createdAt: timestamp
      });
      this.database.exec("COMMIT;");
      return { proposalId, status: "rejected", resolvedAt: timestamp };
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  addExploration(projectId: string, content: string) {
    this.requireActiveProject(projectId);
    assertNonEmpty(content, "Exploration");
    const entry = {
      id: randomUUID(),
      projectId,
      content: content.trim(),
      status: "open",
      createdAt: nowIso()
    };
    this.database
      .prepare(`
        INSERT INTO exploration_entries (id, project_id, content, status, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(entry.id, projectId, entry.content, entry.status, entry.createdAt);
    this.recordHistoryEvent({
      projectId,
      eventType: "exploration_added",
      targetType: "exploration",
      targetId: entry.id,
      summary: `Exploration added: ${entry.content}`,
      afterSnapshot: entry,
      sourceType: "user_action",
      sourceId: entry.id,
      createdAt: entry.createdAt
    });
    return entry;
  }

  promoteExploration(
    projectId: string,
    explorationId: string,
    targetType: ProposalTarget,
    category?: string
  ) {
    this.requireActiveProject(projectId);
    assertOneOf(targetType, proposalTargets, "승격 대상");
    const exploration = this.database
      .prepare("SELECT * FROM exploration_entries WHERE id = ? AND project_id = ?")
      .get(explorationId, projectId) as Row | undefined;
    if (!exploration || exploration.status !== "open") {
      throw new DomainError("승격할 수 있는 Exploration을 찾을 수 없습니다.", 404);
    }
    const pendingPromotion = this.database
      .prepare(`
        SELECT id FROM exploration_promotions
        WHERE exploration_id = ? AND status = 'pending'
      `)
      .get(explorationId);
    if (pendingPromotion) {
      throw new DomainError("이미 승인 대기 중인 Exploration 승격 후보가 있습니다.");
    }

    const timestamp = nowIso();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const proposal = this.createProposal(projectId, {
        targetType,
        category: targetType === "truth" ? category?.trim() || "promoted_idea" : undefined,
        content: String(exploration.content),
        verificationStatus: targetType === "current_state" ? "unverified" : "confirmed",
        itemStatus: targetType === "next_action" ? "pending" : undefined,
        reason: "Exploration에서 승격된 변경 후보 — 승인 전에는 정본 미반영"
      });
      this.database
        .prepare(`
          INSERT INTO exploration_promotions (
            id, project_id, exploration_id, proposal_id, target_type, status, created_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
        `)
        .run(randomUUID(), projectId, explorationId, proposal.id, targetType, timestamp);
      this.database.exec("COMMIT;");
      return { explorationId, proposal, status: "pending_approval" };
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  dismissExploration(projectId: string, explorationId: string) {
    this.requireActiveProject(projectId);
    const pendingPromotion = this.database
      .prepare(`
        SELECT id FROM exploration_promotions
        WHERE exploration_id = ? AND status = 'pending'
      `)
      .get(explorationId);
    if (pendingPromotion) {
      throw new DomainError("승격 후보를 먼저 승인하거나 거절해야 Exploration을 종료할 수 있습니다.");
    }
    const result = this.database
      .prepare(`
        UPDATE exploration_entries SET status = 'dismissed'
        WHERE id = ? AND project_id = ? AND status = 'open'
      `)
      .run(explorationId, projectId);
    if (result.changes === 0) {
      throw new DomainError("종료할 수 있는 Exploration을 찾을 수 없습니다.", 404);
    }
    const timestamp = nowIso();
    this.database
      .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
      .run(timestamp, projectId);
    this.recordHistoryEvent({
      projectId,
      eventType: "exploration_dismissed",
      targetType: "exploration",
      targetId: explorationId,
      summary: "Exploration dismissed without canonical change",
      afterSnapshot: { status: "dismissed" },
      sourceType: "user_action",
      sourceId: explorationId,
      createdAt: timestamp
    });
    return { explorationId, status: "dismissed", resolvedAt: timestamp };
  }

  createProposal(projectId: string, input: ProposalInput) {
    this.requireActiveProject(projectId);
    assertOneOf(input.targetType, proposalTargets, "변경 대상");
    assertOneOf(input.verificationStatus, verificationStatuses, "검증 상태");
    assertNonEmpty(input.content, "변경 내용");
    assertNonEmpty(input.reason, "변경 이유");

    if (input.targetType === "truth") {
      assertNonEmpty(input.category ?? "", "Truth 범주");
    }
    if (input.targetType === "next_action") {
      const itemStatus = input.itemStatus ?? "pending";
      assertOneOf(itemStatus, actionStatuses, "작업 상태");
      assertActionState(itemStatus, input.verificationStatus);
    }

    const proposal = {
      id: randomUUID(),
      projectId,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      category: input.category ?? null,
      proposedContent: input.content.trim(),
      proposedVerification: input.verificationStatus,
      proposedItemStatus: input.itemStatus ?? null,
      reason: input.reason.trim(),
      status: "pending",
      createdAt: nowIso()
    };

    this.database
      .prepare(`
        INSERT INTO change_proposals (
          id, project_id, target_type, target_id, category, proposed_content,
          proposed_verification, proposed_item_status, reason, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        proposal.id,
        proposal.projectId,
        proposal.targetType,
        proposal.targetId,
        proposal.category,
        proposal.proposedContent,
        proposal.proposedVerification,
        proposal.proposedItemStatus,
        proposal.reason,
        proposal.status,
        proposal.createdAt
      );
    return proposal;
  }

  private getCanonicalSnapshot(proposal: Row) {
    const projectId = String(proposal.project_id);
    const targetType = String(proposal.target_type) as ProposalTarget;
    let row: Row | undefined;

    if (targetType === "truth") {
      if (proposal.target_id) {
        row = this.database
          .prepare("SELECT * FROM truth_entries WHERE id = ? AND project_id = ?")
          .get(String(proposal.target_id), projectId) as Row | undefined;
      } else if (proposal.category) {
        row = this.database
          .prepare(`
            SELECT * FROM truth_entries
            WHERE project_id = ? AND category = ?
            ORDER BY committed_at DESC LIMIT 1
          `)
          .get(projectId, String(proposal.category)) as Row | undefined;
      }
    }
    if (targetType === "current_state") {
      row = this.database
        .prepare("SELECT * FROM current_state WHERE project_id = ?")
        .get(projectId) as Row | undefined;
    }
    if (targetType === "next_action" && proposal.target_id) {
      row = this.database
        .prepare("SELECT * FROM next_actions WHERE id = ? AND project_id = ?")
        .get(String(proposal.target_id), projectId) as Row | undefined;
    }

    if (!row) {
      return {
        exists: false,
        targetId: proposal.target_id ? String(proposal.target_id) : null,
        content: null,
        category: proposal.category ? String(proposal.category) : null,
        verificationStatus: null,
        itemStatus: null,
        version: null
      };
    }

    return {
      exists: true,
      targetId: String(row.id ?? row.project_id),
      content: String(row.content ?? row.summary),
      category: row.category ? String(row.category) : proposal.category ? String(proposal.category) : null,
      verificationStatus: String(row.verification_status),
      itemStatus: row.status ? String(row.status) : null,
      version: row.version ? Number(row.version) : null
    };
  }

  approveProposal(proposalId: string, conflictResolution?: ApprovedConflictResolution) {
    const proposal = this.database
      .prepare("SELECT * FROM change_proposals WHERE id = ?")
      .get(proposalId) as Row | undefined;
    if (!proposal) throw new DomainError("변경 후보를 찾을 수 없습니다.", 404);
    if (proposal.status !== "pending") {
      throw new DomainError("이미 처리된 변경 후보입니다.");
    }
    const isConflict = proposal.proposed_verification === "conflicted";
    if (isConflict && !conflictResolution) {
      throw new DomainError("conflicted 변경은 충돌 해결 전 정본에 반영할 수 없습니다.");
    }

    const targetType = proposal.target_type as ProposalTarget;
    const projectId = String(proposal.project_id);
    const timestamp = nowIso();
    const beforeSnapshot = this.getCanonicalSnapshot(proposal);
    let targetId = typeof proposal.target_id === "string" ? proposal.target_id : randomUUID();
    const committedVerification = isConflict
      ? "confirmed"
      : String(proposal.proposed_verification);

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      if (targetType === "truth") {
        if (proposal.target_id) {
          const result = this.database
            .prepare(`
              UPDATE truth_entries
              SET category = ?, content = ?, verification_status = ?, version = version + 1,
                  committed_at = ?
              WHERE id = ? AND project_id = ?
            `)
            .run(
              String(proposal.category ?? ""),
              String(proposal.proposed_content),
              committedVerification,
              timestamp,
              String(proposal.target_id),
              projectId
            );
          if (result.changes === 0) throw new DomainError("변경할 Truth를 찾을 수 없습니다.", 404);
        } else {
          this.database
            .prepare(`
              INSERT INTO truth_entries (
                id, project_id, category, content, verification_status, version, committed_at
              ) VALUES (?, ?, ?, ?, ?, 1, ?)
            `)
            .run(
              targetId,
              projectId,
              String(proposal.category ?? ""),
              String(proposal.proposed_content),
              committedVerification,
              timestamp
            );
        }
      }

      if (targetType === "current_state") {
        targetId = projectId;
        this.database
          .prepare(`
            INSERT INTO current_state (project_id, summary, verification_status, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
              summary = excluded.summary,
              verification_status = excluded.verification_status,
              updated_at = excluded.updated_at
          `)
          .run(
            projectId,
            String(proposal.proposed_content),
            committedVerification,
            timestamp
          );
      }

      if (targetType === "next_action") {
        const itemStatus = String(proposal.proposed_item_status ?? "pending") as ActionStatus;
        const verificationStatus = committedVerification as VerificationStatus;
        assertOneOf(itemStatus, actionStatuses, "작업 상태");
        assertActionState(itemStatus, verificationStatus);
        if (proposal.target_id) {
          const result = this.database
            .prepare(`
              UPDATE next_actions
              SET content = ?, status = ?, verification_status = ?, updated_at = ?
              WHERE id = ? AND project_id = ?
            `)
            .run(
              String(proposal.proposed_content),
              itemStatus,
              verificationStatus,
              timestamp,
              String(proposal.target_id),
              projectId
            );
          if (result.changes === 0) throw new DomainError("변경할 Next Action을 찾을 수 없습니다.", 404);
        } else {
          this.database
            .prepare(`
              INSERT INTO next_actions (
                id, project_id, content, status, verification_status, priority, updated_at
              ) VALUES (?, ?, ?, ?, ?, 0, ?)
            `)
            .run(
              targetId,
              projectId,
              String(proposal.proposed_content),
              itemStatus,
              verificationStatus,
              timestamp
            );
        }
      }

      this.database
        .prepare("UPDATE change_proposals SET status = 'approved', resolved_at = ? WHERE id = ?")
        .run(timestamp, proposalId);
      this.database
        .prepare(`
          INSERT INTO commit_events (
            id, project_id, proposal_id, target_type, target_id, committed_change, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          projectId,
          proposalId,
          targetType,
          targetId,
          String(proposal.proposed_content),
          timestamp
        );
      this.database
        .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
        .run(timestamp, projectId);
      if (conflictResolution) {
        this.database
          .prepare(`
            INSERT INTO conflict_resolutions (
              id, proposal_id, project_id, decision, canonical_snapshot,
              proposed_snapshot, note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            randomUUID(),
            proposalId,
            projectId,
            conflictResolution.decision,
            conflictResolution.canonicalSnapshot,
            JSON.stringify({
              targetType,
              targetId,
              content: String(proposal.proposed_content),
              verificationStatus: "confirmed",
              itemStatus: proposal.proposed_item_status ?? null
            }),
            conflictResolution.note,
            timestamp
          );
      }
      const promotion = this.database
        .prepare("SELECT exploration_id FROM exploration_promotions WHERE proposal_id = ? AND status = 'pending'")
        .get(proposalId) as Row | undefined;
      if (promotion) {
        this.database
          .prepare("UPDATE exploration_entries SET status = 'promoted' WHERE id = ?")
          .run(String(promotion.exploration_id));
        this.database
          .prepare(`
            UPDATE exploration_promotions
            SET status = 'committed', resolved_at = ?
            WHERE proposal_id = ?
          `)
          .run(timestamp, proposalId);
      }
      const contextPromotion = this.database
        .prepare("SELECT * FROM context_promotions WHERE proposal_id = ? AND status = 'pending'")
        .get(proposalId) as Row | undefined;
      if (contextPromotion) {
        this.database
          .prepare(`
            UPDATE context_promotions
            SET status = 'committed', resolved_at = ?
            WHERE proposal_id = ?
          `)
          .run(timestamp, proposalId);
      }
      const afterSnapshot = {
        exists: true,
        targetId,
        content: String(proposal.proposed_content),
        category: proposal.category ? String(proposal.category) : null,
        verificationStatus: committedVerification,
        itemStatus: targetType === "next_action"
          ? String(proposal.proposed_item_status ?? "pending")
          : null,
        version: targetType === "truth"
          ? Number(beforeSnapshot.version ?? 0) + 1
          : null
      };
      this.recordHistoryEvent({
        projectId,
        eventType: conflictResolution ? "conflict_resolution" : "canonical_commit",
        targetType,
        targetId,
        summary: `${targetType.replace("_", " ")} committed: ${String(proposal.proposed_content)}`,
        beforeSnapshot,
        afterSnapshot,
        sourceType: "change_proposal",
        sourceId: proposalId,
        metadata: {
          reason: String(proposal.reason),
          proposedVerification: String(proposal.proposed_verification),
          conflictDecision: conflictResolution?.decision ?? null,
          promotion: Boolean(promotion),
          contextPromotion: contextPromotion ? {
            id: String(contextPromotion.id),
            sourceProjectId: String(contextPromotion.source_project_id),
            relationshipId: String(contextPromotion.relationship_id),
            sourceType: String(contextPromotion.source_type),
            sourceSnapshot: parseJson<Record<string, unknown>>(contextPromotion.source_snapshot, {})
          } : null
        },
        createdAt: timestamp
      });
      if (contextPromotion) {
        this.recordHistoryEvent({
          projectId: String(contextPromotion.source_project_id),
          eventType: "context_reference_promoted",
          targetType: String(contextPromotion.source_type),
          targetId: contextPromotion.source_id ? String(contextPromotion.source_id) : null,
          summary: `Linked context promoted into ${String(this.getProject(projectId).name)}`,
          beforeSnapshot: parseJson<Record<string, unknown>>(contextPromotion.source_snapshot, {}),
          afterSnapshot: { targetProjectId: projectId, targetId, proposalId },
          sourceType: "context_promotion",
          sourceId: String(contextPromotion.id),
          createdAt: timestamp
        });
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }

    return {
      proposalId,
      targetType,
      targetId,
      committedAt: timestamp,
      conflictDecision: conflictResolution?.decision ?? null
    };
  }

  rejectProposal(proposalId: string) {
    const timestamp = nowIso();
    const proposal = this.database
      .prepare("SELECT * FROM change_proposals WHERE id = ? AND status = 'pending'")
      .get(proposalId) as Row | undefined;
    if (!proposal) throw new DomainError("처리할 변경 후보를 찾을 수 없습니다.", 404);
    this.database.exec("BEGIN IMMEDIATE;");
    let changes = 0;
    try {
      const result = this.database
        .prepare(`
          UPDATE change_proposals
          SET status = 'rejected', resolved_at = ?
          WHERE id = ? AND status = 'pending'
        `)
        .run(timestamp, proposalId);
      changes = Number(result.changes);
      if (changes === 0) throw new DomainError("처리할 변경 후보를 찾을 수 없습니다.", 404);
      this.database
        .prepare(`
          UPDATE exploration_promotions
          SET status = 'cancelled', resolved_at = ?
          WHERE proposal_id = ? AND status = 'pending'
        `)
        .run(timestamp, proposalId);
      this.database
        .prepare(`
          UPDATE context_promotions
          SET status = 'cancelled', resolved_at = ?
          WHERE proposal_id = ? AND status = 'pending'
        `)
        .run(timestamp, proposalId);
      this.recordHistoryEvent({
        projectId: String(proposal.project_id),
        eventType: "proposal_rejected",
        targetType: String(proposal.target_type),
        targetId: proposal.target_id ? String(proposal.target_id) : null,
        summary: `Proposal rejected: ${String(proposal.proposed_content)}`,
        beforeSnapshot: this.getCanonicalSnapshot(proposal),
        afterSnapshot: this.getCanonicalSnapshot(proposal),
        sourceType: "change_proposal",
        sourceId: proposalId,
        metadata: { reason: String(proposal.reason) },
        createdAt: timestamp
      });
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
    return { proposalId, status: "rejected", resolvedAt: timestamp };
  }

  getConflictCenter(projectId: string) {
    this.getProject(projectId);
    const pending = this.database
      .prepare(`
        SELECT * FROM change_proposals
        WHERE project_id = ? AND status = 'pending' AND proposed_verification = 'conflicted'
        ORDER BY created_at DESC
      `)
      .all(projectId)
      .map((row) => {
        const proposal = row as Row;
        return {
          proposal,
          canonical: this.getCanonicalSnapshot(proposal)
        };
      });
    const activeExceptions = this.database
      .prepare(`
        SELECT * FROM working_exceptions
        WHERE project_id = ? AND status = 'active'
        ORDER BY created_at DESC
      `)
      .all(projectId)
      .map((row) => {
        const item = row as Row;
        return {
          id: item.id,
          projectId: item.project_id,
          sourceProposalId: item.source_proposal_id,
          targetType: item.target_type,
          content: item.content,
          reason: item.reason,
          status: item.status,
          createdAt: item.created_at
        };
      });
    const recentResolutions = this.database
      .prepare(`
        SELECT * FROM conflict_resolutions
        WHERE project_id = ?
        ORDER BY created_at DESC LIMIT 10
      `)
      .all(projectId)
      .map((row) => {
        const item = row as Row;
        return {
          id: item.id,
          proposalId: item.proposal_id,
          decision: item.decision,
          canonicalSnapshot: parseJson<Record<string, unknown>>(item.canonical_snapshot, {}),
          proposedSnapshot: parseJson<Record<string, unknown>>(item.proposed_snapshot, {}),
          note: item.note,
          createdAt: item.created_at
        };
      });

    return { pending, activeExceptions, recentResolutions };
  }

  getHistoryCenter(projectId: string) {
    this.getProject(projectId);
    const events = this.database
      .prepare(`
        SELECT * FROM history_events
        WHERE project_id = ?
        ORDER BY created_at DESC LIMIT 100
      `)
      .all(projectId)
      .map((row) => {
        const item = row as Row;
        const beforeSnapshot = parseJson<Record<string, unknown> | null>(item.before_snapshot, null);
        const afterSnapshot = parseJson<Record<string, unknown> | null>(item.after_snapshot, null);
        const metadata = parseJson<Record<string, unknown>>(item.metadata, {});
        const conflictApplied = metadata.conflictDecision === "apply_proposed";
        const revertible =
          (item.event_type === "canonical_commit" || conflictApplied) &&
          beforeSnapshot?.exists === true &&
          ["truth", "current_state", "next_action"].includes(String(item.target_type));
        return {
          id: String(item.id),
          projectId: String(item.project_id),
          eventType: String(item.event_type),
          targetType: item.target_type ? String(item.target_type) : null,
          targetId: item.target_id ? String(item.target_id) : null,
          summary: String(item.summary),
          beforeSnapshot,
          afterSnapshot,
          sourceType: String(item.source_type),
          sourceId: item.source_id ? String(item.source_id) : null,
          metadata,
          revertible,
          createdAt: String(item.created_at)
        };
      });
    const legacyEvents = this.database
      .prepare(`
        SELECT c.* FROM commit_events c
        WHERE c.project_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM history_events h
            WHERE h.project_id = c.project_id AND h.source_id = c.proposal_id
          )
        ORDER BY c.created_at DESC LIMIT 50
      `)
      .all(projectId)
      .map((row) => {
        const item = row as Row;
        return {
          id: `legacy-${String(item.id)}`,
          projectId,
          eventType: "legacy_commit",
          targetType: String(item.target_type),
          targetId: String(item.target_id),
          summary: `Legacy commit: ${String(item.committed_change)}`,
          beforeSnapshot: null,
          afterSnapshot: { content: String(item.committed_change) },
          sourceType: "legacy_commit_event",
          sourceId: item.proposal_id ? String(item.proposal_id) : null,
          metadata: {},
          revertible: false,
          createdAt: String(item.created_at)
        };
      });
    const timeline = [...events, ...legacyEvents].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );

    return {
      timeline,
      stats: {
        total: timeline.length,
        canonicalCommits: timeline.filter((event) =>
          ["canonical_commit", "legacy_commit"].includes(event.eventType)
        ).length,
        conflictResolutions: timeline.filter((event) => event.eventType === "conflict_resolution").length,
        operationalEvents: timeline.filter((event) =>
          ["checkpoint_updated", "checkpoint_cleared", "exploration_added", "exploration_dismissed", "working_exception_closed"].includes(event.eventType)
        ).length,
        revertible: timeline.filter((event) => event.revertible).length
      }
    };
  }

  createHistoryRevertProposal(projectId: string, eventId: string) {
    this.getProject(projectId);
    const row = this.database
      .prepare("SELECT * FROM history_events WHERE id = ? AND project_id = ?")
      .get(eventId, projectId) as Row | undefined;
    if (!row) throw new DomainError("복원할 History 이벤트를 찾을 수 없습니다.", 404);

    const beforeSnapshot = parseJson<Record<string, unknown> | null>(row.before_snapshot, null);
    const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
    const targetType = String(row.target_type) as ProposalTarget;
    const conflictApplied = metadata.conflictDecision === "apply_proposed";
    const revertible =
      (row.event_type === "canonical_commit" || conflictApplied) &&
      beforeSnapshot?.exists === true &&
      proposalTargets.includes(targetType);
    if (!revertible || !beforeSnapshot?.content) {
      throw new DomainError("이 이벤트는 직접 복원할 수 없습니다. 기존 항목의 변경 이력만 복원 후보로 만들 수 있습니다.");
    }

    const verificationStatus = verificationStatuses.includes(
      String(beforeSnapshot.verificationStatus) as VerificationStatus
    )
      ? String(beforeSnapshot.verificationStatus) as VerificationStatus
      : "confirmed";
    const itemStatus = actionStatuses.includes(String(beforeSnapshot.itemStatus) as ActionStatus)
      ? String(beforeSnapshot.itemStatus) as ActionStatus
      : undefined;
    const proposal = this.createProposal(projectId, {
      targetType,
      targetId: beforeSnapshot.targetId ? String(beforeSnapshot.targetId) : String(row.target_id ?? ""),
      category: targetType === "truth"
        ? String(beforeSnapshot.category ?? "history_restore")
        : undefined,
      content: String(beforeSnapshot.content),
      verificationStatus,
      itemStatus: targetType === "next_action" ? itemStatus ?? "pending" : undefined,
      reason: `History restore candidate from ${eventId} — 승인 전에는 현재 정본 유지`
    });
    return { eventId, proposal, canonicalChanged: false };
  }

  getProjectStructure(projectId: string) {
    const project = this.getProject(projectId);
    const registryRow = this.database
      .prepare("SELECT * FROM project_registry_details WHERE project_id = ?")
      .get(projectId) as Row | undefined;
    const workstreams = this.database
      .prepare("SELECT * FROM workstreams WHERE project_id = ? ORDER BY status, updated_at DESC")
      .all(projectId)
      .map((row) => mapWorkstream(row as Row));
    const nodes = this.database
      .prepare(`
        SELECT * FROM project_nodes
        WHERE project_id = ?
        ORDER BY sort_order, created_at
      `)
      .all(projectId)
      .map((row) => mapProjectNode(row as Row));
    const pendingProposals = this.database
      .prepare(`
        SELECT * FROM structure_proposals
        WHERE project_id = ? AND status = 'pending'
        ORDER BY created_at DESC
      `)
      .all(projectId)
      .map((row) => {
        const item = row as Row;
        return {
          id: String(item.id),
          projectId: String(item.project_id),
          operation: String(item.operation),
          targetId: item.target_id ? String(item.target_id) : null,
          payload: parseJson<Record<string, unknown>>(item.payload, {}),
          reason: String(item.reason),
          status: String(item.status),
          createdAt: String(item.created_at)
        };
      });
    const strategicGoals = nodes
      .filter((node) => node.nodeType === "strategic_goal")
      .map((goal) => ({
        ...goal,
        milestones: nodes
          .filter((node) => node.nodeType === "milestone" && node.parentId === goal.id)
          .map((milestone) => ({
            ...milestone,
            tasks: nodes.filter(
              (node) => node.nodeType === "task" && node.parentId === milestone.id
            )
          }))
      }));

    return {
      project,
      registry: mapRegistry(registryRow, projectId),
      workstreams,
      nodes,
      hierarchy: strategicGoals,
      pendingProposals
    };
  }

  createStructureProposal(projectId: string, input: StructureProposalInput) {
    this.requireActiveProject(projectId);
    assertOneOf(input.operation, structureOperations, "구조 변경 작업");
    assertNonEmpty(input.reason, "구조 변경 이유");
    if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
      throw new DomainError("구조 변경 payload가 올바르지 않습니다.");
    }
    if (input.operation.startsWith("update_") && input.operation !== "update_registry" && !input.targetId) {
      throw new DomainError("변경할 구조 항목을 선택하세요.");
    }

    const proposal = {
      id: randomUUID(),
      projectId,
      operation: input.operation,
      targetId: input.targetId?.trim() || null,
      payload: input.payload,
      reason: input.reason.trim(),
      status: "pending",
      createdAt: nowIso()
    };
    this.database
      .prepare(`
        INSERT INTO structure_proposals (
          id, project_id, operation, target_id, payload, reason, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      `)
      .run(
        proposal.id,
        projectId,
        proposal.operation,
        proposal.targetId,
        JSON.stringify(proposal.payload),
        proposal.reason,
        proposal.createdAt
      );
    return proposal;
  }

  private requireWorkstream(projectId: string, workstreamId: string) {
    const row = this.database
      .prepare("SELECT * FROM workstreams WHERE id = ? AND project_id = ?")
      .get(workstreamId, projectId) as Row | undefined;
    if (!row) throw new DomainError("같은 프로젝트의 Workstream을 찾을 수 없습니다.", 404);
    return row;
  }

  private requireProjectNode(projectId: string, nodeId: string) {
    const row = this.database
      .prepare("SELECT * FROM project_nodes WHERE id = ? AND project_id = ?")
      .get(nodeId, projectId) as Row | undefined;
    if (!row) throw new DomainError("같은 프로젝트의 목표 항목을 찾을 수 없습니다.", 404);
    return row;
  }

  private validateProjectNode(
    projectId: string,
    input: {
      id?: string;
      nodeType: NodeType;
      parentId: string | null;
      workstreamId: string | null;
      status: NodeStatus;
      verificationStatus: VerificationStatus;
    }
  ) {
    assertOneOf(input.nodeType, nodeTypes, "목표 계층 유형");
    assertOneOf(input.status, nodeStatuses, "목표 상태");
    assertOneOf(input.verificationStatus, verificationStatuses, "검증 상태");
    if (input.status === "completed" && input.verificationStatus !== "confirmed") {
      throw new DomainError("confirmed 항목만 완료할 수 있습니다.");
    }
    if (input.workstreamId) this.requireWorkstream(projectId, input.workstreamId);
    if (input.nodeType === "strategic_goal" && input.parentId) {
      throw new DomainError("Strategic Goal은 상위 항목을 가질 수 없습니다.");
    }
    if (input.nodeType !== "strategic_goal") {
      if (!input.parentId) {
        throw new DomainError(`${input.nodeType === "milestone" ? "Milestone" : "Task"}의 상위 항목을 선택하세요.`);
      }
      if (input.parentId === input.id) throw new DomainError("항목은 자기 자신을 상위로 둘 수 없습니다.");
      const parent = this.requireProjectNode(projectId, input.parentId);
      const requiredParent = input.nodeType === "milestone" ? "strategic_goal" : "milestone";
      if (parent.node_type !== requiredParent) {
        throw new DomainError(
          input.nodeType === "milestone"
            ? "Milestone은 Strategic Goal 아래에만 둘 수 있습니다."
            : "Task는 Milestone 아래에만 둘 수 있습니다."
        );
      }
    }
    if (input.id && input.status === "completed" && input.nodeType !== "task") {
      const incomplete = this.database
        .prepare(`
          SELECT COUNT(*) AS count FROM project_nodes
          WHERE project_id = ? AND parent_id = ? AND status <> 'completed'
        `)
        .get(projectId, input.id) as Row;
      if (Number(incomplete.count) > 0) {
        throw new DomainError("하위 항목을 모두 완료한 뒤 상위 목표를 완료할 수 있습니다.");
      }
    }
  }

  approveStructureProposal(proposalId: string) {
    const proposal = this.database
      .prepare("SELECT * FROM structure_proposals WHERE id = ? AND status = 'pending'")
      .get(proposalId) as Row | undefined;
    if (!proposal) throw new DomainError("처리할 구조 변경 후보를 찾을 수 없습니다.", 404);
    const projectId = String(proposal.project_id);
    const operation = String(proposal.operation) as StructureOperation;
    const payload = parseJson<Record<string, unknown>>(proposal.payload, {});
    const targetId = proposal.target_id ? String(proposal.target_id) : null;
    const timestamp = nowIso();
    let changedTargetId = targetId ?? projectId;
    let beforeSnapshot: unknown = null;
    let afterSnapshot: unknown = null;

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      if (operation === "update_registry") {
        const existing = this.database
          .prepare("SELECT * FROM project_registry_details WHERE project_id = ?")
          .get(projectId) as Row | undefined;
        const before = mapRegistry(existing, projectId);
        const projectLocation = String(payload.projectLocation ?? before.projectLocation).trim();
        const currentFocus = String(payload.currentFocus ?? before.currentFocus).trim();
        const relationships = Array.isArray(payload.relationships)
          ? payload.relationships.map(String).map((item) => item.trim()).filter(Boolean)
          : before.relationships;
        assertNonEmpty(projectLocation, "프로젝트 위치");
        this.database
          .prepare(`
            INSERT INTO project_registry_details (
              project_id, project_location, current_focus, last_meaningful_update,
              relationships, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
              project_location = excluded.project_location,
              current_focus = excluded.current_focus,
              last_meaningful_update = excluded.last_meaningful_update,
              relationships = excluded.relationships,
              updated_at = excluded.updated_at
          `)
          .run(
            projectId,
            projectLocation,
            currentFocus,
            timestamp,
            JSON.stringify(relationships),
            timestamp
          );
        beforeSnapshot = before;
        afterSnapshot = mapRegistry(
          this.database.prepare("SELECT * FROM project_registry_details WHERE project_id = ?").get(projectId) as Row,
          projectId
        );
      }

      if (operation === "update_primary_goal") {
        const project = this.getProject(projectId);
        const primaryGoal = String(payload.primaryGoal ?? "").trim();
        assertNonEmpty(primaryGoal, "Primary Goal");
        beforeSnapshot = { primaryGoal: project.primaryGoal };
        this.database
          .prepare("UPDATE projects SET primary_goal = ?, updated_at = ? WHERE id = ?")
          .run(primaryGoal, timestamp, projectId);
        afterSnapshot = { primaryGoal };
      }

      if (operation === "create_workstream") {
        const name = String(payload.name ?? "").trim();
        const description = String(payload.description ?? "").trim();
        const status = String(payload.status ?? "active");
        assertNonEmpty(name, "Workstream 이름");
        assertOneOf(status, workstreamStatuses, "Workstream 상태");
        changedTargetId = randomUUID();
        this.database
          .prepare(`
            INSERT INTO workstreams (id, project_id, name, description, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          .run(changedTargetId, projectId, name, description, status, timestamp, timestamp);
        beforeSnapshot = null;
        afterSnapshot = mapWorkstream(this.requireWorkstream(projectId, changedTargetId));
      }

      if (operation === "update_workstream") {
        if (!targetId) throw new DomainError("변경할 Workstream을 선택하세요.");
        const existing = this.requireWorkstream(projectId, targetId);
        const name = String(payload.name ?? existing.name).trim();
        const description = String(payload.description ?? existing.description).trim();
        const status = String(payload.status ?? existing.status);
        assertNonEmpty(name, "Workstream 이름");
        assertOneOf(status, workstreamStatuses, "Workstream 상태");
        beforeSnapshot = mapWorkstream(existing);
        this.database
          .prepare(`
            UPDATE workstreams SET name = ?, description = ?, status = ?, updated_at = ?
            WHERE id = ? AND project_id = ?
          `)
          .run(name, description, status, timestamp, targetId, projectId);
        afterSnapshot = mapWorkstream(this.requireWorkstream(projectId, targetId));
      }

      if (operation === "create_node") {
        const nodeType = String(payload.nodeType ?? "task") as NodeType;
        const title = String(payload.title ?? "").trim();
        const description = String(payload.description ?? "").trim();
        const status = String(payload.status ?? "planned") as NodeStatus;
        const verificationStatus = String(payload.verificationStatus ?? "unverified") as VerificationStatus;
        const parentId = payload.parentId ? String(payload.parentId) : null;
        const workstreamId = payload.workstreamId ? String(payload.workstreamId) : null;
        const sortOrder = Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0;
        assertNonEmpty(title, "목표 제목");
        this.validateProjectNode(projectId, {
          nodeType, parentId, workstreamId, status, verificationStatus
        });
        changedTargetId = randomUUID();
        this.database
          .prepare(`
            INSERT INTO project_nodes (
              id, project_id, parent_id, workstream_id, node_type, title, description,
              status, verification_status, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            changedTargetId, projectId, parentId, workstreamId, nodeType, title, description,
            status, verificationStatus, sortOrder, timestamp, timestamp
          );
        beforeSnapshot = null;
        afterSnapshot = mapProjectNode(this.requireProjectNode(projectId, changedTargetId));
      }

      if (operation === "update_node") {
        if (!targetId) throw new DomainError("변경할 목표 항목을 선택하세요.");
        const existing = this.requireProjectNode(projectId, targetId);
        if (payload.nodeType && String(payload.nodeType) !== String(existing.node_type)) {
          throw new DomainError("기존 목표 항목의 계층 유형은 변경할 수 없습니다.");
        }
        const nodeType = String(existing.node_type) as NodeType;
        const title = String(payload.title ?? existing.title).trim();
        const description = String(payload.description ?? existing.description).trim();
        const status = String(payload.status ?? existing.status) as NodeStatus;
        const verificationStatus = String(
          payload.verificationStatus ?? existing.verification_status
        ) as VerificationStatus;
        const parentId = payload.parentId === null
          ? null
          : payload.parentId
            ? String(payload.parentId)
            : existing.parent_id
              ? String(existing.parent_id)
              : null;
        const workstreamId = payload.workstreamId === null
          ? null
          : payload.workstreamId
            ? String(payload.workstreamId)
            : existing.workstream_id
              ? String(existing.workstream_id)
              : null;
        const sortOrder = payload.sortOrder === undefined
          ? Number(existing.sort_order)
          : Number(payload.sortOrder);
        assertNonEmpty(title, "목표 제목");
        this.validateProjectNode(projectId, {
          id: targetId, nodeType, parentId, workstreamId, status, verificationStatus
        });
        beforeSnapshot = mapProjectNode(existing);
        this.database
          .prepare(`
            UPDATE project_nodes SET
              parent_id = ?, workstream_id = ?, title = ?, description = ?, status = ?,
              verification_status = ?, sort_order = ?, updated_at = ?
            WHERE id = ? AND project_id = ?
          `)
          .run(
            parentId, workstreamId, title, description, status,
            verificationStatus, sortOrder, timestamp, targetId, projectId
          );
        afterSnapshot = mapProjectNode(this.requireProjectNode(projectId, targetId));
      }

      this.database
        .prepare("UPDATE structure_proposals SET status = 'approved', resolved_at = ? WHERE id = ?")
        .run(timestamp, proposalId);
      this.database
        .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
        .run(timestamp, projectId);
      this.recordHistoryEvent({
        projectId,
        eventType: "structure_commit",
        targetType: operation.includes("registry") || operation.includes("primary_goal")
          ? "project_structure"
          : operation.includes("workstream")
            ? "workstream"
            : "project_node",
        targetId: changedTargetId,
        summary: `Structure committed: ${operation}`,
        beforeSnapshot,
        afterSnapshot,
        sourceType: "structure_proposal",
        sourceId: proposalId,
        metadata: { operation, reason: String(proposal.reason) },
        createdAt: timestamp
      });
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }

    return { proposalId, operation, targetId: changedTargetId, committedAt: timestamp };
  }

  rejectStructureProposal(proposalId: string) {
    const proposal = this.database
      .prepare("SELECT * FROM structure_proposals WHERE id = ? AND status = 'pending'")
      .get(proposalId) as Row | undefined;
    if (!proposal) throw new DomainError("처리할 구조 변경 후보를 찾을 수 없습니다.", 404);
    const timestamp = nowIso();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare("UPDATE structure_proposals SET status = 'rejected', resolved_at = ? WHERE id = ?")
        .run(timestamp, proposalId);
      this.recordHistoryEvent({
        projectId: String(proposal.project_id),
        eventType: "structure_proposal_rejected",
        targetType: "project_structure",
        targetId: proposal.target_id ? String(proposal.target_id) : null,
        summary: `Structure proposal rejected: ${String(proposal.operation)}`,
        afterSnapshot: parseJson<Record<string, unknown>>(proposal.payload, {}),
        sourceType: "structure_proposal",
        sourceId: proposalId,
        metadata: { operation: proposal.operation, reason: proposal.reason },
        createdAt: timestamp
      });
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
    return { proposalId, status: "rejected", resolvedAt: timestamp };
  }

  resolveConflict(proposalId: string, decision: ConflictDecision, note = "") {
    assertOneOf(decision, conflictDecisions, "충돌 해결 방식");
    const proposal = this.database
      .prepare("SELECT * FROM change_proposals WHERE id = ?")
      .get(proposalId) as Row | undefined;
    if (!proposal) throw new DomainError("충돌 변경 후보를 찾을 수 없습니다.", 404);
    if (proposal.status !== "pending" || proposal.proposed_verification !== "conflicted") {
      throw new DomainError("현재 해결할 수 있는 충돌 후보가 아닙니다.");
    }

    const projectId = String(proposal.project_id);
    const canonical = this.getCanonicalSnapshot(proposal);
    const canonicalSnapshot = JSON.stringify(canonical);
    const normalizedNote = note.trim();
    if (decision === "apply_proposed") {
      return this.approveProposal(proposalId, {
        decision,
        note: normalizedNote,
        canonicalSnapshot
      });
    }

    const timestamp = nowIso();
    let exceptionId: string | null = null;
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database
        .prepare("UPDATE change_proposals SET status = 'rejected', resolved_at = ? WHERE id = ?")
        .run(timestamp, proposalId);
      this.database
        .prepare(`
          INSERT INTO conflict_resolutions (
            id, proposal_id, project_id, decision, canonical_snapshot,
            proposed_snapshot, note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          proposalId,
          projectId,
          decision,
          canonicalSnapshot,
          JSON.stringify({
            targetType: proposal.target_type,
            targetId: proposal.target_id ?? null,
            content: proposal.proposed_content,
            verificationStatus: proposal.proposed_verification,
            itemStatus: proposal.proposed_item_status ?? null
          }),
          normalizedNote,
          timestamp
        );

      if (decision === "temporary_exception") {
        exceptionId = randomUUID();
        this.database
          .prepare(`
            INSERT INTO working_exceptions (
              id, project_id, source_proposal_id, target_type,
              content, reason, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
          `)
          .run(
            exceptionId,
            projectId,
            proposalId,
            String(proposal.target_type),
            String(proposal.proposed_content),
            normalizedNote || "이번 작업에만 적용하는 임시 예외",
            timestamp
          );
      }
      this.recordHistoryEvent({
        projectId,
        eventType: "conflict_resolution",
        targetType: String(proposal.target_type),
        targetId: proposal.target_id ? String(proposal.target_id) : null,
        summary:
          decision === "keep_canonical"
            ? "Conflict resolved by keeping canonical state"
            : "Conflict resolved as a temporary working exception",
        beforeSnapshot: canonical,
        afterSnapshot:
          decision === "keep_canonical"
            ? canonical
            : {
                canonical,
                workingException: {
                  id: exceptionId,
                  content: String(proposal.proposed_content)
                }
              },
        sourceType: "conflict_resolution",
        sourceId: proposalId,
        metadata: { decision, note: normalizedNote },
        createdAt: timestamp
      });
      this.database
        .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
        .run(timestamp, projectId);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }

    return {
      proposalId,
      decision,
      canonicalPreserved: true,
      exceptionId,
      resolvedAt: timestamp
    };
  }

  closeWorkingException(exceptionId: string) {
    const timestamp = nowIso();
    const row = this.database
      .prepare("SELECT * FROM working_exceptions WHERE id = ?")
      .get(exceptionId) as Row | undefined;
    if (!row || row.status !== "active") {
      throw new DomainError("활성 임시 예외를 찾을 수 없습니다.", 404);
    }
    this.database
      .prepare("UPDATE working_exceptions SET status = 'closed', closed_at = ? WHERE id = ?")
      .run(timestamp, exceptionId);
    this.database
      .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
      .run(timestamp, String(row.project_id));
    this.recordHistoryEvent({
      projectId: String(row.project_id),
      eventType: "working_exception_closed",
      targetType: String(row.target_type),
      targetId: exceptionId,
      summary: `Temporary exception closed: ${String(row.content)}`,
      beforeSnapshot: { status: "active", content: row.content, reason: row.reason },
      afterSnapshot: { status: "closed", content: row.content },
      sourceType: "working_exception",
      sourceId: exceptionId,
      createdAt: timestamp
    });
    return { exceptionId, status: "closed", closedAt: timestamp };
  }

  saveCheckpoint(projectId: string, input: CheckpointInput) {
    this.requireActiveProject(projectId);
    assertNonEmpty(input.stableState, "안정 지점");
    assertNonEmpty(input.resumeInstruction, "재개 지시");
    const timestamp = nowIso();
    const previousCheckpoint = this.getCheckpoint(projectId);
    this.database
      .prepare(`
        INSERT INTO checkpoints (
          project_id, stable_state, unverified_changes, resume_instruction, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          stable_state = excluded.stable_state,
          unverified_changes = excluded.unverified_changes,
          resume_instruction = excluded.resume_instruction,
          updated_at = excluded.updated_at
      `)
      .run(
        projectId,
        input.stableState.trim(),
        JSON.stringify(input.unverifiedChanges ?? []),
        input.resumeInstruction.trim(),
        timestamp
      );
    const checkpoint = this.getCheckpoint(projectId);
    this.recordHistoryEvent({
      projectId,
      eventType: "checkpoint_updated",
      targetType: "checkpoint",
      targetId: projectId,
      summary: `Checkpoint updated: ${input.stableState.trim()}`,
      beforeSnapshot: previousCheckpoint,
      afterSnapshot: checkpoint,
      sourceType: "user_action",
      createdAt: timestamp
    });
    return checkpoint;
  }

  getCheckpoint(projectId: string) {
    const row = this.database.prepare("SELECT * FROM checkpoints WHERE project_id = ?").get(projectId) as
      | Row
      | undefined;
    if (!row) return null;
    return {
      projectId: row.project_id,
      stableState: row.stable_state,
      unverifiedChanges: parseJson<string[]>(row.unverified_changes, []),
      resumeInstruction: row.resume_instruction,
      updatedAt: row.updated_at
    };
  }

  clearCheckpoint(projectId: string) {
    this.requireActiveProject(projectId);
    const checkpoint = this.getCheckpoint(projectId);
    const result = this.database
      .prepare("DELETE FROM checkpoints WHERE project_id = ?")
      .run(projectId);
    if (result.changes === 0) {
      throw new DomainError("해제할 Active Checkpoint가 없습니다.", 404);
    }
    const timestamp = nowIso();
    this.database
      .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
      .run(timestamp, projectId);
    this.recordHistoryEvent({
      projectId,
      eventType: "checkpoint_cleared",
      targetType: "checkpoint",
      targetId: projectId,
      summary: "Checkpoint cleared after recovery completion",
      beforeSnapshot: checkpoint,
      afterSnapshot: null,
      sourceType: "user_action",
      createdAt: timestamp
    });
    return { projectId, status: "cleared", clearedAt: timestamp };
  }

  getProjectState(projectId: string) {
    const project = this.getProject(projectId);
    const truth = this.database
      .prepare("SELECT * FROM truth_entries WHERE project_id = ? ORDER BY category, committed_at DESC")
      .all(projectId);
    const currentState =
      this.database.prepare("SELECT * FROM current_state WHERE project_id = ?").get(projectId) ?? null;
    const nextActions = this.database
      .prepare("SELECT * FROM next_actions WHERE project_id = ? ORDER BY priority DESC, updated_at DESC")
      .all(projectId);
    const exploration = this.database
      .prepare("SELECT * FROM exploration_entries WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId);
    const proposals = this.database
      .prepare(`
        SELECT * FROM change_proposals
        WHERE project_id = ? AND status = 'pending'
        ORDER BY created_at DESC
      `)
      .all(projectId);

    return {
      project,
      truth,
      currentState,
      nextActions,
      exploration,
      checkpoint: this.getCheckpoint(projectId),
      proposals
    };
  }

  getContextBridge(projectId: string) {
    this.getProject(projectId);
    const relationships = this.database.prepare(`
      SELECT * FROM project_relationships
      WHERE source_project_id = ? OR target_project_id = ?
      ORDER BY updated_at DESC
    `).all(projectId, projectId) as Row[];
    const references = relationships.map((row) => {
      const relationship = mapProjectRelationship(row);
      const direction = relationship.sourceProjectId === projectId ? "outgoing" : "incoming";
      const linkedProjectId = direction === "outgoing"
        ? relationship.targetProjectId
        : relationship.sourceProjectId;
      const linkedProject = this.getProject(linkedProjectId);
      const currentState = this.database.prepare(`
        SELECT summary, verification_status, updated_at FROM current_state WHERE project_id = ?
      `).get(linkedProjectId) as Row | undefined;
      const checkpoint = this.getCheckpoint(linkedProjectId);
      const nextActions = this.database.prepare(`
        SELECT id, content, status, verification_status, updated_at
        FROM next_actions
        WHERE project_id = ? AND status <> 'completed' AND verification_status = 'confirmed'
        ORDER BY priority DESC, updated_at DESC LIMIT 3
      `).all(linkedProjectId).map((action) => {
        const item = action as Row;
        return {
          id: String(item.id),
          content: String(item.content),
          status: String(item.status),
          verificationStatus: String(item.verification_status),
          updatedAt: String(item.updated_at)
        };
      });
      const confirmedSignals = this.database.prepare(`
        SELECT id, category, content, version, committed_at
        FROM truth_entries
        WHERE project_id = ? AND verification_status = 'confirmed'
        ORDER BY committed_at DESC LIMIT 3
      `).all(linkedProjectId).map((entry) => {
        const item = entry as Row;
        return {
          id: String(item.id),
          category: String(item.category),
          content: String(item.content),
          version: Number(item.version),
          committedAt: String(item.committed_at)
        };
      });
      return {
        relationship: {
          id: relationship.id,
          direction,
          relationshipType: relationship.relationshipType,
          note: relationship.note
        },
        project: linkedProject,
        referenceState: {
          currentState: currentState
            ? {
                summary: String(currentState.summary),
                verificationStatus: String(currentState.verification_status),
                updatedAt: String(currentState.updated_at)
              }
            : null,
          checkpoint,
          nextActions,
          confirmedSignals
        },
        canonicalImportAllowed: false
      };
    });
    return {
      mode: "reference_only" as const,
      canonicalProjectId: projectId,
      linkedProjectCount: references.length,
      rules: [
        "Linked project references never merge into projectTruth, currentState, or nextActions.",
        "Relationship direction does not grant canonical authority.",
        "Promoting linked context requires an explicit proposal in the canonical project."
      ],
      references
    };
  }

  getContextPromotionCenter(projectId: string) {
    const project = this.getProject(projectId);
    const bridge = this.getContextBridge(projectId);
    const promotions = this.database.prepare(`
      SELECT
        cp.*,
        source.name AS source_project_name,
        proposal.target_type,
        proposal.category,
        proposal.proposed_content,
        proposal.proposed_verification,
        proposal.proposed_item_status,
        proposal.reason AS proposal_reason,
        proposal.status AS proposal_status
      FROM context_promotions cp
      JOIN projects source ON source.id = cp.source_project_id
      JOIN change_proposals proposal ON proposal.id = cp.proposal_id
      WHERE cp.project_id = ?
      ORDER BY cp.created_at DESC
    `).all(projectId).map((row) => {
      const item = row as Row;
      return {
        ...mapContextPromotion(item),
        sourceProjectName: String(item.source_project_name),
        proposal: {
          id: String(item.proposal_id),
          targetType: String(item.target_type),
          category: item.category ? String(item.category) : null,
          content: String(item.proposed_content),
          verificationStatus: String(item.proposed_verification),
          itemStatus: item.proposed_item_status ? String(item.proposed_item_status) : null,
          reason: String(item.proposal_reason),
          status: String(item.proposal_status)
        }
      };
    });
    return {
      project,
      boundary: {
        mode: bridge.mode,
        rule: "Cross-project evidence becomes an unverified proposal and never bypasses approval."
      },
      references: bridge.references,
      pendingPromotions: promotions.filter((promotion) => promotion.status === "pending"),
      recentPromotions: promotions.filter((promotion) => promotion.status !== "pending").slice(0, 20)
    };
  }

  private evaluateContextPromotionDrift(row: Row) {
    const promotion = mapContextPromotion(row);
    const baseline = promotion.sourceSnapshot;
    const sourceProject = this.getProject(promotion.sourceProjectId);
    let sourceRow: Row | undefined;
    if (promotion.sourceType === "truth" && promotion.sourceId) {
      sourceRow = this.database.prepare(`
        SELECT * FROM truth_entries WHERE id = ? AND project_id = ?
      `).get(promotion.sourceId, promotion.sourceProjectId) as Row | undefined;
    }
    if (promotion.sourceType === "current_state") {
      sourceRow = this.database.prepare(`
        SELECT * FROM current_state WHERE project_id = ?
      `).get(promotion.sourceProjectId) as Row | undefined;
    }
    if (promotion.sourceType === "next_action" && promotion.sourceId) {
      sourceRow = this.database.prepare(`
        SELECT * FROM next_actions WHERE id = ? AND project_id = ?
      `).get(promotion.sourceId, promotion.sourceProjectId) as Row | undefined;
    }
    const currentSnapshot = sourceRow ? {
      projectId: promotion.sourceProjectId,
      projectName: String(sourceProject.name),
      projectStatus: String(sourceProject.status),
      relationshipId: promotion.relationshipId,
      sourceType: promotion.sourceType,
      sourceId: promotion.sourceId,
      category: sourceRow.category ? String(sourceRow.category) : null,
      content: String(sourceRow.content ?? sourceRow.summary),
      verificationStatus: String(sourceRow.verification_status),
      itemStatus: sourceRow.status ? String(sourceRow.status) : null
    } : null;
    const comparableFields = [
      "projectStatus", "category", "content", "verificationStatus", "itemStatus"
    ] as const;
    const driftFields = currentSnapshot
      ? comparableFields.filter((field) => baseline[field] !== undefined && baseline[field] !== currentSnapshot[field])
      : ["sourceMissing"];
    const state = currentSnapshot === null ? "missing" : driftFields.length > 0 ? "changed" : "stable";
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ state, currentSnapshot, driftFields }))
      .digest("hex");
    const acknowledgement = this.database.prepare(`
      SELECT * FROM context_drift_acknowledgements
      WHERE context_promotion_id = ? AND fingerprint = ?
    `).get(promotion.id, fingerprint) as Row | undefined;
    const severity = state === "missing"
      ? "critical"
      : driftFields.some((field) => ["verificationStatus", "projectStatus"].includes(field))
        ? "high"
        : driftFields.includes("content")
          ? "medium"
          : state === "changed" ? "low" : "none";
    return {
      ...promotion,
      sourceProjectName: String(sourceProject.name),
      baselineSnapshot: baseline,
      currentSnapshot,
      driftState: state,
      driftFields,
      severity,
      fingerprint,
      acknowledged: Boolean(acknowledgement),
      acknowledgement: acknowledgement ? {
        note: String(acknowledgement.note),
        acknowledgedAt: String(acknowledgement.acknowledged_at)
      } : null
    };
  }

  getProvenanceDriftCenter(projectId: string) {
    const project = this.getProject(projectId);
    const promotions = this.database.prepare(`
      SELECT * FROM context_promotions
      WHERE project_id = ? AND status = 'committed'
      ORDER BY resolved_at DESC, created_at DESC
    `).all(projectId).map((row) => this.evaluateContextPromotionDrift(row as Row));
    const activeDrifts = promotions.filter((item) => item.driftState !== "stable" && !item.acknowledged);
    const acknowledgedDrifts = promotions.filter((item) => item.driftState !== "stable" && item.acknowledged);
    const stablePromotions = promotions.filter((item) => item.driftState === "stable");
    return {
      project,
      scannedAt: nowIso(),
      stats: {
        monitoredPromotions: promotions.length,
        activeDrifts: activeDrifts.length,
        acknowledgedDrifts: acknowledgedDrifts.length,
        stablePromotions: stablePromotions.length,
        criticalDrifts: activeDrifts.filter((item) => item.severity === "critical").length
      },
      activeDrifts,
      acknowledgedDrifts,
      stablePromotions
    };
  }

  acknowledgeProvenanceDrift(projectId: string, promotionId: string, note: string) {
    this.requireActiveProject(projectId);
    assertNonEmpty(note, "drift acknowledgement note");
    const center = this.getProvenanceDriftCenter(projectId);
    const drift = center.activeDrifts.find((item) => item.id === promotionId);
    if (!drift) throw new DomainError("Active provenance drift was not found.", 404);
    const timestamp = nowIso();
    const acknowledgement = {
      id: randomUUID(),
      promotionId,
      fingerprint: drift.fingerprint,
      note: note.trim(),
      acknowledgedAt: timestamp
    };
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database.prepare(`
        INSERT INTO context_drift_acknowledgements (
          id, context_promotion_id, fingerprint, note, acknowledged_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        acknowledgement.id,
        acknowledgement.promotionId,
        acknowledgement.fingerprint,
        acknowledgement.note,
        acknowledgement.acknowledgedAt
      );
      this.recordHistoryEvent({
        projectId,
        eventType: "provenance_drift_acknowledged",
        targetType: "context_promotion",
        targetId: promotionId,
        summary: `Provenance drift acknowledged from ${drift.sourceProjectName}`,
        beforeSnapshot: drift.baselineSnapshot,
        afterSnapshot: drift.currentSnapshot,
        sourceType: "drift_monitor",
        sourceId: acknowledgement.id,
        metadata: {
          driftFields: drift.driftFields,
          severity: drift.severity,
          note: acknowledgement.note,
          fingerprint: acknowledgement.fingerprint
        },
        createdAt: timestamp
      });
      this.database.exec("COMMIT;");
      return acknowledgement;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  createContextPromotion(projectId: string, input: ContextPromotionInput) {
    this.requireActiveProject(projectId);
    assertOneOf(input.sourceType, ["truth", "current_state", "next_action"] as const, "context source type");
    assertNonEmpty(input.relationshipId, "project relationship");
    assertNonEmpty(input.sourceProjectId, "source project");
    assertNonEmpty(input.reason, "context promotion reason");
    const relationship = this.database.prepare(`
      SELECT * FROM project_relationships
      WHERE id = ? AND (
        (source_project_id = ? AND target_project_id = ?) OR
        (source_project_id = ? AND target_project_id = ?)
      )
    `).get(
      input.relationshipId,
      projectId,
      input.sourceProjectId,
      input.sourceProjectId,
      projectId
    ) as Row | undefined;
    if (!relationship) throw new DomainError("The selected project relationship does not connect this source.", 404);
    const pendingRemoval = this.database.prepare(`
      SELECT id FROM project_relationship_proposals
      WHERE relationship_id = ? AND operation = 'remove' AND status = 'pending'
    `).get(input.relationshipId);
    if (pendingRemoval) {
      throw new DomainError("Resolve the pending relationship removal before promoting its context.");
    }
    const sourceProject = this.getProject(input.sourceProjectId);
    let sourceRow: Row | undefined;
    let sourceId: string | null = null;

    if (input.sourceType === "truth") {
      sourceId = String(input.sourceId ?? "").trim();
      assertNonEmpty(sourceId, "source Truth");
      sourceRow = this.database.prepare(`
        SELECT * FROM truth_entries
        WHERE id = ? AND project_id = ? AND verification_status = 'confirmed'
      `).get(sourceId, input.sourceProjectId) as Row | undefined;
    }
    if (input.sourceType === "current_state") {
      sourceRow = this.database.prepare(`
        SELECT * FROM current_state
        WHERE project_id = ? AND verification_status = 'confirmed'
      `).get(input.sourceProjectId) as Row | undefined;
      sourceId = input.sourceProjectId;
    }
    if (input.sourceType === "next_action") {
      sourceId = String(input.sourceId ?? "").trim();
      assertNonEmpty(sourceId, "source Next Action");
      sourceRow = this.database.prepare(`
        SELECT * FROM next_actions
        WHERE id = ? AND project_id = ? AND verification_status = 'confirmed' AND status <> 'completed'
      `).get(sourceId, input.sourceProjectId) as Row | undefined;
    }
    if (!sourceRow) throw new DomainError("Only a confirmed, active linked context item can be promoted.", 404);
    const duplicate = this.database.prepare(`
      SELECT id FROM context_promotions
      WHERE project_id = ? AND relationship_id = ? AND source_type = ?
        AND source_id = ? AND status = 'pending'
    `).get(projectId, input.relationshipId, input.sourceType, sourceId) as Row | undefined;
    if (duplicate) throw new DomainError("This linked context item already has a pending promotion.");

    const content = String(sourceRow.content ?? sourceRow.summary);
    const category = input.sourceType === "truth"
      ? `linked_${String(sourceRow.category ?? "context")}`
      : undefined;
    const timestamp = nowIso();
    const sourceSnapshot = {
      projectId: input.sourceProjectId,
      projectName: String(sourceProject.name),
      projectStatus: String(sourceProject.status),
      relationshipId: input.relationshipId,
      relationshipType: String(relationship.relationship_type),
      sourceType: input.sourceType,
      sourceId,
      category: sourceRow.category ? String(sourceRow.category) : null,
      content,
      verificationStatus: String(sourceRow.verification_status),
      itemStatus: sourceRow.status ? String(sourceRow.status) : null,
      capturedAt: timestamp
    };

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const proposal = this.createProposal(projectId, {
        targetType: input.sourceType,
        category,
        content,
        verificationStatus: "unverified",
        itemStatus: input.sourceType === "next_action" ? "pending" : undefined,
        reason: `Context promotion from ${String(sourceProject.name)} via ${String(relationship.relationship_type)} — ${input.reason.trim()}`
      });
      const promotion = {
        id: randomUUID(),
        projectId,
        sourceProjectId: input.sourceProjectId,
        relationshipId: input.relationshipId,
        sourceType: input.sourceType,
        sourceId,
        sourceSnapshot,
        proposalId: String(proposal.id),
        status: "pending",
        createdAt: timestamp
      };
      this.database.prepare(`
        INSERT INTO context_promotions (
          id, project_id, source_project_id, relationship_id, source_type,
          source_id, source_snapshot, proposal_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        promotion.id, promotion.projectId, promotion.sourceProjectId,
        promotion.relationshipId, promotion.sourceType, promotion.sourceId,
        JSON.stringify(promotion.sourceSnapshot), promotion.proposalId, promotion.createdAt
      );
      this.recordHistoryEvent({
        projectId,
        eventType: "context_promotion_requested",
        targetType: input.sourceType,
        targetId: String(proposal.id),
        summary: `Linked context promotion requested from ${String(sourceProject.name)}`,
        afterSnapshot: sourceSnapshot,
        sourceType: "context_promotion",
        sourceId: promotion.id,
        metadata: { proposalId: proposal.id },
        createdAt: timestamp
      });
      this.database.exec("COMMIT;");
      return { promotion, proposal, canonicalChanged: false };
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  assembleContext(projectId: string) {
    const state = this.getProjectState(projectId);
    const contextBridge = this.getContextBridge(projectId);
    const history = this.database
      .prepare(`
        SELECT target_type, target_id, committed_change, created_at
        FROM commit_events WHERE project_id = ?
        ORDER BY created_at DESC LIMIT 10
      `)
      .all(projectId);
    const workingExceptions = this.database
      .prepare(`
        SELECT id, target_type, content, reason, created_at
        FROM working_exceptions
        WHERE project_id = ? AND status = 'active'
        ORDER BY created_at DESC
      `)
      .all(projectId);

    return {
      assembledAt: nowIso(),
      authorityOrder: [
        "explicit_user_decision",
        "working_exception",
        "confirmed_external_state",
        "project_truth",
        "current_state",
        "active_checkpoint",
        "history",
        "exploration",
        "linked_project_reference"
      ],
      contextBoundary: {
        mode: contextBridge.mode,
        canonicalProjectId: contextBridge.canonicalProjectId,
        linkedProjectCount: contextBridge.linkedProjectCount,
        rules: contextBridge.rules
      },
      projectIndex: state.project,
      workingExceptions,
      projectTruth: state.truth,
      currentState: state.currentState,
      nextActions: state.nextActions,
      activeCheckpoint: state.checkpoint,
      recentHistory: history,
      exploration: state.exploration,
      pendingChanges: state.proposals,
      linkedProjectReferences: contextBridge.references
    };
  }

  buildContinuityBrief(projectId: string) {
    const state = this.getProjectState(projectId);
    const contextBridge = this.getContextBridge(projectId);
    const currentState = state.currentState as Row | null;
    const truth = state.truth as Row[];
    const nextActions = state.nextActions as Row[];
    const checkpoint = state.checkpoint;
    const workingExceptions = this.database
      .prepare(`
        SELECT id, target_type, content, reason, created_at
        FROM working_exceptions
        WHERE project_id = ? AND status = 'active'
        ORDER BY created_at DESC
      `)
      .all(projectId) as Row[];
    const warnings: Array<{ source: string; content: string; verificationStatus: string }> = [];

    for (const entry of truth) {
      if (entry.verification_status !== "confirmed") {
        warnings.push({
          source: "project_truth",
          content: String(entry.content),
          verificationStatus: String(entry.verification_status)
        });
      }
    }
    if (currentState && currentState.verification_status !== "confirmed") {
      warnings.push({
        source: "current_state",
        content: String(currentState.summary),
        verificationStatus: String(currentState.verification_status)
      });
    }
    for (const action of nextActions) {
      if (action.verification_status !== "confirmed") {
        warnings.push({
          source: "next_action",
          content: String(action.content),
          verificationStatus: String(action.verification_status)
        });
      }
    }
    for (const content of checkpoint?.unverifiedChanges ?? []) {
      warnings.push({
        source: "checkpoint",
        content,
        verificationStatus: "unverified"
      });
    }
    for (const exception of workingExceptions) {
      warnings.push({
        source: "working_exception",
        content: String(exception.content),
        verificationStatus: "unverified"
      });
    }

    const canonicalTruth = truth.map((entry) => ({
      category: String(entry.category),
      content: String(entry.content),
      verificationStatus: String(entry.verification_status),
      version: Number(entry.version)
    }));
    const activeActions = nextActions
      .filter((action) => action.status !== "completed")
      .map((action) => ({
        id: String(action.id),
        content: String(action.content),
        status: String(action.status),
        verificationStatus: String(action.verification_status)
      }));
    const cleanLine = (value: string) => value.replace(/\s+/g, " ").trim();
    const truthLines = canonicalTruth.length
      ? canonicalTruth.map(
          (entry) => `- [${entry.verificationStatus}] ${entry.category}: ${cleanLine(entry.content)}`
        )
      : ["- none"];
    const actionLines = activeActions.length
      ? activeActions.map(
          (action) => `- [${action.verificationStatus}/${action.status}] ${cleanLine(action.content)}`
        )
      : ["- none"];
    const warningLines = warnings.length
      ? warnings.map(
          (warning) =>
            `- [${warning.verificationStatus}] ${warning.source}: ${cleanLine(warning.content)}`
        )
      : ["- none"];
    const linkedProjectLines = contextBridge.references.length
      ? contextBridge.references.flatMap((reference) => [
          `- [reference only/${reference.relationship.direction}] ${reference.relationship.relationshipType}: ${cleanLine(String(reference.project.name))} (${String(reference.project.status)})`,
          reference.referenceState.currentState
            ? `  - Current state: ${cleanLine(reference.referenceState.currentState.summary)}`
            : "  - Current state: none",
          reference.referenceState.checkpoint
            ? `  - Resume signal: ${cleanLine(String(reference.referenceState.checkpoint.resumeInstruction))}`
            : "  - Resume signal: none"
        ])
      : ["- none"];
    const markdown = [
      `# ${state.project.name} — Continuity Brief`,
      "",
      `**Primary Goal:** ${cleanLine(String(state.project.primaryGoal))}`,
      `**Project Status:** ${String(state.project.status)}`,
      "",
      "## Project Truth",
      ...truthLines,
      "",
      "## Current State",
      currentState
        ? `- [${String(currentState.verification_status)}] ${cleanLine(String(currentState.summary))}`
        : "- none",
      "",
      "## Next Actions",
      ...actionLines,
      "",
      "## Recovery Checkpoint",
      checkpoint ? `- Stable state: ${cleanLine(String(checkpoint.stableState))}` : "- none",
      checkpoint ? `- Resume: ${cleanLine(String(checkpoint.resumeInstruction))}` : "",
      "",
      "## Requires Verification",
      ...warningLines,
      "",
      "## Linked Project References (Non-Canonical)",
      ...linkedProjectLines,
      "",
      "> Linked project references are navigation context only. They never merge into this project's Truth, Current State, or Next Actions.",
      "",
      `> Exploration ${state.exploration.length} item(s), pending changes ${state.proposals.length} item(s), temporary exceptions ${workingExceptions.length} item(s), and linked references ${contextBridge.linkedProjectCount} item(s) remain non-canonical.`
    ].join("\n");

    return {
      generatedAt: nowIso(),
      project: state.project,
      canonicalTruth,
      currentState: currentState
        ? {
            summary: String(currentState.summary),
            verificationStatus: String(currentState.verification_status)
          }
        : null,
      nextActions: activeActions,
      checkpoint,
      workingExceptions: workingExceptions.map((exception) => ({
        id: String(exception.id),
        targetType: String(exception.target_type),
        content: String(exception.content),
        reason: String(exception.reason),
        createdAt: String(exception.created_at)
      })),
      warnings,
      contextBoundary: {
        mode: contextBridge.mode,
        canonicalProjectId: contextBridge.canonicalProjectId,
        rules: contextBridge.rules
      },
      linkedProjectReferences: contextBridge.references,
      nonCanonical: {
        explorationCount: state.exploration.length,
        pendingProposalCount: state.proposals.length,
        temporaryExceptionCount: workingExceptions.length,
        linkedReferenceCount: contextBridge.linkedProjectCount
      },
      markdown
    };
  }

  recoverProject(projectId: string) {
    const context = this.assembleContext(projectId);
    return {
      context,
      bridge: {
        mode: context.contextBoundary.mode,
        linkedProjectCount: context.contextBoundary.linkedProjectCount,
        rule: "Linked projects are restored as reference-only context and never imported into canonical state."
      },
      recovery: context.activeCheckpoint
        ? {
            mode: "checkpoint_available",
            stableState: context.activeCheckpoint.stableState,
            unverifiedChanges: context.activeCheckpoint.unverifiedChanges,
            resumeInstruction: context.activeCheckpoint.resumeInstruction,
            rule: "Checkpoint는 정본을 자동 변경하지 않으며 유효성을 확인한 뒤 적용합니다."
          }
        : {
            mode: "canonical_only",
            rule: "활성 Checkpoint가 없어 정본과 Current State만으로 복구합니다."
          }
    };
  }

  private ensureDemoStructure(projectId: string) {
    const existingNodes = this.database
      .prepare("SELECT COUNT(*) AS count FROM project_nodes WHERE project_id = ?")
      .get(projectId) as Row;
    if (Number(existingNodes.count) > 0) return;

    const approve = (input: StructureProposalInput) => {
      const proposal = this.createStructureProposal(projectId, input);
      return this.approveStructureProposal(String(proposal.id));
    };

    approve({
      operation: "update_registry",
      payload: {
        projectLocation: "local://logos-continuity",
        currentFocus: "OpenAI Build Week 제출 완성도와 3분 데모 준비",
        relationships: ["OpenAI Build Week", "Work and Productivity"]
      },
      reason: "최종 설계의 Project Index 구조 반영"
    });
    const workstream = approve({
      operation: "create_workstream",
      payload: {
        name: "Product & Demo",
        description: "제품 완성도, 심사 시연, 제출 준비를 잇는 교차 작업 흐름",
        status: "active"
      },
      reason: "Build Week 완성을 위한 교차 Workstream"
    });
    const strategicGoal = approve({
      operation: "create_node",
      payload: {
        nodeType: "strategic_goal",
        title: "정본 기반 연속성의 가치를 증명한다",
        description: "새 세션에서도 검증된 상태와 중단 지점을 정확히 복구한다.",
        status: "active",
        verificationStatus: "confirmed",
        workstreamId: workstream.targetId
      },
      reason: "Primary Goal을 실행 가능한 전략 목표로 구체화"
    });
    const milestone = approve({
      operation: "create_node",
      payload: {
        nodeType: "milestone",
        parentId: strategicGoal.targetId,
        title: "3분 심사 데모를 완성한다",
        description: "복구, 승인, 충돌 해결, 구조 운영의 차이를 한 흐름으로 시연한다.",
        status: "active",
        verificationStatus: "confirmed",
        workstreamId: workstream.targetId
      },
      reason: "Build Week 제출 마일스톤"
    });
    approve({
      operation: "create_node",
      payload: {
        nodeType: "task",
        parentId: milestone.targetId,
        title: "새 세션 복구 흐름을 검증한다",
        status: "active",
        verificationStatus: "confirmed",
        workstreamId: workstream.targetId,
        sortOrder: 1
      },
      reason: "데모 핵심 흐름 검증"
    });
    approve({
      operation: "create_node",
      payload: {
        nodeType: "task",
        parentId: milestone.targetId,
        title: "3분 공개 데모를 녹화한다",
        status: "planned",
        verificationStatus: "confirmed",
        workstreamId: workstream.targetId,
        sortOrder: 2
      },
      reason: "Build Week 필수 제출물 준비"
    });
  }

  ensureDemoProject() {
    const existing = this.database
      .prepare("SELECT * FROM projects WHERE name = ? ORDER BY created_at DESC LIMIT 1")
      .get("Atlas 결제 모듈 베타 릴리스") as Row | undefined;
    if (existing) {
      this.ensureDemoStructure(String(existing.id));
      return this.getProject(String(existing.id));
    }

    const project = this.createProject({
      name: "Atlas 결제 모듈 베타 릴리스",
      summary: "팀이 승인된 릴리스 상태와 다음 작업을 새 세션에서도 정확히 복구하는 프로젝트",
      primaryGoal: "결제 모듈 베타 릴리스를 안전하게 완료한다.",
      recognitionSignals: ["Atlas", "결제 모듈", "베타 릴리스", "스테이징"]
    });
    const projectId = String(project.id);

    const truthInputs: ProposalInput[] = [
      {
        targetType: "truth",
        category: "product_goal",
        content: "Atlas Release Platform은 승인된 릴리스 계획과 운영 상태를 팀 간에 일관되게 유지한다.",
        verificationStatus: "confirmed",
        reason: "최종 설계 정본"
      },
      {
        targetType: "truth",
        category: "safety_rule",
        content: "전체 배포 전에는 스테이징 검증과 담당자 승인을 완료한다.",
        verificationStatus: "confirmed",
        reason: "구현 안전 원칙"
      }
    ];
    for (const input of truthInputs) {
      const proposal = this.createProposal(projectId, input);
      this.approveProposal(String(proposal.id));
    }

    const currentProposal = this.createProposal(projectId, {
      targetType: "current_state",
      content: "결제 모듈 베타 릴리스 후보를 스테이징에서 검증 중",
      verificationStatus: "confirmed",
      reason: "현재 구현 상태"
    });
    this.approveProposal(String(currentProposal.id));

    const actionProposal = this.createProposal(projectId, {
      targetType: "next_action",
      content: "실패한 결제 재시도 시나리오를 검증한다.",
      verificationStatus: "confirmed",
      itemStatus: "pending",
      reason: "현재 최우선 작업"
    });
    this.approveProposal(String(actionProposal.id));

    this.addExploration(projectId, "모바일 간편결제 지원 범위를 확대하는 것도 검토해보자.");
    this.saveCheckpoint(projectId, {
      stableState: "결제 API 통합과 롤백 절차가 검증된 상태",
      unverifiedChanges: ["모바일 결제 재시도율은 아직 검증되지 않음"],
      resumeInstruction: "스테이징 로그를 확인하고 재시도 시나리오를 검증한다."
    });
    this.ensureDemoStructure(projectId);
    return project;
  }

  resetDemoProject() {
    this.database
      .prepare("DELETE FROM projects WHERE name IN (?, ?)")
      .run("Atlas 결제 모듈 베타 릴리스", "LOGOS Continuity 해커톤 데모");
    return this.ensureDemoProject();
  }
}
