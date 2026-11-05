from pydantic import BaseModel


class Stats(BaseModel):
    total_jobs: int
    funnel: dict[str, int]  # status -> count
    apply_type: dict[str, int]  # listing apply_type -> count
