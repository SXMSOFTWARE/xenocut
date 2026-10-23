use std::sync::atomic::{AtomicBool, Ordering};

static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn begin() {
    CANCEL.store(false, Ordering::SeqCst);
}

pub fn request() {
    CANCEL.store(true, Ordering::SeqCst);
}

pub fn is_cancelled() -> bool {
    CANCEL.load(Ordering::SeqCst)
}

pub fn check() -> Result<(), super::traits::AudioError> {
    if is_cancelled() {
        Err(super::traits::AudioError::Cancelled)
    } else {
        Ok(())
    }
}
