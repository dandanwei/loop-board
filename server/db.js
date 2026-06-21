import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_PATH =
  process.env.BOARD_DB || join(__dirname, '..', 'data', 'board.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const STATUSES = [
  'backlog',
  'in_progress',
  'pending_review',
  'ready_to_merge',
  'done',
  'archived',
];

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    title              TEXT NOT NULL,
    project            TEXT NOT NULL,
    description        TEXT NOT NULL DEFAULT '',
    definition_of_done TEXT NOT NULL DEFAULT '',
    status             TEXT NOT NULL DEFAULT 'backlog',
    priority           INTEGER NOT NULL DEFAULT 2,
    answer             TEXT NOT NULL DEFAULT '',
    branch             TEXT NOT NULL DEFAULT '',
    session_title      TEXT NOT NULL DEFAULT '',
    session_id         TEXT NOT NULL DEFAULT '',
    agent_tool         TEXT NOT NULL DEFAULT '',
    time_cap_minutes   INTEGER,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    claimed_at         TEXT,
    completed_at       TEXT
  );

  CREATE TABLE IF NOT EXISTS task_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL,
    type       TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    meta       TEXT NOT NULL DEFAULT '',
    author     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS projects_config (
    project    TEXT NOT NULL PRIMARY KEY,
    path       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT NOT NULL PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks (project);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
  CREATE INDEX IF NOT EXISTS idx_events_task ON task_events (task_id);
`);

// Lightweight migrations for databases created before a column existed —
// CREATE TABLE IF NOT EXISTS never alters an existing table. Idempotent: each
// ALTER only runs when the column is missing.
function ensureColumn(table, column, ddl) {
  const exists = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('tasks', 'time_cap_minutes', 'time_cap_minutes INTEGER');

export const now = () => new Date().toISOString();

// A per-task execution cap is an optional positive whole number of minutes.
// Anything missing/blank/non-positive becomes NULL, which means "fall back to
// the board-wide default_time_cap_minutes setting". Used on create and update.
export function normalizeCap(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

const UPDATABLE = new Set([
  'title',
  'project',
  'description',
  'definition_of_done',
  'status',
  'priority',
  'answer',
  'branch',
  'session_title',
  'session_id',
  'agent_tool',
  'time_cap_minutes',
  'claimed_at',
  'completed_at',
]);

// ---- queries ----------------------------------------------------------------

const stmtInsertTask = db.prepare(`
  INSERT INTO tasks (title, project, description, definition_of_done, status, priority, time_cap_minutes, created_at, updated_at)
  VALUES (@title, @project, @description, @definition_of_done, @status, @priority, @time_cap_minutes, @created_at, @updated_at)
`);

const stmtGetTask = db.prepare(`SELECT * FROM tasks WHERE id = ?`);

const stmtInsertEvent = db.prepare(`
  INSERT INTO task_events (task_id, type, body, meta, author, created_at)
  VALUES (@task_id, @type, @body, @meta, @author, @created_at)
`);

const stmtGetEvents = db.prepare(
  `SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC, id ASC`
);

export function addEvent(taskId, { type, body = '', meta = '', author = '' }) {
  stmtInsertEvent.run({
    task_id: taskId,
    type,
    body,
    meta: typeof meta === 'string' ? meta : JSON.stringify(meta),
    author,
    created_at: now(),
  });
}

export function getTask(id, withEvents = false) {
  const task = stmtGetTask.get(id);
  if (!task) return null;
  if (withEvents) task.events = stmtGetEvents.all(id);
  return task;
}

export function listTasks({ project, status, includeArchived } = {}) {
  const where = [];
  const params = {};
  if (project) {
    where.push('project = @project');
    params.project = project;
  }
  if (status) {
    where.push('status = @status');
    params.status = status;
  } else if (!includeArchived) {
    where.push(`status != 'archived'`);
  }
  const sql = `
    SELECT * FROM tasks
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY priority ASC, datetime(updated_at) DESC
  `;
  return db.prepare(sql).all(params);
}

export function distinctProjects() {
  return db
    .prepare(
      `SELECT project,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'backlog' THEN 1 ELSE 0 END) AS backlog,
              SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
              SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) AS pending_review
       FROM tasks
       WHERE status != 'archived'
       GROUP BY project
       ORDER BY project ASC`
    )
    .all();
}

// Project labels the UI pickers should offer: every project that has a
// (non-archived) task, PLUS every project that has a configured repo mapping
// even if it has no open tasks yet — e.g. a project freshly added in the
// Configuration dialog, or one whose only tasks are archived. Configured-only
// projects come back with zero counts so the label still appears in the
// "All projects" filter and the new-task dropdown.
export function selectableProjects() {
  const rows = distinctProjects();
  const seen = new Set(rows.map((r) => r.project));
  for (const cfg of listProjectConfigs()) {
    if (seen.has(cfg.project)) continue;
    rows.push({
      project: cfg.project,
      total: 0,
      backlog: 0,
      in_progress: 0,
      pending_review: 0,
    });
    seen.add(cfg.project);
  }
  rows.sort((a, b) => a.project.localeCompare(b.project));
  return rows;
}

export function createTask(input) {
  const ts = now();
  const row = {
    title: String(input.title || '').trim(),
    project: String(input.project || '').trim(),
    description: input.description || '',
    definition_of_done: input.definition_of_done || '',
    status: STATUSES.includes(input.status) ? input.status : 'backlog',
    priority: Number.isInteger(input.priority) ? input.priority : 2,
    time_cap_minutes: normalizeCap(input.time_cap_minutes),
    created_at: ts,
    updated_at: ts,
  };
  const info = stmtInsertTask.run(row);
  addEvent(info.lastInsertRowid, {
    type: 'created',
    author: input.author || 'human',
  });
  return getTask(info.lastInsertRowid);
}

export function updateTask(id, patch, { event } = {}) {
  // Sanitize the cap the same way create does, so a blank/0/garbage value
  // resets to NULL ("use the board default") rather than being stored verbatim.
  if ('time_cap_minutes' in patch) {
    patch = { ...patch, time_cap_minutes: normalizeCap(patch.time_cap_minutes) };
  }
  const fields = Object.keys(patch).filter((k) => UPDATABLE.has(k));
  if (fields.length) {
    const set = fields.map((f) => `${f} = @${f}`).join(', ');
    const params = { id, updated_at: now() };
    for (const f of fields) params[f] = patch[f];
    db.prepare(`UPDATE tasks SET ${set}, updated_at = @updated_at WHERE id = @id`).run(
      params
    );
  }
  if (event) addEvent(id, event);
  return getTask(id, true);
}

export function deleteTask(id) {
  return db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id).changes > 0;
}

// Atomically grab the highest-priority backlog task for a project and flip it
// to in_progress, so two agents racing for the same project can't double-claim.
export const claimNext = db.transaction((project, meta = {}) => {
  const row = db
    .prepare(
      `SELECT id FROM tasks
       WHERE project = ? AND status = 'backlog'
       ORDER BY priority ASC, datetime(created_at) ASC
       LIMIT 1`
    )
    .get(project);
  if (!row) return null;
  const ts = now();
  db.prepare(
    `UPDATE tasks
       SET status = 'in_progress', claimed_at = ?, updated_at = ?, agent_tool = ?
     WHERE id = ?`
  ).run(ts, ts, meta.agent_tool || '', row.id);
  addEvent(row.id, {
    type: 'claim',
    author: meta.agent_tool || 'agent',
    meta,
  });
  return getTask(row.id, true);
});

// ---- projects config --------------------------------------------------------
// Maps a project label to an absolute filesystem path, so the orchestrator can
// cd into the right repo before dispatching a task to a sub-session.

const stmtGetProjectConfig = db.prepare(
  `SELECT * FROM projects_config WHERE project = ?`
);

const stmtUpsertProjectConfig = db.prepare(`
  INSERT INTO projects_config (project, path, created_at, updated_at)
  VALUES (@project, @path, @created_at, @updated_at)
  ON CONFLICT(project) DO UPDATE SET
    path = excluded.path,
    updated_at = excluded.updated_at
