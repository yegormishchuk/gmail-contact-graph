import { useEffect, useState } from 'react';

/** Phone-sized screens; keep in step with the `max-width: 768px` rules in index.css. */
const MOBILE_QUERY = '(max-width: 768px)';

/** True on a phone-sized screen; follows rotation and window resizes. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
