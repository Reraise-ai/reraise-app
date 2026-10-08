# SPDX-License-Identifier: Apache-2.0
# Copyright The Worldbuilder contributors
"""The cron scripts and the installer, run for real with a stub `wb` (and, where available, the real
one). Hermes no-agent semantics (hermes-agent cron docs): empty stdout is a silent tick, any output
is delivered, a non-zero exit is an error alert."""

from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest
from harness.schema_check import REPO_ROOT
from test_wb_verify import WB, drive_task, task_record

CRON = Path(__file__).resolve().parents[1] / "cron"
SCRIPTS = CRON / "scripts"
SH = shutil.which("sh")
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(SH is None, reason="no POSIX sh")

STUB = """#!/bin/sh
# stub wb: records its arguments and the files of every directory argument
printf 'ARGS: %s\\n' "$*" >> "$STUB_LOG"
for a in "$@"; do
  if [ -d "$a" ]; then printf 'DIR: %s\\n' "$(ls -1 "$a" | sort | tr '\\n' '|')" >> "$STUB_LOG"; fi
done
printf '%s' "$STUB_STDOUT"
[ -n "$STUB_STDERR" ] && printf '%s' "$STUB_STDERR" >&2
exit "${STUB_EXIT:-0}"
"""


class Env:
    def __init__(self, tmp: Path) -> None:
        self.tmp = tmp
        self.stub = tmp / "wb-stub.sh"
        self.stub.write_text(STUB)
        self.stub.chmod(0o755)
        self.log = tmp / "stub.log"
        self.conf = tmp / "worldbuilder-loop.conf"
        self.tasks = tmp / "task records"
        self.tasks.mkdir()
        self.settings = {
            "WB_BIN": str(self.stub),
            "WB_STORE": str(tmp / "store"),
            "WB_TASKS_DIR": str(self.tasks),
            "WB_STATE_DIR": str(tmp / "state"),
        }
        self.extra: dict[str, str] = {}

    def write_conf(self, **overrides: str | None) -> None:
        merged = {**self.settings, **{k: v for k, v in overrides.items() if v is not None}}
        for key in [k for k, v in overrides.items() if v is None]:
            merged.pop(key, None)
        self.conf.write_text("# test\n" + "".join(f"{k}={v}\n" for k, v in merged.items()), encoding="utf-8")

    def run(self, script: str, **stub: str) -> subprocess.CompletedProcess[str]:
        env = {
            "PATH": os.environ["PATH"],
            "HOME": str(self.tmp),
            "WB_LOOP_CONF": str(self.conf),
            "STUB_LOG": str(self.log),
            "STUB_STDOUT": stub.get("stdout", ""),
            "STUB_STDERR": stub.get("stderr", ""),
            "STUB_EXIT": stub.get("exit", "0"),
        }
        assert SH is not None
        return subprocess.run(
            [SH, str(SCRIPTS / script)], capture_output=True, text=True, env=env, timeout=60, check=False
        )

    def calls(self) -> list[str]:
        return self.log.read_text().splitlines() if self.log.exists() else []


@pytest.fixture
def env(tmp_path: Path) -> Env:
    e = Env(tmp_path)
    e.write_conf()
    return e


# --- settings file ------------------------------------------------------------------------------


def test_an_unknown_key_in_the_settings_file_is_an_error(env: Env) -> None:
    env.conf.write_text("WB_STROE=/typo\n")
    result = env.run("wb-nightly-digest.sh")
    assert result.returncode == 2 and "unknown key 'WB_STROE'" in result.stderr
    assert env.calls() == []


def test_the_settings_file_is_parsed_not_executed(env: Env, tmp_path: Path) -> None:
    canary = tmp_path / "canary"
    env.write_conf(WB_STORE=f"$(touch {canary})")
    env.run("wb-nightly-digest.sh")
    assert not canary.exists()
    assert f"--store $(touch {canary})" in env.calls()[0]  # the value is passed on literally


def test_crlf_settings_files_work(env: Env) -> None:
    env.conf.write_bytes(f"WB_BIN={env.stub}\r\nWB_STORE=/s\r\n".encode())
    assert env.run("wb-nightly-digest.sh").returncode == 0
    assert env.calls()[0] == "ARGS: digest --store /s"


