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

// Fallbacks used before the board's settings have loaded.
export const DEFAULT_STALE_THRESHOLD_MIN = 30;
export const DEFAULT_TIME_CAP_MIN = 30;

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

// Project label colors -------------------------------------------------------
// Each project label gets its own colored badge so tasks from different
// projects are easy to tell apart at a glance. Rather than store a color per
// project (and have to assign one whenever a new label first appears), we map
// the label to a fixed palette via a small stable hash. The effect is like
// picking a color "at random" the first time a project is seen — it looks
// arbitrary — but it stays consistent across reloads and everywhere the label
// is rendered, and needs no persistence. The full class strings are spelled
// out so Tailwind keeps them when it scans this file.
export const PROJECT_COLORS = [
  'bg-rose-100 text-rose-700',
  'bg-orange-100 text-orange-700',
  'bg-amber-100 text-amber-700',
  'bg-lime-100 text-lime-700',
  'bg-emerald-100 text-emerald-700',
  'bg-teal-100 text-teal-700',
  'bg-cyan-100 text-cyan-700',
  'bg-sky-100 text-sky-700',
  'bg-blue-100 text-blue-700',
  'bg-indigo-100 text-indigo-700',
  'bg-violet-100 text-violet-700',
  'bg-fuchsia-100 text-fuchsia-700',
  'bg-pink-100 text-pink-700',
];

// Neutral fallback for a missing/empty project label.
export const PROJECT_COLOR_FALLBACK = 'bg-slate-100 text-slate-600';

// Map a project label to its badge classes. Uses a small deterministic string
// hash so the same label always lands on the same palette entry.
export function projectBadgeClasses(project) {
  const label = String(project || '').trim();
  if (!label) return PROJECT_COLOR_FALLBACK;
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PROJECT_COLORS.length;
  return PROJECT_COLORS[idx];
}
