//! Differential oracle for the devnet demo's JS rubric. No network or keys.
use quorum_rubric::{compute_weights, RubricConfig, VenueInput};
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let venues: Vec<VenueInput> = args.iter().map(|arg| {
        let p: Vec<u64> = arg.split(':').map(|s| s.parse().unwrap()).collect();
        VenueInput { apy_bps: p[0], crr_bps: p[1], cap_bps: p[2] as u16, stale: p[3] != 0 }
    }).collect();
    println!("{:?}", compute_weights(&venues, &RubricConfig::default()));
}
