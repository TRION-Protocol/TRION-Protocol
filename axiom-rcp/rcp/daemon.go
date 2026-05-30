// Package rcp implements the Resonance Communication Protocol (RCP) daemon.
//
// RCP routes behavioral event packets using resonance scores rather than
// network addresses. Two entities are connected if their behavioral event
// vocabulary similarity exceeds the resonance threshold (0.15).
//
// Invention #12: Resonance Communication Protocol
// See §7.7 for full mathematical specification.

package rcp

import (
	"context"
	"math"
	"sync"
	"time"

	"go.uber.org/zap"
)

const (
	// ResonanceThreshold: entities are "connected" if RCP > 0.15
	ResonanceThreshold = 0.15

	// RFVectorDim: 32-dimensional resonance frequency vector (one per UBE type)
	RFVectorDim = 32

	// SyncInterval: how often to recompute resonance scores with peers
	SyncInterval = 60 * time.Second

	// PeerDiscoveryInterval: how often to probe for new resonant peers
	PeerDiscoveryInterval = 5 * time.Minute

	// BCMonitorInterval: how often to check our own BC and update truth state
	BCMonitorInterval = 10 * time.Second
)

// Config for the RCP daemon.
type Config struct {
	AkashicURL string
	RedisURL   string
	Logger     *zap.Logger
}

// Peer represents a resonant entity known to this daemon.
type Peer struct {
	BPI            [32]byte
	RF             [RFVectorDim]float32 // Resonance frequency vector
	Resonance      float32              // Cached RCP score with local entity
	LastSeen       time.Time
	PacketCount    int64
	FailureCount   int
	GRPCAddress    string
	IsConnected    bool
}

// RCPPacket is the routing unit in the Resonance Network.
type RCPPacket struct {
	SenderBPI   [32]byte
	ReceiverBPI [32]byte
	TTL         uint8  // Decrements at each hop; packet dropped when 0
	Payload     []byte
	Timestamp   int64  // GPS nanoseconds
	SenderBC    float32
	Signature   [32]byte  // Blake3 of packet fields signed by sender BPI
}

// RCPDaemon implements the RCP routing and behavioral communication protocol.
type RCPDaemon struct {
	mu      sync.RWMutex
	config  Config
	logger  *zap.Logger

	localBPI [32]byte
	localRF  [RFVectorDim]float32
	localBC  float32
	localPsi float32

	peers map[[32]byte]*Peer

	// Routing table: targetBPI → bestNextHop BPI
	routingTable map[[32]byte][32]byte

	// Packet queue for forwarding
	packetQueue chan *RCPPacket

	// Metrics
	packetsRouted    int64
	packetsDropped   int64
	peersDiscovered  int64
}

// NewRCPDaemon creates and initializes an RCP daemon.
func NewRCPDaemon(config Config) (*RCPDaemon, error) {
	return &RCPDaemon{
		config:       config,
		logger:       config.Logger,
		peers:        make(map[[32]byte]*Peer),
		routingTable: make(map[[32]byte][32]byte),
		packetQueue:  make(chan *RCPPacket, 10000),
		localBC:      0.8,
		localPsi:     0.55,
	}, nil
}

// ComputeResonance computes RCP(local, peer) — cosine similarity of RF vectors.
//
// Formula: RCP(Eᵢ, Eⱼ) = cos(RF(Eᵢ), RF(Eⱼ)) = RF(Eᵢ)·RF(Eⱼ) / (|RF(Eᵢ)|·|RF(Eⱼ)|)
func (d *RCPDaemon) ComputeResonance(peerBPI [32]byte) float32 {
	d.mu.RLock()
	peer, ok := d.peers[peerBPI]
	d.mu.RUnlock()
	if !ok {
		return 0
	}
	return cosineSimilarity(d.localRF[:], peer.RF[:])
}

