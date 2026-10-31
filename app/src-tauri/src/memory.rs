//! Memory v1: the conversation log and facts about the user, in SQLite.

use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;

#[derive(Serialize, Debug, PartialEq)]
pub struct StoredMessage {
    pub role: String,
    pub content: String,
}

pub struct Memory {
    db: Mutex<Connection>,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl Memory {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn in_memory() -> rusqlite::Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(db: Connection) -> rusqlite::Result<Self> {
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS messages (
                 id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS facts (
                 id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, text TEXT NOT NULL UNIQUE);",
        )?;
        Ok(Self { db: Mutex::new(db) })
    }

    pub fn append(&self, role: &str, content: &str) -> rusqlite::Result<()> {
        self.db.lock().unwrap().execute(
            "INSERT INTO messages (ts, role, content) VALUES (?1, ?2, ?3)",
            params![now(), role, content],
        )?;
        Ok(())
    }

    /// The latest `limit` messages, oldest first.
    pub fn recent(&self, limit: u32) -> rusqlite::Result<Vec<StoredMessage>> {
        let db = self.db.lock().unwrap();
        let mut stmt = db.prepare(
            "SELECT role, content FROM (SELECT id, role, content FROM messages ORDER BY id DESC LIMIT ?1) ORDER BY id",
        )?;
        let rows = stmt.query_map([limit], |r| Ok(StoredMessage { role: r.get(0)?, content: r.get(1)? }))?;
        rows.collect()
    }

    /// Remembers a fact; repeating a known fact is a no-op.
    pub fn add_fact(&self, text: &str) -> rusqlite::Result<()> {
        let text = text.trim();
        if text.is_empty() {
            return Ok(());
        }
        self.db.lock().unwrap().execute(
            "INSERT OR IGNORE INTO facts (ts, text) VALUES (?1, ?2)",
            params![now(), text],
        )?;
        Ok(())
    }

    pub fn facts(&self, limit: u32) -> rusqlite::Result<Vec<String>> {
        let db = self.db.lock().unwrap();
        let mut stmt = db.prepare("SELECT text FROM facts ORDER BY id DESC LIMIT ?1")?;
        let rows = stmt.query_map([limit], |r| r.get(0))?;
        rows.collect()
    }

    pub fn forget_all(&self) -> rusqlite::Result<()> {
        self.db.lock().unwrap().execute_batch("DELETE FROM messages; DELETE FROM facts;")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_recent_messages_in_order_and_dedupes_facts() {
        let m = Memory::in_memory().unwrap();
        for i in 0..5 {
            m.append("user", &format!("u{i}")).unwrap();
        }
        let recent: Vec<_> = m.recent(3).unwrap().into_iter().map(|x| x.content).collect();
        assert_eq!(recent, ["u2", "u3", "u4"]);

        m.add_fact("喜欢猫").unwrap();
        m.add_fact(" 喜欢猫 ").unwrap();
        m.add_fact("").unwrap();
        m.add_fact("在学 Rust").unwrap();
        assert_eq!(m.facts(10).unwrap(), ["在学 Rust", "喜欢猫"]);

        m.forget_all().unwrap();
        assert!(m.recent(10).unwrap().is_empty() && m.facts(10).unwrap().is_empty());
    }
}
