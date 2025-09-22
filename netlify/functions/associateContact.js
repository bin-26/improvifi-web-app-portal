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
  const secretKey = process.env.HUBSPOT_WEBHOOK_SECRET;
  const headerSecret = request.headers.get('x-hubspot-secret');

  if (!headerSecret || headerSecret.trim() !== secretKey.trim()) {
    return sendResponse(401, { error: 'Unauthorized' });
  }

  const body = await request.json();
  const event = body[0];

  const contactId = event.objectId;
  const contactDealerNumber = event.properties.dealer_number;

  if (!contactId || !contactDealerNumber) {
    return sendResponse(400, { 
      error: 'Missing contactId or dealer_number in webhook payload' 
    });
  }

  const token = process.env.HUBSPOT_API_KEY;
  if (!token) {
    return sendResponse(500, { error: 'Server configuration error: HubSpot token missing' });
  }
  
  const hsHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  try {
    const searchPayload = {
      filterGroups: [{
        filters: [{
          propertyName: 'dealer_number',
          operator: 'EQ',
          value: contactDealerNumber
        }]
      }],
      properties: ['dealer_number'],
      limit: 1
    };

    logger.log(`Searching company with dealer_number: ${contactDealerNumber}`);
    const companySearchResp = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
      method: 'POST',
      headers: hsHeaders,
      body: JSON.stringify(searchPayload)
    });

    if (!companySearchResp.ok) {
      const errorText = await companySearchResp.text();
      logger.error(`Company search failed: ${errorText}`);
      throw new Error(`HubSpot Company Search API failed: ${errorText}`);
    }

    const companyData = await companySearchResp.json();
    logger.log('Company search result:', JSON.stringify(companyData));
    const company = companyData.results[0];

    if (!company) {
      return sendResponse(200, { 
        status: 'No Action', 
        message: `No company found with Dealer Number: ${contactDealerNumber}. Contact ${contactId} was not associated.` 
      });
    }

    const companyId = company.id;
    logger.log(`Company found: ${companyId}`);

    const PRIMARY_ASSOCIATION_TYPE_ID = 1;

    const associationUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/companies/${companyId}/${PRIMARY_ASSOCIATION_TYPE_ID}`;
    logger.log(`Associating contact ${contactId} with company ${companyId} as PRIMARY`);

    const associationResp = await fetch(associationUrl, {
      method: 'PUT',
      headers: hsHeaders
    });

    if (!associationResp.ok) {
      const errorText = await associationResp.text();
      logger.error(`Association call failed: ${errorText}`);
      throw new Error(`HubSpot Primary Association API failed: ${errorText}`);
    }

    let verification = null;
    if (isTestingMode) {
      const verifyUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?associations=companies`;
      const verifyResp = await fetch(verifyUrl, { headers: hsHeaders });

      if (verifyResp.ok) {
        verification = await verifyResp.json();
        logger.log('Verification result (contact associations):', JSON.stringify(verification));
      } else {
        const errorText = await verifyResp.text();
        logger.error(`Verification failed: ${errorText}`);
      }
    }

    return sendResponse(200, { 
      status: 'Success', 
      message: `Successfully set Company ${companyId} as Primary for Contact ${contactId}.`,
      verification
    });

  } catch (error) {
    console.error(error);
    return sendResponse(500, { error: error.message });
  }
};