import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STATUSES,
  now,
  addEvent,
  getTask,
  listTasks,
  distinctProjects,
  createTask,
  updateTask,
  deleteTask,
  claimNext,
} from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || process.env.BOARD_PORT || 5151;

const app = express();
app.use(cors());
// Descriptions can embed images as base64 data URIs, so allow a larger body.
app.use(express.json({ limit: '25mb' }));

const api = express.Router();

const wrap = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

api.get('/health', (_req, res) => res.json({ ok: true, time: now() }));

api.get('/projects', wrap((_req, res) => res.json(distinctProjects())));

api.get(
  '/tasks',
  wrap((req, res) => {
    const { project, status } = req.query;
    const includeArchived =
      req.query.includeArchived === 'true' || req.query.includeArchived === '1';
    res.json(listTasks({ project, status, includeArchived }));
  })
);

api.post(
  '/tasks',
  wrap((req, res) => {
    if (!req.body.title || !req.body.project) {
      return res.status(400).json({ error: 'title and project are required' });
    }
    res.status(201).json(createTask(req.body));
  })
);

api.get(
  '/tasks/:id',
  wrap((req, res) => {
    const task = getTask(Number(req.params.id), true);
    if (!task) return res.status(404).json({ error: 'task not found' });
    res.json(task);
  })
);

api.patch(
  '/tasks/:id',
  wrap((req, res) => {
    const id = Number(req.params.id);
    if (!getTask(id)) return res.status(404).json({ error: 'task not found' });
    if (req.body.status && !STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: `invalid status: ${req.body.status}` });
    }
    res.json(updateTask(id, req.body));
  })
);

api.delete(
  '/tasks/:id',
  wrap((req, res) => {
    const ok = deleteTask(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'task not found' });
    res.status(204).end();
  })
);

api.post(
  '/tasks/:id/status',
  wrap((req, res) => {
    const id = Number(req.params.id);
    const { status, author } = req.body;
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: `invalid status: ${status}` });
    }
    const task = getTask(id);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const patch = { status };
    if (status === 'done' || status === 'archived') patch.completed_at = now();
    res.json(
      updateTask(id, patch, {
        event: {
          type: 'status_change',
          body: `${task.status} → ${status}`,
          author: author || 'human',
        },
      })
    );
  })
);

api.post(
  '/tasks/:id/comment',
  wrap((req, res) => {
    const id = Number(req.params.id);
    if (!getTask(id)) return res.status(404).json({ error: 'task not found' });
    if (!req.body.body) return res.status(400).json({ error: 'body is required' });
    addEvent(id, {
      type: 'comment',
      body: req.body.body,
      author: req.body.author || 'human',
    });
    res.json(getTask(id, true));
  })
);

// The skill's main write-back: attach the answer, branch + session metadata,
// and (by default) move the task into the review queue — all in one call.
api.post(
  '/tasks/:id/answer',
  wrap((req, res) => {
    const id = Number(req.params.id);
    const task = getTask(id);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const {
      answer,
      branch,
      session_title,
      session_id,
      agent_tool,
      status = 'pending_review',
    } = req.body;
    if (!answer) return res.status(400).json({ error: 'answer is required' });
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: `invalid status: ${status}` });
    }
    const patch = { answer, status };
    if (branch != null) patch.branch = branch;
    if (session_title != null) patch.session_title = session_title;
    if (session_id != null) patch.session_id = session_id;
    if (agent_tool != null) patch.agent_tool = agent_tool;
    if (status === 'done') patch.completed_at = now();
    res.json(
      updateTask(id, patch, {
        event: {
          type: 'answer',
          body: answer,
          author: agent_tool || task.agent_tool || 'agent',
          meta: { branch, session_title, status },
        },
      })
    );
  })
);

// Atomically claim the next backlog task for a project.
api.post(
  '/projects/:project/claim',
  wrap((req, res) => {
    const task = claimNext(req.params.project, {
      agent_tool: req.body.agent_tool || '',
    });
    if (!task) return res.status(204).end();
    res.json(task);
  })
);

app.use('/api', api);

// Serve the built UI in production. In dev, Vite serves the UI itself.
const webDist = join(__dirname, '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(webDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Loop Board API listening on http://localhost:${PORT}`);
  if (!existsSync(webDist)) {
    console.log('UI not built yet — run `npm run dev` (HMR) or `npm run build`.');
  }
});
