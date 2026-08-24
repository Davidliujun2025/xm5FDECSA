import { useEffect, useRef, useState } from 'react';
import BotAvatar from './BotAvatar';
import MessageList from './MessageList';
import InputBar from './InputBar';
import { initializeBrowserSession, sendChat } from '../api/rag-client';
import { loadAcceptanceContext } from '../api/acceptance-client.js';

const BOT_NAME = '华夏智诚管理学院';
const WELCOME_MESSAGE = '您好，我是知识库助手。请就已发布的知识库资料提问；回答会显示可核验的原文引用。';

let messageSequence = 0;

function createMessage(role, content, { status = null, citations = [] } = {}) {
  messageSequence += 1;
  return {
    id: `msg-${Date.now()}-${messageSequence}`,
    role,
    content,
    status,
    citations,
    timestamp: new Date().toISOString()
  };
}

export default function ChatBot() {
  const acceptanceChat = new URLSearchParams(window.location.search).get('acceptance') === '1';
  const [messages, setMessages] = useState(() => [createMessage('bot', WELCOME_MESSAGE)]);
  const [isTyping, setIsTyping] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [sessionState, setSessionState] = useState('loading');
  const [acceptanceContext, setAcceptanceContext] = useState(null);
  const messageListRef = useRef(null);

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => initializeBrowserSession())
      .then(() => acceptanceChat ? loadAcceptanceContext() : null)
      .then((context) => {
        if (!active) return;
        setAcceptanceContext(context);
        setSessionState('ready');
      })
      .catch(() => active && setSessionState('error'));
    return () => {
      active = false;
    };
  }, [acceptanceChat]);

  const appendBotMessage = (content, options) => {
    setMessages((current) => [...current, createMessage('bot', content, options)]);
  };

  function errorMessage(error) {
    if (error.status === 401 || error.status === 403) {
      return '查询会话无效或已过期，请重新发送问题。';
    }
    if (error.status === 429) {
      return '当前问答请求较多，请稍后重试。';
    }
    if (error.status === 503) {
      return '知识库服务或模型暂时不可用，请稍后重试。';
    }
    return '知识库接口请求失败，请检查连接后重试。';
  }

  async function handleSend(message) {
    if (acceptanceChat && !acceptanceContext?.topicId) {
      setSessionState('error');
      appendBotMessage('验收 Topic 尚未就绪，无法发送问题。', { status: 'ERROR' });
      return;
    }
    const userMessage = createMessage('user', message);
    setMessages((current) => [...current, userMessage]);
    setIsTyping(true);

    try {
      const data = await sendChat(message, { expectedTopicId: acceptanceContext?.topicId ?? null });
      setSessionState('ready');
      appendBotMessage(data.answer, { status: data.status, citations: data.citations });
    } catch (error) {
      setSessionState('error');
      appendBotMessage(errorMessage(error), { status: 'ERROR' });
    } finally {
      setIsTyping(false);
    }
  }

  if (isClosed) {
    return (
      <button
        className="chat-reopen"
        type="button"
        onClick={() => setIsClosed(false)}
        title="重新打开对话窗口"
        aria-label="重新打开对话窗口"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>
    );
  }

  return (
    <main className="chat-page">
      <div className="chat-widget">
        <header className="chat-header">
          <BotAvatar />
          <div className="header-copy">
          <div className="header-title">{BOT_NAME}</div>
          <div className="header-subtitle">
            <span className={`status-dot ${sessionState}`} aria-hidden="true" />
            {sessionState === 'loading' ? '正在连接' : sessionState === 'error' ? '连接异常' : '知识库在线'}
          </div>
        </div>
        <nav className="chat-header-actions" aria-label="知识库页面">
          <a className="acceptance-entry" href="/acceptance/upload">上传资料</a>
          <button
            className="close-button"
            type="button"
            onClick={() => setIsClosed(true)}
            title="关闭"
            aria-label="关闭"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </nav>
      </header>

      {acceptanceChat && (
        <div className={`chat-topic-binding is-${sessionState}`} role={sessionState === 'error' ? 'alert' : 'status'}>
          <span>验收 Topic</span>
          <strong>{acceptanceContext?.topicName ?? (sessionState === 'error' ? '读取失败' : '正在读取…')}</strong>
          <code>{acceptanceContext?.topicId ?? '—'}</code>
        </div>
      )}

      <MessageList messages={messages} isTyping={isTyping} listRef={messageListRef} />
        <InputBar
          onSend={handleSend}
          disabled={isTyping || sessionState === 'loading' || (acceptanceChat && !acceptanceContext?.topicId)}
        />
      </div>
    </main>
  );
}
