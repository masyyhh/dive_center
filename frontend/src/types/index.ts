export type UserRole = 'GLOBAL_ADMIN' | 'PROPERTY_MANAGER' | 'CENTRE_STAFF';

export interface Property {
  id: string;
  code: string;
  name: string;
  deletedAt?: string | null;
  pmsPropertyCodes?: string[];
  pmsPropertyCode?: string | null;
  location?: string | null;
  currency: string;
  currencySymbol: string;
  taxRate: number;
  serviceChargeRate: number;
  nextCheckNumber: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    bills: number;
    staffMembers: number;
  };
}

export interface User {
  id: string;
  username: string;
  authenticatorEnabled: boolean;
  email?: string | null;
  name: string;
  role: UserRole;
  failedLoginAttempts?: number;
  lockedUntil?: string | null;
  isActive: boolean;
  createdAt: string;
  assignedProperties: Property[];
}

export interface StaffMember {
  userId?: string | null;
  id: string;
  propertyId: string;
  name: string;
  email?: string | null;
  roleTitle: string;
  isDiveStaff: boolean;
  isCoursePoolSharing: boolean;
  isDivePoolSharing: boolean;
  isBaseLeaderOverride: boolean;
  hireDate: string;
  leavingDate?: string | null;
  isActive: boolean;
}

export interface Category {
  id: string;
  propertyId: string;
  name: string;
  sortOrder: number;
}

export interface Item {
  id: string;
  propertyId: string;
  categoryId: string;
  category?: Category;
  code: string;
  name: string;
  price: number;
  poolType: 'COURSE_POOL' | 'DIVE_POOL' | 'NONE';
  poolContribution: number;
  personalRoles?: string | null;
  personalRatesJson?: string | null;
  isActive: boolean;
  hasBillHistory?: boolean;
}

export interface BillItem {
  id?: string;
  itemId?: string | null;
  itemName: string;
  categoryName: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  lineTotal: number;
  sellerStaffId?: string | null;
  guideStaffId?: string | null;
  instructorStaffId?: string | null;
  photoStaffId?: string | null;
  videoStaffId?: string | null;
  sellerStaff?: { id: string; name: string };
  guideStaff?: { id: string; name: string };
  instructorStaff?: { id: string; name: string };
  photoStaff?: { id: string; name: string };
  videoStaff?: { id: string; name: string };
  personalCommissionsJson?: string | null;
  totalPersonalCommission?: number;
}

export interface Bill {
  id: string;
  propertyId: string;
  checkNumber: number;
  businessDate: string;
  guestName: string;
  roomNumber: string;
  departureDate?: string | null;
  nationality: string;
  grossAmount: number;
  discountAmount: number;
  serviceChargeAmount: number;
  taxAmount: number;
  tipAmount: number;
  netAmount: number;
  tipStaffIdsJson?: string | null;
  status: 'ACTIVE' | 'REBATED' | 'DELETED';
  rebateReason?: string | null;
  rebatedFromBillId?: string | null;
  notes?: string | null;
  createdById: string;
  createdBy?: { id: string; name: string };
  items: BillItem[];
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceItem {
  staffMemberId: string;
  staffName: string;
  roleTitle: string;
  isCoursePoolSharing: boolean;
  isDivePoolSharing: boolean;
  isBaseLeaderOverride: boolean;
  status: 'PRESENT' | 'OFF' | 'OFF_HALF' | 'ANNUAL_LEAVE' | 'SICK' | 'ABSENT' | 'EMERGENCY_LEAVE';
  note?: string;
  isSaved: boolean;
}

export interface MonthPresenceStatus {
  yearMonth: string;
  missingDaysCount: number;
  dayStatuses: Record<
    string,
    {
      status: 'recorded' | 'partial' | 'missing' | 'future';
      markedCount: number;
      expectedCount: number;
    }
  >;
}

export interface StaffCommissionResult {
  staffId: string;
  staffName: string;
  roleTitle: string;
  courseCommission: number;
  diveCommission: number;
  overrideCommission: number;
  tipsCommission: number;
  personalCommission: number;
  totalCommission: number;
}

export interface PersonalCommissionDetail {
  id: string;
  checkNumber: number;
  businessDate: string;
  guestName: string;
  roomNumber: string;
  itemName: string;
  role: string;
  staffId: string;
  staffName: string;
  amount: number;
}

export interface DashboardReport {
  property: {
    id: string;
    name: string;
    currency: string;
    currencySymbol: string;
  };
  period: {
    startDate: string;
    endDate: string;
    isLocked: boolean;
  };
  headline: {
    turnover: number;
    serviceCharge: number;
    tax: number;
    billCount: number;
    averageBill: number;
    totalCommission: number;
    netRevenue: number;
  };
  charts: {
    categoryRevenue: { category: string; amount: number }[];
    nationalityRevenue: { nationality: string; amount: number }[];
    topItems: { name: string; count: number; revenue: number }[];
    weekdayRevenue: { day: string; amount: number }[];
    dailyTrends: { date: string; revenue: number; billsCount: number }[];
  };
  staffCommissions: StaffCommissionResult[];
  personalDetails: PersonalCommissionDetail[];
}

export interface AuditLog {
  id: string;
  propertyId?: string | null;
  userId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  user?: { id: string; name: string; email: string | null; role: string };
  property?: { id: string; name: string; code: string };
}

export interface PmsGuest {
  propertyCode: string;
  roomNumber: string;
  fullName: string;
  guestType: 'main' | 'sharer';
  nationality: string | null;
  nationalityCode: string | null;
  checkoutDate: string | null;
  arrivalDate: string | null;
  confirmationNumber: string | null;
}
