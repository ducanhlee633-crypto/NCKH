from fastapi import APIRouter

from .deadlines import router as deadlines_router
from .daily_tasks import router as daily_tasks_router
from .ai import router as ai_router
from .roadmap_ai import router as roadmap_ai_router
from .ai_sessions import router as ai_sessions_router
from .feedback import router as feedback_router
from .friends import router as friends_router
from .goals import router as goals_router
from .pomodoro import router as pomodoro_router
from .roadmaps import router as roadmaps_router
from .schedule import router as schedule_router
from .user import auth_router, router as user_router
from .user_preferences import router as preferences_router
from .weekly_tasks import router as weekly_tasks_router
from .onboarding import router as onboarding_router

router = APIRouter()
router.include_router(ai_router)
router.include_router(roadmap_ai_router)
router.include_router(ai_sessions_router)
router.include_router(user_router)
router.include_router(auth_router)
router.include_router(preferences_router)
router.include_router(schedule_router)
router.include_router(deadlines_router)
router.include_router(daily_tasks_router)
router.include_router(pomodoro_router)
router.include_router(friends_router)
router.include_router(feedback_router)
router.include_router(goals_router)
router.include_router(roadmaps_router)
router.include_router(weekly_tasks_router)
router.include_router(onboarding_router)
