import memberstackAdmin from "@memberstack/admin";

// ======================     LOGGING CONTROL     ======================
const isTestingMode = process.env.TESTING === 'true';

const logger = {
  log: isTestingMode ? console.log : () => {},
  error: isTestingMode ? console.error : () => {},
};
// =====================================================================

const MEMBERSTACK = memberstackAdmin.init(process.env.MEMBERSTACK_SECRET);

export async function requireMember(request) {
  
  const h =
    request?.headers?.get?.('authorization') ||
    request?.headers?.get?.('Authorization') ||
    request?.headers?.authorization ||
    request?.headers?.Authorization ||
    '';
  
  let token = null;
  if (h.startsWith('Bearer ')) token = h.slice('Bearer '.length).trim();

  if (!token) {
    return {
      error: {
        status: 401,
        body: { error: "unauthorized", message: "Missing Memberstack cookie" } 
      } 
    };
  }

  logger.log('verifyToken start', {
    appId: process.env.MEMBERSTACK_APP_ID,
    secretPresent: !!process.env.MEMBERSTACK_SECRET,
    tokenSample: token?.slice(0, 20) + '...'
  });

  if (isTestingMode) {
    try {
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      logger.log('token.claims', {
        aud: payload.aud,
        iss: payload.iss,
        sub: payload.sub || payload.member?.id,
        email: payload.member?.email,
        exp: payload.exp, iat: payload.iat,
        expISO: new Date(payload.exp * 1000).toISOString(),
        iatISO: new Date(payload.iat * 1000).toISOString()
      });

    } catch (e) {
      logger.error('Failed to decode token payload:', e?.message || e);
    }
  }

  try {
    const { data: verified } = await MEMBERSTACK.verifyToken({
      token,
      audience: process.env.MEMBERSTACK_APP_ID
    });

    const v = verified?.data || verified || {};
    const memberId = v.id || v.memberId || v.userId || v?.member?.id || null;

    if (!memberId) {
      logger.error('Verified token but missing member id in response/payload', { 
        keys: Object.keys(verified || {}) 
      });
      return {
        error: {
          status: 403,
          body: { error: "invalid_token", message: "Verified token but no member id" }
        }
      };
    }

    let email = null;
    try {
      const res = await MEMBERSTACK.members.retrieve({ id: memberId });
      email = res?.data?.auth?.email || res?.data?.email || null;
    } catch (e) {
      logger.log("members.retrieve failed; continuing with id only:", e?.message || e);
    }

    return { member: { id: memberId, email } };

  } catch (err) {
    logger.error("Token verification failed:", err?.response || err?.message || err);
    return {
      error: {
        status: 403,
        body: { error: "invalid_token", message: "Invalid or expired token" }
      } 
    };
  }
}