import botAvatar from '../assets/bot.png';

export default function BotAvatar({ className = 'bot-avatar' }) {
  return <img className={className} src={botAvatar} alt="华夏智诚管理学院智能助手头像" />;
}
