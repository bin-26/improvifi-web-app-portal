import { validateHubspotSignature, WebhookValidationError } from './webhookValidator.js';
import { associateContactToCompanyByDealerNumber } from './hubspotService.js'

const sendResponse = (statusCode, body) => {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' }
  });
};

// ======================     LOGGING CONTROL     ======================
const isTestingMode = process.env.TESTING === 'true';

const logger = {
  log: isTestingMode ? console.log : () => {},
  error: isTestingMode ? console.error : () => {},
};
// =====================================================================

export default async (request, context) => {
  try {
    const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
    const rawBody = await request.text();
    validateHubspotSignature({ request, rawBody, clientSecret });

    const body = JSON.parse(rawBody);
    const contactId = body.objectId;
    const contactDealerNumber = body.propertyValue;

    if (body.propertyName !== 'dealer_number' || !contactDealerNumber) {
        return sendResponse(200, { 
            status: 'No Action', 
            message: `Event for property '${body.propertyName}' was ignored.` 
        });
    }

    const token = process.env.HUBSPOT_API_KEY;
    const hsHeaders = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    const result = await associateContactToCompanyByDealerNumber({
      contactId: contactId,
      dealerNumber: contactDealerNumber,
      hsHeaders: hsHeaders
    });

    return sendResponse(200, {
      status: 'Success',
      message: `Association processed for contact ${contactId}. Result: ${result.status}`
    });

  } catch (error) {
    if (error instanceof WebhookValidationError) {
      logger.error(`Webhook validation failed: ${error.message}`);
      return sendResponse(401, { error: error.message });
    } else {
      logger.error('Function execution caught an unexpected error:', error.stack || error);
      return sendResponse(500, { error: 'An internal server error occurred.' });
    }
  }
};