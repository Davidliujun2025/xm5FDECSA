import { MAX_EMBEDDING_BATCH, ModelError } from '../../domain/chunks.js';

function mapHttpError(status) {
  if (status === 401 || status === 403) {
    return new ModelError({
      errorCode: 'RAG_MODEL_UNAVAILABLE',
      message: 'Embedding 模型鉴权失败',
      retryable: false
    });
  }
  if (status === 429) {
    return new ModelError({
      errorCode: 'RAG_MODEL_RATE_LIMITED',
      message: 'Embedding 模型请求受限',
      retryable: true
    });
  }
  return new ModelError({
    errorCode: 'RAG_MODEL_UNAVAILABLE',
    message: 'Embedding 模型暂时不可用',
    retryable: status >= 500
  });
}

function validateResponse(payload, expectedCount, expectedModel) {
  if (!payload || !Array.isArray(payload.data) || payload.data.length !== expectedCount) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Embedding 响应数量非法' });
  }
  if (payload.model && payload.model !== expectedModel) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Embedding 响应模型不一致' });
  }
  const ordered = [...payload.data].sort((left, right) => left.index - right.index);
  const indices = ordered.map((item) => item?.index);
  if (indices.some((index, position) => index !== position)) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Embedding 响应顺序非法' });
  }
  const vectors = ordered.map((item) => item?.embedding);
  const dimension = vectors[0]?.length;
  if (!Number.isSafeInteger(dimension) || dimension <= 0 || vectors.some((vector) => (
    !Array.isArray(vector)
    || vector.length !== dimension
    || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))
  ))) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Embedding 响应向量非法或维度不一致' });
  }
  return { vectors, dimension };
}

export class EmbeddingClient {
  constructor({ baseUrl, apiKey, model, connectTimeoutMs, totalTimeoutMs, fetchImpl = globalThis.fetch }) {
    if (!baseUrl || !apiKey || !model || typeof fetchImpl !== 'function') {
      throw new TypeError('EmbeddingClient configuration is incomplete');
    }
    this.url = new URL('embeddings', `${baseUrl.replace(/\/+$/, '')}/`).toString();
    this.apiKey = apiKey;
    this.model = model;
    this.connectTimeoutMs = connectTimeoutMs;
    this.totalTimeoutMs = totalTimeoutMs;
    this.fetch = fetchImpl;
  }

  async embed(texts) {
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_EMBEDDING_BATCH || texts.some((text) => typeof text !== 'string' || !text)) {
      throw new ModelError({ statusCode: 400, errorCode: 'RAG_INVALID_REQUEST', message: 'Embedding 批次必须包含 1 到 32 个非空文本' });
    }
    const controller = new AbortController();
    const totalTimer = setTimeout(() => controller.abort('total-timeout'), this.totalTimeoutMs);
    const connectTimer = setTimeout(() => controller.abort('connect-timeout'), this.connectTimeoutMs);
    try {
      let response;
      try {
        response = await this.fetch(this.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model: this.model, input: texts }),
          signal: controller.signal
        });
      } catch (error) {
        throw new ModelError({
          errorCode: 'RAG_MODEL_UNAVAILABLE',
          message: controller.signal.aborted ? 'Embedding 模型请求超时' : 'Embedding 模型网络不可用',
          retryable: true,
          cause: error
        });
      } finally {
        clearTimeout(connectTimer);
      }
      if (!response.ok) {
        throw mapHttpError(response.status);
      }
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ModelError({
            errorCode: 'RAG_MODEL_UNAVAILABLE',
            message: 'Embedding 模型请求超时',
            retryable: true,
            cause: error
          });
        }
        throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Embedding 响应不是有效 JSON', cause: error });
      }
      const validated = validateResponse(payload, texts.length, this.model);
      return Object.freeze({
        vectors: Object.freeze(validated.vectors),
        model: this.model,
        dimension: validated.dimension,
        space: 'cosine'
      });
    } finally {
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
    }
  }
}
