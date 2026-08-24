import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IngestionJobLoop } from '../../backend/src/workers/ingestion-job-loop.js';

test('empty job loop waits instead of busy polling', async () => {
  let claims = 0;
  const repository = {
    recoverInterrupted: () => ({ jobs: 0, documents: 0 }),
    claimNext: () => {
      claims += 1;
      return null;
    }
  };
  const loop = new IngestionJobLoop({
    repository,
    ingestionService: { process: async () => assert.fail('no empty job should be processed') },
    idleWaitMs: 40
  });
  loop.start();
  await new Promise((resolve) => setTimeout(resolve, 115));
  await loop.stop();
  assert.ok(claims >= 2 && claims <= 4, claims);
});
