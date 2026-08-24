import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runPerformanceAcceptance } from '../../evals/run-performance.js';

test('upload, search, chat and publication P95/effectiveness meet MVP limits', async (t) => {
  const report = await runPerformanceAcceptance();
  t.diagnostic(JSON.stringify(report.metricsMs));
  assert.equal(report.iterations, 20);
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.ok(report.metricsMs.uploadP95 <= 2000);
  assert.ok(report.metricsMs.searchP95 <= 5000);
  assert.ok(report.metricsMs.chatP95 <= 20000);
  assert.ok(report.metricsMs.publishDisableEffective <= 10000);
  assert.deepEqual(report.publicationVisibility, { publishedVisible: true, disabledHidden: true });
});
