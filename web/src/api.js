const BASE = '/api';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  health: () => req('/health'),
  projects: () => req('/projects'),
  listTasks: (params = {}) =>
    req('/tasks?' + new URLSearchParams(params).toString()),
  getTask: (id) => req(`/tasks/${id}`),
  uploadImage: (body) =>
    req('/uploads', { method: 'POST', body: JSON.stringify(body) }),
  createTask: (body) =>
    req('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id, body) =>
    req(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  setStatus: (id, status) =>
    req(`/tasks/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  comment: (id, body) =>
    req(`/tasks/${id}/comment`, {
      method: 'POST',
      body: JSON.stringify({ body, author: 'human' }),
    }),
  deleteTask: (id) => req(`/tasks/${id}`, { method: 'DELETE' }),

  // Project label → repo path mappings used by the orchestrator.
  getProjectsConfig: () => req('/projects-config'),
  createProjectConfig: (body) =>
    req('/projects-config', { method: 'POST', body: JSON.stringify(body) }),
  deleteProjectConfig: (project) =>
    req(`/projects-config/${encodeURIComponent(project)}`, { method: 'DELETE' }),
  testPath: (path) =>
    req('/test-path', { method: 'POST', body: JSON.stringify({ path }) }),

  // Board-wide settings (e.g. the stale-task threshold).
  getSettings: () => req('/settings'),
  updateSettings: (body) =>
    req('/settings', { method: 'PATCH', body: JSON.stringify(body) }),
};
