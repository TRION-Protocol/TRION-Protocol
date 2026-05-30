//! Coherence-Based Resource Allocation (CBRA) Scheduler — Invention #11.
//!
//! Distributes computational resources proportionally to each process's
//! behavioral coherence score multiplied by its relative behavioral depth.
//!
//! ## Formula
//! ```text
//! Resources(process, t) = R_total · [BC(p,t) · D_rel(p,t)] / Σᵢ[BC(pᵢ,t) · D_rel(pᵢ,t)]
//! ```

use crate::types::{BPI, SilenceState};
use std::collections::HashMap;

/// A process registered with the CBRA scheduler.
#[derive(Debug, Clone)]
pub struct ScheduledProcess {
    pub bpi: BPI,
    pub current_bc: f32,
    pub psi: f32,
    pub depth: f64,
    pub silence_state: SilenceState,
    pub love: f32,
    /// User-space priority hint (0–100, used only for tie-breaking).
    pub hint_priority: u8,
    pub error_count: u64,
    pub event_count: u64,
}

impl ScheduledProcess {
    /// Compute CBRA priority: BC × D_rel (relative depth).
    pub fn priority(&self, system_depth: f64) -> f32 {
        if system_depth < 1e-9 { return self.current_bc; }
        let d_rel = (self.depth / system_depth) as f32;
        (self.current_bc * d_rel).clamp(0.0, 1.0)
    }

    /// Compute Living Kernel fitness score.
    ///
    /// F(component, t) = PA(t) · ICE(t) · AS(t) · Love(t)
    pub fn fitness(&self) -> f32 {
        let pa = if self.event_count == 0 { 1.0 }
            else { 1.0 - (self.error_count as f32 / self.event_count as f32) };
        // ICE: simplified as coherence ratio
        let ice = self.current_bc;
        // AS: simplified to 1.0 (adaptive score requires history)
        let as_score = 1.0f32;
        (pa * ice * as_score * self.love).clamp(0.0, 1.0)
    }

    /// Check SILENCE condition.
    pub fn is_silenced(&self) -> bool {
        self.current_bc < self.psi
    }
}

/// Resource allocation result for one process.
#[derive(Debug, Clone)]
pub struct ResourceAllocation {
    pub bpi: BPI,
    /// CPU share ∈ [0, 1].
    pub cpu_share: f32,
    /// Memory share ∈ [0, 1].
    pub memory_share: f32,
    /// I/O bandwidth share ∈ [0, 1].
    pub io_share: f32,
    /// Whether process has Priority_Flag active.
    pub priority_flag: bool,
}

/// CBRA Scheduler — Invention #11.
pub struct CBRAScheduler {
    processes: HashMap<BPI, ScheduledProcess>,
    system_depth: f64,
    /// Minimum fitness before replacement is triggered.
    fitness_threshold: f32,
    /// Fitness-below-threshold consecutive cycles before replacement.
    replacement_cycles: u32,
    below_fitness_counts: HashMap<BPI, u32>,
    /// Active Priority_Flags (BPI → remaining ticks).
    priority_flags: HashMap<BPI, u32>,
}

impl CBRAScheduler {
    const PRIORITY_FLAG_TICKS: u32 = 30 * 100; // 30s at 100Hz
    const PRIORITY_FLAG_MULTIPLIER: f32 = 10.0;

    pub fn new(fitness_threshold: f32, replacement_cycles: u32) -> Self {
        Self {
            processes: HashMap::new(),
            system_depth: 0.0,
            fitness_threshold,
            replacement_cycles,
            below_fitness_counts: HashMap::new(),
            priority_flags: HashMap::new(),
        }
    }

    pub fn register(&mut self, process: ScheduledProcess) {
        self.system_depth += process.depth;
        self.processes.insert(process.bpi, process);
    }

    pub fn deregister(&mut self, bpi: &BPI) {
        if let Some(p) = self.processes.remove(bpi) {
            self.system_depth -= p.depth;
        }
        self.below_fitness_counts.remove(bpi);
        self.priority_flags.remove(bpi);
    }

    /// Update BC and depth for a process.
    pub fn update_process(&mut self, bpi: &BPI, new_bc: f32, new_psi: f32, new_depth: f64) {
        if let Some(p) = self.processes.get_mut(bpi) {
            let old_depth = p.depth;
            p.current_bc = new_bc;
            p.psi = new_psi;
            p.depth = new_depth;
            p.silence_state = if new_bc < new_psi {
                SilenceState::Silenced
            } else {
                SilenceState::Operational
            };
            self.system_depth += new_depth - old_depth;
        }
    }

