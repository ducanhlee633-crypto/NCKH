# ============================================================================
# ROUTER: FRIENDS - Kết bạn 2 bước (pending -> accepted)
# ============================================================================
# Ý TƯỞNG CHUNG:
# - Có 2 bảng Supabase liên quan:
#     1. profiles (PROFILE_TABLE): id (UUID), username (unique, viết thường),
#        nickname (tên hiển thị). Đây là "danh bạ người dùng".
#     2. friendships (TABLE): id, user_id (người gửi), friend_id (người nhận),
#        status ('pending' | 'accepted'), created_at, updated_at.
#        Chỉ lưu 1 DÒNG duy nhất cho 1 cặp bạn (chiều gửi đầu tiên giữ nguyên).
#
# - Vì sao lưu friend_id (UUID) mà không lưu username?
#     username có thể đổi, UUID thì không. Client gửi `username` cho dễ dùng,
#     backend tự resolve username -> friend_id qua _get_profile_by_username().
#
# - FLOW HOẠT ĐỘNG CHUẨN (client gọi theo thứ tự này):
#     B1. Tìm người: GET /friends/search?q=an
#         -> trả về list profiles (trừ chính mình).
#     B2. Gửi lời mời: POST /friends/requests {"username": "an"}
#         -> tạo dòng (me -> An, pending). Nếu An đã gửi cho me trước đó
#            thì tự thành accepted luôn (2 chiều chéo nhau).
#     B3. Xem lời mời:
#         GET /friends/requests?direction=incoming (người khác gửi cho me)
#         GET /friends/requests?direction=outgoing (me đã gửi đi)
#         GET /friends/requests?direction=all (cả 2)
#     B4. Người nhận chấp nhận: POST /friends/accept/{username} (pending->accepted)
#         hoặc từ chối: POST /friends/reject/{username} (xóa dòng pending)
#     B5. Xem danh sách bạn: GET /friends (chỉ status=accepted, gộp cả 2 chiều)
#     B6. Xem chi tiết 1 quan hệ: GET /friends/{username}
#     B7. Hủy kết bạn / hủy lời mời đã gửi / từ chối lời mời đến:
#         DELETE /friends/{username} (xóa bất kể pending hay accepted)
#
# - QUY TẮC QUAN TRỌNG:
#     * Không tự kết bạn với chính mình (400).
#     * Đã pending rồi thì không gửi lại (409).
#     * Đã accepted rồi thì báo Already friends (409).
#     * accept/reject chỉ tác động đúng chiều: requester -> me.
#     * list_friends phải query cả 2 chiều vì me có thể là user_id hoặc friend_id.
# ============================================================================
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from async_utils import run_blocking
from auth import SupabaseUser, get_current_supabase_user
from schema import (
    FRIENDSHIP_STATUS_VALUES,
    FriendshipDetail,
    FriendProfile,
    FriendshipRequestCreate,
)
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/friends", tags=["friends"])

TABLE = "friendships"
COLUMNS = "id,user_id,friend_id,status,created_at,updated_at"
PROFILE_TABLE = "profiles"
PROFILE_COLUMNS = "id,username,nickname"


# ----------------------------------------------------------------------------
# HELPER 1: _db_error — Chuẩn hóa lỗi DB
# ----------------------------------------------------------------------------
# - Input: bất kỳ Exception nào từ Supabase.
# - Flow: nếu đã là HTTPException thì ném lại nguyên vẹn (giữ status 404/409...).
#         còn lại thì bọc thành 503 "Database operation failed" để client biết
#         là lỗi hạ tầng, không phải lỗi logic.
def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


# ----------------------------------------------------------------------------
# HELPER 2: _clean_username — Chuẩn hóa username đầu vào
# ----------------------------------------------------------------------------
# - Ví dụ: "  AnTe " -> "ante". Lý do: DB lưu username lowercase,
#   nên mọi so sánh .eq("username", ...) đều phải lowercase + strip.
def _clean_username(value: str) -> str:
    return value.strip().lower()


