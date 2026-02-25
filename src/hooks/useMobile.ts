import { useState } from 'react';

function detectMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.maxTouchPoints > 1 || /Mobi|Android/i.test(navigator.userAgent);
}

/** Returns true when running on a touch/mobile device. Stable across re-renders. */
export function useIsMobile(): boolean {
  const [isMobile] = useState(detectMobile);
  return isMobile;
}
