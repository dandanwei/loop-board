import React from 'react';
import {
  PRIORITY,
  fmtDate,
  fmtDuration,
  inProgressSince,
  DEFAULT_STALE_THRESHOLD_MIN,
} from '../constants.js';

export default function TaskCard({
  task,
  onOpen,
  staleThresholdMinutes = DEFAULT_STALE_THRESHOLD_MIN,
  nowMs = Date.now(),
}) {
  const prio = PRIORITY[task.priority] || PRIORITY[2];

  // For in_progress tasks, work out how long they've been running and whether
  // that exceeds the configured threshold (so we can flag a long-running task).
  const since = task.status === 'in_progress' ? inProgressSince(task) : null;
  const elapsedMs = since ? nowMs - new Date(since).getTime() : 0;
  const isInProgress = task.status === 'in_progress' && since != null;
  const isStale =
    isInProgress && elapsedMs >= staleThresholdMinutes * 60000;

  return (
    <button
      onClick={onOpen}
      className={`group w-full rounded-lg border bg-white p-3 text-left shadow-sm transition hover:shadow ${
        isStale
          ? 'border-rose-300 ring-2 ring-rose-200 hover:border-rose-400'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
          {task.project}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${prio.cls}`}>
          {prio.label}
        </span>
        {isStale && (
          <span
            className="flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-700"
            title={`In progress for ${fmtDuration(elapsedMs)} (over the ${staleThresholdMinutes}m threshold)`}
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
            {fmtDuration(elapsedMs)}
          </span>
        )}
        <span className="ml-auto text-[11px] text-slate-400">#{task.id}</span>
      </div>

      <p className="text-sm font-medium leading-snug text-slate-800">
        {task.title}
      </p>

      {(task.branch || task.session_title) && (
        <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
          {task.session_title && (
            <div className="truncate" title={task.session_title}>
              ⌥ {task.session_title}
            </div>
          )}
          {task.branch && (
            <div className="truncate font-mono" title={task.branch}>
              ⎇ {task.branch}
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
        <span>{fmtDate(task.updated_at)}</span>
        {isInProgress && !isStale ? (
          <span title="Time in progress">⏱ {fmtDuration(elapsedMs)}</span>
        ) : task.answer ? (
          <span className="text-violet-500">has answer</span>
        ) : null}
      </div>
    </button>
  );
}
