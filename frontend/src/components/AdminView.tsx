import { pmsResortCodes } from '../utils/pmsGuests';
import { passwordHelp, passwordPattern } from './PasswordRecoveryView';
import { formatMoney } from '../utils/format';
import { Modal } from './Modal';
import { businessToday } from '../utils/dates';
import React, { useState, useEffect } from 'react';
import { useProperty } from '../context/PropertyContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch, downloadFile } from '../services/api';
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

export const AdminView: React.FC<{ section?: string; onSectionChange: (section: string) => void }> = ({ section, onSectionChange }) => {
  const { user, refreshUser } = useAuth();
  const { activeProperty, properties, refreshProperties } = useProperty();

  const isGlobalAdmin = user?.role === 'GLOBAL_ADMIN';
  const canManageAccounts = isGlobalAdmin || user?.role === 'PROPERTY_MANAGER';

  type AdminTab = 'properties' | 'users' | 'staff' | 'items' | 'audit';
  const [activeTab, setActiveTab] = useState<AdminTab>(section === 'items' || section === 'staff' || section === 'audit' || ((canManageAccounts && section === 'users') || (isGlobalAdmin && section === 'properties')) ? section : isGlobalAdmin ? 'properties' : 'staff');

  useEffect(() => {
    if (section === 'items' || section === 'staff' || section === 'audit' || ((canManageAccounts && section === 'users') || (isGlobalAdmin && section === 'properties'))) setActiveTab(section);
  }, [section, isGlobalAdmin, canManageAccounts]);
  // Properties state
  const [propertySaving, setPropertySaving] = useState(false);
  const [deletePropertyTarget, setDeletePropertyTarget] = useState<Property | null>(null);
  const [deletePropertyCode, setDeletePropertyCode] = useState('');
  const [propertyDeleting, setPropertyDeleting] = useState(false);
  const closePropertyDelete = () => { if (!propertyDeleting) { setDeletePropertyTarget(null); setDeletePropertyCode(''); setErrorMsg(null); } };
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [showPropertyModal, setShowPropertyModal] = useState<boolean>(false);
  const [propForm, setPropForm] = useState({
    name: '',
    code: '',
    pmsPropertyCodes: [] as string[],
    location: '',
    currency: 'USD',
    currencySymbol: '$',
    taxRate: 16.0,
    serviceChargeRate: 10.0,
    nextCheckNumber: 1001,
    isActive: true,
  });

  // Users state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userSaving, setUserSaving] = useState(false);
  const [deleteUserTarget, setDeleteUserTarget] = useState<User | null>(null);
  const [deleteUsername, setDeleteUsername] = useState('');
  const [userDeleting, setUserDeleting] = useState(false);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [showUserModal, setShowUserModal] = useState<boolean>(false);
  const [userForm, setUserForm] = useState({
    username: '',
    name: '',
    email: '',
    password: '',
    isActive: true,
    role: 'CENTRE_STAFF' as User['role'],
    propertyIds: [] as string[],
  });

  // Password Reset state
  const [resetTargetUser, setResetTargetUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetAuthenticator, setResetAuthenticator] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const closePasswordReset = () => { setResetTargetUser(null); setResetAuthenticator(false); setNewPassword(''); setConfirmPassword(''); setErrorMsg(null); };

  const [staffBusy, setStaffBusy] = useState(false);
  const [giveStaffLogin, setGiveStaffLogin] = useState(false);
  const [staffLogin, setStaffLogin] = useState({ username: '', password: '' });

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
    hireDate: businessToday(),
    leavingDate: '',
  });

  const [transferBusy, setTransferBusy] = useState(false);
  const [catalogueImport, setCatalogueImport] = useState<{ propertyId: string; content: string; format: 'csv' | 'xlsx'; created: number; updated: number; total: number; previewRows: { code: string; name: string; category: string; price: number; isActive: boolean; commission: { poolType: string; poolContribution: number; personalRates: Record<string, number> } }[] } | null>(null);
  // Items & Categories state
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [showArchivedItems, setShowArchivedItems] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<Item | null>(null);
  const [itemBusy, setItemBusy] = useState(false);
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
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const auditGeneration = React.useRef(0);

  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setSuccessMsg(msg);
    setErrorMsg(null);
    setTimeout(() => setSuccessMsg(null), 3500);
  };

  // Fetch Users
  const loadUsers = async () => {
    if (!canManageAccounts) return;
    try {
      setLoading(true);
      const res = await apiFetch<{ users: User[] }>('/users');
      setUsersList(res.users);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not load this section. Please try again.');
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
      setErrorMsg(err instanceof Error ? err.message : 'Could not load this section. Please try again.');
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
        `/items?propertyId=${activeProperty.id}&includeInactive=true`
      );
      setCategories(res.categories);
      setItems(res.items);
      if (res.categories.length > 0 && !itemForm.categoryId) {
        setItemForm((prev) => ({ ...prev, categoryId: res.categories[0].id }));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not load this section. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch Audit Logs
  const loadAuditLogs = async (cursor?: string) => {
    if (!isGlobalAdmin && !activeProperty) return;
    const generation = ++auditGeneration.current;
    try {
      setLoading(true);
      if (!cursor) { setAuditLogs([]); setAuditCursor(null); }
      const params = new URLSearchParams({ propertyId: isGlobalAdmin ? 'all' : activeProperty!.id });
      if (cursor) params.set('cursor', cursor);
      const res = await apiFetch<{ logs: AuditLog[]; nextCursor: string | null }>(`/audit?${params}`);
      if (generation !== auditGeneration.current) return;
      setAuditLogs(previous => cursor ? [...previous, ...res.logs] : res.logs);
      setAuditCursor(res.nextCursor);
    } catch (err) {
      if (generation === auditGeneration.current) setErrorMsg(err instanceof Error ? err.message : 'Could not load the audit log.');
    } finally {
      if (generation === auditGeneration.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'users' && canManageAccounts) loadUsers();
    if (activeTab === 'staff') loadStaff();
    if (activeTab === 'items') loadItems();
    if (activeTab === 'audit') loadAuditLogs();
  }, [activeTab, activeProperty]);

  const [pmsSavingProperty, setPmsSavingProperty] = useState<string | null>(null);
  const updatePmsCode = async (id: string, pmsPropertyCodes: string[]) => {
    setPmsSavingProperty(id); setErrorMsg(null);
    try {
      await apiFetch(`/properties/${id}`, { method: 'PUT', body: JSON.stringify({ pmsPropertyCodes }) });
      await refreshProperties(); showNotification('PMS resort setting saved.');
    } catch (err: any) { setErrorMsg(err.message || 'Unable to update PMS resort.'); }
    finally { setPmsSavingProperty(null); }
  };

  const openPropertyForm = (property: Property | null = null) => {
    setEditingProperty(property);
    setPropForm(property ? {
      name: property.name, code: property.code, location: property.location ?? '',
      pmsPropertyCodes: property.pmsPropertyCodes?.length ? [...property.pmsPropertyCodes] : property.pmsPropertyCode ? [property.pmsPropertyCode] : [],
      currency: property.currency, currencySymbol: property.currencySymbol,
      taxRate: property.taxRate, serviceChargeRate: property.serviceChargeRate,
      nextCheckNumber: property.nextCheckNumber, isActive: property.isActive,
    } : { name: '', code: '', pmsPropertyCodes: [], location: '', currency: 'USD', currencySymbol: '$', taxRate: 16, serviceChargeRate: 10, nextCheckNumber: 1001, isActive: true });
    setErrorMsg(null);
    setShowPropertyModal(true);
  };

  // Save Property Handler (Global Admin)
  const handleSaveProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isGlobalAdmin || propertySaving) return;
    const name = propForm.name.trim();
    const code = propForm.code.trim().toUpperCase();
    if (name.length < 2) {
      setErrorMsg('Property name must contain at least 2 characters.');
      return;
    }
    if ((editingProperty || code) && (code.length < 2 || code.length > 10)) {
      setErrorMsg('Property code must contain 2–10 characters, for example OLHU or SUN-BAA.');
      return;
    }
    setPropertySaving(true); setErrorMsg(null);
    try {
      await apiFetch(editingProperty ? `/properties/${editingProperty.id}` : '/properties', {
        method: editingProperty ? 'PUT' : 'POST',
        body: JSON.stringify({ ...propForm, name, code }),
      });
      setShowPropertyModal(false);
      showNotification(`Property '${name}' ${editingProperty ? 'updated' : 'created'} successfully.`);
      setPropForm({ name: '', code: '', pmsPropertyCodes: [], location: '', currency: 'USD', currencySymbol: '$', taxRate: 16, serviceChargeRate: 10, nextCheckNumber: 1001, isActive: true });
      await refreshProperties();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save property.');
    } finally { setPropertySaving(false); }
  };

  const handleDeleteProperty = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isGlobalAdmin || !deletePropertyTarget || propertyDeleting || deletePropertyCode.trim().toUpperCase() !== deletePropertyTarget.code) return;
    setPropertyDeleting(true); setErrorMsg(null);
    try {
      await apiFetch(`/properties/${deletePropertyTarget.id}`, { method: 'DELETE', body: JSON.stringify({ confirmationCode: deletePropertyCode }) });
      const name = deletePropertyTarget.name;
      setDeletePropertyTarget(null); setDeletePropertyCode('');
      await refreshProperties();
      showNotification(`Property '${name}' removed from the workspace. Its history has been retained.`);
    } catch (err: any) { setErrorMsg(err.message || 'Failed to delete property.'); }
    finally { setPropertyDeleting(false); }
  };

  const openUserForm = (account: User | null = null) => {
    setEditingUser(account);
    setUserForm({ username: account?.username ?? '', name: account?.name ?? '', email: account?.email ?? '',
      password: '', role: account?.role ?? 'CENTRE_STAFF', isActive: account?.isActive ?? true,
      propertyIds: account?.assignedProperties.map(property => property.id) ?? [],
    });
    setErrorMsg(null);
    setShowUserModal(true);
  };

  const handleSaveUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (userSaving || (editingUser && !isGlobalAdmin)) return;
    setUserSaving(true); setErrorMsg(null);
    try {
      const { password, isActive, ...details } = userForm;
      await apiFetch(editingUser ? `/users/${editingUser.id}` : '/users', {
        method: editingUser ? 'PUT' : 'POST',
        body: JSON.stringify(editingUser ? { ...details, isActive } : { ...details, password }),
      });
      setShowUserModal(false);
      showNotification(editingUser ? 'User updated successfully.' : `User created successfully with role ${userForm.role}.`);
      await loadUsers();
      if (editingUser?.id === user?.id) await refreshUser();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save user.');
    } finally { setUserSaving(false); }
  };

  const closeUserDelete = () => {
    if (userDeleting) return;
    setDeleteUserTarget(null); setDeleteUsername(''); setErrorMsg(null);
  };

  const handleDeleteUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isGlobalAdmin || !deleteUserTarget || userDeleting || deleteUsername.trim().toLowerCase() !== deleteUserTarget.username) return;
    setUserDeleting(true); setErrorMsg(null);
    try {
      await apiFetch(`/users/${deleteUserTarget.id}`, { method: 'DELETE', body: JSON.stringify({ confirmationUsername: deleteUsername }) });
      setDeleteUserTarget(null); setDeleteUsername('');
      showNotification('User deleted. Access revoked and business history retained.');
      await loadUsers();
    } catch (err: any) { setErrorMsg(err.message || 'Failed to delete user.'); }
    finally { setUserDeleting(false); }
  };

  // Reset password for an account permitted by the server
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetUser || resetBusy) return;
    if (!new RegExp(`^${passwordPattern}$`).test(newPassword)) { setErrorMsg(passwordHelp); return; }
    if (newPassword !== confirmPassword) { setErrorMsg('Passwords do not match.'); return; }
    setResetBusy(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/users/${resetTargetUser.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password: newPassword, resetAuthenticator }),
      });
      closePasswordReset();
      showNotification(`Password for ${resetTargetUser.name} updated. Account lock cleared.`);
      loadUsers();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to reset password.');
    } finally {
      setResetBusy(false);
    }
  };

  // Unlock Locked Account Handler (Global Admin)
  const handleUnlockUser = async (userId: string) => {
    try {
      await apiFetch(`/users/${userId}/unlock`, { method: 'POST' });
      showNotification('Account unlocked successfully.');
      loadUsers();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to unlock account.');
    }
  };

  // Create Staff Member Handler
  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProperty || staffBusy) return;
    setStaffBusy(true); setErrorMsg(null);
    try {
      await apiFetch('/staff', {
        method: 'POST',
        body: JSON.stringify({
          ...staffForm,
          leavingDate: staffForm.leavingDate || null,
          ...(giveStaffLogin ? { loginAccess: staffLogin } : {}),
          propertyId: activeProperty.id,
        }),
      });
      setShowStaffModal(false);
      setStaffLogin({ username: '', password: '' }); setGiveStaffLogin(false);
      setStaffForm(form => ({ ...form, name: '', email: '', hireDate: businessToday(), leavingDate: '' }));
      if (giveStaffLogin) void loadUsers();
      showNotification(`Staff member '${staffForm.name}' added.`);
      loadStaff();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to add staff member.');
    } finally { setStaffBusy(false); }
  };

  const handleCreateCategory = async () => {
    if (!activeProperty || !newCategoryName.trim() || categoryBusy) return;
    setCategoryBusy(true); setErrorMsg(null);
    try {
      const result = await apiFetch<{ category: Category }>('/items/categories', { method: 'POST', body: JSON.stringify({ propertyId: activeProperty.id, name: newCategoryName.trim() }) });
      setCategories(current => [...current, result.category]);
      setItemForm(form => ({ ...form, categoryId: result.category.id }));
      setNewCategoryName(''); setShowCategoryInput(false);
    } catch (error) { setErrorMsg(error instanceof Error ? error.message : 'Could not create the category.'); }
    finally { setCategoryBusy(false); }
  };

  const exportCatalogue = async (format: 'csv' | 'xlsx', template = false) => {
    if (!activeProperty || transferBusy) return;
    setTransferBusy(true); setErrorMsg(null);
    try { await downloadFile(`/items/export?propertyId=${encodeURIComponent(activeProperty.id)}&format=${format}&template=${template}`, `catalogue${template ? '-template' : ''}.${format}`); }
    catch (err) { setErrorMsg(err instanceof Error ? err.message : 'Could not export catalogue.'); }
    finally { setTransferBusy(false); }
  };
  const previewCatalogue = async (file?: File) => {
    if (!file || !activeProperty || transferBusy) return;
    setCatalogueImport(null); setErrorMsg(null);
    if (file.size > 3 * 1024 * 1024 || !/\.(csv|xlsx)$/i.test(file.name)) { setErrorMsg('Choose a CSV or Excel file up to 3 MB.'); return; }
    setTransferBusy(true);
    const propertyId = activeProperty.id;
    try {
      const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read this file.')); reader.readAsDataURL(file); });
      const format = file.name.toLowerCase().endsWith('.csv') ? 'csv' as const : 'xlsx' as const;
      const result = await apiFetch<{ created: number; updated: number; total: number; previewRows: { code: string; name: string; category: string; price: number; isActive: boolean; commission: { poolType: string; poolContribution: number; personalRates: Record<string, number> } }[] }>('/items/import', { method: 'POST', body: JSON.stringify({ propertyId, content, format, preview: true }) });
      setCatalogueImport({ propertyId, content, format, ...result });
    } catch (err) { setErrorMsg(err instanceof Error ? err.message : 'Could not read catalogue.'); }
    finally { setTransferBusy(false); }
  };
  const commitCatalogue = async () => {
    if (!catalogueImport || catalogueImport.propertyId !== activeProperty?.id || transferBusy) return;
    setTransferBusy(true); setErrorMsg(null);
    try {
      const result = await apiFetch<{ total: number }>('/items/import', { method: 'POST', body: JSON.stringify({ propertyId: catalogueImport.propertyId, content: catalogueImport.content, format: catalogueImport.format, preview: false }) });
      setCatalogueImport(null); showNotification(`Imported ${result.total} catalogue items.`); await loadItems();
    } catch (err) { setErrorMsg(err instanceof Error ? err.message : 'Could not import catalogue.'); }
    finally { setTransferBusy(false); }
  };

  const openItemEditor = (item?: Item) => {
    setEditingItem(item || null); setErrorMsg(null); setShowCategoryInput(false); setNewCategoryName('');
    setItemForm(item ? {
      categoryId: item.categoryId, code: item.code, name: item.name, price: item.price,
      poolType: item.poolType, poolContribution: item.poolContribution,
      personalRoles: item.personalRoles || '', personalRatesJson: item.personalRatesJson || '',
    } : { categoryId: categories[0]?.id || '', code: '', name: '', price: 85, poolType: 'DIVE_POOL', poolContribution: 10, personalRoles: 'seller,guide', personalRatesJson: '{"seller": 5, "guide": 10}' });
    setShowItemModal(true);
  };
  const closeItemEditor = () => { if (!itemBusy && !categoryBusy) { setShowItemModal(false); setEditingItem(null); setErrorMsg(null); } };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProperty || itemBusy || categoryBusy) return;
    setItemBusy(true); setErrorMsg(null);
    try {
      await apiFetch(editingItem ? `/items/${editingItem.id}` : '/items', {
        method: editingItem ? 'PUT' : 'POST',
        body: JSON.stringify(editingItem ? itemForm : { ...itemForm, code: undefined, propertyId: activeProperty.id }),
      });
      setShowItemModal(false); setEditingItem(null);
      showNotification(`Activity '${itemForm.name}' ${editingItem ? 'updated' : 'added'} for ${activeProperty.name}.`);
      await loadItems();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save activity.');
    } finally { setItemBusy(false); }
  };

  const handleDeleteItem = async () => {
    if (!deleteItemTarget || itemBusy) return;
    setItemBusy(true); setErrorMsg(null);
    try {
      await apiFetch(`/items/${deleteItemTarget.id}`, { method: 'DELETE' });
      setDeleteItemTarget(null); showNotification('Activity removed from new bills. Existing bills are retained.');
      await loadItems();
    } catch (err) { setErrorMsg(err instanceof Error ? err.message : 'Could not delete activity.'); }
    finally { setItemBusy(false); }
  };
  const handleRestoreItem = async (item: Item) => {
    if (itemBusy) return;
    setItemBusy(true); setErrorMsg(null);
    try {
      await apiFetch(`/items/${item.id}`, { method: 'PUT', body: JSON.stringify({ isActive: true }) });
      showNotification(`Activity '${item.name}' restored.`); await loadItems();
    } catch (err) { setErrorMsg(err instanceof Error ? err.message : 'Could not restore activity.'); }
    finally { setItemBusy(false); }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="feature-heading bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-sm font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider">
            <Shield className="w-4 h-4" />
            <span>WORKSPACE SETTINGS</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-1">
            Administration
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Manage your properties, people, catalogue, and account access.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-sm font-bold">
          {isGlobalAdmin && (
            <button
              onClick={() => onSectionChange('properties')}
              aria-pressed={activeTab === 'properties'}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'properties'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Properties
            </button>
          )}

          {canManageAccounts && (
            <button
              onClick={() => onSectionChange('users')}
              aria-pressed={activeTab === 'users'}
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
            onClick={() => onSectionChange('staff')}
              aria-pressed={activeTab === 'staff'}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'staff'
                ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Staff & Pools
          </button>

          <button
            onClick={() => onSectionChange('items')}
              aria-pressed={activeTab === 'items'}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'items'
                ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Catalogue
          </button>

          <button
            onClick={() => onSectionChange('audit')}
              aria-pressed={activeTab === 'audit'}
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

      {errorMsg && <div role="alert" className="notice notice-error"><AlertCircle size={18} /><span>{errorMsg}</span><button onClick={() => setErrorMsg(null)}>Dismiss</button></div>}
      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm flex items-center space-x-2">
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
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Each centre operates with dedicated bills, staff rosters, and Micros check ranges.
              </p>
            </div>
            <button
              onClick={() => openPropertyForm()}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm shadow-xs transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>New Property</span>
            </button>
          </div>

          {!properties.length && <p className="empty-state">No properties yet. Select New Property to create your first dive centre.</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {properties.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-mono text-sm font-bold text-sky-500 bg-sky-500/10 px-2 py-0.5 rounded">
                      {p.code}
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                      {p.name}
                    </h4>
                    <span className="text-xs text-slate-400">{p.location || 'Maldives'}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    {p.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <button type="button" className="text-button" disabled={pmsSavingProperty !== null} aria-label={`Edit property ${p.name}`} onClick={() => openPropertyForm(p)}><Edit2 size={15} /> Edit property</button>
                <button type="button" className="text-button text-red-600 dark:text-red-400" aria-label={`Delete property ${p.name}`} onClick={() => { setErrorMsg(null); setDeletePropertyCode(''); setDeletePropertyTarget(p); }}><Trash2 size={15} /> Delete property</button>
                <fieldset disabled={pmsSavingProperty !== null} className="space-y-2 text-sm">
                  <legend>PMS resorts for room lookups</legend>
                  <div className="flex flex-wrap gap-3">{pmsResortCodes.map(code => {
                    const selected = p.pmsPropertyCodes?.length ? p.pmsPropertyCodes : p.pmsPropertyCode ? [p.pmsPropertyCode] : [];
                    return <label key={code} className="flex items-center gap-1"><input type="checkbox" aria-label={`${code} for ${p.name}`} checked={selected.includes(code)} onChange={e => void updatePmsCode(p.id, e.target.checked ? [...selected, code] : selected.filter(value => value !== code))} />{code}</label>;
                  })}</div>
                  <p className="text-xs text-slate-500">Room lookups search every selected resort. With none selected, the centre code is used if supported.</p>
                </fieldset>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700/60 text-sm">
                  <div>
                    <span className="text-slate-400 block text-xs">Tax Rate:</span>
                    <span className="font-semibold">{p.taxRate}%</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-xs">Service Charge:</span>
                    <span className="font-semibold">{p.serviceChargeRate}%</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-xs">Next Check #:</span>
                    <span className="font-mono font-bold text-sky-500">#{p.nextCheckNumber}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: USER MANAGEMENT (Global Admin) */}
      {activeTab === 'users' && canManageAccounts && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                User Accounts & Access Control ({usersList.length})
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {isGlobalAdmin ? 'Manage account access and passwords.' : 'Create accounts and set temporary passwords for staff assigned exclusively to properties you manage.'}
              </p>
            </div>
            {canManageAccounts && <button
              onClick={() => openUserForm()}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm shadow-xs transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Create User</span>
            </button>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
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
                {usersList.length === 0 && <tr><td colSpan={10} className="py-12 text-center text-slate-500">{isGlobalAdmin ? 'No user accounts yet. Create an account to give your team access.' : 'No staff accounts yet. Create an account and assign it to your properties.'}</td></tr>}
                {usersList.map((u) => {
                  const isLocked = u.lockedUntil && new Date(u.lockedUntil) > new Date();

                  return (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-white">{u.name}</div>
                        <div className="text-xs text-slate-400">{u.username}{u.email ? ` · ${u.email}` : ''}</div><div className="text-xs text-slate-400">Authenticator: {u.authenticatorEnabled ? 'bound' : 'setup required'}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
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
                                className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800 text-xs font-medium"
                              >
                                {p.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {!u.isActive ? <span className="text-slate-500">Inactive</span> : isLocked ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 flex items-center space-x-1 w-max">
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
                        {isGlobalAdmin && <>
                          <button type="button" className="text-button" aria-label={`Edit user ${u.username}`} onClick={() => openUserForm(u)}><Edit2 size={14} /> Edit</button>
                          <button type="button" className="text-button text-red-600 dark:text-red-400" aria-label={`Delete user ${u.username}`} disabled={u.id === user?.id} title={u.id === user?.id ? 'You cannot delete your own administrator account.' : 'Delete user'} onClick={() => { setDeleteUserTarget(u); setDeleteUsername(''); setErrorMsg(null); }}><Trash2 size={14} /> Delete</button>
                        </>}
                        {/* Reset Password Button */}
                        <button
                          onClick={() => { setNewPassword(''); setConfirmPassword(''); setErrorMsg(null); setResetTargetUser(u); }}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-semibold transition inline-flex items-center space-x-1"
                          title="Set user password"
                        >
                          <KeyRound className="w-3 h-3 text-amber-500" />
                          <span>Set Password</span>
                        </button>

                        {/* Unlock Account Button */}
                        {isLocked && isGlobalAdmin && (
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
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Configure roles, hire/leaving dates, course pool, dive pool, and base-leader override (+10%).
              </p>
            </div>
            <button
              onClick={() => { setErrorMsg(null); setShowStaffModal(true); }}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm shadow-xs transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add Staff</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Name & Title</th>
                  <th className="py-3 px-4">Employment Window</th>
                  <th className="py-3 px-4">Login access</th>
                  <th className="py-3 px-4">Dive Staff?</th>
                  <th className="py-3 px-4">Course Pool</th>
                  <th className="py-3 px-4">Dive Pool</th>
                  <th className="py-3 px-4">BL Override (+10%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {staffList.length === 0 && <tr><td colSpan={10} className="py-12 text-center text-slate-500">No team members yet. Add dive staff to start recording attendance.</td></tr>}
                {staffList.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">{s.name}</div>
                      <div className="text-xs text-slate-400">{s.roleTitle}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                      Hired: {s.hireDate} {s.leavingDate ? `• Left: ${s.leavingDate}` : '• Active'}
                    </td>
                    <td className="py-3 px-4">{s.userId ? 'Login account created' : 'No linked login'}</td>
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
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
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
                Bill Activities for {activeProperty?.name} ({items.filter(item => item.isActive).length} active)
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Manage this property's activities, prices and promotional offers. Changes apply to new bills.
              </p>
            </div>
            <button
              onClick={() => openItemEditor()}
              disabled={!activeProperty || loading || itemBusy}
              className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm shadow-xs transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add activity</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <button type="button" className="secondary-button" disabled={!activeProperty || transferBusy} onClick={() => exportCatalogue('xlsx')}>Export Excel</button>
            <button type="button" className="secondary-button" disabled={!activeProperty || transferBusy} onClick={() => exportCatalogue('csv')}>Export CSV</button>
            <button type="button" className="text-button" disabled={!activeProperty || transferBusy} onClick={() => exportCatalogue('xlsx', true)}>Download import template</button>
            <label className="text-sm" htmlFor="catalogue-file">Import catalogue<input id="catalogue-file" type="file" accept=".csv,.xlsx" className="block mt-1" disabled={!activeProperty || transferBusy} onChange={e => { void previewCatalogue(e.target.files?.[0]); e.target.value = ''; }} /></label>
          </div>
          <p className="text-xs text-slate-500">Columns: Item Code, Items, Category, Price, Commission, Status. Existing codes update this property's items; new codes are preserved when creating items. Leave Item Code blank to generate a code automatically. Status: Active or Inactive. Commission accepts a pool amount (courses use the course pool; other categories use the dive pool), or the full settings object from an export. Up to 2,000 items / 3 MB. Imports are checked before saving.</p>
          {transferBusy && <p role="status">Processing catalogue…</p>}
          {catalogueImport?.propertyId === activeProperty?.id && catalogueImport && <div className="surface p-4 space-y-3">
            <h4 className="font-bold">Review catalogue import</h4>
            <p>{catalogueImport.created} new items, {catalogueImport.updated} updates. New categories will be added and new item codes generated on save.</p>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>Item Code</th><th>Items</th><th>Category</th><th>Price</th><th>Commission</th><th>Status</th></tr></thead><tbody>{catalogueImport.previewRows.map((row, index) => <tr key={index}><td>{row.code || 'Generated on save'}</td><td>{row.name}</td><td>{row.category}</td><td>{row.price}</td><td>{JSON.stringify(row.commission)}</td><td>{row.isActive ? 'Active' : 'Inactive'}</td></tr>)}</tbody></table></div>
            {catalogueImport.total > 20 && <p>Showing the first 20 of {catalogueImport.total} validated rows.</p>}
            <div className="flex gap-3"><button type="button" className="primary-button" disabled={transferBusy} onClick={commitCatalogue}>Import {catalogueImport.total} items</button><button type="button" className="secondary-button" disabled={transferBusy} onClick={() => setCatalogueImport(null)}>Cancel import</button></div>
          </div>}

          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={showArchivedItems} onChange={event => setShowArchivedItems(event.target.checked)} />Show deleted activities</label>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Code & Item</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Price</th>
                  <th className="py-3 px-4">Pool Contribution</th>
                  <th className="py-3 px-4">Personal Roles & Fixed Amounts</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {!items.some(item => showArchivedItems || item.isActive) && <tr><td colSpan={7} className="py-12 text-center text-slate-500">No active activities. Add activities and prices to start writing bills, or show deleted activities to restore them.</td></tr>}
                {items.filter(item => showArchivedItems || item.isActive).map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4">
                      <span className="font-mono text-sky-500 font-bold mr-2">[{it.code}]</span>
                      <span className="font-bold text-slate-900 dark:text-white">{it.name}</span>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">
                      {it.category?.name || 'General'}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                      {formatMoney(it.price, activeProperty?.currencySymbol || '$')}
                    </td>
                    <td className="py-3 px-4">
                      {it.poolType !== 'NONE' ? (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">
                          {it.poolType}: {formatMoney(it.poolContribution, activeProperty?.currencySymbol || '$')}
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
                          <span className="text-xs text-slate-400 font-mono block">
                            Rates: {it.personalRatesJson || 'N/A'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">{it.isActive ? 'Active' : 'Deleted'}</td>
                    <td className="py-3 px-4"><div className="flex gap-2">
                      <button type="button" className="secondary-button" disabled={itemBusy} onClick={() => openItemEditor(it)} aria-label={`Edit ${it.name}`}><Edit2 size={14} />Edit</button>
                      {it.isActive ? <button type="button" className="secondary-button" disabled={itemBusy} onClick={() => { setDeleteItemTarget(it); setErrorMsg(null); }} aria-label={`Delete ${it.name}`}><Trash2 size={14} />Delete</button> : <button type="button" className="secondary-button" disabled={itemBusy} onClick={() => handleRestoreItem(it)} aria-label={`Restore ${it.name}`}>Restore</button>}
                    </div></td>
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
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {isGlobalAdmin ? 'All properties and account activity, including sign-ins, sign-outs, changes, and API activity.' : 'Activity for this property.'} Times shown in Maldives time (UTC+05:00).
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Property</th>
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
                      {new Date(log.createdAt).toLocaleString('en-GB', { timeZone: 'Indian/Maldives', hour12: false })}
                    </td>
                    <td className="py-3 px-4">{log.property?.name || 'Account / System'}</td>
                    <td className="py-3 px-4">
                      <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200">
                      {log.user?.name || 'System / Guest'}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-400">
                      {log.ipAddress || '127.0.0.1'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300 font-mono text-xs max-w-md break-words">
                      {log.details || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && !auditLogs.length && <p>No audit activity recorded.</p>}
          <div className="flex gap-3">
            <button type="button" disabled={loading} onClick={() => loadAuditLogs()}>Refresh</button>
            {auditCursor && <button type="button" disabled={loading} onClick={() => loadAuditLogs(auditCursor)}>Load older entries</button>}
          </div>
        </div>
      )}

      {isGlobalAdmin && deletePropertyTarget && <Modal label={`Delete property ${deletePropertyTarget.name}`} onClose={closePropertyDelete} busy={propertyDeleting} error={errorMsg}>
        <form className="surface guard-dialog" onSubmit={handleDeleteProperty} aria-busy={propertyDeleting}>
          <h2>Delete {deletePropertyTarget.name}?</h2>
          <p id="delete-property-explanation">This removes the property from the workspace and revokes staff and manager access to it. Its bills, staff records, payroll and audit history will be retained.</p>
          <p>{deletePropertyTarget._count?.bills ?? 0} bills and {deletePropertyTarget._count?.staffMembers ?? 0} staff records will stay in history. User login accounts will remain.</p>
          <label htmlFor="delete-property-code">Type <strong>{deletePropertyTarget.code}</strong> to confirm.</label>
          <input id="delete-property-code" className="field-input" autoComplete="off" spellCheck={false} aria-describedby="delete-property-explanation" required value={deletePropertyCode} onChange={e => setDeletePropertyCode(e.target.value)} disabled={propertyDeleting} />
          <div className="dialog-actions"><button type="button" className="secondary-button" disabled={propertyDeleting} onClick={closePropertyDelete}>Cancel</button><button type="submit" className="danger-button" disabled={propertyDeleting || deletePropertyCode.trim().toUpperCase() !== deletePropertyTarget.code}>{propertyDeleting ? 'Deleting…' : 'Delete property'}</button></div>
        </form>
      </Modal>}

      {/* MODAL: CREATE / EDIT PROPERTY */}
      {isGlobalAdmin && showPropertyModal && (
        <Modal label={editingProperty ? `Edit property ${editingProperty.name}` : 'Create property'} busy={propertySaving} onClose={() => { if (!propertySaving) { setShowPropertyModal(false); setErrorMsg(null); } } } error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {editingProperty ? 'Edit Dive Centre Property' : 'Create Dive Centre Property'}
            </h3>
            <form onSubmit={handleSaveProperty} className="space-y-3 text-sm" aria-busy={propertySaving}>
              <fieldset disabled={propertySaving} className="space-y-3">
                <div>
                  <label htmlFor="adminview-field-1" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Property Name *
                  </label>
                  <input id="adminview-field-1"
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
                    <label htmlFor="adminview-field-2" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Property Code {editingProperty ? '*' : '(optional)'}
                    </label>
                    <input id="adminview-field-2"
                      type="text"
                      required={Boolean(editingProperty)}
                      minLength={2}
                      maxLength={10}
                      value={propForm.code}
                      onChange={(e) => setPropForm({ ...propForm, code: e.target.value.toUpperCase() })}
                      placeholder="SUN-BAA"
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono focus:outline-none"
                    />
                    <p className="text-xs text-slate-400 mt-1">{editingProperty ? 'Enter 2–10 characters. The code must be unique.' : 'Leave blank to generate from the name, or enter 2–10 characters.'}</p>
                  </div>
                  <div>
                    <label htmlFor="adminview-field-3" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Location (optional)
                    </label>
                    <input id="adminview-field-3"
                      type="text"
                      value={propForm.location}
                      onChange={(e) => setPropForm({ ...propForm, location: e.target.value })}
                      placeholder="e.g. Baa Atoll"
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label>Currency<input className="field-input" required value={propForm.currency} onChange={e => setPropForm({ ...propForm, currency: e.target.value })} /></label>
                  <label>Currency symbol<input className="field-input" required value={propForm.currencySymbol} onChange={e => setPropForm({ ...propForm, currencySymbol: e.target.value })} /></label>
                </div>
                {editingProperty && <label className="flex items-center gap-2"><input type="checkbox" checked={propForm.isActive} onChange={e => setPropForm({ ...propForm, isActive: e.target.checked })} /> Active property</label>}
                <fieldset className="space-y-2"><legend>PMS resorts (optional)</legend><div className="flex flex-wrap gap-3">{pmsResortCodes.map(code => <label key={code} className="flex items-center gap-1"><input type="checkbox" checked={propForm.pmsPropertyCodes.includes(code)} onChange={e => setPropForm({ ...propForm, pmsPropertyCodes: e.target.checked ? [...propForm.pmsPropertyCodes, code] : propForm.pmsPropertyCodes.filter(value => value !== code) })} />{code}</label>)}</div></fieldset>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="adminview-field-4" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Tax (%)
                    </label>
                    <input id="adminview-field-4"
                      type="number"
                      step="0.1"
                      required min="0" max="100"
                      value={propForm.taxRate}
                      onChange={(e) => setPropForm({ ...propForm, taxRate: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="adminview-field-5" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      SC (%)
                    </label>
                    <input id="adminview-field-5"
                      type="number"
                      step="0.1"
                      required min="0" max="100"
                      value={propForm.serviceChargeRate}
                      onChange={(e) => setPropForm({ ...propForm, serviceChargeRate: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="adminview-field-6" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      {editingProperty ? 'Next Check #' : 'Start Check #'}
                    </label>
                    <input id="adminview-field-6"
                      type="number"
                      required min="1" step="1"
                      value={propForm.nextCheckNumber}
                      onChange={(e) => setPropForm({ ...propForm, nextCheckNumber: parseInt(e.target.value, 10) || 1001 })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                    />
                  </div>
                </div>

              </fieldset>
              <div className="flex space-x-2 pt-3">
                <button
                  type="button"
                  disabled={propertySaving}
                  onClick={() => setShowPropertyModal(false)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={propertySaving}
                  className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold transition"
                >
                  {propertySaving ? 'Saving…' : editingProperty ? 'Save Changes' : 'Save Property'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {isGlobalAdmin && deleteUserTarget && <Modal label={`Delete user ${deleteUserTarget.username}`} busy={userDeleting} onClose={closeUserDelete} error={errorMsg}>
        <form className="surface guard-dialog" onSubmit={handleDeleteUser} aria-busy={userDeleting}>
          <h2>Delete {deleteUserTarget.name}?</h2>
          <p>This revokes sign-in access and removes this account from the user list. Bills, staff roster records, payroll and audit history are retained. The username remains reserved.</p>
          <label htmlFor="delete-user-username">Type <strong>{deleteUserTarget.username}</strong> to confirm.</label>
          <input id="delete-user-username" className="field-input" autoComplete="off" spellCheck={false} required disabled={userDeleting} value={deleteUsername} onChange={e => setDeleteUsername(e.target.value)} />
          <div className="dialog-actions"><button type="button" className="secondary-button" disabled={userDeleting} onClick={closeUserDelete}>Cancel</button><button type="submit" className="danger-button" disabled={userDeleting || deleteUsername.trim().toLowerCase() !== deleteUserTarget.username}>{userDeleting ? 'Deleting…' : 'Delete user'}</button></div>
        </form>
      </Modal>}

      {/* MODAL: CREATE / EDIT USER */}
      {showUserModal && (
        <Modal label={editingUser ? `Edit user ${editingUser.username}` : 'Create account'} busy={userSaving} onClose={() => { if (!userSaving) { setShowUserModal(false); setErrorMsg(null); } } } error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {editingUser ? 'Edit User Account' : 'Create New User Account'}
            </h3>
            {!editingUser && <p className="text-sm text-slate-500">{passwordHelp} Share the username and temporary password directly with the user. They must change their password and bind their own authenticator before using the workspace.</p>}
            <form onSubmit={handleSaveUser} className="space-y-3 text-sm" aria-busy={userSaving}>
              <fieldset disabled={userSaving} className="space-y-3">
                <div>
                  <label htmlFor="adminview-field-7" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Full Name *
                  </label>
                  <input id="adminview-field-7"
                    type="text"
                    required
                    value={userForm.name}
                    onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                    placeholder="e.g. Hassan Rauf"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="account-username" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">Unique Username *</label>
                  <input id="account-username" autoComplete="off" required minLength={3} maxLength={100} pattern="[A-Za-z0-9._@+\-]+" value={userForm.username} onChange={e => setUserForm({ ...userForm, username: e.target.value })} placeholder="e.g. hassan.male" className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700" />
                  <p className="text-xs text-slate-500 mt-1">Every person needs their own username and authenticator, even when sharing an email address.</p>
                </div>
                <div>
                  <label htmlFor="adminview-field-8" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Email Address (optional; shared addresses allowed)
                  </label>
                  <input id="adminview-field-8"
                    type="email"
                    value={userForm.email}
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    placeholder="hassan@sundiving.com"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>

                {!editingUser && <div>
                  <label htmlFor="adminview-field-9" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Temporary Password *
                  </label>
                  <input id="adminview-field-9"
                    type="password"
                    required
                    minLength={12} pattern={passwordPattern} title={passwordHelp}
                    value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                    placeholder="12 characters, Aa, number, symbol"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>}

                <div>
                  <label htmlFor="adminview-field-10" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Role *
                  </label>
                  <select id="adminview-field-10"
                    disabled={editingUser?.id === user?.id}
                    value={userForm.role}
                    onChange={(e) => setUserForm({ ...userForm, role: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  >
                    <option value="CENTRE_STAFF">Centre Staff (Fixed to assigned centre)</option>
                    {isGlobalAdmin && <option value="PROPERTY_MANAGER">Property Manager (Multiple assigned centres)</option>}
                    {isGlobalAdmin && <option value="GLOBAL_ADMIN">Global Admin (Unrestricted system-wide)</option>}
                  </select>
                </div>

                {editingUser && <label className="flex items-center gap-2"><input type="checkbox" disabled={editingUser.id === user?.id} checked={userForm.isActive} onChange={e => setUserForm({ ...userForm, isActive: e.target.checked })} /> Active account</label>}
                {editingUser?.id === user?.id && <p className="text-xs text-slate-500">Your administrator role and active status are protected while you are signed in.</p>}
                {userForm.role !== 'GLOBAL_ADMIN' && (
                  <div>
                    <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Assign Properties:
                    </label>
                    <div className="space-y-1 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 max-h-36 overflow-y-auto">
                      {properties.filter(p => (p.isActive || editingUser?.assignedProperties.some(assigned => assigned.id === p.id)) && (isGlobalAdmin || user?.assignedProperties.some(assigned => assigned.id === p.id))).map((p) => {
                        const isChecked = userForm.propertyIds.includes(p.id);
                        return (
                          <label key={p.id} className="flex items-center space-x-2 cursor-pointer text-sm">
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
                            <span>{p.name} ({p.code}){!p.isActive ? ' · Inactive' : ''}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

              </fieldset>
              <div className="flex space-x-2 pt-3">
                <button
                  type="button"
                  disabled={userSaving}
                  onClick={() => setShowUserModal(false)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={userSaving}
                  className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold transition"
                >
                  {userSaving ? 'Saving…' : editingUser ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* MODAL: RESET PASSWORD */}
      {resetTargetUser && (
        <Modal label="Reset password" onClose={closePasswordReset} busy={resetBusy} error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <KeyRound className="w-5 h-5 text-amber-500" />
              <span>Set Password for {resetTargetUser.name}</span>
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Set a temporary password and share it directly with the user. They must change it at next sign-in. This also clears the sign-in lock.
            </p>

            <p className="text-sm text-slate-500">{passwordHelp}</p>
            <form onSubmit={handleResetPassword} className="space-y-3 text-sm">
              <label className="flex items-start gap-2"><input type="checkbox" checked={resetAuthenticator} disabled={resetBusy} onChange={e => setResetAuthenticator(e.target.checked)} /><span>User lost their authenticator and recovery codes. Clear their binding so they can bind a new authenticator after changing this temporary password.</span></label>
              <div>
                <label htmlFor="reset-new-password" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  New Password:
                </label>
                <input
                  type="password"
                  required
                  minLength={12} pattern={passwordPattern} title={passwordHelp}
                  id="reset-new-password"
                  autoComplete="new-password"
                  disabled={resetBusy}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="reset-confirm-password" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">Confirm password:</label>
                <input id="reset-confirm-password" type="password" autoComplete="new-password" required minLength={12} pattern={passwordPattern} title={passwordHelp} disabled={resetBusy}
                  value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700" />
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  disabled={resetBusy}
                  onClick={closePasswordReset}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetBusy}
                  className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold transition"
                >
                  {resetBusy ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* MODAL: ADD STAFF */}
      {showStaffModal && (
        <Modal label="Add team member" busy={staffBusy} onClose={() => { if (!staffBusy) { setShowStaffModal(false); setStaffLogin({ username: '', password: '' }); setGiveStaffLogin(false); setErrorMsg(null); } } } error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Add Staff Member to {activeProperty?.name}
            </h3>
            <form onSubmit={handleCreateStaff} className="space-y-3 text-sm"><fieldset disabled={staffBusy} className="space-y-3">
              <div>
                <label htmlFor="adminview-field-11" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Full Name *
                </label>
                <input id="adminview-field-11"
                  type="text"
                  required
                  value={staffForm.name}
                  onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                  placeholder="e.g. Elena Petrova"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="adminview-field-12" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Role Title *
                </label>
                <select id="adminview-field-12"
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
                  <label htmlFor="adminview-field-13" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Hire Date *
                  </label>
                  <input id="adminview-field-13"
                    type="date"
                    required
                    value={staffForm.hireDate}
                    onChange={(e) => setStaffForm({ ...staffForm, hireDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="adminview-field-14" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Leaving Date (optional)
                  </label>
                  <input id="adminview-field-14"
                    type="date"
                    value={staffForm.leavingDate}
                    onChange={(e) => setStaffForm({ ...staffForm, leavingDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  />
                </div>
              </div>

              <fieldset className="space-y-3 border-t border-slate-200 pt-3">
                <legend>Workspace access</legend>
                <label className="flex items-center gap-2"><input type="checkbox" checked={giveStaffLogin} onChange={e => setGiveStaffLogin(e.target.checked)} />Give this staff member login access</label>
                {giveStaffLogin && <>
                  <label className="block" htmlFor="staff-login-username">Unique username<input id="staff-login-username" className="w-full border rounded p-2 mt-1" required minLength={3} maxLength={100} pattern="[A-Za-z0-9._@+\-]+" autoComplete="off" value={staffLogin.username} onChange={e => setStaffLogin({ ...staffLogin, username: e.target.value })} /></label>
                  <label className="block" htmlFor="staff-login-password">Temporary password<input id="staff-login-password" className="w-full border rounded p-2 mt-1" type="password" autoComplete="new-password" required minLength={12} pattern={passwordPattern} title={passwordHelp} value={staffLogin.password} onChange={e => setStaffLogin({ ...staffLogin, password: e.target.value })} /></label>
                  <p className="text-xs text-slate-500">{passwordHelp} This grants centre staff access to {activeProperty?.name}. They must change the temporary password and set up their own authenticator.</p>
                </>}
              </fieldset>

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
                  onClick={() => { setShowStaffModal(false); setStaffLogin({ username: '', password: '' }); setGiveStaffLogin(false); }}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold transition"
                >
                  {staffBusy ? 'Adding…' : 'Add Staff Member'}
                </button>
              </div>
              </fieldset>
            </form>
          </div>
        </Modal>
      )}

      {deleteItemTarget && <Modal label="Delete activity" busy={itemBusy} onClose={() => { if (!itemBusy) { setDeleteItemTarget(null); setErrorMsg(null); } }} error={errorMsg}>
        <div className="p-6 space-y-4"><h3 className="text-lg font-bold">Delete {deleteItemTarget.name}?</h3><p>This removes the activity from new bills for {activeProperty?.name}. Existing bills and history are retained. You can restore it from the deleted activities list.</p><div className="flex gap-2"><button className="secondary-button" disabled={itemBusy} onClick={() => { setDeleteItemTarget(null); setErrorMsg(null); }}>Cancel</button><button className="primary-button" disabled={itemBusy} onClick={handleDeleteItem}>{itemBusy ? 'Deleting…' : 'Delete activity'}</button></div></div>
      </Modal>}

      {/* MODAL: ADD / EDIT CATALOGUE ACTIVITY */}
      {showItemModal && (
        <Modal label={editingItem ? 'Edit activity' : 'Add activity'} busy={itemBusy || categoryBusy} onClose={closeItemEditor} error={errorMsg}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {editingItem ? 'Edit activity' : 'Add activity'} · {activeProperty?.name}
            </h3>
            <p className="text-sm text-slate-500">Create a separate activity for a promotional offer. Its code is generated automatically; delete the activity when the offer ends.</p>
            <form onSubmit={handleSaveItem} className="space-y-3 text-sm">
              <fieldset disabled={itemBusy} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="activity-code" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Item Code (system generated)
                  </label>
                  <input
                    id="activity-code"
                    type="text"
                    readOnly
                    value={editingItem ? itemForm.code : ''}
                    placeholder="Assigned on save, e.g. DIV-001"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="adminview-field-15" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Category *
                  </label>
                  <select id="adminview-field-15"
                    value={itemForm.categoryId}
                    required
                    disabled={categoryBusy}
                    onChange={(e) => setItemForm({ ...itemForm, categoryId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                  >
                    {!categories.length && <option value="">Add a category first</option>}
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="text-button mt-2" onClick={() => setShowCategoryInput(value => !value)}>Add a category</button>
                  {(showCategoryInput || !categories.length) && <div className="category-create"><label htmlFor="new-category-name">New category name</label><input id="new-category-name" maxLength={80} value={newCategoryName} disabled={categoryBusy} placeholder="e.g. Dives" onChange={event => setNewCategoryName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); handleCreateCategory(); } }} /><button type="button" className="secondary-button" disabled={categoryBusy || !newCategoryName.trim()} onClick={handleCreateCategory}>{categoryBusy ? 'Creating…' : 'Create category'}</button></div>}

                </div>
              </div>

              <div>
                <label htmlFor="adminview-field-16" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Item Name *
                </label>
                <input id="adminview-field-16"
                  type="text"
                  required
                  minLength={2}
                  maxLength={200}
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  placeholder="e.g. Wreck Dive Special"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="adminview-field-17" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Price ({activeProperty?.currencySymbol || '$'}) *
                  </label>
                  <input id="adminview-field-17"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={itemForm.price}
                    onChange={(e) => setItemForm({ ...itemForm, price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="adminview-field-18" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Pool Type
                  </label>
                  <select id="adminview-field-18"
                    disabled={editingItem?.hasBillHistory}
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

              <div><label htmlFor="activity-pool-contribution" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">Pool contribution ({activeProperty?.currencySymbol || '$'})</label><input id="activity-pool-contribution" type="number" min="0" step="0.01" required disabled={editingItem?.hasBillHistory} value={itemForm.poolContribution} onChange={event => setItemForm({ ...itemForm, poolContribution: Number(event.target.value) })} className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700" />{editingItem?.hasBillHistory && <p className="text-xs text-slate-500 mt-1">Pool rules are fixed for activities used on saved bills. Create a new activity to use different rules.</p>}</div>

              <div>
                <label htmlFor="adminview-field-19" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Personal Commission Roles (comma-separated, e.g. seller,guide)
                </label>
                <input id="adminview-field-19"
                  type="text"
                  value={itemForm.personalRoles}
                  onChange={(e) => setItemForm({ ...itemForm, personalRoles: e.target.value })}
                  placeholder="seller,guide,instructor,photo,video"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="adminview-field-20" className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Personal Commission Rates JSON (e.g. {`{"seller": 10, "guide": 15}`})
                </label>
                <input id="adminview-field-20"
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
                  onClick={closeItemEditor}
                  disabled={itemBusy || categoryBusy}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!itemForm.categoryId || categoryBusy || itemBusy}
                  className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold transition"
                >
                  {itemBusy ? 'Saving…' : editingItem ? 'Save changes' : 'Add activity'}
                </button>
              </div>
              </fieldset>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
};
