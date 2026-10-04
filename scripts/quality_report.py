#!/usr/bin/env python3
"""Builds one quality-run summary from the raw suite output `scripts/quality-run.sh` collects,
and writes it to `var/quality/<run_id>.json` (see `docs/api/openapi.json`'s
`GET /api/v1/console/quality` for the shape this must match). Never touches patient data: cargo,
vitest and Playwright output here is test names and assertion messages only.

Usage: quality_report.py <work_dir> <out_dir> <run_id> <started_at> <finished_at> <environment> \
       <commit>

`<work_dir>` holds, per suite key (unit, db, web, e2e):
  <key>.name      the suite's display name (one line)
  <key>.kind      unit | db | web | e2e
  <key>.ms        wall time in milliseconds (integer)
  <key>.cargo.log cargo test's text output, for the unit and db suites
  <key>.vitest.json  vitest's --reporter=json output, for the web suite
  <key>.playwright.json  Playwright's --reporter=json output, for the e2e suite
  <key>.counts    "passed failed skipped" when a suite was skipped outright (no log to parse)
A suite directory with none of these present is left out of the report.
"""

import json
import re
import sys
from pathlib import Path

MESSAGE_LIMIT = 300
SUITE_KEYS = ["unit", "db", "web", "e2e"]
ANSI = re.compile(r"\x1b\[[0-9;]*m")

CARGO_RESULT = re.compile(
    r"test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored;"
)
CARGO_FAILURE_LIST = re.compile(r"^failures:\n((?:    \S.*\n)+)\ntest result:", re.MULTILINE)
CARGO_PANIC = re.compile(
    r"---- (?P<test>\S+) stdout ----\n(?:thread '[^']*' panicked at [^\n]+\n)?(?P<message>[^\n]*)"
)


def truncate(message: str) -> str:
    message = ANSI.sub("", message).strip() or "see the suite's own log; no message was captured"
    return message if len(message) <= MESSAGE_LIMIT else message[: MESSAGE_LIMIT - 1] + "…"


def parse_cargo_log(text: str) -> tuple[int, int, int, list[dict]]:
    """Sums every binary's `test result:` line, and reads failing test names and messages."""
    passed = failed = ignored = 0
    for match in CARGO_RESULT.finditer(text):
        passed += int(match.group(1))
        failed += int(match.group(2))
        ignored += int(match.group(3))

    messages: dict[str, str] = {}
    for match in CARGO_PANIC.finditer(text):
        messages.setdefault(match.group("test"), match.group("message"))

    failures: list[dict] = []
    seen: set[str] = set()
    for block in CARGO_FAILURE_LIST.finditer(text):
        for name in block.group(1).split():
            if name in seen:
                continue
            seen.add(name)
            failures.append({"test": name, "message": truncate(messages.get(name, ""))})
    return passed, failed, ignored, failures


def parse_vitest_json(data: dict) -> tuple[int, int, int, list[dict]]:
    passed = data.get("numPassedTests", 0)
    failed = data.get("numFailedTests", 0)
    skipped = data.get("numPendingTests", 0) + data.get("numTodoTests", 0)
    failures: list[dict] = []
    for result in data.get("testResults", []):
        for assertion in result.get("assertionResults", []):
            if assertion.get("status") != "failed":
                continue
            message = "; ".join(assertion.get("failureMessages", [])) or "failed"
            failures.append({"test": assertion.get("fullName", "unknown test"), "message": truncate(message)})
    return passed, failed, skipped, failures


def parse_playwright_json(data: dict) -> tuple[int, int, int, list[dict]]:
    passed = failed = skipped = 0
    failures: list[dict] = []

    def walk(suite: dict, prefix: str) -> None:
        nonlocal passed, failed, skipped
        title = f"{prefix}{suite.get('title', '')} › " if suite.get("title") else prefix
        for spec in suite.get("specs", []):
            name = f"{title}{spec.get('title', 'unknown test')}"
            for test in spec.get("tests", []):
                outcome = test.get("status", "unexpected")
                if outcome in ("expected", "flaky"):
                    passed += 1
                elif outcome == "skipped":
                    skipped += 1
                else:
                    failed += 1
                    last = (test.get("results") or [{}])[-1]
                    errors = last.get("errors") or [{}]
                    error = errors[0].get("message", "failed") or "failed"
                    failures.append({"test": name, "message": truncate(error)})
        for child in suite.get("suites", []):
            walk(child, title)

    for suite in data.get("suites", []):
        walk(suite, "")
    return passed, failed, skipped, failures


def load(path: Path) -> str | None:
    return path.read_text() if path.exists() else None


def build_suite(work_dir: Path, key: str) -> dict | None:
    name_file = work_dir / f"{key}.name"
    if not name_file.exists():
        return None
    name = name_file.read_text().strip()
    kind = (work_dir / f"{key}.kind").read_text().strip()
    duration_ms = int((work_dir / f"{key}.ms").read_text().strip()) if (work_dir / f"{key}.ms").exists() else 0

    counts_file = work_dir / f"{key}.counts"
    if counts_file.exists():
        passed, failed, skipped = (int(n) for n in counts_file.read_text().split())
        failures: list[dict] = []
    elif (log := load(work_dir / f"{key}.cargo.log")) is not None:
        passed, failed, skipped, failures = parse_cargo_log(log)
    elif (raw := load(work_dir / f"{key}.vitest.json")) is not None:
        passed, failed, skipped, failures = parse_vitest_json(json.loads(raw))
    elif (raw := load(work_dir / f"{key}.playwright.json")) is not None:
        passed, failed, skipped, failures = parse_playwright_json(json.loads(raw))
    else:
        passed = failed = skipped = 0
        failures = []

    return {
        "name": name,
        "kind": kind,
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "duration_ms": duration_ms,
        "failures": failures,
    }


def main() -> None:
    work_dir, out_dir, run_id, started_at, finished_at, environment, commit = (
        Path(sys.argv[1]),
        Path(sys.argv[2]),
        *sys.argv[3:8],
    )
    suites = [s for key in SUITE_KEYS if (s := build_suite(work_dir, key)) is not None]
    report = {
        "run_id": run_id,
        "started_at": started_at,
        "finished_at": finished_at,
        "environment": environment,
        "commit": commit,
        "suites": suites,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{run_id}.json"
    out_path.write_text(json.dumps(report, indent=2) + "\n")

    print(f"wrote {out_path}")
    for suite in suites:
        total = suite["passed"] + suite["failed"] + suite["skipped"]
        print(
            f"  {suite['name']:<28} {suite['kind']:<5} "
            f"{suite['passed']}/{total} passed, {suite['failed']} failed, {suite['skipped']} skipped "
            f"({suite['duration_ms']} ms)"
        )
    if any(s["failed"] > 0 for s in suites):
        sys.exit(1)


if __name__ == "__main__":
    main()
