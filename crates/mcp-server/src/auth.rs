// auth.rs — User identity resolution and persistent profile storage.
//
// Extracted from main.rs. Uses impl-block extension pattern:
// EidolonMcpServer methods live here, struct definition remains in main.rs.

use crate::EidolonMcpServer;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

impl EidolonMcpServer {
    pub(crate) fn resolve_users_file_path() -> PathBuf {
        if let Ok(explicit_path) = std::env::var("EIDOLON_USERS_PATH") {
            let trimmed = explicit_path.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }

        let mut candidates = Vec::new();
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(PathBuf::from(home).join(".eidolon").join("users.json"));
        }
        if let Ok(cwd) = std::env::current_dir() {
            candidates.push(cwd.join("data").join("memory").join("users.json"));
        }
        candidates.push(PathBuf::from("/tmp/.eidolon/users.json"));

        for path in candidates {
            if Self::is_users_path_writable(&path) {
                return path;
            }
        }

        PathBuf::from("/tmp/.eidolon/users.json")
    }

    pub(crate) fn is_users_path_writable(path: &Path) -> bool {
        let Some(parent) = path.parent() else {
            return false;
        };
        if fs::create_dir_all(parent).is_err() {
            return false;
        }

        let probe_path = parent.join(format!(
            ".eidolon-write-probe-{}",
            chrono::Utc::now()
                .timestamp_nanos_opt()
                .unwrap_or_else(|| chrono::Utc::now().timestamp_micros() * 1000)
        ));

        let result = File::create(&probe_path)
            .and_then(|mut file| {
                file.write_all(b"ok")?;
                file.sync_all()
            })
            .is_ok();

        let _ = fs::remove_file(&probe_path);
        result
    }

    pub(crate) fn load_users_from_disk_sync(
        path: &Path,
    ) -> HashMap<crate::types::TenantId, HashMap<String, serde_json::Value>> {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(users) = serde_json::from_str::<
                HashMap<crate::types::TenantId, HashMap<String, serde_json::Value>>,
            >(&data)
            {
                users
            } else if let Ok(legacy_users) =
                serde_json::from_str::<HashMap<String, serde_json::Value>>(&data)
            {
                let mut map = HashMap::new();
                map.insert("default".to_string(), legacy_users);
                map
            } else {
                HashMap::new()
            }
        } else {
            HashMap::new()
        }
    }

    pub(crate) fn save_users_to_disk_sync(
        path: &Path,
        users: &HashMap<crate::types::TenantId, HashMap<String, serde_json::Value>>,
    ) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let tmp_suffix = chrono::Utc::now()
            .timestamp_nanos_opt()
            .unwrap_or_else(|| chrono::Utc::now().timestamp_micros() * 1000);
        let temp_path = path.with_extension(format!("tmp.{}", tmp_suffix));
        let json = serde_json::to_vec_pretty(users).map_err(|err| err.to_string())?;

        let write_result = (|| -> Result<(), String> {
            let mut file = File::create(&temp_path).map_err(|err| err.to_string())?;
            file.write_all(&json).map_err(|err| err.to_string())?;
            file.sync_all().map_err(|err| err.to_string())?;

            if let Err(rename_err) = fs::rename(&temp_path, path) {
                if path.exists() {
                    fs::remove_file(path).map_err(|err| err.to_string())?;
                    fs::rename(&temp_path, path).map_err(|err| err.to_string())?;
                } else {
                    return Err(rename_err.to_string());
                }
            }

            if let Some(parent) = path.parent() {
                if let Ok(parent_dir) = File::open(parent) {
                    let _ = parent_dir.sync_all();
                }
            }
            Ok(())
        })();

        if write_result.is_err() {
            let _ = fs::remove_file(&temp_path);
        }

        write_result
    }

    pub(crate) async fn save_users_to_disk(&self) {
        let users_snapshot = { self.users.write().await.clone() };
        let users_path = (*self.users_file_path).clone();
        if let Ok(Err(err)) = tokio::task::spawn_blocking(move || {
            Self::save_users_to_disk_sync(&users_path, &users_snapshot)
        })
        .await
        {
            eprintln!("[Eidolon] user profile persistence failed: {}", err);
        }
    }
}