# ----------------------------------------------------------------------------
# HELPER 3: _escape_like — Thoát ký tự đặc biệt cho LIKE/ilike
# ----------------------------------------------------------------------------
# - Vì search dùng ilike "%q%", nếu user gõ "%" hoặc "_" thì LIKE sẽ hiểu
#   thành wildcard -> sai kết quả. Hàm này escape: \ -> \\, % -> \%, _ -> \_
# - Ví dụ: q="a%b" -> pattern "%a\%b%" -> tìm đúng chuỗi "a%b".
def _escape_like(value: str) -> str:
    # Thoát ký tự đặc biệt của LIKE để tìm đúng chuỗi user nhập.
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# ----------------------------------------------------------------------------
# HELPER 4: _get_profile_by_username — username -> profile (1 dòng)
# ----------------------------------------------------------------------------
# - Flow: SELECT id,username,nickname FROM profiles WHERE username = lower(input) LIMIT 1
# - Trả về: dict profile hoặc None nếu không tồn tại.
# - Dùng ở: mọi endpoint nhận {username} (send/accept/reject/read/delete).
async def _get_profile_by_username(username: str) -> dict | None:
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(PROFILE_TABLE)
                .select(PROFILE_COLUMNS)
                .eq("username", _clean_username(username))
                .limit(1)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return result.data[0] if result.data else None


# ----------------------------------------------------------------------------
# HELPER 5: _get_profiles_by_ids — id list -> dict {id: profile}
# ----------------------------------------------------------------------------
# - Vì bảng friendships chỉ lưu UUID, muốn trả về username/nickname cho client
#   thì phải JOIN thủ công: gom tất cả "id người còn lại" rồi query 1 lần
#   bằng .in_("id", [...]) thay vì query N lần (tránh N+1 query).
# - Ví dụ: friendships [(me->A),(B->me)] -> cần profile A,B -> {A:..., B:...}
async def _get_profiles_by_ids(user_ids: list[str]) -> dict[str, dict]:
    if not user_ids:
        return {}
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(PROFILE_TABLE)
                .select(PROFILE_COLUMNS)
                .in_("id", user_ids)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return {str(row["id"]): row for row in (result.data or [])}


# ----------------------------------------------------------------------------
# HELPER 6+7: _to_friend_profile / _to_detail — dict thô -> Pydantic schema
# ----------------------------------------------------------------------------
# - _to_friend_profile: row profiles -> FriendProfile (dùng cho /search).
# - _to_detail: row friendships + row profile người còn lại -> FriendshipDetail
#   có dạng {id, user_id, friend_id, status, ..., friend: {id, username...}}.
#   Client nhờ field `friend` này để hiển thị tên mà không cần gọi thêm API.
def _to_friend_profile(row: dict) -> FriendProfile:
    return FriendProfile.model_validate(row)


def _to_detail(row: dict, friend_row: dict | None) -> FriendshipDetail:
    data = dict(row)
    data["friend"] = dict(friend_row) if friend_row else None
    return FriendshipDetail.model_validate(data)


# ----------------------------------------------------------------------------
# HELPER 8: _find_one_direction — Tìm đúng chiều A -> B
# ----------------------------------------------------------------------------
# - Query: WHERE user_id=A AND friend_id=B LIMIT 1 (bất kể pending/accepted).
# - Dùng để kiểm tra "me đã gửi cho target chưa" (forward) và
#   "target đã gửi cho me chưa" (reverse).
async def _find_one_direction(user_id: UUID, friend_id: str) -> dict | None:
    """Tìm friendship A -> B (đúng chiều), mọi status."""
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .select(COLUMNS)
                .eq("user_id", str(user_id))
                .eq("friend_id", friend_id)
                .limit(1)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return result.data[0] if result.data else None


# ----------------------------------------------------------------------------
# HELPER 9: _find_between — Tìm quan hệ giữa 2 người (cả 2 chiều)
# ----------------------------------------------------------------------------
# - Flow: thử forward (me -> other) trước, nếu có thì return ngay;
#         nếu không thì thử reverse (other -> me).
# - Vì mỗi cặp chỉ lưu 1 dòng, nên 1 trong 2 chiều sẽ trúng (nếu có quan hệ).
# - Dùng ở: GET /friends/{username}, DELETE /friends/{username}.
async def _find_between(me: UUID, other_id: str) -> dict | None:
    """Tìm friendship giữa 2 user ở cả 2 chiều (forward trước, reverse sau)."""
    import asyncio

    try:
        forward, reverse_result = await asyncio.gather(
            _find_one_direction(me, other_id),
            run_blocking(
                lambda: (
                    get_supabase_admin()
                    .table(TABLE)
                    .select(COLUMNS)
                    .eq("user_id", other_id)
                    .eq("friend_id", str(me))
                    .limit(1)
                    .execute()
                )
            ),
        )
    except Exception as error:
        _db_error(error)
    if forward:
        return forward
    return reverse_result.data[0] if reverse_result.data else None


