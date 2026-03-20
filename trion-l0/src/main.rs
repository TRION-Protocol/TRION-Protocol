use std::collections::{HashSet, VecDeque};
use std::env;
use std::fs;
use std::process::Command;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// ─── EMA-based Anomaly Hunter (Whitepaper §L1) ────────────────────────────────
pub struct AnomalyHunter {
    pub current_mu_t: f64,
    pub alpha: f64,
    pub anomaly_threshold: f64,
}

impl AnomalyHunter {
    pub fn new(initial_baseline: f64) -> Self {
        Self {
            current_mu_t: initial_baseline,
            alpha: 0.1,
            anomaly_threshold: 0.15,
        }
    }

    pub fn process_block(&mut self, c_t_score: f64) -> bool {
        self.current_mu_t = (self.alpha * c_t_score) + ((1.0 - self.alpha) * self.current_mu_t);
        let drop_ratio = (self.current_mu_t - c_t_score) / self.current_mu_t;
        let is_stable = drop_ratio < self.anomaly_threshold;
        is_stable
    }
}
// ──────────────────────────────────────────────────────────────────────────────

fn rpc_call(url: &str, method: &str, params: &str) -> Result<String, String> {
    let body = format!(
        r#"{{"jsonrpc":"2.0","method":"{}","params":{},"id":1}}"#,
        method, params
    );
    let output = Command::new("curl")
        .args(["-s", "-X", "POST", "-H", "Content-Type: application/json", "--data", &body, url])
        .output()
        .map_err(|e| format!("curl failed: {}", e))?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn get_str_field<'a>(json: &'a str, key: &str) -> &'a str {
    let search = format!("\"{}\":\"", key);
    if let Some(start) = json.find(&search) {
        let rest = &json[start + search.len()..];
        if let Some(end) = rest.find('"') {
            return &rest[..end];
        }
    }
    "0x0"
}

fn get_nullable_str_field(json: &str, key: &str) -> Option<String> {
    let search = format!("\"{}\":", key);
    if let Some(start) = json.find(&search) {
        let rest = json[start + search.len()..].trim_start_matches(' ');
        if rest.starts_with("null") { return None; }
        if rest.starts_with('"') {
            let inner = &rest[1..];
            if let Some(end) = inner.find('"') {
                return Some(inner[..end].to_string());
            }
        }
    }
    Some("0x0".to_string())
}

fn hex_to_u64(hex: &str) -> u64 {
    u64::from_str_radix(hex.trim_start_matches("0x"), 16).unwrap_or(0)
}

fn hex_to_u128(hex: &str) -> u128 {
    u128::from_str_radix(hex.trim_start_matches("0x"), 16).unwrap_or(0)
}

fn split_transactions(block_json: &str) -> Vec<String> {
    let marker = "\"transactions\":[";
    let start = match block_json.find(marker) {
        Some(pos) => pos + marker.len(),
        None => return vec![],
    };
    let rest = &block_json[start..];
    if rest.starts_with(']') { return vec![]; }
    let mut txs = Vec::new();
    let mut depth: i32 = 0;
    let mut tx_start = 0;
    let mut in_string = false;
    let mut escape = false;
    let bytes = rest.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if escape { escape = false; i += 1; continue; }
        match c {
            '\\' if in_string => { escape = true; }
            '"' => { in_string = !in_string; }
            '{' if !in_string => { if depth == 0 { tx_start = i; } depth += 1; }
            '}' if !in_string => {
                depth -= 1;
                if depth == 0 { txs.push(rest[tx_start..=i].to_string()); }
            }
            ']' if !in_string && depth == 0 => break,
            _ => {}
        }
        i += 1;
    }
    txs
}

fn write_json(
    block_number: u64, timestamp: u64, tx_count: usize,
    f1: usize, f2: u64, f3: f64, f4: f64, f5: f64, f6: f64, f7: f64, f8: f64, f9: f64,
    theta: f64, window_ready: bool, anomaly: bool, drop_pct: f64,
    mu_t: f64, is_stable: bool,
) {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let alert_status = if !window_ready { "WARMING_UP" } else if anomaly { "ANOMALY" } else { "SAFE" };
    let json = format!(
        r#"{{
  "block_number": {},
  "timestamp": {},
  "tx_count": {},
  "features": {{
    "f1": {},
    "f2": {},
    "f3": {:.6},
    "f4": {:.6},
    "f5": {:.6},
    "f6": {:.6},
    "f7": {:.6},
    "f8": {:.6},
    "f9": {:.6}
  }},
  "theta": {:.6},
  "mu_t": {:.6},
  "is_stable": {},
  "window_ready": {},
  "alert": {},
  "drop_pct": {:.2},
  "alert_status": "{}",
  "updated_at": {}
}}"#,
        block_number, timestamp, tx_count,
        f1, f2, f3, f4, f5, f6, f7, f8, f9,
        theta, mu_t, is_stable,
        window_ready, anomaly, drop_pct,
        alert_status, now
    );
    let _ = fs::write("/tmp/trion_latest.json", json);
}

