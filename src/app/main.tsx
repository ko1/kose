import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createProvider } from '../ai/factory';
import '../shared/base.css';
import { App } from './App';
import { KoseController } from './controller';
import './app.css';

const controller = new KoseController(createProvider);
window.addEventListener('pagehide', () => controller.dispose());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App controller={controller} />
  </StrictMode>,
);

controller.init().catch((e) => console.error('kose: failed to initialize', e));
