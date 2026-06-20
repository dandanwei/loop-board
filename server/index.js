import express from 'express';
import cors from 'cors';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
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
  listProjectConfigs,
  getProjectConfig,
  upsertProjectConfig,
  deleteProjectConfig,
} from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || process.env.BOARD_PORT || 5151;

// Dropped images are saved here so descriptions can reference a stable local
// file path (which agents working a task can read) instead of inlining base64.
const UPLOADS_DIR =
  process.env.BOARD_UPLOADS || join(__dirname, '..', 'data', 'uploads');
mkdirSync(UPLOADS_DIR, { recursive: true });

const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
};

const app = express();
app.use(cors());
// Uploads are posted as base64 data URIs, so allow a larger request body.
app.use(express.json({ limit: '25mb' }));

const api = express.Router();

// Serve previously-uploaded images so the board UI can render them by URL.
api.use('/uploads', express.static(UPLOADS_DIR));

const wrap = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

api.get('/health', (_req, res) => res.json({ ok: true, time: now() }));

// Save an uploaded image to disk and return both a URL (for rendering in the
// board) and the absolute local path (so an agent can read the file directly).
api.post(
  '/uploads',
  wrap((req, res) => {
    const { name = 'image', dataUrl } = req.body || {};
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return res.status(400).json({ error: 'dataUrl (data: URI) is required' });
    }
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(5, comma); // e.g. "image/png;base64"
    const mime = header.split(';')[0];
    if (!mime.startsWith('image/') || !header.includes('base64')) {
      return res.status(400).json({ error: 'only base64 image data is accepted' });
    }
    const buf = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    if (!buf.length) return res.status(400).json({ error: 'empty image data' });

    // Build a safe, unique filename, keeping a hint of the original name.
    const base = String(name)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .slice(-60);
    let ext = extname(base).toLowerCase();
    if (!ext) ext = EXT_BY_MIME[mime] || '.bin';
    const stem = base.slice(0, base.length - extname(base).length) || 'image';
    const filename = `${randomUUID().slice(0, 8)}-${stem}${ext}`;
    const abspath = join(UPLOADS_DIR, filename);
    writeFileSync(abspath, buf);

    res.status(201).json({
      filename,
      url: `/api/uploads/${filename}`,
      path: abspath,
      bytes: buf.length,
    });
  })
);

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

// ---- projects config --------------------------------------------------------
// The orchestrator reads these label→path mappings to know which repo to cd
// into before dispatching a task to a project sub-session.

api.get('/projects-config', wrap((_req, res) => res.json(listProjectConfigs())));

api.post(
  '/projects-config',
  wrap((req, res) => {
    const { project, path } = req.body || {};
    if (!project || !path) {
      return res.status(400).json({ error: 'project and path are required' });
    }
    const existed = !!getProjectConfig(String(project).trim());
    const row = upsertProjectConfig({ project, path });
    res.status(existed ? 200 : 201).json(row);
  })
);

api.delete(
  '/projects-config/:project',
  wrap((req, res) => {
    const ok = deleteProjectConfig(req.params.project);
    if (!ok) return res.status(404).json({ error: 'config not found' });
    res.status(204).end();
  })
);

// Validate that a path exists and is a directory, so the config UI can warn
// before the orchestrator tries to cd into a bad path.
api.post(
  '/test-path',
  wrap((req, res) => {
    const { path } = req.body || {};
    if (!path || typeof path !== 'string') {
      return res.status(400).json({ error: 'path is required' });
    }
    try {
      const st = statSync(path);
      res.json({
        exists: true,
        isDirectory: st.isDirectory(),
        isGitRepo: existsSync(join(path, '.git')),
      });
    } catch (err) {
      res.json({ exists: false, error: err.code || err.message });
    }
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

// Tests import this module to exercise the routes in-process; setting
// BOARD_NO_LISTEN keeps them from racing for the real port.
if (process.env.BOARD_NO_LISTEN !== '1') {
  app.listen(PORT, () => {
    console.log(`Loop Board API listening on http://localhost:${PORT}`);
    if (!existsSync(webDist)) {
      console.log('UI not built yet — run `npm run dev` (HMR) or `npm run build`.');
    }
  });
}

export { app };
