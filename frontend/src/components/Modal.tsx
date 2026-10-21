import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** Native dialogs provide focus containment, Escape handling, and an inert background. */
export const Modal: React.FC<{ label: string; onClose: () => void; busy?: boolean; children: React.ReactNode; error?: string | null }> = ({ label, onClose, busy, children, error }) => {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = original; previous?.focus(); };
  }, []);
  return createPortal(<dialog ref={ref} className="modal-dialog" aria-label={label} onCancel={e => { e.preventDefault(); if (!busy) closeRef.current(); }}>
    <div className="modal-content">{error && <div role="alert" className="notice notice-error modal-error">{error}</div>}{children}</div>
  </dialog>, document.body);
};
