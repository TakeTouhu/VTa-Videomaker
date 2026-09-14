// Windows release builds must not open a console window alongside the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ai_video_editor_lib::run()
}
