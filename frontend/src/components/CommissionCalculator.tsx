import React, { useId, useState } from 'react';
import { Calculator, ChevronDown } from 'lucide-react';
import { CommissionSelection, commissionRoles } from '../utils/commissionEditor';
import { calculateCommissionPreview } from '../utils/commissionCalculator';
import { formatMoney } from '../utils/format';

export const CommissionCalculator: React.FC<{
  price: number; poolType: string; poolRate: number; selections: CommissionSelection[]; combinedMedia: boolean; currencySymbol: string;
}> = props => {
  const [quantity, setQuantity] = useState('1');
  const [discount, setDiscount] = useState('0');
  const result = quantity.trim() && discount.trim() ? calculateCommissionPreview({ ...props, quantity: Number(quantity), discount: Number(discount) }) : null;
  const money = (value: number) => formatMoney(value, props.currencySymbol);
  return <section className="commission-calculator" aria-label="Commission calculator preview">
    <div className="commission-preview-heading"><Calculator size={18} /><h3>Try a bill</h3><span>Preview only</span></div>
    <p>See how discounts affect the pool and how fixed employee payments stay separate.</p>
    <div className="calculator-controls">
      <div><span>Service price</span><strong>{money(props.price)} / unit</strong></div>
      <label>Quantity<input aria-label="Preview quantity" type="text" inputMode="numeric" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
      <label>Discount (%)<input aria-label="Preview discount percentage" type="text" inputMode="decimal" value={discount} onChange={event => setDiscount(event.target.value)} /></label>
    </div>
    <button type="button" className="text-button" onClick={() => setDiscount(discount === '100' ? '0' : '100')}>{discount === '100' ? 'Remove complimentary discount' : 'Try a complimentary service'}</button>
    {result ? <div aria-live="polite" className="calculator-results">
      <dl><div><dt>Price × quantity</dt><dd>{money(result.gross)}</dd></div><div><dt>Discount ({discount}%)</dt><dd>−{money(result.discountAmount)}</dd></div>
        <div className="calculator-subtotal"><dt>Service total before tax & service charge</dt><dd>{money(result.serviceTotal)}</dd></div>{props.combinedMedia && <><div><dt>Added Photo · $57.50 × {quantity}</dt><dd>{money(result.photoCharge)}</dd></div><div className="calculator-subtotal"><dt>Bill subtotal before tax & service charge</dt><dd>{money(result.billSubtotal)}</dd></div></>}</dl>
      <div className="calculator-allocation"><h4>{props.poolType === 'CERTIFICATION_POOL' ? 'Certifications pool · tracked only' : 'Shared pool contribution'}</h4>
        <strong>{money(result.poolAmount)}</strong><p>{props.poolType === 'NONE' ? 'This service does not contribute to a pool.' : result.percentage ? `${props.poolRate}% × ${money(result.serviceTotal)} after discounts` : `${money(props.poolRate)} × ${quantity} service unit(s)`}</p>
        {result.percentage && <small>The pool is shared among eligible employees. This is not a payment to one employee.</small>}
      </div>
      <div className="calculator-allocation"><h4>Fixed employee payments</h4><strong>{money(result.employeeTotal)}</strong>
        {result.payments.length ? <dl>{result.payments.map(payment => <div key={payment.role}><dt>{payment.role === 'media' ? 'Employee on the Photo line' : commissionRoles.find(role => role.id === payment.role)?.label}<small>{money(payment.unitRate)} × {quantity} unit(s)</small></dt><dd>{money(payment.amount)}</dd></div>)}</dl> : <p>No employee payments configured.</p>}
        <small>Assumes every configured role is assigned on the bill. Fixed payments apply even when the service is complimentary.</small>
      </div>
    </div> : <p role="status">Enter a whole-number quantity of 1 or more, a discount from 0–100%, and valid employee payment amounts.</p>}
    <p className="commission-preview-help">The discount preview applies to the activity. Added Photos start without a discount. Preview changes do not change the saved activity.</p>
  </section>;
};

export const CommissionCalculatorPreview: React.FC<React.ComponentProps<typeof CommissionCalculator>> = props => {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="calculator-disclosure">
    <button type="button" className="secondary-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <Calculator size={17} aria-hidden="true" />{open ? 'Hide calculator' : 'Calculator preview'}<ChevronDown size={16} aria-hidden="true" className={open ? 'is-open' : ''} />
    </button>
    <p>Try a quantity or discount to see the pool and employee payments before saving.</p>
    <div id={id} hidden={!open}><CommissionCalculator {...props} /></div>
  </div>;
};
