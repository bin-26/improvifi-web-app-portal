// ======================     LOGGING CONTROL     ======================
const isTestingMode = process.env.TESTING === 'true';

const logger = {
  log: isTestingMode ? console.log : () => {},
  error: isTestingMode ? console.error : () => {},
};
// =====================================================================

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
};

export const handler = async (event, context) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers, body: '' };
    }

    const providedApiKey = event.headers['x-api-key'];
    const serverApiKey = process.env.GENERATOR_KEY;
    if (!providedApiKey || providedApiKey !== serverApiKey) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const token = process.env.HUBSPOT_API_KEY;
    if (!token) {
      return { statusCode: 500, headers: headers, body: JSON.stringify({ error: 'Server configuration error: HubSpot token missing.' }) };
    }
    
    const hsHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    
    if (!event.body) {
      return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Request body is missing.' }) };
    }
    const { prefix } = JSON.parse(event.body);

    const allowedPrefixes = ['01', '02', '03', '04'];
    if (!prefix || !allowedPrefixes.includes(prefix)) {
      return { statusCode: 400, headers: headers, body: JSON.stringify({ error: 'Invalid or missing prefix.' }) };
    }

    logger.log(`Searching for the smallest available dealer number with prefix: ${prefix}`);
    
    const PAGE_LIMIT = 100;
    const MAX_DEALER_NUMBER = 999;
    const RATE_LIMIT_DELAY_MS = 300;
    
    let lastSeenNumber = 0;
    let after = null;

    do {
      const searchPayload = {
        limit: PAGE_LIMIT,
        after: after,
        properties: ['dealer_number'],
        filterGroups: [{
          filters: [{
            propertyName: 'dealer_number',
            operator: 'CONTAINS_TOKEN',
            value: `${prefix}-`
          }]
        }],
        sorts: [{
          "propertyName": "dealer_number",
          "direction": "ASCENDING"
        }]
      };

      const searchResp = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
        method: 'POST',
        headers: hsHeaders,
        body: JSON.stringify(searchPayload)
      });

      if (!searchResp.ok) {
        throw new Error(`HubSpot API search failed: ${await searchResp.text()}`);
      }

      const searchData = await searchResp.json();
      const results = searchData.results || [];

      if (results.length === 0 && lastSeenNumber === 0) {
        const result = `${prefix}-001`;
        logger.log(`No existing dealer numbers found. Starting fresh at: ${result}`);
        return { statusCode: 200, headers, body: JSON.stringify({ dealerNumber: result }) };
      }

      for (const company of results) {
        const currentNum = parseInt(company.properties.dealer_number.split('-')[1], 10);

        if (currentNum > lastSeenNumber + 1) {
          const smallestUnused = lastSeenNumber + 1;
          const result = `${prefix}-${String(smallestUnused).padStart(3, '0')}`;
          logger.log(`Found available number (gap in page): ${result}`);
          return { statusCode: 200, headers, body: JSON.stringify({ dealerNumber: result }) };
        }

        lastSeenNumber = currentNum;
      }

      if (results.length < PAGE_LIMIT) break;

      after = searchData.paging?.next?.after;
      
      if (after) await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));

    } while (after);

    const nextNum = lastSeenNumber + 1;
    
    if (nextNum <= MAX_DEALER_NUMBER) {
      const result = `${prefix}-${String(nextNum).padStart(3, '0')}`;
      logger.log(`Found available number (end of all results): ${result}`);
      return { statusCode: 200, headers, body: JSON.stringify({ dealerNumber: result }) };

    } else {
      logger.log(`All numbers up to ${MAX_DEALER_NUMBER} are in use for prefix '${prefix}'.`);
      return { statusCode: 409, headers, body: JSON.stringify({ error: `All dealer numbers for prefix '${prefix}' are in use.` }) };
    }

  } catch (error) {
    logger.error('Function execution failed:', error.stack || error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'An internal server error occurred.' }) };
  }
};