// ComputeResonanceBetween computes RCP between two RF vectors.
func ComputeResonanceBetween(rfA, rfB [RFVectorDim]float32) float32 {
	return cosineSimilarity(rfA[:], rfB[:])
}

// IsResonant returns true if RCP(local, peer) > ResonanceThreshold.
// Resonance IS the connection — no IP, no port, no handshake needed.
func (d *RCPDaemon) IsResonant(peerBPI [32]byte) bool {
	return d.ComputeResonance(peerBPI) > ResonanceThreshold
}

// Route a packet from sender to receiver via resonance-guided forwarding.
//
// Algorithm: Next_hop = argmax_{neighbors} RCP(neighbor, target)
// Packet is delivered when RCP(current_node, target) is maximum.
func (d *RCPDaemon) Route(packet *RCPPacket) error {
	if packet.TTL == 0 {
		d.packetsDropped++
		return ErrTTLExpired
	}

	// SILENCE check: we cannot forward if our own BC < Ψ
	if d.localBC < d.localPsi {
		d.packetsDropped++
		return ErrNodeSilenced
	}

	// Check if we are the receiver
	if packet.ReceiverBPI == d.localBPI {
		d.packetsRouted++
		d.logger.Debug("Packet delivered — we are receiver",
			zap.Binary("receiver", packet.ReceiverBPI[:]),
		)
		return nil
	}

	// Find best next hop
	bestPeer := d.findBestNextHop(packet.ReceiverBPI)
	if bestPeer == nil {
		d.packetsDropped++
		return ErrNoResonantPath
	}

	// Forward if best peer has higher resonance with target than we do
	ourResonance := d.ComputeResonance(packet.ReceiverBPI)
	if bestPeer.Resonance > ourResonance {
		packet.TTL--
		d.logger.Debug("Forwarding packet",
			zap.Float32("our_resonance", ourResonance),
			zap.Float32("peer_resonance", bestPeer.Resonance),
			zap.Binary("next_hop", bestPeer.BPI[:]),
		)
		// In production: forward via gRPC to bestPeer.GRPCAddress
		d.packetsRouted++
		return nil
	}

	// We are the closest node — deliver to receiver directly (last hop)
	d.packetsRouted++
	return nil
}

// findBestNextHop returns the peer with highest resonance to the target.
func (d *RCPDaemon) findBestNextHop(targetBPI [32]byte) *Peer {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var best *Peer
	var bestScore float32

	for _, peer := range d.peers {
		if !peer.IsConnected {
			continue
		}
		// RCP(peer, target) approximated via peer's RF vs target's estimated RF
		// In full implementation: query Akashic Index for target's RF vector
		score := cosineSimilarity(peer.RF[:], d.getTargetRF(targetBPI)[:])
		if score > bestScore {
			bestScore = score
			best = peer
		}
	}
	return best
}

// getTargetRF returns the RF vector for a target BPI (from routing table / Akashic).
func (d *RCPDaemon) getTargetRF(targetBPI [32]byte) [RFVectorDim]float32 {
	// In production: query Akashic Index or routing cache
	// For now: check if it's a known peer
	if peer, ok := d.peers[targetBPI]; ok {
		return peer.RF
	}
	// Unknown target: return uniform distribution (minimum resonance)
	var rf [RFVectorDim]float32
	for i := range rf {
		rf[i] = 1.0 / RFVectorDim
	}
	return rf
}

// RegisterPeer adds a new peer to the resonance network.
func (d *RCPDaemon) RegisterPeer(bpi [32]byte, rf [RFVectorDim]float32, addr string) {
	d.mu.Lock()
	defer d.mu.Unlock()

	resonance := cosineSimilarity(d.localRF[:], rf[:])
	d.peers[bpi] = &Peer{
		BPI:         bpi,
		RF:          rf,
		Resonance:   resonance,
		LastSeen:    time.Now(),
		GRPCAddress: addr,
		IsConnected: resonance > ResonanceThreshold,
	}

	if resonance > ResonanceThreshold {
		d.peersDiscovered++
		d.logger.Info("Resonant peer discovered",
			zap.Float32("resonance", resonance),
			zap.Binary("peer_bpi", bpi[:8]),
		)
	}
}

