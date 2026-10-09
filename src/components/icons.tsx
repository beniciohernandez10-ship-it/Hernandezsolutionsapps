import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 16, ...p }: P) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
  ...p,
});

export const IconOpen = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="8" /></svg>);
export const IconProgress = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></svg>);
export const IconWaiting = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="8" strokeDasharray="3 3" /><path d="M10 9v6M14 9v6" /></svg>);
export const IconResolved = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>);
export const IconArrowUp = (p: P) => (<svg {...base(p)}><path d="M12 19V5M5 12l7-7 7 7" /></svg>);
export const IconArrowDown = (p: P) => (<svg {...base(p)}><path d="M12 5v14M19 12l-7 7-7-7" /></svg>);
export const IconDash = (p: P) => (<svg {...base(p)}><path d="M5 12h14" /></svg>);
export const IconBolt = (p: P) => (<svg {...base(p)}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>);
export const IconAlert = (p: P) => (<svg {...base(p)}><path d="M12 3 2 21h20z" /><path d="M12 10v4M12 17.5v.5" /></svg>);
export const IconInfo = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>);
export const IconCheck = (p: P) => (<svg {...base(p)}><path d="m5 12 5 5 9-10" /></svg>);
export const IconX = (p: P) => (<svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>);
export const IconLock = (p: P) => (<svg {...base(p)}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>);
export const IconMenu = (p: P) => (<svg {...base(p)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>);
export const IconExternal = (p: P) => (<svg {...base(p)}><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>);
export const IconPlus = (p: P) => (<svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>);
export const IconInbox = (p: P) => (<svg {...base(p)}><path d="M3 13h5l2 3h4l2-3h5" /><path d="M5 5h14l2 8v6H3v-6z" /></svg>);
export const IconDevice = (p: P) => (<svg {...base(p)}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>);
export const IconBack = (p: P) => (<svg {...base(p)}><path d="M19 12H5M11 18l-6-6 6-6" /></svg>);
export const IconSync = (p: P) => (<svg {...base(p)}><path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" /><path d="M4 4v4h4M20 20v-4h-4" /></svg>);
export const IconMicrosoft = (p: P) => (
  <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 21 21" aria-hidden focusable={false}>
    <rect x="1" y="1" width="9" height="9" fill="currentColor" opacity="0.95" />
    <rect x="11" y="1" width="9" height="9" fill="currentColor" opacity="0.75" />
    <rect x="1" y="11" width="9" height="9" fill="currentColor" opacity="0.75" />
    <rect x="11" y="11" width="9" height="9" fill="currentColor" opacity="0.55" />
  </svg>
);