fn process_block(
    rpc_url: &str,
    block_hex: &str,
    block_number: u64,
    window: &mut VecDeque<f64>,
    hunter: &mut AnomalyHunter,
) {
    let params = format!(r#"["{}",true]"#, block_hex);
    let block_json = match rpc_call(rpc_url, "eth_getBlockByNumber", &params) {
        Ok(j) => j,
        Err(e) => { eprintln!("[ERROR] Failed to fetch block: {}", e); return; }
    };

    let base_fee = hex_to_u64(get_str_field(&block_json, "baseFeePerGas"));
    let timestamp = hex_to_u64(get_str_field(&block_json, "timestamp"));
    let txs = split_transactions(&block_json);
    let tx_count = txs.len();

    if tx_count == 0 {
        println!("[SKIP] Block {} — empty. Watching...\n", block_number);
        return;
    }

    let mut senders: HashSet<String> = HashSet::new();
    let mut receivers: HashSet<String> = HashSet::new();
    let mut total_value: u128 = 0;
    let mut zero_value_count: u64 = 0;
    let mut contract_interaction_count: u64 = 0;
    let mut gas_limits: Vec<u64> = Vec::with_capacity(tx_count);

    for tx in &txs {
        let from      = get_str_field(tx, "from").to_lowercase();
        let value_hex = get_str_field(tx, "value");
        let gas_hex   = get_str_field(tx, "gas");
        let input     = get_str_field(tx, "input");
        let to_opt    = get_nullable_str_field(tx, "to");

        senders.insert(from);
        if let Some(ref to) = to_opt {
            if !to.is_empty() && to != "0x0" { receivers.insert(to.to_lowercase()); }
        }
        let value = hex_to_u128(value_hex);
        total_value = total_value.saturating_add(value);
        if value == 0 { zero_value_count += 1; }
        let is_contract = to_opt.is_none() || (input != "0x" && input.len() > 2);
        if is_contract { contract_interaction_count += 1; }
        gas_limits.push(hex_to_u64(gas_hex));
    }

    let f1 = tx_count;
    let f2 = base_fee;
    let f3 = total_value as f64 / 1_000_000_000_000_000_000.0;
    let unique_senders = senders.len();
    let f4 = unique_senders as f64 / tx_count as f64;
    let unique_receivers = receivers.len();
    let f5 = if unique_senders > 0 { unique_receivers as f64 / unique_senders as f64 } else { 0.0 };
    let f6 = contract_interaction_count as f64 / tx_count as f64;
    gas_limits.sort_unstable();
    let total_gas: u64 = gas_limits.iter().sum();
    let top10_start = ((tx_count as f64 * 0.90) as usize).min(tx_count.saturating_sub(1));
    let top10_gas: u64 = gas_limits[top10_start..].iter().sum();
    let f7 = if total_gas > 0 { top10_gas as f64 / total_gas as f64 } else { 0.0 };
    let f8 = zero_value_count as f64 / tx_count as f64;
    let diversity = f4.min(1.0) * 0.25 + (f5.min(2.0) / 2.0) * 0.15;
    let activity  = f6 * 0.20;
    let health    = (1.0 - f8) * 0.25 + (1.0 - f7.min(1.0)) * 0.15;
    let f9: f64   = (diversity + activity + health).clamp(0.0, 1.0);

    // L1 Sliding Window (original 10-block window baseline)
    if window.len() >= 10 { window.pop_front(); }
    window.push_back(f9);
    let theta: f64 = window.iter().sum::<f64>() / window.len() as f64;
    let window_ready = window.len() == 10;
    let anomaly = window_ready && f9 < theta * 0.70;
    let drop_pct = if window_ready && theta > 0.0 { (1.0 - f9 / theta) * 100.0 } else { 0.0 };

    // EMA Anomaly Hunter — whitepaper §L1 upgrade
    let is_stable = hunter.process_block(f9);
    let mu_t = hunter.current_mu_t;

    let window_status = if !window_ready {
        format!("WARMING UP ({}/10 blocks)", window.len())
    } else {
        format!("ACTIVE — Θ(t) = {:.6}  |  μ(t) = {:.6}", theta, mu_t)
    };

    // Write JSON for dashboard + relayer
    write_json(block_number, timestamp, tx_count, f1, f2, f3, f4, f5, f6, f7, f8, f9,
               theta, window_ready, anomaly, drop_pct, mu_t, is_stable);

    // Terminal output
    println!("┌─────────────────────────────────────────────────────────────────┐");
    println!("│        TRION L0  ─  THERMODYNAMIC BEHAVIORAL FEATURE MATRIX     │");
    println!("│  Block: {:>12}  │  Timestamp: {:>12}  │  Txs: {:>6}      │",
             block_number, timestamp, tx_count);
    println!("├──────┬────────────────────────────────┬────────────────────────┤");
    println!("│  ID  │ Feature                        │ Value                  │");
    println!("├──────┼────────────────────────────────┼────────────────────────┤");
    println!("│  f1  │ Transaction Density             │ {:>22} │", f1);
    println!("│  f2  │ Base Fee Volatility (Wei)       │ {:>22} │", f2);
    println!("│  f3  │ Net Value Flow (ETH)            │ {:>22.6} │", f3);
    println!("│  f4  │ Entity Concentration            │ {:>22.6} │", f4);
    println!("│  f5  │ Counterparty Diversity          │ {:>22.6} │", f5);
    println!("│  f6  │ Contract Interaction Rate       │ {:>22.6} │", f6);
    println!("│  f7  │ Gas Limit Skew (top 10%)        │ {:>22.6} │", f7);
    println!("│  f8  │ Zero-Value Entropy              │ {:>22.6} │", f8);
    println!("├──────┼────────────────────────────────┼────────────────────────┤");
    println!("│  f9  │ ★ Block Coherence Score C(t)   │ {:>22.6} │", f9);
    println!("│  L1  │ Sliding Window Θ(t)            │ {:>22.6} │", theta);
    println!("│  EMA │ Dynamic Baseline μ(t)          │ {:>22.6} │", mu_t);
    println!("│  STA │ Network Stable                  │ {:>22} │", is_stable);
    println!("└──────┴────────────────────────────────┴────────────────────────┘");
    println!("  [L1] Semantic Window: {}", window_status);

    if anomaly || !is_stable {
        println!();
        println!("  ╔═══════════════════════════════════════════════════════════════╗");
        println!("  ║  🚨 CRITICAL ANOMALY DETECTED: THERMODYNAMIC COLLAPSE  🚨    ║");
        println!("  ║     C(t) = {:.6}  |  μ(t) = {:.6}  |  DROP = {:.1}%      ║",
                 f9, mu_t, drop_pct);
        println!("  ║     EMITTING SILENCE PRIMITIVE — L2 ALERT TRIGGERED          ║");
        println!("  ╚═══════════════════════════════════════════════════════════════╝");
    }

    println!();
}

fn main() -> Result<(), String> {
    println!("===============================================================");
    println!(" TRION PROTOCOL L0+L1: REAL-TIME INDEXER + SEMANTIC PLANE");
    println!(" TARGET: Arbitrum One Mainnet | Anomaly Detection Active");
    println!("===============================================================");
    println!(" Sliding window: 10 blocks  |  Trigger: C(t) < 70% of Θ(t)");
    println!(" EMA Anomaly Hunter: α=0.10  |  Threshold: 15% drop from μ(t)");
    println!(" Writing live data to /tmp/trion_latest.json");
    println!(" Monitoring live blocks. Press Ctrl+C to stop.\n");

    let raw = env::var("ARBITRUM_RPC_URL").map_err(|_| "ARBITRUM_RPC_URL not set".to_string())?;
    let rpc_url = if raw.starts_with("http://") || raw.starts_with("https://") {
        raw
    } else {
        format!("https://arb-mainnet.g.alchemy.com/v2/{}", raw.trim())
    };

    let mut last_processed_block: u64 = 0;
    let mut window: VecDeque<f64> = VecDeque::with_capacity(10);
    let mut hunter = AnomalyHunter::new(0.75);

    loop {
        let block_resp = match rpc_call(&rpc_url, "eth_blockNumber", "[]") {
            Ok(r) => r,
            Err(e) => { eprintln!("[ERROR] RPC call failed: {}", e); thread::sleep(Duration::from_millis(300)); continue; }
        };
        let block_hex = get_str_field(&block_resp, "result").to_string();
        let block_number = hex_to_u64(&block_hex);

        if block_number > last_processed_block {
            last_processed_block = block_number;
            process_block(&rpc_url, &block_hex, block_number, &mut window, &mut hunter);
        } else {
            thread::sleep(Duration::from_millis(300));
        }
    }
}
