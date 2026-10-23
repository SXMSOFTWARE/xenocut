interface IconProps {
  size?: number;
}

export function TransitionsIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.25" y="5.5" width="9" height="13" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
      <rect x="11.75" y="5.5" width="9" height="13" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function ThreeCirclesIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="13" r="4.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="15" cy="13" r="4.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="8.6" r="4.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function HexagonIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.1 20.2 7.7v8.6L12 20.9 3.8 16.3V7.7L12 3.1Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
