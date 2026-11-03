// The legacy flag remains supported for existing deployments.
import { canUsePackageBuilder } from './utils/adminSections';
export const packageBuilderEnabled = canUsePackageBuilder(import.meta.env.VITE_DEPLOYMENT_MODE === 'testing' ? 'testing' : typeof document === 'undefined' ? undefined : document.documentElement.dataset.appEnvironment);
const diveCentreFlag = import.meta.env.VITE_ENABLE_DIVE_CENTRE ?? import.meta.env.VITE_ENABLE_WATER_SPORTS;
export const diveCentreEnabled = diveCentreFlag === 'true' || (import.meta.env.DEV && diveCentreFlag !== 'false');
export const waterSportsEnabled = diveCentreEnabled;
