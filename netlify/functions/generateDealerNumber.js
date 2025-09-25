const sendResponse = (statusCode, body) => {
  return {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.URL,
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    },
    body: body ? JSON.stringify(body) : ''
  };
};

// ======================     LOGGING CONTROL     ======================
const isTestingMode = process.env.TESTING === 'true';

const logger = {
  log: isTestingMode ? console.log : () => {},
  error: isTestingMode ? console.error : () => {},
};
// =====================================================================

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') { return sendResponse(204, null); }

  // --- 1. Security Check ---
  const providedApiKey = event.headers['x-api-key'];
  const serverApiKey = process.env.GENERATOR_KEY;

  if (!providedApiKey || providedApiKey !== serverApiKey) {
    logger.error('Unauthorized access attempt to generateDealerNumber.');
    return sendResponse(401, { error: 'Unauthorized' });
  }

  const token = process.env.HUBSPOT_API_KEY;

  if (!token) {
    logger.error('Server configuration error: HubSpot token missing.');
    return sendResponse(500, { error: 'Server configuration error: HubSpot token missing.' });
  }
  
  const hsHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  try {
    const { prefix } = JSON.parse(event.body);

    // --- 2. Input Validation ---
    const allowedPrefixes = ['01', '02', '03', '04'];
    if (!prefix || !allowedPrefixes.includes(prefix)) {
      return sendResponse(400, { error: 'Invalid or missing prefix. Must be one of: 01, 02, 03, 04.' });
    }

    logger.log(`Searching for the smallest available dealer number with prefix: ${prefix}`);

    // --- 3. Efficiently fetch ALL existing dealer numbers for this prefix ---

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
        filterGroups: [{
          filters: [{
            propertyName: 'dealer_number',
            operator: 'IN',
            values: batchOfNumbersToTest
          }]
        }],
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

      await new Promise (resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }

    // --- 4. Find the smallest available number locally --- 
    for (let i = 1; i <= MAX_DEALER_NUMBER; i++) {
      const numberPart = String(i).padStart(3, '0');
      const dealerNumberToTest = `${prefix}-${numberPart}`;

      if (!usedNumbers.has(dealerNumberToTest)) {
        logger.log(`Found available number: ${dealerNumberToTest}`);
        return sendResponse(200, { dealerNumber: dealerNumberToTest });
      }
    }

    // --- 5. If the loop completes, all numbers are taken ---
    return sendResponse(409, { error: `All dealer numbers for prefix '${prefix}' are in use.` });

  } catch (error) {
    logger.error('Function execution failed:', error.stack || error);
    return sendResponse(500, { error: 'An internal server error occurred.' });
  }
};