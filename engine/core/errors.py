class EngineError(Exception):
    """An error the caller can act on. `retryable` tells the server whether to try again."""

    def __init__(self, code: str, message: str, *, retryable: bool = False, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.status = status

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "layer": "engine", "retryable": self.retryable}


class Cancelled(Exception):
    """Raised inside a running job when cancellation was requested."""


def invalid(message: str) -> EngineError:
    return EngineError("INVALID_REQUEST", message, status=400)


def not_found(code: str, message: str) -> EngineError:
    return EngineError(code, message, status=404)
