from __future__ import annotations

from collections import defaultdict
from threading import Lock


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _labels(values: tuple[tuple[str, str], ...]) -> str:
    if not values:
        return ""
    rendered = ",".join(f'{key}="{_escape_label(value)}"' for key, value in values)
    return "{" + rendered + "}"


class MetricsRegistry:
    def __init__(self) -> None:
        self._lock = Lock()
        self._counters: dict[tuple[str, tuple[tuple[str, str], ...]], float] = defaultdict(float)
        self._gauges: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
        self._durations: dict[
            tuple[str, tuple[tuple[str, str], ...]], tuple[int, float, float]
        ] = {}

    def increment(self, name: str, **labels: str) -> None:
        key = (name, tuple(sorted(labels.items())))
        with self._lock:
            self._counters[key] += 1

    def set_gauge(self, name: str, value: float, **labels: str) -> None:
        key = (name, tuple(sorted(labels.items())))
        with self._lock:
            self._gauges[key] = value

    def observe_duration(self, name: str, seconds: float, **labels: str) -> None:
        key = (name, tuple(sorted(labels.items())))
        with self._lock:
            count, total, maximum = self._durations.get(key, (0, 0.0, 0.0))
            self._durations[key] = (count + 1, total + seconds, max(maximum, seconds))

    def render_prometheus(self) -> str:
        with self._lock:
            counters = list(self._counters.items())
            gauges = list(self._gauges.items())
            durations = list(self._durations.items())

        lines: list[str] = []
        for (name, labels), value in sorted(counters):
            lines.append(f"{name}{_labels(labels)} {value:g}")
        for (name, labels), value in sorted(gauges):
            lines.append(f"{name}{_labels(labels)} {value:g}")
        for (name, labels), (count, total, maximum) in sorted(durations):
            label_text = _labels(labels)
            lines.append(f"{name}_count{label_text} {count}")
            lines.append(f"{name}_sum{label_text} {total:.9f}")
            lines.append(f"{name}_max{label_text} {maximum:.9f}")
        return "\n".join(lines) + "\n"
