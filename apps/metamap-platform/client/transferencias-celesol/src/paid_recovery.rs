//! Receipt recovery only: this module has no bank client or transfer capability.
use std::time::Duration;

use anyhow::{Result, bail};

pub const INTERVAL: Duration = Duration::from_secs(30);
pub const WINDOW: Duration = Duration::from_secs(600);

#[derive(Debug, PartialEq, Eq)]
pub enum PaidState {
    Paid,
    Pending,
    Other(String),
}

pub fn recover(
    mut check: impl FnMut() -> Result<PaidState>,
    mut submit: impl FnMut() -> Result<()>,
    mut wait: impl FnMut(Duration),
    mut elapsed: impl FnMut() -> Duration,
) -> Result<()> {
    let mut accepted = false;
    // Leave time for an ambiguous prior request to finish before observing/retrying.
    loop {
        let remaining = WINDOW.saturating_sub(elapsed());
        if remaining.is_zero() {
            bail!(
                "Vencio la recuperacion del comprobante; verificar el core. No repetir la transferencia."
            );
        }
        wait(INTERVAL.min(remaining));
        match check() {
            Ok(PaidState::Paid) => return Ok(()),
            Ok(PaidState::Other(state)) => {
                bail!("El core tiene un estado inesperado ({state}); no se reenvio el comprobante.")
            }
            Ok(PaidState::Pending) if !accepted && elapsed() < WINDOW => {
                // A successful upload is still verified by EvaluateList on the next cycle.
                // An uncertain failure is never retried without another explicit Pending.
                match submit() {
                    Ok(()) => accepted = true,
                    Err(error) if !retryable(&error) => return Err(error),
                    Err(_) => {}
                }
            }
            Ok(PaidState::Pending) | Err(_) => {}
        }
    }
}

pub fn retryable(error: &anyhow::Error) -> bool {
    if let Some(http) = error.downcast_ref::<crate::mark_paid_client::MarkPaidHttpError>() {
        return http.status_code >= 500 || matches!(http.status_code, 408 | 429);
    }
    error.downcast_ref::<reqwest::Error>().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn already_paid_never_uploads() {
        recover(
            || Ok(PaidState::Paid),
            || panic!("must not upload"),
            |_| {},
            || Duration::ZERO,
        )
        .unwrap();
    }

    #[test]
    fn pending_upload_is_verified_before_success() {
        let checks = Cell::new(0);
        let uploads = Cell::new(0);
        recover(
            || {
                checks.set(checks.get() + 1);
                Ok(if checks.get() == 1 {
                    PaidState::Pending
                } else {
                    PaidState::Paid
                })
            },
            || {
                uploads.set(uploads.get() + 1);
                Ok(())
            },
            |_| {},
            || Duration::ZERO,
        )
        .unwrap();
        assert_eq!(checks.get(), 2);
        assert_eq!(uploads.get(), 1);
    }

    #[test]
    fn unavailable_core_never_uploads_and_expires() {
        let clock = Cell::new(Duration::ZERO);
        assert!(
            recover(
                || bail!("offline"),
                || panic!("must not upload"),
                |d| clock.set(clock.get() + d),
                || clock.get()
            )
            .is_err()
        );
        assert_eq!(clock.get(), WINDOW);
    }

    #[test]
    fn unexpected_state_stops() {
        assert!(
            recover(
                || Ok(PaidState::Other("Anulada".into())),
                || panic!("must not upload"),
                |_| {},
                || Duration::ZERO
            )
            .is_err()
        );
    }

    #[test]
    fn pending_is_bounded_and_does_not_upload_at_deadline() {
        let clock = Cell::new(Duration::ZERO);
        let uploads = Cell::new(0);
        assert!(
            recover(
                || Ok(PaidState::Pending),
                || {
                    uploads.set(uploads.get() + 1);
                    Ok(())
                },
                |d| clock.set(clock.get() + d),
                || clock.get()
            )
            .is_err()
        );
        assert_eq!(uploads.get(), 1);
    }
}
