import type { SVGProps } from 'react';

/** Shared agent identities, drawn to stay legible in both avatars and sidebar rows. */
export default function AgentIcon({ identity, ...props }: SVGProps<SVGSVGElement> & { identity: string }) {
  const artwork = {
    default: <><path d="m13 3-5 9h4l-1 9 6-11h-4l1-7" /><path d="m8 8-5-2 1 5 3 2m9-5 5-2-1 5-3 2" /></>,
    fiddle: <><path d="m15 3 6 6-8 11-9 1 1-9Z" /><path d="m15 3-2 6 8 0M4 21l7-7" /><circle cx="12" cy="13" r="1.5" /><path d="M4 3v4M2 5h4" /></>,
    ledger: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 3v18m4-13h4m-4 4h4m-4 5v-2m4 2v-3" /></>,
    scout: <><circle cx="12" cy="12" r="9" /><path d="m16.5 7.5-3 6-6 3 3-6Z" /><path d="M12 3v2m9 7h-2M12 21v-2M3 12h2" /></>,
    sigma: <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M15.5 7h-7l5 5-5 5h7M8 1v2m8-2v2M8 21v2m8-2v2M1 8h2m-2 8h2m18-8h2m-2 8h2" /></>,
    codex: <><path d="m12 2 9 5v10l-9 5-9-5V7Z" /><path d="m10 9-3 3 3 3m4-6 3 3-3 3" /></>,
    claude: <><path d="M12 2v6m0 8v6M2 12h6m8 0h6M5 5l4 4m6 6 4 4M5 19l4-4m6-6 4-4M8 3l2 5m4 8 2 5M3 8l5 2m8 4 5 2M3 16l5-2m8-4 5-2M8 21l2-5m4-8 2-5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  };
  const key = identity === 'hermes-root' ? 'default' : identity;
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    {artwork[key as keyof typeof artwork] || <><rect x="4" y="4" width="16" height="16" rx="5" /><path d="m9 9 6 6m0-6-6 6" /></>}
  </svg>;
}
