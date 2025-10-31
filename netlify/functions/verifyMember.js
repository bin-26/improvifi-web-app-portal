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

export async function requireMember(request) {
  const cookieHeader = request?.headers?.get
      ? (request.headers.get('cookie') || '')
      : (request?.headers?.cookie || '');

  const token = getCookie(cookieHeader, "_ms-mid");
  if (!token) {
    return { error: { status: 401, body: { error: "unauthorized", message: "Missing Memberstack cookie" } } };
  }

  const appAudience = process.env.MEMBERSTACK_APP_ID;
  if (!appAudience) {
    logger.error("CRITICAL: MEMBERSTACK_APP_ID is not set in environment variables.");
    return { error: {status: 500, body: { error: "server_config", message: "Server configuration error" } } };
  }

  try {
    const { data: verified } = await MEMBERSTACK_SECRET.verifyToken({ 
        token,
        audience: appAudience
    });

    const member = verified?.member || verified;

    if (!member?.id) {
      return { error: { status: 403, body: { error: "Invalid token", message: "Invalid token" } } };
    }

    return { member: { id: member.id, email: member.email || null } };
  } catch (e) {
    logger.error("Token verification failed: ", e.message);
    return { error: { status: 403, body: { error: "Invalid token", message: "Invalid token" } } };
  }
}