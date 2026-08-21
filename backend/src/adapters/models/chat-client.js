import { ModelError } from '../../domain/chunks.js';
import { CLAIMS_SCHEMA } from '../../domain/answers.js';

function mapHttpError(status) {
  if (status === 401 || status === 403) {
    return new ModelError({
      errorCode: 'RAG_MODEL_UNAVAILABLE',
      message: 'Chat 模型鉴权失败',
      retryable: false
    });
  }
  if (status === 429) {
    return new ModelError({
      errorCode: 'RAG_MODEL_RATE_LIMITED',
      message: 'Chat 模型请求受限',
      retryable: true
    });
  }
  return new ModelError({
    errorCode: 'RAG_MODEL_UNAVAILABLE',
    message: 'Chat 模型暂时不可用',
    retryable: status >= 500
  });
}

function parseMessage(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Chat 响应内容非法' });
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Chat 响应不是有效 JSON', cause: error });
  }
}

export class ChatClient {
  constructor({ baseUrl, apiKey, model, connectTimeoutMs, totalTimeoutMs, fetchImpl = globalThis.fetch }) {
    if (!baseUrl || !apiKey || !model || typeof fetchImpl !== 'function') {
      throw new TypeError('ChatClient configuration is incomplete');
    }
    this.url = new URL('chat/completions', `${baseUrl.replace(/\/+$/, '')}/`).toString();
    this.apiKey = apiKey;
    this.model = model;
    this.connectTimeoutMs = connectTimeoutMs;
    this.totalTimeoutMs = totalTimeoutMs;
    this.fetch = fetchImpl;
  }

  async complete({ systemPrompt, userPrompt }) {
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
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            stream: false,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'grounded_claims',
                strict: true,
                schema: CLAIMS_SCHEMA
              }
            }
          }),
          signal: controller.signal
        });
      } catch (error) {
        throw new ModelError({
          errorCode: 'RAG_MODEL_UNAVAILABLE',
          message: controller.signal.aborted ? 'Chat 模型请求超时' : 'Chat 模型网络不可用',
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
            message: 'Chat 模型请求超时',
            retryable: true,
            cause: error
          });
        }
        throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'Chat 响应封装不是有效 JSON', cause: error });
      }
      return parseMessage(payload);
    } finally {
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
    }
  }
}
