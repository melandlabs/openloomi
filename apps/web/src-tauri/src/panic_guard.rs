// Copyright 2026 openloomi Team. All rights reserved.
//
// Use of this source code is governed by a license that can be
// found in the LICENSE file in the root of this source tree.

//! Small helpers to contain unexpected panics from native / FFI dependencies.

use std::any::Any;
use std::cell::RefCell;
use std::future::Future;
use std::panic::{catch_unwind, AssertUnwindSafe, PanicHookInfo};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::task::{Context, Poll};

#[derive(Clone)]
struct GuardedPanicContext {
    name: String,
    reported: Arc<AtomicBool>,
}

thread_local! {
    static GUARDED_CONTEXTS: RefCell<Vec<GuardedPanicContext>> = const { RefCell::new(Vec::new()) };
}

struct GuardedPanicGuard;

impl GuardedPanicGuard {
    fn enter(context: &str, reported: Arc<AtomicBool>) -> Self {
        GUARDED_CONTEXTS.with(|contexts| {
            contexts.borrow_mut().push(GuardedPanicContext {
                name: context.to_string(),
                reported,
            });
        });
        Self
    }
}

impl Drop for GuardedPanicGuard {
    fn drop(&mut self) {
        GUARDED_CONTEXTS.with(|contexts| {
            contexts.borrow_mut().pop();
        });
    }
}

struct RecoverableFuture<Fut> {
    context: String,
    reported: Arc<AtomicBool>,
    future: Option<Pin<Box<Fut>>>,
}

impl<Fut> RecoverableFuture<Fut> {
    fn new(context: &str, reported: Arc<AtomicBool>, future: Fut) -> Self {
        Self {
            context: context.to_string(),
            reported,
            future: Some(Box::pin(future)),
        }
    }
}

impl<Fut> Unpin for RecoverableFuture<Fut> {}

impl<Fut: Future> Future for RecoverableFuture<Fut> {
    type Output = Fut::Output;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.as_mut().get_mut();
        let _guard = GuardedPanicGuard::enter(&this.context, this.reported.clone());
        let future = this
            .future
            .as_mut()
            .expect("recoverable future polled after completion");
        future.as_mut().poll(cx)
    }
}

impl<Fut> Drop for RecoverableFuture<Fut> {
    fn drop(&mut self) {
        if let Some(future) = self.future.take() {
            let _guard = GuardedPanicGuard::enter(&self.context, self.reported.clone());
            drop(future);
        }
    }
}

#[cfg(test)]
fn current_recoverable_context() -> Option<String> {
    current_guarded_context().map(|context| context.name)
}

fn current_guarded_context() -> Option<GuardedPanicContext> {
    GUARDED_CONTEXTS.with(|contexts| contexts.borrow().last().cloned())
}

fn mark_guarded_panic_reported() {
    if let Some(context) = current_guarded_context() {
        context.reported.store(true, Ordering::SeqCst);
    }
}

