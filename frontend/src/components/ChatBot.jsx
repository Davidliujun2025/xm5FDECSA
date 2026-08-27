import { useRef, useState } from 'react';
import BotAvatar from './BotAvatar';
import MessageList from './MessageList';
import InputBar from './InputBar';

const BOT_NAME = '华夏智诚管理学院';
const WELCOME_MESSAGE = `您好，欢迎来到华夏智诚项目管理学院！👋
我是您的智能小助手，很高兴为您服务。
我可以为您解答以下问题：

📚 **PMP®课程与备考：**课程形式、班期安排、学习平台、教材资料
📝 **报考与考试：**报考条件、报名流程、考试形式与费用
🎓 **学员服务：**报名付款、账号开通、学习群与直播访问
🔄 **证书续证与PDU：**证书有效期、PDU积累、续证费用

您可以直接输入问题，我会为您解答。`;

let messageSequence = 0;

function createMessage(role, content, kind = 'text', extras = {}) {
  messageSequence += 1;
  return {
    id: `msg-${Date.now()}-${messageSequence}`,
    role,
    content,
    kind,
    timestamp: new Date().toISOString(),
    ...extras
  };
}

export default function ChatBot() {
  const [messages, setMessages] = useState(() => [createMessage('bot', WELCOME_MESSAGE, 'welcome')]);
  const [isTyping, setIsTyping] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [requestError, setRequestError] = useState('');
  const messageListRef = useRef(null);

  const appendBotMessage = (content, candidates = [], responseType = 'ANSWER') => {
    setMessages((current) => [...current, createMessage('bot', content, 'text', { candidates, responseType })]);
  };

  async function handleSend(message, selectedFaqId) {
    const userMessage = createMessage('user', message);
    setMessages((current) => [...current, userMessage]);
    setIsTyping(true);
    setRequestError('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          conversationId: conversationId || undefined,
          selectedFaqId: selectedFaqId || undefined
        })
      });

      if (!response.ok) {
        throw new Error('Chat API unavailable');
      }

      const data = await response.json();
      if (typeof data.answer !== 'string' || !data.answer.trim()) {
        throw new Error('Chat API returned an invalid answer');
      }
      appendBotMessage(
        data.answer,
        data.candidates || [],
        data.responseType
      );

      if (data.conversationId) {
        setConversationId(data.conversationId);
      }
    } catch {
      setRequestError('消息发送失败，尚未产生或保存 AI 回复，请检查后端服务后重试。');
    } finally {
      setIsTyping(false);
    }
  }

  function handleCandidateSelect(candidate) {
    if (!isTyping) handleSend(candidate.question, candidate.faqId);
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
            <span className="status-dot" aria-hidden="true" />
            智能小助手
          </div>
        </div>
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
      </header>

      <MessageList
        messages={messages}
        isTyping={isTyping}
        listRef={messageListRef}
        onCandidateSelect={handleCandidateSelect}
      />
        {requestError && <div className="chat-error" role="alert">{requestError}</div>}
        <InputBar onSend={handleSend} disabled={isTyping} />
      </div>
    </main>
  );
}
