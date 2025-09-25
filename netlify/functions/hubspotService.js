// ======================     LOGGING CONTROL     ======================
const isTestingMode = process.env.TESTING === 'true';

const logger = {
  log: isTestingMode ? console.log : () => {},
  error: isTestingMode ? console.error : () => {},
};
// =====================================================================

export async function associateContactToCompanyByDealerNumber({ contactId, dealerNumber, hsHeaders }) {
  try {
    // Step 1: Find the company by its dealer number
    const searchPayload = {
      filterGroups: [{ filters: [{ propertyName: 'dealer_number', operator: 'EQ', value: dealerNumber }] }],
      limit: 1
    };
    const companySearchResp = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
      method: 'POST',
      headers: hsHeaders,
      body: JSON.stringify(searchPayload)
    });

    if (!companySearchResp.ok) {
        throw new Error(`Company search failed: ${await companySearchResp.text()}`);
    }

    const companyData = await companySearchResp.json();
    const company = companyData.results?.[0];

    if (!company) {
      logger.log(`[Service] No company found for Dealer Number ${dealerNumber}. Skipping association for contact ${contactId}.`);
      return { status: 'NO_COMPANY_FOUND' };
    }

    // Step 2: Associate the contact to the found company
    const companyId = company.id;
    const PRIMARY_ASSOCIATION_TYPE_ID = 1;
    const associationUrl = `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/companies/${companyId}/${PRIMARY_ASSOCIATION_TYPE_ID}`;
    
    const associationResp = await fetch(associationUrl, {
      method: 'PUT',
      headers: hsHeaders
    });

    if (!associationResp.ok) {
        throw new Error(`Association failed: ${await associationResp.text()}`);
    }

    logger.log(`[Service] Successfully associated contact ${contactId} with company ${companyId}.`);
    return { status: 'SUCCESS', companyId: companyId };

  } catch (error) {
    logger.error(`[Service] Error in association logic for contact ${contactId}:`, error);
    throw error;
  }
}