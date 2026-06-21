---
name: loop-board-run-board-orchestrator
description: Coordinate multi-project work from the Loop Board. For each configured project, repeatedly dispatch a Claude Code sub-session that FIRST merges every reviewed branch in the ready_to_merge column, THEN claims and implements one backlog task (via the loop-board-take-task skill) — looping until that project has no merges and no backlog left. Merges always take priority over taking new work. Projects drain concurrently — one sub-session per project at a time. Use when the user says "run the board orchestrator", "orchestrate the board", "dispatch board tasks", or "work all projects".
---

# loop-board-run-board-orchestrator — coordinate multi-project task execution

You run from the **loop-board repo** and dispatch work to **other projects'**
Claude Code sessions, then collect results. Your job is to **drain every
configured project's board** — clear its merge queue and work through its whole
backlog — running projects concurrently.

The unit of work you dispatch is one **merge-then-take cycle**, the
`loop-board-take-task` skill, which works **two queues in a fixed order**:

1. **Merge first.** Merge every reviewed branch in the project's
   `ready_to_merge` column into its default branch.
2. **Then take one task.** Claim the project's highest-priority `backlog` task,
   implement it on a fresh branch, and post it to Pending Review.

One cycle drains the *whole* merge queue but takes only *one* backlog task. To
drain the backlog you **repeat the cycle** for that project until nothing is
left (see the drain loop below). Because merging is step 1 of every cycle,
**merges always take priority over taking new backlog work.**

## Concurrency model — per-project drain loop, projects run concurrently

- **Each project runs a drain loop.** Repeat the merge-then-take cycle for a
  project until **both** its `ready_to_merge` and `backlog` queues are empty
  (or a safety limit trips, below). Each cycle is a **fresh sub-session with its
  own session id**, so every taken task lands on its own branch and its own
  resumable session — exactly what the board's Resume button expects. The first
  cycle clears the merge queue and takes the first backlog task; later cycles
  almost always just take the next backlog task (the merge queue is already
  empty, so step 1 is a quick no-op unless a human approves more mid-run).
- **One sub-session per project at a time.** A project is a single git repo;
  two sub-sessions in the same working tree (merging *and* implementing) would
  clobber each other, so a project's cycles run **strictly sequentially** — wait
  for one cycle's sub-session to finish before launching the next for the same
  project. (In-project concurrency would need git worktrees, which this skill
  does not do.)
- **Different projects drain concurrently.** Each project works in its own repo,
  so there is no shared working tree between them. Run every project's drain
  loop at the same time: launch the first cycle for all projects in the
  background, and whenever one finishes, immediately launch that project's next
  cycle (if it still has work). With N projects that have work, up to N
  sub-sessions run at once — one per project.

So the shape is: **N concurrent per-project drain loops**, each looping
merge-then-take until its project's board is empty, with at most one live
sub-session per project.

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

## 2. Launch pass — start each project's drain loop (don't wait)

Keep a running list of **active projects** as you go. For each, track
`{ project, path, current_session_id, log, cycle_count, started_at, last_backlog_count, merged_ids, taken: [] }`.
You'll advance them all together in §3.

Iterate the configured projects. For **each** project, do the following and then
**immediately move to the next project** — do *not* wait for the sub-session to
finish:

### 2a. Check for work in either queue

A project needs draining if **either** queue is non-empty:

```bash
$BOARD list --project <label> --status ready_to_merge --json   # merge queue
$BOARD list --project <label> --status backlog --json          # backlog queue
```

Skip a project only if **both** are empty. Record the current `backlog` count as
`last_backlog_count` and the `ready_to_merge` ids as `merged_ids` (expected) so
you can detect progress and report later.

### 2b. Verify the project path

```bash
curl -s -X POST $BOARD_URL/api/test-path \
  -H 'content-type: application/json' \
  -d "{\"path\":\"<project_path>\"}"
```

If `exists` is false or `isDirectory` is false, skip the project and warn the
user — do not try to `cd` into a bad path.

### 2c. Launch the project's first cycle

