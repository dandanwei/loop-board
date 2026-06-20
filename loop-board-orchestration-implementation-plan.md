# Loop Board Orchestration - Complete Implementation Plan

**Date:** 2026-06-19  
**Status:** Ready for Implementation  
**Target:** Multi-project task orchestration with Claude Code sessions

---

## 🎯 Problem Statement

**Current State:**
- Single project tasks via `loop-board-take-task` skill
- Each project has its own Claude Code session
- No centralized orchestration
- Manual task assignment and monitoring

**Desired State:**
- Central orchestrator session manages multiple projects
- Automatic task dispatch to project-specific sub-sessions
- Progress monitoring and result collection
- Human review workflow with resume capability

---

## 📋 Design Decisions Made

### 1. Session Naming Convention
**Decision:** Use task ID in session name  
**Format:** `task-<id>-<slug>`  
**Example:** `task-123-auth-refactor`  
**Rationale:** Sub-session can parse task_id from name without explicit parameters

### 2. Polling Strategy
**Decision:** 30-second polling interval  
**Detection:** Check task status via `loop-board show <id>`  
**Rationale:** Balance between responsiveness and API load

### 3. Timeout Detection
**Decision:** 10-minute inactivity timeout  
**Method:** Check `.claude/projects/<project>/<session-id>.jsonl` modification time  
**Fallback:** 30-minute fixed timeout if log check fails  
**Rationale:** More accurate than fixed timeout, catches stuck sessions

### 4. Sequential Processing
**Decision:** One task at a time per orchestrator run  
**Rationale:** Avoid resource conflicts, easier debugging

### 5. Result Communication
**Decision:** Write results to `.loop-task-output.json` in project root  
**Format:** Structured JSON with task_id, session_title, summary, files_changed, test_results  
**Rationale:** Orchestrator can read file without needing API callbacks

### 6. UI Resume Button
**Decision:** Show resume command, user copies manually  
**Command:** `cd <project_path> && claude --resume <session_id>`  
**Rationale:** Simple, no complex terminal launching infrastructure

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Main Orchestrator Session                      │
│         (loop-board-run-board-orchestrator skill)           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  Loop Board API       │
         │  localhost:5151       │
         └───────┬───────┬───────┘
                 │       │
         ┌───────▼┐  ┌──▼────────┐
         │ Config │  │  Tasks    │
         │ Store  │  │  Queue    │
         └───────┘  └───┬────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
    ┌────────┐   ┌────────┐   ┌────────┐
    │Project │   │Project │   │Project │
    │   A    │   │   B    │   │   C    │
    └───┬────┘   └───┬────┘   └───┬────┘
        │            │            │
        ▼            ▼            ▼
  ┌────────┐  ┌────────┐  ┌────────┐
  │Sub-    │  │Sub-    │  │Sub-    │
  │Session │  │Session │  │Session │
  │task-123│  │task-124│  │task-125│
  └───┬────┘  └───┬────┘  └───┬────┘
      │            │            │
      └────────────┼────────────┘
                   ▼
          ┌────────────────┐
          │ Results File   │
          │.loop-task-     │
          │output.json    │
          └────────────────┘
