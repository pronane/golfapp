import { describe, expect, it } from "vitest";
import { absoluteUrl, joinMessage, whatsappHref } from "@/lib/share";

/**
 * The share button is deliberately a deep link, not an integration: these tests
 * pin that down, because "share to WhatsApp" is the sort of thing that quietly
 * turns into a Business API bill.
 */
describe("share to WhatsApp", () => {
  it("opens WhatsApp with the message written, and nothing else", () => {
    const href = whatsappHref("Autumn Invitational - live https://golfday.app/live/autumn");
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(href.split("text=")[1])).toBe(
      "Autumn Invitational - live https://golfday.app/live/autumn",
    );
  });

  it("needs no business account, app id or approved template", () => {
    const href = whatsappHref("hello");
    expect(href).not.toMatch(/api\.whatsapp\.com|graph\.facebook\.com|business/i);
    expect(href).not.toMatch(/token|key|template/i);
    // A null-recipient link: the person picks the chat, so we hold no address book.
    expect(href).toBe("https://wa.me/?text=hello");
  });

  it("escapes characters that would break the link", () => {
    const href = whatsappHref("Tom & Jerry's \"open\" - tie #1? a+b=c");
    const text = href.slice("https://wa.me/?text=".length);
    // encodeURIComponent leaves a few sub-delimiters alone; these are the ones
    // that would truncate or change the query string.
    expect(text).not.toMatch(/[&#?+="]/);
    expect(decodeURIComponent(text)).toBe("Tom & Jerry's \"open\" - tie #1? a+b=c");
  });

  it("joins the sentence and the link on one line", () => {
    expect(joinMessage("Follow the day live", "https://x.test/live/a")).toBe(
      "Follow the day live https://x.test/live/a",
    );
    expect(joinMessage("  Follow the day live  ", " https://x.test/live/a ")).toBe(
      "Follow the day live https://x.test/live/a",
    );
    expect(joinMessage("", "https://x.test/live/a")).toBe("https://x.test/live/a");
  });

  it("builds the same message on a demo host, a club domain and a laptop", () => {
    expect(absoluteUrl("/live/autumn", "https://golfday-demo.onrender.com")).toBe(
      "https://golfday-demo.onrender.com/live/autumn",
    );
    expect(absoluteUrl("/live/autumn", "http://192.168.1.20:3000")).toBe("http://192.168.1.20:3000/live/autumn");
    // No origin (server render, or a broken one): the relative path is honest.
    expect(absoluteUrl("/live/autumn", undefined)).toBe("/live/autumn");
    expect(absoluteUrl("/live/autumn", "not a url")).toBe("/live/autumn");
  });
});