Use the helper below (§2d) to dispatch one merge-then-take cycle in the
background, then move on to the next project. Do **not** pre-claim a backlog task
in the orchestrator — the sub-session claims its own via `loop-board next`; a
pre-claim would flip the task to `in_progress` and hide it from that call.

### 2d. Dispatch-a-cycle helper (used for every cycle, here and in §3)

Each cycle is a fresh sub-session with its **own** session id (so every task
gets its own branch + resumable session):

```bash
SESSION_ID="$(uuidgen | tr 'A-Z' 'a-z')"          # NEW id per cycle
cd "<project_path>"
claude \
  --session-id "$SESSION_ID" \
  -n "orchestrate-<label>-<cycle_count>" \
  --permission-mode acceptEdits \
  --output-format json \
  -p "Use the loop-board-take-task skill to run ONE cycle for project <label>: FIRST merge every branch in the ready_to_merge column into the default branch, THEN claim and implement exactly ONE backlog task. Merges take priority. The loop-board CLI is at $LOOP_BOARD/cli/board.js and the board URL is $BOARD_URL."
cd "$LOOP_BOARD"                                   # back home so CLI paths resolve
```

**Run this with the Bash tool in the background** (`run_in_background: true`),
teeing output to a per-cycle log, e.g.
`/tmp/loop-subsession-<label>-<cycle_count>.json`. **Do not block on it** —
record `current_session_id` and `started_at`, bump `cycle_count`, and continue.

> **Permissions.** `--permission-mode acceptEdits` auto-accepts file edits but
> may still block some shell commands in print mode. For a fully unattended drain
> the sub-session needs to run git commands (the merges) and other shell steps,
> so it typically needs broader permissions (`--dangerously-skip-permissions`).
> Only use bypass against a **trusted task queue / sandbox** — it removes the
> sub-session's safety prompts. Default to `acceptEdits` and let the user opt
> into bypass explicitly.

## 3. Drain pass — advance every project until its board is empty

Now run all the per-project drain loops concurrently. Poll the in-flight
sub-sessions **together** (not one at a time). When a project's current cycle
finishes, decide whether to launch its **next** cycle or mark it drained.

**Cycle-finished signal.** Each cycle is a backgrounded `claude -p` that exits
when its merge-then-take is done; the harness notifies you and its JSON output
lands in `/tmp/loop-subsession-<label>-<cycle_count>.json`. That exit is the
authoritative "this cycle is done" signal.

**When a cycle finishes, for that project:**

1. **Record what it did.** The `ready_to_merge` ids it found are now `done` (add
   to `merged_ids` actually merged); the backlog task it took is now
   `pending_review` — read it with `$BOARD show <id> --json` and append to
   `taken`. Note any merge conflicts the sub-session bounced back (still
   `pending_review` with a conflict comment).
2. **Re-check the project's queues:**

   ```bash
   $BOARD list --project <label> --status ready_to_merge --json
   $BOARD list --project <label> --status backlog --json
   ```

3. **Decide:**
   - **Both empty → project drained.** Mark it complete; stop looping it.
   - **Work remains AND the loop is making progress → launch the next cycle.**
     Use the §2d helper again (new session id, `cycle_count+1`), in the
     background. Update `last_backlog_count`.
   - **Work remains but NO progress → stop and surface it.** See the guard below.

**No-progress guard (prevents infinite loops).** Before re-launching, confirm
the last cycle actually advanced the project. A cycle made progress if the
`backlog` count dropped **or** a `ready_to_merge` branch got merged. If a cycle
finished and **neither** changed (e.g. the task failed and the sub-session left
it `in_progress` or bounced it back to `backlog`, or a merge keeps conflicting),
do **not** re-launch — that would loop forever on the same stuck item. Mark the
project **stalled**, comment on the stuck task, and surface it:

```bash
$BOARD comment <id> --body "Orchestrator stopped draining <label>: cycle made no progress on this task. Session id <SESSION_ID>."
```

**Safety cap.** Also stop a project's drain loop after a hard cap of cycles
(e.g. **20**) as a backstop, even if it claims progress — and log that you
capped it.

**Hang detection — session-log mtime (best effort, macOS).** For the in-flight
cycle:

