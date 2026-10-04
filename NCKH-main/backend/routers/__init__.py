from fastapi import APIRouter

from .deadlines import router as deadlines_router
from .feedback import router as feedback_router
from .friends import router as friends_router
from .pomodoro import router as pomodoro_router
from .schedule import router as schedule_router
from .user import auth_router, router as user_router
from .user_preferences import router as preferences_router

router = APIRouter()
router.include_router(user_router)
router.include_router(auth_router)
router.include_router(preferences_router)
router.include_router(schedule_router)
router.include_router(deadlines_router)
router.include_router(pomodoro_router)
router.include_router(friends_router)
router.include_router(feedback_router)