# ----------------------------------------------------------------------------
# HELPER 10: _other_id — Lấy "id người còn lại" trong 1 dòng friendship
# ----------------------------------------------------------------------------
# - Nếu row.user_id == me thì người còn lại là row.friend_id, ngược lại là row.user_id.
# - Ví dụ: me=X, row=(X->Y) => trả Y; row=(Z->X) => trả Z.
def _other_id(row: dict, me: UUID) -> str:
    return str(row["friend_id"]) if str(row["user_id"]) == str(me) else str(row["user_id"])


# ----------------------------------------------------------------------------
# HELPER 11: _enrich — Gắn profile vào list friendships + sort
# ----------------------------------------------------------------------------
# - Input: list rows friendships thô + me.
# - Flow 3 bước:
#     B1. Gom other_ids (dedupe bằng set).
#     B2. Gọi _get_profiles_by_ids 1 lần để lấy map {id: profile}.
#     B3. Ghép từng row với profile tương ứng thành FriendshipDetail, sort theo username.
# - Dùng ở: list_requests, list_friends (vì 2 endpoint này trả list).
async def _enrich(rows: list[dict], me: UUID) -> list[FriendshipDetail]:
    other_ids = list({_other_id(row, me) for row in rows})
    profiles = await _get_profiles_by_ids(other_ids)
    details = [_to_detail(row, profiles.get(_other_id(row, me))) for row in rows]
    details.sort(key=lambda d: ((d.friend.username or "") if d.friend else "", str(d.friend_id)))
    return details


# ----------------------------------------------------------------------------
# HELPER 12: _require_target — Bắt buộc target phải tồn tại
# ----------------------------------------------------------------------------
# - Resolve username -> profile, nếu None thì 404 "User not found".
# - Giúp các endpoint gọn hơn, không lặp lại if not target.
async def _require_target(username: str) -> dict:
    target = await _get_profile_by_username(username)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return target


# ============================================================================
# ENDPOINT 1: GET /friends/search?q=...&limit=20 — Tìm người để kết bạn
# ============================================================================
# - Mục đích: gợi ý user khi gõ username gần đúng (autocomplete).
# - Auth: cần Bearer token (get_current_supabase_user -> current.id là me).
# - Params: q (1-64 ký tự), limit (1-50, default 20).
# - Flow chi tiết:
#     B1. _clean_username(q) -> lowercase+strip. Nếu rỗng -> 422.
#     B2. _escape_like + bọc %...% -> pattern ilike. Ví dụ q="an" -> "%an%".
#     B3. SELECT ... FROM profiles WHERE username ILIKE '%an%' LIMIT 20
#         (ilike = không phân biệt hoa thường).
#     B4. Lọc bỏ chính mình (id != current.id), sort theo username A-Z.
#     B5. Map sang FriendProfile trả về.
# - Ví dụ: me=X search "an" -> [{username:"an",nickname:"An"}, {username:"anna"...}]
@router.get("/search", response_model=list[FriendProfile])
async def search_by_username(
    current: SupabaseUser = Depends(get_current_supabase_user),
    q: str = Query(min_length=1, max_length=64, description="Chuỗi username cần tìm (gần đúng)"),
    limit: int = Query(default=20, ge=1, le=50),
) -> list[FriendProfile]:
    """Tìm user theo username (gần đúng, không phân biệt hoa/thường)."""
    # B1: chuẩn hóa từ khóa, chặn chuỗi toàn khoảng trắng.
    keyword = _clean_username(q)
    if not keyword:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Thiếu từ khóa tìm kiếm.",
        )
    # B2: tạo pattern %keyword% an toàn cho LIKE.
    pattern = f"%{_escape_like(keyword)}%"
    try:
        # B3: query ilike trên profiles.username.
        query = (
            get_supabase_admin()
            .table(PROFILE_TABLE)
            .select(PROFILE_COLUMNS)
            .ilike("username", pattern)
            .limit(limit)
        )
        result = await run_blocking(query.execute)
    except Exception as error:
        _db_error(error)
    # B4: loại chính mình + sort A-Z để UI ổn định.
    rows = [row for row in (result.data or []) if str(row["id"]) != str(current.id)]
    rows.sort(key=lambda row: str(row.get("username") or ""))
    # B5: validate + trả về.
    return [_to_friend_profile(row) for row in rows]


