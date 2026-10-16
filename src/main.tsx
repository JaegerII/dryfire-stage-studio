import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { migrateLegacyStages } from './stage3d/repository';
import './styles.css';

// stages saved by the old 2.5D studio become 3D stages (once, same ids — matches keep working)
migrateLegacyStages();
// the 3D HUD draws text on canvas: make sure Montserrat is ready first
void document.fonts.load('800 16px Montserrat');

// #/render: no studio UI, only the remote control of the batch render (npm run render)
if (location.hash === '#/render') void import('./stage3d/batchRender').then((m) => m.installBatchRender());
else
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
