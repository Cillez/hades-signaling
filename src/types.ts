/**
 * P2P and WebRTC related types (copied from hades-shared)
 */

// Peer data stored in registry
export interface PeerData {
  peerId: string;
  manifestId: string;
  chunkBitfield: string; // Hex-encoded bitfield
  upCap: number; // Upload capacity in bytes/sec
  region?: string;
  rttHint?: number; // RTT hint in ms
  version?: string;
  lastSeen: number;
  isComplete: boolean;
}

// Peer info returned to clients
export interface PeerInfo {
  peerId: string;
  chunkBitfield: string;
  region?: string;
  score: number;
}

// Peer scoring result
export interface PeerScore {
  peerId: string;
  score: number;
  factors: Record<string, number>;
  hasNeeded: boolean;
}

// Announce request
export interface AnnounceRequest {
  clientId: string;
  manifestId: string;
  chunkBitfield: string;
  upCap?: number;
  region?: string;
  rttHint?: number;
  version?: string;
}

// Announce response
export interface AnnounceResponse {
  success: boolean;
  peerId: string;
  ttl: number;
}

// Get peers request
export interface GetPeersRequest {
  manifestId: string;
  neededChunks: number[];
  region?: string;
  excludePeers?: string[];
}

// Get peers response
export interface GetPeersResponse {
  peers: PeerInfo[];
  count: number;
}

// Complete request
export interface CompleteRequest {
  clientId: string;
  manifestId: string;
}

// TURN credentials
export interface TurnCredentialsResponse {
  username: string;
  password: string;
  ttl: number;
  uris: string[];
}

