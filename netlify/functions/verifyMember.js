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

const MEMBERSTACK_SECRET = memberstackAdmin.init(process.env.MEMBERSTACK_SECRET);

export async function requireMember(eventOrRequest) {
  const headers =
    eventOrRequest?.headers?.get
      ? Object.fromEntries(eventOrRequest.headers)
      : eventOrRequest.headers || {};

  const token = getCookie(headers.cookie, "_ms-mid"); 

  if (!token) {
    return { error: { status: 401, body: { error: "Missing authentication cookie" } } };
  }

  const appAudience = process.env.MEMBERSTACK_APP_ID;

  if (!appAudience) {
    logger.error("CRITICAL: MEMBERSTACK_APP_ID is not set in environment variables.");
    return { error: {status: 500, body: { error: "Server configuration error" } } };
  }

  try {
    const { data: verified } = await MEMBERSTACK_SECRET.verifyToken({ 
        token,
        audience: appAudience
    });

    const member = verified?.member;
    if (!member?.id) {
      return { error: { status: 403, body: { error: "Invalid token" } } };
    }
    return { member };
  } catch (e) {
    logger.error("Token verification failed: ", e.message);
    return { error: { status: 403, body: { error: "Invalid token" } } };
  }
}