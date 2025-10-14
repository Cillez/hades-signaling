import express from 'express';
import { redis, PEER_KEY, PEERS_SET_KEY } from '../redis.js';
import { scorePeer, sortPeersByScore } from '../services/peer-scoring.js';
import { generateTurnCredentials } from '../services/turn-credentials.js';
import type { AuthRequest } from '../middleware/auth.js';
import type {
  AnnounceRequest,
  AnnounceResponse,
  GetPeersRequest,
  GetPeersResponse,
  CompleteRequest,
  TurnCredentialsResponse,
  PeerData,
  PeerInfo
} from '../types.js';

const router = express.Router();

const PEER_TTL = parseInt(process.env.PEER_TTL || '300', 10); // 5 minutes
const MAX_PEERS_RESPONSE = parseInt(process.env.MAX_PEERS_RESPONSE || '6', 10);

// POST /announce - Register/update peer presence
router.post('/announce', async (req: AuthRequest, res) => {
  try {
    const {
      clientId,
      manifestId,
      chunkBitfield,
      upCap,
      region,
      rttHint,
      version
    } = req.body as AnnounceRequest;

    // Validation
    if (!clientId || !manifestId || !chunkBitfield) {
      console.error('[Announce] Validation failed:', { 
        hasClientId: !!clientId, 
        hasManifestId: !!manifestId, 
        hasChunkBitfield: !!chunkBitfield
      });
      return res.status(400).json({ error: 'Missing required fields', details: { clientId: !!clientId, manifestId: !!manifestId, chunkBitfield: !!chunkBitfield } });
    }

    const peerId = clientId;
    const peerKey = PEER_KEY(manifestId, peerId);
    const peersSetKey = PEERS_SET_KEY(manifestId);

    // Store peer data
    const peerData: PeerData = {
      peerId,
      manifestId,
      chunkBitfield,
      upCap: upCap || 0,
      region,
      rttHint,
      version,
      lastSeen: Date.now(),
      isComplete: false
    };

    // Store peer data with TTL
    await redis.setex(peerKey, PEER_TTL, JSON.stringify(peerData));
    await redis.sadd(peersSetKey, peerId);
    
    // Set or extend expiry on the peers set
    // Use max TTL of current and new to avoid premature expiry
    const currentTTL = await redis.ttl(peersSetKey);
    const newTTL = PEER_TTL;
    if (currentTTL === -1 || currentTTL < newTTL) {
      await redis.expire(peersSetKey, newTTL);
    }

    const response: AnnounceResponse = {
      success: true,
      peerId,
      ttl: PEER_TTL
    };

    res.json(response);
  } catch (err) {
    console.error('Announce error:', err);
    res.status(500).json({ error: 'Failed to announce' });
  }
});

