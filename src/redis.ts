import Redis from 'ioredis';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const redisPassword = process.env.REDIS_PASSWORD || undefined;

export const redis = new Redis({
  host: redisHost,
  port: redisPort,
  password: redisPassword,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3
});

redis.on('connect', () => {
  console.log('✅ Connected to Redis');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

export async function testRedisConnection(): Promise<void> {
  try {
    await redis.ping();
    console.log('✅ Redis connection test successful');
  } catch (err) {
    console.error('❌ Redis connection test failed:', err);
    throw err;
  }
}

// Peer registry key patterns
export const PEER_KEY = (manifestId: string, peerId: string) => `peer:${manifestId}:${peerId}`;
export const PEERS_SET_KEY = (manifestId: string) => `peers:${manifestId}`;
export const PEER_METRICS_KEY = (peerId: string) => `metrics:${peerId}`;

// Cleanup old peers periodically
export async function cleanupExpiredPeers(): Promise<void> {
  try {
    const pattern = 'peers:*';
    const keys = await redis.keys(pattern);
    
    for (const setKey of keys) {
      const members = await redis.smembers(setKey);
      for (const peerId of members) {
        const manifestId = setKey.split(':')[1];
        const peerKey = PEER_KEY(manifestId, peerId);
        const exists = await redis.exists(peerKey);
        
        if (!exists) {
          // Remove from set if peer data expired
          await redis.srem(setKey, peerId);
        }
      }
    }
  } catch (err) {
    console.error('Error cleaning up expired peers:', err);
  }
}

// Run cleanup every 60 seconds
setInterval(cleanupExpiredPeers, 60000);

