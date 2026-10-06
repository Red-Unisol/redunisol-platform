// Standalone, network-free executable for the updater's Windows process tests.
fn main() {
    if std::env::var("TEST_UPDATE_MODE").as_deref() == Ok("crash") {
        std::process::exit(42);
    }
    let root = std::path::PathBuf::from(std::env::var_os("TEST_UPDATE_ROOT").unwrap());
    std::fs::write(root.join("child-cwd.txt"), std::env::current_dir().unwrap().to_string_lossy().as_bytes()).unwrap();
    std::fs::remove_file(root.join(".transferencias-update/pending.json")).unwrap();
}
