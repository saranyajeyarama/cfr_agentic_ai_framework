#!/usr/bin/env python3
"""Platform-selectable deployment driver (the `driver.*` DEPLOY.md expects).

Reads DEPLOY_PLATFORM + config/<platform>/, exports the resolved Silver target so
the app and the schema-mapping runner agree, optionally runs the Option-B mapping
phase, deploys via the right path, smoke-tests, and ALWAYS prints the live URL.

  py driver.py --platform local                 # docker compose up --build -> localhost:3001
  py driver.py --platform gcp --smoke           # wraps deploy.sh -> Cloud Run URL
  py driver.py --platform databricks            # databricks bundle/apps -> app URL
  py driver.py --platform gcp --map --source proj.client_raw   # run mapping first (gated)
  py driver.py --platform gcp --dry-run         # print resolved config + commands, run nothing

Delegates heavy lifting to the existing deploy.sh / cloudbuild.yaml / docker-compose.yml
rather than duplicating them. --dry-run is host-safe (prints only).
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

# Layout: deployment/scripts/driver.py
SCRIPTS = os.path.dirname(os.path.abspath(__file__))   # deployment/scripts
PKG_ROOT = os.path.dirname(SCRIPTS)                     # the deployment/ folder
ROOT = os.path.dirname(PKG_ROOT)                        # repo root (deploy.sh / docker-compose live here)
CONFIG = os.path.join(PKG_ROOT, "config")               # deployment/config


def _load_platform(platform: str) -> dict:
    pdir = os.path.join(CONFIG, platform)
    silver = os.path.join(pdir, "silver.config.json")
    if not os.path.exists(silver) and platform != "local":
        raise SystemExit(f"no config for platform {platform!r} at {silver}")
    cfg = {"platform": platform, "dir": pdir, "silver": {}, "deploy": {}}
    if os.path.exists(silver):
        with open(silver, encoding="utf-8") as fh:
            cfg["silver"] = json.load(fh)
    dpath = os.path.join(pdir, "deploy.config.json")
    if os.path.exists(dpath):
        with open(dpath, encoding="utf-8") as fh:
            cfg["deploy"] = json.load(fh)
    return cfg


def _export_silver_env(cfg: dict) -> None:
    """Make the app + mapping runner agree on the Silver/decisions target."""
    s = cfg.get("silver", {})
    sem = s.get("semantic_ds")
    dec = s.get("decisions_ds")
    if cfg["platform"] == "databricks":
        cat = s.get("catalog")
        sem = sem or (f"{cat}.{s.get('semantic_schema','tiger_semantic')}" if cat else None)
        dec = dec or (f"{cat}.{s.get('decisions_schema','tiger_decisions')}" if cat else None)
    if sem and not os.environ.get("SEMANTIC_DS"):
        os.environ["SEMANTIC_DS"] = sem
    if dec and not os.environ.get("DECISIONS_DS"):
        os.environ["DECISIONS_DS"] = dec
    os.environ.setdefault("DEPLOY_PLATFORM", cfg["platform"])


def _run(cmd, dry: bool, cwd: str = None) -> int:
    printable = cmd if isinstance(cmd, str) else " ".join(cmd)
    print(f"  $ {printable}")
    if dry:
        return 0
    return subprocess.call(cmd, cwd=cwd, shell=isinstance(cmd, str))


def _capture(cmd, dry: bool) -> str:
    if dry:
        return "<dry-run-url>"
    try:
        return subprocess.check_output(cmd, shell=isinstance(cmd, str),
                                       text=True).strip()
    except Exception as exc:
        print(f"  (could not capture URL: {exc})")
        return ""


def _maybe_map(args, cfg) -> None:
    if not args.map:
        return
    if not args.source:
        raise SystemExit("--map requires --source <client raw namespace>")
    print(f"[map] running schema-mapping (platform={args.platform}, source={args.source}) …")
    runner = os.path.join(SCRIPTS, "run_schema_mapping.py")
    cmd = [sys.executable, runner, "--platform", args.platform, "--source", args.source]
    if args.map_apply:
        cmd.append("--apply")
        if args.dry_run:
            cmd.append("--dry-run")
    _run(cmd, dry=False)   # the runner has its own dry-run; mapping is gated by --map-apply


def deploy_local(args, cfg) -> str:
    print("[deploy] local docker compose")
    _run(["docker", "compose", "up", "--build", "-d"], args.dry_run, cwd=ROOT)
    url = "http://localhost:3001"
    if not args.dry_run:
        _wait_healthy(url + "/healthz", tries=30)
    return url


def deploy_gcp(args, cfg) -> str:
    print("[deploy] GCP — wrapping deploy.sh")
    _run(["bash", os.path.join(ROOT, "deploy.sh")], args.dry_run, cwd=ROOT)
    url_cmd = cfg.get("deploy", {}).get("url_command")
    return _capture(url_cmd, args.dry_run) if url_cmd else ""


def deploy_databricks(args, cfg) -> str:
    print("[deploy] Databricks — bundle + apps")
    bdir = cfg["dir"]
    _run(["databricks", "bundle", "deploy", "-t", "dev"], args.dry_run, cwd=bdir)
    _run(["databricks", "apps", "deploy", "tiger-orchestrator"], args.dry_run, cwd=bdir)
    out = _capture(["databricks", "apps", "get", "tiger-orchestrator", "-o", "json"],
                   args.dry_run)
    if out and out != "<dry-run-url>":
        try:
            return json.loads(out).get("url", "")
        except Exception:
            return ""
    return out


def _wait_healthy(url: str, tries: int = 20, delay: float = 3.0) -> bool:
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                if r.status == 200:
                    print(f"  healthy: {url}")
                    return True
        except Exception:
            pass
        time.sleep(delay)
    print(f"  WARNING: {url} not healthy after {tries} tries")
    return False


def smoke(base: str, dry: bool) -> None:
    if dry or not base:
        print("[smoke] skipped (dry-run or no URL)")
        return
    checks = ["/healthz", "/api/health", "/api/data-health", "/api/data-dictionary"]
    for path in checks:
        u = base.rstrip("/") + path
        try:
            with urllib.request.urlopen(u, timeout=20) as r:
                body = r.read(400)
                print(f"[smoke] {r.status} {u} ({len(body)}+ bytes)")
        except Exception as exc:
            print(f"[smoke] FAIL {u}: {exc}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Platform-selectable deployment driver")
    ap.add_argument("--platform", default=os.environ.get("DEPLOY_PLATFORM", "gcp"),
                    help="gcp | databricks | local")
    ap.add_argument("--map", action="store_true", help="run the Option-B mapping phase first")
    ap.add_argument("--map-apply", action="store_true",
                    help="with --map: apply the approved mapping (create virtual views)")
    ap.add_argument("--source", help="client raw namespace for --map")
    ap.add_argument("--smoke", action="store_true", help="smoke-test the deployed URL")
    ap.add_argument("--dry-run", action="store_true", help="print config + commands, run nothing")
    args = ap.parse_args()

    cfg = _load_platform(args.platform)
    _export_silver_env(cfg)

    print("=" * 64)
    print(f"DEPLOY  platform={args.platform}")
    print(f"  SEMANTIC_DS  = {os.environ.get('SEMANTIC_DS', '(default)')}")
    print(f"  DECISIONS_DS = {os.environ.get('DECISIONS_DS', '(default)')}")
    print("=" * 64)

    _maybe_map(args, cfg)

    if args.platform == "local":
        url = deploy_local(args, cfg)
    elif args.platform in ("gcp", "bigquery"):
        url = deploy_gcp(args, cfg)
    elif args.platform in ("databricks", "dbx"):
        url = deploy_databricks(args, cfg)
    else:
        raise SystemExit(f"unknown platform {args.platform!r}")

    if args.smoke:
        smoke(url, args.dry_run)

    print("\n" + "=" * 64)
    print(f"  LIVE URL: {url or '(deploy did not return a URL — check logs)'}")
    print("=" * 64)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
