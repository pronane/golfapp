"use client";

import { useEffect, useState } from "react";
import { absoluteUrl, joinMessage, whatsappHref } from "@/lib/share";

/**
 * Share a link the way a golf society actually shares links.
 *
 * Two doors, no middleman:
 *   1. **WhatsApp** - a plain `https://wa.me/?text=` deep link. It opens the
 *      WhatsApp the person already has (the app on their phone, WhatsApp Web on
 *      a laptop) with the message written and the link in it. No WhatsApp
 *      Business account, no Meta app, no API key, no approved template.
 *   2. **The device's own share sheet** (`navigator.share`) where the browser
 *      offers one - the same thing the phone's Share button does, WhatsApp among
 *      the targets.
 *
 * On a desktop with no WhatsApp paired, the deep link lands on WhatsApp's
 * "download the app" page, so a **Copy link** button sits beside it: the exact
 * text that would have been sent, on the clipboard, ready to paste anywhere.
 *
 * The URL is absolute in the browser, so the same button works on a demo host, a
 * club's own domain, and a laptop on the clubhouse wifi. It is built after mount
 * so the server and the first client render agree.
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
  const [href, setHref] = useState(() => whatsappHref(message));
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setHref(whatsappHref(joinMessage(message, absoluteUrl(path, window.location.origin))));
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, [path, message]);

  async function copy() {
    const text = joinMessage(message, absoluteUrl(path, window.location.origin));
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* no clipboard permission - the WhatsApp link still works */
    }
  }

  async function shareSheet() {
    const absolute = absoluteUrl(path, window.location.origin);
    try {
      await navigator.share({ title: message, text: joinMessage(message, absolute), url: absolute });
    } catch {
      /* the user dismissed the sheet - say nothing, change nothing */
    }
  }

  const stacked = className.includes("w-full");

  return (
    <span className={`flex flex-wrap items-center gap-2 ${stacked ? "w-full flex-col items-stretch" : ""}`}>
      <a
        className={className}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title="Opens WhatsApp with the message ready - your own WhatsApp, or WhatsApp Web on a computer. Nothing is sent until you press send."
      >
        {label}
      </a>
      {canShare ? (
        <button type="button" className="btn-ghost btn-sm self-start" onClick={() => void shareSheet()}>
          Other app…
        </button>
      ) : null}
      <button type="button" className="btn-ghost btn-sm self-start" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy link"}
      </button>
    </span>
  );
}
