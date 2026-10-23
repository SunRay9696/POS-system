/**
 * Internal Malaysian e-Invoice preparation only.
 * This module does not produce signed UBL or submit anything to MyInvois.
 */
export type BuyerType = 'individual' | 'business';
export type IdentificationType = 'BRN' | 'NRIC' | 'PASSPORT';

export interface InvoiceBuyer {
  type: BuyerType;
  name?: string;
  tin?: string;
  identificationType?: IdentificationType;
  identificationNumber?: string;
  email?: string;
  address?: string;
}

export class InvoiceValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceValidationError';
  }
}

function textField(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new InvoiceValidationError(`${label} must be text.`);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new InvoiceValidationError(`${label} is too long or contains invalid characters.`);
  }
  return normalized;
}

/** Format checks only: this does not verify a buyer's identity or TIN with LHDN. */
export function validateBuyer(
  input: unknown = {},
  options: { requireBusinessFields?: boolean } = {},
): InvoiceBuyer {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new InvoiceValidationError('Buyer must be an object.');
  }
  const source = input as Record<string, unknown>;
  const type = source.type ?? 'individual';
  if (type !== 'individual' && type !== 'business') {
    throw new InvoiceValidationError('Buyer type must be individual or business.');
  }
  const buyer: InvoiceBuyer = { type };
  const name = textField(source.name, 'Buyer name', 200);
  const tin = textField(source.tin, 'Buyer TIN', 30)?.toUpperCase();
  const identificationNumber = textField(source.identificationNumber, 'Identification number', 40)?.toUpperCase();
  const email = textField(source.email, 'Buyer email', 254);
  const address = textField(source.address, 'Buyer address', 600);
  const identificationType = textField(source.identificationType, 'Identification type', 20)?.toUpperCase();

  if (tin && !/^[A-Z0-9]{1,30}$/.test(tin)) {
    throw new InvoiceValidationError('TIN must contain only letters and numbers.');
  }
  if (identificationType && !['BRN', 'NRIC', 'PASSPORT'].includes(identificationType)) {
    throw new InvoiceValidationError('Identification type must be BRN, NRIC or PASSPORT.');
  }
  if (Boolean(identificationType) !== Boolean(identificationNumber)) {
    throw new InvoiceValidationError('Provide both identification type and identification number.');
  }
  if (identificationNumber && !/^[A-Z0-9 /-]{1,40}$/.test(identificationNumber)) {
    throw new InvoiceValidationError('Identification number has an invalid format.');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InvoiceValidationError('Buyer email has an invalid format.');
  }
  if (name) buyer.name = name;
  if (tin) buyer.tin = tin;
  if (identificationType) buyer.identificationType = identificationType as IdentificationType;
  if (identificationNumber) buyer.identificationNumber = identificationNumber;
  if (email) buyer.email = email;
  if (address) buyer.address = address;

  if (type === 'business' && options.requireBusinessFields) {
    const required: Array<keyof InvoiceBuyer> = ['name', 'tin', 'identificationType', 'identificationNumber', 'address'];
    const missing = required.filter((field) => !buyer[field]);
    if (missing.length) {
      throw new InvoiceValidationError(`Business invoice buyer is missing: ${missing.join(', ')}.`);
    }
    if (buyer.identificationType !== 'BRN') {
      throw new InvoiceValidationError('Business invoice buyer must use BRN identification.');
    }
  }
  return buyer;
}

export interface InvoiceOrder {
  id: number | string;
  orderNumber: string;
  createdAt: string;
  paidAt: string | null;
  status: string;
  subtotal: number;
  serviceCharge: number;
  taxAmount: number;
  total: number;
  items: Array<{
    menuItemId: number | string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
}

export interface InvoiceSettings {
  restaurantName: string;
  currency: string;
  timeZone: string;
}

function cents(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100))) {
    throw new InvoiceValidationError(`${label} must be a non-negative monetary amount.`);
  }
  const result = Math.round(value * 100);
  if (Math.abs(value * 100 - result) > 0.000001) {
    throw new InvoiceValidationError(`${label} must have at most two decimal places.`);
  }
  return result;
}

/**
 * A downloadable internal draft, never evidence of LHDN validation or acceptance.
 * No personal data is required for an anonymous individual draft. Business
 * exports require basic buyer details but still need live schema validation.
 */
export function createInvoiceDraft({ order, settings, buyer = {} }: {
  order: InvoiceOrder;
  settings: InvoiceSettings;
  buyer?: unknown;
}) {
  if (order.status !== 'paid' || !order.paidAt || !Number.isFinite(Date.parse(order.paidAt))) {
    throw new InvoiceValidationError('Only paid orders can have an invoice draft.');
  }
  if (settings.currency !== 'MYR') {
    throw new InvoiceValidationError('This Malaysian invoice preparation supports MYR only.');
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new InvoiceValidationError('Invoice must contain order items.');
  }
  const normalizedBuyer = validateBuyer(buyer, { requireBusinessFields: true });
  let lineSum = 0;
  const items = order.items.map((item) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new InvoiceValidationError('Invoice item quantities must be positive whole numbers.');
    }
    const unitPrice = cents(item.unitPrice, 'Unit price');
    const lineTotal = cents(item.lineTotal, 'Line total');
    if (unitPrice * item.quantity !== lineTotal) {
      throw new InvoiceValidationError('Invoice item total does not match quantity and unit price.');
    }
    lineSum += lineTotal;
    return { ...item, unitPrice: unitPrice / 100, lineTotal: lineTotal / 100 };
  });
  const subtotal = cents(order.subtotal, 'Subtotal');
  const serviceCharge = cents(order.serviceCharge, 'Service charge');
  const taxAmount = cents(order.taxAmount, 'Tax amount');
  const total = cents(order.total, 'Total');
  if (lineSum !== subtotal || subtotal + serviceCharge + taxAmount !== total) {
    throw new InvoiceValidationError('Invoice totals do not reconcile with the order items.');
  }

  return {
    status: 'draft_not_submitted' as const,
    standard: 'MyInvois integration preparation' as const,
    notice: '内部草稿，尚未提交 MyInvois，也未获 LHDN 验证。此文件不是已验证的 e-Invoice。',
    draftReference: `DRAFT-${order.orderNumber}`,
    generatedAt: new Date().toISOString(),
    orderId: order.id,
    orderNumber: order.orderNumber,
    paidAt: order.paidAt,
    currency: settings.currency,
    timeZone: settings.timeZone,
    issuer: {
      name: settings.restaurantName,
      tin: null,
      businessRegistrationNumber: null,
      msicCode: null,
      businessActivityDescription: null,
      address: null,
      email: null,
      telephone: null,
      missingFields: ['tin', 'businessRegistrationNumber', 'msicCode', 'businessActivityDescription', 'address', 'email', 'telephone'],
    },
    buyer: normalizedBuyer,
    items,
    amounts: {
      subtotal: subtotal / 100,
      serviceCharge: serviceCharge / 100,
      taxAmount: taxAmount / 100,
      total: total / 100,
    },
    readiness: {
      readyForSubmission: false,
      submittedToMyInvois: false,
      acceptedByMyInvois: false,
      format: 'Internal JSON; not a validated MyInvois UBL document',
      requiredWork: [
        'Confirm current LHDN rules, document version, tax treatment and required supplier/buyer fields.',
        'Configure authorized taxpayer sandbox credentials and validate identity details.',
        'Map to the current official UBL schema and implement applicable signing requirements.',
        'Submit to the sandbox, track validation results and handle rejected documents.',
        'Complete production authorization, data protection and operational readiness before enabling live submission.',
      ],
    },
  };
}
