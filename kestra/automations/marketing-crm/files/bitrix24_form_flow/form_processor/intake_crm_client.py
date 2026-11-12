"""Bounded retries for intake reads; uncertain writes are never repeated."""
from __future__ import annotations

import time
from urllib.error import HTTPError, URLError


READ_METHODS = frozenset({
    "crm.status.list", "crm.lead.fields", "crm.lead.list", "crm.lead.get",
    "crm.contact.list", "crm.contact.get", "crm.deal.list", "crm.duplicate.findbycomm", "imopenlines.dialog.get",
    "crm.activity.get", "imopenlines.session.history.get", "user.get",
})
TRANSIENT_HTTP_CODES = frozenset({429, 500, 502, 503, 504})


def _transient(error: Exception) -> bool:
    if isinstance(error, HTTPError):
        return error.code in TRANSIENT_HTTP_CODES
    if isinstance(error, (TimeoutError, ConnectionError, URLError)):
        return True
    return isinstance(error, RuntimeError) and any(token in str(error).lower() for token in (
        "http 429", "http 500", "http 502", "http 503", "http 504",
        "error de red", "too many requests", "query_limit_exceeded",
    ))


class IntakeCrmClient:
    def __init__(self, client, *, sleep=time.sleep, clock=time.monotonic,
                 retry_window_seconds=15):
        self.client = client
        self.sleep = sleep
        self.clock = clock
        # Only start extra attempts in this intake-wide window. Individual
        # calls retain the configured transport timeout; this is not a hard
        # deadline for an in-flight request. A long timeout gets no retry.
        self.deadline = clock() + retry_window_seconds
        self.write_attempted = False

    def _invoke(self, method, operation):
        read = method in READ_METHODS
        if not read:
            self.write_attempted = True
        for attempt in range(1, 4):
            try:
                return operation()
            except Exception as error:
                # Retain the original exception without logging its message,
                # request, response, credentials or customer identity.
                error.intake_crm_method = method
                error.intake_crm_attempts = attempt
                error.intake_crm_write_attempted = self.write_attempted
                # Bitrix shares its quota with other automations. Give an
                # explicit quota response more time to drain than a network
                # interruption; never apply either retry policy to writes.
                limited = any(token in str(error).lower() for token in (
                    "query_limit_exceeded", "too many requests", "http 429",
                )) or isinstance(error, HTTPError) and error.code == 429
                delay = 2 ** (attempt if limited else attempt - 1)
                if (not read or not _transient(error) or attempt == 3
                        or self.clock() + delay >= self.deadline):
                    raise
                self.sleep(delay)

    def call(self, method, payload):
        return self._invoke(method, lambda: self.client.call(method, payload))

    def get_lead_field(self, name):
        return self._invoke("crm.lead.fields", lambda: self.client.get_lead_field(name))
