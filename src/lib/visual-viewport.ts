import { useEffect } from "react";

/** Keep overlay geometry on the visible viewport while the keyboard is open. */
export function useVisualViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      const height = vv.height;
      const offset = vv.offsetTop;
      // Firefox fires this on an ordinary scroll, with a sub-pixel offset, and
      // a sticky blur used to depend on it. Only shrink overlays for a real
      // keyboard or browser chrome, never for that scroll noise.
      const keyboard = window.innerHeight - offset - height > 80 && height > 120;
      if (keyboard) {
        root.style.setProperty("--vv-top", `${Math.max(0, offset)}px`);
        root.style.setProperty("--vv-height", `${height}px`);
        root.style.setProperty("--vv-nav", "0px");
      } else {
        root.style.removeProperty("--vv-top");
        root.style.removeProperty("--vv-height");
        root.style.removeProperty("--vv-nav");
      }
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      window.removeEventListener("orientationchange", sync);
      root.style.removeProperty("--vv-top");
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--vv-nav");
    };
  }, []);
}
