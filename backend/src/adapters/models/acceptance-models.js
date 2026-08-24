import { createHash } from 'node:crypto';

import { MAX_EMBEDDING_BATCH, ModelError } from '../../domain/chunks.js';

export const ACCEPTANCE_MODEL_KIND = 'TEST_ACCEPTANCE_ONLY';
export const ACCEPTANCE_EMBEDDING_MODEL = 'test-acceptance-hash-embedding-v1';
export const ACCEPTANCE_CHAT_MODEL = 'test-acceptance-evidence-chat-v1';
export const ACCEPTANCE_EMBEDDING_DIMENSION = 384;

function invalidModelOutput(message) {
  return new ModelError({
    errorCode: 'RAG_MODEL_OUTPUT_INVALID',
    message
  });
}

function normalizedFeatures(text) {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/gu, ' ').trim();
  const features = new Set([`full:${normalized}`]);
  const segments = normalized.match(/\p{Script=Han}+|[\p{L}\p{N}_-]+/gu) ?? [];

  for (const segment of segments) {
    if (/^\p{Script=Han}+$/u.test(segment)) {
      const characters = Array.from(segment);
      for (const character of characters) {
        features.add(`han1:${character}`);
      }
      for (let index = 0; index + 1 < characters.length; index += 1) {
        features.add(`han2:${characters[index]}${characters[index + 1]}`);
      }
      for (let index = 0; index + 2 < characters.length; index += 1) {
        features.add(`han3:${characters[index]}${characters[index + 1]}${characters[index + 2]}`);
      }
    } else {
      features.add(`word:${segment}`);
    }
  }
  return features;
}

function deterministicVector(text) {
  const vector = new Float64Array(ACCEPTANCE_EMBEDDING_DIMENSION);
  for (const feature of normalizedFeatures(text)) {
    const digest = createHash('sha256').update(feature).digest();
    const index = digest.readUInt32BE(0) % ACCEPTANCE_EMBEDDING_DIMENSION;
    const sign = (digest[4] & 1) === 0 ? 1 : -1;
    const weight = feature.startsWith('full:') ? 4 : 1;
    vector[index] += sign * weight;
  }
  const norm = Math.sqrt(vector.reduce((total, value) => total + (value ** 2), 0));
  if (!Number.isFinite(norm) || norm === 0) {
    throw invalidModelOutput('验收 Embedding 无法生成有效向量');
  }
  return Object.freeze(Array.from(vector, (value) => value / norm));
}

function validateEmbeddingInput(texts) {
  if (!Array.isArray(texts)
    || texts.length === 0
    || texts.length > MAX_EMBEDDING_BATCH
    || texts.some((text) => typeof text !== 'string' || !text.trim())) {
    throw new ModelError({
      statusCode: 400,
      errorCode: 'RAG_INVALID_REQUEST',
      message: 'Embedding 批次必须包含 1 到 32 个非空文本'
    });
  }
}

function decodeXmlText(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function evidenceFromPrompt(userPrompt) {
  if (typeof userPrompt !== 'string') {
    throw invalidModelOutput('验收 Chat 缺少证据上下文');
  }
  const match = /\n<knowledge_context>\n([\s\S]+)\n<\/knowledge_context>$/.exec(userPrompt);
  if (!match) {
    throw invalidModelOutput('验收 Chat 缺少证据上下文');
  }
  let evidence;
  try {
    evidence = JSON.parse(decodeXmlText(match[1]));
  } catch (error) {
    throw new ModelError({
      errorCode: 'RAG_MODEL_OUTPUT_INVALID',
      message: '验收 Chat 证据上下文非法',
      cause: error
    });
  }
  if (!Array.isArray(evidence) || evidence.length === 0 || evidence.some((candidate) => (
    !candidate
    || typeof candidate !== 'object'
    || typeof candidate.citationId !== 'string'
    || !candidate.citationId
    || candidate.citationId.length > 160
    || typeof candidate.excerpt !== 'string'
    || !candidate.excerpt.trim()
  ))) {
    throw invalidModelOutput('验收 Chat 没有可引用的候选证据');
  }
  return evidence;
}

export class AcceptanceEmbeddingClient {
  constructor() {
    this.model = ACCEPTANCE_EMBEDDING_MODEL;
  }

  async embed(texts) {
    validateEmbeddingInput(texts);
    return Object.freeze({
      vectors: Object.freeze(texts.map((text) => deterministicVector(text))),
      model: this.model,
      dimension: ACCEPTANCE_EMBEDDING_DIMENSION,
      space: 'cosine'
    });
  }

  async embedQuery(question) {
    const embedded = await this.embed([question]);
    return Object.freeze({
      vector: embedded.vectors[0],
      model: embedded.model,
      dimension: embedded.dimension,
      space: embedded.space
    });
  }
}

export class AcceptanceChatClient {
  constructor() {
    this.model = ACCEPTANCE_CHAT_MODEL;
  }

  async complete({ systemPrompt, userPrompt } = {}) {
    if (typeof systemPrompt !== 'string' || !systemPrompt.trim()) {
      throw invalidModelOutput('验收 Chat 缺少系统约束');
    }
    const [candidate] = evidenceFromPrompt(userPrompt);
    return Object.freeze({
      claims: Object.freeze([
        Object.freeze({
          text: candidate.excerpt.trim(),
          citationIds: Object.freeze([candidate.citationId])
        })
      ])
    });
  }
}

function acceptanceConfig(baseConfig) {
  if (!baseConfig?.model || baseConfig.model.embeddingConfigured || baseConfig.model.chatConfigured) {
    throw new ModelError({
      statusCode: 500,
      errorCode: 'RAG_ACCEPTANCE_MODEL_ISOLATION',
      message: '验收 Mock 模型不能与真实模型配置混用'
    });
  }
  return Object.freeze({
    ...baseConfig,
    model: Object.freeze({
      baseUrl: null,
      apiKey: null,
      embeddingModel: ACCEPTANCE_EMBEDDING_MODEL,
      embeddingConfigured: true,
      chatModel: ACCEPTANCE_CHAT_MODEL,
      chatConfigured: true,
      connectTimeoutMs: 0,
      totalTimeoutMs: 0,
      providerKind: ACCEPTANCE_MODEL_KIND,
      vectorSpaceId: `${ACCEPTANCE_EMBEDDING_MODEL}:${ACCEPTANCE_EMBEDDING_DIMENSION}:cosine`
    })
  });
}

export function createAcceptanceModelProvider() {
  return Object.freeze({
    kind: ACCEPTANCE_MODEL_KIND,
    configure: acceptanceConfig,
    createEmbeddingClient: () => new AcceptanceEmbeddingClient(),
    createChatClient: () => new AcceptanceChatClient()
  });
}
