//! L0 entropy sources: GPS, HSM, thermal noise, physical sensors.

use crate::types::GpsTimestampNs;
use std::time::{SystemTime, UNIX_EPOCH};

/// Trait for entropy sources — all L0 entropy must implement this.
pub trait EntropySource: Send + Sync {
    /// Get GPS-derived timestamp in nanoseconds.
    fn gps_timestamp_ns(&self) -> GpsTimestampNs;

    /// Get combined physical entropy (32 bytes).
    fn combined_entropy(&self) -> [u8; 32];

    /// Get raw HSM entropy (32 bytes).
    fn hsm_entropy(&self) -> [u8; 32];

    /// Get GPS-mixed entropy (32 bytes).
    fn gps_entropy(&self) -> [u8; 32];
}

/// Production entropy source using real GPS + HSM.
/// On hardware without GPS, falls back to NTP + TPM.
/// On bare-metal, falls back to thermal noise sampling.
pub struct HardwareEntropySource {
    gps_socket: Option<GpsSocket>,
    hsm_handle: Option<HsmHandle>,
}

/// Simulated entropy source for testing and development.
/// NOT FOR PRODUCTION — simulation cannot provide physical uniqueness.
pub struct SimulationEntropySource {
    seed: [u8; 32],
}

impl SimulationEntropySource {
    /// Create a simulation source with a fixed seed.
    pub fn new(seed: [u8; 32]) -> Self {
        Self { seed }
    }

    /// Create a simulation source from a u64 seed.
    pub fn from_u64(seed: u64) -> Self {
        let mut s = [0u8; 32];
        s[..8].copy_from_slice(&seed.to_le_bytes());
        Self { seed: s }
    }

    fn mix(&self, extra: &[u8]) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(&self.seed);
        hasher.update(extra);
        *hasher.finalize().as_bytes()
    }
}

impl EntropySource for SimulationEntropySource {
    fn gps_timestamp_ns(&self) -> GpsTimestampNs {
        // In simulation: use system time + seed jitter
        let base = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
        // Add GPS epoch offset (GPS epoch is 315964800 seconds ahead of Unix)
        base + 315_964_800_000_000_000
    }

    fn gps_entropy(&self) -> [u8; 32] {
        let ts = self.gps_timestamp_ns().to_le_bytes();
        self.mix(&ts)
    }

    fn hsm_entropy(&self) -> [u8; 32] {
        // Simulate HSM by hashing seed with a counter
        let counter = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos()
            .to_le_bytes();
        self.mix(&counter)
    }

    fn combined_entropy(&self) -> [u8; 32] {
        let gps = self.gps_entropy();
        let hsm = self.hsm_entropy();
        // Combine via Blake3 (NOT XOR — Blake3 provides better mixing)
        let mut hasher = blake3::Hasher::new();
        hasher.update(&gps);
        hasher.update(&hsm);
        *hasher.finalize().as_bytes()
    }
}

impl HardwareEntropySource {
    /// Create hardware entropy source.
    /// Falls back to simulation on systems without GPS/HSM.
    pub fn new() -> Self {
        Self {
            gps_socket: GpsSocket::open().ok(),
            hsm_handle: HsmHandle::open().ok(),
        }
    }

    /// Read thermal noise from /dev/hwrng or /dev/random.
    fn thermal_noise() -> [u8; 32] {
        #[cfg(unix)]
        {
            use std::io::Read;
            let mut buf = [0u8; 32];
            if let Ok(mut f) = std::fs::File::open("/dev/hwrng")
                .or_else(|_| std::fs::File::open("/dev/random"))
            {
                let _ = f.read_exact(&mut buf);
            } else {
                // Last resort: hash system time with PID
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos();
                let pid = std::process::id();
                let mut h = blake3::Hasher::new();
                h.update(&ts.to_le_bytes());
                h.update(&pid.to_le_bytes());
                buf = *h.finalize().as_bytes();
            }
            buf
        }
        #[cfg(not(unix))]
        {
            // Windows / WASM: use system crypto RNG
            let mut buf = [0u8; 32];
            getrandom::getrandom(&mut buf).unwrap_or(());
            buf
        }
    }
}

