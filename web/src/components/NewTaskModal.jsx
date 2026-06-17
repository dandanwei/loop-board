import React, { useState } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { api } from '../api.js';

export default function NewTaskModal({
  projects,
  defaultProject,
  onClose,
  onCreated,
}) {
  const [title, setTitle] = useState('');
  const [project, setProject] = useState(defaultProject || '');
  const [priority, setPriority] = useState(2);
  const [description, setDescription] = useState('');
  const [dod, setDod] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim() || !project.trim()) {
      setError('Title and project are required.');
      return;
    }
    setSaving(true);
    try {
      await api.createTask({
        title: title.trim(),
        project: project.trim(),
        priority: Number(priority),
        description,
        definition_of_done: dod,
      });
      onCreated();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6">
      <div className="my-6 w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold">New task</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Title
            </label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Project label
              </label>
              <input
                list="project-list"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="e.g. my-app"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <datalist id="project-list">
                {projects.map((p) => (
                  <option key={p.project} value={p.project} />
                ))}
              </datalist>
            </div>
            <div className="w-40">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value={1}>High</option>
                <option value={2}>Medium</option>
                <option value={3}>Low</option>
              </select>
            </div>
          </div>

          <div data-color-mode="light">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Description
            </label>
            <MDEditor
              value={description}
              onChange={(v) => setDescription(v || '')}
              height={180}
              preview="edit"
            />
          </div>

          <div data-color-mode="light">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Definition of done
            </label>
            <MDEditor
              value={dod}
              onChange={(v) => setDod(v || '')}
              height={150}
              preview="edit"
            />
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="rounded-md bg-ink px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  );
}
