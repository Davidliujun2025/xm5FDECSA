import { Fragment, useEffect } from 'react';
import BotAvatar from './BotAvatar';
import WelcomeMessage from './WelcomeMessage';

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

export default function MessageList({ messages, isTyping, listRef }) {
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
