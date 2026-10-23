import { useId } from "react";

/** The XenoCut mark: an X whose second stroke is cut through the middle. */
export function LogoMark({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffb347" />
          <stop offset="0.55" stopColor="#ff5e3a" />
          <stop offset="1" stopColor="#e0283c" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${id})`} />
      <path d="M21 19 43 45" stroke="#fff" strokeWidth="7.5" strokeLinecap="round" />
      <path d="M43 19 35.4 28M28.6 36 21 45" stroke="#fff" strokeWidth="7.5" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      Xeno<em>Cut</em>
    </span>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <Wordmark size={Math.round(size * 0.62)} />
    </span>
  );
}