# --- nightly digest ---------------------------------------------------------------------------------


def test_digest_success_is_silent_and_passes_the_settings(env: Env) -> None:
    env.write_conf(WB_ATLAS_DIR="/atlas out", WB_GATE_RULES="/rules.yaml")
    result = env.run("wb-nightly-digest.sh", stdout="wrote 3 pages\n")
    assert (result.returncode, result.stdout) == (0, "")
    assert env.calls() == [
        f"ARGS: digest --store {env.settings['WB_STORE']} --out /atlas out --gate-rules /rules.yaml --state {env.settings['WB_STATE_DIR']}"
    ]


def test_digest_failure_is_delivered_with_wb_s_exit_code(env: Env) -> None:
    result = env.run("wb-nightly-digest.sh", stdout="boom", stderr="unreadable store", exit="2")
    assert result.returncode == 2
    assert "digest FAILED (wb exit 2)" in result.stdout and "unreadable store" in result.stdout


def test_digest_needs_a_store(env: Env) -> None:
    env.write_conf(WB_STORE=None)
    result = env.run("wb-nightly-digest.sh")
    assert result.returncode == 2 and "WB_STORE is not set" in result.stderr and env.calls() == []


# --- nightly validation -----------------------------------------------------------------------------


def _record(env: Env, name: str, age_hours: float) -> Path:
    path = env.tasks / name
    path.write_text(f"---\ntaskRef: {name}\n---\n")
    stamp = time.time() - age_hours * 3600
    os.utime(path, (stamp, stamp))
    return path


def test_validate_checks_only_todays_records_in_one_run(env: Env) -> None:
    _record(env, "old.md", 40)
    _record(env, "new one.md", 2)
    (env.tasks / "sub").mkdir()
    _record(env, "sub/second.json", 1)
    result = env.run("wb-nightly-validate.sh")
    assert (result.returncode, result.stdout) == (0, "")
    calls = env.calls()
    assert (
        len(calls) == 2
        and calls[0].startswith("ARGS: receipts verify ")
        and calls[0].endswith(f" --state {env.settings['WB_STATE_DIR']}")
    )
    names = {re.sub(r"^\d+-", "", f) for f in calls[1].removeprefix("DIR: ").split("|") if f}
    assert names == {"new one.md", "second.json"}  # the old record is not verified; spaces survive


def test_validate_without_todays_records_is_silent_and_does_not_call_wb(env: Env) -> None:
    _record(env, "old.md", 72)
    result = env.run("wb-nightly-validate.sh")
    assert (result.returncode, result.stdout) == (0, "") and env.calls() == []


def test_validate_lookback_is_configurable(env: Env) -> None:
    _record(env, "old.md", 40)
    env.write_conf(WB_TASK_LOOKBACK_HOURS="48")
    env.run("wb-nightly-validate.sh")
    assert env.calls() != []


def test_validate_reports_rejected_work(env: Env) -> None:
    _record(env, "t.md", 1)
    result = env.run("wb-nightly-validate.sh", stdout="TASK-1: knowledge: missing", exit="1")
    assert result.returncode == 1
    assert "NO VALID RECEIPTS" in result.stdout and "TASK-1: knowledge: missing" in result.stdout


def test_validate_reports_a_broken_log_with_exit_3(env: Env) -> None:
    _record(env, "t.md", 1)
    result = env.run("wb-nightly-validate.sh", stdout="chain broken at seq 4", exit="3")
    assert result.returncode == 3 and "BROKEN" in result.stdout and "tamper" in result.stdout


def test_validate_cannot_verify_without_a_task_folder(env: Env) -> None:
    env.write_conf(WB_TASKS_DIR=str(env.tmp / "missing"))
    assert env.run("wb-nightly-validate.sh").returncode == 2
    env.write_conf(WB_TASKS_DIR=None)
    assert env.run("wb-nightly-validate.sh").returncode == 2


def test_validate_cleans_up_its_temporary_files(env: Env, tmp_path: Path) -> None:
    _record(env, "t.md", 1)
    before = set(os.listdir(os.environ.get("TMPDIR", "/tmp")))
    env.run("wb-nightly-validate.sh")
    after = set(os.listdir(os.environ.get("TMPDIR", "/tmp")))
    assert not [n for n in after - before if n.startswith("tmp.")]


