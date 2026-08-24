import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ChatBot from './components/ChatBot';
import UploadAcceptance from './components/UploadAcceptance';
import './styles/chat.css';

const rootComponent = window.location.pathname === '/acceptance/upload'
  ? <UploadAcceptance />
  : <ChatBot />;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {rootComponent}
  </StrictMode>
);
