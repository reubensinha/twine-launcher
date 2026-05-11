# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the Twine Launcher backend sidecar.

Prerequisites:
  - Run `npm run build` inside frontend/ first.
  - Copy frontend/dist/ to backend/static/ui/ before running PyInstaller.
  - Or use build_desktop.py which handles all of this automatically.

Run manually with:
    pyinstaller backend.spec --clean --noconfirm
"""

from pathlib import Path

block_cipher = None

# SPECPATH is set by PyInstaller to the directory containing this .spec file,
# which is the project root.
ROOT = Path(SPECPATH)

a = Analysis(
    [str(ROOT / "backend_server.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        # Bundle the compiled React frontend into static_ui/ inside the exe.
        # backend_server.py sets TWINE_STATIC_UI_DIR = sys._MEIPASS/static_ui
        # so FastAPI can find and serve these files.
        # NOTE: backend/static/ui/ must exist before running PyInstaller.
        (str(ROOT / "backend" / "static" / "ui"), "static_ui"),
        # Bundle Alembic migration scripts so init_db() can run them when frozen.
        # database.py uses sys._MEIPASS/alembic as the script_location when frozen.
        (str(ROOT / "alembic"), "alembic"),
    ],
    hiddenimports=[
        # Alembic — not discovered by static analysis because it's imported lazily
        "alembic",
        "alembic.config",
        "alembic.command",
        "alembic.context",
        "alembic.runtime.migration",
        "alembic.runtime.environment",
        "alembic.script",
        "alembic.script.base",
        "alembic.script.revision",
        "alembic.operations",
        "alembic.operations.base",
        "alembic.operations.ops",
        "alembic.operations.toimpl",
        "alembic.ddl",
        "alembic.ddl.base",
        "alembic.ddl.impl",
        "alembic.ddl.sqlite",
        # uvicorn internals not discovered by static analysis
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.loops.uvloop",     # not available on Windows; PyInstaller warns but does not error
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.http.httptools_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.websockets_impl",
        "uvicorn.protocols.websockets.wsproto_impl",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        # SQLAlchemy SQLite dialect
        "sqlalchemy.dialects.sqlite",
        "sqlalchemy.dialects.sqlite.pysqlite",
        # Pydantic v2
        "pydantic",
        "pydantic_core",
        "pydantic.deprecated.class_validators",
        "pydantic.deprecated.config",
        "pydantic.deprecated.tools",
        # pydantic-settings
        "pydantic_settings",
        # python-jose with cryptography backend
        "jose",
        "jose.jwt",
        "jose.jws",
        "jose.jwk",
        "jose.backends",
        "jose.backends.cryptography_backend",
        "cryptography",
        "cryptography.hazmat.primitives",
        "cryptography.hazmat.primitives.asymmetric",
        "cryptography.hazmat.backends.openssl",
        # bcrypt — includes the compiled C extension
        "bcrypt",
        "_bcrypt",
        # python-multipart (FastAPI form/file upload parsing)
        "multipart",
        "multipart.multipart",
        # aiofiles (async file I/O)
        "aiofiles",
        "aiofiles.os",
        "aiofiles.threadpool",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "_tkinter",
        "pytest",
        "_pytest",
        "unittest",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="twine-launcher-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # UPX is disabled: it frequently triggers Windows Defender false positives.
    upx=False,
    # No console window in production. Set to True to see uvicorn logs when
    # debugging the frozen binary.
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
