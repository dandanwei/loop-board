import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the DB at a throwaway file and keep the server from binding a port —
// supertest drives the exported app in-process.
process.env.BOARD_DB = join(mkdtempSync(join(tmpdir(), 'loopboard-api-')), 'test.db');
process.env.BOARD_NO_LISTEN = '1';

const { app } = await import('../server/index.js');
const { db } = await import('../server/db.js');

const agent = request(app);

beforeEach(() => {
  db.exec('DELETE FROM tasks');
  db.exec('DELETE FROM task_events');
  db.exec('DELETE FROM projects_config');
  db.exec('DELETE FROM settings');
});

describe('health', () => {
  it('GET /api/health returns ok', async () => {
    const res = await agent.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.time).toBeTruthy();
  });
});

describe('tasks endpoints', () => {
  it('POST /api/tasks creates a task', async () => {
    const res = await agent.post('/api/tasks').send({ title: 'T', project: 'p' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.title).toBe('T');
  });

  it('POST /api/tasks requires title and project', async () => {
    const res = await agent.post('/api/tasks').send({ title: 'no project' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('GET /api/tasks lists, filters by project and status', async () => {
    await agent.post('/api/tasks').send({ title: 'a', project: 'p1' });
    await agent.post('/api/tasks').send({ title: 'b', project: 'p2' });
    const all = await agent.get('/api/tasks');
    expect(all.body.length).toBe(2);
    const p1 = await agent.get('/api/tasks?project=p1');
    expect(p1.body).toHaveLength(1);
    expect(p1.body[0].project).toBe('p1');
    const backlog = await agent.get('/api/tasks?status=backlog');
    expect(backlog.body.every((t) => t.status === 'backlog')).toBe(true);
  });

  it('GET /api/tasks/:id returns a task with events, 404 otherwise', async () => {
    const created = await agent.post('/api/tasks').send({ title: 'a', project: 'p' });
    const res = await agent.get(`/api/tasks/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    const missing = await agent.get('/api/tasks/999999');
    expect(missing.status).toBe(404);
  });

  it('PATCH /api/tasks/:id updates fields and validates status', async () => {
    const created = await agent.post('/api/tasks').send({ title: 'a', project: 'p' });
    const ok = await agent.patch(`/api/tasks/${created.body.id}`).send({ title: 'b' });
    expect(ok.body.title).toBe('b');
    const bad = await agent
      .patch(`/api/tasks/${created.body.id}`)
      .send({ status: 'nonsense' });
    expect(bad.status).toBe(400);
    const missing = await agent.patch('/api/tasks/999999').send({ title: 'x' });
    expect(missing.status).toBe(404);
  });

  it('DELETE /api/tasks/:id removes a task', async () => {
    const created = await agent.post('/api/tasks').send({ title: 'a', project: 'p' });
    const del = await agent.delete(`/api/tasks/${created.body.id}`);
    expect(del.status).toBe(204);
    const missing = await agent.delete('/api/tasks/999999');
    expect(missing.status).toBe(404);
  });

  it('POST /api/tasks/:id/status moves a task and records the change', async () => {
    const created = await agent.post('/api/tasks').send({ title: 'a', project: 'p' });
    const res = await agent
      .post(`/api/tasks/${created.body.id}/status`)
      .send({ status: 'done' });
    expect(res.body.status).toBe('done');
    expect(res.body.completed_at).toBeTruthy();
    expect(res.body.events.some((e) => e.type === 'status_change')).toBe(true);
    const bad = await agent
      .post(`/api/tasks/${created.body.id}/status`)
      .send({ status: 'nope' });
    expect(bad.status).toBe(400);
  });

  it('stamps claimed_at when moved to in_progress manually', async () => {
    const created = await agent.post('/api/tasks').send({ title: 'a', project: 'p' });
    expect(created.body.claimed_at).toBeFalsy();
    const res = await agent
      .post(`/api/tasks/${created.body.id}/status`)
      .send({ status: 'in_progress' });
    expect(res.body.status).toBe('in_progress');
    expect(res.body.claimed_at).toBeTruthy();
  });

  it('POST /api/tasks/:id/comment appends a comment', async () => {
    const created = await agent.post('/api/tasks').send({ title: 'a', project: 'p' });
    const res = await agent
      .post(`/api/tasks/${created.body.id}/comment`)
      .send({ body: 'a note', author: 'human' });
    expect(res.body.events.some((e) => e.type === 'comment' && e.body === 'a note')).toBe(
      true
    );
    const bad = await agent.post(`/api/tasks/${created.body.id}/comment`).send({});
    expect(bad.status).toBe(400);
  });

  it('POST /api/tasks/:id/answer attaches answer + metadata and moves to review', async () => {
    const created = await agent.post('/api/tasks').send({ title: 'a', project: 'p' });
    const res = await agent.post(`/api/tasks/${created.body.id}/answer`).send({
      answer: 'done it',
      branch: 'task/1-x',
      session_title: 'fix x',
      session_id: 'uuid-123',
      agent_tool: 'claude-code',
    });
    expect(res.body.status).toBe('pending_review');
    expect(res.body.answer).toBe('done it');
    expect(res.body.branch).toBe('task/1-x');
    expect(res.body.session_id).toBe('uuid-123');
    const bad = await agent.post(`/api/tasks/${created.body.id}/answer`).send({});
    expect(bad.status).toBe(400);
  });
});

describe('projects endpoint', () => {
  it('GET /api/projects aggregates open counts', async () => {
    await agent.post('/api/tasks').send({ title: 'a', project: 'alpha' });
    await agent.post('/api/tasks').send({ title: 'b', project: 'alpha' });
    const res = await agent.get('/api/projects');
    const alpha = res.body.find((p) => p.project === 'alpha');
    expect(alpha.backlog).toBe(2);
  });

  it('POST /api/projects/:project/claim claims atomically, 204 when empty', async () => {
    await agent.post('/api/tasks').send({ title: 'a', project: 'p' });
    const claim = await agent.post('/api/projects/p/claim').send({ agent_tool: 'claude' });
    expect(claim.status).toBe(200);
    expect(claim.body.status).toBe('in_progress');
    const empty = await agent.post('/api/projects/p/claim').send({});
    expect(empty.status).toBe(204);
  });
});

describe('projects-config endpoints', () => {
  it('GET /api/projects-config starts empty', async () => {
    const res = await agent.get('/api/projects-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('POST /api/projects-config creates (201) then upserts (200)', async () => {
    const create = await agent
      .post('/api/projects-config')
      .send({ project: 'app', path: '/srv/app' });
    expect(create.status).toBe(201);
    expect(create.body.path).toBe('/srv/app');
    const update = await agent
      .post('/api/projects-config')
      .send({ project: 'app', path: '/srv/app2' });
    expect(update.status).toBe(200);
    expect(update.body.path).toBe('/srv/app2');
    const list = await agent.get('/api/projects-config');
    expect(list.body).toHaveLength(1);
  });

  it('POST /api/projects-config requires project and path', async () => {
    const res = await agent.post('/api/projects-config').send({ project: 'app' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it('DELETE /api/projects-config/:project removes it, 404 otherwise', async () => {
    await agent.post('/api/projects-config').send({ project: 'app', path: '/srv/app' });
    const del = await agent.delete('/api/projects-config/app');
    expect(del.status).toBe(204);
    const missing = await agent.delete('/api/projects-config/app');
    expect(missing.status).toBe(404);
  });
});

describe('settings endpoints', () => {
  it('GET /api/settings returns defaults', async () => {
    const res = await agent.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.stale_threshold_minutes).toBe(30);
  });

  it('PATCH /api/settings updates the stale threshold', async () => {
    const res = await agent
      .patch('/api/settings')
      .send({ stale_threshold_minutes: 60 });
    expect(res.status).toBe(200);
    expect(res.body.stale_threshold_minutes).toBe(60);
    const again = await agent.get('/api/settings');
    expect(again.body.stale_threshold_minutes).toBe(60);
  });

  it('PATCH /api/settings rejects an invalid threshold', async () => {
    const res = await agent
      .patch('/api/settings')
      .send({ stale_threshold_minutes: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive/);
  });
});

describe('test-path endpoint', () => {
  it('reports an existing directory as a git repo or not', async () => {
    // The loop-board repo root itself exists and is a git repo.
    const res = await agent.post('/api/test-path').send({ path: process.cwd() });
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.isDirectory).toBe(true);
    expect(typeof res.body.isGitRepo).toBe('boolean');
  });

  it('reports a non-existent path', async () => {
    const res = await agent
      .post('/api/test-path')
      .send({ path: '/definitely/not/here/at/all/xyz' });
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
    expect(res.body.error).toBeTruthy();
  });

  it('requires a path', async () => {
    const res = await agent.post('/api/test-path').send({});
    expect(res.status).toBe(400);
  });
});
