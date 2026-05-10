from fastapi import APIRouter
from backend.app.core.config import get_settings
from backend.app.core.dependencies import CurrentUser

router = APIRouter(prefix="/config", tags=["config"])


@router.get("")
def get_config(current_user: CurrentUser):
    return {"games_dir": get_settings().games_dir}
