import React, { useEffect, useId, useState } from 'react';

type CollectionElement = React.ReactElement<{ children?: React.ReactNode; className?: string }>;
const elements = (children: React.ReactNode) => React.Children.toArray(children).filter(React.isValidElement) as CollectionElement[];

/** Page the visible rows while retaining the entire collection for browser printing. */
export function PaginatedCollection({ label, children, renderContainer = content => content }: {
  label: string;
  children: React.ReactNode;
  renderContainer?: (content: React.ReactNode) => React.ReactNode;
}) {
  const id = useId();
  const roots = elements(children);
  const collection = roots.find(node => node.type === 'table' || node.type === 'ul');
  const body = collection?.type === 'table' ? elements(collection.props.children).find(node => node.type === 'tbody') : collection;
  const rows = elements(body?.props.children);
  const signature = rows.map(row => row.key).join('|');
  const [state, setState] = useState({ signature, page: 1, size: 25 });
  useEffect(() => { setState(current => current.signature === signature ? current : { ...current, signature, page: 1 }); }, [signature]);
  const pages = Math.max(1, Math.ceil(rows.length / state.size));
  const page = signature === state.signature ? Math.min(state.page, pages) : 1;
  const start = (page - 1) * state.size;
  const navigate = (next: number) => setState({ ...state, signature, page: Math.max(1, Math.min(next, pages)) });
  const updatedRows = rows.map((row, index) => React.cloneElement(row, {
    className: `${row.props.className || ''}${index < start || index >= start + state.size ? ' pagination-row-hidden' : ''}`,
  }));
  const updatedBody = body ? React.cloneElement(body, {}, updatedRows) : undefined;
  const updatedCollection = collection && body ? collection === body ? updatedBody : React.cloneElement(collection, {}, elements(collection.props.children).map(node => node.type === 'tbody' ? updatedBody : node)) : collection;
  const content = collection ? roots.map(node => node === collection ? updatedCollection : node) : children;
  return <>
    {renderContainer(content)}
    {rows.length > 10 && <nav className="pagination-controls" aria-label={`${label} pagination`}>
      <span role="status" aria-live="polite">{start + 1}–{Math.min(start + state.size, rows.length)} of {rows.length}</span>
      <label htmlFor={id}>Per page <select id={id} value={state.size} onChange={event => setState({ signature, page: 1, size: Number(event.target.value) })}>{[10,25,50,100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      <div className="pagination-actions">
        <button type="button" aria-label={`First page of ${label}`} disabled={page === 1} onClick={() => navigate(1)}>«</button>
        <button type="button" aria-label={`Previous page of ${label}`} disabled={page === 1} onClick={() => navigate(page - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button type="button" aria-label={`Next page of ${label}`} disabled={page === pages} onClick={() => navigate(page + 1)}>Next</button>
        <button type="button" aria-label={`Last page of ${label}`} disabled={page === pages} onClick={() => navigate(pages)}>»</button>
      </div>
    </nav>}
  </>;
}
