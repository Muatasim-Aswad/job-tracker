"""Print OpenAPI JSON without opening a database or server. packages/shared/scripts/gen-api-types.sh uses this contract to generate TypeScript types."""

import json
import sys

from app.main import app


def main() -> None:
    json.dump(app.openapi(), sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
