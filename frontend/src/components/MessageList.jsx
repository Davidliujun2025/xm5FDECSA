import { Fragment, useEffect } from 'react';
import BotAvatar from './BotAvatar';
import WelcomeMessage from './WelcomeMessage';
import TransferPanel from './TransferPanel';

function renderMessageContent(content) {
  if (!content.includes('**')) {
    return content;
  }

  return content.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export default function MessageList({ messages, isTyping, listRef, onCandidateSelect }) {
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isTyping, listRef]);

  return (
    <div className="message-list" ref={listRef} role="log" aria-live="polite">
      {messages.map((message) => (
        <div className={`message-row ${message.role}`} key={message.id}>
          {message.role === 'bot' && (
            <BotAvatar className="bot-avatar message-avatar" />
          )}
          <div className="message-content">
            <div className="message-meta">
              {message.role === 'bot' ? '智能小助手' : '我'} · {formatTime(message.timestamp)}
            </div>
            <div className="message-bubble">
              {message.kind === 'welcome'
                ? <WelcomeMessage />
                : renderMessageContent(message.content)}
            </div>
            {message.needTransferHuman === true && <TransferPanel />}
            {message.candidates?.length > 0 && (
              <div className="candidate-list" aria-label="候选问题">
                <p className="candidate-hint">请点击下方问题，或回复对应数字进行选择</p>
                {message.candidates.map((candidate, index) => (
                  <button
                    className="candidate-button"
                    type="button"
                    key={candidate.faqId}
                    disabled={isTyping}
                    onClick={() => onCandidateSelect(candidate)}
                  >
                    <span className="candidate-number">{index + 1}</span>
                    <span>{candidate.question}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      {isTyping && (
        <div className="message-row bot">
          <BotAvatar className="bot-avatar message-avatar" />
          <div className="message-content">
            <div className="message-bubble typing-bubble" aria-label="正在输入">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
