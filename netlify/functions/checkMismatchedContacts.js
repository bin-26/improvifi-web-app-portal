// ======================     LOGGING CONTROL     ======================
const isTestingMode = process.env.TESTING === 'true';

const logger = {
  log: isTestingMode ? console.log : () => {},
  error: isTestingMode ? console.error : () => {},
};
// =====================================================================

const BATCH_SIZE = 100;

export const handler = async (event, context) => {
  const token = process.env.HUBSPOT_API_KEY;
  if (!token) {
    logger.error('[Orchestrator] CRITICAL: HUBSPOT_API_KEY is not set. Function cannot run.');
    return;
  }
  
  const hsHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  try {
    let allMismatchedContactIds = [];
    let after = null;
    logger.log('[Orchestrator] Starting daily search for mismatched contacts...');

    // STEP 1: Quickly fetch the IDs of ALL mismatched contacts.
    do {
      const searchPayload = {
        after: after,
        limit: 100,
        properties: [],
        filterGroups: [{
          filters: [{
            propertyName: 'is_dealer_number_matching',
            operator: 'EQ',
            value: 'false'
          }]
        }]
      };

      const contactSearchResp = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: hsHeaders,
        body: JSON.stringify(searchPayload)
      });

      if (!contactSearchResp.ok) {
        throw new Error(`HubSpot API search failed: ${await contactSearchResp.text()}`);
      }

      const contactData = await contactSearchResp.json();
      
      if (contactData.results && contactData.results.length > 0) {
        allMismatchedContactIds.push(...contactData.results.map(c => c.id));
      }
      after = contactData.paging?.next?.after;
    } while (after);
    
    // STEP 2: If contacts are found, group them into batches.
    if (allMismatchedContactIds.length > 0) {
      const batches = [];
      for (let i = 0; i < allMismatchedContactIds.length; i += BATCH_SIZE) {
        batches.push(allMismatchedContactIds.slice(i, i + BATCH_SIZE));
      }

      logger.log(`[Orchestrator] Found ${allMismatchedContactIds.length} contacts. Grouping into ${batches.length} batches of up to ${BATCH_SIZE}.`);
      
      const siteUrl = process.env.URL;
      const workerUrl = `${siteUrl}/.netlify/functions/fixContactBatch-background`;

      const invocationPromises = batches.map(batch => {
        return fetch(workerUrl, {
          method: 'POST',
          body: JSON.stringify({ contactIds: batch })
        });
      });
      
      await Promise.all(invocationPromises);

      logger.log('[Orchestrator] All background batch workers have been invoked.');
    } else {
      logger.log("[Orchestrator] No mismatched contacts found.");
    }

  } catch (error) {
    logger.error('[Orchestrator] CRITICAL: Cron job execution failed:', error.stack || error);
  }
};