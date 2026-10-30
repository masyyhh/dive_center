import React from 'react';
import { Modal } from './Modal';
import { workspaceShortcuts } from '../utils/keyboardShortcuts';
import { waterSportsEnabled } from '../features';

export const KeyboardShortcuts: React.FC<{ canAdmin: boolean; onClose: () => void }> = ({ canAdmin, onClose }) => (
  <Modal label="Keyboard shortcuts" onClose={onClose}>
    <div className="surface shortcuts-dialog">
      <div className="section-heading">
        <h2>Keyboard shortcuts</h2>
        <button type="button" className="secondary-button" onClick={onClose} autoFocus>Close</button>
      </div>
      <p>Hold Alt + Shift (Option + Shift on Mac), then press the listed key.</p>
      <dl className="shortcuts-list">
        {workspaceShortcuts(canAdmin, waterSportsEnabled).map(shortcut => <div key={shortcut.code}>
          <dt>{shortcut.label}</dt><dd><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>{shortcut.key}</kbd></dd>
        </div>)}
        <div><dt>Close a dialog or navigation menu</dt><dd><kbd>Esc</kbd></dd></div>
      </dl>
      <p>Navigation shortcuts pause while you type, use a form field, or have a dialog or mobile navigation open. Unsaved-work warnings still apply.</p>
    </div>
  </Modal>
);
