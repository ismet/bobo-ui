import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
import '../css/utilities.css';
import '../css/theme.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root missing');

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>
);
