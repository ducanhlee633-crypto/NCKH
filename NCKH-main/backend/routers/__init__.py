from fastapi import APIRouter

from .user import auth_router, router as user_router

router = APIRouter()
router.include_router(user_router)
router.include_router(auth_router)
