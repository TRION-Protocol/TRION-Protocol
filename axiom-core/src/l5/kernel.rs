//! Living Kernel Architecture (LKA) — Invention #13.
//!
//! The self-evolving operational core. Every kernel component is a behavioral
//! entity scored by the AXIOM fitness function. Components below fitness
//! threshold are replaced autonomously without human intervention.
//!
//! This is analogous to cellular apoptosis: components that no longer serve
//! the system are replaced, and the system grows stronger through replacement.

use crate::types::{BPI, SilenceState};
use crate::l5::scheduler::CBRAScheduler;
use crate::l5::bis::BISController;
use crate::l5::ikp::ImmunityKernelProtocol;
use crate::l5::bfs::BehavioralFileSystem;
use std::collections::HashMap;

/// A Living Kernel component entry.
#[derive(Debug, Clone)]
pub struct KernelComponent {
    pub bpi: BPI,
    pub name: String,
    /// Interface this component implements.
    pub interface: String,
    pub bc: f32,
    pub depth: f64,
    pub love: f32,
    pub fitness: f32,
    pub error_rate: f32,
    pub throughput_ratio: f32,
    pub is_improving: bool,
    /// Shadow-testing a replacement candidate?
    pub in_shadow_test: bool,
    pub consecutive_below_fitness: u32,
}

impl KernelComponent {
    /// F(component, t) = PA(t) · ICE(t) · AS(t) · Love(t)
    pub fn compute_fitness(&self) -> f32 {
        let pa = 1.0 - self.error_rate;
        let ice = self.throughput_ratio;
        let as_score = if self.is_improving { 1.0 } else { 0.8 };
        (pa * ice * as_score * self.love).clamp(0.0, 1.0)
    }

    pub fn update_fitness(&mut self) {
        self.fitness = self.compute_fitness();
    }
}

/// The Living Kernel.
pub struct LivingKernel {
    pub scheduler: CBRAScheduler,
    pub bis: BISController,
    pub ikp: ImmunityKernelProtocol,
    pub bfs: BehavioralFileSystem,
    components: HashMap<String, KernelComponent>,
    component_registry: Vec<KernelComponent>,
    fitness_threshold: f32,
    replacement_cycle_threshold: u32,
    tick_count: u64,
}

impl LivingKernel {
    pub fn new() -> Self {
        Self {
            scheduler: CBRAScheduler::default(),
            bis: BISController::default(),
            ikp: ImmunityKernelProtocol::new(),
            bfs: BehavioralFileSystem::new(),
            components: HashMap::new(),
            component_registry: Vec::new(),
            fitness_threshold: 0.60,
            replacement_cycle_threshold: 3,
            tick_count: 0,
        }
    }

    /// Register a kernel component.
    pub fn register_component(&mut self, component: KernelComponent) {
        self.components.insert(component.interface.clone(), component);
    }

    /// Register a candidate component in the Living Component Registry (LCR).
    pub fn register_candidate(&mut self, candidate: KernelComponent) {
        self.component_registry.push(candidate);
    }

    /// Kernel evolution cycle — called every 6 hours.
    ///
    /// Evaluates fitness of all components and replaces underperforming ones.
    pub fn evolution_cycle(&mut self) -> Vec<ComponentReplacement> {
        let mut replacements = Vec::new();

        let threshold = self.fitness_threshold;
        let cycle_threshold = self.replacement_cycle_threshold;

        for (interface, component) in self.components.iter_mut() {
            component.update_fitness();

            if component.fitness < threshold {
                component.consecutive_below_fitness += 1;
                if component.consecutive_below_fitness >= cycle_threshold {
                    // Search registry for replacement candidate
                    if let Some(replacement) = Self::find_best_candidate(
                        &self.component_registry, interface
                    ) {
                        replacements.push(ComponentReplacement {
                            old_bpi: component.bpi,
                            new_bpi: replacement.bpi,
                            interface: interface.clone(),
                            old_fitness: component.fitness,
                            new_fitness: replacement.fitness,
                        });
                    }
                }
            } else {
                component.consecutive_below_fitness = 0;
            }
        }

        // Apply replacements
        for rep in &replacements {
            if let Some(candidate) = self.component_registry
                .iter()
                .find(|c| c.bpi == rep.new_bpi)
                .cloned()
            {
                self.components.insert(rep.interface.clone(), candidate);
            }
        }

        replacements
    }

    /// Find best replacement candidate for a given interface.
    fn find_best_candidate(
        registry: &[KernelComponent],
        interface: &str,
    ) -> Option<KernelComponent> {
        registry.iter()
            .filter(|c| c.interface == interface && !c.in_shadow_test)
            .max_by(|a, b| {
                // Rank by: F_candidate × D(candidate) / (1 + age_of_candidate)
                let score_a = a.fitness * a.depth as f32;
                let score_b = b.fitness * b.depth as f32;
                score_a.partial_cmp(&score_b).unwrap_or(std::cmp::Ordering::Equal)
            })
            .cloned()
    }

    /// Tick the kernel (called at scheduling frequency, ~100Hz).
    pub fn tick(&mut self) {
        self.tick_count += 1;
        let _to_replace = self.scheduler.tick();
    }

    /// Get AXIOM behavioral truth state for the kernel itself.
    pub fn kernel_xi(&self) -> f64 {
        let avg_bc: f32 = if self.components.is_empty() { 1.0 } else {
            self.components.values().map(|c| c.bc).sum::<f32>()
                / self.components.len() as f32
        };
        let avg_depth: f64 = if self.components.is_empty() { 0.0 } else {
            self.components.values().map(|c| c.depth).sum::<f64>()
                / self.components.len() as f64
        };
        crate::master_equation(avg_bc, 0.55, 1.0, 0.002, avg_depth)
    }
}

impl Default for LivingKernel {
    fn default() -> Self { Self::new() }
}

/// A component replacement event.
#[derive(Debug, Clone)]
pub struct ComponentReplacement {
    pub old_bpi: BPI,
    pub new_bpi: BPI,
    pub interface: String,
    pub old_fitness: f32,
    pub new_fitness: f32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fitness_below_threshold_triggers_replacement() {
        let mut kernel = LivingKernel::new();

        let weak = KernelComponent {
            bpi: [1u8; 32],
            name: "weak-scheduler".into(),
            interface: "scheduler".into(),
            bc: 0.5, depth: 100.0, love: 0.5,
            fitness: 0.3, error_rate: 0.5, throughput_ratio: 0.6,
            is_improving: false, in_shadow_test: false,
            consecutive_below_fitness: 2,
        };
        let strong = KernelComponent {
            bpi: [2u8; 32],
            name: "strong-scheduler".into(),
            interface: "scheduler".into(),
            bc: 0.9, depth: 5000.0, love: 0.9,
            fitness: 0.85, error_rate: 0.05, throughput_ratio: 0.95,
            is_improving: true, in_shadow_test: false,
            consecutive_below_fitness: 0,
        };

        kernel.register_component(weak);
        kernel.register_candidate(strong);

        let replacements = kernel.evolution_cycle();
        assert!(!replacements.is_empty());
        assert_eq!(replacements[0].new_bpi, [2u8; 32]);
    }
}
