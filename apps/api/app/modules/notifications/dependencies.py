from typing import Annotated

from fastapi import Depends, Request

from app.platform.dependencies import get_resources
from app.platform.runtime import RuntimeResources


def get_runtime(request: Request) -> RuntimeResources:
    return get_resources(request)


RuntimeDep = Annotated[RuntimeResources, Depends(get_runtime)]
