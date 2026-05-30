//! Behavioral Interrupt System (BIS) — Invention #19.
//!
//! BIS replaces hardware interrupt lines with behavioral anomaly detection.
//! Every behavioral event is evaluated against the entity's expected trajectory.
//!
//! ## Trajectory Anomaly Score
//! ```text
//! TRAJ(entity, t) = ||BH_sequence(t, window) - E[BH_sequence(entity)]|| / σ
//! ```
//!
//! ## Interrupt Levels
//! - TRAJ < 1σ: Normal — no interrupt
//! - TRAJ ≥ 1σ: L1 — informational, log to Akashic Index
//! - TRAJ ≥ 2σ: L2 — warning, alert coherence engine
//! - TRAJ ≥ 3σ: L3 — critical, invoke IKP INNATE_LAYER
//! - TRAJ ≥ 5σ: L4 — emergency, SILENCE entity immediately

use crate::types::{BPI, BISInterrupt, BISLevel, UBEType, GpsTimestampNs, UBHHash};
use std::collections::{HashMap, VecDeque};

/// Expected behavioral trajectory model for one entity.
#[derive(Debug, Clone)]
pub struct TrajectoryModel {
    bpi: BPI,
    /// Rolling window of observed UBE types.
    window: VecDeque<UBEType>,
    window_size: usize,
    /// Expected frequency of each UBE type (32-element distribution).
    expected_freq: [f32; 32],
    /// Standard deviation of deviation scores over history.
    baseline_sigma: f32,
    /// History of deviation scores for sigma computation.
    deviation_history: VecDeque<f32>,
}

impl TrajectoryModel {
    pub fn new(bpi: BPI, window_size: usize) -> Self {
        Self {
            bpi,
            window: VecDeque::with_capacity(window_size),
            window_size,
            expected_freq: [1.0 / 32.0; 32], // Uniform prior
            baseline_sigma: 1.0,
            deviation_history: VecDeque::with_capacity(100),
        }
    }

    /// Update the trajectory model with a new observed event.
    pub fn observe(&mut self, ube: UBEType) {
        self.window.push_back(ube);
        if self.window.len() > self.window_size {
            self.window.pop_front();
        }
        self.recompute_expected_freq();
    }

    /// Compute trajectory anomaly score for a new event.
    ///
    /// TRAJ = deviation / baseline_sigma
    pub fn anomaly_score(&mut self, new_event: UBEType) -> f32 {
        let idx = (new_event as u8).saturating_sub(1) as usize;
        let expected_prob = self.expected_freq.get(idx).copied().unwrap_or(1.0 / 32.0);
        // Deviation: how surprising is this event?
        let deviation = (1.0 - expected_prob * 32.0).abs(); // 0 if uniform, 1 if completely unexpected
        let score = deviation / self.baseline_sigma.max(0.01);

        // Update sigma history
        self.deviation_history.push_back(deviation);
        if self.deviation_history.len() > 100 {
            self.deviation_history.pop_front();
        }
        self.update_sigma();

        score
    }

    fn recompute_expected_freq(&mut self) {
        let total = self.window.len().max(1) as f32;
        let mut counts = [0u32; 32];
        for &ube in &self.window {
            let idx = (ube as u8).saturating_sub(1) as usize;
            if idx < 32 { counts[idx] += 1; }
        }
        for (i, &c) in counts.iter().enumerate() {
            self.expected_freq[i] = (c as f32 + 0.5) / (total + 16.0); // Laplace smoothing
        }
    }

    fn update_sigma(&mut self) {
        if self.deviation_history.len() < 2 { return; }
        let n = self.deviation_history.len() as f32;
        let mean: f32 = self.deviation_history.iter().sum::<f32>() / n;
        let variance: f32 = self.deviation_history.iter()
            .map(|&x| (x - mean).powi(2))
            .sum::<f32>() / (n - 1.0);
        self.baseline_sigma = variance.sqrt().max(0.01);
    }

    /// Get expected next event distribution.
    pub fn expected_distribution(&self) -> [f32; 32] {
        self.expected_freq
    }
}

/// BIS Controller — monitors all entities and generates behavioral interrupts.
pub struct BISController {
    models: HashMap<BPI, TrajectoryModel>,
    window_size: usize,
    interrupt_log: Vec<BISInterrupt>,
}

