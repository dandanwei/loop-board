import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Board from './components/Board.jsx';
import TaskDrawer from './components/TaskDrawer.jsx';
import NewTaskModal from './components/NewTaskModal.jsx';

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const params = {};
      if (project) params.project = project;
      if (includeArchived) params.includeArchived = 'true';
      const [t, p] = await Promise.all([api.listTasks(params), api.projects()]);
      setTasks(t);
      setProjects(p);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [project, includeArchived]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Light polling so agent write-backs show up without a manual refresh.
  useEffect(() => {
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-ink text-sm font-bold text-white">
            ↻
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Loop Board</h1>
        </div>

        <select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.project} value={p.project}>
              {p.project} ({p.total})
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>

        <div className="ml-auto flex items-center gap-2">
          {error && (
            <span className="text-sm text-rose-600" title={error}>
              ⚠ {error}
            </span>
          )}
          <button
            onClick={refresh}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Refresh
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            + New task
          </button>
        </div>
      </header>

      <Board
        tasks={tasks}
        includeArchived={includeArchived}
        onOpen={setSelectedId}
      />

      {selectedId != null && (
        <TaskDrawer
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
        />
      )}

      {showNew && (
        <NewTaskModal
          projects={projects}
          defaultProject={project}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
