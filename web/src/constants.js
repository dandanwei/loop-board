export const COLUMNS = [
  { key: 'backlog', label: 'Backlog', accent: 'border-slate-300' },
  { key: 'in_progress', label: 'In Progress', accent: 'border-amber-400' },
  { key: 'pending_review', label: 'Pending Review', accent: 'border-violet-400' },
  { key: 'done', label: 'Done', accent: 'border-emerald-400' },
];

export const STATUS_LABEL = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  pending_review: 'Pending Review',
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
