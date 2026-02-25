// memory_persist.rs — Memory persistence: save/load MemoryEntry vectors to disk.
//
// Uses impl-block extension pattern:
// EidolonMcpServer methods live here, struct definition remains in main.rs.

use crate::types::MemoryEntry;
use crate::EidolonMcpServer;
use std::path::Path;

impl EidolonMcpServer {
    pub(crate) fn load_memories_from_disk_sync(
        path: &Path,
    ) -> std::collections::HashMap<crate::types::TenantId, Vec<MemoryEntry>> {
        match std::fs::read_to_string(path) {
            Ok(data) => {
                if let Ok(memories) = serde_json::from_str::<
                    std::collections::HashMap<crate::types::TenantId, Vec<MemoryEntry>>,
                >(&data)
                {
                    eprintln!(
                        "[Eidolon] Loaded memories for {} tenants from {:?}",
                        memories.len(),
                        path
                    );
                    memories
                } else if let Ok(legacy_memories) = serde_json::from_str::<Vec<MemoryEntry>>(&data)
                {
                    eprintln!(
                        "[Eidolon] Migrating {} legacy memories to default tenant from {:?}",
                        legacy_memories.len(),
                        path
                    );
                    let mut map = std::collections::HashMap::new();
                    map.insert("default".to_string(), legacy_memories);
                    map
                } else {
                    eprintln!(
                        "[Eidolon] Failed to parse memories from {:?}. Starting fresh.",
                        path
                    );
                    std::collections::HashMap::new()
                }
            }
            Err(_) => {
                eprintln!(
                    "[Eidolon] No memory file at {:?}. Starting with empty memory.",
                    path
                );
                std::collections::HashMap::new()
            }
        }
    }

    /// Save memories to disk asynchronously.
    /// IMPORTANT: Clones data while holding lock, then releases lock BEFORE
    /// async I/O to avoid blocking concurrent memory pushes.
    pub(crate) async fn save_memories_to_disk(&self) {
        let serialized = {
            let mems = self.memories.write().await;
            serde_json::to_string(&*mems).ok()
        };
        // Lock is dropped here — other tasks can push to memories

        if let Some(data) = serialized {
            let path = self.memories_file_path.as_ref();
            if let Err(e) = tokio::fs::write(path, data).await {
                eprintln!("[Eidolon] Failed to save memories to {:?}: {}", path, e);
            }
        }
    }
}
