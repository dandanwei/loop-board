import React, { useEffect, useState } from 'react';
import MDEditor from '@uiw/react-md-editor';
import { api } from '../api.js';
import {
  COLUMNS,
  PRIORITY,
  STATUS_LABEL,
  fmtDate,
  projectBadgeClasses,
} from '../constants.js';

const ALL_STATUSES = [
  'backlog',
  'in_progress',
  'pending_review',
  'ready_to_merge',
  'done',
  'archived',
];

function CopyButton({ value }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
    >
      {done ? 'copied' : 'copy'}
    </button>
  );
}

// Builds a one-line copy-paste command to jump back into the agent's session:
// cd into the repo (path comes from the project config), check out the task's
// branch, then `claude --resume <session id>`. The `git checkout` segment is
// skipped when the task has no branch.
function ResumeButton({ session_id, branch, project }) {
  const [showCommand, setShowCommand] = useState(false);
  const [copied, setCopied] = useState(false);
  const [projectPath, setProjectPath] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .getProjectsConfig()
      .then((cfgs) => {
        if (!alive) return;
        const match = cfgs.find((c) => c.project === project);
        setProjectPath(match ? match.path : '');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [project]);

  if (!session_id) return null;

  const parts = [];
  if (projectPath) parts.push(`cd ${projectPath}`);
  if (branch) parts.push(`git checkout ${branch}`);
  parts.push(`claude --resume ${session_id}`);
  const fullCommand = parts.join(' && ');

  return (
    <div className="pt-1">
      {showCommand ? (
        <div className="rounded bg-white p-2">
          <code className="block break-all text-[11px] text-slate-600">
            {fullCommand}
          </code>
          {!projectPath && (
            <p className="mt-1 text-[11px] text-amber-600">
              No path configured for “{project}” — run from the repo directory.
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                navigator.clipboard?.writeText(fullCommand);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
            >
              {copied ? '✓ copied' : 'copy command'}
            </button>
            <button
              onClick={() => setShowCommand(false)}
              className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
            >
              hide
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowCommand(true)}
          className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
        >
          🖥 Resume session
        </button>
      )}
    </div>
  );
}

function MarkdownField({ value, onSave, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');

  useEffect(() => {
    if (!editing) setDraft(value || '');
  }, [value, editing]);

  if (editing) {
    return (
      <div data-color-mode="light">
        <MDEditor value={draft} onChange={(v) => setDraft(v || '')} height={320} />
        <div className="mt-2 flex gap-2">
          <button
            onClick={async () => {
              await onSave(draft);
              setEditing(false);
            }}
            className="rounded-md bg-ink px-3 py-1 text-sm font-medium text-white hover:bg-slate-700"
          >
            Save
          </button>
          <button
            onClick={() => {
              setDraft(value || '');
              setEditing(false);
            }}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative" data-color-mode="light">
      <button
        onClick={() => setEditing(true)}
        className="absolute right-0 top-0 z-10 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500 opacity-0 transition group-hover:opacity-100"
      >
        edit
      </button>
      {value ? (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <MDEditor.Markdown source={value} />
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="w-full rounded-lg border border-dashed border-slate-300 p-4 text-left text-sm text-slate-400 hover:border-slate-400"
        >
          {placeholder}
        </button>
      )}
    </div>
  );
}

export default function TaskDrawer({ id, onClose, onChanged }) {
  const [task, setTask] = useState(null);
  const [tab, setTab] = useState('answer');
  const [comment, setComment] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);

  const load = async () => {
    const t = await api.getTask(id);
    setTask(t);
    setTitleDraft(t.title);
    return t;
  };

  useEffect(() => {
    load().then((t) => setTab(t.answer ? 'answer' : 'details'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Close the drawer on Escape, matching the backdrop-click behaviour.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !e.isComposing) onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const mutate = async (fn) => {
    await fn();
    await load();
    onChanged?.();
  };

  if (!task) return null;

  const prio = PRIORITY[task.priority] || PRIORITY[2];

  const tabs = [
    { key: 'answer', label: 'Answer', dot: !!task.answer },
    { key: 'details', label: 'Details', dot: false },
    {
      key: 'activity',
      label: `Activity${task.events ? ` (${task.events.length})` : ''}`,
      dot: false,
    },
  ];

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="flex-1 bg-slate-900/30" onClick={onClose} />
      <aside className="flex w-full max-w-2xl flex-col bg-white shadow-2xl">
        {/* header */}
        <div className="border-b border-slate-200 px-5 py-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => {
                    setEditingTitle(false);
                    if (titleDraft.trim() && titleDraft !== task.title)
                      mutate(() => api.updateTask(id, { title: titleDraft.trim() }));
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-lg font-semibold"
                />
              ) : (
                <h2
                  className="cursor-text text-lg font-semibold leading-snug text-slate-900"
                  onClick={() => setEditingTitle(true)}
                  title="Click to rename"
                >
                  {task.title}
                </h2>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                <span className={`rounded px-1.5 py-0.5 font-medium ${projectBadgeClasses(task.project)}`}>
                  {task.project}
                </span>
                <select
                  value={task.priority}
                  onChange={(e) =>
                    mutate(() =>
                      api.updateTask(id, { priority: Number(e.target.value) })
                    )
                  }
                  className={`rounded px-1.5 py-0.5 font-medium ${prio.cls}`}
                >
                  <option value={1}>High</option>
                  <option value={2}>Medium</option>
                  <option value={3}>Low</option>
                </select>
                <span className="text-slate-400">#{task.id}</span>
                <span className="text-slate-400">
                  updated {fmtDate(task.updated_at)}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              ✕
            </button>
          </div>

          {/* status mover */}
          <div className="mt-3 flex flex-wrap items-center gap-1">
            {ALL_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => mutate(() => api.setStatus(id, s))}
                className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                  task.status === s
                    ? 'bg-ink text-white'
                    : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          {/* branch / session */}
          {(task.branch || task.session_title || task.session_id) && (
            <div className="mt-3 space-y-1 rounded-md bg-slate-50 p-2 text-xs">
              {task.session_title && (
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-slate-400">session</span>
                  <span className="flex-1 truncate">{task.session_title}</span>
                  <CopyButton value={task.session_title} />
                </div>
              )}
              {task.session_id && (
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-slate-400">id</span>
                  <span className="flex-1 truncate font-mono">
                    {task.session_id}
                  </span>
                  <CopyButton value={task.session_id} />
                </div>
              )}
              {task.branch && (
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-slate-400">branch</span>
                  <span className="flex-1 truncate font-mono">{task.branch}</span>
                  <CopyButton value={task.branch} />
                </div>
              )}
              {task.agent_tool && (
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-slate-400">agent</span>
                  <span className="flex-1 truncate">{task.agent_tool}</span>
                </div>
              )}
              {task.session_id && (
                <ResumeButton
                  session_id={task.session_id}
                  branch={task.branch}
                  project={task.project}
                />
              )}
            </div>
          )}
        </div>

        {/* tabs */}
        <div className="flex gap-1 border-b border-slate-200 px-5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === t.key
                  ? 'border-ink text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
              {t.dot && <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />}
            </button>
          ))}
        </div>

        {/* body */}
        <div className="thin-scroll flex-1 overflow-y-auto p-5">
          {tab === 'answer' && (
            <MarkdownField
              value={task.answer}
              placeholder="No answer yet. The agent posts its result here — or click to write one."
              onSave={(v) => mutate(() => api.updateTask(id, { answer: v }))}
            />
          )}

          {tab === 'details' && (
            <div className="space-y-5">
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Description
                </h3>
                <MarkdownField
                  value={task.description}
                  placeholder="Add task details…"
                  onSave={(v) =>
                    mutate(() => api.updateTask(id, { description: v }))
                  }
                />
              </div>
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Definition of done
                </h3>
                <MarkdownField
                  value={task.definition_of_done}
                  placeholder="Add the acceptance criteria…"
                  onSave={(v) =>
                    mutate(() => api.updateTask(id, { definition_of_done: v }))
                  }
                />
              </div>
            </div>
          )}

          {tab === 'activity' && (
            <div className="space-y-4">
              <div data-color-mode="light">
                <MDEditor
                  value={comment}
                  onChange={(v) => setComment(v || '')}
                  height={140}
                  preview="edit"
                />
                <button
                  disabled={!comment.trim()}
                  onClick={() =>
                    mutate(async () => {
                      await api.comment(id, comment);
                      setComment('');
                    })
                  }
                  className="mt-2 rounded-md bg-ink px-3 py-1 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
                >
                  Add comment
                </button>
              </div>
              <ol className="space-y-3 border-l border-slate-200 pl-4">
                {(task.events || [])
                  .slice()
                  .reverse()
                  .map((ev) => (
                    <li key={ev.id} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-slate-300" />
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="font-medium text-slate-600">
                          {ev.type}
                        </span>
                        <span>{ev.author}</span>
                        <span>· {fmtDate(ev.created_at)}</span>
                      </div>
                      {ev.body && (
                        <div
                          className="mt-1 rounded-md border border-slate-200 bg-white p-2 text-sm"
                          data-color-mode="light"
                        >
                          <MDEditor.Markdown source={ev.body} />
                        </div>
                      )}
                    </li>
                  ))}
              </ol>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <button
            onClick={() => {
              if (confirm(`Delete task #${task.id}? This cannot be undone.`))
                mutate(async () => {
                  await api.deleteTask(id);
                  onClose();
                });
            }}
            className="text-sm text-rose-600 hover:underline"
          >
            Delete
          </button>
          <div className="flex gap-2">
            {task.status === 'pending_review' && (
              <button
                onClick={() => mutate(() => api.setStatus(id, 'ready_to_merge'))}
                className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-700"
              >
                Ready to merge
              </button>
            )}
            {task.status !== 'archived' && (
              <button
                onClick={() => mutate(() => api.setStatus(id, 'archived'))}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Archive
              </button>
            )}
            {task.status !== 'done' && (
              <button
                onClick={() => mutate(() => api.setStatus(id, 'done'))}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Mark done
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
