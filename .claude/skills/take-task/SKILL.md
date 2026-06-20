---
name: take-task
description: Pull the next task from the local Loop Board for the current project, implement it autonomously on a new git branch, then post the result back and move the task to Pending Review. Use when the user says things like "take a task", "work the board", "next board task", "pick up a task", or "run the loop". The board is a local, no-auth task queue tagged by project label.
---

# take-task — work the Loop Board

You are picking up a unit of work from a **local task board** (Loop Board) and
completing it end to end, autonomously. The board is reachable over a local,
no-auth HTTP API and is driven through the `loop-board` CLI.

## 0. Preconditions

- The board server must be running (`npm start` / `npm run dev` in the loop-board repo).
- The `loop-board` CLI should be on PATH (the user ran `npm link` in the
  loop-board repo). If `loop-board` is not found, fall back to
  `node <path-to-loop-board>/cli/board.js` with the same arguments.
- Run all `loop-board` and `git` commands from the **current project's repo root**.

## 1. Determine the project label

The board serves tasks per **project label**. Resolve it in this order:

1. A `.board.json` file in the repo root: `{ "project": "...", "boardUrl": "..." }`.
2. The `BOARD_PROJECT` environment variable.
3. If neither exists, infer a sensible label from the repo (e.g. the directory
   name or git remote) and **ask the user to confirm** before proceeding.

The CLI reads `.board.json` automatically, so if it exists you don't need
`--project` on every call.

## 2. Claim the next task

```bash
loop-board next            # uses .board.json / BOARD_PROJECT
# or: loop-board next --project <label>
```

- This **atomically** claims the highest-priority backlog task and flips it to
  `in_progress`, then prints the task (id, title, description, definition of done).
- Exit code `3` means **no open tasks** — tell the user the queue is empty and stop.
- Note the **task id**; you need it for the write-back.

## 3. Create a working branch

Never work on the default branch. Create a dedicated branch:

```bash
git checkout -b task/<id>-<short-slug>
```

Record the branch name — you'll post it back. If the working tree is dirty,
stop and tell the user rather than mixing unrelated changes.

## 4. Analyze and implement

- Read the **description** and especially the **definition of done** (DoD).
- Explore the codebase as needed to understand the change.
- Implement the task. Stay focused on the DoD; don't make unrelated changes.
- Keep the work on this branch only.

## 5. Commit

Commit your work with a message that references the task:

```bash
git add -A
git commit -m "task #<id>: <concise summary>"
```

Do **not** push or open a PR unless the user explicitly asks.

## 6. Write the answer (this is what the human reviews)

Compose a clear Markdown answer using this template, and write it to a temp file
(e.g. `/tmp/loop-answer-<id>.md`):

```markdown
## Summary
<2-4 sentences: what you did and why>

## Changes
- `path/to/file` — what changed and why
- ...

## Definition of done
- [x] <criterion 1 — how it's satisfied>
- [x] <criterion 2>
- [ ] <anything not done, with reason>

## How to verify
<exact commands / steps the reviewer can run>

## Notes & follow-ups
<risks, assumptions, anything you deliberately left out>
```

## 7. Post back and move to Pending Review

Pick a short, descriptive **session title** that summarizes the work (this is the
name shown on the board and used to rename your session):

```bash
loop-board answer <id> \
  --answer-file /tmp/loop-answer-<id>.md \
  --branch "$(git rev-parse --abbrev-ref HEAD)" \
  --session-title "<concise title for this task>" \
  --session-id "$CLAUDE_CODE_SESSION_ID" \
  --status pending_review \
  --tool claude-code
```

This attaches the answer + branch + session title + session id and moves the
task to **Pending Review** in one call.

**Always pass `--session-id`** — it's what lets the human resume *this exact
session* later from the board, which renders a one-line
`cd <repo> && git checkout <branch> && claude --resume <id>` command from it. In
Claude Code the resumable id lives in the `$CLAUDE_CODE_SESSION_ID` environment
variable, so pass it verbatim as shown. If that variable is empty (e.g. a
different tool), omit the flag rather than passing a bogus value — the board
simply won't show a resume command. Other tools should pass their own resumable
session id here if they have one.

## 8. Rename the session

- **Always** set the session title on the board (done in step 7) — the board is
  the canonical place the human reads it.
- **Additionally**, if your agent tool supports renaming the current session
  (a slash command, CLI flag, or config), rename it to the same title so it's
  easy to find when resuming. If your tool has no supported rename mechanism,
  that's fine — the board title is sufficient; don't invent one.

## 9. Hand back to the human

Report concisely: the task id, the branch name, the session title, and a
one-line summary. Then stop — the human reviews the answer on the board, may
ask you to continue on this same branch, and will close/archive the task
manually when satisfied.

## Continuing a task later

If the user asks you to continue a task already in review:

```bash
loop-board show <id>     # re-read the task and your previous answer
```

Switch back to its branch (`git checkout <branch>`), make the changes, commit,
and post an updated answer with `loop-board answer <id> ...` (use
`--status pending_review` again, or `--status in_progress` while still working).
Use `loop-board comment <id> --body "..."` to leave a note without replacing the
answer.

## Command reference

```
loop-board next                 Claim next backlog task for the project
loop-board show <id>            Show a task in full
loop-board list [--status S]    List tasks for the project
loop-board answer <id> ...      Post answer + metadata, move status
loop-board comment <id> ...     Add a comment/event
loop-board status <id> <s>      Move a task between columns
loop-board projects             List projects and open counts
```
