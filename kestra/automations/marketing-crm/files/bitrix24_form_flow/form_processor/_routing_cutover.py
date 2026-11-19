from datetime import datetime, timezone


# Compare source timestamps so replaying a job cannot enroll an older case.
NEW_ROUTING_FROM = datetime(2026, 11, 19, 14, 0, tzinfo=timezone.utc)


def new_routing_enabled(received_at: object) -> bool:
    if isinstance(received_at, str):
        try:
            received_at = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
        except ValueError:
            return False
    return (
        isinstance(received_at, datetime)
        and received_at.utcoffset() is not None
        and received_at >= NEW_ROUTING_FROM
    )
