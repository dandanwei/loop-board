#!/usr/bin/env node
// loop-board CLI — a thin, dependency-free client for the local board API.
// Used by the `take-task` skill so agents don't have to hand-craft curl/JSON.
//
// Config resolution (highest priority first):
//   --url / --project flags
//   BOARD_URL / BOARD_PROJECT env vars
//   ./.board.json   ({ "project": "...", "boardUrl": "..." })
//   default: http://localhost:5151
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
  claim <id> [--branch b]           Mark a task in_progress (set branch/session)
        [--session-title t]
  answer <id> --answer-file f       Post the agent's answer + metadata; moves to
        [--branch b] [--session-title t]   pending_review (override with --status)
        [--status pending_review]
  comment <id> --body "..."         Add a comment/event
  status <id> <status>              Move a task (backlog|in_progress|pending_review|done|archived)

Add --json to most commands for machine-readable output.
Add --tool <name> (or BOARD_AGENT_TOOL) to record which agent acted.`);
}

main();
