import { createHmac, timingSafeEqual } from 'crypto';

// ======================     LOGGING CONTROL     ======================
const isTestingMode = process.env.TESTING === 'true';

const logger = {
  log: isTestingMode ? console.log : () => {},
  error: isTestingMode ? console.error : () => {},
};
// =====================================================================

export class WebhookValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WebhookValidationError';
  }
}

export function validateHubspotSignature({ request, rawBody, clientSecret }) {
  const signature = request.headers.get('x-hubspot-signature-v3');
  const timestamp = request.headers.get('x-hubspot-request-timestamp');

  if (!clientSecret || !signature || !timestamp) {
    throw new WebhookValidationError('Unauthorized: Missing validation headers or client secret.');
  }

  const VALIDITY_WINDOW = 60 * 1000;
  const CLOCK_SKEW_TOLERANCE = 30 * 1000;

  const timeDifference = Date.now() - parseInt(timestamp, 10);

  if (timeDifference > VALIDITY_WINDOW || timeDifference < -CLOCK_SKEW_TOLERANCE) {
    throw new WebhookValidationError('Unauthorized: Timestamp validation failed.');
  }

  const fullUrl = request.url;
  const method = request.method;
  const baseString = `${method}${fullUrl}${rawBody}${timestamp}`;

  const calculatedSignature = createHmac('sha256', clientSecret)
    .update(baseString)
    .digest('base64');

  if (calculatedSignature !== signature) {
    throw new WebhookValidationError('Unauthorized: Invalid signature.');
  }

  const signatureBuffer = Buffer.from(signature, 'base64')
  const calculatedSignatureBuffer = Buffer.from(calculatedSignature, 'base64')

  let areSignaturesEqual = false;
  if (signatureBuffer.length === calculatedSignatureBuffer) {
    areSignaturesEqual = timingSafeEqual(signatureBuffer, calculatedSignatureBuffer);
  }

  if (!areSignaturesEqual) {
    throw new WebhookValidationError('Unauthorized: Invalid signature.')
  }
  
  logger.log('Webhook signature validated successfully.');
}