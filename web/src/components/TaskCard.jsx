import React from 'react';
import { PRIORITY, fmtDate } from '../constants.js';

export default function TaskCard({ task, onOpen }) {
  const prio = PRIORITY[task.priority] || PRIORITY[2];
  return (
    <button
      onClick={onOpen}
      className="group w-full rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow"
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
          {task.project}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${prio.cls}`}>
          {prio.label}
        </span>
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
        {task.answer ? <span className="text-violet-500">has answer</span> : null}
      </div>
    </button>
  );
}
