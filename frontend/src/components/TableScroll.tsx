import { PaginatedCollection } from './PaginatedCollection';
import React, { useEffect, useId, useRef, useState } from 'react';

/** Make wide tables discoverable and keyboard-scrollable only when they overflow. */
function ScrollableTable({ label, className = '', children }: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [children]);
  return <>
    <div ref={ref} className={`table-scroll ${className}`} role={overflow ? 'region' : undefined}
      aria-label={overflow ? label : undefined} tabIndex={overflow ? 0 : undefined}
      aria-describedby={overflow ? hintId : undefined}>
      {children}
    </div>
    {overflow && <p className="table-scroll-cue" id={hintId}>Scroll horizontally to see all columns <span aria-hidden="true">↔</span><span className="sr-only">. Keyboard users can focus the table region and use the arrow keys.</span></p>}
  </>;
}


export function TableScroll({ label, className, children, paginate = false }: {
  label: string; className?: string; children: React.ReactNode; paginate?: boolean;
}) {
  return paginate ? <PaginatedCollection label={label} renderContainer={content => <ScrollableTable label={label} className={className}>{content}</ScrollableTable>}>{children}</PaginatedCollection>
    : <ScrollableTable label={label} className={className}>{children}</ScrollableTable>;
}