`);

export function listProjectConfigs() {
  return db
    .prepare(`SELECT * FROM projects_config ORDER BY project ASC`)
    .all();
}

export function getProjectConfig(project) {
  return stmtGetProjectConfig.get(project) || null;
}

export function upsertProjectConfig({ project, path }) {
  const label = String(project || '').trim();
  const p = String(path || '').trim();
  if (!label) throw new Error('project is required');
  if (!p) throw new Error('path is required');
  const existing = getProjectConfig(label);
  const ts = now();
  stmtUpsertProjectConfig.run({
    project: label,
    path: p,
    created_at: existing ? existing.created_at : ts,
    updated_at: ts,
  });
  return getProjectConfig(label);
}

export function deleteProjectConfig(project) {
  return (
    db.prepare(`DELETE FROM projects_config WHERE project = ?`).run(project)
      .changes > 0
  );
}

// ---- settings ---------------------------------------------------------------
// A tiny key/value store for board-wide preferences. Values are kept as text
// and coerced on the way out so the table stays generic. Currently holds the
// "stale" threshold: how many minutes a task may sit in_progress before the
// board flags it as running long.

export const SETTINGS_DEFAULTS = {
  // Tasks in_progress longer than this many minutes are highlighted as stale.
  stale_threshold_minutes: 30,
  // Default hard cap (minutes of wall-clock) the orchestrator allows a single
  // task to run before timing it out. A task may override this with its own
  // time_cap_minutes; this is the fallback when it doesn't.
  default_time_cap_minutes: 30,
};

const stmtGetSetting = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const stmtUpsertSetting = db.prepare(`
  INSERT INTO settings (key, value, updated_at)
  VALUES (@key, @value, @updated_at)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at
`);

// Coerce a stored (string) setting back to the type of its default.
function coerceSetting(key, raw) {
  const def = SETTINGS_DEFAULTS[key];
  if (raw == null) return def;
  if (typeof def === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : def;
  }
  return raw;
}

export function getSettings() {
  const out = { ...SETTINGS_DEFAULTS };
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    const row = stmtGetSetting.get(key);
    if (row) out[key] = coerceSetting(key, row.value);
  }
  return out;
}

// Apply a partial patch of known settings, validating values. Throws on a bad
// value so the API can return a 400. Returns the full, coerced settings object.
export function updateSettings(patch = {}) {
  const ts = now();
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in SETTINGS_DEFAULTS)) continue; // ignore unknown keys
    if (key === 'stale_threshold_minutes' || key === 'default_time_cap_minutes') {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`${key} must be a positive number`);
      }
    }
    stmtUpsertSetting.run({ key, value: String(value), updated_at: ts });
  }
  return getSettings();
}
