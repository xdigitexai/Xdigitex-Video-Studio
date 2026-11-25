"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Thin navigation indicator. It deliberately does NOT create a Suspense
 * loading boundary: vinext prefetches only the loading shell for routes with
 * a loading.tsx, which leaves client navigation stuck on the skeleton.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const firstRender = useRef(true);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    setActive(false);
  }, [pathname]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const link = target?.closest("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (
        !href ||
        !href.startsWith("/") ||
        href.startsWith("//") ||
        href.includes("#") ||
        link.target === "_blank" ||
        link.hasAttribute("download")
      ) {
        return;
      }
      if (timer.current !== null) window.clearTimeout(timer.current);
      setActive(true);
      timer.current = window.setTimeout(() => setActive(false), 4000);
    }

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  return active ? <div className="route-progress" aria-hidden="true" /> : null;
}
