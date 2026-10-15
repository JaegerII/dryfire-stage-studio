import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { migrateLegacyStages } from './stage3d/repository';
import './styles.css';

// stages saved by the old 2.5D studio become 3D stages (once, same ids — matches keep working)
migrateLegacyStages();
// the 3D HUD draws text on canvas: make sure Montserrat is ready first
void document.fonts.load('800 16px Montserrat');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
