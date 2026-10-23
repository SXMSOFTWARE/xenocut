pub mod commands;
pub mod music;
pub mod renderer;
pub mod separator;
pub mod traits;

use std::thread;
use std::time::Duration;

use traits::ProgressSink;

pub fn drive(progress: &dyn ProgressSink, steps: &[(f32, &str)]) {
    for (index, (amount, message)) in steps.iter().enumerate() {
        if index > 0 {
            thread::sleep(Duration::from_millis(170));
        }
        progress.report(*amount, message);
    }
}
