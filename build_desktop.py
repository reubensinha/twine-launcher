#!/usr/bin/env python3
"""
Twine Launcher — Windows desktop build script.

Produces a Windows NSIS installer at:
    desktop/src-tauri/target/release/bundle/nsis/Twine Launcher_<version>_x64-setup.exe

Prerequisites (all must be on PATH):
  - Node.js + npm
  - Python + PyInstaller:  pip install pyinstaller>=6.0
  - Rust toolchain (rustup):  https://rustup.rs
  - Tauri CLI:  cargo install tauri-cli --version "^2"
  - Icon files in desktop/src-tauri/icons/:
      32x32.png, 128x128.png, 128x128@2x.png, icon.ico, icon.icns
    Generate all sizes from a single 1024x1024 PNG source by running:
      cargo tauri icon path/to/source.png
    from the desktop/ directory.

NOTE: This script must be run on Windows. Cross-compilation from Linux/macOS
is not supported for the PyInstaller + Tauri combination.

Usage:
    python build_desktop.py
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str], cwd: Path | None = None) -> None:
    """Run a subprocess command, printing it first. Exit on failure."""
    label = " ".join(cmd)
    if cwd:
        label += f"  (in {cwd})"
    print(f"\n>>> {label}")
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        sys.exit(f"\nBuild failed — exit code {result.returncode}: {' '.join(cmd)}")


def get_rust_target_triple() -> str:
    """Return the host target triple, e.g. x86_64-pc-windows-msvc."""
    result = subprocess.run(
        ["rustc", "-vV"],
        capture_output=True,
        text=True,
        check=True,
    )
    for line in result.stdout.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    sys.exit("Could not parse host target triple from 'rustc -vV' output.")


def check_icons(icons_dir: Path) -> None:
    required = [
        "32x32.png",
        "128x128.png",
        "128x128@2x.png",
        "icon.ico",
        "icon.icns",
    ]
    missing = [f for f in required if not (icons_dir / f).exists()]
    if missing:
        sys.exit(
            "\nERROR: Missing icon files in {icons_dir}:\n".format(icons_dir=icons_dir)
            + "".join(f"  - {f}\n" for f in missing)
            + "\nGenerate them by running from the desktop/ directory:\n"
            + "  cargo tauri icon path/to/source-1024x1024.png\n"
        )


def main() -> None:
    # ── Platform check ─────────────────────────────────────────────────────────
    if sys.platform != "win32":
        sys.exit(
            "\nERROR: Desktop builds must be run on Windows.\n"
            "Cross-compilation is not supported for PyInstaller + Tauri.\n"
            "Run this script inside a Windows environment (not WSL2 Linux).\n"
        )

    root = Path(__file__).parent.resolve()
    desktop_dir = root / "desktop"
    src_tauri_dir = desktop_dir / "src-tauri"
    binaries_dir = src_tauri_dir / "binaries"
    icons_dir = src_tauri_dir / "icons"
    frontend_dir = root / "frontend"
    backend_static_ui = root / "backend" / "static" / "ui"

    print("=== Twine Launcher Desktop Build ===")
    print(f"Project root : {root}")
    print(f"Target       : Windows NSIS installer")

    # ── Prerequisite checks ────────────────────────────────────────────────────
    check_icons(icons_dir)
    binaries_dir.mkdir(parents=True, exist_ok=True)

    # ── Step 1: Build the React frontend ──────────────────────────────────────
    print("\n=== Step 1/5: Building React frontend ===")
    # On Windows, npm is npm.cmd
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    run([npm, "run", "build"], cwd=frontend_dir)

    # ── Step 2: Copy frontend dist into backend static dir ────────────────────
    print("\n=== Step 2/5: Copying frontend dist → backend/static/ui ===")
    frontend_dist = frontend_dir / "dist"
    if not frontend_dist.exists():
        sys.exit(f"Frontend build output not found: {frontend_dist}")

    if backend_static_ui.exists():
        shutil.rmtree(backend_static_ui)
    shutil.copytree(frontend_dist, backend_static_ui)
    print(f"  {frontend_dist}  →  {backend_static_ui}")

    # ── Step 3: Build PyInstaller sidecar ──────────────────────────────────────
    print("\n=== Step 3/5: Building PyInstaller sidecar ===")
    run(
        [sys.executable, "-m", "PyInstaller", "backend.spec", "--clean", "--noconfirm"],
        cwd=root,
    )

    sidecar_exe = root / "dist" / "twine-launcher-backend.exe"
    if not sidecar_exe.exists():
        sys.exit(f"\nPyInstaller output not found: {sidecar_exe}")

    # ── Step 4: Place sidecar in Tauri binaries directory ─────────────────────
    print("\n=== Step 4/5: Placing sidecar in Tauri binaries directory ===")
    triple = get_rust_target_triple()
    print(f"  Rust target triple : {triple}")

    dest_exe = binaries_dir / f"twine-launcher-backend-{triple}.exe"
    shutil.copy2(sidecar_exe, dest_exe)
    print(f"  {sidecar_exe.name}  →  {dest_exe}")

    # ── Step 5: Build Tauri app ────────────────────────────────────────────────
    print("\n=== Step 5/5: Building Tauri desktop app ===")
    run(["cargo", "tauri", "build"], cwd=desktop_dir)

    # ── Done ───────────────────────────────────────────────────────────────────
    bundle_dir = src_tauri_dir / "target" / "release" / "bundle" / "nsis"
    print("\n" + "=" * 50)
    print("Build complete!")
    print(f"Installer directory: {bundle_dir}")
    if bundle_dir.exists():
        for f in sorted(bundle_dir.iterdir()):
            print(f"  {f.name}")
    else:
        print("  (directory not found — check Tauri build output above)")


if __name__ == "__main__":
    main()
