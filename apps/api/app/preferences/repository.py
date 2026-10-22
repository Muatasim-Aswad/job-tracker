from app.core.db import Conn, Row, execute, query_one


class PreferencesRepository:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

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
