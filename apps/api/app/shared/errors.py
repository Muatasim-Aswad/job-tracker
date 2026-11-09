"""Transport-independent errors; only public fields may cross a boundary."""

from dataclasses import dataclass

type PublicDetails = dict[str, object]


@dataclass(frozen=True)
class ErrorDetails:
    public: PublicDetails | None = None
    private: object = None


class AppError(Exception):
    def __init__(
        self,
        code: str,
        message: str | None = None,
        *,
        internal: str | None = None,
        cause: Exception | None = None,
        details: ErrorDetails | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.internal = internal
        self.cause = cause
        self.details = details
        super().__init__(message or code)


class NotFoundError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__("not_found", message)


class ValidationError(AppError):
    """A well-formed request the domain refuses, such as deleting a non-note event.
    Maps to 400, distinct from a 404 (missing) and a 500 (bug)."""

    def __init__(self, message: str, *, code: str = "validation_error") -> None:
        super().__init__(code, message)


class ConflictError(AppError):
    """A revision-checked write observed newer state and changed nothing."""

    def __init__(self, code: str, current: object) -> None:
        self.current = current
        super().__init__(code, code, details=ErrorDetails(public={"current": current}))


class InvalidCursorError(AppError):
    """An opaque list cursor is malformed or belongs to other filters."""

    def __init__(self, message: str = "invalid_cursor") -> None:
        super().__init__("invalid_cursor", message)


class DataIntegrityError(Exception):
    """Abort startup when foreign-key enforcement fails or stored rows reference missing parents. Preserve the rows for operator repair or backup restoration."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)