// UpdateLocalRF updates the local resonance frequency vector from Akashic Index.
func (d *RCPDaemon) UpdateLocalRF(rf [RFVectorDim]float32) {
	d.mu.Lock()
	d.localRF = rf
	d.mu.Unlock()

	// Recompute resonance with all peers
	d.mu.Lock()
	for bpi, peer := range d.peers {
		peer.Resonance = cosineSimilarity(d.localRF[:], peer.RF[:])
		peer.IsConnected = peer.Resonance > ResonanceThreshold
		_ = bpi
	}
	d.mu.Unlock()
}

// RunResonanceSync periodically recomputes resonance with all peers.
func (d *RCPDaemon) RunResonanceSync(ctx context.Context) {
	ticker := time.NewTicker(SyncInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.syncResonance()
		}
	}
}

// RunPeerDiscovery periodically probes for new resonant peers.
func (d *RCPDaemon) RunPeerDiscovery(ctx context.Context) {
	ticker := time.NewTicker(PeerDiscoveryInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.discoverPeers(ctx)
		}
	}
}

// RunBCMonitor monitors local BC and enforces SILENCE.
func (d *RCPDaemon) RunBCMonitor(ctx context.Context) {
	ticker := time.NewTicker(BCMonitorInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if d.localBC < d.localPsi {
				d.logger.Warn("SILENCE engaged — RCP daemon below coherence threshold",
					zap.Float32("bc", d.localBC),
					zap.Float32("psi", d.localPsi),
				)
			}
		}
	}
}

func (d *RCPDaemon) syncResonance() {
	d.mu.Lock()
	for _, peer := range d.peers {
		peer.Resonance = cosineSimilarity(d.localRF[:], peer.RF[:])
		peer.IsConnected = peer.Resonance > ResonanceThreshold
	}
	d.mu.Unlock()
	d.logger.Debug("Resonance sync complete", zap.Int("peers", len(d.peers)))
}

func (d *RCPDaemon) discoverPeers(ctx context.Context) {
	// In production: broadcast SPAWN event to known bootstrap nodes
	// and collect RF vectors from responders
	d.logger.Debug("Peer discovery cycle")
}

// ConnectedPeers returns all currently resonant peers (RCP > 0.15).
func (d *RCPDaemon) ConnectedPeers() []*Peer {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var connected []*Peer
	for _, peer := range d.peers {
		if peer.IsConnected {
			connected = append(connected, peer)
		}
	}
	return connected
}

// Metrics returns daemon performance metrics.
func (d *RCPDaemon) Metrics() map[string]int64 {
	return map[string]int64{
		"packets_routed":   d.packetsRouted,
		"packets_dropped":  d.packetsDropped,
		"peers_discovered": d.peersDiscovered,
	}
}

// ── Helper functions ──────────────────────────────────────────────────────────

// cosineSimilarity computes cosine similarity between two float32 vectors.
func cosineSimilarity(a, b []float32) float32 {
	if len(a) != len(b) {
		return 0
	}
	var dot, normA, normB float32
	for i := range a {
		dot  += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	if normA < 1e-9 || normB < 1e-9 {
		return 0
	}
	return dot / float32(math.Sqrt(float64(normA)*float64(normB)))
}

// ── Errors ─────────────────────────────────────────────────────────────────

type rcpError string

func (e rcpError) Error() string { return string(e) }

const (
	ErrTTLExpired       rcpError = "RCP: packet TTL expired — no resonant path found within hop limit"
	ErrNoResonantPath   rcpError = "RCP: no resonant path to receiver"
	ErrNodeSilenced     rcpError = "RCP: node is SILENCED (BC < Ψ) — cannot route"
)
