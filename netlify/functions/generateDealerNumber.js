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
    // Handle OPTIONS preflight request explicitly
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: headers,
        body: '',
      };
    }

    // --- Security and Setup ---
    const providedApiKey = event.headers['x-api-key'];
    const serverApiKey = process.env.GENERATOR_KEY;
    if (!providedApiKey || providedApiKey !== serverApiKey) {
      return {
        statusCode: 401,
        headers: headers,
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    const token = process.env.HUBSPOT_API_KEY;
    if (!token) {
      return {
        statusCode: 500,
        headers: headers,
        body: JSON.stringify({ error: 'Server configuration error: HubSpot token missing.' }),
      };
    }
    
    const hsHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    
    if (!event.body) {
      return {
        statusCode: 400,
        headers: headers,
        body: JSON.stringify({ error: 'Request body is missing.' }),
      };
    }
    const { prefix } = JSON.parse(event.body);

    const allowedPrefixes = ['01', '02', '03', '04'];
    if (!prefix || !allowedPrefixes.includes(prefix)) {
      return {
        statusCode: 400,
        headers: headers,
        body: JSON.stringify({ error: 'Invalid or missing prefix.' }),
      };
    }

    logger.log(`Searching for the smallest available dealer number with prefix: ${prefix}`);
    
    // --- Main Logic ---
    const usedNumbers = new Set();
    const BATCH_SIZE = 100;
    const MAX_DEALER_NUMBER = 999;
    const RATE_LIMIT_DELAY_MS = 300;

    for (let i = 1; i <= MAX_DEALER_NUMBER; i += BATCH_SIZE) {
      const batchOfNumbersToTest = [];
      const end = Math.min(i + BATCH_SIZE - 1, MAX_DEALER_NUMBER);
      
      for (let j = i; j <= end; j++) {
        const numberPart = String(j).padStart(3, '0');
        batchOfNumbersToTest.push(`${prefix}-${numberPart}`);
      }

      const searchPayload = {
        limit: BATCH_SIZE,
        filterGroups: [{ filters: [{ propertyName: 'dealer_number', operator: 'IN', values: batchOfNumbersToTest }] }],
        properties: ['dealer_number']
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
      if (searchData.results) {
        searchData.results.forEach(company => usedNumbers.add(company.properties.dealer_number));
      }
      
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }

    for (let i = 1; i <= MAX_DEALER_NUMBER; i++) {
      const numberPart = String(i).padStart(3, '0');
      const dealerNumberToTest = `${prefix}-${numberPart}`;

      if (!usedNumbers.has(dealerNumberToTest)) {
        logger.log(`Found available number: ${dealerNumberToTest}`);
        return {
          statusCode: 200,
          headers: headers,
          body: JSON.stringify({ dealerNumber: dealerNumberToTest }),
        };
      }
    }

    return {
      statusCode: 409,
      headers: headers,
      body: JSON.stringify({ error: `All dealer numbers for prefix '${prefix}' are in use.` }),
    };

  } catch (error) {
    logger.error('Function execution failed:', error.stack || error);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: 'An internal server error occurred.' }),
    };
  }
};