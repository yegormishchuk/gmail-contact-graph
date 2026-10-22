import { useEffect, useState } from 'react';

/** Phone-sized screens; keep in step with the `max-width: 768px` rules in index.css. */
const MOBILE_QUERY = '(max-width: 768px)';

/** True on a phone-sized screen right now. */
export function isMobileScreen(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

/** Touch screens: no hover, so hover-only UI needs a tap instead. */
export function hasNoHover(): boolean {
  return window.matchMedia('(hover: none)').matches;
}

/** True on a phone-sized screen; follows rotation and window resizes. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(isMobileScreen);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
