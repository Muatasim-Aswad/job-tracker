# Contributing and support

Bug reports and focused pull requests are welcome in the repository's [GitHub issue tracker](https://github.com/Muatasim-Aswad/job-tracker/issues). Ask usage and support questions in [GitHub Discussions](https://github.com/Muatasim-Aswad/job-tracker/discussions/categories/q-a). Before opening an issue, search for an existing report and include reproduction steps, expected and actual behavior, platform versions, and relevant logs with personal job or email data removed.

For a code change:

1. Fork the repository, branch from `main`, and open the pull request from your fork — the repository does not grant push access.
2. Keep it focused and add or update tests for behavior changes.
3. Run `bash scripts/check.sh`.
4. Explain user-visible behavior, privacy implications, and migration needs in the pull request.

This is a local-first personal project, not a hosted service. Community support is best-effort, and public-internet deployments are outside the supported threat model. Report security issues privately as described in [`SECURITY.md`](SECURITY.md).

Project-wide developer policy — the quality gate, generated files, comment and Markdown style, migration compatibility, and release versioning — lives in the [development guide](docs/DEVELOPMENT.md). Read it before your first change.
