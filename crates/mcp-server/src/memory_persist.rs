// memory_persist.rs — Memory persistence: save/load MemoryEntry vectors to disk.
//
// Uses impl-block extension pattern:
// EidolonMcpServer methods live here, struct definition remains in main.rs.

use crate::EidolonMcpServer;
use crate::types::MemoryEntry;
use std::path::Path;

impl EidolonMcpServer {
    /// Load memories from disk synchronously (used at startup).
    pub(crate) fn load_memories_from_disk_sync(path: &Path) -> Vec<MemoryEntry> {
        match std::fs::read_to_string(path) {
            Ok(data) => match serde_json::from_str::<Vec<MemoryEntry>>(&data) {
                Ok(memories) => {
                    eprintln!(
                        "[ClawKit] Loaded {} memories from {:?}",
                        memories.len(),
                        path
                    );
                    memories
                }
                Err(e) => {
                    eprintln!(
                        "[ClawKit] Failed to parse memories from {:?}: {}. Starting fresh.",
                        path, e
                    );
                    Vec::new()
                }
            },
            Err(_) => {
                eprintln!(
                    "[ClawKit] No memory file at {:?}. Starting with empty memory.",
                    path
                );
                Vec::new()
            }
        }
    }

    /// Save memories to disk asynchronously.
    /// IMPORTANT: Clones data while holding lock, then releases lock BEFORE
    /// async I/O to avoid blocking concurrent memory pushes.
    pub(crate) async fn save_memories_to_disk(&self) {
        let serialized = {
            let mems = self.memories.lock().await;
            serde_json::to_string(&*mems).ok()
        };
        // Lock is dropped here — other tasks can push to memories

        if let Some(data) = serialized {
            let path = self.memories_file_path.as_ref();
            if let Err(e) = tokio::fs::write(path, data).await {
                eprintln!("[ClawKit] Failed to save memories to {:?}: {}", path, e);
            }
        }
    }
}
