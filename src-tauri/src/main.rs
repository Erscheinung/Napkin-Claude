// Prevents an extra console window on Windows in release; harmless on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The same binary doubles as the Claude Code hook handler: `napkin hook`.
    match std::env::args().nth(1).as_deref() {
        Some("hook") => std::process::exit(napkin_lib::hook::run()),
        Some("statusline") => std::process::exit(napkin_lib::hook::statusline()),
        _ => {}
    }
    napkin_lib::run();
}
