// Client-safe helpers for the share button (no database imports here).
//
// Sharing is deliberately dumb: a `wa.me` deep link plus the phone's own share
// sheet. There is no WhatsApp Business account, no Meta app, no API key and no
// message template to get approved - the message is opened in *the WhatsApp the
// person already has*, and they press send themselves. That also means:
//
//   * on a phone with WhatsApp installed, `wa.me` opens the app;
//   * on a laptop it opens WhatsApp Web (or WhatsApp's "get the app" page if
//     that browser has never paired a phone) - hence the copy button beside it,
//     so a desktop user can still paste the line into any app they do use;
//   * the server never learns anything about the recipient, because the link
//     never touches our API.

/** The `https://wa.me/?text=` link that opens WhatsApp with the message ready. */
export function whatsappHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** One line: the sentence, then the link. Trimmed, and never a double space. */
export function joinMessage(message: string, url: string): string {
  return [message.trim(), url.trim()].filter(Boolean).join(" ");
}

/**
 * Turn a site-relative path into the absolute one that goes in the message.
 * `origin` is `window.location.origin` in the browser and undefined on the
 * server, where the relative path is the best that can be said.
 */
export function absoluteUrl(path: string, origin: string | undefined): string {
  if (!origin) return path;
  try {
    return new URL(path, origin).toString();
  } catch {
    return path;
  }
}
