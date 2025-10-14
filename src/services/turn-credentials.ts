import crypto from 'crypto';

const TURN_SECRET = process.env.TURN_SECRET || '';
const TURN_URLS = process.env.TURN_URLS || 'turn:localhost:3478';
const STUN_URLS = process.env.STUN_URLS || 'stun:localhost:3478';

if (!TURN_SECRET) {
  console.warn('⚠️  TURN_SECRET not set, TURN credentials will not work');
}

/**
 * Generate time-limited TURN credentials
 * Based on coturn's REST API authentication
 */
export function generateTurnCredentials(username: string, ttl: number = 3600) {
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const turnUsername = `${timestamp}:${username}`;
  
  const hmac = crypto.createHmac('sha1', TURN_SECRET);
  hmac.update(turnUsername);
  const turnPassword = hmac.digest('base64');

  return {
    username: turnUsername,
    password: turnPassword,
    ttl,
    uris: [
      ...STUN_URLS.split(',').map(u => u.trim()),
      ...TURN_URLS.split(',').map(u => u.trim())
    ]
  };
}