/// Run the previously-installed (default) panic hook for fatal panics.
pub fn run_fatal_panic_hook(
    message: &str,
    location: &str,
    info: &PanicHookInfo<'_>,
    default_hook: &(dyn Fn(&PanicHookInfo<'_>) + Sync + Send),
) {
    log::error!("[panic] Fatal panic at {location}: {message}");
    default_hook(info);
}

fn caught_panic_error(
    payload: Box<dyn Any + Send>,
    context: &str,
    _reported: &Arc<AtomicBool>,
) -> String {
    let message = panic_message(payload);
    log::error!("[panic] {context}: {message}");
    format!("{context} failed unexpectedly: {message}")
}

/// Best-effort string for a caught panic payload.
pub fn panic_message(payload: Box<dyn Any + Send>) -> String {
    if let Some(msg) = payload.downcast_ref::<&str>() {
        return (*msg).to_string();
    }
    if let Some(msg) = payload.downcast_ref::<String>() {
        return msg.clone();
    }
    "unknown panic".to_string()
}

fn panic_message_ref(payload: &(dyn Any + Send)) -> String {
    if let Some(msg) = payload.downcast_ref::<&str>() {
        return (*msg).to_string();
    }
    if let Some(msg) = payload.downcast_ref::<String>() {
        return msg.clone();
    }
    "unknown panic".to_string()
}

fn panic_location(info: &PanicHookInfo<'_>) -> String {
    info.location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_else(|| "unknown location".to_string())
}

/// Handle a panic hook callback for guard-protected code.
///
/// Rust invokes the global panic hook before `catch_unwind` receives the
/// payload. Returning true tells the caller that this was a guarded,
/// recoverable panic and fatal cleanup should be skipped.
pub fn handle_guarded_panic_hook(
    info: &PanicHookInfo<'_>,
    default_hook: &(dyn Fn(&PanicHookInfo<'_>) + Sync + Send),
) -> bool {
    let Some(context) = current_guarded_context() else {
        return false;
    };

    let message = panic_message_ref(info.payload());
    let location = panic_location(info);
    log::error!(
        "[panic] Recoverable panic in {} at {}: {}",
        context.name,
        location,
        message
    );
    mark_guarded_panic_reported();
    default_hook(info);
    true
}

/// Run `f` and map an unwind into a log line plus `Err` string.
pub fn catch_unwind_str<F, T>(context: &str, f: F) -> Result<T, String>
where
    F: FnOnce() -> T,
{
    catch_unwind_guarded_str(context, f)
}

fn catch_unwind_guarded_str<F, T>(context: &str, f: F) -> Result<T, String>
where
    F: FnOnce() -> T,
{
    let reported = Arc::new(AtomicBool::new(false));
    // Tauri handles, async channels, and native FFI wrappers are often not
    // UnwindSafe even when this boundary is the only place execution continues
    // after a panic. Keep the assertion centralized so call sites do not hide
    // it ad hoc; use these helpers only for command/thread boundaries.
    match catch_unwind(AssertUnwindSafe(|| {
        let _guard = GuardedPanicGuard::enter(context, reported.clone());
        f()
    })) {
        Ok(value) => Ok(value),
        Err(payload) => Err(caught_panic_error(payload, context, &reported)),
    }
}

/// Run `f` and return `default` when the closure unwinds.
pub fn catch_unwind_or<F, T>(context: &str, default: T, f: F) -> T
where
    F: FnOnce() -> T,
{
    let reported = Arc::new(AtomicBool::new(false));
    match catch_unwind(AssertUnwindSafe(|| {
        let _guard = GuardedPanicGuard::enter(context, reported.clone());
        f()
    })) {
        Ok(value) => value,
        Err(payload) => {
            let _ = caught_panic_error(payload, context, &reported);
            default
        }
    }
}

/// Like `catch_unwind_str`, but for fallible operations that already return `Result`.
pub fn catch_unwind_result<F, T>(context: &str, f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    let reported = Arc::new(AtomicBool::new(false));
    match catch_unwind(AssertUnwindSafe(|| {
        let _guard = GuardedPanicGuard::enter(context, reported.clone());
        f()
    })) {
        Ok(inner) => inner,
        Err(payload) => Err(caught_panic_error(payload, context, &reported)),
    }
}

/// Like `catch_unwind_result`, but for async Tauri command futures.
pub async fn catch_unwind_future_result<Fut, T>(context: &str, future: Fut) -> Result<T, String>
where
    Fut: Future<Output = Result<T, String>>,
{
    use futures_util::FutureExt;

    let reported = Arc::new(AtomicBool::new(false));
    match AssertUnwindSafe(RecoverableFuture::new(context, reported.clone(), future))
        .catch_unwind()
        .await
    {
        Ok(inner) => inner,
        Err(payload) => Err(caught_panic_error(payload, context, &reported)),
    }
}

/// Flatten `spawn_blocking` + inner `Result` from panic guards.
pub fn flatten_spawn_result<T, E: std::fmt::Display>(
    join: Result<Result<T, String>, E>,
    context: &str,
) -> Result<T, String> {
    match join {
        Ok(inner) => inner,
        Err(err) => Err(format!("{context}: {err}")),
    }
}

/// Lock a `Mutex`, recovering from poisoning by a prior panicking thread.
///
/// A mutex becomes poisoned when a thread panics while holding its guard.
/// Without recovery, later `unwrap()` calls on that same shared state fire the
/// panic hook again, which today tears down the bundled Node.js server.
/// Use this helper for state where continuing with the current inner data is
/// acceptable (e.g. transient download/progress trackers and replaceable
/// handle slots). Poisoning is logged once per recovery, then cleared so the
/// state is treated as healthy again unless another holder panics.
pub fn lock_recovered<'a, T>(mutex: &'a Mutex<T>, context: &str) -> MutexGuard<'a, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::warn!(
                "[panic_guard] Mutex poisoned during {context}; \
                 recovering inner state to keep the app responsive."
            );
            mutex.clear_poison();
            poisoned.into_inner()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        catch_unwind_future_result, catch_unwind_result, current_recoverable_context,
        lock_recovered, RecoverableFuture,
    };
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex};

    #[test]
    fn lock_recovered_clears_poison_after_successful_recovery() {
        let mutex = Mutex::new(0);

        let panic_result = std::panic::catch_unwind(|| {
            let mut guard = mutex.lock().unwrap();
            *guard = 7;
            panic!("poison test mutex");
        });

        assert!(panic_result.is_err());
        assert!(mutex.is_poisoned());

        {
            let mut guard = lock_recovered(&mutex, "test mutex recovery");
            assert_eq!(*guard, 7);
            *guard = 8;
        }

        assert!(!mutex.is_poisoned());
        assert_eq!(*mutex.lock().unwrap(), 8);
    }

    #[test]
    fn catch_unwind_result_marks_sync_panic_as_recoverable() {
        let result = catch_unwind_result("sync test command", || {
            assert_eq!(
                current_recoverable_context().as_deref(),
                Some("sync test command")
            );
            panic!("sync command panic");
            #[allow(unreachable_code)]
            Ok::<(), String>(())
        });

        let error = result.expect_err("panic should become an error");
        assert!(error.contains("sync test command failed unexpectedly"));
        assert!(error.contains("sync command panic"));
    }

    #[tokio::test]
    async fn catch_unwind_future_result_maps_async_panic_to_error() {
        let result = catch_unwind_future_result("async test command", async {
            tokio::task::yield_now().await;
            assert_eq!(
                current_recoverable_context().as_deref(),
                Some("async test command")
            );
            panic!("async command panic");
            #[allow(unreachable_code)]
            Ok::<(), String>(())
        })
        .await;

        let error = result.expect_err("panic should become an error");
        assert!(error.contains("async test command failed unexpectedly"));
        assert!(error.contains("async command panic"));
    }

    #[test]
    fn recoverable_future_drop_panic_keeps_context() {
        struct PanicOnDrop {
            observed_context: Arc<Mutex<Option<String>>>,
        }

        impl Drop for PanicOnDrop {
            fn drop(&mut self) {
                *self.observed_context.lock().unwrap() = current_recoverable_context();
                panic!("drop panic");
            }
        }

        let observed_context = Arc::new(Mutex::new(None));
        let future = RecoverableFuture::new(
            "async drop test command",
            Arc::new(AtomicBool::new(false)),
            PanicOnDrop {
                observed_context: observed_context.clone(),
            },
        );

        let panic_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            drop(future);
        }));

        assert!(panic_result.is_err());
        assert_eq!(
            observed_context.lock().unwrap().as_deref(),
            Some("async drop test command")
        );
    }
}
