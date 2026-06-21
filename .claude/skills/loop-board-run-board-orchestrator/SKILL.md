---
name: loop-board-run-board-orchestrator
description: Coordinate multi-project work from the Loop Board. For each configured project, dispatch a Claude Code sub-session that FIRST merges every reviewed branch waiting in the ready_to_merge column, THEN claims and implements its highest-priority backlog task (via the loop-board-take-task skill). Merges always take priority over taking new work. Projects run concurrently — one sub-session per project. Use when the user says "run the board orchestrator", "orchestrate the board", "dispatch board tasks", or "work all projects".
---

# loop-board-run-board-orchestrator — coordinate multi-project task execution

You run from the **loop-board repo** and dispatch work to **other projects'**
Claude Code sessions, then collect results.

Each project's sub-session runs the **full everyday cycle** for that project —
the `loop-board-take-task` skill — which works **two queues in a fixed order**:

1. **Merge first.** Merge every reviewed branch in the project's
   `ready_to_merge` column into its default branch.
2. **Then take new work.** Claim the project's highest-priority `backlog` task
   and implement it.

So the orchestrator pulls from **both** the `ready_to_merge` and `backlog`
queues, and **merges always take priority over taking new backlog work** —
because that ordering is baked into the cycle each sub-session runs.

## Concurrency model — one sub-session per project, projects run concurrently

- **One sub-session per project per run.** Each project is a single git repo;
  its sub-session does all of that project's work for this run — clearing the
  `ready_to_merge` column, then taking **one** backlog task. You never launch a
  second sub-session for the same project, because two sessions in the same
  working tree (merging *and* implementing) would clobber each other.
  (In-project concurrency would need git worktrees, which this skill does not
  do.) Note the asymmetry: a sub-session may merge **several** ready branches
  but takes **at most one** new backlog task.
- **Different projects run concurrently.** Each project's sub-session works in
  its own repo, so there is no shared working tree between them. Launch every
  project's sub-session in the **background** without waiting, then watch them
  all finish together. With N configured projects that have work (a merge queue
  and/or a backlog), you end up with up to N sub-sessions running at once.

The flow is therefore two passes: a **launch pass** (§2 — dispatch one
merge-then-take sub-session per project that has work, back to back, without
blocking) and a **wait pass** (§3 — poll every in-flight sub-session together
until each completes or times out).

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
- **The `loop-board-take-task` skill must be visible to sub-sessions.** A
  sub-session runs in another repo, so it only finds the skill if it's installed
  at user level (`~/.claude/skills/loop-board-take-task/`) or copied into that
  project's `.claude/skills/`. (Installing it at user level is the simplest way
  to make it visible to every project.) If it is not present, inline the
  loop-board-take-task steps — merge `ready_to_merge` first, then claim and
  implement one backlog task — into the `-p` prompt instead of naming the skill.

## 1. Fetch project configs

```bash
curl -s $BOARD_URL/api/projects-config
```

Each entry is `{ project, path, created_at, updated_at }`. Only configured
projects are eligible — a project needs a path mapping (set in the UI under
⚙ Configure) so you know where to `cd`. If the list is empty, tell the user to
configure at least one project and stop.

## 2. Launch pass — dispatch one merge-then-take sub-session per project (don't wait)

Keep a running list of **active dispatches** as you go — record
`{ project, path, session_id, log, started_at }` for each one you launch (plus
the ids you saw in its `ready_to_merge` and `backlog` queues, so you can report
what it should have worked). You'll watch them all together in §3.

Iterate the configured projects. For **each** project, do the following and then
**immediately move to the next project** — do *not* wait for the sub-session to
finish:

### 2a. Check for work in either queue

A project has work for this run if **either** queue is non-empty:

```bash
$BOARD list --project <label> --status ready_to_merge --json   # merge queue
$BOARD list --project <label> --status backlog --json          # backlog queue
```

Skip a project only if **both** are empty. If `ready_to_merge` has tasks, this
run will merge them (priority); if `backlog` has tasks, it will also take one.

### 2b. Verify the project path

```bash
curl -s -X POST $BOARD_URL/api/test-path \
  -H 'content-type: application/json' \
  -d "{\"path\":\"<project_path>\"}"
```

If `exists` is false or `isDirectory` is false, skip the project and warn the
user — do not try to `cd` into a bad path.

### 2c. Assign a session id (do NOT pre-claim)

Do **not** claim a task here. The sub-session decides what to do — it merges the
`ready_to_merge` branches first, then claims its own backlog task via
`loop-board next`. If you pre-claimed a backlog task (flipping it to
`in_progress`), the sub-session's `next` call would skip it and the task could
be lost between queues.

Generate the session id **yourself** so the run is resumable and deterministic:

```bash
SESSION_ID="$(uuidgen | tr 'A-Z' 'a-z')"
```

You launch the sub-session with this id below, and the `loop-board-take-task`
skill records it on the task it takes (via `loop-board answer --session-id`), so
the board's Resume button works once the sub-session posts its result.

### 2d. Dispatch the project sub-session in the background

Run the sub-session **in the project directory**, with the fixed session id and
a human-friendly display name. Pass the project label and CLI path **in the
prompt** so the sub-session doesn't have to infer them:

