import { parseDocument } from '../adapters/parsers/index.js';
import {
  createIndexedChunks,
  createParseVersion,
  MAX_EMBEDDING_BATCH,
  ModelError
} from '../domain/chunks.js';
import { AppError } from '../domain/errors.js';
import { chunkParsedBlocks, normalizeParsedBlocks } from '../domain/ingestion.js';

export async function parseAndChunkDocument(input, {
  parser = parseDocument,
  parseOptions = {},
  chunkOptions = {}
} = {}) {
  const parsed = await parser(input, parseOptions);
  const blocks = normalizeParsedBlocks(parsed);
  const chunks = chunkParsedBlocks({
    documentId: input.documentId,
    blocks,
    ...chunkOptions
  });
  return Object.freeze({ blocks, chunks });
}

function safeIngestionError(error) {
  if (error instanceof AppError) {
    return {
      errorCode: error.errorCode,
      errorMessage: error.message,
      retryable: error instanceof ModelError && error.retryable
    };
  }
  return {
    errorCode: 'RAG_JOB_FAILED',
    errorMessage: '文档摄取任务失败',
    retryable: false
  };
}

export class IngestionService {
  constructor({ repository, fileStore, parserWorker, embeddingClient, config, logger }) {
    this.repository = repository;
    this.fileStore = fileStore;
    this.parserWorker = parserWorker;
    this.embeddingClient = embeddingClient;
    this.config = config;
    this.logger = logger;
  }

  async process(claimed) {
    try {
      const bytes = await this.fileStore.readOriginalFile(claimed.document.filePath);
      const parsed = await this.parserWorker.parse({
        documentId: claimed.document.id,
        fileName: claimed.document.fileName,
        mime: claimed.document.mime,
        bytes
      }, {
        chunkOptions: this.config.chunk
      });
      this.repository.setStage(claimed.jobId, 'EMBEDDING');

      const vectors = [];
      let metadata;
      for (let offset = 0; offset < parsed.chunks.length; offset += MAX_EMBEDDING_BATCH) {
        const batch = parsed.chunks.slice(offset, offset + MAX_EMBEDDING_BATCH);
        const embedded = await this.embeddingClient.embed(batch.map((chunk) => chunk.text));
        if (!metadata) {
          metadata = {
            model: embedded.model,
            dimension: embedded.dimension,
            space: embedded.space
          };
        } else if (metadata.model !== embedded.model
          || metadata.dimension !== embedded.dimension
          || metadata.space !== embedded.space) {
          throw new ModelError({
            errorCode: 'RAG_MODEL_OUTPUT_INVALID',
            message: 'Embedding 批次元数据不一致'
          });
        }
        vectors.push(...embedded.vectors);
      }
      if (!metadata || vectors.length !== parsed.chunks.length) {
        throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Embedding 结果不完整' });
      }

      const parseVersion = createParseVersion({
        ...metadata,
        chunkTargetChars: this.config.chunk.targetChars,
        chunkOverlapChars: this.config.chunk.overlapChars
      });
      const chunks = createIndexedChunks({
        topicId: claimed.document.topicId,
        drafts: parsed.chunks,
        vectors,
        ...metadata,
        parseVersion
      });
      this.repository.complete({
        jobId: claimed.jobId,
        documentId: claimed.document.id,
        chunks,
        parseVersion
      });
      this.logger?.info({
        operation: 'ingestion.complete',
        jobId: claimed.jobId,
        documentId: claimed.document.id,
        chunkCount: chunks.length
      }, 'ingestion completed');
      return { status: 'READY', chunkCount: chunks.length };
    } catch (error) {
      const safe = safeIngestionError(error);
      const outcome = this.repository.fail({
        jobId: claimed.jobId,
        documentId: claimed.document.id,
        ...safe
      });
      this.logger?.[safe.retryable ? 'warn' : 'error']({
        operation: 'ingestion.failed',
        jobId: claimed.jobId,
        documentId: claimed.document.id,
        errorCode: safe.errorCode,
        retryable: safe.retryable,
        requeued: outcome.requeued
      }, safe.errorMessage);
      return { status: outcome.requeued ? 'REQUEUED' : 'FAILED', errorCode: safe.errorCode };
    }
  }
}
