const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const sendResponse = (statusCode, body) => {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' }
  });
};

export default async (request, context) => {
  const secretKey = process.env.HUBSPOT_WEBHOOK_SECRET;

  const headerSecret = request.headers['x-hubspot-secret'];

  console.log('Header received:', JSON.stringify(headerSecret));
  console.log('Env secret:', JSON.stringify(secretKey));

  if (!headerSecret || headerSecret.trim() !== secretKey.trim()) {
    return sendResponse(401, {
      error: 'Unauthorized',
      detail: {
        headerSecret,
        envSecret: secretKey
      }
    });
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

    const companySearchResp = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
      method: 'POST',
      headers: hsHeaders,
      body: JSON.stringify(searchPayload)
    });

    if (!companySearchResp.ok) {
      const errorText = await companySearchResp.text();
      throw new Error(`HubSpot Company Search API failed: ${errorText}`);
    }

    const companyData = await companySearchResp.json();
    const company = companyData.results[0];

    if (!company) {
      return sendResponse(200, { 
        status: 'No Action', 
        message: `No company found with Dealer Number: ${contactDealerNumber}. Contact ${contactId} was not associated.` 
      });
    }
    const companyId = company.id;

    const associationUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/company/${companyId}/contact_to_company`;
    
    const associationResp = await fetch(associationUrl, {
      method: 'PUT',
      headers: hsHeaders
    });

    if (!associationResp.ok) {
      const errorText = await associationResp.text();
      throw new Error(`HubSpot Association API failed: ${errorText}`);
    }

    return sendResponse(200, { 
      status: 'Success', 
      message: `Successfully associated Contact ${contactId} with Company ${companyId}.` 
    });

  } catch (error) {
    console.error(error);
    return sendResponse(500, { error: error.message });
  }
};