const WELCOME_ITEMS = [
  {
    icon: '📚',
    title: 'PMP®课程与备考：',
    text: '课程形式、班期安排、学习平台、教材资料'
  },
  {
    icon: '📝',
    title: '报考与考试：',
    text: '报考条件、报名流程、考试形式与费用'
  },
  {
    icon: '🎓',
    title: '学员服务：',
    text: '报名付款、账号开通、学习群与直播访问'
  },
  {
    icon: '🔄',
    title: '证书续证与PDU：',
    text: '证书有效期、PDU积累、续证费用'
  }
];

export default function WelcomeMessage() {
  return (
    <div className="welcome-message">
      <p>您好，欢迎来到华夏智诚项目管理学院！👋</p>
      <p>我是您的智能小助手，很高兴为您服务。</p>
      <p>我可以为您解答以下问题：</p>

      <div className="welcome-items">
        {WELCOME_ITEMS.map((item) => (
          <div className="welcome-item" key={item.title}>
            <span className="welcome-icon" aria-hidden="true">{item.icon}</span>
            <div className="welcome-item-text">
              <strong>{item.title}</strong>
              {item.text}
            </div>
          </div>
        ))}
      </div>

      <p>您可以直接输入问题，我会为您解答。</p>
    </div>
  );
}
