export type TankBasis =
  'TANK' | 'PASSENGER' | 'DIVE' | 'TRIP' | 'GEAR_WASH' | 'MANUAL' | 'COMBINED';
export interface TankRuleConfig {
  basis: TankBasis;
  rate: number | null;
  rates?: { tanks: number | null; passengers: number | null; gearWash: number | null };
  distribution: 'EQUAL' | 'WEIGHTED' | 'PERCENTAGE' | 'FIXED';
  missingPolicy: 'BLOCK' | 'UNALLOCATED' | 'REDISTRIBUTE';
  roles: {
    name: string;
    slots: number;
    value: number | null;
    basis?: Exclude<TankBasis, 'MANUAL' | 'COMBINED'>;
  }[];
  payComplimentary: boolean;
  payTraining: boolean;
  allowOverrides: boolean;
}
export interface TankRule {
  id: string;
  name: string;
  activityType: string;
  boatId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  config: TankRuleConfig;
  version: number;
}
export interface TankResource {
  id: string;
  kind: 'BOAT' | 'SITE';
  name: string;
  isActive: boolean;
}
export interface TankParticipant {
  staffId: string;
  role: string;
}
export interface TankPreview {
  calculationMode?: 'TANK_EQUAL' | 'LEGACY_RULE';
  staffCount?: number;
  totalCents: number;
  unallocatedCents: number;
  excluded: boolean;
  ruleName: string;
  ruleVersion: number;
  config: TankRuleConfig;
  allocations: { staffId: string; staffName: string; role: string; amountCents: number }[];
}
export interface TankSession {
  id: string;
  requestId: string;
  businessDate: string;
  departureTime: string | null;
  activityType: string;
  boatId: string | null;
  boatName: string | null;
  diveSites: { id: string; name: string }[];
  tanks: number;
  passengers: number;
  dives: number;
  gearWash: number;
  isComplimentary: boolean;
  isTraining: boolean;
  manualTotalCents: number | null;
  participants: TankParticipant[];
  ruleId: string | null;
  override: TankRuleConfig | null;
  overrideReason: string | null;
  notes: string | null;
  status: 'DRAFT' | 'APPROVED' | 'VOID';
  snapshot: TankPreview | null;
  totalCents: number | null;
  unallocatedCents: number | null;
  createdById: string;
  version: number;
}
export interface TankSetup {
  settings: { restricted: boolean; version: number };
  rules: TankRule[];
  resources: TankResource[];
  staff: {
    id: string;
    name: string;
    roleTitle: string;
    erNumber: string | null;
    hireDate: string;
    leavingDate: string | null;
  }[];
}

export interface TripPayroll {
  startDate: string;
  endDate: string;
  tripCount: number;
  totalCommissionCents: number;
  rows: {
    staffId: string;
    staffName: string;
    erNumber: string | null;
    tripsWorked: number;
    totalCommissionCents: number;
  }[];
}