# ============================================================================
# ENDPOINT 2: GET /friends/requests?direction=incoming|outgoing|all
# ============================================================================
# - Mục đích: xem lời mời đang pending.
#     incoming = người khác gửi cho me (friend_id == me): để me accept/reject.
#     outgoing = me gửi đi (user_id == me): để me biết/cancel.
#     all = cả 2 (dùng cho màn "quản lý lời mời").
# - Flow:
#     B1. Nếu direction gồm outgoing: SELECT * WHERE user_id=me AND status=pending.
#     B2. Nếu direction gồm incoming: SELECT * WHERE friend_id=me AND status=pending.
#     B3. _enrich(rows, me): gắn profile người còn lại + sort.
# - Ví dụ: A->me pending, me->B pending, direction=all -> trả 2 items kèm friend.
@router.get("/requests", response_model=list[FriendshipDetail])
async def list_requests(
    current: SupabaseUser = Depends(get_current_supabase_user),
    direction: str = Query(default="incoming", pattern=r"^(incoming|outgoing|all)$"),
) -> list[FriendshipDetail]:
    """Liệt kê lời mời kết bạn (pending)."""
    import asyncio

    async def _outgoing():
        return await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .select(COLUMNS)
                .eq("user_id", str(current.id))
                .eq("status", "pending")
                .execute()
            )
        )

    async def _incoming():
        return await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .select(COLUMNS)
                .eq("friend_id", str(current.id))
                .eq("status", "pending")
                .execute()
            )
        )

    rows: list[dict] = []
    try:
        if direction == "outgoing":
            rows.extend((await _outgoing()).data or [])
        elif direction == "incoming":
            rows.extend((await _incoming()).data or [])
        else:
            # all: 2 chiều độc lập -> chạy song song.
            outgoing, incoming = await asyncio.gather(_outgoing(), _incoming())
            rows.extend(outgoing.data or [])
            rows.extend(incoming.data or [])
    except Exception as error:
        _db_error(error)
    # B3: gắn username/nickname + sort.
    return await _enrich(rows, current.id)


# ============================================================================
# ENDPOINT 3: POST /friends/requests {"username": "..."} — Gửi lời mời
# ============================================================================
# - Mục đích: me gửi lời mời cho target.
# - Flow 5 nhánh:
#     B1. Resolve username -> target profile (404 nếu không có). Chặn tự add mình (400).
#     B2. Kiểm tra forward (me -> target đã tồn tại?):
#          - accepted -> 409 Already friends.
#          - pending  -> 409 Friend request already sent.
#     B3. Kiểm tra reverse (target -> me đã tồn tại?):
#          - accepted -> 409 Already friends.
#          - pending  -> HAY: 2 bên cùng gửi -> UPDATE dòng reverse thành accepted
#                        luôn (khỏi cần accept tay). Return dòng accepted.
#     B4. Nếu cả 2 chiều đều chưa có: INSERT (me, target, pending) + SELECT lại.
#         Bắt lỗi unique/duplicate -> 409 (chống race condition double-click).
#     B5. Ghép profile target vào FriendshipDetail trả 201.
# - Ví dụ chéo: An gửi cho me pending trước, giờ me gửi cho An -> thành bạn ngay.
@router.post("/requests", response_model=FriendshipDetail, status_code=status.HTTP_201_CREATED)
async def send_request(
    payload: FriendshipRequestCreate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> FriendshipDetail:
    """Gửi lời mời kết bạn bằng username (friend_username -> resolve sang friend_id)."""
    import asyncio

    # B1: tìm target + chặn tự kết bạn.
    target = await _require_target(payload.username)
    target_id = str(target["id"])
    if target_id == str(current.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add yourself as a friend.",
        )
    # B2 + B3: kiểm tra 2 chiều song song (độc lập).
    forward, reverse = await asyncio.gather(
        _find_one_direction(current.id, target_id),
        _find_one_direction(UUID(target_id), str(current.id)),
    )
    if forward:
        if forward["status"] == "accepted":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Already friends."
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Friend request already sent."
        )
    if reverse:
        if reverse["status"] == "accepted":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Already friends."
            )
        # Hai bên cùng gửi lời mời cho nhau -> tự chấp nhận luôn.
        try:
            updated = await run_blocking(
                lambda: (
                    get_supabase_admin()
                    .table(TABLE)
                    .update({"status": "accepted"})
                    .eq("id", str(reverse["id"]))
                    .select(COLUMNS)
                    .execute()
                )
            )
        except Exception as error:
            _db_error(error)
        if not updated.data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Friend request not found")
        return _to_detail(updated.data[0], target)
    # B4: chưa có gì -> tạo mới pending.
    try:
        created = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .insert({"user_id": str(current.id), "friend_id": target_id, "status": "pending"})
                .select(COLUMNS)
                .execute()
            )
        )
    except Exception as error:
        message = str(error).lower()
        if "duplicate" in message or "unique" in message:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Friend request already sent."
            ) from error
        _db_error(error)
    if not created.data:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database operation failed")
    # B5: trả chi tiết kèm profile target.
    return _to_detail(created.data[0], target)


