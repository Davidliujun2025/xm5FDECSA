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

function createMessage(role, content) {
  messageSequence += 1;
  return {
    id: `msg-${Date.now()}-${messageSequence}`,
    role,
    content,
    timestamp: new Date().toISOString()
  };
}

// 后端服务未启动时，用本地演示回复保证聊天窗口可以完整交互。
function getDemoReply(question) {
  const text = question.toLowerCase();

  if (/pmp|备考|课程|班期|学习平台|教材/.test(text)) {
    return `关于 PMP® 课程，您可以从这些方面了解：
· 课程形式：线下面授、线上直播、录播回放
· 班期安排：全年滚动开班，可联系顾问查看最新课表
· 学习平台：报名后开通专属学习账号，支持在线听课与刷题
· 教材资料：提供官方教材、讲义、题库和考前冲刺资料`;
  }

  if (/报考|报名|条件|流程|考试|费用/.test(text)) {
    return `关于报考与考试：
· 报考条件：需满足 PMI 规定的学历与项目管理经验要求
· 报名流程：提交个人信息、审核资格、完成考试报名
· 考试形式：机考与笔试形式以官方安排为准
· 考试费用：PMP® 考试费用由 PMI 官方制定`;
  }

  if (/付款|账号|学习群|直播/.test(text)) {
    return `关于学员服务：
· 报名付款：支持线上支付与对公转账，付款后开具正规发票
· 账号开通：报名成功后 1-2 个工作日开通学习账号
· 学习群：班主任会邀请您加入当期学员学习群
· 直播访问：直播链接会提前在群内和系统消息中发布`;
  }

  if (/证书|续证|pdu|有效期/.test(text)) {
    return `关于证书续证与 PDU：
· 证书有效期：PMP® 证书有效期为 3 年
· PDU 积累：通过课程学习、讲座、志愿服务等方式积累
· 续证费用：续证时需缴纳 PMI 规定的费用并完成申报`;
  }

  return `我已经收到您的问题。当前知识库服务暂未连接，暂时无法给出准确答案；您可以稍后重试，或先询问课程、报考、学员服务、续证等主题。`;
}

export default function ChatBot() {
  const [messages, setMessages] = useState(() => [createMessage('bot', WELCOME_MESSAGE)]);
  const [isTyping, setIsTyping] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const messageListRef = useRef(null);

  const appendBotMessage = (content) => {
    setMessages((current) => [...current, createMessage('bot', content)]);
  };

  async function handleSend(message) {
    const userMessage = createMessage('user', message);
    setMessages((current) => [...current, userMessage]);
    setIsTyping(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          conversationId: conversationId || undefined
        })
      });

      if (!response.ok) {
        throw new Error('Chat API unavailable');
      }

      const data = await response.json();
      appendBotMessage(data.answer || '抱歉，我暂时无法回答这个问题，请换个方式再问一次。');

      if (data.conversationId) {
        setConversationId(data.conversationId);
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
      appendBotMessage(getDemoReply(message));
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

      <MessageList messages={messages} isTyping={isTyping} listRef={messageListRef} />
        <InputBar onSend={handleSend} disabled={isTyping} />
      </div>
    </main>
  );
}
