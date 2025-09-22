const sendResponse = (statusCode, body) => {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' }
  });
};

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
    // 1. Search for the company by dealer_number
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

    // 2. Get association types (labels) for contact→company
    const assocTypesResp = await fetch('https://api.hubapi.com/crm/v4/associations/CONTACTS/COMPANIES/labels', {
      method: 'GET',
      headers: hsHeaders
    });

    if (!assocTypesResp.ok) {
      const errorText = await assocTypesResp.text();
      throw new Error(`Failed to fetch association types: ${errorText}`);
    }

    const assocTypesData = await assocTypesResp.json();
    const primaryAssocType = assocTypesData.results.find(
      t =>t.name && t.name.toLowerCase().includes('primary')
    );

    if (!primaryAssocType) {
      throw new Error('Could not find Primary association type ID for contacts → companies');
    }

    // 3. Set the primary association
    const associationResp = await fetch('https://api.hubapi.com/crm/v4/associations/CONTACTS/COMPANIES/batch/create', {
      method: 'POST',
      headers: hsHeaders,
      body: JSON.stringify({
        inputs: [
          {
            from: { id: contactId },
            to: { id: companyId },
            type: primaryAssocType.id
          }
        ]
      })
    });

    if (!associationResp.ok) {
      const errorText = await associationResp.text();
      throw new Error(`HubSpot Primary Association API failed: ${errorText}`);
    }

    return sendResponse(200, { 
      status: 'Success', 
      message: `Successfully set Company ${companyId} as Primary for Contact ${contactId}.` 
    });

  } catch (error) {
    console.error(error);
    return sendResponse(500, { error: error.message });
  }
};