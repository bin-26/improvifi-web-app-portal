const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ======================     LOGGING CONTROL     ======================
const isTestingMode = process.env.TESTING === 'true';

const logger = {
  log: isTestingMode ? console.log : () => {},
  error: isTestingMode ? console.error : () => {},
};
// =====================================================================

// =======================     CONFIGURATION     =======================
const outputToHubspotMap = {
  qr1: 'slice_by_fnbo',
  qr2: 'eclipse',
  qr3: 'improvifi_secured',
  qr4: 'improvifi_prime',
  qr5: 'personal_loan',
  qr6: 'fini_funding',
  qr7: 'aven',
  link1: 'improvifi_lending',
  link2: 'foundation',
  formLink: 'automations_form'
};
// =====================================================================

/* Helper to extract and format data from HubSpot properties using the map. */
function extractHubSpotProperties(properties) {
  const data = { qrCodes: {}, links: {}, formLink: null };
  if (!properties) return data;

  const getUrl = propValue => {
    if (propValue && Array.isArray(propValue) && propValue.length > 0 && propValue[0].url) return propValue[0].url;
    if (propValue && typeof propValue === 'string') return propValue;
    return null;
  };

  // Process QR codes
  for (let i = 1; i <= 7; i++) {
    const outputKey = `qr${i}`;
    const hubspotPropName = outputToHubspotMap[outputKey];
    if (hubspotPropName && properties[hubspotPropName]) {
      const url = getUrl(properties[hubspotPropName]);
      if (url) data.qrCodes[outputKey] = url;
    }
  }

  // Process links
  data.links.link1 = getUrl(properties[outputToHubspotMap.link1]);
  data.links.link2 = getUrl(properties[outputToHubspotMap.link2]);

  // Process the form link
  data.formLink = getUrl(properties[outputToHubspotMap.formLink]);

  return data;
}

export default async (request, context) => {

  const origin = isTestingMode ? '*' : 'https://www.improvifi.app';

  const corsHeaders = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  if (request.method === 'OPTIONS') return new Response('', { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

  try {
    const body = await request.json();
    const { email } = body;
    
    if (!email) {
      logger.error('Email is required but not provided in request body.');
      return new Response(JSON.stringify({ error: 'Email is required' }), { status: 400, headers: corsHeaders });
    }

    const API_KEY = process.env.HUBSPOT_API_KEY;
    
    if (!API_KEY) {
      logger.error('HUBSPOT_API_KEY is not set in environment variables.');
      return new Response(JSON.stringify({ error: 'Server configuration error: API Key missing.' }), { status: 500, headers: corsHeaders });
    }
    
    const hubspotApiHeaders = {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    };

    // ================================   Find Contact ID by Email   ================================
    logger.log(`STEP 1: Attempting to find contact ID for email: ${email}`);

    const contactSearchPayload = {
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
      properties: ['firstname', 'lastname']
    };

    logger.log(`Attempting to lookup contact with email: ${email}`);

    const contactSearchResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers: hubspotApiHeaders,
      body: JSON.stringify(contactSearchPayload)
    });

    if (!contactSearchResponse.ok) {
      const errorText = await contactSearchResponse.text();
      logger.error(`HubSpot API error for email ${email}: Status ${contactSearchResponse.status}, Response: ${errorText}`);
      throw new Error(`HubSpot API error: ${contactSearchResponse.status}. Details: ${errorText}`);
    }

    const contactSearchData = await contactSearchResponse.json();
    logger.log('Contact lookup response:', JSON.stringify(contactSearchData));
    const contact = contactSearchData.results?.[0];

    if (!contact) {
      logger.log(`No contact found for email: ${email}`);
      return new Response(JSON.stringify({ 
        error: 'no_access', 
        message: 'Account not found. Please contact your content service manager to activate your account.' 
      }), { 
        status: 404, 
        headers: corsHeaders 
      });
    }

    // Get user's name for welcome message
    const userName = contact.properties.firstname || 'User';
    const userLastName = contact.properties.lastname || '';

    // =========================   Get Contact-Company Associations Directly   ==========================
    const contactId = contact.id;
    logger.log(`STEP 2: Fetching associations directly for contact ID: ${contactId}`);
    
    const directContactResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?associations=company`, {
      method: 'GET',
      headers: hubspotApiHeaders
    });

    if (!directContactResponse.ok) {
        const errorText = await directContactResponse.text();
        logger.error(`HubSpot API direct GET error for contact ID ${contactId}: Status ${directContactResponse.status}, Response: ${errorText}`);
        throw new Error(`HubSpot API error: ${directContactResponse.status}. Details: ${errorText}`);
    }

    const detailedContactData = await directContactResponse.json();
    const companyId = detailedContactData.associations?.companies?.results?.[0]?.id;
    
    // Block users with no company ID
    if (!companyId) {
      logger.log(`Access denied for ${email}: contact is not associated with a company.`);
      return new Response(JSON.stringify({ 
        error: 'no_access', 
        message: 'Account not activated. Please contact your client success manager to set up your account. You can reach out to us via info@improvifi.com' 
      }), { 
        status: 403, 
        headers: corsHeaders 
      });
    }
    
    // ============================   STEP 3: Fetch Company Properties   ============================
    logger.log(`STEP 3: Fetching properties for company ID: ${companyId}`);

    const propertiesToFetch = Object.values(outputToHubspotMap);
    const propertiesQuery = propertiesToFetch
      .map(p =>`properties=${encodeURIComponent(p)}`)
      .join('&');

    const companyResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${companyId}?${propertiesQuery}`, {
      headers: hubspotApiHeaders
    });
    
    if(!companyResponse.ok) {
      const errorText = await companyResponse.text();
      logger.error(`HubSpot Company lookup failed for ID ${companyId}: ${companyResponse.status} ${errorText}`);
      throw new Error(`HubSpot API error during company lookup.`);
    }

    const company = await companyResponse.json();
    const responseData = extractHubSpotProperties(company.properties);

    return new Response(JSON.stringify({
      userName,
      userLastName,
      ...responseData
    }), { status: 200, headers: corsHeaders });

    
  } catch (error) {
    logger.error('Function execution caught an error:', error.stack || error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
};