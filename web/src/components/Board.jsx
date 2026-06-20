import React, { useEffect, useState } from 'react';
import { COLUMNS, DEFAULT_STALE_THRESHOLD_MIN } from '../constants.js';
import TaskCard from './TaskCard.jsx';

export default function Board({
  tasks,
  includeArchived,
  onOpen,
  staleThresholdMinutes = DEFAULT_STALE_THRESHOLD_MIN,
}) {
  const columns = includeArchived
    ? [...COLUMNS, { key: 'archived', label: 'Archived', accent: 'border-slate-300' }]
    : COLUMNS;

  // Tick once a minute so elapsed times and the stale highlight advance even
  // when the task list itself hasn't changed.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const byStatus = (status) => tasks.filter((t) => t.status === status);

  return (
    <main className="flex flex-1 gap-4 overflow-x-auto p-5">
      {columns.map((col) => {
        const items = byStatus(col.key);
        return (
          <section
            key={col.key}
            className="flex w-80 flex-shrink-0 flex-col rounded-xl bg-slate-100/60"
          >
            <div
              className={`flex items-center justify-between border-t-4 ${col.accent} rounded-t-xl bg-white px-3 py-2`}
            >
              <h2 className="text-sm font-semibold text-slate-700">{col.label}</h2>
              <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-500">
                {items.length}
              </span>
            </div>
            <div className="thin-scroll flex flex-1 flex-col gap-2 overflow-y-auto p-2">
              {items.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  onOpen={() => onOpen(t.id)}
                  staleThresholdMinutes={staleThresholdMinutes}
                  nowMs={nowMs}
                />
              ))}
              {items.length === 0 && (
                <p className="px-1 py-6 text-center text-xs text-slate-400">
                  Nothing here
                </p>
              )}
            </div>
          </section>
        );
      })}
    </main>
  );
}
