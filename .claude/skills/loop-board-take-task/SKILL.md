---
name: loop-board-take-task
description: One skill that runs a full Loop Board cycle for the current project. FIRST it merges any reviewed branches waiting in the `ready_to_merge` column into the default branch (master/main); THEN it claims the next backlog task, implements it on a new git branch, and posts the result to Pending Review. Merging always takes priority over taking new work. Use when the user says "take a task", "work the board", "run the loop", "next board task", "pick up a task", "merge branches", "merge ready tasks", "merge the board", "merge ready-to-merge", or "run the merge". The board is a local, no-auth task queue tagged by project label.
---

# loop-board-take-task — merge ready branches, then work the next task

This is the single everyday driver for the **Loop Board**, a local task board
reached over a no-auth HTTP API and driven through the `loop-board` CLI. It does
two things in a fixed order:

1. **Phase 1 — Merge first.** Merge every branch the human has approved (the
   `ready_to_merge` column) into the default branch.
2. **Phase 2 — Then take new work.** Claim the next backlog task and implement
   it end to end.

**Merging is always the priority: do Phase 1 before Phase 2.** Clearing approved
work into the default branch first keeps later tasks branching off the freshest
code and avoids pile-ups.

> Scope: by default run both phases. If the user clearly asked for only one —
> e.g. "just merge" / "merge the board" (Phase 1 only) or "just take a task" /
> "pick up a task" (Phase 2 only) — do only that phase and skip the other.

## 0. Preconditions (both phases)

- The board server must be running (`npm start` / `npm run dev` in the loop-board repo).
- The `loop-board` CLI should be on PATH (the user ran `npm link` in the
  loop-board repo). If `loop-board` is not found, fall back to
  `node <path-to-loop-board>/cli/board.js` with the same arguments.
- Run all `loop-board` and `git` commands from the **current project's repo root**.
- Work **locally only — never push or open a PR** unless the user explicitly asks.

## 1. Determine the project label (both phases)

The board serves tasks per **project label**. Resolve it in this order:

1. A `.board.json` file in the repo root: `{ "project": "...", "boardUrl": "..." }`.
2. The `BOARD_PROJECT` environment variable.
3. If neither exists, infer a sensible label from the repo (e.g. the directory
   name or git remote) and **ask the user to confirm** before proceeding.

The CLI reads `.board.json` automatically, so if it exists you don't need
`--project` on every call.

---

# Phase 1 — Merge reviewed branches (do this first)

Merge **every** task sitting in the `ready_to_merge` column, highest priority
first, until the column is empty. Each such task is work the human has reviewed
and approved for merge.

## 1.1 List what's ready

```bash
loop-board list --status ready_to_merge --json
```

- If the list is **empty**, there's nothing to merge — go straight to Phase 2.
- Otherwise process the tasks one at a time, in the order returned (the API
  orders by priority, then most recently updated).

## 1.2 Pre-flight (once, before merging)

The working tree must be clean:

```bash
git status --porcelain
```

If it prints anything, **stop** and tell the user — don't merge over uncommitted
changes. Determine the **default branch** (usually `master`, sometimes `main`):

```bash
git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo master
```

Use that as `<default>` below.

## 1.3 Merge each ready task

For each `ready_to_merge` task, note its **id** and **branch**:

```bash
loop-board show <id>      # confirm the branch and re-read the answer
```

- If the task has **no branch** recorded, don't guess — comment on the task
  asking for the branch, leave it where it is, and move on to the next task.
- Confirm the branch exists: `git rev-parse --verify <branch>`.

Then merge:

```bash
git checkout <default>
# If the repo has a remote, fast-forward the default branch first; ignore if none:
git pull --ff-only 2>/dev/null || true
git merge --no-ff <branch> -m "Merge <branch> (task #<id>)"
```

### On a clean merge

```bash
loop-board comment <id> --body "Merged \`<branch>\` into <default> ($(git rev-parse --short HEAD))."
loop-board status <id> done
```

Optionally delete the now-merged branch (`git branch -d <branch>`) only if the
user asked you to tidy up; otherwise leave it.

### On conflicts

Inspect them: `git status` and `git diff`. Resolve **only** if the correct
resolution is obvious and safe (e.g. two non-overlapping additions, an obviously
stale vs. current line). If you do resolve, `git add` the files, finish with
`git commit --no-edit`, then mark the task `done` as above and note in the
comment exactly what you resolved.

If the resolution is **not safe to decide automatically** — overlapping logic
changes, ambiguous intent, anything you're unsure about — do **not** guess:

```bash
git merge --abort
loop-board comment <id> --body "Merge of \`<branch>\` into <default> hit conflicts I can't safely auto-resolve (files: <list>). Aborted the merge — the branch is unchanged. Please resolve manually, then move the task back to Ready to Merge."
loop-board status <id> pending_review
```

Then continue to the **next** ready task. Once the `ready_to_merge` column is
empty (or only holds tasks you bounced back), Phase 1 is done — proceed to
Phase 2.

---

# Phase 2 — Take the next task

With merges out of the way, the default branch is up to date. Now claim and
implement the next piece of backlog work.

## 2.1 Claim the next task

Make sure you're back on the default branch with a clean working tree first
(`git checkout <default>`), then:

```bash
loop-board next            # uses .board.json / BOARD_PROJECT
# or: loop-board next --project <label>
```

- This **atomically** claims the highest-priority backlog task and flips it to
  `in_progress`, then prints the task (id, title, description, definition of done).
- Exit code `3` means **no open tasks** — tell the user the queue is empty and
  stop (if Phase 1 merged anything, report that summary).
- Note the **task id**; you need it for the write-back.

## 2.2 Create a working branch

Never work on the default branch. Create a dedicated branch:

```bash
git checkout -b task/<id>-<short-slug>
```

Record the branch name — you'll post it back. If the working tree is dirty,
stop and tell the user rather than mixing unrelated changes.

## 2.3 Analyze and implement

- Read the **description** and especially the **definition of done** (DoD).
- Explore the codebase as needed to understand the change.
- Implement the task. Stay focused on the DoD; don't make unrelated changes.
- Keep the work on this branch only.

## 2.4 Commit

Commit your work with a message that references the task:

```bash
git add -A
git commit -m "task #<id>: <concise summary>"
```

Do **not** push or open a PR unless the user explicitly asks.

## 2.5 Write the answer (this is what the human reviews)

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

## 2.6 Post back and move to Pending Review

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

## 2.7 Rename the session

- **Always** set the session title on the board (done in step 2.6) — the board is
  the canonical place the human reads it.
- **Additionally**, if your agent tool supports renaming the current session
  (a slash command, CLI flag, or config), rename it to the same title so it's
  easy to find when resuming. If your tool has no supported rename mechanism,
  that's fine — the board title is sufficient; don't invent one.

## 2.8 Hand back to the human

Report concisely: anything merged in Phase 1 (task ids + outcomes), then the
task id, the branch name, the session title, and a one-line summary of the work
done in Phase 2. Then stop — the human reviews the answer on the board, may ask
you to continue on this same branch, and will close/archive the task manually
when satisfied.

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
loop-board list --status ready_to_merge --json   Tasks awaiting merge (Phase 1)
loop-board next                 Claim next backlog task for the project (Phase 2)
loop-board show <id>            Show a task in full (branch, answer)
loop-board list [--status S]    List tasks for the project
loop-board answer <id> ...      Post answer + metadata, move status
loop-board comment <id> ...     Add a comment/event
loop-board status <id> <s>      Move a task between columns (e.g. done, pending_review)
loop-board projects             List projects and open counts
```
