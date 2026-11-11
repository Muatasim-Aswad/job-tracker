"""Compose the configured API, runtime resources and built dashboard."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import partial

from fastapi import APIRouter, Depends, FastAPI

from app.config import Settings, get_settings
from app.core.build_info import installed_info
from app.core.paths import settings_paths
from app.core.version import PRODUCT_VERSION
from app.infra.periodic import PeriodicWorker
from app.infra.transactions import transaction
from app.infra.web_push import WebPushSender
from app.modules.application_workflows.router import router as application_workflows_router
from app.modules.blocked.router import router as blocked_router
from app.modules.documents.router import router as documents_router
from app.modules.events.router import router as events_router
from app.modules.form_fill.router import router as form_fill_router
from app.modules.jobs.router import router as jobs_router
from app.modules.listings.router import router as listings_router
from app.modules.meta.router import router as meta_router
from app.modules.notifications.router import router as notifications_router
from app.modules.notifications.worker import cycle as notification_cycle
from app.modules.preferences.router import router as preferences_router
from app.modules.preferences.schemas import ApplicationStaleness
from app.modules.preferences.service import initialize_staleness
from app.modules.search_log.router import router as search_log_router
from app.modules.staleness import service as staleness
from app.modules.stats.router import router as stats_router
from app.platform.dependencies import require_api_key
from app.platform.errors import ErrorResponse
from app.platform.http import DashboardStaticFiles, configure_http
from app.platform.logging import configure_logging
from app.platform.runtime import RuntimeResources, open_runtime


def create_app(settings: Settings, *, resources: RuntimeResources | None = None) -> FastAPI:
    """Build an isolated app; its lifespan owns the selected profile's resources."""
    resources = resources or RuntimeResources(settings_paths(settings))
    paths = resources.paths
    build_info = installed_info(paths.app_dir, packaged=paths.profile == "packaged")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging()
        with open_runtime(settings, resources, build_info):
            with transaction(resources.database()) as conn:
                initialize_staleness(
                    conn,
                    ApplicationStaleness(
                        applied_days=settings.attention_applied_days,
                        in_process_days=settings.attention_in_process_days,
                        timezone=settings.stale_notification_timezone,
                    ),
                )
                staleness.reconcile(conn)

            def committed() -> None:
                if resources.push_scheduler is not None:
                    resources.push_scheduler.notify_write()

            committed()
            resources.web_push = (
                WebPushSender(paths.state_dir / "web-push-private.pem", settings.web_push_subject)
                if settings.web_push_enabled
                else None
            )
            resources.notification_worker = PeriodicWorker(
                partial(
                    notification_cycle,
                    resources.database(),
                    resources.notification_hub,
                    committed,
                    scheduler_enabled=settings.notification_scheduler_enabled,
                    known={},
                    push_sender=resources.web_push,
                )
            )
            resources.notification_worker.start()
            yield

    app = FastAPI(
        title="Job Tracker API",
        version=PRODUCT_VERSION,
        lifespan=lifespan,
        responses={
            status: {"model": ErrorResponse}
            for status in (400, 401, 403, 404, 405, 409, 413, 422, 429, 500, 503)
        },
    )
    app.state.settings = settings
    app.state.resources = resources
    app.state.build_info = build_info
    configure_http(app, settings)

    # API authentication excludes public identity, OpenAPI and documentation.
    api_router = APIRouter(dependencies=[Depends(require_api_key)])
    for router in (
        jobs_router,
        application_workflows_router,
        listings_router,
        events_router,
        documents_router,
        stats_router,
        search_log_router,
        meta_router,
        blocked_router,
        form_fill_router,
        preferences_router,
        notifications_router,
    ):
        api_router.include_router(router)
    app.include_router(api_router, prefix="/api")

    # API and identity routes win over the optional dashboard.
    if paths.web_dist.is_dir():
        app.mount("/", DashboardStaticFiles(directory=paths.web_dist, html=True), name="dashboard")
    return app


app = create_app(get_settings())
