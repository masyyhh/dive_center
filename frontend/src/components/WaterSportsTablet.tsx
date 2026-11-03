import { isRoomNumber, roomNumberHelp } from '../utils/inputValidation';
import { API_BASE } from '../services/api';
import React, { useEffect, useRef, useState } from 'react';
import { Disclaimer, formNames, Signature, SignaturePad, StaffFields } from './WaterSportsShared';
import { signatureHasInk, remainingMinutes } from '../utils/diveCentreJourney';
import './water-sports.css';

type Guest = { id: string; fullName: string; roomNumber: string; checkoutDate: string | null; propertyCode: string };
type Session = { completed?: boolean; runningNumber?: number; propertyName?: string; formType: string; staffFields: Record<string, string>; documents: Disclaimer[]; businessDate: string; expiresAt: string };
// The private guest capability stays in the fragment and is never used as a staff credential.
export const DiveCentreTablet = ({ token }: { token: string }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [step, setStep] = useState(1), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [documentId, setDocumentId] = useState(''), [read, setRead] = useState(false), [unavailable, setUnavailable] = useState(false);
  const [room, setRoom] = useState(''), [guests, setGuests] = useState<Guest[]>([]), [selected, setSelected] = useState('');
  const [age, setAge] = useState(''), [guardian, setGuardian] = useState(''), [signature, setSignature] = useState<Signature>([]);
  const [now, setNow] = useState(Date.now());
  const heading = useRef<HTMLHeadingElement>(null);
  const request = async <T,>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${API_BASE}/dive-centre/tablet${path}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store',
    });
    const result = await response.json();
    if (!response.ok) { if (response.status === 410) setUnavailable(true); throw new Error(result.error || 'Please ask the dive centre team for help.'); }
    return result;
  };
  const load = async () => {
    setBusy(true); setError(''); setUnavailable(false);
    try { const data = await request<Session>(''); setNow(Date.now()); setSession(data); setDocumentId(data.documents?.[0]?.id || ''); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => {
    window.document.title = 'Dive centre · Guest check-in';
    setSession(null); setRoom(''); setGuests([]); setSelected(''); setAge(''); setGuardian(''); setSignature([]); setRead(false); setStep(1);
    void load();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [token]);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => { if ((selected || signature.length) && !session?.completed) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [selected, signature.length, session?.completed]);
  const document = session?.documents?.find(item => item.id === documentId);
  const guest = guests.find(item => item.id === selected);
  const minutes = remainingMinutes(session?.expiresAt, now);
  const expired = !!session && !session.completed && minutes === 0;
  const move = (value: number) => { setSignature([]); setError(''); setStep(value); window.scrollTo(0, 0); };
  const clearGuest = () => { setGuests([]); setSelected(''); setAge(''); setGuardian(''); setSignature([]); };
  const steps = ['Your details', 'Read & understand', 'Review & sign'];

  return <main className="ws-tablet"><div className="ws-tablet-card">
    <header className="dc-guest-header"><span className="eyebrow">WELCOME TO YOUR DIVE CENTRE</span>
      <h1>{session?.propertyName || 'Guest check-in'}</h1>
      {session && !session.completed && <><p>{formNames[session.formType] || 'Guest participation form'}</p>
        <p>Complete your details, read your agreement and sign. Your dive centre team is here if you need help.</p>
        <ol className="dc-progress" aria-label="Check-in progress">{steps.map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} data-complete={step > index + 1}><span>{step > index + 1 ? '✓' : index + 1}</span>{label}</li>)}</ol>
        {minutes !== null && minutes > 0 && <p className="dc-time">Private link · about {minutes} minute{minutes === 1 ? '' : 's'} remaining</p>}
      </>}
    </header>
    {error && <div className="ws-error" role="alert">{error}</div>}
    {!session && !unavailable && <button className="primary-button" disabled={busy} onClick={() => void load()}>{busy ? 'Opening your form…' : 'Try again'}</button>}
    {session?.completed ? <div role="status" className="ws-success dc-completion"><span aria-hidden="true">✓</span><h2>You’re all set. Your form is saved.</h2><p>Your reference: <strong>{session.runningNumber}</strong></p><p>Thank you. Please let the dive centre team know you’ve finished, and return their tablet if you’re using one.</p><p>You can now close this page.</p></div>
      : (expired || unavailable) ? <div className="ws-success"><h2>Let’s get you a fresh link</h2><p>This form is no longer available. Ask the dive centre team for a new link; they can help you continue.</p></div>
      : session && document && <>
        <h2 ref={heading} tabIndex={-1}>{steps[step - 1]}</h2>
        {step === 1 && <>
          <p>Enter the villa or room number your team prepared for you, then select your name.</p>
          <form className="ws-room-search" onSubmit={async event => {
            event.preventDefault(); setError(''); setBusy(true); clearGuest();
            try { const result = await request<{ guests: Guest[] }>('/guests', { roomNumber: room.trim() }); setGuests(result.guests); if (result.guests.length === 1) setSelected(result.guests[0].id); if (!result.guests.length) setError('We couldn’t find an in-house guest for this room. Your dive centre team can help.'); }
            catch (e) { setError((e as Error).message); } finally { setBusy(false); }
          }}>
            <label>Villa / room number<input value={room} inputMode="numeric" pattern="[0-9]{1,32}" title={roomNumberHelp} maxLength={32} required autoComplete="off" disabled={busy} onChange={event => { setRoom(event.target.value); clearGuest(); }} /></label>
            <button className="primary-button" disabled={busy || !isRoomNumber(room)}>{busy ? 'Finding your name…' : 'Find my name'}</button>
          </form>
          {!!guests.length && <fieldset disabled={busy}><legend>Who is this form for?</legend>{guests.map(item => <label key={item.id} className="ws-guest"><input type="radio" name="guest" checked={selected === item.id} onChange={() => { setSelected(item.id); setAge(''); setGuardian(''); setSignature([]); }} /><span><strong>{item.fullName}</strong><small>Villa {item.roomNumber} · Departure {item.checkoutDate || 'Please confirm with the team'}</small></span></label>)}</fieldset>}
          <button className="primary-button dc-next" disabled={busy || !guest} onClick={() => move(2)}>Continue to agreement</button>
          <p className="dc-help">Name missing or incorrect? Please ask your dive centre team before continuing.</p>
        </>}
        {step === 2 && <>
          <button className="secondary-button" disabled={busy} onClick={() => move(1)}>Back to your details</button>
          <label>Agreement language<select value={documentId} onChange={event => { setDocumentId(event.target.value); setRead(false); setSignature([]); }}>{session.documents.map(item => <option key={item.id} value={item.id}>{item.languageName}</option>)}</select></label>
          <article className="ws-disclaimer" lang={document.language} dir="auto"><h3>{document.title}</h3><div>{document.body}</div></article>
          <p className="dc-help">Take your time. If anything is unclear or your language is unavailable, ask the team to help before you sign.</p>
          <label className="ws-check"><input type="checkbox" checked={read} onChange={event => setRead(event.target.checked)} />I have read and understood this agreement. If signing for a child, I am their parent or guardian.</label>
          <button className="primary-button dc-next" disabled={!read} onClick={() => move(3)}>Continue to review & sign</button>
        </>}
        {step === 3 && guest && <>
          <button className="secondary-button" disabled={busy} onClick={() => move(2)}>Back to agreement</button>
          <form onSubmit={async event => {
            event.preventDefault(); if (!read || !signatureHasInk(signature) || !age) return; setError(''); setBusy(true);
            try { const result = await request<{ runningNumber: number }>('/sign', { candidateId: selected, documentId, acknowledged: read, isMinor: age === 'minor', guardianName: guardian, signature }); setSession({ ...session, completed: true, runningNumber: result.runningNumber }); clearGuest(); setRoom(''); setGuardian(''); }
            catch (e) { setError((e as Error).message); } finally { setBusy(false); }
          }}><fieldset disabled={busy}>
            <dl className="ws-details"><div><dt>Guest</dt><dd>{guest.fullName}</dd></div><div><dt>Villa</dt><dd>{guest.roomNumber}</dd></div><div><dt>Date</dt><dd>{session.businessDate}</dd></div><div><dt>Agreement</dt><dd>{document.languageName} · {document.title}</dd></div></dl>
            <StaffFields fields={session.staffFields} />
            <label>Who will sign?<select required value={age} onChange={event => { setAge(event.target.value); setGuardian(''); setSignature([]); }}><option value="">Please select</option><option value="adult">I am 18 or older and signing for myself</option><option value="minor">I am the parent / guardian of a participant under 18</option></select></label>
            {age === 'minor' && <label>Parent / guardian full name<input required maxLength={300} value={guardian} onChange={event => { setGuardian(event.target.value); setSignature([]); }} /><span>I am the parent or guardian of {guest.fullName} and sign on their behalf.</span></label>}
            {age && <><h3>{age === 'minor' ? 'Parent / guardian signature' : 'Your signature'}</h3><SignaturePad key={`${selected}-${age}-${guardian}-${documentId}`} value={signature} onChange={setSignature} /><p>By signing, I confirm the details above are correct and accept the {document.languageName} agreement I have read.</p></>}
            <button className="primary-button dc-next" disabled={busy || !age || !read || !signatureHasInk(signature) || (age === 'minor' && !guardian.trim())}>{busy ? 'Saving your form…' : 'Sign & finish'}</button>
            <p className="dc-help">Your details are saved only when you finish. Keep this page open while we save your form.</p>
          </fieldset></form>
        </>}
      </>}
  </div></main>;
};
