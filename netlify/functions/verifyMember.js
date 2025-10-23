import memberstackAdmin from "@memberstack/admin";

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

  const auth = headers.authorization || headers.Authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return { error: { status: 401, body: { error: "Missing token" } } };
  }

  const token = auth.slice("Bearer ".length);

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