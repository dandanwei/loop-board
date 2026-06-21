#!/usr/bin/env node
// loop-board CLI — a thin, dependency-free client for the local board API.
// Used by the loop-board-* skills (loop-board-take-task, loop-board-merge-task,
// …) so agents don't have to hand-craft curl/JSON.
//
// Config resolution (highest priority first):
//   --url / --project flags
//   BOARD_URL / BOARD_PROJECT env vars
//   ./.board.json   ({ "project": "...", "boardUrl": "..." })
//   default: http://localhost:5151
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const cmd = args[0];

// ---- arg parsing ------------------------------------------------------------
function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

const { flags, positional } = parseFlags(args.slice(1));

function loadConfig() {
  const path = join(process.cwd(), '.board.json');
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      die('Could not parse .board.json (invalid JSON).');
    }
  }
  return {};
}

const cfg = loadConfig();
const BASE = (
  flags.url ||
  process.env.BOARD_URL ||
  cfg.boardUrl ||
  'http://localhost:5151'
).replace(/\/$/, '');
const PROJECT = flags.project || process.env.BOARD_PROJECT || cfg.project || null;
const AGENT_TOOL = flags.tool || process.env.BOARD_AGENT_TOOL || '';
const asJson = flags.json === true;

function die(msg, code = 1) {
  console.error(`✖ ${msg}`);
  process.exit(code);
}

function requireProject() {
  if (!PROJECT) {
    die(
      'No project set. Pass --project <name>, set BOARD_PROJECT, or add .board.json with {"project":"..."}.'
    );
  }
  return PROJECT;
}

async function req(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    die(`Cannot reach board at ${BASE} — is it running? (${err.message})`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data && data.error ? data.error : text || res.statusText;
    die(`API ${res.status}: ${msg}`);
  }
  return data;
}

function fileOrInline(flagName) {
  if (flags[`${flagName}-file`]) {
    const p = flags[`${flagName}-file`];
    if (!existsSync(p)) die(`File not found: ${p}`);
    return readFileSync(p, 'utf8');
  }
  if (typeof flags[flagName] === 'string') return flags[flagName];
  return null;
}

const PRIORITY_LABEL = { 1: 'high', 2: 'medium', 3: 'low' };

// ---- git helpers (used by `cleanup-branches`) -------------------------------
// Run git in the current working directory. Returns trimmed stdout, or throws
// with git's stderr attached so callers can decide what to do.
function git(...gitArgs) {
  try {
    return execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr).trim() : err.message;
    const e = new Error(stderr);
    e.gitArgs = gitArgs;
    throw e;
  }
}

