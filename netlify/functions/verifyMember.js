import memberstackAdmin from "@memberstack/admin";

function getCookie(cookieString, name) {
  if (!cookieString) return null;
  const nameEQ = `${name}=`;
  const parts = cookieString.split(';');
  for (let i = 0; i < parts.length; i++) {
    let c = parts[i].trim();
    if (c.indexOf(nameEQ) === 0) {
      return c.substring(nameEQ.length);
    }
  }
  return null;
}

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
  if (h.startsWith('Bearer ')) { token = h.slice('Bearer '.length); }

  if (!token) {
    return { error: { status: 401, body: { error: "unauthorized", message: "Missing Memberstack cookie" } } };
  }

  logger.log('verifyToken start', {
    appId: process.env.MEMBERSTACK_APP_ID,
    secretPresent: !!process.env.MEMBERSTACK_SECRET,
    tokenSample: token?.slice(0, 20) + '...'
  });

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

  const { data: verified } = await MEMBERSTACK.verifyToken({
    token,
    audience: process.env.MEMBERSTACK_APP_ID
  });

  const member = verified?.member || verified;
  if (!member?.id) {
    return { error: { status: 403, body: { error: 'invalid_token', message: 'Invalid token' } } };
  }

  return { member: { id: member.id, email: member.email || null } };
}