import React, { useState, useEffect } from 'react';
import { useProperty } from '../context/PropertyContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../services/api';
import { Property, User, StaffMember, Item, Category, AuditLog } from '../types';
import {
  Building,
  Users,
  Shield,
  KeyRound,
  Unlock,
  Plus,
  Edit2,
  Trash2,
  History,
  CheckCircle,
  AlertCircle,
  Clock,
  Sliders,
  DollarSign,
  Tag,
  Lock,
} from 'lucide-react';

export const AdminView: React.FC = () => {
  const { user } = useAuth();
  const { activeProperty, properties, refreshProperties } = useProperty();

  const isGlobalAdmin = user?.role === 'GLOBAL_ADMIN';

  type AdminTab = 'properties' | 'users' | 'staff' | 'items' | 'audit';
  const [activeTab, setActiveTab] = useState<AdminTab>(isGlobalAdmin ? 'properties' : 'staff');

  // Properties state
  const [showPropertyModal, setShowPropertyModal] = useState<boolean>(false);
  const [propForm, setPropForm] = useState({
    name: '',
    code: '',
    location: '',
    currency: 'USD',
    currencySymbol: '$',
    taxRate: 16.0,
    serviceChargeRate: 10.0,
    nextCheckNumber: 1001,
  });

  // Users state
  const [usersList, setUsersList] = useState<User[]>([]);
  const [showUserModal, setShowUserModal] = useState<boolean>(false);
  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'CENTRE_STAFF' as User['role'],
    propertyIds: [] as string[],
  });

  // Password Reset state
  const [resetTargetUser, setResetTargetUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState<string>('');

  // Staff state
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [showStaffModal, setShowStaffModal] = useState<boolean>(false);
  const [staffForm, setStaffForm] = useState({
    name: '',
    email: '',
    roleTitle: 'Instructor',
    isDiveStaff: true,
    isCoursePoolSharing: true,
    isDivePoolSharing: true,
    isBaseLeaderOverride: false,
    hireDate: new Date().toISOString().substring(0, 10),
    leavingDate: '',
  });

  // Items & Categories state
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [showItemModal, setShowItemModal] = useState<boolean>(false);
  const [itemForm, setItemForm] = useState({
    categoryId: '',
    code: '',
    name: '',
    price: 85.0,
    poolType: 'DIVE_POOL' as Item['poolType'],
    poolContribution: 10.0,
    personalRoles: 'seller,guide',
    personalRatesJson: '{"seller": 5, "guide": 10}',
  });

  // Audit Logs state
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [loading, setLoading] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3500);
  };

  // Fetch Users
  const loadUsers = async () => {
    if (!isGlobalAdmin) return;
    try {
      setLoading(true);
      const res = await apiFetch<{ users: User[] }>('/users');
      setUsersList(res.users);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Staff
  const loadStaff = async () => {
    if (!activeProperty) return;
    try {
      setLoading(true);
      const res = await apiFetch<{ staff: StaffMember[] }>(
        `/staff?propertyId=${activeProperty.id}`
      );
      setStaffList(res.staff);
    } catch (err) {
      console.error('Failed to load staff:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Items & Categories
  const loadItems = async () => {
    if (!activeProperty) return;
    try {
      setLoading(true);
      const res = await apiFetch<{ categories: Category[]; items: Item[] }>(
        `/items?propertyId=${activeProperty.id}`
      );
      setCategories(res.categories);
      setItems(res.items);
      if (res.categories.length > 0 && !itemForm.categoryId) {
        setItemForm((prev) => ({ ...prev, categoryId: res.categories[0].id }));
      }
    } catch (err) {
      console.error('Failed to load items:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Audit Logs
  const loadAuditLogs = async () => {
    if (!activeProperty) return;
    try {
      setLoading(true);
      const res = await apiFetch<{ logs: AuditLog[] }>(
        `/audit?propertyId=${activeProperty.id}`
      );
      setAuditLogs(res.logs);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'users' && isGlobalAdmin) loadUsers();
    if (activeTab === 'staff') loadStaff();
    if (activeTab === 'items') loadItems();
    if (activeTab === 'audit') loadAuditLogs();
  }, [activeTab, activeProperty]);

  // Create Property Handler (Global Admin)
  const handleCreateProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/properties', {
        method: 'POST',
        body: JSON.stringify(propForm),
      });
      setShowPropertyModal(false);
      showNotification(`Property '${propForm.name}' created successfully.`);
      refreshProperties();
    } catch (err: any) {
      alert(err.message || 'Failed to create property.');
    }
  };

  // Create User Handler (Global Admin)
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify(userForm),
      });
      setShowUserModal(false);
      setUserForm({
        name: '',
        email: '',
        password: '',
        role: 'CENTRE_STAFF',
        propertyIds: [],
      });
      showNotification(`User created successfully with role ${userForm.role}.`);
      loadUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to create user.');
    }
  };

  // Reset Password Handler (Global Admin)
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetUser || !newPassword) return;
    try {
      await apiFetch(`/users/${resetTargetUser.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password: newPassword }),
      });
      setResetTargetUser(null);
      setNewPassword('');
      showNotification(`Password for ${resetTargetUser.name} updated. Account lock cleared.`);
      loadUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to reset password.');
    }
  };

  // Unlock Locked Account Handler (Global Admin)
  const handleUnlockUser = async (userId: string) => {
    try {
      await apiFetch(`/users/${userId}/unlock`, { method: 'POST' });
      showNotification('Account unlocked successfully.');
      loadUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to unlock account.');
    }
  };

  // Create Staff Member Handler
  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProperty) return;
    try {
      await apiFetch('/staff', {
        method: 'POST',
        body: JSON.stringify({
          ...staffForm,
          propertyId: activeProperty.id,
        }),
      });
      setShowStaffModal(false);
      showNotification(`Staff member '${staffForm.name}' added.`);
      loadStaff();
    } catch (err: any) {
      alert(err.message || 'Failed to add staff member.');
    }
  };

  // Create Catalogue Item Handler
  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProperty) return;
    try {
      await apiFetch('/items', {
        method: 'POST',
        body: JSON.stringify({
          ...itemForm,
          propertyId: activeProperty.id,
        }),
      });
      setShowItemModal(false);
      showNotification(`Item '${itemForm.name}' added to catalogue.`);
      loadItems();
    } catch (err: any) {
      alert(err.message || 'Failed to add item.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-xs font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider">
            <Shield className="w-4 h-4" />
            <span>Administration & System Configuration</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-1">
            Dive Centre Management Portal
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Role-based multi-tenancy, user provisioning, staff rosters, catalogue & audit logs.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold">
          {isGlobalAdmin && (
            <button
              onClick={() => setActiveTab('properties')}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'properties'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Properties
            </button>
          )}

          {isGlobalAdmin && (
            <button
              onClick={() => setActiveTab('users')}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'users'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              User Accounts
            </button>
          )}

          <button
            onClick={() => setActiveTab('staff')}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'staff'
                ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Staff & Pools
          </button>

          <button
            onClick={() => setActiveTab('items')}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'items'
                ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Catalogue
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'audit'
                ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Change Log
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center space-x-2">
          <CheckCircle className="w-4 h-4 text-emerald-500" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* TAB 1: PROPERTIES (Global Admin) */}
      {activeTab === 'properties' && isGlobalAdmin && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Dive Centres / Properties ({properties.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Each centre operates with dedicated bills, staff rosters, and Micros check ranges.
              </p>
            </div>
            <button
              onClick={() => setShowPropertyModal(true)}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs shadow-xs transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>New Property</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {properties.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-mono text-xs font-bold text-sky-500 bg-sky-500/10 px-2 py-0.5 rounded">
                      {p.code}
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                      {p.name}
                    </h4>
                    <span className="text-[11px] text-slate-400">{p.location || 'Maldives'}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    Active
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700/60 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Tax Rate:</span>
                    <span className="font-semibold">{p.taxRate}%</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Service Charge:</span>
                    <span className="font-semibold">{p.serviceChargeRate}%</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Next Check #:</span>
                    <span className="font-mono font-bold text-sky-500">#{p.nextCheckNumber}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: USER MANAGEMENT (Global Admin) */}
      {activeTab === 'users' && isGlobalAdmin && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                User Accounts & Access Control ({usersList.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Per PDF manual: Passwords are administrator-set. 5 consecutive wrong passwords trigger a security lockout.
              </p>
            </div>
            <button
              onClick={() => setShowUserModal(true)}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs shadow-xs transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Create User</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Name & Email</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Assigned Centres</th>
                  <th className="py-3 px-4">Security Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {usersList.map((u) => {
                  const isLocked = u.lockedUntil && new Date(u.lockedUntil) > new Date();

                  return (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-white">{u.name}</div>
                        <div className="text-[11px] text-slate-400">{u.email}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                          {u.role}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {u.role === 'GLOBAL_ADMIN' ? (
                          <span className="text-purple-600 dark:text-purple-400 font-semibold">
                            All Centres (Global)
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {u.assignedProperties.map((p) => (
                              <span
                                key={p.id}
                                className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800 text-[10px] font-medium"
                              >
                                {p.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {isLocked ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 flex items-center space-x-1 w-max">
                            <Lock className="w-3 h-3" />
                            <span>Locked (5 wrong passwords)</span>
                          </span>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            Normal (0 failed attempts)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        {/* Reset Password Button */}
                        <button
                          onClick={() => setResetTargetUser(u)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-semibold transition inline-flex items-center space-x-1"
                          title="Set user password"
                        >
                          <KeyRound className="w-3 h-3 text-amber-500" />
                          <span>Set Password</span>
                        </button>

                        {/* Unlock Account Button */}
                        {isLocked && (
                          <button
                            onClick={() => handleUnlockUser(u.id)}
                            className="px-2.5 py-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-bold transition inline-flex items-center space-x-1 shadow-xs"
                            title="Manually unlock this account"
                          >
                            <Unlock className="w-3 h-3" />
                            <span>Unlock</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: STAFF ROSTER & POOL RULES */}
      {activeTab === 'staff' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Staff Roster for {activeProperty?.name} ({staffList.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Configure roles, hire/leaving dates, course pool, dive pool, and base-leader override (+10%).
              </p>
            </div>
            <button
              onClick={() => setShowStaffModal(true)}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs shadow-xs transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add Staff</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Name & Title</th>
                  <th className="py-3 px-4">Employment Window</th>
                  <th className="py-3 px-4">Dive Staff?</th>
                  <th className="py-3 px-4">Course Pool</th>
                  <th className="py-3 px-4">Dive Pool</th>
                  <th className="py-3 px-4">BL Override (+10%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {staffList.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">{s.name}</div>
                      <div className="text-[11px] text-slate-400">{s.roleTitle}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                      Hired: {s.hireDate} {s.leavingDate ? `• Left: ${s.leavingDate}` : '• Active'}
                    </td>
                    <td className="py-3 px-4">
                      {s.isDiveStaff ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                          Yes (Presence active)
                        </span>
                      ) : (
                        <span className="text-slate-400">No (Excluded from presence)</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {s.isCoursePoolSharing ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓ Sharing</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {s.isDivePoolSharing ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓ Sharing</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {s.isBaseLeaderOverride ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          +10% Extra
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: ITEM CATALOGUE */}
      {activeTab === 'items' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Catalogue & Commission Rules for {activeProperty?.name} ({items.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Define price, pool share contribution, and personal commission roles.
              </p>
            </div>
            <button
              onClick={() => setShowItemModal(true)}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs shadow-xs transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add Item</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Code & Item</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Price</th>
                  <th className="py-3 px-4">Pool Contribution</th>
                  <th className="py-3 px-4">Personal Roles & Fixed Amounts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4">
                      <span className="font-mono text-sky-500 font-bold mr-2">[{it.code}]</span>
                      <span className="font-bold text-slate-900 dark:text-white">{it.name}</span>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">
                      {it.category?.name || 'General'}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                      ${it.price.toFixed(2)}
                    </td>
                    <td className="py-3 px-4">
                      {it.poolType !== 'NONE' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">
                          {it.poolType}: ${it.poolContribution.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-slate-400">None</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {it.personalRoles ? (
                        <div className="space-y-0.5">
                          <span className="font-semibold text-purple-600 dark:text-purple-400">
                            {it.personalRoles}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono block">
                            Rates: {it.personalRatesJson || 'N/A'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: AUDIT CHANGE LOG */}
      {activeTab === 'audit' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <History className="w-5 h-5 text-sky-500" />
              <span>Administrator Change Log & Audit Trail</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Tracks re-dates, rebates, soft-deletions, password resets, failed login locks, and payroll freezes.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">IP Address</th>
                  <th className="py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono font-bold text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">
                      {log.user?.name || 'System / Guest'}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                      {log.ipAddress || '127.0.0.1'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-mono text-[11px] max-w-md truncate">
                      {log.details || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: CREATE PROPERTY */}
      {showPropertyModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Create Dive Centre Property
            </h3>
            <form onSubmit={handleCreateProperty} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Property Name *
                </label>
                <input
                  type="text"
                  required
                  value={propForm.name}
                  onChange={(e) => setPropForm({ ...propForm, name: e.target.value })}
                  placeholder="e.g. Sun Diving - Baa Atoll"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Property Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={propForm.code}
                    onChange={(e) => setPropForm({ ...propForm, code: e.target.value.toUpperCase() })}
                    placeholder="SUN-BAA"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Currency Symbol
                  </label>
                  <input
                    type="text"
                    value={propForm.currencySymbol}
                    onChange={(e) => setPropForm({ ...propForm, currencySymbol: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Tax (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={propForm.taxRate}
                    onChange={(e) => setPropForm({ ...propForm, taxRate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    SC (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={propForm.serviceChargeRate}
                    onChange={(e) => setPropForm({ ...propForm, serviceChargeRate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Start Check #
                  </label>
                  <input
                    type="number"
                    value={propForm.nextCheckNumber}
                    onChange={(e) => setPropForm({ ...propForm, nextCheckNumber: parseInt(e.target.value, 10) || 1001 })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowPropertyModal(false)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold transition"
                >
                  Save Property
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CREATE USER */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Create New User Account
            </h3>
            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={userForm.name}
                  onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                  placeholder="e.g. Hassan Rauf"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  placeholder="hassan@sundiving.com"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Initial Password (Admin-set) *
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  placeholder="Minimum 6 characters"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Role *
                </label>
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                >
                  <option value="CENTRE_STAFF">Centre Staff (Fixed to assigned centre)</option>
                  <option value="PROPERTY_MANAGER">Property Manager (Multiple assigned centres)</option>
                  <option value="GLOBAL_ADMIN">Global Admin (Unrestricted system-wide)</option>
                </select>
              </div>

              {userForm.role !== 'GLOBAL_ADMIN' && (
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Assign Properties:
                  </label>
                  <div className="space-y-1 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 max-h-36 overflow-y-auto">
                    {properties.map((p) => {
                      const isChecked = userForm.propertyIds.includes(p.id);
                      return (
                        <label key={p.id} className="flex items-center space-x-2 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setUserForm({ ...userForm, propertyIds: [...userForm.propertyIds, p.id] });
                              } else {
                                setUserForm({
                                  ...userForm,
                                  propertyIds: userForm.propertyIds.filter((id) => id !== p.id),
                                });
                              }
                            }}
                          />
                          <span>{p.name} ({p.code})</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold transition"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESET PASSWORD */}
      {resetTargetUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <KeyRound className="w-5 h-5 text-amber-500" />
              <span>Set Password for {resetTargetUser.name}</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Per PDF manual: Passwords are set by administrator. Setting a new password clears any active 5-wrong-passwords lock.
            </p>

            <form onSubmit={handleResetPassword} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  New Password:
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetTargetUser(null)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold transition"
                >
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD STAFF */}
      {showStaffModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Add Staff Member to {activeProperty?.name}
            </h3>
            <form onSubmit={handleCreateStaff} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={staffForm.name}
                  onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                  placeholder="e.g. Elena Petrova"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Role Title *
                </label>
                <select
                  value={staffForm.roleTitle}
                  onChange={(e) => {
                    const title = e.target.value;
                    const isBL = title === 'Base Leader';
                    const isCourse = ['Base Leader', 'Assistant Base Leader', 'Instructor'].includes(title);
                    setStaffForm({
                      ...staffForm,
                      roleTitle: title,
                      isBaseLeaderOverride: isBL,
                      isCoursePoolSharing: isCourse,
                    });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                >
                  <option value="Base Leader">Base Leader</option>
                  <option value="Assistant Base Leader">Assistant Base Leader</option>
                  <option value="Instructor">Instructor</option>
                  <option value="Divemaster">Divemaster</option>
                  <option value="Underwater Photographer">Underwater Photographer</option>
                  <option value="Boat Crew">Boat Crew</option>
                  <option value="Receptionist">Receptionist (Non-dive)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Hire Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={staffForm.hireDate}
                    onChange={(e) => setStaffForm({ ...staffForm, hireDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Leaving Date (optional)
                  </label>
                  <input
                    type="date"
                    value={staffForm.leavingDate}
                    onChange={(e) => setStaffForm({ ...staffForm, leavingDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>
              </div>

              {/* Pool checkboxes */}
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={staffForm.isDiveStaff}
                    onChange={(e) => setStaffForm({ ...staffForm, isDiveStaff: e.target.checked })}
                  />
                  <span>Dive staff (Appears in Presence & Attendance register)</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={staffForm.isCoursePoolSharing}
                    onChange={(e) => setStaffForm({ ...staffForm, isCoursePoolSharing: e.target.checked })}
                  />
                  <span>Shares in Course Pool (Base Leader, Asst, Instructor)</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={staffForm.isDivePoolSharing}
                    onChange={(e) => setStaffForm({ ...staffForm, isDivePoolSharing: e.target.checked })}
                  />
                  <span>Shares in Dive Pool (All dive staff)</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={staffForm.isBaseLeaderOverride}
                    onChange={(e) => setStaffForm({ ...staffForm, isBaseLeaderOverride: e.target.checked })}
                  />
                  <span className="font-bold text-amber-600 dark:text-amber-400">
                    Base Leader Override (+10% extra of total pool)
                  </span>
                </label>
              </div>

              <div className="flex space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowStaffModal(false)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold transition"
                >
                  Add Staff Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD CATALOGUE ITEM */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Add Item to Catalogue
            </h3>
            <form onSubmit={handleCreateItem} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Item Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={itemForm.code}
                    onChange={(e) => setItemForm({ ...itemForm, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. DIVE-05"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Category *
                  </label>
                  <select
                    value={itemForm.categoryId}
                    onChange={(e) => setItemForm({ ...itemForm, categoryId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Item Name *
                </label>
                <input
                  type="text"
                  required
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  placeholder="e.g. Wreck Dive Special"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Price ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={itemForm.price}
                    onChange={(e) => setItemForm({ ...itemForm, price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Pool Type
                  </label>
                  <select
                    value={itemForm.poolType}
                    onChange={(e) => setItemForm({ ...itemForm, poolType: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  >
                    <option value="DIVE_POOL">Dive Pool</option>
                    <option value="COURSE_POOL">Course Pool</option>
                    <option value="NONE">None (No Pool Share)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Personal Commission Roles (comma-separated, e.g. seller,guide)
                </label>
                <input
                  type="text"
                  value={itemForm.personalRoles}
                  onChange={(e) => setItemForm({ ...itemForm, personalRoles: e.target.value })}
                  placeholder="seller,guide,instructor,photo,video"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Personal Commission Rates JSON (e.g. {`{"seller": 10, "guide": 15}`})
                </label>
                <input
                  type="text"
                  value={itemForm.personalRatesJson}
                  onChange={(e) => setItemForm({ ...itemForm, personalRatesJson: e.target.value })}
                  placeholder='{"seller": 5, "guide": 10}'
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono focus:outline-none"
                />
              </div>

              <div className="flex space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowItemModal(false)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold transition"
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
