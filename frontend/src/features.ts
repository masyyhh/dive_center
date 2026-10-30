// Keep unfinished Water Sports available locally, but off in production builds
// unless it is explicitly enabled at build time.
export const waterSportsEnabled = import.meta.env.VITE_ENABLE_WATER_SPORTS === 'true' ||
  (import.meta.env.DEV && import.meta.env.VITE_ENABLE_WATER_SPORTS !== 'false');
