"use client";

import { useState } from "react";

export function CopyButton({ value, label = "Copy link", className = "btn-secondary btn-sm" }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const absolute = value.startsWith("http") ? value : `${window.location.origin}${value}`;
        try {
          await navigator.clipboard.writeText(absolute);
        } catch {
          window.prompt("Copy this link", absolute);
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
