import React, { useRef, useState } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { api } from '../api.js';
import {
  MAX_IMAGE_MB,
  MAX_IMAGE_BYTES,
  hasFiles,
  imageFilesFrom,
  fileToDataUrl,
  imageMarkdown,
  appendToMarkdown,
} from '../images.js';

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
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child element; count depth so the
  // overlay only clears when the cursor truly leaves the modal.
  const dragDepth = useRef(0);

  // Read image files and embed them into the description as data-URI markdown.
  const embedImages = async (files) => {
    if (!files.length) return;
    const tooBig = files.find((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig) {
      setError(
        `Image "${tooBig.name}" is too large (max ${MAX_IMAGE_MB} MB per image).`
      );
      return;
    }
    try {
      const snippets = [];
      for (const f of files) {
        snippets.push(imageMarkdown(f.name, await fileToDataUrl(f)));
      }
      setDescription((prev) => appendToMarkdown(prev, snippets));
      setError('');
    } catch {
      setError('Could not read the dropped image.');
    }
  };

  const onDragEnter = (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    embedImages(imageFilesFrom(e.dataTransfer));
  };
  const onPaste = (e) => {
    const files = imageFilesFrom(e.clipboardData);
    if (files.length) {
      e.preventDefault();
      embedImages(files);
    }
  };

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
      <div
        className="relative my-6 w-full max-w-2xl rounded-xl bg-white shadow-2xl"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-violet-400 bg-violet-50/85">
            <div className="rounded-md bg-white/90 px-4 py-2 text-sm font-medium text-violet-700 shadow">
              Drop image to embed in the description
            </div>
          </div>
        )}
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
            <label className="mb-1 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
              <span>Description</span>
              <span className="font-normal normal-case tracking-normal text-slate-400">
                drag &amp; drop or paste an image to embed it
              </span>
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
