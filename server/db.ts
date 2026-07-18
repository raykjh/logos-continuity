import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(filePath: string): DatabaseSync {
  if (filePath !== ":memory:") {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const database = new DatabaseSync(filePath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      primary_goal TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'dormant', 'abandoned')),
      recognition_signals TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS truth_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      verification_status TEXT NOT NULL CHECK (verification_status IN ('confirmed', 'unverified', 'conflicted')),
      version INTEGER NOT NULL DEFAULT 1,
      committed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS current_state (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      verification_status TEXT NOT NULL CHECK (verification_status IN ('confirmed', 'unverified', 'conflicted')),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS next_actions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked')),
      verification_status TEXT NOT NULL CHECK (verification_status IN ('confirmed', 'unverified', 'conflicted')),
      priority INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      CHECK (status <> 'completed' OR verification_status = 'confirmed')
    );

    CREATE TABLE IF NOT EXISTS exploration_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'promoted', 'dismissed')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checkpoints (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      stable_state TEXT NOT NULL,
      unverified_changes TEXT NOT NULL DEFAULT '[]',
      resume_instruction TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS change_proposals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('truth', 'current_state', 'next_action')),
      target_id TEXT,
      category TEXT,
      proposed_content TEXT NOT NULL,
      proposed_verification TEXT NOT NULL CHECK (proposed_verification IN ('confirmed', 'unverified', 'conflicted')),
      proposed_item_status TEXT CHECK (proposed_item_status IN ('pending', 'in_progress', 'completed', 'blocked')),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS commit_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      proposal_id TEXT REFERENCES change_proposals(id),
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      committed_change TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conflict_resolutions (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL UNIQUE REFERENCES change_proposals(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      decision TEXT NOT NULL CHECK (decision IN ('keep_canonical', 'temporary_exception', 'apply_proposed')),
      canonical_snapshot TEXT NOT NULL,
      proposed_snapshot TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS working_exceptions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_proposal_id TEXT NOT NULL REFERENCES change_proposals(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('truth', 'current_state', 'next_action')),
      content TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
      created_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS exploration_promotions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      exploration_id TEXT NOT NULL REFERENCES exploration_entries(id) ON DELETE CASCADE,
      proposal_id TEXT NOT NULL UNIQUE REFERENCES change_proposals(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('truth', 'current_state', 'next_action')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'committed', 'cancelled')),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS context_promotions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      relationship_id TEXT NOT NULL REFERENCES project_relationships(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('truth', 'current_state', 'next_action')),
      source_id TEXT,
      source_snapshot TEXT NOT NULL,
      proposal_id TEXT NOT NULL UNIQUE REFERENCES change_proposals(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'committed', 'cancelled')),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS context_drift_acknowledgements (
      id TEXT PRIMARY KEY,
      context_promotion_id TEXT NOT NULL REFERENCES context_promotions(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      acknowledged_at TEXT NOT NULL,
      UNIQUE (context_promotion_id, fingerprint)
    );

    CREATE TABLE IF NOT EXISTS history_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      summary TEXT NOT NULL,
      before_snapshot TEXT,
      after_snapshot TEXT,
      source_type TEXT NOT NULL,
      source_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_registry_details (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      project_location TEXT NOT NULL DEFAULT 'local://logos-continuity',
      current_focus TEXT NOT NULL DEFAULT '',
      last_meaningful_update TEXT,
      relationships TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_relationships (
      id TEXT PRIMARY KEY,
      source_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      target_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL CHECK (relationship_type IN (
        'depends_on', 'supports', 'related_to', 'supersedes'
      )),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (source_project_id <> target_project_id),
      UNIQUE (source_project_id, target_project_id, relationship_type)
    );

    CREATE TABLE IF NOT EXISTS project_relationship_proposals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      operation TEXT NOT NULL CHECK (operation IN ('create', 'remove')),
      relationship_id TEXT,
      target_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      relationship_type TEXT CHECK (relationship_type IN (
        'depends_on', 'supports', 'related_to', 'supersedes'
      )),
      note TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS workstreams (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES project_nodes(id) ON DELETE CASCADE,
      workstream_id TEXT REFERENCES workstreams(id) ON DELETE SET NULL,
      node_type TEXT NOT NULL CHECK (node_type IN ('strategic_goal', 'milestone', 'task')),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'blocked')),
      verification_status TEXT NOT NULL CHECK (verification_status IN ('confirmed', 'unverified', 'conflicted')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS structure_proposals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      operation TEXT NOT NULL CHECK (operation IN (
        'update_registry', 'update_primary_goal',
        'create_workstream', 'update_workstream',
        'create_node', 'update_node'
      )),
      target_id TEXT,
      payload TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS lifecycle_proposals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      target_status TEXT NOT NULL CHECK (target_status IN ('active', 'paused', 'dormant', 'abandoned')),
      reason TEXT NOT NULL,
      resume_instruction TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS archive_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      previous_status TEXT NOT NULL CHECK (previous_status IN ('active', 'paused', 'dormant', 'abandoned')),
      archived_status TEXT NOT NULL CHECK (archived_status IN ('paused', 'dormant', 'abandoned')),
      manifest TEXT NOT NULL,
      reason TEXT NOT NULL,
      resume_instruction TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'archived' CHECK (status IN ('archived', 'restored')),
      archived_at TEXT NOT NULL,
      restored_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_truth_project ON truth_entries(project_id);
    CREATE INDEX IF NOT EXISTS idx_actions_project ON next_actions(project_id);
    CREATE INDEX IF NOT EXISTS idx_exploration_project ON exploration_entries(project_id);
    CREATE INDEX IF NOT EXISTS idx_proposals_project ON change_proposals(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_commits_project ON commit_events(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_resolutions_project ON conflict_resolutions(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_exceptions_project ON working_exceptions(project_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_promotions_project ON exploration_promotions(project_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_context_promotions_project ON context_promotions(project_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_context_drift_ack ON context_drift_acknowledgements(context_promotion_id, acknowledged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_events_project ON history_events(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_relationships_source ON project_relationships(source_project_id, relationship_type);
    CREATE INDEX IF NOT EXISTS idx_project_relationships_target ON project_relationships(target_project_id, relationship_type);
    CREATE INDEX IF NOT EXISTS idx_relationship_proposals_project ON project_relationship_proposals(project_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workstreams_project ON workstreams(project_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_nodes_project ON project_nodes(project_id, node_type, sort_order);
    CREATE INDEX IF NOT EXISTS idx_structure_proposals_project ON structure_proposals(project_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lifecycle_proposals_project ON lifecycle_proposals(project_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_archive_snapshots_project ON archive_snapshots(project_id, archived_at DESC);
  `);

  return database;
}
