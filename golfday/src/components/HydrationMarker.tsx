"use client";

import { useEffect } from "react";

/**
 * Marks the document once React has hydrated.
 *
 * The end-to-end run (and anyone driving the app with a browser automation
 * tool) needs to know when the page is actually interactive: typing into a
 * controlled input before hydration is wiped when React renders its initial
 * state. Rather than guessing with a sleep, the automation waits for
 * `html[data-hydrated="true"]`, which this sets in an effect - after hydration,
 * never before.
 */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
    return () => {
      delete document.documentElement.dataset.hydrated;
    };
  }, []);
  return null;
}
