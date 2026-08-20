import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ChatBot from './components/ChatBot';
import './styles/chat.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ChatBot />
  </StrictMode>
);
