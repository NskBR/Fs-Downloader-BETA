use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, Mutex,
    },
};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct SchedulerState {
    active: usize,
    limit: usize,
}

pub struct QueuePermit {
    scheduler: Arc<(Mutex<SchedulerState>, Notify)>,
}
impl Drop for QueuePermit {
    fn drop(&mut self) {
        if let Ok(mut state) = self.scheduler.0.lock() {
            state.active = state.active.saturating_sub(1);
        }
        self.scheduler.1.notify_waiters();
    }
}

const ACTION_NONE: u8 = 0;
const ACTION_PAUSE: u8 = 1;
const ACTION_CANCEL: u8 = 2;

#[derive(Clone)]
pub struct TaskControl {
    pub cancellation: CancellationToken,
    action: Arc<AtomicU8>,
}

impl TaskControl {
    pub fn new() -> Self {
        Self {
            cancellation: CancellationToken::new(),
            action: Arc::new(AtomicU8::new(ACTION_NONE)),
        }
    }
    pub fn pause(&self) {
        self.action.store(ACTION_PAUSE, Ordering::SeqCst);
        self.cancellation.cancel();
    }
    pub fn cancel(&self) {
        self.action.store(ACTION_CANCEL, Ordering::SeqCst);
        self.cancellation.cancel();
    }
    pub fn abort(&self) {
        self.cancellation.cancel();
    }
    pub fn was_paused(&self) -> bool {
        self.action.load(Ordering::SeqCst) == ACTION_PAUSE
    }
    pub fn was_cancelled(&self) -> bool {
        self.action.load(Ordering::SeqCst) == ACTION_CANCEL
    }
}

#[derive(Clone, Default)]
pub struct DownloadRuntime {
    tasks: Arc<Mutex<HashMap<String, TaskControl>>>,
    scheduler: Arc<(Mutex<SchedulerState>, Notify)>,
}

impl DownloadRuntime {
    pub async fn acquire(
        &self,
        limit: usize,
        control: &TaskControl,
    ) -> Result<QueuePermit, String> {
        let limit = limit.clamp(1, 50);
        loop {
            {
                let mut state = self
                    .scheduler
                    .0
                    .lock()
                    .map_err(|_| "Falha ao acessar a fila de downloads.".to_string())?;
                state.limit = limit;
                if state.active < state.limit {
                    state.active += 1;
                    return Ok(QueuePermit {
                        scheduler: self.scheduler.clone(),
                    });
                }
            }
            tokio::select! {
                _ = self.scheduler.1.notified() => {},
                _ = control.cancellation.cancelled() => return Err("Download removido da fila.".into()),
            }
        }
    }
    pub fn register(&self, id: String, control: TaskControl) -> Result<(), String> {
        let mut tasks = self
            .tasks
            .lock()
            .map_err(|_| "Falha ao acessar downloads ativos.".to_string())?;
        if tasks.contains_key(&id) {
            return Err("Este download já está ativo.".into());
        }
        tasks.insert(id, control);
        Ok(())
    }
    pub fn pause(&self, id: &str) -> Result<bool, String> {
        self.signal(id, true)
    }
    pub fn cancel(&self, id: &str) -> Result<bool, String> {
        self.signal(id, false)
    }
    fn signal(&self, id: &str, pause: bool) -> Result<bool, String> {
        let tasks = self
            .tasks
            .lock()
            .map_err(|_| "Falha ao acessar downloads ativos.".to_string())?;
        if let Some(control) = tasks.get(id) {
            if pause {
                control.pause()
            } else {
                control.cancel()
            };
            return Ok(true);
        }
        Ok(false)
    }
    pub fn remove(&self, id: &str) {
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.remove(id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pause_and_cancel_have_distinct_intents() {
        let paused = TaskControl::new();
        paused.pause();
        assert!(paused.was_paused());
        assert!(!paused.was_cancelled());
        let cancelled = TaskControl::new();
        cancelled.cancel();
        assert!(cancelled.was_cancelled());
        assert!(!cancelled.was_paused());
    }

    #[tokio::test]
    async fn scheduler_honors_parallel_limit() {
        let runtime = DownloadRuntime::default();
        let first = TaskControl::new();
        let second = TaskControl::new();
        let permit = runtime.acquire(1, &first).await.unwrap();
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(20),
            runtime.acquire(1, &second)
        )
        .await
        .is_err());
        drop(permit);
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(100),
            runtime.acquire(1, &second)
        )
        .await
        .is_ok());
    }
}
