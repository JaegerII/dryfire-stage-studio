import { MARK_PATH, MARK_VIEWBOX } from '../assets/brand/mark';

/** FORTH TRACE mark (path copied verbatim from assets/brand — never redrawn). */
export const BrandMark = ({ height, color = 'currentColor' }: { height: number; color?: string }) => (
  <svg viewBox={MARK_VIEWBOX} height={height} style={{ display: 'block', flex: '0 0 auto' }} aria-hidden="true">
    <path d={MARK_PATH} fill={color} fillRule="evenodd" />
  </svg>
);
