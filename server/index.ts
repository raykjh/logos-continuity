import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db.ts";
import {
  classifyWithContinuity,
  getAiStatus,
  recognizeProjectWithContinuity
} from "./classifier.ts";
import { DomainError } from "./domain.ts";
import {
  ContinuityService,
  type ConflictDecision,
  type ContextPromotionInput,
  type LifecycleProposalInput,
  type RelationshipOperation,
  type RelationshipType,
  type StructureOperation
} from "./service.ts";

const rootDirectory = fileURLToPath(new URL("..", import.meta.url));
const databasePath = process.env.LOGOS_DB_PATH ?? join(rootDirectory, "data", "logos.db");
const judgePackagePath = join(rootDirectory, "artifacts", "LOGOS-Continuity-Judge.zip");
const portableBuildMarkerPath = join(rootDirectory, "portable-build.json");
const port = Number(process.env.PORT ?? 4318);
const host = process.env.HOST ?? "127.0.0.1";
const service = new ContinuityService(openDatabase(databasePath));
service.ensureDemoProject();

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new DomainError("요청 JSON을 해석할 수 없습니다.");
  }
}

function getMatch(pathname: string, pattern: RegExp): RegExpMatchArray | null {
  return pathname.match(pattern);
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const method = request.method ?? "GET";
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "logos-continuity" });
    return;
  }

  if (method === "GET" && pathname === "/api/ai/status") {
    sendJson(response, 200, getAiStatus());
    return;
  }

  if (method === "POST" && pathname === "/api/demo/reset") {
    sendJson(response, 200, service.resetDemoProject());
    return;
  }

  if (method === "GET" && pathname === "/api/projects") {
    sendJson(response, 200, service.listProjects());
    return;
  }

  if (method === "GET" && pathname === "/api/project-index") {
    sendJson(response, 200, service.getProjectIndex());
    return;
  }

  if (method === "GET" && pathname === "/api/command-center") {
    sendJson(response, 200, service.getContinuityCommandCenter());
    return;
  }

  if (method === "GET" && pathname === "/api/submission-evidence") {
    const packageDownloadable = existsSync(judgePackagePath);
    sendJson(response, 200, service.getSubmissionEvidence(
      getAiStatus(),
      packageDownloadable || existsSync(portableBuildMarkerPath),
      packageDownloadable,
      process.env.REPOSITORY_URL ?? ""
    ));
    return;
  }

  if (method === "GET" && pathname === "/api/submission-evidence/judge-package") {
    if (!existsSync(judgePackagePath)) {
      throw new DomainError("Portable Judge Build가 아직 생성되지 않았습니다. pnpm package:judge를 실행하세요.", 404);
    }
    response.writeHead(200, {
      "content-type": "application/zip",
      "content-length": statSync(judgePackagePath).size,
      "content-disposition": 'attachment; filename="LOGOS-Continuity-Judge.zip"',
      "cache-control": "no-store"
    });
    createReadStream(judgePackagePath).pipe(response);
    return;
  }

  if (method === "POST" && pathname === "/api/sessions/recognize") {
    const body = await readJson(request);
    const query = String(body.query ?? "").trim();
    if (!query) throw new DomainError("새 세션에서 이어갈 작업을 입력하세요.");
    const projects = service.listProjects().map((project) => ({
      id: String(project.id),
      name: String(project.name),
      summary: String(project.summary),
      primaryGoal: String(project.primaryGoal),
      recognitionSignals: project.recognitionSignals
    }));
    sendJson(response, 200, await recognizeProjectWithContinuity(query, projects));
    return;
  }

  if (method === "POST" && pathname === "/api/projects") {
    const body = await readJson(request);
    const project = service.createProject({
      name: String(body.name ?? ""),
      summary: String(body.summary ?? ""),
      primaryGoal: String(body.primaryGoal ?? ""),
      recognitionSignals: Array.isArray(body.recognitionSignals)
        ? body.recognitionSignals.map(String)
        : []
    });
    sendJson(response, 201, project);
    return;
  }

  const stateMatch = getMatch(pathname, /^\/api\/projects\/([^/]+)\/state$/);
  if (method === "GET" && stateMatch) {
    sendJson(response, 200, service.getProjectState(decodeURIComponent(stateMatch[1])));
    return;
  }

  const contextMatch = getMatch(pathname, /^\/api\/projects\/([^/]+)\/context$/);
  if (method === "GET" && contextMatch) {
    sendJson(response, 200, service.assembleContext(decodeURIComponent(contextMatch[1])));
    return;
  }

  const contextBridgeMatch = getMatch(pathname, /^\/api\/projects\/([^/]+)\/context-bridge$/);
  if (method === "GET" && contextBridgeMatch) {
    sendJson(response, 200, service.getContextBridge(decodeURIComponent(contextBridgeMatch[1])));
    return;
  }

  const contextPromotionsMatch = getMatch(
    pathname,
    /^\/api\/projects\/([^/]+)\/context-promotions$/
  );
  if (method === "GET" && contextPromotionsMatch) {
    sendJson(response, 200, service.getContextPromotionCenter(
      decodeURIComponent(contextPromotionsMatch[1])
    ));
    return;
  }
  if (method === "POST" && contextPromotionsMatch) {
    const body = await readJson(request);
    sendJson(response, 201, service.createContextPromotion(
      decodeURIComponent(contextPromotionsMatch[1]),
      {
        relationshipId: String(body.relationshipId ?? ""),
        sourceProjectId: String(body.sourceProjectId ?? ""),
        sourceType: String(body.sourceType ?? "") as ContextPromotionInput["sourceType"],
        sourceId: body.sourceId ? String(body.sourceId) : undefined,
        reason: String(body.reason ?? "")
      }
    ));
    return;
  }

  const provenanceDriftMatch = getMatch(
    pathname,
    /^\/api\/projects\/([^/]+)\/provenance-drift$/
  );
  if (method === "GET" && provenanceDriftMatch) {
    sendJson(response, 200, service.getProvenanceDriftCenter(
      decodeURIComponent(provenanceDriftMatch[1])
    ));
    return;
  }

  const acknowledgeDriftMatch = getMatch(
    pathname,
    /^\/api\/projects\/([^/]+)\/provenance-drift\/([^/]+)\/acknowledge$/
  );
  if (method === "POST" && acknowledgeDriftMatch) {
    const body = await readJson(request);
    sendJson(response, 200, service.acknowledgeProvenanceDrift(
      decodeURIComponent(acknowledgeDriftMatch[1]),
      decodeURIComponent(acknowledgeDriftMatch[2]),
      String(body.note ?? "")
    ));
    return;
  }

  const conflictsMatch = getMatch(pathname, /^\/api\/projects\/([^/]+)\/conflicts$/);
  if (method === "GET" && conflictsMatch) {
    sendJson(response, 200, service.getConflictCenter(decodeURIComponent(conflictsMatch[1])));
    return;
  }

  const historyMatch = getMatch(pathname, /^\/api\/projects\/([^/]+)\/history$/);
  if (method === "GET" && historyMatch) {
    sendJson(response, 200, service.getHistoryCenter(decodeURIComponent(historyMatch[1])));
    return;
  }

  const structureMatch = getMatch(pathname, /^\/api\/projects\/([^/]+)\/structure$/);
  if (method === "GET" && structureMatch) {
    sendJson(response, 200, service.getProjectStructure(decodeURIComponent(structureMatch[1])));
    return;
  }

  const archiveMatch = getMatch(pathname, /^\/api\/projects\/([^/]+)\/archive$/);
  if (method === "GET" && archiveMatch) {
    sendJson(response, 200, service.getArchiveCenter(decodeURIComponent(archiveMatch[1])));
    return;
  }

  const lifecycleProposalMatch = getMatch(
    pathname,
    /^\/api\/projects\/([^/]+)\/lifecycle\/proposals$/
  );
  if (method === "POST" && lifecycleProposalMatch) {
    const body = await readJson(request);
    sendJson(response, 201, service.createLifecycleProposal(
      decodeURIComponent(lifecycleProposalMatch[1]),
      {
        targetStatus: String(body.targetStatus ?? "") as LifecycleProposalInput["targetStatus"],
        reason: String(body.reason ?? ""),
        resumeInstruction: String(body.resumeInstruction ?? "")
      }
    ));
    return;
  }

  const relationshipProposalMatch = getMatch(
    pathname,
    /^\/api\/projects\/([^/]+)\/relationship-proposals$/
  );
  if (method === "POST" && relationshipProposalMatch) {
    const body = await readJson(request);
    sendJson(response, 201, service.createRelationshipProposal(
      decodeURIComponent(relationshipProposalMatch[1]),
      {
        operation: String(body.operation ?? "") as RelationshipOperation,
        relationshipId: body.relationshipId ? String(body.relationshipId) : undefined,
        targetProjectId: body.targetProjectId ? String(body.targetProjectId) : undefined,
        relationshipType: body.relationshipType
          ? String(body.relationshipType) as RelationshipType
          : undefined,
        note: String(body.note ?? ""),
        reason: String(body.reason ?? "")
      }
    ));
    return;
  }

  const structureProposalMatch = getMatch(
    pathname,
    /^\/api\/projects\/([^/]+)\/structure\/proposals$/
  );
  if (method === "POST" && structureProposalMatch) {
    const body = await readJson(request);
    sendJson(
      response,
      201,
      service.createStructureProposal(decodeURIComponent(structureProposalMatch[1]), {
        operation: String(body.operation ?? "") as StructureOperation,
        targetId: body.targetId ? String(body.targetId) : undefined,
        payload:
          body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
            ? body.payload as Record<string, unknown>
            : {},
        reason: String(body.reason ?? "")
      })
    );
    return;
  }

  const historyRevertMatch = getMatch(
    pathname,
    /^\/api\/projects\/([^/]+)\/history\/([^/]+)\/revert$/
  );
  if (method === "POST" && historyRevertMatch) {
    sendJson(
      response,
      201,
      service.createHistoryRevertProposal(
        decodeURIComponent(historyRevertMatch[1]),
        decodeURIComponent(historyRevertMatch[2])
      )
    );
    return;
  }

  const briefMatch = getMatch(pathname, /^\/api\/projects\/([^/]+)\/brief$/);
  if (method === "GET" && briefMatch) {
    sendJson(response, 200, service.buildContinuityBrief(decodeURIComponent(briefMatch[1])));
    return;
  }

  const recoveryMatch = getMatch(pathname, /^\/api\/projects\/([^/]+)\/recover$/);
  if (method === "POST" && recoveryMatch) {
    sendJson(response, 200, service.recoverProject(decodeURIComponent(recoveryMatch[1])));
    return;
  }

  const intakeMatch = getMatch(pathname, /^\/api\/projects\/([^/]+)\/intake$/);
  if (method === "POST" && intakeMatch) {
    const projectId = decodeURIComponent(intakeMatch[1]);
    const body = await readJson(request);
    const text = String(body.text ?? "").trim();
    if (!text) throw new DomainError("분류할 발언을 입력하세요.");
    const state = service.getProjectState(projectId);
    const classification = await classifyWithContinuity(text, {
      projectName: String(state.project.name),
      primaryGoal: String(state.project.primaryGoal),
      truth: state.truth.map((entry) => ({
        category: String(entry.category),
        content: String(entry.content),
        verificationStatus: String(entry.verification_status)
      })),
      currentState: state.currentState ? String(state.currentState.summary) : null,
      nextActions: state.nextActions.map((entry) => ({
        content: String(entry.content),
        status: String(entry.status),
        verificationStatus: String(entry.verification_status)
      }))
    });

    let outcome: { type: string; item?: unknown } = { type: "none" };
    if (classification.target === "exploration") {
      outcome = { type: "exploration_saved", item: service.addExploration(projectId, text) };
    }
    if (classification.target === "truth_candidate") {
      outcome = {
        type: "proposal_created",
        item: service.createProposal(projectId, {
          targetType: "truth",
          category: classification.category,
          content: text,
          verificationStatus: classification.verificationStatus,
          reason: `${classification.model}: ${classification.rationale}`
        })
      };
    }
    if (classification.target === "current_state") {
      outcome = {
        type: "proposal_created",
        item: service.createProposal(projectId, {
          targetType: "current_state",
          content: text,
          verificationStatus: classification.verificationStatus,
          reason: `${classification.model}: ${classification.rationale}`
        })
      };
    }
    if (classification.target === "next_action") {
      outcome = {
        type: "proposal_created",
        item: service.createProposal(projectId, {
          targetType: "next_action",
          content: text,
          verificationStatus: classification.verificationStatus,
          itemStatus: classification.actionStatus ?? "pending",
          reason: `${classification.model}: ${classification.rationale}`
        })
      };
    }

    sendJson(response, 200, { classification, outcome });
    return;
  }

  const explorationMatch = getMatch(pathname, /^\/api\/projects\/([^/]+)\/exploration$/);
  if (method === "POST" && explorationMatch) {
    const body = await readJson(request);
    sendJson(
      response,
      201,
      service.addExploration(decodeURIComponent(explorationMatch[1]), String(body.content ?? ""))
    );
    return;
  }

  const promoteExplorationMatch = getMatch(
    pathname,
    /^\/api\/projects\/([^/]+)\/exploration\/([^/]+)\/promote$/
  );
  if (method === "POST" && promoteExplorationMatch) {
    const body = await readJson(request);
    sendJson(
      response,
      201,
      service.promoteExploration(
        decodeURIComponent(promoteExplorationMatch[1]),
        decodeURIComponent(promoteExplorationMatch[2]),
        String(body.targetType ?? "truth") as "truth" | "current_state" | "next_action",
        body.category ? String(body.category) : undefined
      )
    );
    return;
  }

  const dismissExplorationMatch = getMatch(
    pathname,
    /^\/api\/projects\/([^/]+)\/exploration\/([^/]+)\/dismiss$/
  );
  if (method === "POST" && dismissExplorationMatch) {
    sendJson(
      response,
      200,
      service.dismissExploration(
        decodeURIComponent(dismissExplorationMatch[1]),
        decodeURIComponent(dismissExplorationMatch[2])
      )
    );
    return;
  }

  const proposalMatch = getMatch(pathname, /^\/api\/projects\/([^/]+)\/proposals$/);
  if (method === "POST" && proposalMatch) {
    const body = await readJson(request);
    sendJson(
      response,
      201,
      service.createProposal(decodeURIComponent(proposalMatch[1]), {
        targetType: String(body.targetType ?? "truth") as "truth" | "current_state" | "next_action",
        targetId: body.targetId ? String(body.targetId) : undefined,
        category: body.category ? String(body.category) : undefined,
        content: String(body.content ?? ""),
        verificationStatus: String(body.verificationStatus ?? "unverified") as
          | "confirmed"
          | "unverified"
          | "conflicted",
        itemStatus: body.itemStatus
          ? (String(body.itemStatus) as "pending" | "in_progress" | "completed" | "blocked")
          : undefined,
        reason: String(body.reason ?? "")
      })
    );
    return;
  }

  const checkpointMatch = getMatch(pathname, /^\/api\/projects\/([^/]+)\/checkpoint$/);
  if (method === "POST" && checkpointMatch) {
    const body = await readJson(request);
    sendJson(
      response,
      200,
      service.saveCheckpoint(decodeURIComponent(checkpointMatch[1]), {
        stableState: String(body.stableState ?? ""),
        unverifiedChanges: Array.isArray(body.unverifiedChanges)
          ? body.unverifiedChanges.map(String)
          : [],
        resumeInstruction: String(body.resumeInstruction ?? "")
      })
    );
    return;
  }

  const clearCheckpointMatch = getMatch(
    pathname,
    /^\/api\/projects\/([^/]+)\/checkpoint\/clear$/
  );
  if (method === "POST" && clearCheckpointMatch) {
    sendJson(
      response,
      200,
      service.clearCheckpoint(decodeURIComponent(clearCheckpointMatch[1]))
    );
    return;
  }

  const approveMatch = getMatch(pathname, /^\/api\/proposals\/([^/]+)\/approve$/);
  if (method === "POST" && approveMatch) {
    sendJson(response, 200, service.approveProposal(decodeURIComponent(approveMatch[1])));
    return;
  }

  const rejectMatch = getMatch(pathname, /^\/api\/proposals\/([^/]+)\/reject$/);
  if (method === "POST" && rejectMatch) {
    sendJson(response, 200, service.rejectProposal(decodeURIComponent(rejectMatch[1])));
    return;
  }

  const approveStructureMatch = getMatch(
    pathname,
    /^\/api\/structure-proposals\/([^/]+)\/approve$/
  );
  if (method === "POST" && approveStructureMatch) {
    sendJson(
      response,
      200,
      service.approveStructureProposal(decodeURIComponent(approveStructureMatch[1]))
    );
    return;
  }

  const rejectStructureMatch = getMatch(
    pathname,
    /^\/api\/structure-proposals\/([^/]+)\/reject$/
  );
  if (method === "POST" && rejectStructureMatch) {
    sendJson(
      response,
      200,
      service.rejectStructureProposal(decodeURIComponent(rejectStructureMatch[1]))
    );
    return;
  }

  const approveLifecycleMatch = getMatch(
    pathname,
    /^\/api\/lifecycle-proposals\/([^/]+)\/approve$/
  );
  if (method === "POST" && approveLifecycleMatch) {
    sendJson(response, 200, service.approveLifecycleProposal(decodeURIComponent(approveLifecycleMatch[1])));
    return;
  }

  const approveRelationshipMatch = getMatch(
    pathname,
    /^\/api\/relationship-proposals\/([^/]+)\/approve$/
  );
  if (method === "POST" && approveRelationshipMatch) {
    sendJson(response, 200, service.approveRelationshipProposal(
      decodeURIComponent(approveRelationshipMatch[1])
    ));
    return;
  }

  const rejectRelationshipMatch = getMatch(
    pathname,
    /^\/api\/relationship-proposals\/([^/]+)\/reject$/
  );
  if (method === "POST" && rejectRelationshipMatch) {
    sendJson(response, 200, service.rejectRelationshipProposal(
      decodeURIComponent(rejectRelationshipMatch[1])
    ));
    return;
  }

  const rejectLifecycleMatch = getMatch(
    pathname,
    /^\/api\/lifecycle-proposals\/([^/]+)\/reject$/
  );
  if (method === "POST" && rejectLifecycleMatch) {
    sendJson(response, 200, service.rejectLifecycleProposal(decodeURIComponent(rejectLifecycleMatch[1])));
    return;
  }

  const resolveConflictMatch = getMatch(pathname, /^\/api\/conflicts\/([^/]+)\/resolve$/);
  if (method === "POST" && resolveConflictMatch) {
    const body = await readJson(request);
    sendJson(
      response,
      200,
      service.resolveConflict(
        decodeURIComponent(resolveConflictMatch[1]),
        String(body.decision ?? "") as ConflictDecision,
        String(body.note ?? "")
      )
    );
    return;
  }

  const closeExceptionMatch = getMatch(pathname, /^\/api\/exceptions\/([^/]+)\/close$/);
  if (method === "POST" && closeExceptionMatch) {
    sendJson(
      response,
      200,
      service.closeWorkingException(decodeURIComponent(closeExceptionMatch[1]))
    );
    return;
  }

  throw new DomainError("API 경로를 찾을 수 없습니다.", 404);
}

function serveStatic(response: ServerResponse, pathname: string): void {
  const distDirectory = join(rootDirectory, "dist");
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const resolved = normalize(join(distDirectory, requested));
  const safePath = resolved.startsWith(distDirectory) ? resolved : join(distDirectory, "index.html");
  const filePath = existsSync(safePath) && statSync(safePath).isFile()
    ? safePath
    : join(distDirectory, "index.html");

  if (!existsSync(filePath)) {
    sendJson(response, 404, { error: "UI 빌드가 없습니다. pnpm dev를 실행하세요." });
    return;
  }

  response.writeHead(200, {
    "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else {
      serveStatic(response, url.pathname);
    }
  } catch (error) {
    const status = error instanceof DomainError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    sendJson(response, status, { error: message });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`LOGOS API: http://${host}:${port}\n`);
});

function shutdown(): void {
  server.close(() => {
    service.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
