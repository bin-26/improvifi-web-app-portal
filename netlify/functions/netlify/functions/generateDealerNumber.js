const sendResponse = (statusCode, body) => {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.URL,
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    }
  });
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
    
    let allUsedDealerNumbersForPrefix = [];
    let after = null;

    // --- 3. Efficiently fetch ALL existing dealer numbers for this prefix ---
    do {
      const searchPayload = {
        after: after,
        limit: 100,
        properties: ['dealer_number'],
        filterGroups: [{
          filters: [{
            propertyName: 'dealer_number',
            operator: 'STARTS_WITH',
            value: `${prefix}-`
          }]
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
      
      if (searchData.results && searchData.results.length > 0) {
        const usedNumbersInBatch = searchData.results
          .map(company => {
            const dealerNum = company.properties.dealer_number;
            const match = dealerNum.match(new RegExp(`^${prefix}-(\\d{3})$`));
            return match ? parseInt(match[1], 10) : null;
          })
          .filter(num => num !== null);
        
        allUsedDealerNumbersForPrefix.push(...usedNumbersInBatch);
      }
      
      after = searchData.paging?.next?.after;
    } while (after);

    // --- 4. Find the smallest available number locally --- 
    allUsedDealerNumbersForPrefix.sort((a, b) => a - b);

    let nextAvailableNumber = 1;
    const MAX_DEALER_NUMBER = 999;

    for (const usedNum of allUsedDealerNumbersForPrefix) {
      if (usedNum === nextAvailableNumber) nextAvailableNumber++;
      else if (usedNum > nextAvailableNumber) break;
    }

    // --- 5. Format and return the result ---
    if (nextAvailableNumber <= MAX_DEALER_NUMBER) {
      const formattedNumber = String(nextAvailableNumber).padStart(3, '0');
      const uniqueDealerNumber = `${prefix}-${formattedNumber}`;
      logger.log(`Found available number: ${uniqueDealerNumber}`);
      return sendResponse(200, { dealerNumber: uniqueDealerNumber });
    } else return sendResponse(409, { error: `All dealer numbers for prefix '${prefix}' are currently in use (up to ${MAX_DEALER_NUMBER}).` });

  } catch (error) {
    logger.error('Function execution failed:', error.stack || error);
    return sendResponse(500, { error: 'An internal server error occurred.' });
  }
};