import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// db.js resolves its file from BOARD_DB at import time, so point it at a
// throwaway file before the (dynamic) import.
process.env.BOARD_DB = join(mkdtempSync(join(tmpdir(), 'loopboard-db-')), 'test.db');

const {
  db,
  STATUSES,
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
  addEvent,
  distinctProjects,
  claimNext,
  listProjectConfigs,
  getProjectConfig,
  upsertProjectConfig,
  deleteProjectConfig,
} = await import('../server/db.js');

beforeEach(() => {
  db.exec('DELETE FROM tasks');
  db.exec('DELETE FROM task_events');
  db.exec('DELETE FROM projects_config');
});

describe('tasks CRUD', () => {
  it('creates a task with defaults and a created event', () => {
    const t = createTask({ title: 'Hello', project: 'proj' });
    expect(t.id).toBeGreaterThan(0);
    expect(t.title).toBe('Hello');
    expect(t.project).toBe('proj');
    expect(t.status).toBe('backlog');
    expect(t.priority).toBe(2);
    const full = getTask(t.id, true);
    expect(full.events.map((e) => e.type)).toContain('created');
  });

  it('trims title/project and honors explicit status + priority', () => {
    const t = createTask({
      title: '  spaced  ',
      project: '  p  ',
      status: 'in_progress',
      priority: 1,
    });
    expect(t.title).toBe('spaced');
    expect(t.project).toBe('p');
    expect(t.status).toBe('in_progress');
    expect(t.priority).toBe(1);
  });

  it('falls back to backlog for an invalid status', () => {
    const t = createTask({ title: 'x', project: 'p', status: 'nope' });
    expect(t.status).toBe('backlog');
  });

  it('reads a task, returns null for a missing one', () => {
    const t = createTask({ title: 'x', project: 'p' });
    expect(getTask(t.id).id).toBe(t.id);
    expect(getTask(999999)).toBeNull();
  });

  it('updates only whitelisted fields and bumps updated_at', async () => {
    const t = createTask({ title: 'x', project: 'p' });
    await new Promise((r) => setTimeout(r, 5));
    const updated = updateTask(t.id, {
      title: 'y',
      status: 'done',
      bogus: 'ignored',
    });
    expect(updated.title).toBe('y');
    expect(updated.status).toBe('done');
    expect(updated).not.toHaveProperty('bogus');
    expect(updated.updated_at >= t.updated_at).toBe(true);
  });

  it('records an event when updating with one', () => {
    const t = createTask({ title: 'x', project: 'p' });
    updateTask(t.id, { status: 'done' }, { event: { type: 'status_change', body: 'a→b' } });
    const full = getTask(t.id, true);
    expect(full.events.some((e) => e.type === 'status_change')).toBe(true);
  });

  it('deletes a task and cascades its events', () => {
    const t = createTask({ title: 'x', project: 'p' });
    addEvent(t.id, { type: 'comment', body: 'hi' });
    expect(deleteTask(t.id)).toBe(true);
    expect(getTask(t.id)).toBeNull();
    const events = db.prepare('SELECT * FROM task_events WHERE task_id = ?').all(t.id);
    expect(events).toHaveLength(0);
  });

  it('returns false when deleting a missing task', () => {
    expect(deleteTask(424242)).toBe(false);
  });

  it('exposes the canonical status list', () => {
    expect(STATUSES).toEqual([
      'backlog',
      'in_progress',
      'pending_review',
      'ready_to_merge',
      'done',
      'archived',
    ]);
  });
});

describe('listTasks', () => {
  beforeEach(() => {
    createTask({ title: 'a', project: 'p1', priority: 2 });
    createTask({ title: 'b', project: 'p1', priority: 1 });
    createTask({ title: 'c', project: 'p2' });
    const arch = createTask({ title: 'd', project: 'p1' });
    updateTask(arch.id, { status: 'archived' });
  });

  it('filters by project', () => {
    const list = listTasks({ project: 'p1' });
    expect(list.every((t) => t.project === 'p1')).toBe(true);
  });

  it('hides archived tasks by default', () => {
    const list = listTasks({ project: 'p1' });
    expect(list.some((t) => t.status === 'archived')).toBe(false);
  });

  it('includes archived when asked', () => {
    const list = listTasks({ project: 'p1', includeArchived: true });
    expect(list.some((t) => t.status === 'archived')).toBe(true);
  });

  it('filters by status', () => {
    const list = listTasks({ status: 'backlog' });
    expect(list.every((t) => t.status === 'backlog')).toBe(true);
  });

  it('orders by priority ascending', () => {
    const list = listTasks({ project: 'p1', status: 'backlog' });
    const prios = list.map((t) => t.priority);
    expect(prios).toEqual([...prios].sort((a, b) => a - b));
  });
});

