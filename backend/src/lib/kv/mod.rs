use heed::types::*;
use heed::{Database, Env, EnvOpenOptions};
use std::fs;
use std::path::Path;

use crate::error::KvError;

/// A thin wrapper around LMDB via the `heed` crate.
///
/// Provides simple get/put/delete operations with JSON-encoded values.
pub struct KvStore {
    env: Env,
    db: Database<Str, Str>,
}

impl KvStore {
    /// Opens or creates an LMDB database at the given path.
    pub fn open(path: &str) -> Result<Self, KvError> {
        let path = Path::new(path);
        fs::create_dir_all(path)?;

        let env = unsafe {
            EnvOpenOptions::new()
                .map_size(256 * 1024 * 1024) // 256 MB max
                .max_dbs(1)
                .open(path)?
        };

        let mut wtxn = env.write_txn()?;
        let db: Database<Str, Str> = env.create_database(&mut wtxn, Some("kv"))?;
        wtxn.commit()?;

        Ok(Self { env, db })
    }

    /// Retrieves a JSON-deserialized value by key.
    pub fn get<T: serde::de::DeserializeOwned>(&self, key: &str) -> Result<Option<T>, KvError> {
        let rtxn = self.env.read_txn()?;
        match self.db.get(&rtxn, key)? {
            Some(value) => Ok(Some(serde_json::from_str(value)?)),
            None => Ok(None),
        }
    }

    /// Stores a JSON-serialized value by key.
    pub fn put<T: serde::Serialize>(&self, key: &str, value: &T) -> Result<(), KvError> {
        let json = serde_json::to_string(value)?;
        let mut wtxn = self.env.write_txn()?;
        self.db.put(&mut wtxn, key, &json)?;
        wtxn.commit()?;
        Ok(())
    }

    /// Deletes a value by key.
    pub fn delete(&self, key: &str) -> Result<bool, KvError> {
        let mut wtxn = self.env.write_txn()?;
        let deleted = self.db.delete(&mut wtxn, key)?;
        wtxn.commit()?;
        Ok(deleted)
    }

    /// Checks if a key exists.
    pub fn exists(&self, key: &str) -> Result<bool, KvError> {
        let rtxn = self.env.read_txn()?;
        Ok(self.db.get(&rtxn, key)?.is_some())
    }
}
