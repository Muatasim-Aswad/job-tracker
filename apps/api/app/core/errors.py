"""Domain errors, kept HTTP-agnostic. main.py maps them to responses."""


class NotFoundError(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class ValidationError(Exception):
    """A well-formed request the domain refuses, such as deleting a non-note event.
    Maps to 400, distinct from a 404 (missing) and a 500 (bug)."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class ConflictError(Exception):
    """A revision-checked write observed newer state and changed nothing."""

    def __init__(self, message: str, current: object) -> None:
        self.message = message
        self.current = current
        super().__init__(message)


class InvalidCursorError(Exception):
    """An opaque list cursor is malformed or belongs to other filters."""

    def __init__(self, message: str = "invalid_cursor") -> None:
        self.message = message
        super().__init__(message)


class DataIntegrityError(Exception):
    """Abort startup when foreign-key enforcement fails or stored rows reference missing parents. Preserve the rows for operator repair or backup restoration."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)
