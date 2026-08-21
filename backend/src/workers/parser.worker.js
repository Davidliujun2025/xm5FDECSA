import { parentPort, threadId } from 'node:worker_threads';

import { parseAndChunkDocument } from '../services/ingestion.service.js';
import { PARSER_MESSAGE, serializeParserFailure } from './parser-worker.protocol.js';

if (!parentPort) {
  throw new Error('parser worker must run in a worker thread');
}

parentPort.on('message', async (message) => {
  if (message?.type !== PARSER_MESSAGE.REQUEST || typeof message.requestId !== 'string') {
    return;
  }
  const { requestId } = message;
  parentPort.postMessage({
    type: PARSER_MESSAGE.STARTED,
    requestId,
    threadId
  });
  try {
    const result = await parseAndChunkDocument(message.payload, message.options);
    parentPort.postMessage({
      type: PARSER_MESSAGE.COMPLETED,
      requestId,
      threadId,
      result
    });
  } catch (error) {
    parentPort.postMessage({
      type: PARSER_MESSAGE.FAILED,
      requestId,
      threadId,
      error: serializeParserFailure(error)
    });
  }
});
