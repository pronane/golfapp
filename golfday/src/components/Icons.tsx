export function FlagMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#137c53" />
      <path d="M11 23V9" stroke="#eefaf2" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M11.9 9.7c2.6-1.5 4.4.8 7 0v6.2c-2.6.8-4.4-1.5-7 0V9.7Z" fill="#e7c27a" />
      <ellipse cx="16" cy="24.4" rx="7.5" ry="1.9" fill="#0f4130" />
    </svg>
  );
}

export function LiveDot({ className = "" }: { className?: string }) {
  return (
    <span className={`relative inline-flex h-2.5 w-2.5 ${className}`}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
    </span>
  );
}

export function Trophy({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M8 4h8v4a4 4 0 1 1-8 0V4Z" strokeLinejoin="round" />
      <path d="M8 5H5.5a2.5 2.5 0 0 0 0 5H8M16 5h2.5a2.5 2.5 0 0 1 0 5H16" strokeLinecap="round" />
      <path d="M12 12v5M9 21h6M10 17h4l1 4H9l1-4Z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Arrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
