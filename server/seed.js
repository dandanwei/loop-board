// Inserts a couple of demo tasks so the board isn't empty on first run.
// Safe to run repeatedly — it only seeds when the tasks table is empty.
import { db, createTask } from './db.js';

const count = db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
if (count > 0) {
  console.log(`Board already has ${count} task(s) — skipping seed.`);
  process.exit(0);
}

createTask({
  title: 'Add a /health endpoint smoke test',
  project: 'demo',
  priority: 2,
  description:
    'We need a tiny test that hits the local API `/health` endpoint and asserts it returns `{ ok: true }`.',
  definition_of_done:
    '- A test exists that calls GET /api/health\n- It asserts the response status is 200\n- It asserts `ok === true`\n- The test runs green',
});

createTask({
  title: 'Document the local API in the README',
  project: 'demo',
  priority: 3,
  description:
    'List every endpoint with method, path, and an example request/response so newcomers can use the API without reading the source.',
  definition_of_done:
    '- Every /api route is listed\n- Each has a curl example\n- README renders cleanly',
});

console.log('Seeded 2 demo tasks under project "demo".');
