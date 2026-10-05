/** Small inline icons: no icon library, no extra requests. Decorative; the text beside them carries the meaning. */

import type { ReactNode } from "react";

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="cs-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ToothIcon = ({ size }: { size?: number }) => (
  <Icon {...(size === undefined ? {} : { size })}>
    <path d="M7 3.5c-2.2 0-3.6 1.7-3.6 4 0 2 .8 3.3 1.3 5 .5 1.8.5 4 1.3 6.2.4 1 1.1 1.8 2 1.8 1.5 0 1.5-3.3 2.3-5 .3-.6.7-1 1.2-1s.9.4 1.2 1c.8 1.7.8 5 2.3 5 .9 0 1.6-.8 2-1.8.8-2.2.8-4.4 1.3-6.2.5-1.7 1.3-3 1.3-5 0-2.3-1.4-4-3.6-4-1.9 0-2.7 1-4.5 1S8.9 3.5 7 3.5z" />
  </Icon>
);
export const PhoneIcon = () => (
  <Icon>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
  </Icon>
);
export const WhatsAppIcon = () => (
  <Icon>
    <path d="M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.5L3 21z" />
    <path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8a4 4 0 0 1-2.3-2.3l.8-1-1-2L9 8.5z" />
  </Icon>
);
export const MailIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </Icon>
);
export const PinIcon = () => (
  <Icon>
    <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </Icon>
);
export const ClockIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
export const ArrowIcon = () => (
  <Icon size={18}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const CheckIcon = () => (
  <Icon size={18}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);
export const CalendarIcon = () => (
  <Icon>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);
export const InstagramIcon = () => (
  <Icon>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17" cy="7" r=".6" fill="currentColor" />
  </Icon>
);
export const FacebookIcon = () => (
  <Icon>
    <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z" />
  </Icon>
);
export const YoutubeIcon = () => (
  <Icon>
    <rect x="3" y="6" width="18" height="12" rx="4" />
    <path d="M10.5 9.5v5l4-2.5-4-2.5z" fill="currentColor" />
  </Icon>
);
export const StarIcon = ({ filled }: { filled: boolean }) => (
  <svg className="cs-star" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
    <path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8L12 3.2z" />
  </svg>
);
