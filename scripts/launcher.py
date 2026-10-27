"""Portable, offline-only release launcher. No shared databases or credentials."""
from __future__ import annotations
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

def fail(message: str, code: int = 1) -> None:
    print(f"ERROR: {message}", file=sys.stderr, flush=True)
    raise SystemExit(code)

def fingerprint(files) -> str:
    digest = hashlib.sha256()
    for path in sorted(files):
        digest.update(path.relative_to(ROOT).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()

def run(command, cwd=ROOT, env=None) -> None:
    result = subprocess.run([str(x) for x in command], cwd=cwd, env=env)
    if result.returncode:
        fail(f"Command failed (exit {result.returncode}): {Path(str(command[0])).name}")

def main() -> int:
    parser = argparse.ArgumentParser(description="Run DisputePilot's local offline demo")
    parser.add_argument('--prepare-only', action='store_true', help='Install/build, then exit')
    parser.add_argument('--rebuild', action='store_true', help='Rebuild the frontend')
    parser.add_argument('--no-install', action='store_true', help='Fail rather than download missing dependencies')
    args = parser.parse_args()
    if sys.version_info < (3, 11): fail('Python 3.11 or later is required.', 2)
    try:
        port = int(os.environ.get('PORT', '8000'))
        if not 1 <= port <= 65535: raise ValueError()
    except ValueError: fail('PORT must be an integer from 1 to 65535.', 2)
    if not args.prepare_only:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            if os.name == 'nt': probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            try: probe.bind(('127.0.0.1', port))
            except OSError: fail(f'Port {port} is already in use. Set PORT to another local port.', 3)
    backend = ROOT/'backend'; frontend = ROOT/'frontend'
    venv = backend/'.venv'
    python = venv/('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    dependency_hash = fingerprint([backend/'requirements.txt'])
    stamp = venv/'.disputepilot-requirements.sha256'
    ready = python.is_file() and stamp.is_file() and stamp.read_text() == dependency_hash
    if not ready:
        if args.no_install: fail('Backend dependencies missing. Run once without --no-install.')
        if not python.is_file(): run([sys.executable, '-m', 'venv', venv])
        print('Installing backend dependencies (first run or changed requirements).', flush=True)
        run([python, '-m', 'pip', 'install', '--disable-pip-version-check', '-r', backend/'requirements.txt'])
        stamp.write_text(dependency_hash)
    build_files = [p for p in frontend.iterdir() if p.is_file() and p.suffix in {'.json','.ts','.mts','.html'}]
    for directory in ['src','public']:
        build_files.extend(p for p in (frontend/directory).rglob('*') if p.is_file())
    build_hash = fingerprint(build_files)
    build_stamp = frontend/'dist/.disputepilot-source.sha256'
    build_ready = (frontend/'dist/index.html').is_file() and build_stamp.is_file() and build_stamp.read_text() == build_hash
    if args.rebuild or not build_ready:
        node = shutil.which('node'); npm = shutil.which('npm')
        if not node or not npm: fail('Node.js 20+ and npm are required for the first frontend build.', 2)
        version = subprocess.check_output([node, '--version'], text=True).strip()
        major, minor = [int(x) for x in version.lstrip('v').split('.')[:2]]
        if not ((major == 20 and minor >= 19) or (major, minor) >= (22, 12)):
            fail('Node.js 20.19+ or 22.12+ is required.', 2)
        lock_hash = fingerprint([frontend/'package-lock.json'])
        node_stamp = frontend/'node_modules/.disputepilot-lock.sha256'
        if not node_stamp.is_file() or node_stamp.read_text() != lock_hash:
            if args.no_install: fail('Frontend dependencies missing. Run once without --no-install.')
            run([npm, 'ci', '--no-audit', '--no-fund'], cwd=frontend)
            node_stamp.write_text(lock_hash)
        env = os.environ.copy();env.update(VITE_DP_API_MODE='http', VITE_DP_API_BASE='/api/v1')
        run([npm, 'run', 'build'], cwd=frontend, env=env)
        build_stamp.write_text(build_hash)
    if args.prepare_only:
        print('Preparation complete; subsequent starts reuse dependencies and build.', flush=True)
        return 0
    if not (ROOT/'data/demo.sqlite3').is_file():
        fail('data/demo.sqlite3 is missing. Extract a fresh release; never use another database.')
    env = {k:v for k,v in os.environ.items() if not k.startswith('DP_') or k.startswith('DP_QA_')}
    env.update(DP_DATABASE_URL='sqlite:///'+(ROOT/'data/demo.sqlite3').as_posix(),
               DP_DATA_MODE='offline_replay', DP_AUTO_IMPORT='0', DP_AI_PROVIDER='frozen',
               DP_DEMO_GOLDEN=str(ROOT/'data/demo.golden.sqlite3'),
               DP_STATIC_DIR=str(frontend/'dist'), DP_PAYPAL_WRITES_ENABLED='0',
               DP_PAYPAL_WRITE_ALLOW='', DP_PAYPAL_CLIENT_ID='', DP_PAYPAL_CLIENT_SECRET='',
               DP_OUT_DIR=str(backend/'out'), PYTHONDONTWRITEBYTECODE='1')
    print(f'DisputePilot: http://127.0.0.1:{port} | OFFLINE REPLAY | no PayPal calls or money movement', flush=True)
    try:
        result = subprocess.run([str(python), '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(port)], cwd=backend, env=env)
        return result.returncode if result.returncode >= 0 else 1
    except KeyboardInterrupt: return 0

if __name__ == '__main__': raise SystemExit(main())