# --- weekly metrics ---------------------------------------------------------------------------------


def test_weekly_metrics_prints_the_report_even_when_targets_are_not_met(env: Env) -> None:
    for code in ("0", "1"):
        result = env.run("wb-weekly-metrics.sh", stdout="target agent_cards_7d: 0 >= 5: NOT MET\n", exit=code)
        assert result.returncode == 0 and "NOT MET" in result.stdout
    assert "metrics --check --tasks" in env.calls()[0]


def test_weekly_metrics_fails_when_wb_fails(env: Env) -> None:
    result = env.run("wb-weekly-metrics.sh", stdout="x", stderr="broken log", exit="3")
    assert result.returncode == 3 and "metrics FAILED (wb exit 3)" in result.stdout


# --- watchdog -----------------------------------------------------------------------------------------


def metrics_json(lag: float | None, accepted: int, proposed: int = 0) -> str:
    return json.dumps(
        {
            "atlas": {"pages": 1, "stalePages": 0, "lagHours": lag},
            "totals": {"cardsAccepted": accepted, "cardsProposed": proposed},
        }
    )


needs_node = pytest.mark.skipif(NODE is None, reason="no node (wb needs it too)")


@needs_node
def test_watchdog_is_silent_when_healthy(env: Env) -> None:
    result = env.run("wb-watchdog.sh", stdout=metrics_json(0, 6))
    assert (result.returncode, result.stdout) == (0, "")
    assert "metrics --json --store" in env.calls()[0]


@needs_node
@pytest.mark.parametrize(
    ("lag", "accepted", "proposed", "expected"),
    [
        (73.5, 6, 0, ["atlas: out of date for 73.5 h (limit 72 h)"]),
        (None, 6, 0, ["atlas: no pages, or the lag cannot be determined"]),
        (0, 0, 4, ["cards: no agent card accepted in the last 7 days (4 proposed)"]),
        (96, 0, 0, ["atlas: out of date for 96 h", "0 proposed"]),
    ],
)
def test_watchdog_speaks_up_when_the_loop_stopped(env: Env, lag, accepted, proposed, expected) -> None:  # type: ignore[no-untyped-def]
    result = env.run("wb-watchdog.sh", stdout=metrics_json(lag, accepted, proposed))
    assert result.returncode == 0 and "needs attention" in result.stdout
    for text in expected:
        assert text in result.stdout


@needs_node
def test_watchdog_threshold_is_exactly_three_days_by_default_and_configurable(env: Env) -> None:
    assert env.run("wb-watchdog.sh", stdout=metrics_json(72, 1)).stdout == ""  # not more than 3 days
    env.write_conf(WB_MAX_ATLAS_LAG_HOURS="24")
    assert "out of date for 72 h (limit 24 h)" in env.run("wb-watchdog.sh", stdout=metrics_json(72, 1)).stdout


@needs_node
def test_watchdog_failures_are_not_silence(env: Env) -> None:
    failed = env.run("wb-watchdog.sh", stdout="", stderr="unreadable store", exit="2")
    assert failed.returncode == 2 and "wb metrics FAILED" in failed.stdout and "unreadable store" in failed.stdout
    garbled = env.run("wb-watchdog.sh", stdout="not json")
    assert garbled.returncode == 2 and "cannot read the metrics" in garbled.stdout


@needs_node
def test_watchdog_ignores_wb_warnings_on_stderr(env: Env) -> None:
    result = env.run("wb-watchdog.sh", stdout=metrics_json(0, 6), stderr="warning: no gate rules\n")
    assert (result.returncode, result.stdout) == (0, "")


def test_watchdog_needs_a_store(env: Env) -> None:
    env.write_conf(WB_STORE=None)
    assert env.run("wb-watchdog.sh").returncode == 2


# --- the same scripts against the real wb ---------------------------------------------------------------


