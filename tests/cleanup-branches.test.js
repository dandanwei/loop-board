import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise `loop-board cleanup-branches` against a throwaway git repo. We pass
// --no-board so the command is pure git and needs no running server.
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'board.js');

let repo;

// Run git inside the scratch repo.
function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

// Run the CLI inside the scratch repo and return parsed --json output.
function cleanup(extra = []) {
  const out = execFileSync('node', [CLI, 'cleanup-branches', '--no-board', '--default', 'master', '--json', ...extra], {
    cwd: repo,
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'loopboard-cleanup-'));
  // Deterministic identity + default branch, independent of the host's git config.
  execFileSync('git', ['-c', 'init.defaultBranch=master', 'init'], { cwd: repo });
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '--allow-empty', '-m', 'init'); // master has one commit

  // A merged branch: branch off, commit, merge back into master.
  git('checkout', '-b', 'task/1-done');
  git('commit', '--allow-empty', '-m', 'work on task 1');
  git('checkout', 'master');
  git('merge', '--no-ff', 'task/1-done', '-m', 'merge task 1');

  // An unmerged branch: a commit that never lands on master.
  git('checkout', '-b', 'task/2-wip');
  git('commit', '--allow-empty', '-m', 'work on task 2 (not merged)');

  // Sit on master so neither task branch is "current".
  git('checkout', 'master');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('cleanup-branches', () => {
  it('dry run lists merged branches but deletes nothing', () => {
    const res = cleanup();
    expect(res.applied).toBe(false);
    expect(res.candidates.map((c) => c.branch)).toEqual(['task/1-done']);
    expect(res.deleted).toEqual([]);
    // Both branches still present.
    const branches = git('branch', '--format=%(refname:short)').split('\n');
    expect(branches).toContain('task/1-done');
    expect(branches).toContain('task/2-wip');
  });

  it('--apply deletes merged branches and keeps unmerged + default', () => {
    const res = cleanup(['--apply']);
    expect(res.applied).toBe(true);
    expect(res.deleted).toEqual(['task/1-done']);
    expect(res.failed).toEqual([]);

    const branches = git('branch', '--format=%(refname:short)').split('\n');
    expect(branches).not.toContain('task/1-done'); // merged → removed
    expect(branches).toContain('task/2-wip'); // unmerged → kept
    expect(branches).toContain('master'); // default → kept

    // The remaining list the command reports matches reality.
    const remaining = res.remaining.map((r) => r.branch).sort();
    expect(remaining).toEqual(['master', 'task/2-wip']);
  });

  it('never deletes the current branch even if it is merged', () => {
    // task/1-done is merged; check it out so it becomes "current".
    git('checkout', 'task/1-done');
    const res = execFileSync(
      'node',
      [CLI, 'cleanup-branches', '--no-board', '--default', 'master', '--json', '--apply'],
      { cwd: repo, encoding: 'utf8' }
    );
    const parsed = JSON.parse(res);
    expect(parsed.deleted).toEqual([]); // current branch protected
    expect(git('branch', '--format=%(refname:short)').split('\n')).toContain('task/1-done');
  });
});
