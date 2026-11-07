import { useEffect, useRef } from "react";
import { isInstalled } from "./install";

const layers: (() => void)[] = [];
let holding = false;

/** The top open layer, if any, takes the back press. */
export function pushBackLayer(close: () => void): () => void {
  layers.push(close);
  return () => {
    const index = layers.lastIndexOf(close);
    if (index >= 0) layers.splice(index, 1);
  };
}

export function useBackLayer(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    return pushBackLayer(() => closeRef.current());
  }, [open]);
}

function place(): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

/**
 * An installed app has no tab to go back to, so the system back button
 * closes it once history runs out. Keep one entry under the current page
 * and put it back when a press would otherwise leave.
 * A browser tab is left alone.
 */
export function holdInstalledBack() {
  if (holding || typeof window === "undefined" || !isInstalled()) return;
  holding = true;
  let here = place();
  const remember = () => {
    here = place();
  };
  const rearm = () => {
    const state =
      history.state && typeof history.state === "object" ? { ...history.state, foliosiftStay: true } : { foliosiftStay: true };
    history.pushState(state, "", location.href);
  };
  rearm();
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (data, unused, url) => {
    push(data, unused, url);
    remember();
  };
  history.replaceState = (data, unused, url) => {
    replace(data, unused, url);
    remember();
  };
  window.addEventListener("hashchange", remember);
  window.addEventListener("popstate", () => {
    const now = place();
    const same = now === here;
    here = now;
    if (!same || !isInstalled()) return;
    layers[layers.length - 1]?.();
    rearm();
  });
}
