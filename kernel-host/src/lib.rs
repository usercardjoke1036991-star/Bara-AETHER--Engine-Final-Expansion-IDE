//! Sidecar del kernel y el supervisor que lo mantiene vivo.
//!
//! El binario habla JSON por stdin/stdout. El proceso del IDE enlaza este
//! crate sólo para lanzarlo y para la jaula de archivos: las operaciones del
//! kernel las ejecuta el hijo.

#![forbid(unsafe_code)]

#[path = "../../src-tauri/src/workspace.rs"]
pub mod workspace;

#[allow(dead_code)]
#[path = "../../src-tauri/src/telemetry.rs"]
pub(crate) mod telemetry;

#[path = "../../src-tauri/src/graph.rs"]
pub(crate) mod graph;

#[allow(dead_code)]
#[path = "../../src-tauri/src/completion.rs"]
pub(crate) mod completion;

#[path = "../../src-tauri/src/auto_apply.rs"]
pub(crate) mod auto_apply;

#[path = "../../src-tauri/src/local_infer.rs"]
pub(crate) mod local_infer;

#[path = "../../src-tauri/src/global_transmute.rs"]
pub(crate) mod global_transmute;

#[path = "../../src-tauri/src/idle_worker.rs"]
pub(crate) mod idle_worker;

pub mod dispatch;
pub mod supervisor;

pub use supervisor::{new_group, terminate_tree, KernelHost, KernelStatus};
