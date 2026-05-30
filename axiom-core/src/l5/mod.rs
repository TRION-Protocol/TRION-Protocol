//! # Layer 5 — Living Kernel
//!
//! The self-evolving operational core. Manages processes, resources,
//! interrupts, and security. Applies fitness function to itself.
//!
//! Unlike traditional static kernels, every Living Kernel component
//! is a behavioral entity with BC score, D(t), and a fitness score.
//! Components below fitness threshold are replaced automatically.
//!
//! ## Fitness Function
//! ```text
//! F(component, t) = PA(t) · ICE(t) · AS(t) · Love(t)
//! ```

pub mod kernel;
pub mod scheduler;
pub mod bis;
pub mod ikp;
pub mod bfs;
pub mod lbp;

pub use kernel::LivingKernel;
pub use scheduler::CBRAScheduler;
pub use bis::{BISController, BISLevel};
pub use ikp::{ImmunityKernelProtocol, IKPLayer};
pub use bfs::BehavioralFileSystem;
pub use lbp::LivingBootProtocol;
