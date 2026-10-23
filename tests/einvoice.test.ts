import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvoiceDraft, validateBuyer, InvoiceValidationError, type InvoiceOrder } from '../server/einvoice.js';

const settings = { restaurantName: 'The Square Box', currency: 'MYR', timeZone: 'Asia/Kuala_Lumpur' };
function paidOrder(): InvoiceOrder {
  return {
    id: 'order-1', orderNumber: 'SB-20261023-0001', createdAt: '2026-10-23T08:00:00Z', paidAt: '2026-10-23T08:01:00Z', status: 'paid',
    subtotal: 36, serviceCharge: 0, taxAmount: 0, total: 36,
    items: [{ menuItemId: 'bowl', name: '鸡肉饭', quantity: 2, unitPrice: 18, lineTotal: 36 }],
  };
}

const business = { type: 'business', name: 'Square Box Sdn Bhd', tin: 'c1234567890', identificationType: 'BRN', identificationNumber: '202601234567', address: '1 Jalan Example, Malaysia' };

test('anonymous draft is explicitly unsubmitted and never invents official identifiers', () => {
  assert.deepEqual(validateBuyer(), { type: 'individual' });
  const draft = createInvoiceDraft({ order: paidOrder(), settings });
  assert.equal(draft.status, 'draft_not_submitted');
  assert.equal(draft.standard, 'MyInvois integration preparation');
  assert.equal(draft.draftReference, 'DRAFT-SB-20261023-0001');
  assert.equal(draft.readiness.readyForSubmission, false);
  assert.equal(draft.readiness.submittedToMyInvois, false);
  assert.equal(draft.readiness.acceptedByMyInvois, false);
  assert.equal(draft.issuer.tin, null);
  assert.ok(draft.issuer.missingFields.includes('tin'));
  assert.deepEqual(draft.buyer, { type: 'individual' });
  assert.equal(draft.amounts.total, 36);
  assert.equal('irbmUuid' in draft, false);
  assert.equal('validationLink' in draft, false);
  assert.match(draft.notice, /不是已验证/);
});

test('normalizes complete business details while rejecting incomplete or mismatched identification', () => {
  const draft = createInvoiceDraft({ order: paidOrder(), settings, buyer: { ...business, name: '  Square Box Sdn Bhd  ' } });
  assert.equal(draft.buyer.tin, 'C1234567890');
  assert.equal(draft.buyer.name, 'Square Box Sdn Bhd');
  assert.equal(draft.buyer.identificationType, 'BRN');
  assert.throws(() => createInvoiceDraft({ order: paidOrder(), settings, buyer: { type: 'business', name: 'A' } }), /missing/);
  assert.throws(() => createInvoiceDraft({ order: paidOrder(), settings, buyer: { ...business, identificationType: 'NRIC' } }), /BRN/);
  assert.throws(() => validateBuyer({ identificationType: 'NRIC' }), /both/);
  assert.throws(() => validateBuyer({ identificationNumber: '123456' }), /both/);
  assert.throws(() => validateBuyer({ identificationType: 'OTHER', identificationNumber: '123456' }), /Identification type/);
});

test('buyer data validates types, lengths and formats without claiming identity verification', () => {
  for (const input of [null, [], 'buyer', { type: 'company' }, { name: 123 }, { name: 'a'.repeat(201) }, { name: 'Name\u0000' }, { tin: 'C12<script>' }, { email: 'invalid' }]) {
    assert.throws(() => validateBuyer(input), InvoiceValidationError);
  }
  const buyer = validateBuyer({ type: 'individual', name: '  Alice  ', tin: 'ig123456789', identificationType: 'passport', identificationNumber: 'ab1234567', email: 'alice@example.com', address: 'Kuala Lumpur' });
  assert.equal(buyer.name, 'Alice');
  assert.equal(buyer.tin, 'IG123456789');
  assert.equal(buyer.identificationType, 'PASSPORT');
  assert.equal(buyer.identificationNumber, 'AB1234567');
});

test('only paid MYR orders with reconciled integer-sen amounts can be exported', () => {
  assert.throws(() => createInvoiceDraft({ order: { ...paidOrder(), status: 'pending', paidAt: null }, settings }), /paid/);
  assert.throws(() => createInvoiceDraft({ order: { ...paidOrder(), paidAt: 'invalid' }, settings }), /paid/);
  assert.throws(() => createInvoiceDraft({ order: paidOrder(), settings: { ...settings, currency: 'USD' } }), /MYR/);
  assert.throws(() => createInvoiceDraft({ order: { ...paidOrder(), items: [] }, settings }), /items/);
  assert.throws(() => createInvoiceDraft({ order: { ...paidOrder(), total: 35 }, settings }), /reconcile/);
  assert.throws(() => createInvoiceDraft({ order: { ...paidOrder(), subtotal: 35, total: 35 }, settings }), /reconcile/);
  assert.throws(() => createInvoiceDraft({ order: { ...paidOrder(), total: 36.001 }, settings }), /decimal/);
  assert.throws(() => createInvoiceDraft({ order: { ...paidOrder(), total: Number.NaN }, settings }), /monetary/);
  assert.throws(() => createInvoiceDraft({ order: { ...paidOrder(), taxAmount: -1 }, settings }), /non-negative/);
  assert.throws(() => createInvoiceDraft({ order: { ...paidOrder(), items: [{ ...paidOrder().items[0], quantity: 0 }] }, settings }), /quantities/);
  assert.throws(() => createInvoiceDraft({ order: { ...paidOrder(), items: [{ ...paidOrder().items[0], quantity: 1.5 }] }, settings }), /quantities/);
  assert.throws(() => createInvoiceDraft({ order: { ...paidOrder(), items: [{ ...paidOrder().items[0], lineTotal: 35 }] }, settings }), /quantity and unit price/);
});

test('sen arithmetic handles decimal prices and separately reported tax', () => {
  const order = paidOrder();
  order.items = [{ menuItemId: 'tea', name: '茶', quantity: 3, unitPrice: 8.9, lineTotal: 26.7 }];
  order.subtotal = 26.7;
  order.taxAmount = 1.6;
  order.total = 28.3;
  const draft = createInvoiceDraft({ order, settings });
  assert.deepEqual(draft.amounts, { subtotal: 26.7, serviceCharge: 0, taxAmount: 1.6, total: 28.3 });
});
