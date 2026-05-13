"""
Backup router — export and import backups. Admin only.
"""

from datetime import datetime, UTC
from fastapi import APIRouter, HTTPException, UploadFile, File, status
from fastapi.responses import Response

from backend.app.core.dependencies import AdminUser, CurrentUser, DBSession
from backend.app.schemas import BackupExportRequest
from backend.app.services.backup import export_backup, import_backup

router = APIRouter(prefix="/backup", tags=["backup"])


@router.post("/export")
def export(payload: BackupExportRequest, db: DBSession, current_user: CurrentUser):
    """
    Generate and return a backup zip file.
    scope: "full" includes game files + metadata; "saves-only" includes only save data.
    Players may only export their own saves ("saves-only"). Full backup requires admin.
    """
    if payload.scope == "full" and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Full backup requires admin access")
    user_id = None if current_user.role == "admin" else current_user.id
    zip_bytes = export_backup(db, scope=payload.scope, user_id=user_id)
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    filename = f"twine-launcher-backup-{payload.scope}-{timestamp}.zip"

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
async def import_backup_route(
    file: UploadFile = File(...),
    db: DBSession = None,
    _: AdminUser = None,
):
    """
    Import a previously exported backup zip.
    Restores saves and (for full backups) game metadata and files.
    Returns a summary of what was restored.
    """
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload must be a .zip file",
        )

    zip_bytes = await file.read()
    try:
        summary = import_backup(db, zip_bytes)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

    return summary
