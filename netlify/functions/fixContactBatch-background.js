import { associateContactToCompanyByDealerNumber } from './hubspotService.js';

// ======================     LOGGING CONTROL     ======================
const isTestingMode = process.env.TESTING === 'true';

const logger = {
  log: isTestingMode ? console.log : () => {},
  error: isTestingMode ? console.error : () => {},
};
// =====================================================================

export const handler = async (event, context) => {
  const token = process.env.HUBSPOT_API_KEY;
  if (!token) {
    logger.error('[Worker] CRITICAL: HUBSPOT_API_KEY is not set. Function cannot run.');
    return;
  }
  
  const hsHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  try {
    const { contactIds } = JSON.parse(event.body);

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      logger.error('[Worker] Payload was not an array of contact IDs. Exiting.');
      return;
    }

    logger.log(`[Worker] Received a batch of ${contactIds.length} contacts to process.`);

    for (const contactId of contactIds) {
      try {
        const contactFetchResp = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=dealer_number`, {
            headers: hsHeaders
        });

        if (!contactFetchResp.ok) {
            throw new Error(`Failed to fetch contact details for ID ${contactId}`);
        }

        const contactData = await contactFetchResp.json();
        const dealerNumber = contactData.properties.dealer_number;

        if (!dealerNumber) {
            logger.log(`[Worker] Contact ${contactId} has no dealer number. Skipping.`);
            continue; 
        }

        await associateContactToCompanyByDealerNumber({
            contactId: contactId,
            dealerNumber: dealerNumber,
            hsHeaders: hsHeaders
        });

      } catch (innerError) {
        logger.error(`[Worker] Failed to process contact ${contactId} within batch. Error:`, innerError.message || innerError);
      } finally {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    logger.log(`[Worker] Successfully finished processing batch of ${contactIds.length} contacts.`);

  } catch (error) {
    logger.error('[Worker] A critical error occurred while processing a batch:', error.stack || error);
  }
};