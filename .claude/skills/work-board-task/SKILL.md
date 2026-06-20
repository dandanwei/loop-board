---
name: work-board-task
description: Execute one specific Loop Board task end to end inside a project's own session. Given a task id (passed in the prompt by the orchestrator), read it from the board, implement it on a new git branch, run the checks, commit, and post the result back to Pending Review. Use when a prompt says "use the work-board-task skill to complete board task #N" — typically dispatched by the run-board-orchestrator skill.
---

# work-board-task — complete one board task

You are a **project sub-session** dispatched to finish a single, already-known
task from the local Loop Board, autonomously, then report back. This differs
from `take-task`: you do **not** pick the next task — you work the **exact task
id** given to you.

## 0. Inputs (read from your prompt)

The dispatching prompt gives you:

- **task id** (required) — e.g. "complete board task #123".
- **project label** — e.g. "for project my-app".
- **board CLI path** — an absolute path to `cli/board.js`, since `loop-board`
  is usually not on PATH. Treat this as `BOARD="node <that-path>"`.
- **board URL** — defaults to `http://localhost:5151`.

If no task id is present in the prompt, fall back to claiming the next task:
`$BOARD next --project <label> --json` (exit code 3 = nothing to do; stop).

Throughout, invoke the CLI as the given path, e.g.:

```bash
BOARD="node /abs/path/to/loop-board/cli/board.js"
$BOARD show 123 --project my-app --json
```

## 1. Read the task

```bash
$BOARD show <id> --json
```

The orchestrator already claimed it (status `in_progress`). Read the
**description** and especially the **definition of done** (DoD). If the task is
not `in_progress` or belongs to a different project than your prompt says, stop
and report the mismatch rather than guessing.

## 2. Create a working branch

Never work on the default branch. If the working tree is dirty, stop and report
it. Otherwise:

```bash
git checkout -b task/<id>-<short-slug>
```

## 3. Implement

- Stay focused on the DoD; don't make unrelated changes.
- Explore the codebase as needed; keep all work on this branch.

## 4. Verify

Run the project's tests / checks (e.g. `npm test`, `pytest`, a build). Capture a
short pass/fail summary — you'll include it in the answer. If there is no test
setup, say so explicitly.

## 5. Commit

```bash
git add -A
git commit -m "task #<id>: <concise summary>"
```

Do **not** push or open a PR unless the task explicitly asks.

## 6. Write the answer

Write a Markdown answer to a temp file (e.g. `/tmp/loop-answer-<id>.md`):

```markdown
## Summary
<2-4 sentences: what you did and why>

## Changes
- `path/to/file` — what changed and why

## Definition of done
- [x] <criterion — how it's satisfied>
- [ ] <anything not done, with reason>

## How to verify
<exact commands the reviewer can run>

## Test results
<the pass/fail summary from step 4>

## Notes & follow-ups
<risks, assumptions, anything deliberately left out>
```

Do **not** write a `.loop-task-output.json` file — the board answer below is the
single source of truth, and a stray file would get swept into `git add -A`.

## 7. Post back and move to Pending Review

```bash
$BOARD answer <id> \
  --answer-file /tmp/loop-answer-<id>.md \
  --branch "$(git rev-parse --abbrev-ref HEAD)" \
  --session-title "<concise title for this task>" \
  --status pending_review \
  --tool claude-code
```

This attaches the answer + branch + session title and moves the task to
**Pending Review** in one call. (You don't need to set `--session-id`: the
orchestrator launched you with a fixed session id and already recorded it on the
task, so resume works without you echoing it. If you were run standalone and
know your session id, you may pass `--session-id <id>`.)

## 8. Hand back

Print one concise line: task id, branch, session title, and a one-line summary —
this is what the orchestrator collects. Then stop.

## On failure

If you cannot complete the task (blocked, tests won't pass, ambiguous DoD):

- Commit any partial work on the branch.
- Post what you have with `--status in_progress` (not `pending_review`) and a
  clear answer explaining the blocker, **or** leave a note with
  `$BOARD comment <id> --body "..."`.
- Report the blocker plainly so the orchestrator surfaces it. Never fake success.
