import { useEffect, useRef, useState } from "react";

/** True when entrance motion should be skipped entirely. */
export function prefersCalm() {
  return (
    typeof window.matchMedia !== "function" ||
    typeof window.IntersectionObserver !== "function" ||
    !window.matchMedia("(prefers-reduced-motion: no-preference)").matches
  );
}

/** Reports the first time an element scrolls into view. Starts true when motion is off. */
export function useFirstSeen<T extends Element>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(prefersCalm);
  useEffect(() => {
    const element = ref.current;
    if (seen || !element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setSeen(true);
        observer.disconnect();
      },
      { threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}
