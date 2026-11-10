from app.infra.database import Conn, Row, execute, query_one


class PreferencesRepository:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

    def initialization_recorded(self, key: str) -> bool:
        return (
            query_one(self.conn, "SELECT key FROM schema_migrations WHERE key = ?", (key,))
            is not None
        )

    def record_initialization(self, key: str, now: str) -> None:
        execute(
            self.conn, "INSERT INTO schema_migrations(key, applied_at) VALUES (?, ?)", (key, now)
        )

    def get(self) -> Row | None:
        return query_one(
            self.conn, "SELECT revision, settings_json FROM user_preferences WHERE id = 1"
        )

    def save(self, revision: str, settings_json: str) -> None:
        execute(
            self.conn,
            "INSERT INTO user_preferences (id, revision, settings_json) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, settings_json = excluded.settings_json",
            (revision, settings_json),
        )
