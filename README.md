# Loop Board

A **local task board** with a light SQLite database and a no-auth local HTTP
API — plus a **skill** that lets coding agents (Claude Code, and best-effort
Codex / OpenCode) pull tasks for a project, implement them on a branch, and post
the result back for you to review.

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
2. In that project's repo, a coding-agent session runs the **`take-task` skill**.
   It claims the next task for the project, creates a **new git branch**,
   implements the work, commits, writes an answer, and moves the task to
   **Pending Review** — recording the branch and a session title.
3. **You** review the answer (nicely rendered Markdown) on the board. If needed,
   continue the work in the same session/branch.
4. **You** manually mark the task **Done** / **Archived**.

## Quick start

```bash
npm install            # installs server + UI deps (better-sqlite3 builds natively)
npm link               # puts the `loop-board` CLI on your PATH (optional but recommended)
npm run seed           # optional: add a couple of demo tasks
npm run dev            # API on :5151, UI with hot-reload on http://localhost:5173
```

For a single-port production-style run:

```bash
npm run build          # builds the UI into web/dist
npm start              # serves UI + API together on http://localhost:5151
```

Open the UI, pick/create a project, add a task with a clear definition of done.

## Using the skill from a project

The skill lives in `.claude/skills/take-task/`. To use it from **any** project
session, make it available to Claude Code and tell the project which board label
it belongs to:

```bash
# Make the skill global (once):
mkdir -p ~/.claude/skills
ln -s "$(pwd)/.claude/skills/take-task" ~/.claude/skills/take-task

# In each consuming project's repo root, add a .board.json:
cp /path/to/loop-board/.board.example.json /path/to/your-project/.board.json
# then edit it:  { "project": "your-label", "boardUrl": "http://localhost:5151" }
```

Now, inside that project, ask the agent to **"take a task"** (or "work the
board"). It will run `loop-board next`, do the work on a branch, and post back.

> **Codex / OpenCode:** the same `loop-board` CLI and `SKILL.md` instructions
> apply. Point the tool at `SKILL.md` (or paste its steps). Native session
> rename is tool-dependent; the board's session title is always the canonical
> record.

## The `loop-board` CLI

Zero dependencies (Node 18+, uses built-in `fetch`). Config resolves from flags →
env (`BOARD_URL`, `BOARD_PROJECT`) → `.board.json` → defaults.

```
loop-board next                 Atomically claim the next backlog task for the project
loop-board show <id>            Show a task in full (description, DoD, answer)
loop-board list [--status S]    List tasks for the project
loop-board create --title "…"   Create a task (--description[-file], --dod[-file], --priority)
loop-board answer <id> \        Post answer + branch + session title; moves to pending_review
    --answer-file ans.md --branch b --session-title "…" [--status …]
loop-board comment <id> --body "…"   Add a comment/event
loop-board status <id> <status>      Move a task between columns
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
| POST | `/api/tasks` | Create `{ title, project, description?, definition_of_done?, priority? }` |
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

`backlog → in_progress → pending_review → done`, plus `archived`. The skill moves
tasks to `pending_review`; you move them to `done`/`archived`.

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
cli/       loop-board CLI (zero-dep client used by the skill)
.claude/skills/take-task/   the agent skill
data/      SQLite database (gitignored, created on first run)
```

## Notes

- The DB is created automatically on first run; no migration step needed.
- The board and the agent run on **your machine only**; the API has no auth by
  design. Don't expose the port publicly.
- Git branches are created in the **consuming project's** repo, not this one.
