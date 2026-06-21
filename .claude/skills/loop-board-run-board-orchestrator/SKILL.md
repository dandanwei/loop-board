---
name: loop-board-run-board-orchestrator
description: Coordinate multi-project work from the Loop Board. For each configured project that has backlog tasks, claim its highest-priority one and dispatch it to a project-specific Claude Code sub-session (via the loop-board-work-board-task skill). Tasks for different projects run concurrently — one task per project. Use when the user says "run the board orchestrator", "orchestrate the board", "dispatch board tasks", or "work all projects".
---

# loop-board-run-board-orchestrator — coordinate multi-project task execution

You run from the **loop-board repo** and dispatch tasks to **other projects'**
Claude Code sessions, then collect results.

## Concurrency model — one task per project, projects run concurrently

- **One task per project per run.** For each configured project you claim its
  single highest-priority backlog task — never more than one task from the same
  project at a time. (A project is a single git repo; running two sub-sessions
  in the same working tree would clobber each other. In-project concurrency
  would need git worktrees, which this skill does not do.)
- **Different projects run concurrently.** Each project's task runs in its own
  repo, so there is no shared working tree between them. Launch every project's
  sub-session in the **background** without waiting, then watch them all finish
  together. With N configured projects that have backlog work, you end up with up
  to N sub-sessions running at once.

The flow is therefore two passes: a **launch pass** (§2 — claim + dispatch one
task per project, back to back, without blocking) and a **wait pass** (§3 — poll
every in-flight task together until each completes or times out).

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
- **The `loop-board-work-board-task` skill must be visible to sub-sessions.** A
  sub-session runs in another repo, so it only finds the skill if it's installed
  at user level (`~/.claude/skills/loop-board-work-board-task/`) or copied into
  that project's `.claude/skills/`. If neither is present, inline the
  loop-board-work-board-task steps into the `-p` prompt instead of naming the skill.

## 1. Fetch project configs

```bash
curl -s $BOARD_URL/api/projects-config
```

Each entry is `{ project, path, created_at, updated_at }`. Only configured
projects are eligible — a project needs a path mapping (set in the UI under
⚙ Configure) so you know where to `cd`. If the list is empty, tell the user to
configure at least one project and stop.

## 2. Launch pass — claim one task per project and dispatch it (don't wait)

Keep a running list of **active dispatches** as you go — record
`{ project, id, session_id, path, log, started_at }` for each one you launch.
You'll watch them all together in §3.

Iterate the configured projects. For **each** project, do the following and then
**immediately move to the next project** — do *not* wait for the sub-session to
finish:

### 2a. Check for backlog work

```bash
$BOARD list --project <label> --status backlog --json
```

Skip projects with no backlog tasks.

### 2b. Verify the project path

```bash
curl -s -X POST $BOARD_URL/api/test-path \
  -H 'content-type: application/json' \
  -d "{\"path\":\"<project_path>\"}"
```

If `exists` is false or `isDirectory` is false, skip the project and warn the
user — do not try to `cd` into a bad path.

### 2c. Claim exactly one task and assign a session id

Claim atomically so the id and details are known up front:

```bash
$BOARD next --project <label> --json     # flips highest-priority backlog → in_progress
```

(Exit code 3 = nothing to claim; move to the next project.) This claims **one**
task — the highest priority — and that is the only task you take from this
project this run. Note the task `id` and build a slug from its title.

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

### 2d. Dispatch the project sub-session in the background

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
  -p "Use the loop-board-work-board-task skill to complete board task #<id> for project <label>. The loop-board CLI is at $LOOP_BOARD/cli/board.js and the board URL is $BOARD_URL."
