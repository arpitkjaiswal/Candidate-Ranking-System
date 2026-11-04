"""Enforce body limits before multipart parsing, including chunked requests."""

from starlette.responses import JSONResponse

MAX_REQUEST_BYTES = 52 * 1024**2


class BodyLimitExceeded(Exception):
    pass


class RequestBodyLimit:
    def __init__(self, app, max_bytes=MAX_REQUEST_BYTES):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        raw = headers.get(b"content-length")
        if raw is not None:
            try:
                length = int(raw)
                if length < 0:
                    raise ValueError
            except ValueError:
                return await JSONResponse({"detail": "Invalid Content-Length."}, status_code=400)(
                    scope, receive, send
                )
            if length > self.max_bytes:
                return await JSONResponse(
                    {"detail": "Request exceeds the 52 MB upload limit."}, status_code=413
                )(scope, receive, send)
        seen, exceeded, responded = 0, False, False

        async def bounded_receive():
            nonlocal seen, exceeded
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    exceeded = True
                    raise BodyLimitExceeded
            return message

        async def guarded_send(message):
            nonlocal responded
            if exceeded:
                if not responded:
                    responded = True
                    await JSONResponse(
                        {"detail": "Request exceeds the 52 MB upload limit."}, status_code=413
                    )(scope, receive, send)
                return
            await send(message)

        try:
            await self.app(scope, bounded_receive, guarded_send)
        except BodyLimitExceeded:
            if not responded:
                await JSONResponse(
                    {"detail": "Request exceeds the 52 MB upload limit."}, status_code=413
                )(scope, receive, send)
