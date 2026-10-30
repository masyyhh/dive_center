import type { NavTab } from '../components/SubNav';

export type WorkspaceShortcut = { code: string; key: string; label: string; tab?: NavTab };

export function workspaceShortcuts(canAdmin: boolean, waterSportsEnabled: boolean): WorkspaceShortcut[] {
  return [
    { code: 'Digit1', key: '1', label: 'Overview', tab: 'home' },
    { code: 'Digit2', key: '2', label: 'New bill', tab: 'new-bill' },
    { code: 'Digit3', key: '3', label: 'Bills', tab: 'bills' },
    { code: 'Digit4', key: '4', label: 'Attendance', tab: 'presence' },
    { code: 'Digit5', key: '5', label: 'Reports & payroll', tab: 'reporting' },
    ...(canAdmin ? [{ code: 'Digit6', key: '6', label: 'Administration', tab: 'admin' as const }] : []),
    ...(waterSportsEnabled ? [{ code: 'Digit7', key: '7', label: 'Water sports', tab: 'water-sports' as const }] : []),
    { code: 'KeyK', key: 'K', label: 'Keyboard shortcuts' },
  ];
}

type ShortcutEvent = Pick<KeyboardEvent, 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'repeat' | 'isComposing' | 'defaultPrevented'>;

export function matchWorkspaceShortcut(event: ShortcutEvent, shortcuts: WorkspaceShortcut[], blocked: boolean) {
  if (blocked || event.defaultPrevented || event.repeat || event.isComposing ||
      !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return undefined;
  // Physical key codes also work with Option+Shift on macOS and non-US layouts.
  return shortcuts.find(shortcut => shortcut.code === event.code);
}

export function dispatchWorkspaceShortcut(
  event: ShortcutEvent & { preventDefault: () => void },
  options: { canAdmin: boolean; waterSportsEnabled: boolean; blocked: boolean; navigate: (tab: NavTab) => void; openHelp: () => void },
) {
  const shortcut = matchWorkspaceShortcut(event, workspaceShortcuts(options.canAdmin, options.waterSportsEnabled), options.blocked);
  if (!shortcut) return;
  event.preventDefault();
  if (shortcut.tab) options.navigate(shortcut.tab);
  else options.openHelp();
}
