import React, { useEffect, useState } from 'react';
import { Disclaimer, formNames, Signature, SignaturePad, StaffFields } from './WaterSportsShared';
import './water-sports.css';

type Guest = { id: string; fullName: string; roomNumber: string; checkoutDate: string | null; propertyCode: string };
type Session = { completed?: boolean; runningNumber?: number; propertyName: string; formType: string; staffFields: Record<string, string>; documents: Disclaimer[]; businessDate: string; expiresAt: string };
// Capability remains in the URL fragment: it is never sent as a referrer or a staff token.
export const WaterSportsTablet = ({ token }: { token: string }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [step, setStep] = useState(1), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [documentId, setDocumentId] = useState(''), [read, setRead] = useState(false);
  const [room, setRoom] = useState(''), [guests, setGuests] = useState<Guest[]>([]), [selected, setSelected] = useState('');
  const [age, setAge] = useState(''), [guardian, setGuardian] = useState(''), [signature, setSignature] = useState<Signature>([]);
  const request = async <T,>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`/api/water-sports/tablet${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store' });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to open this form.'); return result;
  };
  const load = async () => { setBusy(true); setError(''); try { const s = await request<Session>(''); setSession(s); setDocumentId(s.documents?.[0]?.id || ''); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  useEffect(() => { window.document.title = 'Guest water sports form'; void load(); }, [token]);
  useEffect(() => { const listener = (e: BeforeUnloadEvent) => { if (signature.length && !session?.completed) e.preventDefault(); }; window.addEventListener('beforeunload', listener); return () => window.removeEventListener('beforeunload', listener); }, [signature.length, session?.completed]);
  const document = session?.documents?.find(d => d.id === documentId);
  const guest = guests.find(g => g.id === selected);
  const resetSignature = () => setSignature([]);
  return <main className="ws-tablet"><div className="ws-tablet-card">
    <header><span className="eyebrow">GUEST SERVICES · WATER SPORTS</span><h1>{session?.propertyName || 'Water sports'}</h1>{session && !session.completed && <><p>{formNames[session.formType]}</p><p className="ws-progress">{step === 1 ? '1. Read the disclaimer' : '2. Select your name and sign'}</p></>}</header>
    {error && <div className="ws-error" role="alert">{error}</div>}
    {!session && <button className="primary-button" disabled={busy} onClick={() => void load()}>{busy ? 'Opening form…' : 'Try again'}</button>}
    {session?.completed ? <div role="status" className="ws-success"><h2>Thank you. Your form is saved.</h2><p>Running number: <strong>{session.runningNumber}</strong></p><p>Please return the tablet to a staff member.</p></div> : session && document && <>
      {step === 1 ? <>
        <label>Disclaimer language<select value={documentId} onChange={e => { setDocumentId(e.target.value); setRead(false); resetSignature(); }}>{session.documents.map(d => <option key={d.id} value={d.id}>{d.languageName}</option>)}</select></label>
        <article className="ws-disclaimer" lang={document.language} dir="auto"><h2>{document.title}</h2><div>{document.body}</div></article>
        <label className="ws-check"><input type="checkbox" checked={read} onChange={e => setRead(e.target.checked)} />I have read and understood this disclaimer. If signing for a child, I am their parent or guardian.</label>
        <button className="primary-button" disabled={!read} onClick={() => { setError(''); setStep(2); window.scrollTo(0, 0); }}>Continue to signature</button>
      </> : <>
        <button className="secondary-button" disabled={busy} onClick={() => { setStep(1); setError(''); }}>Back to disclaimer</button>
        <form onSubmit={async e => { e.preventDefault(); setError(''); setBusy(true); setGuests([]); setSelected(''); setAge(''); setGuardian(''); resetSignature(); try { const result = await request<{ guests: Guest[] }>('/guests', { roomNumber: room }); setGuests(result.guests); if (!result.guests.length) setError('No in-house guests found. Please ask staff for help.'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} className="ws-room-search">
          <label>Villa / room number<input value={room} maxLength={32} required autoComplete="off" onChange={e => { setRoom(e.target.value); setGuests([]); setSelected(''); resetSignature(); }} /></label><button className="primary-button" disabled={busy}>Find my name</button>
        </form>
        {!!guests.length && <fieldset disabled={busy}><legend>Select your name</legend>{guests.map(g => <label key={g.id} className="ws-guest"><input type="radio" name="guest" checked={selected === g.id} onChange={() => { setSelected(g.id); setAge(''); setGuardian(''); resetSignature(); }} /><span><strong>{g.fullName}</strong><small>Villa {g.roomNumber} · Departure {g.checkoutDate || 'Not supplied by PMS'} · {g.propertyCode}</small></span></label>)}</fieldset>}
        {guest && <form onSubmit={async e => { e.preventDefault(); setError(''); setBusy(true); try { const result = await request<{ runningNumber: number }>('/sign', { candidateId: selected, documentId, acknowledged: read, isMinor: age === 'minor', guardianName: guardian, signature }); setSession({ ...session, completed: true, runningNumber: result.runningNumber }); setGuests([]); setSelected(''); setGuardian(''); resetSignature(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
          <fieldset disabled={busy}><legend>Review and sign</legend><dl className="ws-details"><div><dt>Date</dt><dd>{session.businessDate}</dd></div><div><dt>Name</dt><dd>{guest.fullName}</dd></div><div><dt>Villa No.</dt><dd>{guest.roomNumber}</dd></div><div><dt>Departure date</dt><dd>{guest.checkoutDate || 'Not supplied by PMS'}</dd></div></dl><StaffFields fields={session.staffFields} />
          <label>Participant age<select required value={age} onChange={e => { setAge(e.target.value); setGuardian(''); resetSignature(); }}><option value="">Please select</option><option value="adult">18 or older — I am signing for myself</option><option value="minor">Under 18 — parent or guardian will sign</option></select></label>
          {age === 'minor' && <label>Parent / guardian full name<input required maxLength={300} value={guardian} onChange={e => { setGuardian(e.target.value); resetSignature(); }} /><span>I am the parent or guardian of {guest.fullName} and sign on their behalf.</span></label>}
          {age && <><h3>{age === 'minor' ? 'Parent / guardian signature' : 'Guest signature'}</h3><SignaturePad key={`${selected}-${age}-${guardian}`} value={signature} onChange={setSignature} /><p>By signing, I confirm that the details above are correct and accept the {document.languageName} disclaimer I have read.</p></>}
          <button className="primary-button" disabled={busy || !age || !signature.length || (age === 'minor' && !guardian.trim())}>{busy ? 'Saving…' : 'Sign and save form'}</button></fieldset>
        </form>}
      </>}
    </>}
  </div></main>;
};
