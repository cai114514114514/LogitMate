use serde::Serialize;
use std::path::Path;

const MAX_FILES: usize = 20_000;
const MAX_DEPTH: usize = 6;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelFiles {
    /// Absolute folder that holds the model3.json.
    pub dir: String,
    /// The model3.json file name inside `dir`.
    pub model3_file: String,
    /// Every file under `dir`, relative to it, with "/" separators.
    pub files: Vec<String>,
}

pub fn list(model3_path: &str) -> Result<ModelFiles, String> {
    let path = Path::new(model3_path);
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    if !path.is_file() || !name.to_lowercase().ends_with(".model3.json") {
        return Err(format!("不是 model3.json 文件：{model3_path}"));
    }
    let dir = path.parent().ok_or("模型文件没有上级目录")?;
    let mut files = Vec::new();
    walk(dir, dir, 0, &mut files);
    files.sort();
    Ok(ModelFiles {
        dir: dir.to_string_lossy().into_owned(),
        model3_file: name.to_string(),
        files,
    })
}

fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<String>) {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let p = entry.path();
        if p.is_dir() {
            walk(root, &p, depth + 1, out);
        } else if let Ok(rel) = p.strip_prefix(root) {
            let parts: Vec<_> = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect();
            out.push(parts.join("/"));
            if out.len() >= MAX_FILES {
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_nested_files_and_skips_hidden() {
        let dir = std::env::temp_dir().join(format!("logitmate-files-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("Exp3")).unwrap();
        std::fs::write(dir.join("鱼.model3.json"), "{}").unwrap();
        std::fs::write(dir.join("Exp3/脸红.exp3.json"), "{}").unwrap();
        std::fs::write(dir.join(".DS_Store"), "").unwrap();

        let l = list(dir.join("鱼.model3.json").to_str().unwrap()).unwrap();
        assert_eq!(l.model3_file, "鱼.model3.json");
        assert_eq!(l.files, vec!["Exp3/脸红.exp3.json", "鱼.model3.json"]);
        assert!(list(dir.join("Exp3/脸红.exp3.json").to_str().unwrap()).is_err());
        std::fs::remove_dir_all(dir).ok();
    }
}
