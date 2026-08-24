import { EventEmitter } from 'node:events';

export class IngestionJobLoop extends EventEmitter {
  #running = false;
  #loopPromise;
  #idleResolve;
  #idleTimer;

  constructor({ repository, ingestionService, logger, idleWaitMs = 1000 }) {
    super();
    this.repository = repository;
    this.ingestionService = ingestionService;
    this.logger = logger;
    this.idleWaitMs = idleWaitMs;
  }

  start() {
    if (this.#running) {
      return;
    }
    const recovered = this.repository.recoverInterrupted();
    this.emit('recovered', recovered);
    this.#running = true;
    this.#loopPromise = this.#run();
  }

  wake() {
    if (this.#idleResolve) {
      const resolve = this.#idleResolve;
      this.#idleResolve = undefined;
      clearTimeout(this.#idleTimer);
      this.#idleTimer = undefined;
      resolve();
    }
  }

  async #waitForWork() {
    this.emit('idle');
    await new Promise((resolve) => {
      this.#idleResolve = resolve;
      this.#idleTimer = setTimeout(() => {
        this.#idleResolve = undefined;
        this.#idleTimer = undefined;
        resolve();
      }, this.idleWaitMs);
      this.#idleTimer.unref?.();
    });
  }

  async #run() {
    while (this.#running) {
      let claimed;
      try {
        claimed = this.repository.claimNext();
      } catch (error) {
        this.logger?.error({ operation: 'ingestion.claim.failed', errorCode: error.errorCode }, 'job claim failed');
        await this.#waitForWork();
        continue;
      }
      if (!claimed) {
        await this.#waitForWork();
        continue;
      }
      this.emit('claimed', claimed);
      const outcome = await this.ingestionService.process(claimed);
      this.emit('settled', { claimed, outcome });
    }
  }

  async stop() {
    if (!this.#running) {
      return;
    }
    this.#running = false;
    this.wake();
    await this.#loopPromise;
    this.#loopPromise = undefined;
  }
}
