from typing import Literal, Self
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

DEFAULT_PREFERENCES_REVISION = "defaults-v1"

HighlightId = Literal["experience-years", "language", "pay", "custom-words"]


class PreferenceModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class KeywordList(PreferenceModel):
    terms: list[str] = Field(max_length=200)

    @field_validator("terms")
    @classmethod
    def clean_terms(cls, terms: list[str]) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for term in terms:
            term = term.strip()
            if not term or len(term) > 200:
                raise ValueError("keywords must contain 1–200 characters")
            if term.casefold() not in seen:
                seen.add(term.casefold())
                result.append(term)
        return result


class DescriptionHighlight(KeywordList):
    id: HighlightId
    enabled: bool = True


class TitleRule(KeywordList):
    id: str = Field(min_length=1, max_length=100)
    enabled: bool = True
    match: Literal["contains", "starts_with", "not_contains"]
    action: Literal["outline_job_card", "hide", "star", "skip"]
    terms: list[str] = Field(min_length=1, max_length=200)


class SearchDiagnostics(PreferenceModel):
    scope: Literal["never", "temporary", "always"] = "never"
    expires_at: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_expiry(self) -> Self:
        if self.scope == "temporary" and self.expires_at is None:
            raise ValueError("temporary diagnostics require an expiry")
        if self.scope != "temporary":
            self.expires_at = None
        return self


def default_highlights() -> list[DescriptionHighlight]:
    return [
        DescriptionHighlight(id="experience-years", terms=["years", "year", "jaar"]),
        DescriptionHighlight(id="language", terms=["dutch", "nederlandse"]),
        DescriptionHighlight(id="pay", terms=["euro", "€"]),
        DescriptionHighlight(
            id="custom-words",
            terms=[
                "senior",
                "medior",
                "junior",
                "lead",
                "principal",
                "staff",
                "intern",
                "internship",
                "trainee",
            ],
        ),
    ]


class ApplicationStaleness(PreferenceModel):
    applied_days: int = Field(default=21, ge=0)
    in_process_days: int = Field(default=14, ge=0)
    applied_notifications: Literal["on", "muted", "off"] = "on"
    in_process_notifications: Literal["on", "muted", "off"] = "on"
    notification_time: str = Field(default="09:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    timezone: str = "UTC"

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Choose an IANA time zone") from exc
        return value


class NotificationSettings(PreferenceModel):
    muted: bool = False


class Preferences(PreferenceModel):
    notifications: NotificationSettings = Field(default_factory=NotificationSettings)
    application_staleness: ApplicationStaleness = Field(default_factory=ApplicationStaleness)
    description_highlights: list[DescriptionHighlight] = Field(
        default_factory=default_highlights, max_length=4
    )
    title_rules: list[TitleRule] = Field(default_factory=list, max_length=100)
    easy_apply_enabled: bool = True
    hide_mode: Literal["dim", "remove"] = "remove"
    search_diagnostics: SearchDiagnostics = Field(default_factory=SearchDiagnostics)

    @model_validator(mode="after")
    def unique_ids(self) -> Self:
        for items in (self.description_highlights, self.title_rules):
            ids = [item.id for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError("duplicate rule or highlight IDs")
        return self


class PreferencesPatch(PreferenceModel):
    notifications: NotificationSettings | None = None
    application_staleness: ApplicationStaleness | None = None
    description_highlights: list[DescriptionHighlight] | None = None
    title_rules: list[TitleRule] | None = None
    easy_apply_enabled: bool | None = None
    hide_mode: Literal["dim", "remove"] | None = None
    search_diagnostics: SearchDiagnostics | None = None

    @model_validator(mode="after")
    def reject_nulls(self) -> Self:
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("settings cannot be null")
        return self


class PreferencesState(PreferenceModel):
    revision: str
    settings: Preferences


class PreferencesUpdate(PreferenceModel):
    expected_revision: str | None
    changes: PreferencesPatch
