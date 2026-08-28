import { ModelError } from '../../domain/chunks.js';

const DOMAINS = new Set(['PMP', 'ACP', 'PBA', 'FDE']);
const FAQ_ID_PATTERN = /^faq_[0-9a-f]{32}$/u;
const SYSTEM_PROMPT = `你是华夏智诚知识库的意图识别器。只进行分类和问题改写，不回答用户问题。
业务范围：PMP项目管理认证、ACP敏捷认证、PBA商业分析认证、FDE前沿部署工程师。
结合提供的最近一轮对话上下文，将当前问题改写成可独立理解的问题；无上下文时保持原意。
允许纠正不改变原意的简单输入错误，包括相邻字颠倒、少量错别字/同音字、漏字、多字和词语顺序错误；不得因此扩大或改变用户的业务意图。
related 表示问题是否属于上述任一业务范围。domains 只能包含 PMP、ACP、PBA、FDE。
faqCatalog 是允许匹配的标准问题目录。matchedFaqIds 只能从目录中的 id 选择，最多5个：
- 一个标准问题能直接回答时只选一个；
- 用户问题宽泛且确实对应多个标准问题时可选多个；
- 没有任何标准问题能直接回答时必须返回空数组；
- 不得仅因主题相关就勉强选择，也不得自行编造 id。
必须只输出 JSON，格式示例：{"related":true,"domains":["PMP"],"standaloneQuestion":"PMP考试费用是多少？","matchedFaqIds":["faq_0123456789abcdef0123456789abcdef"]}`;

function modelError(message, retryable = false, cause) {
  return new ModelError({
    errorCode: 'RAG_MODEL_UNAVAILABLE',
    message,
    retryable,
    cause
  });
}

function parseIntent(payload, allowedFaqIds = new Set()) {
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
  const matchedFaqIds = value.related === true && Array.isArray(value.matchedFaqIds)
    ? [...new Set(value.matchedFaqIds.filter((id) => (
      typeof id === 'string' && FAQ_ID_PATTERN.test(id) && allowedFaqIds.has(id)
    )))].slice(0, 5)
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
    standaloneQuestion: value.standaloneQuestion.trim(),
    matchedFaqIds: Object.freeze(matchedFaqIds)
  });
}

function faqCatalog(candidates = []) {
  const seen = new Set();
  return candidates.flatMap((candidate) => {
    if (!candidate
      || typeof candidate.id !== 'string'
      || !FAQ_ID_PATTERN.test(candidate.id)
      || seen.has(candidate.id)
      || !DOMAINS.has(candidate.domain)
      || typeof candidate.question !== 'string'
      || !candidate.question.trim()) {
      return [];
    }
    seen.add(candidate.id);
    return [{
      id: candidate.id,
      domain: candidate.domain,
      question: candidate.question.trim().slice(0, 300)
    }];
  }).slice(0, 120);
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

  async recognize({ question, contextualQuestion, candidates = [] }) {
    const catalog = faqCatalog(candidates);
    const allowedFaqIds = new Set(catalog.map((candidate) => candidate.id));
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
            max_tokens: 400,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: `当前问题：${question}\n\n上下文输入：${contextualQuestion}\n\nfaqCatalog：${JSON.stringify(catalog)}`
              }
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
      return parseIntent(payload, allowedFaqIds);
    } finally {
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
    }
  }
}
