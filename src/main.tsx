import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { preloadAll } from './hooks/useAssetImage';
import './styles.css';

// decode every asset + environment once, up front
void preloadAll();
// Konva draws text on canvas: make sure Montserrat is ready first
void document.fonts.load('800 16px Montserrat');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
