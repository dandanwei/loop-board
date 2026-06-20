---
name: run-board-orchestrator
description: Coordinate multi-project work from the Loop Board. For each configured project that has backlog tasks, claim the highest-priority one, dispatch it to a project-specific Claude Code sub-session (via the work-board-task skill), wait for completion, and collect the result. Use when the user says "run the board orchestrator", "orchestrate the board", "dispatch board tasks", or "work all projects".
---

# run-board-orchestrator — coordinate multi-project task execution

You run from the **loop-board repo** and dispatch tasks to **other projects'**
Claude Code sessions, one task at a time, then collect results.

## 0. Preconditions & setup

- The board server must be running (`npm start` / `npm run dev`) on its URL
  (default `http://localhost:5151`). Check: `curl -s $BOARD_URL/api/health`.
- You are running inside the loop-board repo, so resolve the CLI and URL once:

  ```bash
  LOOP_BOARD="$(pwd)"                 # loop-board repo root
  BOARD="node $LOOP_BOARD/cli/board.js"
  BOARD_URL="http://localhost:5151"
  ```

- `loop-board` is generally **not** on PATH; always invoke it as `$BOARD`.
- Process **one task at a time** (sequential) to avoid resource conflicts.
- **The `work-board-task` skill must be visible to sub-sessions.** A sub-session
  runs in another repo, so it only finds the skill if it's installed at user
  level (`~/.claude/skills/work-board-task/`) or copied into that project's
  `.claude/skills/`. If neither is present, inline the work-board-task steps into
  the `-p` prompt instead of naming the skill.

## 1. Fetch project configs

```bash
curl -s $BOARD_URL/api/projects-config
```

Each entry is `{ project, path, created_at, updated_at }`. Only configured
projects are eligible — a project needs a path mapping (set in the UI under
⚙ Configure) so you know where to `cd`. If the list is empty, tell the user to
configure at least one project and stop.

## 2. For each configured project, check for backlog work

```bash
$BOARD list --project <label> --status backlog --json
```

Skip projects with no backlog tasks. For a project that has them, verify its
path before dispatching:

```bash
curl -s -X POST $BOARD_URL/api/test-path \
  -H 'content-type: application/json' \
  -d "{\"path\":\"<project_path>\"}"
```

If `exists` is false or `isDirectory` is false, skip the project and warn the
user — do not try to `cd` into a bad path.

## 3. Claim the task and assign a session id

Claim atomically so the id and details are known up front:

```bash
$BOARD next --project <label> --json     # flips highest-priority backlog → in_progress
```

(Exit code 3 = nothing to claim; move to the next project.) Note the task `id`
and build a slug from its title.

Generate the session id **yourself** so resume works immediately and you don't
have to scrape it from output later:

```bash
SESSION_ID="$(uuidgen | tr 'A-Z' 'a-z')"
```

Record it on the task now (so the board's Resume button works even mid-run):

```bash
curl -s -X PATCH $BOARD_URL/api/tasks/<id> \
  -H 'content-type: application/json' \
  -d "{\"session_id\":\"$SESSION_ID\",\"session_title\":\"task-<id>\",\"agent_tool\":\"claude-code\"}"
```

## 4. Dispatch a project sub-session

Run the sub-session **in the project directory**, with the fixed session id and
a human-friendly display name. Pass the task id and CLI path **in the prompt**
(the sub-session must not have to parse its own session name):

```bash
cd "<project_path>"
claude \
  --session-id "$SESSION_ID" \
  -n "task-<id>-<slug>" \
  --permission-mode acceptEdits \
  --output-format json \
  -p "Use the work-board-task skill to complete board task #<id> for project <label>. The loop-board CLI is at $LOOP_BOARD/cli/board.js and the board URL is $BOARD_URL."
```

**Run this with the Bash tool in the background** (`run_in_background: true`) and
tee its output to a log file, e.g. `/tmp/loop-subsession-<id>.json`, so you can
poll while it works. Return to `$LOOP_BOARD` afterward.

> **Permissions.** `--permission-mode acceptEdits` auto-accepts file edits but
> may still block some shell commands in print mode. For a fully unattended run
> the sub-session typically needs broader permissions
> (`--dangerously-skip-permissions`). Only use that against a **trusted task
> queue / sandbox** — it removes the sub-session's safety prompts. Default to
> `acceptEdits` and let the user opt into bypass explicitly.

## 5. Wait for completion

**Primary signal — board status.** Poll every ~30s:

```bash
$BOARD show <id> --json     # look at .status
```

The task is done when status is `pending_review` (success) or `done`. As soon as
you see that, stop polling and collect the result.

**Hang detection — session-log mtime (best effort, macOS).** The session log
lives at:

```bash
ENC="$(printf '%s' "<project_path>" | sed 's#/#-#g')"   # /a/b → -a-b
LOG="$HOME/.claude/projects/$ENC/$SESSION_ID.jsonl"
if [ -f "$LOG" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$LOG") ))         # macOS stat (BSD)
  # AGE > 600  → 10 min with no log activity = likely stuck
fi
```

(Note: `stat -f %m` is the macOS/BSD form; Linux uses `stat -c %Y`.) Treat this
as a heuristic — if the log path can't be found, rely on the overall cap below.

**Hard cap.** Regardless of the above, stop waiting after **30 minutes** of
wall-clock for a single task.

## 6. On completion vs timeout

- **Success** (`pending_review`/`done`): read the answer with
  `$BOARD show <id>` and report it (see step 7). Also note the background
  sub-session's JSON output (`/tmp/loop-subsession-<id>.json`) for its summary.
- **Timeout / hang** (cap hit or 10-min inactivity): the sub-session didn't
  finish. Document it and release the task for retry:

  ```bash
  $BOARD comment <id> --body "Orchestrator timeout: no completion within the cap. Session id $SESSION_ID."
  $BOARD status <id> backlog
  ```

  Do **not** immediately re-claim it this run — move on and surface it to the
  user. (There is no `failed` status; returning it to backlog lets a human or a
  later run retry it.)

## 7. Report and continue

After each task, report concisely to the user: project, task id, final status,
branch, session id (for resume), and a one-line summary of the answer. Then
continue to the next configured project. When every configured project has been
checked, print a short roll-up (tasks dispatched, completed, timed out) and stop.

## Quick reference

```bash
LOOP_BOARD="$(pwd)"; BOARD="node $LOOP_BOARD/cli/board.js"; BOARD_URL="http://localhost:5151"
curl -s $BOARD_URL/api/projects-config                 # configured projects
$BOARD list --project <p> --status backlog --json      # backlog for a project
$BOARD next --project <p> --json                        # claim highest-priority backlog
$BOARD show <id> --json                                 # poll status / read answer
$BOARD status <id> backlog                               # release on timeout
```