```bash
ENC="$(printf '%s' "<project_path>" | sed 's#/#-#g')"   # /a/b → -a-b
LOG="$HOME/.claude/projects/$ENC/$SESSION_ID.jsonl"
if [ -f "$LOG" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$LOG") ))         # macOS stat (BSD)
  # AGE > 600  → 10 min with no log activity = likely stuck
fi
```

(`stat -f %m` is macOS/BSD; Linux uses `stat -c %Y`.) Heuristic only — if the
log path can't be found, rely on the cap below.

**Per-cycle hard cap (configurable).** Stop waiting on any single cycle once it
has run for its cap's worth of wall-clock since *its own* launch. The cap is
**configurable** rather than a fixed 30 minutes:

- The board-wide default is `default_time_cap_minutes` from
  `curl -s $BOARD_URL/api/settings` (30 if unset).
- A backlog task may override it with its own `time_cap_minutes` (set at
  creation, or edited any time — including while in progress — via the UI or
  `$BOARD set-cap <id> <minutes|default>`). Once a cycle has claimed its task
  (it shows up `in_progress` for that project), read that task's
  `time_cap_minutes` from `$BOARD show <id> --json` and use it.

So the effective cap is `task.time_cap_minutes ?? settings.default_time_cap_minutes`.
Re-read it on each poll so a mid-flight bump takes effect. A hung cycle counts as
a stall for its project (handle as §4 timeout); it must not hold up the other
projects' loops.

Keep advancing until **every** project is drained, stalled, or capped.

## 4. Resolve each project — drained vs. stalled/timeout

- **Drained** (both queues empty after a cycle): success. You have its full
  `merged_ids` and `taken` lists for the roll-up.
- **Stalled** (no-progress guard or cycle cap): report it; the offending task is
  left where the sub-session put it (`in_progress` or bounced to `backlog`) plus
  your comment. Don't try to unwind git from here.
- **Timeout / hang** (per-cycle 30-min cap or 10-min inactivity): the cycle
  didn't finish. Any backlog task it had claimed is stuck `in_progress`; release
  it for retry and stop that project's loop:

  ```bash
  $BOARD comment <id> --body "Orchestrator timeout: cycle for <label> didn't finish within the cap. Session id <SESSION_ID>."
  $BOARD status <id> backlog
  ```

  Do **not** immediately re-dispatch; surface it. (There is no `failed` status;
  returning a claimed task to backlog lets a human or a later run retry.)

## 5. Report roll-up

When every project is drained, stalled, capped, or timed out, print a roll-up.
Per project:

- **Merges:** the `ready_to_merge` task ids merged to `done` (and any bounced
  back on conflict).
- **Backlog drained:** the list of backlog task ids taken, each with its branch,
  session id (for resume), and a one-line summary — these are now in Pending
  Review awaiting your review.
- **Outcome:** drained / stalled (which task) / timed out, and cycles run.

Then a totals line: projects checked, projects drained, branches merged, backlog
tasks taken, cycles run, stalls + timeouts. Then stop. (Everything taken sits in
Pending Review — the human reviews and approves; approved items become
`ready_to_merge` for a future merge pass.)

## Quick reference

```bash
LOOP_BOARD="$(pwd)"; BOARD="node $LOOP_BOARD/cli/board.js"; BOARD_URL="http://localhost:5151"
curl -s $BOARD_URL/api/projects-config                       # configured projects
curl -s $BOARD_URL/api/settings                              # default_time_cap_minutes (fallback cap)
$BOARD list --project <p> --status ready_to_merge --json     # merge queue (drained first, every cycle)
$BOARD list --project <p> --status backlog --json            # backlog queue (one task per cycle; loop to drain)
$BOARD list --project <p> --status pending_review --json     # where taken tasks land
$BOARD list --project <p> --status done --json               # where merged tasks land
$BOARD show <id> --json                                       # read a task / its answer + .time_cap_minutes
$BOARD set-cap <id> <minutes|default>                         # set/clear a task's execution cap
$BOARD status <id> backlog                                    # release a stuck claim on timeout
# Drain loop per project: while (ready_to_merge OR backlog non-empty) and progressing and under cap → dispatch one cycle (§2d).
```
