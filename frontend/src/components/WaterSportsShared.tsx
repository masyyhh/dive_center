import React, { useRef, useState } from 'react';
export type Signature = number[][][];
export type Disclaimer = { id: string; language: string; languageName: string; title: string; body: string };
export const formNames: Record<string, string> = { PARTICIPATION: 'Water sports participation', SNORKELING: 'Snorkeling excursion', GEAR_RENTAL: 'Snorkeling gear rental', AID_GEAR: 'Aid snorkeling gear' };
export const fieldNames: Record<string, string> = { checkNumber: 'Check No.', maskNumber: 'Mask No.', finsNumber: 'Fins No.', rentalDuration: 'Rental duration', returnDate: 'Date of return', notes: 'Staff notes' };
export const SignatureImage = ({ value }: { value: Signature }) => <svg viewBox="0 0 1000 300" role="img" aria-label="Handwritten signature" className="ws-signature-image">{value.map((stroke, i) => <polyline key={i} points={stroke.map(p => p.join(',')).join(' ')} fill="none" stroke="#19323c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}</svg>;
export const SignaturePad = ({ value, onChange }: { value: Signature; onChange: (value: Signature) => void }) => {
  const drawing = useRef<number | null>(null);
  const strokes = useRef<Signature>(value);
  const [limit, setLimit] = useState(false);
  const point = (e: React.PointerEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [Math.max(0, Math.min(1000, (e.clientX - r.left) / r.width * 1000)), Math.max(0, Math.min(300, (e.clientY - r.top) / r.height * 300))]; };
  const commit = (next: Signature) => { strokes.current = next; onChange(next); };
  return <div><p>Sign with your finger or a stylus.</p><svg className="ws-signature-pad" viewBox="0 0 1000 300" preserveAspectRatio="none" role="img" aria-label="Draw your signature here" onPointerDown={e => {
    if (drawing.current !== null) return;
    if (strokes.current.length >= 50 || strokes.current.flat().length >= 1800) { setLimit(true); return; }
    e.currentTarget.setPointerCapture(e.pointerId); drawing.current = e.pointerId; commit([...strokes.current, [point(e)]]);
  }} onPointerMove={e => {
    if (drawing.current !== e.pointerId) return;
    const current = strokes.current, last = current[current.length - 1];
    if (last.length >= 490 || current.flat().length >= 1800) { setLimit(true); return; }
    const next = point(e), previous = last[last.length - 1];
    if (Math.hypot(next[0] - previous[0], next[1] - previous[1]) < 2) return;
    commit([...current.slice(0, -1), [...last, next]]);
  }} onPointerUp={() => { drawing.current = null; }} onPointerCancel={() => { drawing.current = null; }} onLostPointerCapture={() => { drawing.current = null; }}>
    {value.map((stroke, i) => <polyline key={i} points={stroke.map(p => p.join(',')).join(' ')} fill="none" stroke="#19323c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}
  </svg><button type="button" className="secondary-button" onClick={() => { drawing.current = null; commit([]); setLimit(false); }}>Clear signature</button>{limit && <p role="status">Signature pad is full. Clear it to start again.</p>}</div>;
};
export const StaffFields = ({ fields }: { fields: Record<string, string> }) => <dl className="ws-details">{Object.entries(fields).filter(([, value]) => value).map(([key, value]) => <div key={key}><dt>{fieldNames[key] || key}</dt><dd>{value}</dd></div>)}</dl>;
