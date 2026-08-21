import Ajv from 'ajv';

export const ANSWER_STATUS = Object.freeze({
  ANSWERED: 'ANSWERED',
  NO_RELIABLE_EVIDENCE: 'NO_RELIABLE_EVIDENCE',
  BLOCKED: 'BLOCKED'
});

export const BLOCKED_ANSWER = '该请求包含不安全或超出知识库范围的指令，已阻止处理。';

export const CLAIMS_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'citationIds'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 4000 },
          citationIds: {
            type: 'array',
            minItems: 1,
            maxItems: 5,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 160 }
          }
        }
      }
    }
  }
});

const validateClaimsSchema = new Ajv({ allErrors: true }).compile(CLAIMS_SCHEMA);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const BLOCKED_PATTERNS = [
  /(?:system|developer)\s*(?:prompt|message)|系统(?:提示|指令)|开发者(?:消息|指令)|提示词/iu,
  /api[\s_-]*key|密钥|环境变量|environment\s+variables?|\benv\b|数据库(?:内容|凭据|连接)|database\s+(?:contents?|credentials?|connection)|服务主机(?:路径|地址)|host\s+(?:path|directory|address)|file\s*system|(?:读取|列出|泄露).*(?:路径|目录|文件)/iu,
  /ignore.*(?:instructions?|prompts?|knowledge\s*base|citations?)|bypass.*(?:citations?|knowledge\s*base)|answer.*(?:common|general|training)\s+knowledge|忽略.*(?:指令|知识库|引用)|绕过.*(?:citation|引用|知识库)|(?:不用|不要使用|跳过).*(?:知识库|citation|引用)|(?:使用|根据).*(?:常识|训练知识).*回答/iu,
  /execute.*(?:code|script|command)|run.*(?:script|command)|(?:visit|open|request).*(?:https?:\/\/|\burl\b)|call.*(?:tools?|functions?)|write.*(?:business\s+system|database|files?)|(?:执行|运行).*(?:代码|脚本|命令)|(?:访问|打开|请求).*(?:https?:\/\/|网址|url)|(?:调用|使用).*(?:工具|tool|function)|(?:写入|修改|删除).*(?:业务系统|数据库|文件)/iu
];

function hasRepeatedPayload(value) {
  const tokens = value.toLocaleLowerCase('zh-CN').match(/[\p{L}\p{N}_-]{3,}/gu) ?? [];
  if (tokens.length < 12) {
    return false;
  }
  const counts = new Map();
  for (const token of tokens) {
    const count = (counts.get(token) ?? 0) + 1;
    counts.set(token, count);
    if (count >= 10 && count / tokens.length >= 0.5) {
      return true;
    }
  }
  return false;
}

export function blockedInputReason(question) {
  if (typeof question !== 'string' || !question.trim() || question.length > 4000 || CONTROL_CHARACTER_PATTERN.test(question)) {
    return 'invalid-input';
  }
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(question))) {
    return 'unsafe-instruction';
  }
  if (hasRepeatedPayload(question)) {
    return 'repeated-payload';
  }
  return null;
}

export function validateGroundedClaims(payload, allowedCitationIds) {
  if (!validateClaimsSchema(payload)) {
    return null;
  }
  const allowed = new Set(allowedCitationIds);
  const claims = payload.claims.map((claim) => ({
    text: claim.text.trim(),
    citationIds: [...claim.citationIds]
  }));
  if (claims.some((claim) => !claim.text || claim.citationIds.some((citationId) => !allowed.has(citationId)))) {
    return null;
  }
  return claims;
}

function publicCitation(candidate) {
  return Object.freeze({
    citationId: candidate.citationId,
    documentId: candidate.documentId,
    fileName: candidate.fileName,
    location: structuredClone(candidate.location),
    excerpt: candidate.excerpt
  });
}

export function answeredResponse(topicId, claims, candidates) {
  const candidateById = new Map(candidates.map((candidate) => [candidate.citationId, candidate]));
  const usedIds = [];
  for (const claim of claims) {
    for (const citationId of claim.citationIds) {
      if (!usedIds.includes(citationId)) {
        usedIds.push(citationId);
      }
    }
  }
  const referenceNumber = new Map(usedIds.map((citationId, index) => [citationId, index + 1]));
  const answer = claims.map((claim) => {
    const markers = claim.citationIds.map((citationId) => `[${referenceNumber.get(citationId)}]`).join('');
    return `${claim.text}${markers}`;
  }).join('\n');
  return Object.freeze({
    status: ANSWER_STATUS.ANSWERED,
    topicId,
    answer,
    citations: Object.freeze(usedIds.map((citationId) => publicCitation(candidateById.get(citationId))))
  });
}

export function refusalResponse(topicId, fixedRefusalText) {
  return Object.freeze({
    status: ANSWER_STATUS.NO_RELIABLE_EVIDENCE,
    topicId,
    answer: fixedRefusalText,
    citations: Object.freeze([])
  });
}

export function blockedResponse(topicId) {
  return Object.freeze({
    status: ANSWER_STATUS.BLOCKED,
    topicId,
    answer: BLOCKED_ANSWER,
    citations: Object.freeze([])
  });
}
