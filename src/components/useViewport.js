import { useState, useEffect } from "react";

function useViewport() {
  const get = () => (typeof window === "undefined" ? 1200 : window.innerWidth);
  const [w, setW] = useState(get);
  useEffect(() => {
    let raf = null;
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setW(window.innerWidth)); };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); window.removeEventListener("orientationchange", onResize); };
  }, []);
  return { w, isMobile: w < 760, isNarrow: w < 1040 };
}


export { useViewport };
