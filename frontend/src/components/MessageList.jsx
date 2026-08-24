import { Fragment, useEffect } from 'react';
import BotAvatar from './BotAvatar';
import { formatCitationLocation, summarizeCitationExcerpt } from './citation-format.js';

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
              {message.status && <span className="answer-status">{message.status}</span>}
            </div>
            <div
              className={`message-bubble ${message.status ? `status-${message.status.toLowerCase()}` : ''}`}
              role={message.status === 'ERROR' ? 'alert' : undefined}
            >
              {renderMessageContent(message.content)}
            </div>
            {message.citations?.length > 0 && (
              <ol className="citation-list" aria-label="回答引用">
                {message.citations.map((citation, index) => {
                  const location = formatCitationLocation(citation.location);
                  const excerpt = summarizeCitationExcerpt(citation.excerpt);
                  return (
                    <li className="citation-item" key={citation.citationId}>
                      <div className="citation-heading">
                        <span className="citation-number">[{index + 1}]</span>
                        <a href={`/api/rag/v1/documents/${encodeURIComponent(citation.documentId)}/file`} target="_blank" rel="noreferrer">
                          {citation.fileName}
                        </a>
                      </div>
                      {location && <span className="citation-location">{location}</span>}
                      {excerpt && <p><span>原文摘录</span>{excerpt}</p>}
                    </li>
                  );
                })}
              </ol>
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
