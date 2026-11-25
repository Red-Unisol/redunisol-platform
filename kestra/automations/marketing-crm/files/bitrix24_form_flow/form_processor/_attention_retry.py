"""Durable attention retries on pending CRM deals. Only technical IDs and UTC times."""
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone


PREFIX = "attention_retry_v1|"
HORIZON = timedelta(hours=24)


@dataclass(frozen=True)
class AttentionRetry:
    lead: int
    contact: int
    first: datetime
    due: datetime
    attempts: int = 0
    chat: int = 0
    session: int = 0

    @property
    def sessions(self):
        return {self.chat: self.session} if self.chat else None

    def next(self, now, sessions=None, opening=None):
        attempt = self.attempts + 1
        delay = timedelta(minutes=min(30, 2 ** min(attempt - 1, 5)))
        due = min(opening or (now + delay), self.first + HORIZON)
        chat, session = self.chat, self.session
        if not chat and sessions and len(sessions) == 1:
            chat, session = next(iter(sessions.items()))
            if not session:
                chat, session = 0, 0
        return replace(self, due=due, attempts=attempt, chat=chat, session=session)

    def encode(self):
        return PREFIX + "|".join(map(str, (self.lead, self.contact, int(self.first.timestamp()),
                                           int(self.due.timestamp()), self.attempts, self.chat, self.session)))


def read_marker(raw):
    if not isinstance(raw, str) or not raw.startswith(PREFIX):
        return None
    parts = raw[len(PREFIX):].split("|")
    if len(parts) != 7 or not all(p.isascii() and p.isdigit() and len(p) <= 18 for p in parts):
        raise ValueError("invalid_attention_retry_marker")
    lead, contact, first, due, attempts, chat, session = map(int, parts)
    if not lead or not 0 < first <= due <= first + 86400 or not 0 < attempts <= 2000 or bool(chat) != bool(session):
        raise ValueError("invalid_attention_retry_marker")
    try:
        return AttentionRetry(lead, contact, datetime.fromtimestamp(first, timezone.utc),
                              datetime.fromtimestamp(due, timezone.utc), attempts, chat, session)
    except (OverflowError, OSError, ValueError):
        raise ValueError("invalid_attention_retry_marker") from None
