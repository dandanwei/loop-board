---
name: merge-task
description: Merge a reviewed Loop Board task's branch into the default branch (master/main). Pulls the next task in the `ready_to_merge` column for the current project, merges its branch locally, and on success marks the task done. If the merge hits a conflict it can't safely resolve, it aborts the merge and moves the task back to Pending Review with a note. Use when the user says "merge ready tasks", "merge the board", "merge task", "merge ready-to-merge", or "run the merge".
---

# merge-task — merge reviewed Loop Board branches

You are taking a task the human has **reviewed and approved for merge** (it sits
in the `ready_to_merge` column) and merging its branch into the project's default
branch. The board is reached over the local, no-auth HTTP API via the
`loop-board` CLI. Work **locally only — never push**.

## 0. Preconditions

- The board server must be running (`npm start` / `npm run dev` in the loop-board repo).
- The `loop-board` CLI should be on PATH. If it isn't found, fall back to
  `node <path-to-loop-board>/cli/board.js` with the same arguments.
- Run all `loop-board` and `git` commands from the **current project's repo root**.
- The project label resolves from `.board.json` (or `BOARD_PROJECT`), same as
  `take-task`.

## 1. Pick the next ready-to-merge task

```bash
loop-board list --status ready_to_merge --json
```

- If the list is empty, tell the user there's nothing to merge and **stop**.
- Otherwise pick the **first** task (the API orders by priority, then most
  recently updated). Note its **id** and **branch**:

```bash
loop-board show <id>      # confirm the branch and re-read the answer
```

- If the task has **no branch** recorded, don't guess — comment on the task
  asking for the branch and stop.

## 2. Pre-flight checks

- The working tree must be clean:

```bash
git status --porcelain
```

  If it prints anything, **stop** and tell the user — don't merge over
  uncommitted changes.

- Determine the **default branch** (usually `master`, sometimes `main`):

```bash
git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo master
```

  Use that as `<default>` below. Confirm the task branch exists:
  `git rev-parse --verify <branch>`.

## 3. Merge the branch

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

Then tell the user which files conflicted so they can resolve manually.

## 4. Hand back to the human

Report concisely: the task id, the branch, and the outcome — either "merged into
`<default>` at `<sha>`, task marked done" or "conflicts in `<files>`, merge
aborted, task moved back to Pending Review". Then stop.

To merge several tasks, run this skill again — it picks the next
`ready_to_merge` task each time.

## Command reference

```
loop-board list --status ready_to_merge --json   Tasks awaiting merge (for the project)
loop-board show <id>                              Show a task in full (branch, answer)
loop-board comment <id> --body "..."              Add a note to the task
loop-board status <id> done|pending_review        Move the task between columns
```
