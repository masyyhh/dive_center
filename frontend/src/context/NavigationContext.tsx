import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Modal } from '../components/Modal';

type Guard = { message: string; busy?: boolean };
type NavigationContextValue = {
  hasUnsavedChanges: () => boolean;
  register: (id: symbol, guard: Guard | null) => void;
  requestNavigation: (action: () => void) => void;
};
const NavigationContext = createContext<NavigationContextValue | null>(null);

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const guards = useRef(new Map<symbol, Guard>());
  const [pending, setPending] = useState<{ action: () => void; messages: string[]; busy: boolean } | null>(null);
  const hasUnsavedChanges = useCallback(() => guards.current.size > 0, []);
  const register = useCallback((id: symbol, guard: Guard | null) => {
    if (guard) guards.current.set(id, guard);
    else guards.current.delete(id);
  }, []);
  const requestNavigation = useCallback((action: () => void) => {
    const active = [...guards.current.values()];
    if (!active.length) { action(); return; }
    setPending({ action, messages: [...new Set(active.map(guard => guard.message))], busy: active.some(guard => guard.busy) });
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!guards.current.size) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return <NavigationContext.Provider value={{ register, requestNavigation, hasUnsavedChanges }}>
    {children}
    {pending && <Modal label="Leave unfinished work?" onClose={() => setPending(null)}>
      <div className="surface guard-dialog">
        <h2>{pending.busy ? 'Please finish saving' : 'Leave this screen?'}</h2>
        {pending.messages.map(message => <p key={message}>{message}</p>)}
        <div className="dialog-actions"><button className="secondary-button" autoFocus onClick={() => setPending(null)}>Keep editing</button>
          {!pending.busy && <button className="primary-button" onClick={() => { const action = pending.action; setPending(null); action(); }}>Leave screen</button>}
        </div>
      </div>
    </Modal>}
  </NavigationContext.Provider>;
};
export const useNavigation = () => {
  const value = useContext(NavigationContext);
  if (!value) throw new Error('NavigationProvider is required');
  return value;
};
export const useUnsavedChanges = (dirty: boolean, message: string, busy = false) => {
  const { register } = useNavigation();
  const id = useRef(Symbol('unfinished-work'));
  useEffect(() => {
    register(id.current, dirty || busy ? { message, busy } : null);
    return () => register(id.current, null);
  }, [dirty, message, busy, register]);
  // Saving can clear the guard synchronously before redirecting.
  return useCallback(() => register(id.current, null), [register]);
};
