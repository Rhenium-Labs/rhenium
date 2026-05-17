use anyhow::{Context, Result};
use heed::types::*;
use heed::{Database, Env, EnvOpenOptions};
use std::fs;
use std::path::Path;

/// A thin wrapper around LMDB via the `heed` crate.
///
/// Provides simple get/put/delete operations with JSON-encoded values.
pub struct KvStore {
    env: Env,
    db: Database<Str, Str>,
}

impl KvStore {
    /// Opens or creates an LMDB database at the given path.
    pub fn open(path: &str) -> Result<Self> {
        let path = Path::new(path);
        fs::create_dir_all(path).context("Failed to create KV store directory")?;

        let env = unsafe {
            EnvOpenOptions::new()
                .map_size(256 * 1024 * 1024) // 256 MB max
                .max_dbs(1)
                .open(path)
                .context("Failed to open LMDB environment")?
        };

        let mut wtxn = env.write_txn().context("Failed to create write txn")?;
        let db: Database<Str, Str> = env
            .create_database(&mut wtxn, Some("kv"))
            .context("Failed to create database")?;
        wtxn.commit().context("Failed to commit initial txn")?;

        Ok(Self { env, db })
    }

    /// Retrieves a JSON-deserialized value by key.
    pub fn get<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        let rtxn = self.env.read_txn()?;
        match self.db.get(&rtxn, key)? {
            Some(value) => {
                let parsed = serde_json::from_str(value)?;
                Ok(Some(parsed))
            }
            None => Ok(None),
        }
    }

    /// Stores a JSON-serialized value by key.
    pub fn put<T: serde::Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let json = serde_json::to_string(value)?;
        let mut wtxn = self.env.write_txn()?;
        self.db.put(&mut wtxn, key, &json)?;
        wtxn.commit()?;
        Ok(())
    }

    /// Deletes a value by key.
    pub fn delete(&self, key: &str) -> Result<bool> {
        let mut wtxn = self.env.write_txn()?;
        let deleted = self.db.delete(&mut wtxn, key)?;
        wtxn.commit()?;
        Ok(deleted)
    }

    /// Checks if a key exists.
    pub fn exists(&self, key: &str) -> Result<bool> {
        let rtxn = self.env.read_txn()?;
        Ok(self.db.get(&rtxn, key)?.is_some())
    }
}
