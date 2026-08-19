from __future__ import annotations

import logging
from concurrent.futures import Future, ThreadPoolExecutor, wait
from threading import BoundedSemaphore, Lock
from time import monotonic
from typing import Any, Callable

from .metamap_resource import extract_validation_enrichment
from .metrics import MetricsRegistry


logger = logging.getLogger(__name__)


class BackgroundEnricher:
    def __init__(
        self,
        *,
        store: Any,
        resource_fetcher: Callable[[str], Any] | None,
        metrics: MetricsRegistry,
        max_workers: int,
        queue_size: int,
    ) -> None:
        self._store = store
        self._resource_fetcher = resource_fetcher
        self._metrics = metrics
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="metamap-enrichment",
        )
        self._capacity = BoundedSemaphore(max_workers + queue_size)
        self._lock = Lock()
        self._pending_ids: set[str] = set()
        self._futures: set[Future] = set()
        self._update_pending_gauge()

    def submit(self, *, verification_id: str, resource_url: str) -> bool:
        if self._resource_fetcher is None:
            return False
        with self._lock:
            if verification_id in self._pending_ids:
                self._metrics.increment("metamap_enrichment_deduplicated_total")
                return False
            if not self._capacity.acquire(blocking=False):
                self._metrics.increment("metamap_enrichment_dropped_total", reason="queue_full")
                logger.warning(
                    "MetaMap enrichment queue full: verification_id=%s resource=%s",
                    verification_id,
                    resource_url,
                )
                return False
            self._pending_ids.add(verification_id)
            pending = len(self._pending_ids)
        try:
            future = self._executor.submit(self._run, verification_id, resource_url)
        except RuntimeError:
            with self._lock:
                self._pending_ids.discard(verification_id)
                self._capacity.release()
            self._metrics.increment(
                "metamap_enrichment_dropped_total", reason="executor_stopped"
            )
            self._update_pending_gauge()
            return False
        with self._lock:
            self._futures.add(future)
        future.add_done_callback(
            lambda completed: self._on_done(verification_id, completed)
        )
        self._metrics.increment("metamap_enrichment_submitted_total")
        self._metrics.set_gauge("metamap_enrichment_pending", pending)
        return True

    def _run(self, verification_id: str, resource_url: str) -> None:
        started_at = monotonic()
        try:
            resource_payload = self._resource_fetcher(resource_url)  # type: ignore[misc]
            enrichment = extract_validation_enrichment(resource_payload)
            if not any(
                [
                    enrichment.request_number,
                    enrichment.loan_number,
                    enrichment.amount_raw,
                    enrichment.amount_value,
                    enrichment.requested_amount_raw,
                    enrichment.requested_amount_value,
                    enrichment.applicant_name,
                    enrichment.document_number,
                ]
            ):
                self._metrics.increment("metamap_enrichment_completed_total", outcome="empty")
                return
            self._store.update_validation_enrichment(
                verification_id=verification_id,
                request_number=enrichment.request_number,
                loan_number=enrichment.loan_number,
                amount_raw=enrichment.amount_raw,
                amount_value=enrichment.amount_value,
                requested_amount_raw=enrichment.requested_amount_raw,
                requested_amount_value=enrichment.requested_amount_value,
                applicant_name=enrichment.applicant_name,
                document_number=enrichment.document_number,
            )
            self._metrics.increment("metamap_enrichment_completed_total", outcome="stored")
        except Exception as exc:
            self._metrics.increment("metamap_enrichment_completed_total", outcome="failed")
            logger.warning(
                "MetaMap resource hydration failed: verification_id=%s resource=%s error=%s",
                verification_id,
                resource_url,
                exc,
            )
        finally:
            self._metrics.observe_duration(
                "metamap_enrichment_duration_seconds", monotonic() - started_at
            )

    def _on_done(self, verification_id: str, future: Future) -> None:
        with self._lock:
            self._pending_ids.discard(verification_id)
            self._futures.discard(future)
            pending = len(self._pending_ids)
            self._capacity.release()
        self._metrics.set_gauge("metamap_enrichment_pending", pending)

    def wait_for_idle(self, timeout: float = 5.0) -> bool:
        with self._lock:
            futures = list(self._futures)
        if not futures:
            return True
        _, not_done = wait(futures, timeout=timeout)
        return not not_done

    def shutdown(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=False)

    def _update_pending_gauge(self) -> None:
        self._metrics.set_gauge("metamap_enrichment_pending", 0)