@pytest.mark.needs_wb
@pytest.mark.skipif(WB is None or NODE is None, reason="no real wb")
def test_validate_and_metrics_scripts_with_the_real_wb(make_world, tmp_path: Path) -> None:  # type: ignore[no-untyped-def]
    wb, hermes = make_world()
    good = drive_task(wb, hermes, "TASK-2026-0200")
    tasks = tmp_path / "records"
    tasks.mkdir()
    (tasks / "good.md").write_text(task_record(good), encoding="utf-8")
    now = wb.now()

    real_dir = tmp_path / "real"
    real_dir.mkdir()
    real = Env(real_dir)
    real.settings.update(
        WB_BIN=" ".join(WB),
        WB_TASKS_DIR=str(tasks),
        WB_STATE_DIR=str(wb.state_dir),
        WB_STORE=str(REPO_ROOT / "examples" / "hormuz"),
    )
    real.write_conf()
    run = lambda script: real.run(script)  # noqa: E731

    ok = run("wb-nightly-validate.sh")
    assert (ok.returncode, ok.stdout) == (0, ""), ok.stdout + ok.stderr

    (tasks / "lazy.md").write_text(
        f"---\ntaskRef: TASK-LAZY\nagent: agent:orchestrator\ncompletedAt: {now}\n---\n", encoding="utf-8"
    )
    bad = run("wb-nightly-validate.sh")
    assert bad.returncode == 1 and "NO VALID RECEIPTS" in bad.stdout and "missing" in bad.stdout

    report = run("wb-weekly-metrics.sh")
    assert report.returncode == 0 and "Knowledge-loop metrics" in report.stdout

    watchdog = run("wb-watchdog.sh")
    assert watchdog.returncode == 0, watchdog.stdout + watchdog.stderr
    assert "needs attention" in watchdog.stdout and "no agent card accepted" in watchdog.stdout

    digest = run("wb-nightly-digest.sh")
    assert digest.returncode == 0, digest.stdout + digest.stderr


# --- the installer ---------------------------------------------------------------------------------------

JOBS = {
    "worldbuilder-nightly-digest": ("17 2 * * *", "wb-nightly-digest.sh"),
    "worldbuilder-nightly-validate": ("37 3 * * *", "wb-nightly-validate.sh"),
    "worldbuilder-weekly-metrics": ("23 7 * * MON", "wb-weekly-metrics.sh"),
    "worldbuilder-watchdog": ("41 6 * * *", "wb-watchdog.sh"),
}


def _install(
    tmp: Path, *args: str, existing: str = "", list_fails: bool = False, create_fails: bool = False
) -> tuple[subprocess.CompletedProcess[str], Path, Path]:
    home = tmp / "hermes-home"
    bin_dir = tmp / "bin"
    bin_dir.mkdir(exist_ok=True)
    log = tmp / "hermes.log"
    fake = bin_dir / "hermes"
    fake.write_text(
        '#!/bin/sh\nif [ "$1 $2" = "cron list" ]; then\n'
        '  [ -n "$HERMES_LIST_FAILS" ] && exit 1\n  printf \'%s\' "$HERMES_EXISTING"; exit 0\nfi\n'
        'printf \'%s\\0\' "$@" >> "$HERMES_LOG"; printf \'\\n\' >> "$HERMES_LOG"\n'
        '[ -n "$HERMES_CREATE_FAILS" ] && exit 3\nexit 0\n'
    )
    fake.chmod(0o755)
    env = {
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "HOME": str(tmp),
        "HERMES_LOG": str(log),
        "HERMES_EXISTING": existing,
        "HERMES_LIST_FAILS": "1" if list_fails else "",
        "HERMES_CREATE_FAILS": "1" if create_fails else "",
    }
    assert SH is not None
    result = subprocess.run(
        [SH, str(CRON / "install-cron.sh"), "--hermes-home", str(home), *args],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
        check=False,
    )
    return result, home, log


def _created(log: Path) -> list[list[str]]:
    if not log.exists():
        return []
    lines = [ln for ln in log.read_text().split("\n") if ln]
    return [[p for p in line.split("\0") if p] for line in lines]


def test_installer_copies_scripts_creates_the_settings_and_the_four_jobs(tmp_path: Path) -> None:
    result, home, log = _install(tmp_path)
    assert result.returncode == 0, result.stderr
    for name in (
        "wb-env.sh",
        "wb-nightly-digest.sh",
        "wb-nightly-validate.sh",
        "wb-weekly-metrics.sh",
        "wb-watchdog.sh",
        "wb-watchdog.ps1",
    ):
        assert (home / "scripts" / name).is_file()
    assert os.access(home / "scripts" / "wb-watchdog.sh", os.X_OK)
    assert (home / "scripts" / "worldbuilder-loop.conf").is_file()
    jobs = _created(log)
    assert [j[:3] for j in jobs] == [["cron", "create", JOBS[n][0]] for n in JOBS]
    for argv in jobs:
        name = argv[argv.index("--name") + 1]
        assert argv[3:] == ["--no-agent", "--script", JOBS[name][1], "--name", name, "--deliver", "local"]


