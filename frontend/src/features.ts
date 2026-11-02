// The legacy flag remains supported for existing deployments.
const diveCentreFlag = import.meta.env.VITE_ENABLE_DIVE_CENTRE ?? import.meta.env.VITE_ENABLE_WATER_SPORTS;
export const diveCentreEnabled = diveCentreFlag === 'true' || (import.meta.env.DEV && diveCentreFlag !== 'false');
export const waterSportsEnabled = diveCentreEnabled;