```

---

## 📁 Files to Create/Modify

### 1. Database Layer (`server/db.js`)

**Table Addition:**
```sql
CREATE TABLE IF NOT EXISTS projects_config (
  project    TEXT NOT NULL PRIMARY KEY,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**CRUD Functions to Add:**
```javascript
export function listProjectConfigs()
export function getProjectConfig(project)
export function upsertProjectConfig({ project, path })
export function deleteProjectConfig(project)
```

---

### 2. API Layer (`server/index.js`)

**Endpoints to Add:**

```
GET    /api/projects-config
POST   /api/projects-config
       Body: { project, path }
       Returns: { project, path, created_at, updated_at }

DELETE /api/projects-config/:project
       Returns: 204

POST   /api/test-path
       Body: { path }
       Returns: { exists: boolean, error?: string }
```

---

### 3. Web API Client (`web/src/api.js`)

**Functions to Add:**
```javascript
getProjectsConfig()
createProjectConfig({ project, path })
deleteProjectConfig(project)
```

---

### 4. Main UI (`web/src/App.jsx`)

**Changes:**
- Add state: `const [showConfig, setShowConfig] = useState(false)`
- Add button in header:
  ```jsx
  <button onClick={() => setShowConfig(true)}>
    ⚙️ Configure
  </button>
  ```
- Add modal rendering:
  ```jsx
  {showConfig && (
    <ProjectsConfig
      onClose={() => setShowConfig(false)}
      onChanged={refresh}
    />
  )}
  ```

---

### 5. Task Drawer UI (`web/src/components/TaskDrawer.jsx`)

**Changes:**
- Add `ResumeButton` component (see below)
- Render when `task.session_id` exists:
  ```jsx
  {task.session_id && (
    <ResumeButton
      session_id={task.session_id}
      project_path={task.project_path}
    />
  )}
  ```

**ResumeButton Component:**
```jsx
function ResumeButton({ session_id, project_path }) {
  const [copied, setCopied] = useState(false);
  const [showCommand, setShowCommand] = useState(false);

  const resumeCommand = `claude --resume ${session_id}`;
  const fullCommand = project_path
    ? `cd ${project_path} && ${resumeCommand}`
    : resumeCommand;

  if (!session_id) return null;

  return (
    <div className="mt-2">
      {showCommand ? (
        <div className="rounded bg-slate-100 p-2">
          <code className="block text-xs text-slate-600">{fullCommand}</code>
          <div className="mt-2 flex gap-2">
            <button onClick={() => {
              navigator.clipboard?.writeText(fullCommand);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}>
              {copied ? '✓ Copied!' : 'Copy command'}
            </button>
            <button onClick={() => setShowCommand(false)}>
              Hide
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowCommand(true)}>
          🖥 Resume session
        </button>
      )}
    </div>
  );
}
```

---

### 6. Projects Config UI (NEW FILE)

**Path:** `web/src/components/ProjectsConfig.jsx`

**Features:**
- List all project configurations
- Add new configuration (project label + path)
- Edit existing configuration
- Delete configuration
- Test path exists button
- Error handling

**Key Functions:**
```javascript
load() - Fetch configs from API
handleCreate() - Create new config
handleDelete(project) - Delete config
handleTestPath(path) - Validate path exists
```

---

### 7. Work-Board-Task Skill (NEW FILE)

**Path:** `.claude/skills/loop-board-work-board-task/SKILL.md`

**Purpose:** Execute single task in project session

**Workflow:**
1. Parse task_id from session name (`task-123-xxx` → `123`)
2. Call `loop-board show <id>` to get task details
3. Create branch: `task/<id>-<slug>`
4. Implement task (read description + DoD)
5. Run tests
6. Commit changes
7. Write results to `.loop-task-output.json`:
   ```json
   {
     "task_id": 123,
     "session_title": "task-123-auth-refactor",
     "summary": "...",
     "files_changed": ["src/auth.js"],
     "test_results": "✅ All tests passed"
   }
   ```
8. Call `loop-board answer <id> --answer-file ... --session-id ... --status pending_review`

**Key Commands:**
```bash
loop-board show <id>
git checkout -b task/<id>-<slug>
# ... implementation ...
git add .
git commit -m "..."
loop-board answer <id> --answer-file output.md --session-id $(claude --session-id) --status pending_review
```

---

### 8. Run-Board-Orchestrator Skill (NEW FILE)

**Path:** `.claude/skills/loop-board-run-board-orchestrator/SKILL.md`

**Purpose:** Coordinate multi-project task execution

**Workflow:**
1. Fetch all project configurations via API
2. For each project:
   - Call `/api/projects?project=xxx` to check for backlog tasks
   - If tasks exist, process highest priority one:
     - Read project path from config
     - `cd <project_path>`
     - Start sub-session:
       ```bash
       claude -n task-<id>-<slug> \
         -p "Use loop-board-work-board-task skill to execute this task" \
         --output-format json
       ```
     - Capture `session_id` from output
     - Wait for completion:
       - Poll every 30s: `loop-board show <id>`
       - Check if status = `pending_review` or `done`
       - Check session log mtime (10min timeout)
       - If timeout: mark failed, add comment
     - Read `.loop-task-output.json`
     - Report results to user
3. Repeat until all projects checked

**Session Log Check:**
```bash
# Check last modification time of session log
SESSION_LOG="~/.claude/projects/<project>/<session-id>.jsonl"
if [[ -f "$SESSION_LOG" ]]; then
  LAST_UPDATE=$(stat -c %Y "$SESSION_LOG")
  NOW=$(date +%s)
  if [[ $((NOW - LAST_UPDATE)) -gt 600 ]]; then
    # 10 minutes no update = timeout
    mark_task_failed <id> "Session timeout - no activity for 10 minutes"
  fi
fi
```

---

### 9. Unit Tests (NEW FILES)

#### `tests/db.test.js` (31 tests)

**Test Categories:**
- Tasks CRUD (create, read, update, delete, list)
- Events (add, retrieve)
- Project aggregation (distinctProjects)
- Task claiming (claimNext transaction)
- **Projects Config CRUD** (list, get, upsert, delete)

**Key Test Cases:**
```javascript
describe('Projects Config', () => {
  it('should create a config', () => { ... })
  it('should upsert existing config', () => { ... })
  it('should get a config', () => { ... })
  it('should list all configs', () => { ... })
  it('should delete a config', () => { ... })
  it('should handle non-existent config', () => { ... })
});
```

**Test Setup:**
```javascript
const TEST_DB = mkdtempSync(tmpdir() + '/loopboard-test-');
process.env.BOARD_DB = join(TEST_DB, 'test.db');
import { db, ... } from '../server/db.js';

beforeEach(() => {
  db.exec('DELETE FROM tasks');
  db.exec('DELETE FROM task_events');
  db.exec('DELETE FROM projects_config');
});
```

#### `tests/api.test.js` (22 tests)

**Test Categories:**
- Health check
- Tasks CRUD endpoints
- Projects endpoint
- **Projects Config endpoints** (GET, POST, DELETE)
- **Test-path endpoint**

**Test Setup:**
```javascript
const TEST_PORT = 15999;
const TEST_DB = mkdtempSync(tmpdir() + '/loopboard-api-test-');
process.env.BOARD_DB = TEST_DB;
process.env.BOARD_PORT = String(TEST_PORT);

import { db, ... } from '../server/db.js';
import express from 'express';
const app = createTestApp();
let testServer;

before(() => {
  testServer = app.listen(TEST_PORT);
  await new Promise(resolve => testServer.on('listening', resolve));
});

after(() => {
  testServer.close();
  rmSync(TEST_DIR, { recursive: true });
});

async function http(method, path, body) {
  const res = await fetch(`http://localhost:${TEST_PORT}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}
```

---

### 10. E2E Tests (NEW FILE)

**Path:** `e2e/e2e.test.js` (6 tests)

**Test Scenarios:**
1. **Full task lifecycle:**
   - Create task
   - Claim via API
   - Update to pending_review
   - Mark done
   - Verify events

2. **Projects config lifecycle:**
   - Create config
   - List configs
   - Upsert config
   - Delete config
   - Verify operations

3. **Path testing:**
   - Test existing path
   - Test non-existing path
   - Validate response

4. **Task filtering:**
   - Create tasks for multiple projects
   - Filter by project
   - Filter by status
   - Verify results

5. **Concurrent claims:**
   - Create multiple tasks
   - Claim in parallel
   - Verify only one claimed

6. **Integration test:**
   - Full orchestrator simulation
   - Config + task + claim + answer

**Test Setup:**
```javascript
const E2E_PORT = 15601;
const BASE_URL = `http://localhost:${E2E_PORT}`;
process.env.BOARD_PORT = String(E2E_PORT);

await import('../server/index.js');
await new Promise(r => setTimeout(r, 200));

async function req(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, { ... });
  return { status: res.status, data: await res.json() };
}
```

---

### 11. Test Configuration (NEW FILES)

#### `vitest.config.js`

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/*.test.js'],
    globals: true,
  },
});
```