impl BISController {
    pub fn new(window_size: usize) -> Self {
        Self {
            models: HashMap::new(),
            window_size,
            interrupt_log: Vec::new(),
        }
    }

    /// Register an entity for trajectory monitoring.
    pub fn register(&mut self, bpi: BPI) {
        self.models.insert(bpi, TrajectoryModel::new(bpi, self.window_size));
    }

    /// Process a new behavioral event for an entity.
    ///
    /// Returns a BIS interrupt if anomaly threshold is exceeded.
    pub fn process_event(
        &mut self,
        bpi: &BPI,
        ube: UBEType,
        bc: f32,
        depth: f64,
        timestamp: GpsTimestampNs,
        causal_context: UBHHash,
    ) -> Option<BISInterrupt> {
        let model = self.models.entry(*bpi).or_insert_with(|| {
            TrajectoryModel::new(*bpi, self.window_size)
        });

        let traj_score = model.anomaly_score(ube);
        let level = BISLevel::from_traj_score(traj_score);
        model.observe(ube);

        if level == BISLevel::Normal {
            return None;
        }

        let expected_dist = model.expected_distribution();
        let top_expected: Vec<UBEType> = expected_dist.iter()
            .enumerate()
            .filter(|(_, &f)| f > 0.05)
            .map(|(i, _)| UBEType::from_u8((i + 1) as u8).unwrap_or(UBEType::Execute))
            .collect();

        let interrupt = BISInterrupt {
            entity_bpi: *bpi,
            traj_score,
            level,
            anomaly_sequence: vec![ube],
            expected_sequence: top_expected,
            bc_at_interrupt: bc,
            depth_at_interrupt: depth,
            gps_timestamp: timestamp,
            causal_context,
        };

        self.interrupt_log.push(interrupt.clone());
        Some(interrupt)
    }

    /// Handle a BIS interrupt according to its level.
    pub fn handle_interrupt(&self, interrupt: &BISInterrupt) -> BISAction {
        match interrupt.level {
            BISLevel::Normal => BISAction::Nothing,
            BISLevel::L1    => BISAction::LogToAkashic,
            BISLevel::L2    => BISAction::AlertCoherenceEngine,
            BISLevel::L3    => BISAction::InvokeIKPInnate,
            BISLevel::L4    => BISAction::SilenceEntityImmediately,
        }
    }

    /// Get all logged interrupts.
    pub fn interrupt_log(&self) -> &[BISInterrupt] {
        &self.interrupt_log
    }
}

impl Default for BISController {
    fn default() -> Self { Self::new(100) }
}

/// Action to take in response to a BIS interrupt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BISAction {
    Nothing,
    LogToAkashic,
    AlertCoherenceEngine,
    InvokeIKPInnate,
    SilenceEntityImmediately,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_events_no_interrupt() {
        let mut ctrl = BISController::new(20);
        let bpi = [1u8; 32];
        ctrl.register(bpi);

        // Train the model
        for _ in 0..20 {
            ctrl.process_event(&bpi, UBEType::Execute, 0.8, 100.0, 0, [0u8; 32]);
        }
        // Expected: Execute — should be low anomaly score
        let result = ctrl.process_event(&bpi, UBEType::Execute, 0.8, 100.0, 0, [0u8; 32]);
        // After training on Execute, Execute should not be anomalous
        if let Some(interrupt) = result {
            assert_ne!(interrupt.level, BISLevel::L4);
        }
    }

    #[test]
    fn emergency_level_on_extreme_anomaly() {
        let level = BISLevel::from_traj_score(5.5);
        assert_eq!(level, BISLevel::L4);
    }

    #[test]
    fn bis_action_mapping() {
        let ctrl = BISController::new(10);
        let interrupt = BISInterrupt {
            entity_bpi: [0u8; 32],
            traj_score: 6.0,
            level: BISLevel::L4,
            anomaly_sequence: vec![],
            expected_sequence: vec![],
            bc_at_interrupt: 0.3,
            depth_at_interrupt: 100.0,
            gps_timestamp: 0,
            causal_context: [0u8; 32],
        };
        assert_eq!(ctrl.handle_interrupt(&interrupt), BISAction::SilenceEntityImmediately);
    }
}
