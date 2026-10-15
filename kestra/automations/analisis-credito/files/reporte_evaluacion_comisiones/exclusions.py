"""Explicit test-member exclusions, applied to whole applications in every month."""
from __future__ import annotations

from dataclasses import replace
from reporte_evaluacion_report.core import MonthDataset

EXCLUDED_TEST_MEMBERS = {110380: "Nicolás Sallito: solicitudes de prueba"}


def exclude_test_applications(dataset: MonthDataset) -> tuple[MonthDataset, list[int]]:
    # A state change by this user on a real member's application is not a test.
    # Identify the member, then remove the entire application, including events
    # whose own projected member number is missing or different.
    excluded = {event.solicitud_oid
                for event in (*dataset.month_events, *dataset.history_events)
                if event.nro_socio in EXCLUDED_TEST_MEMBERS}
    return replace(
        dataset,
        month_events=[event for event in dataset.month_events if event.solicitud_oid not in excluded],
        closed_solicitud_oids=[oid for oid in dataset.closed_solicitud_oids if oid not in excluded],
        history_events=[event for event in dataset.history_events if event.solicitud_oid not in excluded],
    ), sorted(excluded & set(dataset.closed_solicitud_oids))