# ============================================================================
# ENDPOINT 4: POST /friends/accept/{username} — Chấp nhận lời mời
# ============================================================================
# - Mục đích: me đồng ý lời mời mà requester đã gửi cho me.
# - Flow:
#     B1. Resolve requester (404 nếu sai username).
#     B2. Tìm đúng chiều requester -> me (_find_one_direction). Phải tồn tại
#         VÀ status==pending, nếu không -> 404 (tránh accept nhầm chiều me->other,
#         tránh accept lại cái đã accepted).
#     B3. Validate status nằm trong FRIENDSHIP_STATUS_VALUES (chống data bẩn).
#     B4. UPDATE status=accepted WHERE id=row.id, SELECT lại, trả kèm profile.
# - Ví dụ: An (requester) -> me pending, me gọi POST /accept/an -> accepted.
@router.post("/accept/{username}", response_model=FriendshipDetail)
async def accept_request(
    username: str,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> FriendshipDetail:
    """Chấp nhận lời mời từ {username} (pending -> accepted)."""
    # B1: ai là người đã gửi cho me?
    requester = await _require_target(username)
    # B2: phải có dòng requester -> me đang pending.
    row = await _find_one_direction(UUID(str(requester["id"])), str(current.id))
    if not row or row.get("status") != "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Friend request not found")
    if row["status"] not in FRIENDSHIP_STATUS_VALUES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid friendship status.")
    try:
        # B4: pending -> accepted.
        updated = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .update({"status": "accepted"})
                .eq("id", str(row["id"]))
                .select(COLUMNS)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not updated.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Friend request not found")
    return _to_detail(updated.data[0], requester)


