import { useEffect, useState } from 'react';
import { formatActivityElapsed } from '../utils/activityDisplay';

/**
 * @param {number} [tickMs] — default 2s in lists, use 1000 on profile card for smoother clock
 */
export default function ActivityElapsed({ startedAt, className = '', tickMs = 2000 }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!startedAt) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), tickMs);
    return () => clearInterval(id);
  }, [startedAt, tickMs]);
  const text = formatActivityElapsed(startedAt);
  if (!text) return null;
  return <span className={className}>{text}</span>;
}
