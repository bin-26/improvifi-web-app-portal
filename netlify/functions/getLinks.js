import { requireMember } from './verifyMember'

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
  link3: 'improvipay',
  formLink: 'automations_form'
};
// =====================================================================

/* Helper to extract and format data from HubSpot properties using the map. */
async function extractHubSpotProperties(properties, hubspotApiHeaders) {
  const data = { qrCodes: {}, links: {}, formLink: null };
  if (!properties) return data;

  const getUrl = async propValue => {
    //Case 1: Value is a full string. Return it directly.
    if (propValue && typeof propValue === 'string' && propValue.startsWith('http'))
      return propValue;

    //Case 2: Value is a numerical File ID string. Fetch its public URL..
    if (propValue && typeof propValue === 'string' && /^\d+$/.test(propValue)) {
      const fileId = propValue;
      logger.log(`Detected File ID: ${fileId}. Fetching its public URL...`);
      try {
        const fileResponse = await fetch(`https://api.hubapi.com/files/v3/files/${fileId}`, {
          headers: hubspotApiHeaders
        });
        if (!fileResponse.ok) {
          logger.error(`Failed to fetch file details for ID ${fileId}. Status: ${fileResponse.status}`);
          return null;
        }
        const fileData = await fileResponse.json();
        return fileData.url;
      } catch (e) {
        logger.error(`Error fetching file URL for ID ${fileId}:`, e);
        return null;
      }
    }

    //Case 3: Value is an array of file objects from certain API responses
    if (propValue && Array.isArray(propValue) && propValue.length > 0 && propValue[0].url) 
      return propValue[0].url;

    //Default
    return null;
  };

  // Process QR codes
  const qrPromises = [];

  for (let i = 1; i <= 7; i++) {
    const outputKey = `qr${i}`;
    const hubspotPropName = outputToHubspotMap[outputKey];
    if (hubspotPropName && properties[hubspotPropName]) {
      qrPromises.push(
        getUrl(properties[hubspotPropName]).then(url => {
          if (url) data.qrCodes[outputKey] = url;
        })
      );
    }
  }

  await Promise.all(qrPromises);

  const [link1, link2, link3, formLink] = await Promise.all([
    getUrl(properties[outputToHubspotMap.link1]),
    getUrl(properties[outputToHubspotMap.link2]),
    getUrl(properties[outputToHubspotMap.link3]),
    getUrl(properties[outputToHubspotMap.formLink])
  ]);

  data.links.link1 = link1;
  data.links.link2 = link2;
  data.links.link3 = link3;
  data.formLink = formLink;

  return data;
}

export default async (request, context) => {

  const allowedOrigins = isTestingMode
    ? [
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'https://improvifi.app',
        'https://www.improvifi.app'
      ]
    : ['https://improvifi.app', 'https://www.improvifi.app'];

  const reqOrigin = request.headers.get('origin') || '';
  const allowOrigin = allowedOrigins.includes(reqOrigin) ? reqOrigin : '';

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true"
  };

  if (request.method === 'OPTIONS') {
    if (!allowOrigin) {
      return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!allowOrigin) {
    return new Response(JSON.stringify({ error: 'CORS origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', Vary: 'Origin' }
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, 
      headers: corsHeaders
    });
  }

  const { member, error } = await requireMember(request);

  if (error) {
    return new Response(JSON.stringify(error.body), {
      status: error.status, 
      headers: corsHeaders
    });
  }

  const email = member.email;

  try {

    const API_KEY = process.env.HUBSPOT_API_KEY;
    
    if (!API_KEY) {
      logger.error('HUBSPOT_API_KEY is not set in environment variables.');
      return new Response(JSON.stringify({ error: 'Server configuration error: API Key missing.' }), {
        status: 500, 
        headers: corsHeaders 
      });
    }
    
    const hubspotApiHeaders = {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    };

    // ================================   Find Contact ID by Email   ================================
    logger.log(`STEP 1: Attempting to find contact ID for email: ${email}`);

    const contactSearchPayload = {
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
      properties: ['firstname', 'lastname', 'dealer_number', 'lifecyclestage', ...Object.values(outputToHubspotMap)]
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

    if (!contact.properties.dealer_number || contact.properties.lifecyclestage !== 'customer') {
      logger.log(`access denied for ${email}: contact is missing a dealer number.`);
      return new Response(JSON.stringify({
        error: 'no_access',
        message: 'Your account is not fully configured. Please contact your client success manager to complete your setup.'
      }), { status: 403, headers: corsHeaders });
    }

    const userName = contact.properties.firstname || 'User';
    const userLastName = contact.properties.lastname || '';

    const contactData = await extractHubSpotProperties(contact.properties, hubspotApiHeaders);

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
    
    // ================================   Fetch Company Properties   ================================
    logger.log(`STEP 3: Fetching properties for company ID: ${companyId}`);

    const propertiesQuery = Object.values(outputToHubspotMap)
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
    const companyData = await extractHubSpotProperties(company.properties, hubspotApiHeaders);

    const finalData = {
      qrCodes: { ...companyData.qrCodes },
      links: { ...companyData.links },
      formLink: contactData.formLink || companyData.formLink
    };

    for (const key in contactData.qrCodes) {
      if (contactData.qrCodes[key])
        finalData.qrCodes[key] = contactData.qrCodes[key];
    }

    for (const key in contactData.links) {
      if (contactData.links[key])
        finalData.links[key] = contactData.links[key];
    }

    return new Response(JSON.stringify({
      userName,
      userLastName,
      ...finalData
    }), { status: 200, headers: corsHeaders });

  } catch (error) {
    logger.error('Function execution caught an error:', error.stack || error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
};