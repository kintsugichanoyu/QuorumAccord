//! Shared infrastructure for reflect producer / consumer daemons.
//!
//! - [`window`]       deterministic tick-window maths
//! - [`anchor_codec`] Anchor instruction wire format (no on-chain crate dependency)
//! - [`pda`]          PDA derivations matching the program seeds
//! - [`ix`]           instruction builders
//! - [`feed_view`]    read-only byte view over a `DataFeed` account
//! - [`rpc`]          RPC pool with failover + minimum-context-slot reads
//! - [`tx`]           transaction submission with retry
//! - [`config`]       environment-driven configuration

pub mod anchor_codec;
pub mod config;
pub mod feed_view;
pub mod ix;
pub mod pda;
pub mod rpc;
pub mod tx;
pub mod window;

pub use config::WorkerConfig;
pub use feed_view::DataFeedView;
pub use rpc::RpcPool;
