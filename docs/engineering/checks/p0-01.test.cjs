const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { test } = require('node:test');

const root = resolve(__dirname, '../../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

test('P0-01-AC1: conventions, local skills and document links resolve', () => {
  const docs = ['AGENTS.md', 'docs/agents/issue-tracker.md', 'docs/agents/domain.md',
    'docs/engineering/BASELINE-INVENTORY.md', 'docs/engineering/records/P0-01.md'];
  for (const name of ['access-and-data', 'session-execution', 'realtime-media', 'testing-and-release']) {
    const path = `skills/debrio-${name}/SKILL.md`;
    const content = readFileSync(resolve(root, path), 'utf8');
    assert.match(content, new RegExp(`^---\\r?\\nname: debrio-${name}\\r?\\ndescription: [^\\r\\n]+\\r?\\n---`));
    assert.ok(readFileSync(resolve(root, 'AGENTS.md'), 'utf8').includes(path), path);
    docs.push(path);
  }
  for (const path of docs) {
    const content = readFileSync(resolve(root, path), 'utf8');
    for (const [, target] of content.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(https?:|#)/.test(target)) continue;
      assert.ok(existsSync(resolve(root, dirname(path), target.split('#')[0])), `${path}: ${target}`);
    }
  }
  for (const path of ['GLOSSARY.md', 'docs/adr/0001-modular-application.md',
    'docs/Debrio_PRD_v0.5.md', 'docs/engineering/WORKFLOW.md',
    'docs/engineering/SKILLS.md', 'docs/engineering/QUALITY-BAR.md',
    'docs/engineering/PROMPTBOOK.md', 'docs/engineering/PROGRESS.md']) {
    assert.ok(existsSync(resolve(root, path)), path);
  }
  assert.match(readFileSync(resolve(root, 'docs/agents/issue-tracker.md'), 'utf8'), /Seth-arc\/debrio/);
});

test('P0-01-AC3: local evidence and secrets are ignored; required assets are eligible', () => {
  const ignored = ['.env', '.env.local', 'demo/.env.production', '.aws/credentials',
    '.secrets/key.pem', '.artifacts/P0-01/demo.mp4', '.playwright-mcp/page.yml',
    'playwright/.auth/user.json', 'demo/playwright/.auth/user.json',
    'playwright-report/index.html', 'demo/test-results/result.json',
    'node_modules/pkg/index.js', 'demo/node_modules/pkg/index.js',
    '.next/cache/build', 'out/index.html', 'dist/app.js', 'build/app.js',
    'coverage/index.html', '.vercel/project.json'];
  const eligible = ['.env.example', '.env.production.example', 'demo/.env.example',
    'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'demo/package.json',
    'demo/assets/Debrio_Lobby_music.wav', 'demo/assets/PublicSans.woff2',
    'demo/assets/PublicSans-LICENSE.txt', 'demo/assets/logo.svg',
    'demo/landing-reference.png', 'docs/Debrio_loading.gif', 'AGENTS.md',
    'docs/engineering/records/P0-01.md', 'supabase/config.toml',
    'supabase/migrations/20261118120000_create_workspaces.sql'];
  for (const [paths, expected] of [[ignored, 0], [eligible, 1]]) {
    for (const path of paths) {
      const result = spawnSync('git', ['check-ignore', '--no-index', '-q', '--', path], { cwd: root });
      assert.equal(result.status, expected, path);
    }
  }
});

test('P0-01-AC3: browser captures are no longer tracked', () => {
  assert.equal(git('ls-files', '--', '.playwright-mcp/'), '');
});