describe('events', () => {
  it('adds and retrieves events in order', () => {
    const t = createTask({ title: 'x', project: 'p' });
    addEvent(t.id, { type: 'comment', body: 'first', author: 'human' });
    addEvent(t.id, { type: 'comment', body: 'second', author: 'agent' });
    const { events } = getTask(t.id, true);
    const comments = events.filter((e) => e.type === 'comment');
    expect(comments.map((e) => e.body)).toEqual(['first', 'second']);
  });

  it('serializes object meta to JSON', () => {
    const t = createTask({ title: 'x', project: 'p' });
    addEvent(t.id, { type: 'claim', meta: { agent_tool: 'claude' } });
    const { events } = getTask(t.id, true);
    const claim = events.find((e) => e.type === 'claim');
    expect(JSON.parse(claim.meta)).toEqual({ agent_tool: 'claude' });
  });
});

describe('distinctProjects', () => {
  it('aggregates open counts per project, excluding archived', () => {
    createTask({ title: 'a', project: 'alpha' });
    createTask({ title: 'b', project: 'alpha', status: 'in_progress' });
    createTask({ title: 'c', project: 'beta', status: 'pending_review' });
    const arch = createTask({ title: 'd', project: 'beta' });
    updateTask(arch.id, { status: 'archived' });

    const rows = distinctProjects();
    const alpha = rows.find((r) => r.project === 'alpha');
    const beta = rows.find((r) => r.project === 'beta');
    expect(alpha.backlog).toBe(1);
    expect(alpha.in_progress).toBe(1);
    expect(beta.pending_review).toBe(1);
    expect(beta.total).toBe(1); // archived excluded
  });
});

describe('claimNext', () => {
  it('claims the highest-priority backlog task atomically', () => {
    createTask({ title: 'low', project: 'p', priority: 3 });
    const high = createTask({ title: 'high', project: 'p', priority: 1 });
    const claimed = claimNext('p', { agent_tool: 'claude' });
    expect(claimed.id).toBe(high.id);
    expect(claimed.status).toBe('in_progress');
    expect(claimed.agent_tool).toBe('claude');
    expect(claimed.claimed_at).toBeTruthy();
    expect(claimed.events.some((e) => e.type === 'claim')).toBe(true);
  });

  it('returns null when no backlog tasks remain', () => {
    expect(claimNext('empty-project')).toBeNull();
  });

  it('never double-claims the same task', () => {
    createTask({ title: 'only', project: 'p' });
    const first = claimNext('p');
    const second = claimNext('p');
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});

describe('projects config', () => {
  it('creates a config', () => {
    const row = upsertProjectConfig({ project: 'app', path: '/srv/app' });
    expect(row.project).toBe('app');
    expect(row.path).toBe('/srv/app');
    expect(row.created_at).toBeTruthy();
    expect(row.updated_at).toBeTruthy();
  });

  it('trims project and path', () => {
    const row = upsertProjectConfig({ project: '  app  ', path: '  /srv/app  ' });
    expect(row.project).toBe('app');
    expect(row.path).toBe('/srv/app');
  });

  it('upserts an existing config, preserving created_at', async () => {
    const first = upsertProjectConfig({ project: 'app', path: '/old' });
    await new Promise((r) => setTimeout(r, 5));
    const second = upsertProjectConfig({ project: 'app', path: '/new' });
    expect(second.path).toBe('/new');
    expect(second.created_at).toBe(first.created_at);
    expect(second.updated_at >= first.updated_at).toBe(true);
    expect(listProjectConfigs()).toHaveLength(1);
  });

  it('gets a config, returns null for a missing one', () => {
    upsertProjectConfig({ project: 'app', path: '/srv/app' });
    expect(getProjectConfig('app').path).toBe('/srv/app');
    expect(getProjectConfig('nope')).toBeNull();
  });

  it('lists all configs sorted by project', () => {
    upsertProjectConfig({ project: 'zeta', path: '/z' });
    upsertProjectConfig({ project: 'alpha', path: '/a' });
    expect(listProjectConfigs().map((c) => c.project)).toEqual(['alpha', 'zeta']);
  });

  it('deletes a config', () => {
    upsertProjectConfig({ project: 'app', path: '/srv/app' });
    expect(deleteProjectConfig('app')).toBe(true);
    expect(getProjectConfig('app')).toBeNull();
  });

  it('returns false when deleting a missing config', () => {
    expect(deleteProjectConfig('ghost')).toBe(false);
  });

  it('rejects an empty project or path', () => {
    expect(() => upsertProjectConfig({ project: '', path: '/x' })).toThrow();
    expect(() => upsertProjectConfig({ project: 'x', path: '' })).toThrow();
  });
});
