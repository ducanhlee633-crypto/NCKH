# Endpoint Web Push: web gửi thông báo ra điện thoại kể cả khi tắt web.
# Luồng: frontend subscribe PushManager với VAPID public key ->
# POST /push/subscribe lưu {endpoint, p256dh, auth} theo user ->
# backend ký bằng VAPID private key và gửi qua pywebpush khi cần
# (test thủ công, hạn nộp sắp tới, tới giờ học...).
import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

from auth import SupabaseUser, get_current_supabase_user
from config import get_settings
from schema import PushSubscription, PushSubscriptionCreate, PushTestRequest
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/push", tags=["push"])

TABLE = "push_subscriptions"
COLUMNS = "id,user_id,endpoint,p256dh,auth,user_agent,created_at,updated_at"


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _to_subscription(row: dict) -> PushSubscription:
    return PushSubscription.model_validate(dict(row))


def _send_webpush(endpoint: str, p256dh: str, auth: str, payload: dict) -> None:
    """Gửi 1 push tới 1 subscription. Ném HTTPException nếu chưa cấu hình VAPID."""
    settings = get_settings()
    if not settings.vapid_public_key or not settings.vapid_private_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Chưa cấu hình VAPID. Thêm VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY vào backend/.env",
        )
    try:
        from pywebpush import WebPushException, webpush
    except ImportError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Chưa cài pywebpush. Chạy: uv sync",
        ) from error
    subscription_info = {"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}}
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
        )
    except Exception as error:
        # Endpoint hết hạn (410 Gone) hoặc device hủy đăng ký -> để caller dọn.
        status_code = getattr(getattr(error, "response", None), "status_code", None)
        detail = f"Gửi push thất bại ({status_code or 'network'})."
        raise HTTPException(status_code=502, detail=detail) from error


@router.get("/vapid-key")
def get_vapid_public_key() -> dict:
    """Public key cho frontend gọi PushManager.subscribe. Không cần đăng nhập."""
    public_key = get_settings().vapid_public_key
    if not public_key:
        raise HTTPException(status_code=503, detail="Chưa cấu hình VAPID_PUBLIC_KEY ở backend")
    return {"publicKey": public_key}


@router.get("/subscriptions", response_model=list[PushSubscription])
def list_own_subscriptions(
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> list[PushSubscription]:
    """Liệt kê các thiết bị đã bật thông báo của chính mình."""
    try:
        result = (
            get_supabase_admin()
            .table(TABLE)
            .select(COLUMNS)
            .eq("user_id", str(current.id))
            .execute()
        )
    except Exception as error:
        _db_error(error)
    return [_to_subscription(row) for row in (result.data or [])]


@router.post("/subscribe", response_model=PushSubscription, status_code=status.HTTP_201_CREATED)
def subscribe_push(
    payload: PushSubscriptionCreate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> PushSubscription:
    """Lưu 1 subscription (1 thiết bị). Gửi lại cùng endpoint -> cập nhật key."""
    values = {
        "user_id": str(current.id),
        "endpoint": payload.endpoint,
        "p256dh": payload.keys.p256dh,
        "auth": payload.keys.auth,
        "user_agent": (payload.user_agent or "")[:512] or None,
    }
    try:
        existing = (
            get_supabase_admin()
            .table(TABLE)
            .select(COLUMNS)
            .eq("user_id", str(current.id))
            .eq("endpoint", payload.endpoint)
            .limit(1)
            .execute()
        )
    except Exception as error:
        _db_error(error)
    try:
        if existing.data:
            row_id = existing.data[0]["id"]
            result = (
                get_supabase_admin()
                .table(TABLE)
                .update(values)
                .eq("id", row_id)
                .eq("user_id", str(current.id))
                .select(COLUMNS)
                .execute()
            )
        else:
            result = (
                get_supabase_admin().table(TABLE).insert(values).select(COLUMNS).execute()
            )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=503, detail="Database operation failed")
    return _to_subscription(result.data[0])


@router.delete("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe_push(
    endpoint: str,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Response:
    """Hủy 1 thiết bị (khi user tắt thông báo hoặc SW hết hạn)."""
    try:
        get_supabase_admin().table(TABLE).delete().eq("user_id", str(current.id)).eq(
            "endpoint", endpoint
        ).execute()
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _fetch_user_subscriptions(user_id: UUID) -> list[dict]:
    try:
        result = (
            get_supabase_admin()
            .table(TABLE)
            .select(COLUMNS)
            .eq("user_id", str(user_id))
            .execute()
        )
    except Exception as error:
        _db_error(error)
    return result.data or []


def _delete_subscription(row_id: str, user_id: UUID) -> None:
    try:
        get_supabase_admin().table(TABLE).delete().eq("id", row_id).eq(
            "user_id", str(user_id)
        ).execute()
    except Exception:
        pass


def send_push_to_user(user_id: UUID, title: str, body: str, url: str = "/#/dashboard") -> dict:
    """Hàm dùng chung cho các tính năng khác (nhắc hạn nộp, tới giờ học...).

    Trả về {sent, removed}. Subscription hết hạn (410) tự dọn khỏi DB.
    """
    payload = {"title": title, "body": body, "url": url}
    sent = 0
    removed = 0
    for row in _fetch_user_subscriptions(user_id):
        try:
            _send_webpush(row["endpoint"], row["p256dh"], row["auth"], payload)
            sent += 1
        except HTTPException as error:
            # 502 từ _send_webpush ~ endpoint chết -> xóa để lần sau khỏi gửi lại.
            if error.status_code == 502:
                _delete_subscription(str(row["id"]), user_id)
                removed += 1
            elif error.status_code == 503:
                raise
    return {"sent": sent, "removed": removed}


@router.post("/test")
def send_test_push(
    payload: PushTestRequest,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> dict:
    """Gửi thử tới TẤT CẢ thiết bị của chính mình. Dùng để kiểm tra trên điện thoại."""
    rows = _fetch_user_subscriptions(current.id)
    if not rows:
        raise HTTPException(
            status_code=404,
            detail="Chưa có thiết bị nào đăng ký. Bấm 'Bật thông báo' trên điện thoại trước.",
        )
    return send_push_to_user(current.id, payload.title, payload.body, payload.url)