    /// Compute resource allocations for all non-silenced processes.
    pub fn allocate(&self) -> Vec<ResourceAllocation> {
        // Sum of [BC * D_rel] across all eligible processes
        let weights: Vec<(BPI, f32)> = self.processes.values()
            .filter(|p| !p.is_silenced())
            .map(|p| {
                let mut w = p.priority(&self.system_depth);
                // Apply Priority_Flag multiplier if active
                if self.priority_flags.contains_key(&p.bpi) {
                    w *= Self::PRIORITY_FLAG_MULTIPLIER;
                }
                (p.bpi, w)
            })
            .collect();

        let total_weight: f32 = weights.iter().map(|(_, w)| w).sum();

        weights.into_iter().map(|(bpi, w)| {
            let share = if total_weight < 1e-9 { 0.0 } else { w / total_weight };
            ResourceAllocation {
                bpi,
                cpu_share: share,
                memory_share: share,
                io_share: share,
                priority_flag: self.priority_flags.contains_key(&bpi),
            }
        }).collect()
    }

    /// Request a Priority_Flag for a process.
    ///
    /// Granted only if BC > 0.90 AND D_rel > 0.05.
    pub fn request_priority_flag(&mut self, bpi: &BPI) -> bool {
        if let Some(p) = self.processes.get(bpi) {
            let d_rel = if self.system_depth < 1e-9 { 0.0 }
                else { p.depth / self.system_depth };
            if p.current_bc > 0.90 && d_rel > 0.05 {
                self.priority_flags.insert(*bpi, Self::PRIORITY_FLAG_TICKS);
                return true;
            }
        }
        false
    }

    /// Tick the scheduler — called every scheduling quantum.
    /// Returns BPIs that require replacement.
    pub fn tick(&mut self) -> Vec<BPI> {
        // Decrement Priority_Flag timers
        self.priority_flags.retain(|_, ticks| {
            *ticks = ticks.saturating_sub(1);
            *ticks > 0
        });

        // Check fitness for all processes
        let mut to_replace = Vec::new();
        let threshold = self.fitness_threshold;
        let max_cycles = self.replacement_cycles;

        for (bpi, proc) in &self.processes {
            let f = proc.fitness();
            if f < threshold {
                let count = self.below_fitness_counts.entry(*bpi).or_insert(0);
                *count += 1;
                if *count >= max_cycles {
                    to_replace.push(*bpi);
                }
            } else {
                self.below_fitness_counts.remove(bpi);
            }
        }

        to_replace
    }

    /// Get processes sorted by CBRA priority (highest first).
    pub fn ranked_processes(&self) -> Vec<(&ScheduledProcess, f32)> {
        let mut ranked: Vec<(&ScheduledProcess, f32)> = self.processes.values()
            .filter(|p| !p.is_silenced())
            .map(|p| (p, p.priority(&self.system_depth)))
            .collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        ranked
    }
}

impl Default for CBRAScheduler {
    fn default() -> Self { Self::new(0.60, 3) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(bpi_byte: u8, bc: f32, depth: f64) -> ScheduledProcess {
        ScheduledProcess {
            bpi: [bpi_byte; 32],
            current_bc: bc,
            psi: 0.55,
            depth,
            silence_state: SilenceState::Operational,
            love: 1.0,
            hint_priority: 50,
            error_count: 0,
            event_count: 100,
        }
    }

    #[test]
    fn high_bc_high_depth_gets_more_resources() {
        let mut sched = CBRAScheduler::default();
        sched.register(proc(1, 0.95, 10000.0));
        sched.register(proc(2, 0.60, 100.0));
        let allocs = sched.allocate();
        let a1 = allocs.iter().find(|a| a.bpi == [1u8; 32]).unwrap();
        let a2 = allocs.iter().find(|a| a.bpi == [2u8; 32]).unwrap();
        assert!(a1.cpu_share > a2.cpu_share);
    }

    #[test]
    fn silenced_process_gets_no_resources() {
        let mut sched = CBRAScheduler::default();
        sched.register(proc(1, 0.95, 1000.0));
        let mut p2 = proc(2, 0.30, 500.0); // BC < Ψ → silenced
        p2.silence_state = SilenceState::Silenced;
        sched.register(p2);
        let allocs = sched.allocate();
        assert!(allocs.iter().all(|a| a.bpi != [2u8; 32]));
    }

    #[test]
    fn priority_flag_requires_high_bc() {
        let mut sched = CBRAScheduler::default();
        sched.register(proc(1, 0.85, 500.0)); // BC too low
        assert!(!sched.request_priority_flag(&[1u8; 32]));

        sched.register(proc(2, 0.95, 5000.0));
        assert!(sched.request_priority_flag(&[2u8; 32]));
    }
}
