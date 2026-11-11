from app.infra.database import Conn, Row, query_all

# Entities whose `meta` bag can be introspected, mapped to (table, json column).
# A fixed allow-list — the names interpolate into SQL, so they must never be
# caller-supplied free text.
_ENTITIES: dict[str, tuple[str, str]] = {"jobs": ("jobs", "meta")}


class MetaRepository:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

    def entity_table(self, entity: str) -> tuple[str, str] | None:
        return _ENTITIES.get(entity)

    def meta_values(self, table: str, column: str) -> list[Row]:
        """One row per (row, key) for `table.column`'s JSON bag, newest rows
        first. `table`/`column` must come from `entity_table`'s allow-list —
        never caller-supplied — since they interpolate directly into SQL."""
        return query_all(
            self.conn,
            f"SELECT je.key AS key, je.value AS value, je.type AS type "
            f"FROM {table}, json_each({table}.{column}) je "
            f"WHERE {table}.{column} IS NOT NULL "
            f"ORDER BY {table}.updated_at DESC",
            (),
        )

    def note_titles(self, event: str) -> list[Row]:
        return query_all(
            self.conn,
            "SELECT json_extract(meta, '$.title') AS title, COUNT(*) AS uses, "
            "MAX(ts) AS recent FROM events WHERE event = ? "
            "AND json_extract(meta, '$.title') IS NOT NULL "
            "AND json_extract(meta, '$.title') != '' "
            "GROUP BY title ORDER BY uses DESC, recent DESC",
            (event,),
        )