```bash
cd "<project_path>"
claude \
  --session-id "$SESSION_ID" \
  -n "orchestrate-<label>" \
  --permission-mode acceptEdits \
  --output-format json \
  -p "Use the loop-board-take-task skill to run a full cycle for project <label>: FIRST merge every branch in the ready_to_merge column into the default branch, THEN claim and implement the next backlog task. Merges take priority. The loop-board CLI is at $LOOP_BOARD/cli/board.js and the board URL is $BOARD_URL."
```

**Run this with the Bash tool in the background** (`run_in_background: true`) and
tee its output to a per-project log file, e.g.
`/tmp/loop-subsession-<label>.json`, so you can poll it later. **Do not block on
it** — append it to your active list and go straight back to step 2a for the
next project. Return to `$LOOP_BOARD` (`cd "$LOOP_BOARD"`) before the next
project so CLI paths resolve.

Because each launch is backgrounded and you don't wait between projects, the
sub-sessions run **concurrently** — one per project.

> **Permissions.** `--permission-mode acceptEdits` auto-accepts file edits but
> may still block some shell commands in print mode. For a fully unattended run
> the sub-session typically needs broader permissions
> (`--dangerously-skip-permissions`), and merges in particular need to run git
> commands. Only use bypass against a **trusted task queue / sandbox** — it
> removes the sub-session's safety prompts. Default to `acceptEdits` and let the
> user opt into bypass explicitly.

## 3. Wait pass — watch all in-flight sub-sessions together

Once the launch pass is done, you have up to one running sub-session per project.
Now poll them **all together** (not one-at-a-time) until each is resolved.

**Primary signal — the sub-session process.** Each sub-session is a backgrounded
`claude -p` run; it exits when the cycle (merges + one task) is done. The
harness notifies you when a background command finishes, and its JSON output
lands in `/tmp/loop-subsession-<label>.json`. That exit is the authoritative
"this project is done" signal.

**Corroborating signal — board state.** While waiting, you can confirm progress
on the board:

```bash
$BOARD list --project <label> --status ready_to_merge --json   # should drain toward empty
$BOARD list --project <label> --status pending_review --json   # the taken task lands here
$BOARD list --project <label> --status done --json             # merged tasks land here
```

A project is finished when its sub-session process exits cleanly: the
`ready_to_merge` branches it found should now be `done`, and the backlog task it
took should be `pending_review`. As soon as a project resolves, mark it complete
in your active list and stop polling it — but keep watching the rest until every
active sub-session is resolved.

**Hang detection — session-log mtime (best effort, macOS).** Per project, the
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

**Hard cap.** Stop waiting on any single sub-session after **30 minutes** of
wall-clock since *its own* launch (`started_at`). One slow project must not hold
up reporting the others — resolve each independently as it finishes or times
out.

## 4. Resolve each project — completion vs timeout

Handle each active sub-session on its own as it settles:

- **Success** (process exited cleanly): read what it accomplished from the
  board — the `ready_to_merge` ids it found are now `done` (merges), and the
  backlog task it took is now `pending_review` (read its answer with
  `$BOARD show <id>`). Also note the background sub-session's JSON output
  (`/tmp/loop-subsession-<label>.json`) for its own summary, including any merge
  conflicts it bounced back to `pending_review`.
- **Timeout / hang** (cap hit or 10-min inactivity): the sub-session didn't
  finish. Document it and surface it to the user. Any backlog task it had
  already claimed will be stuck in `in_progress`; release it for retry:

  ```bash
  # for each task left in_progress by the hung sub-session:
  $BOARD comment <id> --body "Orchestrator timeout: sub-session for <label> didn't finish within the cap. Session id $SESSION_ID."
  $BOARD status <id> backlog
  ```

  Leave any partially-merged state to the user — don't try to unwind git from
  here. Do **not** immediately re-dispatch this run; surface it instead. (There
  is no `failed` status; returning a claimed task to backlog lets a human or a
  later run retry.)

## 5. Report roll-up

When every active sub-session has been resolved (completed or timed out), print
a short roll-up to the user. Per project:

- **Merges:** which `ready_to_merge` task ids were merged to `done` (and any
  bounced back on conflict).
- **Task taken:** the backlog task id, its branch, final status
  (`pending_review`), and a one-line summary of the answer.
- **Session id** (for resume) and the project's final status (done / timed out).

Then a totals line: projects checked, sub-sessions dispatched, branches merged,
tasks taken, timed out. Then stop.

## Quick reference

```bash
LOOP_BOARD="$(pwd)"; BOARD="node $LOOP_BOARD/cli/board.js"; BOARD_URL="http://localhost:5151"
curl -s $BOARD_URL/api/projects-config                       # configured projects
$BOARD list --project <p> --status ready_to_merge --json     # merge queue (worked first)
$BOARD list --project <p> --status backlog --json            # backlog queue (one task taken)
$BOARD list --project <p> --status pending_review --json     # where the taken task lands
$BOARD list --project <p> --status done --json               # where merged tasks land
$BOARD show <id> --json                                       # read a task / its answer
$BOARD status <id> backlog                                    # release a stuck claim on timeout
```
