# Loop Board

A **local task board** with a light SQLite database and a no-auth local HTTP
API — plus a set of **skills** that let coding agents (Claude Code, and
best-effort Codex / OpenCode) pull tasks for a project, implement them on a
branch, merge approved work, and post results back for you to review.

```
  ┌─────────┐   create task    ┌──────────────┐   loop-board next   ┌───────────────┐
  │   You   │ ───────────────▶ │  Loop Board  │ ◀────────────────── │  Agent (in    │
  │ (board) │ ◀─────────────── │  API + UI    │ ──── task ────────▶ │  your project)│
  └─────────┘  review answer   └──────────────┘   answer + branch   └───────────────┘
       │            ▲                  ▲                                    │
       │            └────── pending review ◀──── loop-board answer ─────────┘
       └─ close / archive
```

## The workflow

1. **You** create a task on the board, tag it with a **project label**, write the
   task info and a **definition of done**.
2. In that project's repo, a coding-agent session runs the **`loop-board-take-task`
   skill**. It **first merges** any branches you've already approved
   (`ready_to_merge`) into the default branch, **then** claims the next task,
   creates a **new git branch**, implements the work, commits, writes an answer,
   and moves the task to **Pending Review** — recording the branch and a session
   title.
3. **You** review the answer (nicely rendered Markdown) on the board. If needed,
   continue the work in the same session/branch.
4. When satisfied, click **Ready to merge**. The next time the skill runs it
   merges that branch into the default branch and marks the task **Done** — or
   you can mark it **Done** / **Archived** yourself.

## Quick start

```bash
npm install            # installs server + UI deps (better-sqlite3 builds natively)
npm link               # puts the `loop-board` CLI on your PATH (optional but recommended)
npm run seed           # optional: add a couple of demo tasks
npm run dev            # API on :5151, UI with hot-reload on http://localhost:5173
```

If you skip `npm link`, every `loop-board <cmd>` below also works by calling the
CLI directly from this repo: `node /path/to/loop-board/cli/board.js <cmd>`.

For a single-port production-style run:

```bash
npm run build          # builds the UI into web/dist
npm start              # serves UI + API together on http://localhost:5151
```

Either way, open the UI in your browser (`http://localhost:5173` in dev mode,
`http://localhost:5151` in the single-port prod mode), pick or create a project,
and add a task with a clear definition of done.

## Skills

The repo ships three agent skills under `.claude/skills/`, all named with a
**`loop-board-`** prefix so it's obvious they belong to this board:

