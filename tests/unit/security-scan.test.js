import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanFrontendBundle, scanRepository } from '../../scripts/security-scan.js';

function git(repositoryRoot, ...args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
}

test('security gate rejects forced forbidden files and real-looking secrets, then recovers cleanly', async (t) => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'rag-security-gate-'));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  git(repositoryRoot, 'init', '--quiet');

  await mkdir(path.join(repositoryRoot, 'tests', 'fixtures'), { recursive: true });
  await writeFile(path.join(repositoryRoot, '.env.example'), 'MODEL_API_KEY=\n', 'utf8');
  await writeFile(
    path.join(repositoryRoot, 'tests', 'fixtures', 'synthetic.md'),
    '# SYNTHETIC TEST DATA\nNo enterprise source content.\n',
    'utf8'
  );
  git(repositoryRoot, 'add', '--', '.env.example', 'tests/fixtures/synthetic.md');
  assert.deepEqual(scanRepository({ repositoryRoot }).violations, []);

  await mkdir(path.join(repositoryRoot, 'artifacts'), { recursive: true });
  await writeFile(path.join(repositoryRoot, 'artifacts', 'release.zip'), 'temporary test artifact', 'utf8');
  const modelKeyName = ['MODEL', 'API', 'KEY'].join('_');
  const githubTokenName = ['GITHUB', 'TOKEN'].join('_');
  await writeFile(
    path.join(repositoryRoot, 'secret.txt'),
    `${modelKeyName}=real_${'s'.repeat(40)}\n${githubTokenName}=ghp_${'A'.repeat(36)}\n`,
    'utf8'
  );
  git(repositoryRoot, 'add', '--force', '--', 'artifacts/release.zip', 'secret.txt');
  const failed = scanRepository({ repositoryRoot });
  assert.ok(failed.violations.some((violation) => violation.includes('artifacts/release.zip')));
  assert.ok(failed.violations.some((violation) => violation.includes('secret.txt')));

  git(repositoryRoot, 'rm', '--force', '--', 'artifacts/release.zip', 'secret.txt');
  assert.deepEqual(scanRepository({ repositoryRoot }).violations, []);
});

test('frontend bundle scan rejects long-lived credential identifiers', async (t) => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'rag-browser-bundle-'));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  const bundleRoot = path.join(repositoryRoot, 'frontend', 'dist', 'assets');
  await mkdir(bundleRoot, { recursive: true });
  await writeFile(path.join(bundleRoot, 'index.js'), 'const safeBrowserSession = true;\n', 'utf8');
  assert.deepEqual(scanFrontendBundle({ repositoryRoot }), {
    violations: [],
    scannedBundleFiles: 1
  });

  const forbiddenName = ['RAG', 'API', 'KEY'].join('_');
  await writeFile(path.join(bundleRoot, 'leak.js'), `const leakedName = '${forbiddenName}';\n`, 'utf8');
  const failed = scanFrontendBundle({ repositoryRoot });
  assert.equal(failed.scannedBundleFiles, 2);
  assert.ok(failed.violations.some((violation) => violation.includes('frontend/dist/assets/leak.js')));
});
