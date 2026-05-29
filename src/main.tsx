import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root';
import '../css/utilities.css';
import '../css/theme.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root missing');

createRoot(el).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