// One short branch name per line → array (filtering out blanks).
function gitBranchNames(extraArgs) {
  return git('branch', ...extraArgs, '--format=%(refname:short)')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Pick the repo's default branch: --default flag wins, else prefer main/master
// if they exist, else fall back to the most reasonable guess.
function resolveDefaultBranch(all) {
  if (typeof flags.default === 'string') return flags.default;
  for (const name of ['main', 'master']) {
    if (all.includes(name)) return name;
  }
  return all.includes('master') ? 'master' : all[0];
}

// Best-effort board lookup so cleanup can annotate branches with their task's
// id + status. Never fatal: cleanup is a git operation and must work even when
// the board is down or `--no-board` is passed.
async function fetchTasksForCleanup() {
  if (flags['no-board'] || !PROJECT) return [];
  try {
    const params = new URLSearchParams({ includeArchived: 'true' });
    if (PROJECT) params.set('project', PROJECT);
    const res = await fetch(`${BASE}/api/tasks?${params}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

function printTask(task, { full = false } = {}) {
  if (asJson) {
    console.log(JSON.stringify(task, null, 2));
    return;
  }
  console.log(`#${task.id}  ${task.title}`);
  console.log(
    `  project: ${task.project}   status: ${task.status}   priority: ${
      PRIORITY_LABEL[task.priority] || task.priority
    }`
  );
  if (task.branch) console.log(`  branch: ${task.branch}`);
  if (task.session_title) console.log(`  session: ${task.session_title}`);
  if (task.session_id) console.log(`  session_id: ${task.session_id}`);
  if (task.time_cap_minutes)
    console.log(`  time cap: ${task.time_cap_minutes}m`);
  if (full) {
    console.log('\n--- description ---');
    console.log(task.description || '(none)');
    console.log('\n--- definition of done ---');
    console.log(task.definition_of_done || '(none)');
    if (task.answer) {
      console.log('\n--- answer ---');
      console.log(task.answer);
    }
  }
}

// ---- commands ---------------------------------------------------------------
async function main() {
  switch (cmd) {
    case 'projects': {
      const data = await req('GET', '/api/projects');
      if (asJson) return console.log(JSON.stringify(data, null, 2));
      if (!data.length) return console.log('(no projects yet)');
      for (const p of data) {
        console.log(
          `${p.project}  —  backlog:${p.backlog} in_progress:${p.in_progress} review:${p.pending_review} total:${p.total}`
        );
      }
      return;
    }

    case 'list': {
      const params = new URLSearchParams();
      if (PROJECT) params.set('project', PROJECT);
      if (flags.status) params.set('status', flags.status);
      if (flags.all) params.set('includeArchived', 'true');
      const data = await req('GET', `/api/tasks?${params}`);
      if (asJson) return console.log(JSON.stringify(data, null, 2));
      if (!data.length) return console.log('(no tasks)');
      for (const t of data) {
        console.log(
          `#${t.id}\t[${t.status}]\t(${PRIORITY_LABEL[t.priority] || t.priority})\t${t.title}`
        );
      }
      return;
    }

    case 'show': {
      const id = positional[0];
      if (!id) die('Usage: loop-board show <id>');
      const task = await req('GET', `/api/tasks/${id}`);
      printTask(task, { full: true });
      return;
    }

    case 'next': {
      // Claim the next backlog task for the project (atomic) and print it.
      const project = requireProject();
      const task = await req('POST', `/api/projects/${encodeURIComponent(project)}/claim`, {
        agent_tool: AGENT_TOOL,
      });
      if (!task) {
        if (asJson) console.log('null');
        else console.log(`No open tasks for project "${project}".`);
        process.exit(3); // distinct code so the skill can detect "nothing to do"
      }
      printTask(task, { full: true });
      return;
    }

    case 'create': {
      const project = requireProject();
      const title = flags.title || positional.join(' ');
      if (!title) die('Usage: loop-board create --title "..." [--project X]');
      const task = await req('POST', '/api/tasks', {
        title,
        project,
        description: fileOrInline('description') || '',
        definition_of_done: fileOrInline('dod') || '',
        priority: flags.priority ? Number(flags.priority) : 2,
        // Optional per-task execution cap (minutes); omit to use the board default.
        ...(flags.cap !== undefined
          ? { time_cap_minutes: Number(flags.cap) }
          : {}),
      });
      console.log(`Created task #${task.id}.`);
      if (asJson) printTask(task);
      return;
    }

    case 'claim': {
      const id = positional[0];
      if (!id) die('Usage: loop-board claim <id> [--branch b] [--session-title t]');
      const patch = { status: 'in_progress', claimed_at: new Date().toISOString() };
      if (flags.branch) patch.branch = flags.branch;
      if (flags['session-title']) patch.session_title = flags['session-title'];
      if (AGENT_TOOL) patch.agent_tool = AGENT_TOOL;
      const task = await req('PATCH', `/api/tasks/${id}`, patch);
      console.log(`Claimed task #${task.id} (in_progress).`);
      return;
    }

    case 'answer': {
      const id = positional[0];
      if (!id) die('Usage: loop-board answer <id> --answer-file ans.md [--branch b] [--session-title t]');
      const answer = fileOrInline('answer');
      if (!answer) die('Provide --answer-file <path> or --answer "<text>".');
      const body = {
        answer,
        status: flags.status || 'pending_review',
      };
      if (flags.branch) body.branch = flags.branch;
      if (flags['session-title']) body.session_title = flags['session-title'];
      if (flags['session-id']) body.session_id = flags['session-id'];
      if (AGENT_TOOL) body.agent_tool = AGENT_TOOL;
      const task = await req('POST', `/api/tasks/${id}/answer`, body);
      console.log(`Posted answer to #${task.id} → status: ${task.status}.`);
      return;
    }

    case 'comment': {
      const id = positional[0];
      if (!id) die('Usage: loop-board comment <id> --body "..." | --body-file f');
      const text = fileOrInline('body');
      if (!text) die('Provide --body "<text>" or --body-file <path>.');
      await req('POST', `/api/tasks/${id}/comment`, {
        body: text,
        author: AGENT_TOOL || 'agent',
      });
      console.log(`Added comment to #${id}.`);
      return;
    }

    case 'status': {
      const id = positional[0];
      const status = positional[1];
      if (!id || !status) die('Usage: loop-board status <id> <status>');
      const task = await req('POST', `/api/tasks/${id}/status`, {
        status,
        author: AGENT_TOOL || 'agent',
      });
      console.log(`#${task.id} → ${task.status}`);
      return;
    }

    case 'set-cap': {
      // Set (or clear) a task's per-task execution cap, in minutes. Works in any
      // column, so the cap can be tuned even while a task is in progress. Pass
      // "default", "none", or "0" (or omit) to clear it back to the board default.
      const id = positional[0];
      if (!id) die('Usage: loop-board set-cap <id> <minutes|default>');
      const raw = positional[1];
      const clear =
        raw === undefined || raw === 'default' || raw === 'none' || Number(raw) === 0;
      const cap = clear ? null : Number(raw);
      if (!clear && (!Number.isFinite(cap) || cap <= 0)) {
        die('Cap must be a positive number of minutes, or "default" to clear it.');
      }
      const task = await req('PATCH', `/api/tasks/${id}`, { time_cap_minutes: cap });
      console.log(
        task.time_cap_minutes
          ? `#${task.id} execution cap set to ${task.time_cap_minutes}m.`
          : `#${task.id} execution cap cleared (uses board default).`
      );
      return;
    }

    case 'cleanup-branches':
    case 'prune': {
      // Remove local branches whose work is already merged into the default
      // branch — i.e. branches for completed/merged tasks. We rely on git's own
      // `branch -d` (merged-only delete) as the safety net: an unmerged branch
      // is never deleted, even if its board task looks "done".
      let all;
      try {
        all = gitBranchNames([]);
      } catch (err) {
        die(`Not a git repository (or git failed): ${err.message}`);
      }
      const current = git('rev-parse', '--abbrev-ref', 'HEAD');
      const def = resolveDefaultBranch(all);
      if (!all.includes(def)) {
        die(`Default branch "${def}" not found. Pass --default <branch>.`);
      }
      const merged = new Set(gitBranchNames(['--merged', def]));

      // Annotate each branch with its board task, if any (best-effort).
      const tasks = await fetchTasksForCleanup();
      const byBranch = new Map();
      for (const t of tasks) {
        if (t.branch) byBranch.set(t.branch, t);
        const m = /^task\/(\d+)-/.exec(t.branch || '');
        if (m) byBranch.set(`__id_${m[1]}`, t);
      }
      const taskFor = (branch) => {
        if (byBranch.has(branch)) return byBranch.get(branch);
        const m = /^task\/(\d+)-/.exec(branch);
        return m && byBranch.has(`__id_${m[1]}`) ? byBranch.get(`__id_${m[1]}`) : null;
      };
      const annotate = (branch) => {
        const t = taskFor(branch);
        return t ? `task #${t.id}, ${t.status}` : 'no board task';
      };

      // Candidates: merged, and neither the default nor the current branch.
      const candidates = all.filter((b) => b !== def && b !== current && merged.has(b));
      const protectedKept = all.filter((b) => b === def || b === current);
      const unmergedKept = all.filter((b) => b !== def && b !== current && !merged.has(b));

      const apply = flags.apply === true || flags.yes === true;
      const deleted = [];
      const failed = [];
      if (apply) {
        for (const b of candidates) {
          try {
            git('branch', '-d', b);
            deleted.push(b);
          } catch (err) {
            failed.push({ branch: b, error: err.message });
          }
        }
      }

      if (asJson) {
        console.log(
          JSON.stringify(
            {
              default: def,
              current,
              applied: apply,
              candidates: candidates.map((b) => ({ branch: b, task: taskFor(b) || null })),
              deleted,
              failed,
              remaining: all
                .filter((b) => !deleted.includes(b))
                .map((b) => ({
                  branch: b,
                  task: taskFor(b) || null,
                  isDefault: b === def,
                  isCurrent: b === current,
                  merged: merged.has(b),
                })),
            },
            null,
            2
          )
        );
        return;
      }

      console.log(`Default branch: ${def}   Current: ${current}\n`);

      if (!candidates.length) {
        console.log('No merged branches to clean up. ✔\n');
      } else {
        console.log(
          apply
            ? `Deleted ${deleted.length} merged branch(es):`
            : `Merged branches eligible for cleanup (${candidates.length}):`
        );
        for (const b of candidates) {
          const status = apply && failed.find((f) => f.branch === b) ? ' — FAILED' : '';
          console.log(`  ${b}  (${annotate(b)})${status}`);
        }
        if (failed.length) {
          console.log('\nSome deletions failed:');
          for (const f of failed) console.log(`  ${f.branch}: ${f.error}`);
        }
        if (!apply) {
          console.log('\nDry run — nothing deleted. Re-run with --apply to delete them.');
        }
        console.log('');
      }

      // Always show what's (still) there, so the human can eyeball the result.
      const remaining = all.filter((b) => !deleted.includes(b));
      console.log('Remaining branches:');
      for (const b of remaining) {
        const marks = [];
        if (b === current) marks.push('current');
        if (b === def) marks.push('default');
        if (b !== def && b !== current && !merged.has(b)) marks.push('not merged — kept');
        const suffix = marks.length ? `  [${marks.join(', ')}]` : '';
        console.log(`  ${b}  (${annotate(b)})${suffix}`);
      }
      return;
    }

    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;

    default:
      die(`Unknown command: ${cmd}\nRun "loop-board help" for usage.`);
  }
}

function printHelp() {
  console.log(`loop-board — local task board CLI

Config: --url / BOARD_URL / .board.json:boardUrl   (default http://localhost:5151)
        --project / BOARD_PROJECT / .board.json:project

Commands:
  projects                          List projects and their open counts
  list [--status S] [--all]         List tasks (for --project), optionally by status
  show <id>                         Show a task in full (description, DoD, answer)
  next                              Atomically claim the next backlog task for the project
  create --title "..."              Create a task
        [--description ... | --description-file f]
        [--dod ... | --dod-file f] [--priority 1|2|3]
        [--cap <minutes>]           per-task execution cap (default: board setting)
  claim <id> [--branch b]           Mark a task in_progress (set branch/session)
        [--session-title t]
  answer <id> --answer-file f       Post the agent's answer + metadata; moves to
        [--branch b] [--session-title t]   pending_review (override with --status)
        [--status pending_review]
  comment <id> --body "..."         Add a comment/event
  status <id> <status>              Move a task (backlog|in_progress|pending_review|done|archived)
  set-cap <id> <minutes|default>    Set/clear a task's execution cap (minutes); works in any column
  cleanup-branches [--apply]        Delete local branches already merged into the default
        [--default <branch>]        branch (i.e. completed/merged tasks); dry-run unless
        [--no-board]                --apply. Always prints the remaining branches. Annotates
                                    each branch with its board task unless --no-board.

Add --json to most commands for machine-readable output.
Add --tool <name> (or BOARD_AGENT_TOOL) to record which agent acted.`);
}

main();
