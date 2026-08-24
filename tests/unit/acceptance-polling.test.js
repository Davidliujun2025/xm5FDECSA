import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { getAcceptanceJob } from '../../frontend/src/api/acceptance-client.js';
import { initializeBrowserSession } from '../../frontend/src/api/rag-client.js';
import { pollAcceptanceJob } from '../../frontend/src/components/acceptance-polling.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('controlled polling maps queued, processing and succeeded responses to uploaded, processing and ready', async () => {
  const jobs = [
    { status: 'QUEUED', stage: 'QUEUED' },
    { status: 'PROCESSING', stage: 'EMBEDDING' },
    { status: 'SUCCEEDED', stage: 'READY' }
  ];
  const phases = [];
  const observedJobs = [];
  const delays = [];
  const document = { documentId: `doc_${'a'.repeat(32)}`, status: 'READY' };
  const result = await pollAcceptanceJob({
    jobId: `job_${'b'.repeat(32)}`,
    documentId: document.documentId,
    fetchJob: async () => jobs.shift(),
    fetchDocument: async () => document,
    onJob: (job) => observedJobs.push(job.status),
    onPhase: (phase) => phases.push(phase),
    sleep: async (milliseconds) => delays.push(milliseconds)
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.document, document);
  assert.deepEqual(observedJobs, ['QUEUED', 'PROCESSING', 'SUCCEEDED']);
  assert.deepEqual(phases, ['uploaded', 'processing', 'ready']);
  assert.deepEqual(delays, [650, 650]);
});

test('FAILED preserves errorCode, message and traceId', async () => {
  await assert.rejects(
    pollAcceptanceJob({
      jobId: `job_${'c'.repeat(32)}`,
      documentId: `doc_${'d'.repeat(32)}`,
      fetchJob: async () => ({
        status: 'FAILED',
        errorCode: 'RAG_FILE_INVALID',
        errorMessage: '文档解析失败',
        traceId: 'trace_failed_job'
      }),
      fetchDocument: async () => assert.fail('FAILED must not fetch a document')
    }),
    (error) => error.errorCode === 'RAG_FILE_INVALID'
      && error.message === '文档解析失败'
      && error.traceId === 'trace_failed_job'
  );
});

test('polling times out at 120 seconds and stops updates after cancellation', async () => {
  let clock = 0;
  let calls = 0;
  await assert.rejects(
    pollAcceptanceJob({
      jobId: `job_${'e'.repeat(32)}`,
      documentId: `doc_${'f'.repeat(32)}`,
      fetchJob: async () => {
        calls += 1;
        return { status: 'PROCESSING', stage: 'PARSING' };
      },
      fetchDocument: async () => assert.fail('timeout must not fetch a document'),
      timeoutMs: 120_000,
      intervalMs: 60_000,
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      }
    }),
    (error) => error.errorCode === 'LOCAL_POLL_TIMEOUT'
  );
  assert.equal(clock, 120_000);
  assert.equal(calls, 2);

  let timeoutAbortedRequest = false;
  await assert.rejects(
    pollAcceptanceJob({
      jobId: `job_${'6'.repeat(32)}`,
      documentId: `doc_${'7'.repeat(32)}`,
      fetchJob: async (jobId, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          timeoutAbortedRequest = true;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      }),
      fetchDocument: async () => assert.fail('timed out polling must not fetch a document'),
      timeoutMs: 5
    }),
    (error) => error.errorCode === 'LOCAL_POLL_TIMEOUT'
  );
  assert.equal(timeoutAbortedRequest, true);

  let active = true;
  let updates = 0;
  const cancelled = await pollAcceptanceJob({
    jobId: `job_${'1'.repeat(32)}`,
    documentId: `doc_${'2'.repeat(32)}`,
    fetchJob: async () => {
      active = false;
      return { status: 'PROCESSING', stage: 'PARSING' };
    },
    fetchDocument: async () => assert.fail('cancelled polling must not fetch a document'),
    isActive: () => active,
    onJob: () => {
      updates += 1;
    }
  });
  assert.deepEqual(cancelled, { status: 'CANCELLED' });
  assert.equal(updates, 0);

  const controller = new AbortController();
  let requestAborted = false;
  const hanging = pollAcceptanceJob({
    jobId: `job_${'4'.repeat(32)}`,
    documentId: `doc_${'5'.repeat(32)}`,
    fetchJob: async (jobId, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        requestAborted = true;
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    }),
    fetchDocument: async () => assert.fail('cancelled polling must not fetch a document'),
    signal: controller.signal
  });
  controller.abort();
  assert.deepEqual(await hanging, { status: 'CANCELLED' });
  assert.equal(requestAborted, true);
});

test('Job client captures response trace and component exposes reset plus failure details', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    if (url.includes('browser-session')) {
      return new Response(null, { status: 204 });
    }
    return Response.json(
      { jobId: `job_${'3'.repeat(32)}`, status: 'FAILED', errorCode: 'RAG_JOB_FAILED', errorMessage: '任务失败' },
      { headers: { 'X-Trace-Id': 'trace_job_response' } }
    );
  };
  await initializeBrowserSession({ force: true });
  const job = await getAcceptanceJob(`job_${'3'.repeat(32)}`);
  assert.equal(job.traceId, 'trace_job_response');

  const component = readFileSync(path.join(ROOT, 'frontend/src/components/UploadAcceptance.jsx'), 'utf8');
  assert.equal(component.includes('setFile(null)'), true);
  assert.equal(component.includes("setPhase('idle')"), true);
  assert.equal(component.includes('setJob(null)'), true);
  assert.equal(component.includes('setDocument(null)'), true);
  assert.equal(component.includes('traceId: {error.traceId}'), true);
  assert.equal(component.includes('controller.abort()'), true);
});