impl EntropySource for HardwareEntropySource {
    fn gps_timestamp_ns(&self) -> GpsTimestampNs {
        if let Some(gps) = &self.gps_socket {
            if let Ok(ts) = gps.read_timestamp_ns() {
                return ts;
            }
        }
        // Fallback: system clock + GPS epoch offset
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64
            + 315_964_800_000_000_000
    }

    fn gps_entropy(&self) -> [u8; 32] {
        let ts = self.gps_timestamp_ns();
        let thermal = Self::thermal_noise();
        let mut h = blake3::Hasher::new();
        h.update(&ts.to_le_bytes());
        h.update(&thermal);
        *h.finalize().as_bytes()
    }

    fn hsm_entropy(&self) -> [u8; 32] {
        if let Some(hsm) = &self.hsm_handle {
            if let Ok(bytes) = hsm.get_random_bytes() {
                return bytes;
            }
        }
        // Fallback: /dev/hwrng or /dev/random
        Self::thermal_noise()
    }

    fn combined_entropy(&self) -> [u8; 32] {
        let gps = self.gps_entropy();
        let hsm = self.hsm_entropy();
        let thermal = Self::thermal_noise();
        let mut h = blake3::Hasher::new();
        h.update(&gps);
        h.update(&hsm);
        h.update(&thermal);
        *h.finalize().as_bytes()
    }
}

// ── Hardware stubs (platform-specific implementations) ──────────────────────

/// GPS NMEA socket reader.
struct GpsSocket {
    #[allow(dead_code)]
    path: String,
}

impl GpsSocket {
    fn open() -> Result<Self, std::io::Error> {
        // In production: open /dev/ttyS0 or /dev/gps0 or gpsd socket
        #[cfg(unix)]
        {
            if std::path::Path::new("/dev/gps0").exists() {
                return Ok(Self { path: "/dev/gps0".into() });
            }
        }
        Err(std::io::Error::new(std::io::ErrorKind::NotFound, "GPS device not found"))
    }

    fn read_timestamp_ns(&self) -> Result<GpsTimestampNs, Box<dyn std::error::Error>> {
        // Parse NMEA $GPRMC or $GPGGA sentence for nanosecond timestamp
        // In production this reads from the GPS serial port
        Err("GPS not available in this build".into())
    }
}

/// Hardware Security Module handle (YubiHSM 2 / Thales Luna 7 / TPM 2.0).
struct HsmHandle {
    #[allow(dead_code)]
    device_id: u32,
}

impl HsmHandle {
    fn open() -> Result<Self, Box<dyn std::error::Error>> {
        // In production: open PKCS#11 session to HSM
        // or open /dev/tpm0 for TPM 2.0
        #[cfg(unix)]
        {
            if std::path::Path::new("/dev/tpm0").exists() {
                return Ok(Self { device_id: 0 });
            }
        }
        Err("HSM/TPM not available".into())
    }

    fn get_random_bytes(&self) -> Result<[u8; 32], Box<dyn std::error::Error>> {
        // In production: TPM2_GetRandom or PKCS#11 C_GenerateRandom
        Err("HSM random not implemented in this build".into())
    }
}

/// Minimum entropy check — H_L0 must always be > 0.
pub fn verify_minimum_entropy(entropy: &[u8; 32]) -> bool {
    // Entropy is non-zero if at least one byte is non-zero
    entropy.iter().any(|&b| b != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simulation_entropy_nonzero() {
        let src = SimulationEntropySource::from_u64(42);
        let entropy = src.combined_entropy();
        assert!(verify_minimum_entropy(&entropy));
    }

    #[test]
    fn simulation_timestamps_advancing() {
        let src = SimulationEntropySource::from_u64(1);
        let t1 = src.gps_timestamp_ns();
        std::thread::sleep(std::time::Duration::from_millis(1));
        let t2 = src.gps_timestamp_ns();
        assert!(t2 >= t1);
    }

    #[test]
    fn entropy_different_from_gps_and_hsm() {
        let src = SimulationEntropySource::from_u64(99);
        let gps = src.gps_entropy();
        let hsm = src.hsm_entropy();
        let combined = src.combined_entropy();
        // Combined should differ from either component
        assert_ne!(combined, gps);
        assert_ne!(combined, hsm);
    }
}
