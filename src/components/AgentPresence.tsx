import { useId } from 'react';

/** Decorative, palette-aware sphere. The actual agent status is rendered as text. */
export default function AgentPresence() {
  const id = useId().replace(/:/g, '');
  return <div className="agent-presence-art" aria-hidden="true">
    <div className="presence-halo" />
    <svg viewBox="0 0 300 300" fill="none">
      <defs>
        <radialGradient id={id + '-glass'} cx=".32" cy=".24" r=".85">
          <stop stopColor="#fcfbf8" stopOpacity=".95" />
          <stop offset=".42" stopColor="var(--accent)" stopOpacity=".12" />
          <stop offset=".78" stopColor="var(--accent)" stopOpacity=".4" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity=".09" />
        </radialGradient>
        <linearGradient id={id + '-rim'} x1="65" y1="60" x2="230" y2="240" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fcfbf8" /><stop offset=".38" stopColor="var(--accent)" stopOpacity=".25" /><stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
        <clipPath id={id + '-clip'}><circle cx="150" cy="150" r="85" /></clipPath>
      </defs>
      <g className="presence-orbit">
        <circle cx="150" cy="150" r="127" stroke="currentColor" strokeOpacity=".15" strokeDasharray="2 8" />
        <path d="M23 150a127 127 0 0 1 127-127M277 150a127 127 0 0 1-127 127" stroke="currentColor" strokeOpacity=".4" />
        <circle cx="150" cy="23" r="4" fill="currentColor" /><circle cx="150" cy="277" r="3" fill="currentColor" />
      </g>
      <ellipse cx="150" cy="150" rx="141" ry="46" transform="rotate(-28 150 150)" stroke="currentColor" strokeOpacity=".22" />
      <circle cx="150" cy="150" r="85" fill={'url(#' + id + '-glass)'} stroke={'url(#' + id + '-rim)'} strokeWidth="1.5" />
      <g clipPath={'url(#' + id + '-clip)'} stroke="currentColor" strokeWidth=".65" opacity=".35">
        {[-60, -35, 0, 35, 60].map(y => <ellipse key={y} cx="150" cy={150 + y} rx={Math.sqrt(85 * 85 - y * y)} ry="13" />)}
        {[23, 49, 72].map(rx => <ellipse key={rx} cx="150" cy="150" rx={rx} ry="85" transform="rotate(-24 150 150)" />)}
      </g>
      <ellipse cx="123" cy="104" rx="30" ry="13" transform="rotate(-35 123 104)" fill="#fcfbf8" opacity=".28" />
      <path d="M41 233h22m-11-11v22M245 58h14m-7-7v14" stroke="currentColor" strokeOpacity=".5" />
    </svg>
    <span className="presence-coordinate">H / OS</span>
  </div>;
}
