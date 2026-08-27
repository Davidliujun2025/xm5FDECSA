import { ModelError } from '../../domain/chunks.js';

const DOMAINS = new Set(['PMP', 'ACP', 'PBA', 'FDE']);
const SYSTEM_PROMPT = `你是华夏智诚知识库的意图识别器。只进行分类和问题改写，不回答用户问题。
业务范围：PMP项目管理认证、ACP敏捷认证、PBA商业分析认证、FDE前沿部署工程师。
结合提供的最近一轮对话上下文，将当前问题改写成可独立理解的问题；无上下文时保持原意。
related 表示问题是否属于上述任一业务范围。domains 只能包含 PMP、ACP、PBA、FDE。
必须只输出 JSON，格式示例：{"related":true,"domains":["PMP"],"standaloneQuestion":"PMP考试费用是多少？"}`;

function modelError(message, retryable = false, cause) {
  return new ModelError({
    errorCode: 'RAG_MODEL_UNAVAILABLE',
    message,
    retryable,
    cause
  });
}

function parseIntent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'DeepSeek 意图响应为空' });
  }
  let value;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'DeepSeek 意图响应不是有效 JSON', cause: error });
  }
  const domains = Array.isArray(value.domains)
    ? [...new Set(value.domains.filter((domain) => DOMAINS.has(domain)))]
    : [];
  if (typeof value.related !== 'boolean'
    || typeof value.standaloneQuestion !== 'string'
    || !value.standaloneQuestion.trim()
    || value.standaloneQuestion.length > 4000) {
    throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'DeepSeek 意图响应字段非法' });
  }
  return Object.freeze({
    related: value.related,
    domains: Object.freeze(domains),
    standaloneQuestion: value.standaloneQuestion.trim()
  });
}

export class DeepSeekIntentClient {
  constructor({ baseUrl, apiKey, model, connectTimeoutMs, totalTimeoutMs, fetchImpl = globalThis.fetch }) {
    if (!baseUrl || !apiKey || !model || typeof fetchImpl !== 'function') {
      throw new TypeError('DeepSeekIntentClient configuration is incomplete');
    }
    this.url = new URL('chat/completions', `${baseUrl.replace(/\/+$/, '')}/`).toString();
    this.apiKey = apiKey;
    this.model = model;
    this.connectTimeoutMs = connectTimeoutMs;
    this.totalTimeoutMs = totalTimeoutMs;
    this.fetch = fetchImpl;
  }

  async recognize({ question, contextualQuestion }) {
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
            thinking: { type: 'disabled' },
            max_tokens: 300,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: `当前问题：${question}\n\n上下文输入：${contextualQuestion}` }
            ]
          }),
          signal: controller.signal
        });
      } catch (error) {
        throw modelError(controller.signal.aborted ? 'DeepSeek 意图识别超时' : 'DeepSeek 意图识别网络不可用', true, error);
      } finally {
        clearTimeout(connectTimer);
      }
      if (response.status === 401 || response.status === 403) throw modelError('DeepSeek API 鉴权失败');
      if (response.status === 429) throw modelError('DeepSeek API 请求受限', true);
      if (!response.ok) throw modelError('DeepSeek API 暂时不可用', response.status >= 500);
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new ModelError({ errorCode: 'RAG_MODEL_OUTPUT_INVALID', message: 'DeepSeek 响应封装不是有效 JSON', cause: error });
      }
      return parseIntent(payload);
    } finally {
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
    }
  }
}
