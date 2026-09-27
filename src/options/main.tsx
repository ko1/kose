import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import { M } from '../shared/messages';
import { Options } from './Options';
import './options.css';

document.title = M.options.title;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
