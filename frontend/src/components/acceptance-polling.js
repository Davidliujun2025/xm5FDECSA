const JOB_STATUSES = new Set(['QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED']);

function pollError(errorCode, message, traceId = null) {
  return Object.assign(new Error(message), { errorCode, traceId });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function pollAcceptanceJob({
  jobId,
  documentId,
  fetchJob,
  fetchDocument,
  onJob = () => {},
  onPhase = () => {},
  isActive = () => true,
  intervalMs = 650,
  timeoutMs = 120_000,
  now = Date.now,
  sleep = delay,
  signal
}) {
  if (signal?.aborted) {
    return { status: 'CANCELLED' };
  }
  const deadline = now() + timeoutMs;
  const requestController = new AbortController();
  let removeCancellation = () => {};
  const cancellation = signal
    ? new Promise((resolve) => {
      const cancel = () => {
        resolve({ status: 'CANCELLED' });
        requestController.abort();
      };
      signal.addEventListener('abort', cancel, { once: true });
      removeCancellation = () => signal.removeEventListener('abort', cancel);
    })
    : new Promise(() => {});
  let timeoutHandle;
  const timeout = new Promise((resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(pollError('LOCAL_POLL_TIMEOUT', '等待解析结果超时，请检查任务状态。'));
      requestController.abort();
    }, timeoutMs);
  });
  const run = (async () => {
    while (isActive()) {
      if (now() >= deadline) {
        throw pollError('LOCAL_POLL_TIMEOUT', '等待解析结果超时，请检查任务状态。');
      }
      const currentJob = await fetchJob(jobId, { signal: requestController.signal });
      if (!isActive()) {
        return { status: 'CANCELLED' };
      }
      if (!currentJob || !JOB_STATUSES.has(currentJob.status)) {
        throw pollError('LOCAL_JOB_RESPONSE_INVALID', '任务状态响应无法识别。', currentJob?.traceId);
      }
      onJob(currentJob);
      if (currentJob.status === 'FAILED') {
        throw pollError(
          currentJob.errorCode || 'RAG_INGESTION_FAILED',
          currentJob.errorMessage || '文档处理失败',
          currentJob.traceId
        );
      }
      if (currentJob.status === 'SUCCEEDED') {
        const currentDocument = await fetchDocument(documentId, { signal: requestController.signal });
        if (!isActive()) {
          return { status: 'CANCELLED' };
        }
        if (currentDocument?.status !== 'READY') {
          throw pollError(
            'LOCAL_DOCUMENT_RESPONSE_INVALID',
            '任务完成，但文档未进入 READY。',
            currentDocument?.traceId || currentJob.traceId
          );
        }
        onPhase('ready');
        return { status: 'READY', job: currentJob, document: currentDocument };
      }
      onPhase(currentJob.status === 'PROCESSING' ? 'processing' : 'uploaded');
      const remainingMs = deadline - now();
      if (remainingMs <= 0) {
        throw pollError('LOCAL_POLL_TIMEOUT', '等待解析结果超时，请检查任务状态。');
      }
      await sleep(Math.min(intervalMs, remainingMs));
    }
    return { status: 'CANCELLED' };
  })();
  try {
    return await Promise.race([run, timeout, cancellation]);
  } finally {
    clearTimeout(timeoutHandle);
    removeCancellation();
    requestController.abort();
  }
}
