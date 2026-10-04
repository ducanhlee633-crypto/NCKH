from fastapi import APIRouter

from .user import auth_router, router as user_router
from .user_preferences import router as preferences_router

router = APIRouter()
router.include_router(user_router)
router.include_router(auth_router)
router.include_router(preferences_router)