#### `vitest.e2e.config.js`

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/*.test.js'],
    globals: true,
  },
});
```

---

### 12. Package Configuration (`package.json`)

**Add dependencies:**
```json
{
  "devDependencies": {
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "supertest": "^7.0.0"
  },
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest --config vitest.config.js",
    "test:e2e": "vitest --config vitest.e2e.config.js",
    "test:coverage": "vitest --coverage"
  }
}
```

---

## 🧪 Testing Strategy

### Unit Tests
- **DB Tests:** 31 tests covering all CRUD operations
- **API Tests:** 22 tests covering all endpoints
- **Run:** `npm run test:unit`
- **Expected:** All passing

### E2E Tests
- **Scenario Tests:** 6 full workflow tests
- **Run:** `npm run test:e2e`
- **Expected:** All passing

### Test Commands
```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:e2e      # E2E tests only
npm run test:coverage # With coverage report
```

---

## 🚀 Usage Flow

### 1. Initial Setup

**Configure Projects:**
```bash
# Via UI
# 1. Open http://localhost:5151
# 2. Click "⚙️ Configure"
# 3. Add project: my-app → /path/to/my-app
# 4. Test path to verify

# Or via API
curl -X POST http://localhost:5151/api/projects-config \
  -H 'content-type: application/json' \
  -d '{"project":"my-app","path":"/path/to/my-app"}'
```

### 2. Run Orchestrator

```bash
cd /path/to/loop-board
claude
# Say: "Use loop-board-run-board-orchestrator skill"
```

**What happens:**
1. Fetches project configs
2. Checks each project for backlog tasks
3. For each task:
   - Spawns sub-session in project directory
   - Waits for completion (30s polling)
   - Collects results
   - Reports to you

### 3. Resume a Session

**Via UI:**
1. Open task details
2. Click "🖥 Resume session"
3. Copy command
4. Paste in terminal

**Manual:**
```bash
cd /path/to/project
claude --resume <session_id>
```

---

## 📊 Expected Outcomes

### Database
- `projects_config` table created
- CRUD functions working
- Data persisted across restarts

### API
- All endpoints returning correct data
- Proper error handling
- CORS enabled for web UI

### UI
- Configure modal functional
- Resume button showing correct command
- Path testing working

### Skills
- `loop-board-work-board-task` executing tasks correctly
- `loop-board-run-board-orchestrator` coordinating across projects
- Sessions spawning and completing

### Tests
- 59/59 tests passing (31 DB + 22 API + 6 E2E)
- Full coverage of new features

---

## 🔒 Security Considerations

### Path Validation
- `POST /api/test-path` checks existence before trusting
- Prevents path traversal attacks

### Session ID Scope
- Only used in project directory where created
- Cannot be used from different project

### API Security
- All inputs validated
- SQL injection prevented via prepared statements
- XSS prevented via React's default escaping

---

## 🐛 Known Issues/Limitations

### Session ID Scope
Claude Code's `claude --resume` only works in the same project directory where the session was created. This is a limitation of Claude Code itself.

### Worktree Support
Not yet implemented. Currently one task per project at a time. Future enhancement: use git worktree for concurrent tasks.

### Timeout Detection
Relies on session log file existence and mtime. If logs are disabled or purged, falls back to 30-minute fixed timeout.

---

## 📝 Checklist

- [ ] Add projects_config table to `server/db.js`
- [ ] Add CRUD functions to `server/db.js`
- [ ] Add 4 endpoints to `server/index.js`
- [ ] Add 3 functions to `web/src/api.js`
- [ ] Add Configure button to `web/src/App.jsx`
- [ ] Create `web/src/components/ProjectsConfig.jsx`
- [ ] Add Resume button to `web/src/components/TaskDrawer.jsx`
- [ ] Create `.claude/skills/loop-board-work-board-task/SKILL.md`
- [ ] Create `.claude/skills/loop-board-run-board-orchestrator/SKILL.md`
- [ ] Create `tests/db.test.js` (31 tests)
- [ ] Create `tests/api.test.js` (22 tests)
- [ ] Create `e2e/e2e.test.js` (6 tests)
- [ ] Create `vitest.config.js`
- [ ] Create `vitest.e2e.config.js`
- [ ] Update `package.json` with test deps
- [ ] Run `npm install`
- [ ] Run tests: `npm test`
- [ ] All tests passing
- [ ] Commit changes
- [ ] Push to GitHub fork

---

## 🎯 Success Criteria

1. ✅ All 59 tests passing
2. ✅ UI showing Configure button and Resume button
3. ✅ API endpoints responding correctly
4. ✅ Orchestrator skill spawning sub-sessions
5. ✅ Results collected and reported
6. ✅ Session resume working
7. ✅ No personal files (`.openclaw`, `memory`, etc.) in repository

---

**File Location:** `/home/chopper/workspace/loop-board-orchestration-implementation-plan.md`