// POST /peers - Get list of peers for a manifest
router.post('/peers', async (req: AuthRequest, res) => {
  try {
    const {
      manifestId,
      neededChunks,
      region,
      excludePeers = []
    } = req.body as GetPeersRequest;

    console.log(`[Peers] Request for manifest: ${manifestId}, needed chunks: ${neededChunks?.slice(0, 5)}, region: ${region}`);

    if (!manifestId || !neededChunks) {
      console.error('[Peers] Missing required fields');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const peersSetKey = PEERS_SET_KEY(manifestId);
    const peerIds = await redis.smembers(peersSetKey);

    console.log(`[Peers] Found ${peerIds.length} registered peers for ${manifestId}:`, peerIds);

    if (peerIds.length === 0) {
      console.log('[Peers] No peers registered, returning empty list');
      const response: GetPeersResponse = {
        peers: [],
        count: 0
      };
      return res.json(response);
    }

    // Fetch peer data and clean up expired peers from the set
    const peerDataPromises = peerIds
      .filter(pid => !excludePeers.includes(pid))
      .map(async (peerId) => {
        const peerKey = PEER_KEY(manifestId, peerId);
        const data = await redis.get(peerKey);
        if (data) {
          return JSON.parse(data) as PeerData;
        }
        // Peer key expired, remove from set
        await redis.srem(peersSetKey, peerId);
        return null;
      });

    const peersData = (await Promise.all(peerDataPromises)).filter(
      (p): p is PeerData => p !== null
    );

    // Score and sort peers
    const scores = peersData.map(peer => scorePeer(peer, neededChunks, region));
    const sortedScores = sortPeersByScore(scores);

    console.log(`[Peers] Scored ${scores.length} peers:`, scores.map(s => ({
      id: s.peerId,
      score: s.score,
      hasNeeded: s.hasNeeded
    })));

    // Return top N peers
    const topPeers = sortedScores.slice(0, MAX_PEERS_RESPONSE);
    
    const peers = topPeers.map(scored => {
      const peer = peersData.find(p => p.peerId === scored.peerId)!;
      return {
        peerId: peer.peerId,
        chunkBitfield: peer.chunkBitfield,
        region: peer.region,
        score: scored.score
      };
    });

    console.log(`[Peers] Returning ${peers.length} top peers`);

    const response: GetPeersResponse = {
      peers,
      count: peers.length
    };

    res.json(response);
  } catch (err) {
    console.error('Get peers error:', err);
    res.status(500).json({ error: 'Failed to get peers' });
  }
});

// POST /complete - Mark peer as complete seeder
router.post('/complete', async (req: AuthRequest, res) => {
  try {
    const { clientId, manifestId } = req.body as CompleteRequest;

    if (!clientId || !manifestId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const peerId = clientId;
    const peerKey = PEER_KEY(manifestId, peerId);

    // Update peer data to mark as complete
    const data = await redis.get(peerKey);
    if (!data) {
      return res.status(404).json({ error: 'Peer not found' });
    }

    const peerData = JSON.parse(data) as PeerData;
    peerData.isComplete = true;
    peerData.lastSeen = Date.now();

    await redis.setex(peerKey, PEER_TTL, JSON.stringify(peerData));

    res.json({ success: true });
  } catch (err) {
    console.error('Complete error:', err);
    res.status(500).json({ error: 'Failed to mark complete' });
  }
});

// GET /turn - Get TURN credentials
router.get('/turn', async (req: AuthRequest, res) => {
  try {
    const username = req.user?.username || req.user?.userId?.toString() || 'anonymous';
    const credentials = generateTurnCredentials(username, 3600);

    const response: TurnCredentialsResponse = {
      ...credentials
    };

    res.json(response);
  } catch (err) {
    console.error('TURN credentials error:', err);
    res.status(500).json({ error: 'Failed to generate TURN credentials' });
  }
});

// POST /signal - WebRTC signaling relay
router.post('/signal', async (req: AuthRequest, res) => {
  try {
    const { type, to, data } = req.body;
    const from = req.user?.userId || req.user?.username || 'unknown';

    if (!type || !to) {
      console.error('[Signal] Validation failed:', { hasType: !!type, hasTo: !!to });
      return res.status(400).json({ error: 'Missing required fields: type, to' });
    }

    if (!['offer', 'answer', 'ice-candidate'].includes(type)) {
      console.error('[Signal] Invalid signal type:', type);
      return res.status(400).json({ error: 'Invalid signal type', type });
    }

    // Store signal in Redis with TTL for recipient to pick up
    const signalKey = `signal:${to}:${from}:${Date.now()}`;
    const signal = JSON.stringify({
      type,
      from,
      to,
      data,
      timestamp: Date.now()
    });

    await redis.setex(signalKey, 30, signal); // 30 second TTL

    res.json({ success: true, message: 'Signal queued for delivery' });
  } catch (err) {
    console.error('Signal error:', err);
    res.status(500).json({ error: 'Failed to relay signal' });
  }
});

// GET /signals/:clientId - Poll for pending signals for a specific client
router.get('/signals/:clientId', async (req: AuthRequest, res) => {
  try {
    const { clientId } = req.params;
    
    if (!clientId) {
      return res.status(400).json({ error: 'clientId required' });
    }

    // Get all signals for this client
    const pattern = `signal:${clientId}:*`;
    const keys = await redis.keys(pattern);
    
    const signals = [];
    for (const key of keys) {
      const signalData = await redis.get(key);
      if (signalData) {
        signals.push(JSON.parse(signalData));
        // Delete after retrieval
        await redis.del(key);
      }
    }

    res.json({ signals });
  } catch (err) {
    console.error('Get signals error:', err);
    res.status(500).json({ error: 'Failed to get signals' });
  }
});

// GET /health
router.get('/health', async (_req, res) => {
  try {
    await redis.ping();
    res.json({ 
      status: 'ok',
      redis: 'connected',
      timestamp: Date.now()
    });
  } catch (err) {
    res.status(503).json({ 
      status: 'error',
      redis: 'disconnected',
      error: (err as Error).message
    });
  }
});

// GET /metrics - Prometheus-compatible metrics
router.get('/metrics', async (_req, res) => {
  try {
    const manifestKeys = await redis.keys('peers:*');
    const totalManifests = manifestKeys.length;
    
    let totalPeers = 0;
    for (const key of manifestKeys) {
      const count = await redis.scard(key);
      totalPeers += count;
    }

    const metrics = `# HELP signaling_manifests_total Total number of active manifests
# TYPE signaling_manifests_total gauge
signaling_manifests_total ${totalManifests}

# HELP signaling_peers_total Total number of active peers
# TYPE signaling_peers_total gauge
signaling_peers_total ${totalPeers}

# HELP signaling_uptime_seconds Server uptime in seconds
# TYPE signaling_uptime_seconds counter
signaling_uptime_seconds ${process.uptime()}
`;

    res.setHeader('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (err) {
    console.error('Metrics error:', err);
    res.status(500).send('# Error generating metrics');
  }
});

export default router;