```

**Run this with the Bash tool in the background** (`run_in_background: true`) and
tee its output to a per-task log file, e.g. `/tmp/loop-subsession-<id>.json`, so
you can poll it later. **Do not block on it** — append it to your active list and
go straight back to step 2a for the next project. Return to `$LOOP_BOARD`
(`cd "$LOOP_BOARD"`) before the next claim so CLI paths resolve.

Because each launch is backgrounded and you don't wait between projects, the
sub-sessions run **concurrently** — one per project.

> **Permissions.** `--permission-mode acceptEdits` auto-accepts file edits but
> may still block some shell commands in print mode. For a fully unattended run
> the sub-session typically needs broader permissions
> (`--dangerously-skip-permissions`). Only use that against a **trusted task
> queue / sandbox** — it removes the sub-session's safety prompts. Default to
> `acceptEdits` and let the user opt into bypass explicitly.

## 3. Wait pass — watch all in-flight tasks together

Once the launch pass is done, you have up to one running sub-session per project.
Now poll them **all together** (not one-at-a-time) until each is resolved.

**Primary signal — board status.** Every ~30s, check the status of every task
still in flight:

```bash
$BOARD show <id> --json     # look at .status, for each active id
```

A task is finished when its status is `pending_review` (success) or `done`. As
soon as a task reaches that, mark it complete in your active list and stop
polling *that* task — but keep polling the rest until every active task is
resolved.

**Hang detection — session-log mtime (best effort, macOS).** Per task, the
session log lives at:

```bash
ENC="$(printf '%s' "<project_path>" | sed 's#/#-#g')"   # /a/b → -a-b
LOG="$HOME/.claude/projects/$ENC/$SESSION_ID.jsonl"
if [ -f "$LOG" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$LOG") ))         # macOS stat (BSD)
  # AGE > 600  → 10 min with no log activity = likely stuck
fi
```

(Note: `stat -f %m` is the macOS/BSD form; Linux uses `stat -c %Y`.) Treat this
as a heuristic — if the log path can't be found, rely on the cap below.

**Hard cap (configurable, per task).** Stop waiting on any single task once it
has run for its cap's worth of wall-clock since *its own* launch (`started_at`).
The cap is **per task and configurable**:

- Each task carries an optional `time_cap_minutes` (set at creation, or edited
  any time — including while it's in progress — via the UI/`set-cap`). Read it
  from `$BOARD show <id> --json`.
- When a task leaves it unset (`null`), fall back to the board-wide default
  `default_time_cap_minutes` from `curl -s $BOARD_URL/api/settings` (30 if
  unset).

So the effective cap is `task.time_cap_minutes ?? settings.default_time_cap_minutes`.
Re-read the task's cap on each poll so a mid-flight bump takes effect. One slow
task must not hold up reporting the others — resolve each independently as it
finishes or times out.

## 4. Resolve each task — completion vs timeout

Handle each active task on its own as it settles:

- **Success** (`pending_review`/`done`): read the answer with
  `$BOARD show <id>` and report it (see §5). Also note the background
  sub-session's JSON output (`/tmp/loop-subsession-<id>.json`) for its summary.
- **Timeout / hang** (cap hit or 10-min inactivity): the sub-session didn't
  finish. Document it and release the task for retry:

  ```bash
  $BOARD comment <id> --body "Orchestrator timeout: no completion within the cap. Session id $SESSION_ID."
  $BOARD status <id> backlog
  ```

  Do **not** immediately re-claim it this run — surface it to the user. (There is
  no `failed` status; returning it to backlog lets a human or a later run retry.)

## 5. Report roll-up

When every active task has been resolved (completed or timed out), print a short
roll-up to the user. Per task: project, task id, final status, branch, session id
(for resume), and a one-line summary of the answer. Then a totals line: projects
checked, tasks dispatched, completed, timed out. Then stop.

## Quick reference

```bash
LOOP_BOARD="$(pwd)"; BOARD="node $LOOP_BOARD/cli/board.js"; BOARD_URL="http://localhost:5151"
curl -s $BOARD_URL/api/projects-config                 # configured projects
curl -s $BOARD_URL/api/settings                        # default_time_cap_minutes (fallback cap)
$BOARD list --project <p> --status backlog --json      # backlog for a project
$BOARD next --project <p> --json                        # claim ONE (highest-priority) backlog task
$BOARD show <id> --json                                 # poll status / read answer + .time_cap_minutes
$BOARD set-cap <id> <minutes|default>                    # set/clear a task's execution cap
$BOARD status <id> backlog                               # release on timeout
```
