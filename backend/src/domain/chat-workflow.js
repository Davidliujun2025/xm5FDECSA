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

export function recognizeChatIntent(question, history = []) {
  if (blockedInputReason(question)) {
    return CHAT_INTENT.BLOCKED;
  }
  if (SMALL_TALK_PATTERN.test(question.trim())) {
    return CHAT_INTENT.SMALL_TALK;
  }
  if (history.length > 0 && (FOLLOW_UP_PATTERN.test(question.trim()) || question.trim().length <= 12)) {
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

export function inferChatBranch(result) {
  if (result?.branch && Object.values(CHAT_BRANCH).includes(result.branch)) {
    return result.branch;
  }
  if (result?.status === 'ANSWERED') {
    return CHAT_BRANCH.KNOWLEDGE_HIT;
  }
  return CHAT_BRANCH.INVALID;
}