def test_installer_keeps_an_existing_settings_file_and_existing_jobs(tmp_path: Path) -> None:
    home = tmp_path / "hermes-home" / "scripts"
    home.mkdir(parents=True)
    (home / "worldbuilder-loop.conf").write_text("WB_STORE=/mine\n")
    result, _, log = _install(tmp_path, existing="worldbuilder-nightly-digest  worldbuilder-watchdog  other-job")
    assert result.returncode == 0
    assert (home / "worldbuilder-loop.conf").read_text() == "WB_STORE=/mine\n"
    created = [j[j.index("--name") + 1] for j in _created(log)]
    assert created == ["worldbuilder-nightly-validate", "worldbuilder-weekly-metrics"]
    assert "exists; left alone" in result.stdout


def test_installer_dry_run_changes_nothing_and_prints_the_commands(tmp_path: Path) -> None:
    result, home, log = _install(tmp_path, "--dry-run", "--deliver", "telegram")
    assert result.returncode == 0 and not home.exists() and not log.exists()
    for name, (schedule, script) in JOBS.items():
        assert (
            f"[dry-run] hermes cron create '{schedule}' --no-agent --script {script} --name {name} --deliver telegram"
            in result.stdout
        )


def test_installer_reports_failed_jobs_and_exits_non_zero(tmp_path: Path) -> None:
    result, _, log = _install(tmp_path, create_fails=True)
    assert result.returncode == 1
    assert result.stderr.count("FAILED") == 4 and "4 step(s) failed" in result.stderr
    assert "done." not in result.stdout


def test_installer_falls_back_to_the_job_file_when_the_list_fails(tmp_path: Path) -> None:
    cron = tmp_path / "hermes-home" / "cron"
    cron.mkdir(parents=True)
    (cron / "jobs.json").write_text('{"jobs": [{"name": "worldbuilder-watchdog"}]}')
    result, _, log = _install(tmp_path, list_fails=True)
    assert result.returncode == 0 and "hermes cron list failed" in result.stderr
    assert "worldbuilder-watchdog" not in [j[j.index("--name") + 1] for j in _created(log)]
    assert "job worldbuilder-watchdog exists; left alone" in result.stdout


def test_default_task_folder_is_the_one_the_plugin_writes(env: Env, tmp_path: Path) -> None:
    home = tmp_path / "hh"
    folder = home / "worldbuilder" / "task-records"
    folder.mkdir(parents=True)
    _record(env, "x.md", 1)  # a record elsewhere must not be picked up
    (folder / "t.json").write_text("{}")
    env.write_conf(WB_TASKS_DIR=None)
    probe = f'. {SCRIPTS}/wb-env.sh; printf %s "$WB_TASKS_DIR"'
    out = subprocess.run(
        [SH, "-c", probe],
        capture_output=True,
        text=True,
        env={
            "PATH": os.environ["PATH"],
            "HOME": str(tmp_path),
            "HERMES_HOME": str(home),
            "WB_LOOP_CONF": str(env.conf),
        },
        check=False,
    )
    assert out.stdout == str(folder), out.stderr


def test_installer_rejects_unknown_options(tmp_path: Path) -> None:
    result, _, _ = _install(tmp_path, "--frobnicate")
    assert result.returncode == 2


HERMES_SRC = os.environ.get("HERMES_SRC")


