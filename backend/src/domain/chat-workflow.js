import { blockedInputReason } from './answers.js';

export const CHAT_INTENT = Object.freeze({
  BLOCKED: 'BLOCKED',
  SMALL_TALK: 'SMALL_TALK',
  FOLLOW_UP: 'FOLLOW_UP',
  KNOWLEDGE_QUERY: 'KNOWLEDGE_QUERY'
});

export const CHAT_BRANCH = Object.freeze({
  INVALID: '9-1',
  KNOWLEDGE_HIT: '9-2',
  RELATED_WITHOUT_RESULT: '9-3'
});

const SMALL_TALK_PATTERN = /^(?:你好|您好|嗨|hello|hi|谢谢|感谢|再见|在吗|你是谁)[！!。.，,？?\s]*$/iu;
const FOLLOW_UP_PATTERN = /^(?:那|那么|这个|那个|它|上述|前面|还有|然后|具体|费用呢|怎么做|为什么|多久|哪里|何时|呢|吗|？|\?)/u;
const SHORT_FOLLOW_UP_PATTERN = /^(?:费用|价格|条件|流程|时间|题型|有效期|续证|课程|教材|平台|报名|报考|考试|证书)(?:呢|吗|多少|是什么|怎么办|怎么做)?[？?]?$/u;
const NUMERIC_SELECTION_PATTERN = /^\s*([1-8])\s*[.、]?\s*$/u;

export function recognizeChatIntent(question, history = []) {
  if (blockedInputReason(question)) {
    return CHAT_INTENT.BLOCKED;
  }
  if (SMALL_TALK_PATTERN.test(question.trim())) {
    return CHAT_INTENT.SMALL_TALK;
  }
  if (history.length > 0 && (FOLLOW_UP_PATTERN.test(question.trim()) || SHORT_FOLLOW_UP_PATTERN.test(question.trim()))) {
    return CHAT_INTENT.FOLLOW_UP;
  }
  return CHAT_INTENT.KNOWLEDGE_QUERY;
}

function historyLine(message) {
  const label = message.role === 'USER' ? '用户' : '助手';
  return `${label}: ${message.content}`;
}

export function buildContextualQuestion(question, history, maxChars = 4000) {
  if (!Array.isArray(history) || history.length === 0) {
    return question;
  }
  const prefix = '最近一轮对话上下文：\n';
  const suffix = `\n当前问题: ${question}`;
  if (prefix.length + suffix.length >= maxChars) {
    return question;
  }
  const available = Math.max(0, maxChars - prefix.length - suffix.length);
  const lines = history.map(historyLine);
  const selected = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const lineLength = lines[index].length + (selected.length > 0 ? 1 : 0);
    if (used + lineLength > available) {
      break;
    }
    selected.unshift(lines[index]);
    used += lineLength;
  }
  return `${prefix}${selected.join('\n')}${suffix}`;
}

export function latestCompletedTurn(history) {
  if (!Array.isArray(history) || history.length === 0) return Object.freeze([]);
  for (let assistantIndex = history.length - 1; assistantIndex >= 0; assistantIndex -= 1) {
    if (history[assistantIndex].role !== 'ASSISTANT') continue;
    for (let userIndex = assistantIndex - 1; userIndex >= 0; userIndex -= 1) {
      if (history[userIndex].role === 'USER') {
        return Object.freeze([history[userIndex], history[assistantIndex]]);
      }
    }
  }
  return Object.freeze([]);
}

export function selectedFaqFromHistory(question, history) {
  const match = NUMERIC_SELECTION_PATTERN.exec(question);
  if (!match || !Array.isArray(history)) return null;
  const assistant = [...history].reverse().find((message) => message.role === 'ASSISTANT');
  const candidates = assistant?.metadata?.candidates;
  const selected = Array.isArray(candidates) ? candidates[Number(match[1]) - 1] : null;
  return typeof selected?.faqId === 'string' ? selected.faqId : null;
}

export function inferChatBranch(result) {
  if (result?.branch && Object.values(CHAT_BRANCH).includes(result.branch)) {
    return result.branch;
  }
  if (result?.status === 'ANSWERED') {
    return CHAT_BRANCH.KNOWLEDGE_HIT;
  }
  return CHAT_BRANCH.INVALID;
}
