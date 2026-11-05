from app.infra.database import Conn
from app.modules.meta.repository import MetaRepository
from app.modules.meta.schemas import MetaKey, MetaVocabulary
from app.shared.enums import Event as EventType

_VALUE_SAMPLE = 8
_TYPE_MAP = {"true": "boolean", "false": "boolean", "integer": "integer", "real": "real"}


def _norm_type(json_type: str) -> str:
    return _TYPE_MAP.get(json_type, "text")


def _value_str(value: object, json_type: str) -> str:
    if json_type in ("true", "false"):
        return json_type

    return str(value)


def vocabulary(conn: Conn, entity: str) -> MetaVocabulary:
    table_col = MetaRepository(conn).entity_table(entity)
    if table_col is None:
        return MetaVocabulary(entity=entity, keys=[])

    table, column = table_col
    rows = MetaRepository(conn).meta_values(table, column)
    uses: dict[str, int] = {}
    values: dict[str, list[str]] = {}
    types: dict[str, set[str]] = {}
    for row in rows:
        key = row["key"]
        uses[key] = uses.get(key, 0) + 1
        types.setdefault(key, set()).add(_norm_type(row["type"]))
        bucket = values.setdefault(key, [])
        v = _value_str(row["value"], row["type"])
        if v not in bucket and len(bucket) < _VALUE_SAMPLE:
            bucket.append(v)

    keys = [
        MetaKey(
            key=key,
            uses=count,
            values=values.get(key, []),
            type=next(iter(types[key])) if len(types[key]) == 1 else "mixed",
        )
        for key, count in sorted(uses.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    return MetaVocabulary(entity=entity, keys=keys)


def note_titles(conn: Conn) -> list[str]:
    """Distinct titles used on note events across all jobs, most-used first —
    the suggestion pool for a new note's title, so recurring headings ("Phone
    screen", "Follow-up") stay consistent instead of drifting."""
    rows = MetaRepository(conn).note_titles(EventType.NOTE.value)

    return [row["title"] for row in rows]
