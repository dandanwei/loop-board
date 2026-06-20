export const COLUMNS = [
  { key: 'backlog', label: 'Backlog', accent: 'border-slate-300' },
  { key: 'in_progress', label: 'In Progress', accent: 'border-amber-400' },
  { key: 'pending_review', label: 'Pending Review', accent: 'border-violet-400' },
  { key: 'ready_to_merge', label: 'Ready to Merge', accent: 'border-cyan-400' },
  { key: 'done', label: 'Done', accent: 'border-emerald-400' },
];

export const STATUS_LABEL = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  pending_review: 'Pending Review',
  ready_to_merge: 'Ready to Merge',
  done: 'Done',
  archived: 'Archived',
};

export const PRIORITY = {
  1: { label: 'High', cls: 'bg-rose-100 text-rose-700' },
  2: { label: 'Medium', cls: 'bg-sky-100 text-sky-700' },
  3: { label: 'Low', cls: 'bg-slate-100 text-slate-600' },
};

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Fallback used before the board's settings have loaded.
export const DEFAULT_STALE_THRESHOLD_MIN = 30;

// Compact human duration: "45s", "12m", "3h 5m", "2d 4h".
export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return `${Math.floor(ms / 1000)}s`;
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 24) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

// When did this task enter the in_progress state? Prefer claimed_at (set on
// claim or manual move) and fall back to updated_at.
export function inProgressSince(task) {
  return task.claimed_at || task.updated_at || null;
}
