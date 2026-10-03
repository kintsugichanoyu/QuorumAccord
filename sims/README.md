# Simulations & integration tests

The deterministic maths (aggregation, renormalisation, rubric, window/divergence)
is already covered by **native unit tests** (`cargo test` in both workspaces, 24
tests). The scenarios below exercise the on-chain **state machine** end-to-end and
need a runtime that executes the built program — either:

- **LiteSVM** (Rust, fastest): `litesvm` loads `target/deploy/reflect_allocation.so`
  produced by `anchor build` / `cargo build-sbf`, or
- **`anchor test`** (TS + local validator).

Both require the Solana platform tools (BPF toolchain), which are not part of a
plain `rustup` install — see the root `README.md` → "Toolchain".

## Test matrix (maps to the brief's success criteria)

| # | Scenario | Setup | Assert |
|---|----------|-------|--------|
| 1 | **Brake prevents NCN spin** | feed with `min_interval_slots` set; submit rapidly diverging values across back-to-back windows | second `finalize_sample` returns `Brake`; ring does **not** advance (`tick` unchanged) |
| 2 | **Window consensus** | operators submit at `X+3`, `X+9`, … within one window | one `Sample` lands; value = median/trimmed-mean of submissions |
| 3 | **Quorum miss** | `count < min_number` at close | `finalize_sample` → `QuorumNotMet`; ring does not advance |
| 4 | **No trigger** | value within `threshold_bps` and `< max_interval_slots` since last | `finalize_sample` → `NoTrigger`; ring does not advance |
| 5 | **Forced refresh** | idle past `max_interval_slots` with unchanged value | ring advances (staleness life-sign) |
| 6 | **Unauthorised signer** | non-registered signer calls `propose_sample` | rejected with `UnauthorizedOperator` |
| 7 | **Weight renormalisation** | consumers submit vectors; finalize | `AllocationState.weights` sums to exactly `10_000` |
| 8 | **Cross-operator determinism** | two consumers, identical snapshot | identical submitted vectors |
| 9 | **Account sizing** | init all four account types on-chain | succeeds within the 10 KB single-account budget |

## LiteSVM test template (Rust)

Place in a dedicated `sims` crate (kept out of the program workspace so it doesn't
pull the test harness into `cargo test`). Pseudocode:

```rust
use litesvm::LiteSVM;
// 1. let mut svm = LiteSVM::new();
// 2. svm.add_program_from_file(reflect_allocation::ID, "target/deploy/reflect_allocation.so")?;
// 3. fund admin + operator keypairs; init_registry; add_operator(s)
// 4. init_data_feed with min_interval_slots set; warp slots with svm.warp_to_slot()
// 5. propose/corroborate_sample at several in-window slots; finalize_sample
// 6. read back the DataFeed account; assert tick / last_value per the matrix above
```