| Skill | What it does | Runs in | Install at user level? |
| --- | --- | --- | --- |
| **`loop-board-take-task`** | The everyday driver, running a full board cycle: **first** merges any approved (`ready_to_merge`) branches into the default branch (aborting + bouncing a task back to Pending Review on a conflict it can't safely resolve), **then** claims the next backlog task, implements it on a new branch, commits, and posts the answer to **Pending Review**. | the project you're working on | **Yes** — the everyday driver |
| **`loop-board-work-board-task`** | Works one **specific** task by id (not "the next one") end to end — the unit the orchestrator dispatches. | a project sub-session | Only if you use the orchestrator |
| **`loop-board-run-board-orchestrator`** | Sweeps every configured project, claims its highest-priority task, and dispatches a `loop-board-work-board-task` sub-session for each — **one task per project, run concurrently** across projects. | the loop-board repo (or anywhere) | Only if you launch it from outside this repo |

### Which skills do I need?

- **Working one task at a time** (the common case): install
  **`loop-board-take-task`**. It both merges approved branches and takes new
  tasks, and runs inside whatever project you're in, so it must be visible at
  the user level (`~/.claude/skills/`).
- **Multi-project orchestration**: also install **`loop-board-work-board-task`**
  at the user level — the orchestrator spawns project sub-sessions that load it.
  **`loop-board-run-board-orchestrator`** only needs a user-level install if you
  start it from a directory *other than* this repo; run it from here and the
  repo-local copy is discovered automatically.

### 1. Install the skills you need (once)

Run this **from the loop-board repo root** — `$(pwd)` must expand to *this*
repo's path, because each symlink points at a skill folder that lives here:

```bash
cd /path/to/loop-board        # the loop-board repo you cloned (NOT your other project)
mkdir -p ~/.claude/skills

# Everyday loop (merges approved branches, then takes the next task):
ln -s "$(pwd)/.claude/skills/loop-board-take-task"  ~/.claude/skills/loop-board-take-task

# Only if you orchestrate across projects:
ln -s "$(pwd)/.claude/skills/loop-board-work-board-task"        ~/.claude/skills/loop-board-work-board-task
ln -s "$(pwd)/.claude/skills/loop-board-run-board-orchestrator" ~/.claude/skills/loop-board-run-board-orchestrator

# Sanity-check one of them resolves back into this repo:
ls -l ~/.claude/skills/loop-board-take-task
```

A **symlink** keeps the skill in sync as this repo updates (and follows whatever
branch you have checked out). You can **copy** the folders instead, but copies
drift from the repo and you'll have to re-copy after each change.

### 2. Point each project at the board

In the repo root of the *project you want to work on*, add a `.board.json`. Its
`project` value must match the label you gave the task on the board:

```bash
# Run from your other project's repo root:
cp /path/to/loop-board/.board.example.json ./.board.json
# then edit it:  { "project": "your-label", "boardUrl": "http://localhost:5151" }
```

Now, inside that project, ask the agent to **"take a task"** (or "work the
board"). It first merges anything you've marked **Ready to merge**, then runs
`loop-board next`, does the work on a branch, and posts back. You can also ask it
to **"merge branches"** to run just the merge step — it's the same skill.

> **Codex / OpenCode:** the same `loop-board` CLI and `SKILL.md` instructions
> apply. Point the tool at the relevant `SKILL.md` (or paste its steps). Native
> session rename is tool-dependent; the board's session title is always the
> canonical record.

## The `loop-board` CLI

Zero dependencies (Node 18+, uses built-in `fetch`). Config resolves from flags →
env (`BOARD_URL`, `BOARD_PROJECT`) → `.board.json` → defaults.

```
loop-board next                 Atomically claim the next backlog task for the project
loop-board show <id>            Show a task in full (description, DoD, answer)
loop-board list [--status S]    List tasks for the project
loop-board create --title "…"   Create a task (--description[-file], --dod[-file], --priority, --cap)
loop-board answer <id> \        Post answer + branch + session title; moves to pending_review
    --answer-file ans.md --branch b --session-title "…" [--status …]
loop-board comment <id> --body "…"   Add a comment/event
loop-board status <id> <status>      Move a task between columns
loop-board set-cap <id> <min|default>  Set/clear a task's execution cap (minutes)
loop-board projects             List projects and open counts
```

`loop-board next` exits with code **3** when the queue is empty.

## HTTP API

No auth. Base URL `http://localhost:5151`. JSON in/out.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness check |
| GET | `/api/projects` | Distinct projects with open counts |
| GET | `/api/tasks?project=&status=&includeArchived=` | List tasks |
| POST | `/api/tasks` | Create `{ title, project, description?, definition_of_done?, priority?, time_cap_minutes? }` |
| GET | `/api/tasks/:id` | Get one task **with its event timeline** |
| PATCH | `/api/tasks/:id` | Update any task field(s) |
| DELETE | `/api/tasks/:id` | Delete a task |
| POST | `/api/tasks/:id/status` | `{ status }` — move + log an event |
| POST | `/api/tasks/:id/comment` | `{ body, author? }` — add a comment |
| POST | `/api/tasks/:id/answer` | `{ answer, branch?, session_title?, status? }` — the agent write-back |
| POST | `/api/projects/:project/claim` | Atomically claim the next backlog task (→ `in_progress`); `204` if none |

Example:

```bash
curl -s localhost:5151/api/tasks \
  -H 'content-type: application/json' \
  -d '{"title":"Add dark mode","project":"my-app","definition_of_done":"- toggle works\n- persists"}'
```

### Statuses

`backlog → in_progress → pending_review → ready_to_merge → done`, plus `archived`.
The `loop-board-take-task` skill moves a task to `pending_review` when it finishes
implementing it. After you review it, click **Ready to merge** to move it to
`ready_to_merge`; the next time that same skill runs (its merge phase) it merges
the branch into `master` and marks the task `done` (or, if the merge conflicts in
a way it can't safely resolve, it aborts the merge and moves the task back to
`pending_review` with a note for you to resolve manually). You can always move a
task to `done`/`archived` yourself.

### Execution cap

When the orchestrator dispatches a task it stops waiting on it after a hard cap
of wall-clock time. The cap is configurable: set a per-task `time_cap_minutes`
(at creation via the **New task** modal / `--cap`, or any time afterwards via the
task drawer / `set-cap` — even while it's in progress), or leave it unset to use
the board-wide **Default execution cap** (set under ⚙ Configure → Board settings;
30 minutes out of the box). The effective cap is the task's own value when set,
otherwise the board default.

## Configuration

| Var | Default | Meaning |
| --- | --- | --- |
| `BOARD_PORT` / `PORT` | `5151` | API + prod UI port |
| `BOARD_DB` | `./data/board.db` | SQLite file location |
| `BOARD_URL` | `http://localhost:5151` | CLI target |
| `BOARD_PROJECT` | — | CLI default project |
| `BOARD_AGENT_TOOL` | — | Recorded on claims/answers |

## Project layout

```
server/    Express API + SQLite (db.js, index.js, seed.js)
web/       React + Vite + Tailwind UI (board, drawer, markdown editor)
cli/       loop-board CLI (zero-dep client used by the skills)
.claude/skills/loop-board-*/   the three agent skills (see "Skills" above)
data/      SQLite database (gitignored, created on first run)
```

## Notes

- The DB is created automatically on first run; no migration step needed.
- The board and the agent run on **your machine only**; the API has no auth by
  design. Don't expose the port publicly.
- Git branches are created in the **consuming project's** repo, not this one.
