"use client";

import { useState } from "react";

/**
 * Share a link the way a golf society actually shares links: WhatsApp, or the
 * phone's own share sheet, with a line of text already written.
 *
 * The URL is absolute in the browser, so the same button works on a demo host,
 * a club's own domain, and a laptop on the clubhouse wifi.
 */
export function ShareButton({
  path,
  message,
  label = "Share on WhatsApp",
  className = "btn-secondary btn-sm",
}: {
  /** Site-relative path, e.g. /live/autumn-invitational */
  path: string;
  /** What to say around the link */
  message: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  function absolute() {
    if (typeof window === "undefined") return path;
    try {
      return new URL(path, window.location.origin).toString();
    } catch {
      return path;
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a
        className={className}
        href={`https://wa.me/?text=${encodeURIComponent(`${message} ${absolute()}`)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {label}
      </a>
      <button
        type="button"
        className="btn-ghost btn-sm"
        onClick={async () => {
          try {
            if (navigator.share) {
              await navigator.share({ title: message, url: absolute() });
              return;
            }
          } catch {
            /* the user dismissed the sheet - fall through to copying */
          }
          try {
            await navigator.clipboard.writeText(`${message} ${absolute()}`);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          } catch {
            /* no clipboard permission: the WhatsApp link still works */
          }
        }}
      >
        {copied ? "Copied" : "Copy message"}
      </button>
    </span>
  );
}
