import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';

import { APP_ROOT } from '../../backend/src/app.js';

test('release ZIP is reproducibly staged into two clean roots without runtime or secret material', {
  skip: process.platform === 'win32' ? false : 'requires Windows PowerShell scripts'
}, () => {
  const output = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(APP_ROOT, 'scripts/test-portable-release.ps1')
  ], { cwd: APP_ROOT, encoding: 'utf8', timeout: 30_000 });
  assert.match(output, /RELEASE_CREATED/);
  assert.match(output, /PORTABLE_REHEARSAL_PASSED/);
  assert.match(output, /"expanded"\s*:\s*true/i);
  assert.match(output, /"installedAndStarted"\s*:\s*false/i);
});