@pytest.mark.skipif(
    not HERMES_SRC or not (Path(HERMES_SRC or "x") / "hermes_cli" / "subcommands" / "cron.py").is_file(),
    reason="set HERMES_SRC to a hermes-agent checkout",
)
def test_every_install_command_parses_with_the_real_hermes_cron_parser(tmp_path: Path) -> None:
    """Syntax check against hermes_cli/subcommands/cron.py (the real argparse definition)."""
    _, _, log = _install(tmp_path)
    argvs = _created(log)
    assert len(argvs) == 4
    code = textwrap.dedent(
        """
        import argparse, json, sys
        sys.path.insert(0, sys.argv[1])
        from hermes_cli.subcommands.cron import build_cron_parser
        parser = argparse.ArgumentParser()
        build_cron_parser(parser.add_subparsers(), cmd_cron=lambda a: None)
        out = []
        for argv in json.loads(sys.argv[2]):
            ns = parser.parse_args(argv)
            out.append({k: getattr(ns, k) for k in ("schedule", "script", "name", "deliver", "no_agent", "prompt")})
        print(json.dumps(out))
        """
    )
    done = subprocess.run(
        [sys.executable, "-I", "-c", code, HERMES_SRC or "", json.dumps(argvs)],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert done.returncode == 0, done.stderr
    parsed = json.loads(done.stdout)
    assert [p["name"] for p in parsed] == list(JOBS)
    assert all(p["no_agent"] is True and p["prompt"] is None and p["deliver"] == "local" for p in parsed)


# --- PowerShell variants ----------------------------------------------------------------------------------


def test_every_shell_script_has_a_powershell_variant_with_the_same_settings() -> None:
    sh = sorted(p.stem for p in SCRIPTS.glob("wb-*.sh"))
    ps = sorted(p.stem for p in SCRIPTS.glob("wb-*.ps1"))
    assert sh == ps and len(sh) == 5
    keys = lambda text: set(re.findall(r"\bWB_[A-Z_]+\b", text))  # noqa: E731
    assert keys((SCRIPTS / "wb-env.sh").read_text()) == keys((SCRIPTS / "wb-env.ps1").read_text())
    example = (SCRIPTS / "worldbuilder-loop.conf.example").read_text()
    assert keys(example) <= keys((SCRIPTS / "wb-env.sh").read_text())
    assert (CRON / "install-cron.ps1").is_file()


@pytest.mark.skipif(shutil.which("pwsh") is None, reason="no pwsh")
@pytest.mark.parametrize("path", sorted(CRON.rglob("*.ps1")), ids=lambda p: p.name)
def test_powershell_scripts_parse(path: Path) -> None:
    command = f"$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('{path}',[ref]$t,[ref]$e);if($e){{$e|%{{$_.Message}};exit 1}}"
    done = subprocess.run(
        ["pwsh", "-NoProfile", "-Command", command], capture_output=True, text=True, timeout=60, check=False
    )
    assert done.returncode == 0, done.stdout + done.stderr


def test_scripts_are_executable_posix_sh() -> None:
    for path in [*SCRIPTS.glob("*.sh"), CRON / "install-cron.sh"]:
        assert path.read_text().startswith("#!/bin/sh\n"), path
        if path.name != "wb-env.sh":
            assert path.stat().st_mode & stat.S_IXUSR, f"{path.name} is not executable"
        code = [ln for ln in path.read_text().splitlines() if not ln.lstrip().startswith("#")]
        assert not [ln for ln in code if "[[" in ln or re.match(r"\s*local\s", ln)], f"{path.name}: bashism"


# --- pending write-back outbox (ADR-0046) -----------------------------------------------------------------

OUTBOX_CLI = CRON.parent / "plugins" / "worldbuilder-knowledge-loop" / "outbox.py"


def _outbox(env: Env, *ages_hours: float) -> list[dict[str, str]]:
    """Queue one entry per age in the env's outbox, through the same code the plugin uses."""
    pending = env.tmp / "outbox" / "pending-write-back.jsonl"
    env.settings.update(WB_PENDING_FILE=str(pending), WB_OUTBOX_CLI=str(OUTBOX_CLI), WB_PYTHON=sys.executable)
    env.write_conf()
    code = (
        "import sys, importlib.util, datetime as d\n"
        "spec = importlib.util.spec_from_file_location('outbox', sys.argv[1]); m = importlib.util.module_from_spec(spec)\n"
        "sys.modules['outbox'] = m; spec.loader.exec_module(m)\n"
        "box = m.Outbox(sys.argv[2])\n"
        "for hours in sys.argv[3:]:\n"
        "    box.append('agent:x', 'T-1', 'a memory ' + hours, now=d.datetime.now(d.UTC) - d.timedelta(hours=float(hours)))\n"
    )
    done = subprocess.run(
        [sys.executable, "-I", "-c", code, str(OUTBOX_CLI), str(pending), *[str(a) for a in ages_hours]],
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 0, done.stderr
    return [json.loads(line) for line in pending.read_text(encoding="utf-8").splitlines()]


def test_validate_reports_pending_entries_and_exits_non_zero_when_one_is_stale(env: Env) -> None:
    _outbox(env, 30, 2)
    result = env.run("wb-nightly-validate.sh")
    assert result.returncode == 4
    assert "2 pending, 0 blocked" in result.stdout and "older than 24 h" in result.stdout
    assert "a memory" not in result.stdout  # ids and counts only, never the text


def test_validate_reports_fresh_pending_entries_without_failing(env: Env) -> None:
    _outbox(env, 3)
    result = env.run("wb-nightly-validate.sh")
    assert result.returncode == 0 and "1 pending, 0 blocked" in result.stdout


def test_validate_counts_blocked_secret_entries(env: Env) -> None:
    entries = _outbox(env, 30)
    pending = Path(env.settings["WB_PENDING_FILE"])
    entries[0]["status"] = "blocked_secret"
    pending.write_text(json.dumps(entries[0]) + "\n", encoding="utf-8")
    result = env.run("wb-nightly-validate.sh")
    assert result.returncode == 4 and "0 pending, 1 blocked" in result.stdout and "secret-like" in result.stdout


def test_validate_is_silent_with_an_empty_or_missing_outbox(env: Env) -> None:
    env.write_conf(WB_PENDING_FILE=str(env.tmp / "nowhere.jsonl"))
    assert (env.run("wb-nightly-validate.sh").returncode, env.run("wb-nightly-validate.sh").stdout) == (0, "")


def test_validate_keeps_the_receipt_exit_code_when_both_fail(env: Env) -> None:
    _outbox(env, 30)
    _record(env, "t.md", 1)
    result = env.run("wb-nightly-validate.sh", stdout="TASK-1: knowledge: missing", exit="1")
    assert result.returncode == 1
    assert "NO VALID RECEIPTS" in result.stdout and "1 pending, 0 blocked" in result.stdout


def test_a_broken_outbox_check_is_not_silence(env: Env) -> None:
    _outbox(env, 3)
    env.write_conf(WB_OUTBOX_CLI=str(env.tmp / "missing.py"))
    result = env.run("wb-nightly-validate.sh")
    assert result.returncode == 2 and "checker" in result.stdout and "missing" in result.stdout


def test_watchdog_speaks_only_when_pending_entries_are_older_than_a_day(env: Env) -> None:
    healthy = metrics_json(1, 6)
    _outbox(env, 3)
    assert env.run("wb-watchdog.sh", stdout=healthy).stdout == ""
    _outbox(env, 30)
    result = env.run("wb-watchdog.sh", stdout=healthy)
    assert result.returncode == 0 and "pending write-back" in result.stdout and "older than 24 h" in result.stdout


def test_the_pending_limit_is_configurable(env: Env) -> None:
    _outbox(env, 30)
    env.write_conf(WB_PENDING_MAX_AGE_HOURS="48")
    assert env.run("wb-nightly-validate.sh").returncode == 0


def test_validate_reports_a_fresh_blocked_entry_without_failing(env: Env) -> None:
    entries = _outbox(env, 2)
    pending = Path(env.settings["WB_PENDING_FILE"])
    entries[0]["status"] = "blocked_too_long"
    pending.write_text(json.dumps(entries[0]) + "\n", encoding="utf-8")
    result = env.run("wb-nightly-validate.sh")
    assert result.returncode == 0 and "0 pending, 1 blocked" in result.stdout and "too_long" in result.stdout


def test_validate_reports_a_damaged_entry_with_exit_2(env: Env) -> None:
    entries = _outbox(env, 2)
    pending = Path(env.settings["WB_PENDING_FILE"])
    del entries[0]["agent"]
    pending.write_text(json.dumps(entries[0]) + "\n", encoding="utf-8")
    result = env.run("wb-nightly-validate.sh")
    assert result.returncode == 2 and entries[0]["outboxId"] in result.stdout
