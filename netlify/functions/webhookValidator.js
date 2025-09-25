import { createHmac } from 'crypto';

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

  const FIVE_MINUTES = 5 * 60 * 1000;
  const CLOCK_SKEW_TOLERANCE = 30 * 1000;

  const timeDifference = Date.now() - parseInt(timestamp, 10);

  if (timeDifference > FIVE_MINUTES || timeDifference < -CLOCK_SKEW_TOLERANCE) {
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

  console.log('Webhook signature validated successfully.');
}