import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';

import {
  createParserRequest,
  PARSER_MESSAGE,
  restoreParserFailure
} from './parser-worker.protocol.js';

export class ParserWorkerClient extends EventEmitter {
  #worker;
  #pending = new Map();
  #tail = Promise.resolve();
  #closed = false;

  constructor({ workerUrl = new URL('./parser.worker.js', import.meta.url) } = {}) {
    super();
    this.workerUrl = workerUrl;
  }

  #ensureWorker() {
    if (this.#closed) {
      throw new Error('parser worker is closed');
    }
    if (this.#worker) {
      return this.#worker;
    }
    const worker = new Worker(this.workerUrl, { type: 'module' });
    worker.on('message', (message) => this.#handleMessage(message));
    worker.on('error', () => this.#failPending());
    worker.on('exit', (code) => {
      this.#worker = undefined;
      if (!this.#closed && code !== 0) {
        this.#failPending();
      }
    });
    this.#worker = worker;
    return worker;
  }

  #failPending() {
    const error = restoreParserFailure();
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #handleMessage(message) {
    const pending = this.#pending.get(message?.requestId);
    if (!pending) {
      return;
    }
    if (message.type === PARSER_MESSAGE.STARTED) {
      this.emit('started', { requestId: message.requestId, threadId: message.threadId });
      return;
    }
    this.#pending.delete(message.requestId);
    if (message.type === PARSER_MESSAGE.COMPLETED) {
      this.emit('completed', { requestId: message.requestId, threadId: message.threadId });
      pending.resolve(message.result);
      return;
    }
    if (message.type === PARSER_MESSAGE.FAILED) {
      const error = restoreParserFailure(message.error);
      this.emit('failed', {
        requestId: message.requestId,
        threadId: message.threadId,
        errorCode: error.errorCode
      });
      pending.reject(error);
    }
  }

  parse(payload, options = {}) {
    const run = this.#tail.then(() => new Promise((resolve, reject) => {
      const requestId = randomUUID();
      this.#pending.set(requestId, { resolve, reject });
      this.#ensureWorker().postMessage(createParserRequest(requestId, payload, options));
    }));
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async close() {
    this.#closed = true;
    this.#failPending();
    const worker = this.#worker;
    this.#worker = undefined;
    if (worker) {
      await worker.terminate();
    }
  }
}
