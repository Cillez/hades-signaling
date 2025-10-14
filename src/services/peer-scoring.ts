import type { PeerData, PeerScore } from 'hades-shared';

/**
 * Score peers based on multiple factors:
 * - Has needed chunks (highest priority)
 * - Low latency / same region
 * - Reliability (successful transfers)
 * - Low load (available upload slots)
 */
export function scorePeer(
  peer: PeerData,
  neededChunks: number[],
  requesterRegion?: string
): PeerScore {
  let score = 0;
  const factors: Record<string, number> = {};

  // Factor 1: Has needed chunks (0-100 points)
  const hasNeeded = hasNeededChunks(peer.chunkBitfield, neededChunks);
  const neededScore = hasNeeded ? 100 : 0;
  score += neededScore;
  factors.hasNeeded = neededScore;

  // Factor 2: Region match (0-30 points)
  let regionScore = 0;
  if (requesterRegion && peer.region === requesterRegion) {
    regionScore = 30;
  } else if (peer.region) {
    regionScore = 10; // Has region info but doesn't match
  }
  score += regionScore;
  factors.region = regionScore;

  // Factor 3: Low latency (0-30 points)
  const latencyScore = calculateLatencyScore(peer.rttHint || 999);
  score += latencyScore;
  factors.latency = latencyScore;

  // Factor 4: Upload capacity (0-20 points)
  const capacityScore = Math.min((peer.upCap || 0) / 1024 / 1024, 20); // MB/s -> score
  score += capacityScore;
  factors.capacity = capacityScore;

  // Factor 5: Completion bonus (0-20 points)
  const completionScore = peer.isComplete ? 20 : 0;
  score += completionScore;
  factors.completion = completionScore;

  return {
    peerId: peer.peerId,
    score,
    factors,
    hasNeeded
  };
}

function hasNeededChunks(bitfield: string, neededChunks: number[]): boolean {
  if (!bitfield || neededChunks.length === 0) return false;
  
  // Bitfield is hex string, decode and check
  const bytes = Buffer.from(bitfield, 'hex');
  
  for (const chunkIndex of neededChunks) {
    const byteIndex = Math.floor(chunkIndex / 8);
    const bitIndex = chunkIndex % 8;
    
    if (byteIndex < bytes.length) {
      const byte = bytes[byteIndex];
      const hasBit = (byte & (1 << bitIndex)) !== 0;
      if (hasBit) {
        return true; // At least one needed chunk is available
      }
    }
  }
  
  return false;
}

function calculateLatencyScore(rtt: number): number {
  // Lower RTT = higher score
  // <50ms = 30 points
  // 50-100ms = 20 points
  // 100-200ms = 10 points
  // >200ms = 5 points
  if (rtt < 50) return 30;
  if (rtt < 100) return 20;
  if (rtt < 200) return 10;
  return 5;
}

/**
 * Sort peers by score (highest first)
 */
export function sortPeersByScore(scores: PeerScore[]): PeerScore[] {
  return scores.sort((a, b) => b.score - a.score);
}

