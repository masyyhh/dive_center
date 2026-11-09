import { AdminSection, resolveAdminSection } from '../../utils/adminSections';
import { useNavigation, useUnsavedChanges } from '../../context/NavigationContext';
import { CommissionSelection, hasNoCommissions, readCommissionSelections, serializeCommissionSelections } from '../../utils/commissionEditor';
import { BulkMediaReviewData } from '../BulkMediaReview';
import { CatalogueFilters, emptyCatalogueFilters, filterCatalogue, canPermanentlyDeleteItem } from '../../utils/catalogueFilters';
import { CatalogueImportPreview } from '../CatalogueImportReview';
import { passwordHelp, passwordPattern } from '../PasswordRecoveryView';
import { formatMoney, formatUnitPrice } from '../../utils/format';
import { businessToday } from '../../utils/dates';
import React, { useState, useEffect } from 'react';
import { useProperty } from '../../context/PropertyContext';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, downloadFile } from '../../services/api';
import { Property, User, StaffMember, Item, Category, AuditLog } from '../../types';

export interface AdminViewProps {
  section?: string;
  onSectionChange: (section: string) => void;
}

export function useAdminController({ section, onSectionChange }: AdminViewProps) {
  const { user, refreshUser } = useAuth();
  const { activeProperty, properties, refreshProperties, setActiveProperty } = useProperty();

  const isGlobalAdmin = user?.role === 'GLOBAL_ADMIN';
  const canManageAccounts = isGlobalAdmin || user?.role === 'PROPERTY_MANAGER';

  const { requestNavigation } = useNavigation();
  const photoSettings = { autoPhotoPrice: activeProperty?.autoPhotoPrice ?? 41.975, autoPhotoCommission: activeProperty?.autoPhotoCommission ?? 4.5 };
  const photoPriceLabel = formatUnitPrice(photoSettings.autoPhotoPrice, activeProperty?.currencySymbol || '$');
  const photoCommissionLabel = formatMoney(photoSettings.autoPhotoCommission, activeProperty?.currencySymbol || '$');
  type AdminTab = AdminSection;
  const [activeTab, setActiveTab] = useState<AdminTab>(() => resolveAdminSection(section, user?.role));
  useEffect(() => { setActiveTab(resolveAdminSection(section, user?.role)); }, [section, user?.role]);
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
    autoPhotoPrice: 41.975,
    autoPhotoCommission: 4.5,
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
  const [roleTitles, setRoleTitles] = useState<string[]>([]);
  const [newRoleTitle, setNewRoleTitle] = useState('');
  const [roleTitleBusy, setRoleTitleBusy] = useState(false);
  const [roleTitlesLoading, setRoleTitlesLoading] = useState(false);
  const roleTitleProperty = React.useRef(activeProperty?.id);
  roleTitleProperty.current = activeProperty?.id;
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [showStaffModal, setShowStaffModal] = useState<boolean>(false);
  const [staffForm, setStaffForm] = useState({
    name: '',
    email: '',
    erNumber: '',
    isActive: true,
    roleTitle: 'Instructor',
    isDiveStaff: true,
    isCoursePoolSharing: true,
    isDivePoolSharing: true,
    isBaseLeaderOverride: false,
    hireDate: businessToday(),
    leavingDate: '',
  });

  const [transferBusy, setTransferBusy] = useState(false);
  const [catalogueImport, setCatalogueImport] = useState<(CatalogueImportPreview & { propertyId: string; content: string; format: 'csv' | 'xlsx'; fileName: string }) | null>(null);
  // Items & Categories state
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const itemLoadGeneration = React.useRef(0);
  const [catalogueFilters, setCatalogueFilters] = useState<CatalogueFilters>(emptyCatalogueFilters);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState<{ propertyId: string; items: Item[]; permanent?: boolean } | null>(null);
  const deleteItemNoun = bulkDeleteTarget?.items.length === 1 ? 'activity' : 'activities';
  const [permanentDeleteConfirmation, setPermanentDeleteConfirmation] = useState('');
  useEffect(() => { setPermanentDeleteConfirmation(''); }, [bulkDeleteTarget]);
  const [bulkReview, setBulkReview] = useState<BulkMediaReviewData | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [showArchivedItems, setShowArchivedItems] = useState(false);
  const viewItems = items.filter(item => item.isActive !== showArchivedItems);
  const visibleItems = filterCatalogue(viewItems, catalogueFilters, true);
  const selectableItems = visibleItems;
  const eligibleVisibleItems = visibleItems.filter(canPermanentlyDeleteItem);
  const selectedItems = items.filter(item => selectedItemIds.includes(item.id));
  const selectedAreActive = selectedItems.length > 0 && selectedItems.every(item => item.isActive);
  const canPermanentlyDeleteSelected = selectedItems.length > 0 && selectedItems.every(canPermanentlyDeleteItem);
  const selectedVisibleCount = selectableItems.filter(item => selectedItemIds.includes(item.id)).length;
  useEffect(() => { setCatalogueFilters(emptyCatalogueFilters); setSelectedItemIds([]); setBulkReview(null); setBulkError(null); setCatalogueImport(null); setBulkDeleteTarget(null); }, [activeProperty?.id]);
  useEffect(() => { setSelectedItemIds(ids => ids.filter(id => items.some(item => item.id === id && (item.isActive !== showArchivedItems)))); }, [items, showArchivedItems]);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<Item | null>(null);
  const [itemBusy, setItemBusy] = useState(false);
  const [showItemModal, setShowItemModal] = useState<boolean>(false);
  useUnsavedChanges(showItemModal, 'An activity has unfinished catalogue or commission changes.', itemBusy || categoryBusy);
  useEffect(() => {
    ++itemLoadGeneration.current;
    setItems([]); setCategories([]); setStaffList([]); setShowStaffModal(false); setEditingStaff(null); setShowItemModal(false); setEditingItem(null); setDeleteItemTarget(null);
  }, [activeProperty?.id]);
  const [noCommissions, setNoCommissions] = useState(false);
  const previousCommissionSettings = React.useRef<{ poolType: Item['poolType']; poolContribution: number; includesComplimentaryMedia: boolean; selections: CommissionSelection[] } | null>(null);
  const [commissionSelections, setCommissionSelections] = useState(() => readCommissionSelections('seller,guide', '{"seller":5,"guide":10}'));
  const [itemForm, setItemForm] = useState({
    categoryId: '',
    code: '',
    name: '',
    price: 85.0,
    poolType: 'DIVE_POOL' as Item['poolType'],
    poolContribution: 10.0,
    personalRoles: 'seller,guide',
    personalRatesJson: '{"seller": 5, "guide": 10}',
    includesComplimentaryMedia: false,
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

  useEffect(() => {
    let cancelled = false;
    setRoleTitles([]);
    setNewRoleTitle('');
    setShowStaffModal(false);
    setStaffForm(form => ({ ...form, roleTitle: 'Instructor', isBaseLeaderOverride: false, isCoursePoolSharing: true }));
    if (!activeProperty) return;
    setRoleTitlesLoading(true);
    apiFetch<{ roleTitles: string[] }>(`/staff/role-titles?propertyId=${encodeURIComponent(activeProperty.id)}`)
      .then(result => { if (!cancelled) setRoleTitles(result.roleTitles); })
      .catch(error => { if (!cancelled) setErrorMsg(error instanceof Error ? error.message : 'Could not load role titles.'); })
      .finally(() => { if (!cancelled) setRoleTitlesLoading(false); });
    return () => { cancelled = true; };
  }, [activeProperty?.id]);

  const handleCreateRoleTitle = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeProperty || !canManageAccounts || roleTitleBusy || !newRoleTitle.trim()) return;
    const propertyId = activeProperty.id;
    setRoleTitleBusy(true); setErrorMsg(null);
    try {
      const result = await apiFetch<{ roleTitle: string }>('/staff/role-titles', {
        method: 'POST', body: JSON.stringify({ propertyId, name: newRoleTitle }),
      });
      if (roleTitleProperty.current !== propertyId) return;
      setRoleTitles(titles => [...titles, result.roleTitle]);
      setStaffForm(form => ({ ...form, roleTitle: result.roleTitle, isBaseLeaderOverride: false, isCoursePoolSharing: false }));
      setNewRoleTitle('');
      showNotification(`Role title '${result.roleTitle}' added. You can now select it when adding staff.`);
    } catch (error) {
      if (roleTitleProperty.current === propertyId) setErrorMsg(error instanceof Error ? error.message : 'Could not add role title.');
    } finally { setRoleTitleBusy(false); }
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
    const propertyId = activeProperty.id;
    try {
      setLoading(true);
      const res = await apiFetch<{ staff: StaffMember[] }>(
        `/staff?propertyId=${propertyId}&includeInactive=true`
      );
      if (roleTitleProperty.current === propertyId) setStaffList(res.staff);
    } catch (err) {
      if (roleTitleProperty.current === propertyId) setErrorMsg(err instanceof Error ? err.message : 'Could not load this section. Please try again.');
    } finally {
      if (roleTitleProperty.current === propertyId) setLoading(false);
    }
  };

  // Fetch Items & Categories
  const loadItems = async () => {
    const generation = ++itemLoadGeneration.current;
    if (!activeProperty) { setItems([]); setCategories([]); return; }
    const propertyId = activeProperty.id;
    try {
      setLoading(true);
      const res = await apiFetch<{ categories: Category[]; items: Item[] }>(
        `/items?propertyId=${propertyId}&includeInactive=true`
      );
      if (generation !== itemLoadGeneration.current || roleTitleProperty.current !== propertyId) return;
      setCategories(res.categories);
      setItems(res.items);
      if (res.categories.length > 0 && !itemForm.categoryId) {
        setItemForm((prev) => ({ ...prev, categoryId: res.categories[0].id }));
      }
    } catch (err) {
      if (generation === itemLoadGeneration.current && roleTitleProperty.current === propertyId) setErrorMsg(err instanceof Error ? err.message : 'Could not load this section. Please try again.');
    } finally {
      if (generation === itemLoadGeneration.current && roleTitleProperty.current === propertyId) setLoading(false);
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
    if (activeTab === 'items' || activeTab === 'commissions') loadItems();
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
      nextCheckNumber: property.nextCheckNumber,
      autoPhotoPrice: property.autoPhotoPrice ?? 41.975,
      autoPhotoCommission: property.autoPhotoCommission ?? 4.5,
      isActive: property.isActive,
    } : { name: '', code: '', pmsPropertyCodes: [], location: '', currency: 'USD', currencySymbol: '$', taxRate: 16, serviceChargeRate: 10, nextCheckNumber: 1001, autoPhotoPrice: 41.975, autoPhotoCommission: 4.5, isActive: true });
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
      setPropForm({ name: '', code: '', pmsPropertyCodes: [], location: '', currency: 'USD', currencySymbol: '$', taxRate: 16, serviceChargeRate: 10, nextCheckNumber: 1001, autoPhotoPrice: 41.975, autoPhotoCommission: 4.5, isActive: true });
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

  const openStaffEditor = (staff?: StaffMember) => {
    if (!canManageAccounts || !activeProperty || staffBusy || (staff && staff.propertyId !== activeProperty.id)) return;
    setEditingStaff(staff || null); setErrorMsg(null); setGiveStaffLogin(false); setStaffLogin({ username: '', password: '' });
    setStaffForm(staff ? { name: staff.name, email: staff.email || '', erNumber: staff.erNumber || '', roleTitle: staff.roleTitle, isActive: staff.isActive,
      isDiveStaff: staff.isDiveStaff, isCoursePoolSharing: staff.isCoursePoolSharing, isDivePoolSharing: staff.isDivePoolSharing,
      isBaseLeaderOverride: staff.isBaseLeaderOverride, hireDate: staff.hireDate, leavingDate: staff.leavingDate || '' }
      : { name: '', email: '', erNumber: '', roleTitle: 'Instructor', isActive: true, isDiveStaff: true, isCoursePoolSharing: true,
        isDivePoolSharing: true, isBaseLeaderOverride: false, hireDate: businessToday(), leavingDate: '' });
    setShowStaffModal(true);
  };
  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProperty || !canManageAccounts || staffBusy || (editingStaff && editingStaff.propertyId !== activeProperty.id)) return;
    if (staffForm.leavingDate && staffForm.leavingDate < staffForm.hireDate) { setErrorMsg('Leaving date cannot be before the hire date.'); return; }
    const propertyId = activeProperty.id;
    setStaffBusy(true); setErrorMsg(null);
    try {
      const { isActive, ...fields } = staffForm;
      await apiFetch(editingStaff ? `/staff/${editingStaff.id}` : '/staff', {
        method: editingStaff ? 'PUT' : 'POST',
        body: JSON.stringify({ ...fields, leavingDate: staffForm.leavingDate || null,
          ...(editingStaff ? { isActive } : { propertyId, ...(giveStaffLogin ? { loginAccess: staffLogin } : {}) }) }),
      });
      if (roleTitleProperty.current !== propertyId) return;
      setShowStaffModal(false); setEditingStaff(null);
      setStaffLogin({ username: '', password: '' }); setGiveStaffLogin(false);
      if (giveStaffLogin) void loadUsers();
      showNotification(`Staff member '${staffForm.name}' ${editingStaff ? 'updated' : 'added'}.`);
      void loadStaff();
    } catch (err: any) {
      if (roleTitleProperty.current === propertyId) setErrorMsg(err.message || 'Failed to save staff member.');
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
    try { await downloadFile(`/items/export?propertyId=${encodeURIComponent(activeProperty.id)}&format=${format}&template=${template}`, `catalogue-${activeProperty.code.toLowerCase()}-${businessToday()}${template ? '-template' : ''}.${format}`); }
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
      const result = await apiFetch<CatalogueImportPreview>('/items/import', { method: 'POST', body: JSON.stringify({ propertyId, content, format, preview: true }) });
      if (roleTitleProperty.current === propertyId) setCatalogueImport({ propertyId, content, format, fileName: file.name, ...result });
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
    if (!activeProperty || (item && item.propertyId !== activeProperty.id)) return;
    setNoCommissions(item ? hasNoCommissions(item) : false);
    previousCommissionSettings.current = null;
    setCommissionSelections(readCommissionSelections(item ? item.personalRoles : 'seller,guide', item ? item.personalRatesJson : '{"seller":5,"guide":10}'));
    setEditingItem(item || null); setErrorMsg(null); setShowCategoryInput(false); setNewCategoryName('');
    setItemForm(item ? {
      categoryId: item.categoryId, code: item.code, name: item.name, price: item.price,
      poolType: item.poolType, poolContribution: item.poolContribution,
      personalRoles: item.personalRoles || '', personalRatesJson: item.personalRatesJson || '', includesComplimentaryMedia: item.includesComplimentaryMedia,
    } : { categoryId: categories[0]?.id || '', code: '', name: '', price: 85, poolType: /^certifications?$/i.test(categories[0]?.name || '') ? 'CERTIFICATION_POOL' : 'DIVE_POOL', poolContribution: 10, personalRoles: 'seller,guide', personalRatesJson: '{"seller": 5, "guide": 10}', includesComplimentaryMedia: false });
    setShowItemModal(true);
  };
  const copyItemRules = (item: Item) => {
    openItemEditor(item);
    setEditingItem(null);
    setItemForm(form => ({ ...form, code: '', name: `${item.name} (new rules)` }));
  };
  const closeItemEditor = () => { if (!itemBusy && !categoryBusy) { setShowItemModal(false); setEditingItem(null); setErrorMsg(null); } };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProperty || itemBusy || categoryBusy) return;
    setItemBusy(true); setErrorMsg(null);
    try {
      const payments = noCommissions ? { personalRoles: '', personalRatesJson: '{}' } : serializeCommissionSelections(commissionSelections, itemForm.includesComplimentaryMedia);
      const activity = { ...itemForm, ...payments, ...(noCommissions ? { poolType: 'NONE', poolContribution: 0, includesComplimentaryMedia: false } : {}) };
      await apiFetch(editingItem ? `/items/${editingItem.id}` : '/items', {
        method: editingItem ? 'PUT' : 'POST',
        body: JSON.stringify(editingItem ? activity : { ...activity, code: itemForm.code.trim() || undefined, propertyId: activeProperty.id }),
      });
      setShowItemModal(false); setEditingItem(null);
      showNotification(`Activity '${itemForm.name}' ${editingItem ? 'updated' : 'added'} for ${activeProperty.name}.`);
      await loadItems();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save activity.');
    } finally { setItemBusy(false); }
  };

  const toggleComplimentaryMedia = async (item: Item, enabled: boolean) => {
    if (!activeProperty || !canManageAccounts || itemBusy) return;
    const propertyId = activeProperty.id;
    setItemBusy(true); setErrorMsg(null);
    try {
      await apiFetch(`/items/${item.id}`, { method: 'PUT', body: JSON.stringify({ includesComplimentaryMedia: enabled }) });
      if (roleTitleProperty.current !== propertyId) return;
      showNotification(`Automatic Photo ${enabled ? 'enabled' : 'disabled'} for '${item.name}' on new bills.`);
      await loadItems();
    } catch (error) {
      if (roleTitleProperty.current === propertyId) setErrorMsg(error instanceof Error ? error.message : 'Could not update automatic Photo.');
    } finally { setItemBusy(false); }
  };

  const reviewBulkMedia = async (enabled: boolean, ids = selectedItemIds) => {
    if (!activeProperty || !ids.length || bulkBusy || itemBusy) return;
    const propertyId = activeProperty.id;
    setBulkBusy(true); setBulkError(null); setErrorMsg(null);
    try {
      const review = await apiFetch<Omit<BulkMediaReviewData, 'propertyId'>>('/items/bulk-complimentary-media', {
        method: 'POST', body: JSON.stringify({ propertyId, itemIds: ids, includesComplimentaryMedia: enabled, preview: true }),
      });
      if (roleTitleProperty.current === propertyId) setBulkReview({ ...review, propertyId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not review the selected services.';
      if (roleTitleProperty.current === propertyId) { if (bulkReview) setBulkError(message); else setErrorMsg(message); }
    } finally { setBulkBusy(false); }
  };

  const applyBulkMedia = async () => {
    if (!bulkReview || bulkBusy || bulkReview.propertyId !== activeProperty?.id) return;
    const propertyId = bulkReview.propertyId;
    setBulkBusy(true); setBulkError(null);
    try {
      const result = await apiFetch<{ changedCount: number }>('/items/bulk-complimentary-media', {
        method: 'POST', body: JSON.stringify({ propertyId, itemIds: bulkReview.items.map(item => item.id), includesComplimentaryMedia: bulkReview.includesComplimentaryMedia, preview: false,
          expectedItems: bulkReview.items.map(item => ({ id: item.id, updatedAt: item.updatedAt })) }),
      });
      if (roleTitleProperty.current !== propertyId) return;
      setBulkReview(null); setSelectedItemIds([]);
      showNotification(`Updated automatic Photo settings for ${result.changedCount} service${result.changedCount === 1 ? '' : 's'}.`);
      await loadItems();
    } catch (error) {
      if (roleTitleProperty.current === propertyId) setBulkError(error instanceof Error ? error.message : 'Could not save the bulk update.');
    } finally { setBulkBusy(false); }
  };

  const handleBulkDeleteItems = async () => {
    if (!bulkDeleteTarget || bulkDeleteTarget.propertyId !== activeProperty?.id || itemBusy || bulkBusy) return;
    const { propertyId, items: targets, permanent } = bulkDeleteTarget;
    if (permanent && permanentDeleteConfirmation !== 'DELETE PERMANENTLY') return;
    setItemBusy(true); setErrorMsg(null);
    try {
      const result = await apiFetch<{ deletedCount: number }>(permanent ? '/items/bulk-permanent-delete' : '/items/bulk-delete', {
        method: 'POST', body: JSON.stringify({ propertyId, itemIds: targets.map(item => item.id), ...(permanent ? { confirmation: permanentDeleteConfirmation } : {}) }),
      });
      if (roleTitleProperty.current !== propertyId) return;
      setBulkDeleteTarget(null); setSelectedItemIds([]);
      showNotification(permanent ? `${result.deletedCount} ${result.deletedCount === 1 ? 'activity' : 'activities'} permanently deleted.` : `${result.deletedCount} activities deleted. Existing bills and history retained.`);
      await loadItems();
    } catch (error) {
      if (roleTitleProperty.current === propertyId) setErrorMsg(error instanceof Error ? error.message : 'Could not delete the selected activities.');
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

  return {
    activeProperty,
    activeTab,
    applyBulkMedia,
    auditCursor,
    auditLogs,
    bulkBusy,
    bulkDeleteTarget,
    bulkError,
    bulkReview,
    canManageAccounts,
    canPermanentlyDeleteSelected,
    catalogueFilters,
    catalogueImport,
    categories,
    categoryBusy,
    closeItemEditor,
    closePasswordReset,
    closePropertyDelete,
    closeUserDelete,
    commissionSelections,
    commitCatalogue,
    confirmPassword,
    copyItemRules,
    deleteItemNoun,
    deleteItemTarget,
    deletePropertyCode,
    deletePropertyTarget,
    deleteUserTarget,
    deleteUsername,
    editingItem,
    editingProperty,
    editingStaff,
    editingUser,
    eligibleVisibleItems,
    errorMsg,
    exportCatalogue,
    giveStaffLogin,
    handleBulkDeleteItems,
    handleCreateCategory,
    handleCreateRoleTitle,
    handleDeleteItem,
    handleDeleteProperty,
    handleDeleteUser,
    handleResetPassword,
    handleRestoreItem,
    handleSaveItem,
    handleSaveProperty,
    handleSaveStaff,
    handleSaveUser,
    handleUnlockUser,
    isGlobalAdmin,
    itemBusy,
    itemForm,
    items,
    loadAuditLogs,
    loading,
    newCategoryName,
    newPassword,
    newRoleTitle,
    noCommissions,
    onSectionChange,
    openItemEditor,
    openPropertyForm,
    openStaffEditor,
    openUserForm,
    permanentDeleteConfirmation,
    photoCommissionLabel,
    photoPriceLabel,
    photoSettings,
    pmsSavingProperty,
    previewCatalogue,
    previousCommissionSettings,
    propForm,
    properties,
    propertyDeleting,
    propertySaving,
    requestNavigation,
    resetAuthenticator,
    resetBusy,
    resetTargetUser,
    reviewBulkMedia,
    roleTitleBusy,
    roleTitles,
    roleTitlesLoading,
    selectableItems,
    selectedAreActive,
    selectedItemIds,
    selectedItems,
    selectedVisibleCount,
    setActiveProperty,
    setBulkDeleteTarget,
    setBulkError,
    setBulkReview,
    setCatalogueFilters,
    setCatalogueImport,
    setCommissionSelections,
    setConfirmPassword,
    setDeleteItemTarget,
    setDeletePropertyCode,
    setDeletePropertyTarget,
    setDeleteUserTarget,
    setDeleteUsername,
    setErrorMsg,
    setGiveStaffLogin,
    setItemForm,
    setNewCategoryName,
    setNewPassword,
    setNewRoleTitle,
    setNoCommissions,
    setPermanentDeleteConfirmation,
    setPropForm,
    setResetAuthenticator,
    setResetTargetUser,
    setSelectedItemIds,
    setShowArchivedItems,
    setShowCategoryInput,
    setShowPropertyModal,
    setShowStaffModal,
    setShowUserModal,
    setStaffForm,
    setStaffLogin,
    setUserForm,
    showArchivedItems,
    showCategoryInput,
    showItemModal,
    showPropertyModal,
    showStaffModal,
    showUserModal,
    staffBusy,
    staffForm,
    staffList,
    staffLogin,
    successMsg,
    toggleComplimentaryMedia,
    transferBusy,
    updatePmsCode,
    user,
    userDeleting,
    userForm,
    userSaving,
    usersList,
    viewItems,
    visibleItems
  };
}

export type AdminModel = ReturnType<typeof useAdminController>;