# ============================================================================
# ENDPOINT 5: POST /friends/reject/{username} — Từ chối lời mời đến
# ============================================================================
# - Mục đích: me từ chối (xóa) lời mời requester -> me đang pending.
# - Khác với DELETE: endpoint này CHỈ xóa pending chiều đến, không xóa được
#   bạn đã accepted, không hủy được lời mời me đã gửi đi.
# - Flow giống accept nhưng B4 là DELETE WHERE id (thay vì UPDATE).
# - Trả 204 No Content (không body).
@router.post("/reject/{username}", status_code=status.HTTP_204_NO_CONTENT)
async def reject_request(
    username: str,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Response:
    """Từ chối lời mời đến từ {username} (xóa pending)."""
    # B1-B2: giống accept: phải có requester -> me pending.
    requester = await _require_target(username)
    row = await _find_one_direction(UUID(str(requester["id"])), str(current.id))
    if not row or row.get("status") != "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Friend request not found")
    try:
        # B3: xóa dòng pending.
        await run_blocking(
            lambda: (
                get_supabase_admin().table(TABLE).delete().eq("id", str(row["id"])).execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ============================================================================
# ENDPOINT 6: GET /friends — Danh sách bạn đã accepted
# ============================================================================
# - Mục đích: màn "Bạn bè" chính.
# - Vì 1 cặp chỉ lưu 1 dòng, me có thể nằm ở cột user_id (me gửi, được accept)
#   hoặc friend_id (người khác gửi, me accept), nên phải query CẢ 2 chiều
#   với status=accepted rồi gộp lại.
# - Flow:
#     B1. SELECT WHERE user_id=me AND accepted (me gửi đi).
#     B2. SELECT WHERE friend_id=me AND accepted (me nhận).
#     B3. Khử trùng theo other_id (phòng data cũ có 2 dòng mutual A-B và B-A).
#     B4. _enrich: gắn profile + sort theo username.
@router.get("", response_model=list[FriendshipDetail])
async def list_friends(
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> list[FriendshipDetail]:
    """Liệt kê bạn bè đã accepted (cả chiều gửi và chiều nhận)."""
    import asyncio

    async def _outgoing_accepted():
        return await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .select(COLUMNS)
                .eq("user_id", str(current.id))
                .eq("status", "accepted")
                .execute()
            )
        )

    async def _incoming_accepted():
        return await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .select(COLUMNS)
                .eq("friend_id", str(current.id))
                .eq("status", "accepted")
                .execute()
            )
        )

    rows: list[dict] = []
    try:
        # B1 + B2 song song: 2 chiều độc lập.
        outgoing, incoming = await asyncio.gather(_outgoing_accepted(), _incoming_accepted())
        rows.extend(outgoing.data or [])
        rows.extend(incoming.data or [])
    except Exception as error:
        _db_error(error)
    # B3: Khử trùng hợp khi có 2 dòng mutual cũ (A-B và B-A).
    seen: dict[str, dict] = {}
    for row in rows:
        key = _other_id(row, current.id)
        if key not in seen:
            seen[key] = row
    # B4: gắn profile + sort.
    return await _enrich(list(seen.values()), current.id)


# ============================================================================
# ENDPOINT 7: GET /friends/{username} — Chi tiết 1 quan hệ
# ============================================================================
# - Mục đích: kiểm tra trạng thái với 1 người cụ thể (để UI hiện nút
#   Kết bạn / Đã gửi / Chấp nhận / Bạn bè / Không có gì).
# - Flow: resolve target -> _find_between (cả 2 chiều) -> 404 nếu chưa có gì,
#   -> trả FriendshipDetail kèm friend.
# - Lưu ý thứ tự route: /search và /requests phải khai báo TRƯỚC /{username},
#   nếu không FastAPI sẽ nhầm "search" thành username.
@router.get("/{username}", response_model=FriendshipDetail)
async def read_friendship(
    username: str,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> FriendshipDetail:
    """Đọc 1 quan hệ bạn bè với {username} (pending hoặc accepted)."""
    target = await _require_target(username)
    row = await _find_between(current.id, str(target["id"]))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Friendship not found")
    return _to_detail(row, target)


# ============================================================================
# ENDPOINT 8: DELETE /friends/{username} — Xóa đa năng
# ============================================================================
# - Mục đích: 1 endpoint "gỡ" mọi trạng thái:
#     * đã accepted -> unfriend (hủy kết bạn).
#     * me gửi pending -> hủy lời mời đã gửi (cancel).
#     * nhận pending -> từ chối lời mời đến (reject, giống endpoint 5).
# - Flow: resolve target -> _find_between (tìm cả 2 chiều, mọi status)
#   -> 404 nếu không có -> DELETE WHERE id -> 204.
# - Khác endpoint 5: endpoint 5 chỉ xóa pending chiều đến,
#   endpoint này xóa bất kỳ status/chiều nào.
@router.delete("/{username}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_friendship(
    username: str,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Response:
    """Xóa bạn / hủy lời mời đã gửi / từ chối lời mời đến — xóa theo username."""
    target = await _require_target(username)
    row = await _find_between(current.id, str(target["id"]))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Friendship not found")
    try:
        await run_blocking(
            lambda: (
                get_supabase_admin().table(TABLE).delete().eq("id", str(row["id"])).execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
