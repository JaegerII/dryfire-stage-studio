export const FullscreenButton = ({ active, onToggle }: { active: boolean; onToggle: () => void }) => (
  <button className="fs-button" onClick={onToggle} title="Fullscreen (F)">
    {active ? 'Exit fullscreen' : 'Fullscreen'}
  </button>
);
