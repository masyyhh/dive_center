import React from 'react';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';

export const SetupChecklist: React.FC<{ items: number; staff: number; canManage: boolean; onSetup: (section: string) => void }> = ({ items, staff, canManage, onSetup }) => {
  if (items > 0 && staff > 0) return null;
  const steps = [{ title: 'Add activities and prices', description: 'Build the catalogue used to create guest bills.', complete: items > 0, section: 'items' }, { title: 'Add your dive team', description: 'Set up staff before recording attendance and commissions.', complete: staff > 0, section: 'staff' }];
  return <section className="surface setup-checklist" aria-label="Property setup">
    <div><span className="eyebrow">GET YOUR CENTRE READY</span><h2>{canManage ? 'A couple of steps to get started' : 'Your centre setup is in progress'}</h2><p>{canManage ? `${steps.filter(step => step.complete).length} of 2 steps complete. Set up this property once, then get on with your day.` : 'Your property manager needs to finish the following setup before your team can use every workflow.'}</p></div>
    <div className="setup-steps">{steps.map(step => <div className="setup-step" key={step.section}>{step.complete ? <CheckCircle2 size={21} className="setup-complete" /> : <Circle size={21} />}<div><h3>{step.title}</h3><p>{step.description}</p></div>{step.complete ? <span className="status-badge status-active">Ready</span> : canManage ? <button className="text-button" onClick={() => onSetup(step.section)}>Set up<ArrowRight size={15} /></button> : <span className="status-badge">Needs setup</span>}</div>)}</div>
  </section>;
};
