import { useState } from 'react';

export default function InputBar({ onSend, disabled }) {
  const [value, setValue] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const canSend = value.trim().length > 0 && !disabled;

  const submit = () => {
    const message = value.trim();
    if (!message || disabled) {
      return;
    }
    onSend(message);
    setValue('');
  };

  return (
    <form className="input-area" onSubmit={(event) => {
      event.preventDefault();
      submit();
    }}>
      <div className="input-row">
        <textarea
          disabled={disabled}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="请输入您的问题…"
          rows={1}
          autoFocus
          aria-label="请输入您的问题"
        />
        <button
          className="send-button"
          type="submit"
          disabled={!canSend}
          title="发送"
          aria-label="发送"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m22 2-7 20-4-9-9-4Z" />
            <path d="M22 2 11 13" />
          </svg>
        </button>
      </div>
    </form>
  );
}
