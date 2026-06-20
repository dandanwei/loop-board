import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Real server, real HTTP. Throwaway DB; let the OS pick a free port so parallel
// runs never collide.
process.env.BOARD_DB = join(mkdtempSync(join(tmpdir(), 'loopboard-e2e-')), 'test.db');
process.env.BOARD_NO_LISTEN = '1';

const { app } = await import('../server/index.js');
const { db } = await import('../server/db.js');

let server;
let base;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

beforeEach(() => {
  db.exec('DELETE FROM tasks');
  db.exec('DELETE FROM task_events');
  db.exec('DELETE FROM projects_config');
});

async function req(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

describe('full task lifecycle', () => {
  it('create → claim → answer → done, with a full event trail', async () => {
    const created = await req('POST', '/api/tasks', {
      title: 'Lifecycle',
      project: 'life',
      definition_of_done: 'works',
    });
    expect(created.status).toBe(201);
    const id = created.data.id;

    const claim = await req('POST', '/api/projects/life/claim', { agent_tool: 'claude' });
    expect(claim.data.id).toBe(id);
    expect(claim.data.status).toBe('in_progress');

    const answered = await req('POST', `/api/tasks/${id}/answer`, {
      answer: 'all good',
      branch: 'task/1-life',
      session_id: 'sess-1',
      session_title: 'do lifecycle',
    });
    expect(answered.data.status).toBe('pending_review');

    const done = await req('POST', `/api/tasks/${id}/status`, { status: 'done' });
    expect(done.data.status).toBe('done');
    expect(done.data.completed_at).toBeTruthy();

    const full = await req('GET', `/api/tasks/${id}`);
    const types = full.data.events.map((e) => e.type);
    expect(types).toContain('created');
    expect(types).toContain('claim');
    expect(types).toContain('answer');
    expect(types).toContain('status_change');
  });
});

describe('projects config lifecycle', () => {
  it('create → list → upsert → delete', async () => {
    const create = await req('POST', '/api/projects-config', {
      project: 'app',
      path: '/srv/app',
    });
    expect(create.status).toBe(201);

    const list = await req('GET', '/api/projects-config');
    expect(list.data).toHaveLength(1);

    const upsert = await req('POST', '/api/projects-config', {
      project: 'app',
      path: '/srv/app-v2',
    });
    expect(upsert.status).toBe(200);
    expect(upsert.data.path).toBe('/srv/app-v2');
    expect(upsert.data.created_at).toBe(create.data.created_at);

    const del = await req('DELETE', '/api/projects-config/app');
    expect(del.status).toBe(204);
    const after = await req('GET', '/api/projects-config');
    expect(after.data).toEqual([]);
  });
});

describe('path testing', () => {
  it('validates an existing dir and rejects a fake one', async () => {
    const real = await req('POST', '/api/test-path', { path: process.cwd() });
    expect(real.data.exists).toBe(true);
    expect(real.data.isDirectory).toBe(true);

    const fake = await req('POST', '/api/test-path', { path: '/no/such/path/zzz' });
    expect(fake.data.exists).toBe(false);
  });
});

describe('task filtering', () => {
  it('filters across multiple projects and statuses', async () => {
    await req('POST', '/api/tasks', { title: 'a1', project: 'A' });
    await req('POST', '/api/tasks', { title: 'a2', project: 'A' });
    await req('POST', '/api/tasks', { title: 'b1', project: 'B' });

    const a = await req('GET', '/api/tasks?project=A');
    expect(a.data).toHaveLength(2);

    await req('POST', '/api/projects/A/claim', {});
    const inProgress = await req('GET', '/api/tasks?project=A&status=in_progress');
    expect(inProgress.data).toHaveLength(1);

    const projects = await req('GET', '/api/projects');
    expect(projects.data.map((p) => p.project).sort()).toEqual(['A', 'B']);
  });
});

describe('concurrent claims', () => {
  it('hands a single task to exactly one of many racing claimers', async () => {
    await req('POST', '/api/tasks', { title: 'only one', project: 'race' });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => req('POST', '/api/projects/race/claim', {}))
    );
    const got = results.filter((r) => r.status === 200);
    const empty = results.filter((r) => r.status === 204);
    expect(got).toHaveLength(1);
    expect(empty).toHaveLength(4);
  });
});

describe('orchestrator simulation', () => {
  it('configures a project, creates a task, claims and answers it', async () => {
    await req('POST', '/api/projects-config', { project: 'orch', path: process.cwd() });

    // Orchestrator confirms the path before dispatching.
    const cfgList = await req('GET', '/api/projects-config');
    const cfg = cfgList.data.find((c) => c.project === 'orch');
    const pathCheck = await req('POST', '/api/test-path', { path: cfg.path });
    expect(pathCheck.data.exists).toBe(true);

    await req('POST', '/api/tasks', { title: 'do work', project: 'orch', priority: 1 });

    // Sub-session claims, then writes back with the session id it was given.
    const claim = await req('POST', '/api/projects/orch/claim', { agent_tool: 'claude-code' });
    const id = claim.data.id;
    const answered = await req('POST', `/api/tasks/${id}/answer`, {
      answer: 'finished',
      branch: `task/${id}-do-work`,
      session_id: 'orchestrated-uuid',
      session_title: 'do work',
      agent_tool: 'claude-code',
    });
    expect(answered.data.status).toBe('pending_review');
    expect(answered.data.session_id).toBe('orchestrated-uuid');
  });
});
