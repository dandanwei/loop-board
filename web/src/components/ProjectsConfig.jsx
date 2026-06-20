import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

// Shows a small badge after the user clicks "Test" on a path.
function PathStatus({ result }) {
  if (!result) return null;
  if (result.checking)
    return <span className="text-xs text-slate-400">checking…</span>;
  if (!result.exists)
    return (
      <span className="text-xs text-rose-600">
        ✗ not found{result.error ? ` (${result.error})` : ''}
      </span>
    );
  if (!result.isDirectory)
    return <span className="text-xs text-amber-600">⚠ not a directory</span>;
  return (
    <span className="text-xs text-emerald-600">
      ✓ exists{result.isGitRepo ? ' · git repo' : ' · not a git repo'}
    </span>
  );
}

export default function ProjectsConfig({
  settings,
  onClose,
  onChanged,
  onSettingsChanged,
}) {
  const [configs, setConfigs] = useState([]);
  const [project, setProject] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // path-test results keyed by project label, plus 'new' for the add form.
  const [tests, setTests] = useState({});
  // Stale-task threshold (minutes); editable as a string so the field can be
  // cleared while typing.
  const [threshold, setThreshold] = useState(
    String(settings?.stale_threshold_minutes ?? 30)
  );
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [thresholdSaved, setThresholdSaved] = useState(false);

  useEffect(() => {
    setThreshold(String(settings?.stale_threshold_minutes ?? 30));
  }, [settings?.stale_threshold_minutes]);

  const load = async () => {
    try {
      setConfigs(await api.getProjectsConfig());
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const testPath = async (key, p) => {
    if (!p.trim()) return;
    setTests((t) => ({ ...t, [key]: { checking: true } }));
    try {
      const res = await api.testPath(p.trim());
      setTests((t) => ({ ...t, [key]: res }));
    } catch (e) {
      setTests((t) => ({ ...t, [key]: { exists: false, error: e.message } }));
    }
  };

  const handleCreate = async () => {
    if (!project.trim() || !path.trim()) {
      setError('Project label and path are required.');
      return;
    }
    setSaving(true);
    try {
      await api.createProjectConfig({ project: project.trim(), path: path.trim() });
      setProject('');
      setPath('');
      setTests((t) => ({ ...t, new: undefined }));
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveThreshold = async () => {
    const n = Number(threshold);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Stale threshold must be a positive number of minutes.');
      return;
    }
    setSavingThreshold(true);
    setThresholdSaved(false);
    try {
      await api.updateSettings({ stale_threshold_minutes: n });
      setError('');
      setThresholdSaved(true);
      onSettingsChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingThreshold(false);
    }
  };

  const handleDelete = async (proj) => {
    if (!confirm(`Remove the path mapping for "${proj}"?`)) return;
    try {
      await api.deleteProjectConfig(proj);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6">
      <div className="relative my-6 w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">Configuration</h2>
            <p className="text-xs text-slate-500">
              Board settings and project label → repo path mappings used by the
              orchestrator.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* board settings */}
          <div className="rounded-md border border-slate-200 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Board settings
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-slate-600">
                Highlight a task as running long after
              </label>
              <input
                type="number"
                min="1"
                value={threshold}
                onChange={(e) => {
                  setThreshold(e.target.value);
                  setThresholdSaved(false);
                }}
                className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
              <span className="text-sm text-slate-600">minutes in progress.</span>
              <button
                onClick={handleSaveThreshold}
                disabled={savingThreshold}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                {savingThreshold ? 'Saving…' : 'Save'}
              </button>
              {thresholdSaved && (
                <span className="text-xs text-emerald-600">✓ saved</span>
              )}
            </div>
          </div>

          {/* existing configs */}
          {configs.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400">
              No project paths configured yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {configs.map((c) => (
                <li key={c.project} className="flex items-center gap-3 px-3 py-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                    {c.project}
                  </span>
                  <span className="flex-1 truncate font-mono text-xs text-slate-600">
                    {c.path}
                  </span>
                  <PathStatus result={tests[c.project]} />
                  <button
                    onClick={() => testPath(c.project, c.path)}
                    className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
                  >
                    Test
                  </button>
                  <button
                    onClick={() => handleDelete(c.project)}
                    className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* add form */}
          <div className="rounded-md border border-slate-200 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Add / update a mapping
            </h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="project label"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm sm:w-40"
              />
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/absolute/path/to/repo"
                className="w-full flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
              />
              <button
                onClick={() => testPath('new', path)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
              >
                Test
              </button>
            </div>
            <div className="mt-1.5 min-h-[1rem]">
              <PathStatus result={tests.new} />
            </div>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Close
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="rounded-md bg-ink px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save mapping'}
          </button>
        </div>
      </div>
    </div>
  );
}
