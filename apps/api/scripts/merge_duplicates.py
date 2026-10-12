"""Detect duplicate jobs sharing company_key and title_key using core.similarity Jaccard overlap. gmail-manual/LinkedIn clusters use application provenance instead of descriptions.

Run from apps/api/:
  uv run python -m scripts.merge_duplicates            # dry run; writes reports
  uv run python -m scripts.merge_duplicates --execute  # apply merges
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from itertools import combinations
from pathlib import Path
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.enums import MERGE_IMPORTANCE
from app.core.similarity import jaccard, tokenize

JACCARD_MERGE = 0.65
JACCARD_DIFFERENT = 0.30

# Loosely-typed JSON shapes off the API — a job row from `GET /jobs`, a full
# `GET /jobs/{id}` detail (job + listings), and one entry in `detail["listings"]`.
JobRow = dict[str, Any]
JobDetail = dict[str, Any]
Listing = dict[str, Any]


@dataclass
class MergeGroup:
    company: str
    title: str
    survivor: JobDetail
    non_survivors: list[JobDetail]
    reason: str
    score: float | None


@dataclass
class SuspectGroup:
    company: str
    title: str
    jobs: list[JobDetail]
    reason: str


@dataclass
class DiffRoleGroup:
    company: str
    title: str
    jobs: list[JobDetail]
    reason: str


@dataclass
class NoJdItem:
    job_id: str
    platform: str
    platform_id: str
    company: str
    title: str
    status: str


@dataclass
class MergeResult:
    ns_id: str
    sv_id: str
    status: str
    detail: str | None = None


# ── API helpers ──────────────────────────────────────────────────────────────


def api_get(client: httpx.Client, path: str) -> Any:
    resp = client.get(path)
    resp.raise_for_status()
    return resp.json()


def api_post(
    client: httpx.Client, path: str, data: dict[str, Any]
) -> tuple[dict[str, Any] | None, str | None]:
    resp = client.post(path, json=data)
    if resp.status_code >= 400:
        return None, f"HTTP {resp.status_code}: {resp.text[:200]}"
    return resp.json(), None


# ── Job helpers ──────────────────────────────────────────────────────────────


def get_jd(job_detail: JobDetail) -> tuple[str | None, Listing | None]:
    for listing in job_detail.get("listings", []):
        desc = (listing.get("meta") or {}).get("description")
        if desc:
            return desc, listing
    return None, None


def get_listing(job_detail: JobDetail, prefer_platform: str | None = None) -> Listing | None:
    listings: list[Listing] = job_detail.get("listings", [])
    if prefer_platform:
        for listing in listings:
            if listing.get("platform") == prefer_platform:
                return listing
    return listings[0] if listings else None


def is_gmail_manual(listing: Listing | None) -> bool:
    return bool(
        listing
        and listing.get("platform") == "manual"
        and str(listing.get("platform_id", "")).startswith("gm-")
    )


def survivor_key(job: JobDetail) -> tuple[int, int]:
    status_score = MERGE_IMPORTANCE.get(job["status"], 0)
    has_linkedin = any(listing.get("platform") == "linkedin" for listing in job.get("listings", []))
    return (status_score, int(has_linkedin))


def pick_survivor(jobs: list[JobDetail]) -> JobDetail:
    return max(jobs, key=survivor_key)


# ── Sub-clustering via BFS on similar pairs ─────────────────────────────────


def find_sub_clusters(job_ids: set[str], similar_pairs: list[tuple[str, str]]) -> list[set[str]]:
    adj: dict[str, set[str]] = defaultdict(set)
    for a, b in similar_pairs:
        adj[a].add(b)
        adj[b].add(a)
    visited: set[str] = set()
    clusters: list[set[str]] = []
    for jid in job_ids:
        if jid in visited:
            continue
        cluster: set[str] = set()
        queue = [jid]
        while queue:
            cur = queue.pop()
            if cur in visited:
                continue
            visited.add(cur)
            cluster.add(cur)
            queue.extend(adj[cur] - visited)
        clusters.append(cluster)
    return clusters


# ── Main ─────────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="apply merges (default: dry run)")
    args = parser.parse_args()
    dry_run = not args.execute

    settings = get_settings()
    log_dir = settings.scripts_output_dir / "log"
    clusters_out = log_dir / "unmerged-clusters.md"
    merge_log = log_dir / "merge-log.md"
    no_jd_out = log_dir / "no-jd-listings.md"

    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    mode = "DRY RUN" if dry_run else "EXECUTE"
    print(f"=== Duplicate Merge Script - {mode} - {ts} ===\n")

    log_dir.mkdir(parents=True, exist_ok=True)

    with httpx.Client(base_url=f"http://localhost:{settings.port}") as client:
        print("Fetching all jobs...")
        all_jobs: list[JobRow] = api_get(client, "/jobs?limit=2000")
        print(f"  Total: {len(all_jobs)}")

        groups: dict[tuple[str, str], list[JobRow]] = defaultdict(list)
        for j in all_jobs:
            ck = (j.get("company_key") or "").strip()
            tk = (j.get("title_key") or "").strip()
            if ck and tk:
                groups[(ck, tk)].append(j)

        dup_groups = {k: v for k, v in groups.items() if len(v) > 1}
        all_dup_ids = {j["id"] for jobs in dup_groups.values() for j in jobs}
        print(f"  Duplicate groups: {len(dup_groups)}  |  Jobs in them: {len(all_dup_ids)}\n")

        print(f"Fetching full details for {len(all_dup_ids)} jobs...")
        details: dict[str, JobDetail] = {}
        for i, jid in enumerate(sorted(all_dup_ids), 1):
            details[jid] = api_get(client, f"/jobs/{jid}")
            if i % 25 == 0:
                print(f"  {i}/{len(all_dup_ids)}...")
        print("  Done.\n")

        merges: list[MergeGroup] = []
        suspects: list[SuspectGroup] = []
        diff_roles: list[DiffRoleGroup] = []
        no_jd_items: list[NoJdItem] = []

        for (ck, tk), basic_jobs in sorted(dup_groups.items(), key=lambda x: -len(x[1])):
            group = [details[j["id"]] for j in basic_jobs if j["id"] in details]
            company = group[0].get("company") or ck
            title = group[0].get("title") or tk

            jd_tokens: dict[str, set[str]] = {}
            for j in group:
                desc, _listing = get_jd(j)
                if desc:
                    jd_tokens[j["id"]] = tokenize(desc)
                else:
                    # Only flag linkedin listings without JD
                    for listing in j.get("listings", []):
                        if listing.get("platform") == "linkedin":
                            no_jd_items.append(
                                NoJdItem(
                                    job_id=j["id"],
                                    platform=listing["platform"],
                                    platform_id=listing["platform_id"],
                                    company=company,
                                    title=title,
                                    status=j["status"],
                                )
                            )

            # The gmail-manual + linkedin case, merged on provenance rather than JD
            # similarity (see module docstring).
            gmail_jobs = [j for j in group if is_gmail_manual(get_listing(j))]
            linkedin_jobs = [
                j
                for j in group
                if any(listing.get("platform") == "linkedin" for listing in j.get("listings", []))
            ]

            if gmail_jobs and linkedin_jobs:
                survivor = pick_survivor(
                    linkedin_jobs + [j for j in gmail_jobs if not is_gmail_manual(get_listing(j))]
                )
                non_surv = [j for j in group if j["id"] != survivor["id"]]
                merges.append(
                    MergeGroup(
                        company=company,
                        title=title,
                        survivor=survivor,
                        non_survivors=non_surv,
                        reason="gmail-manual + linkedin same role (no JD check needed)",
                        score=None,
                    )
                )
                continue

            # Need at least 2 JDs to compare
            jobs_with_jd = [j for j in group if j["id"] in jd_tokens]
            jobs_without_jd = [j for j in group if j["id"] not in jd_tokens]

            if len(jobs_with_jd) < 2:
                n_have = len(jobs_with_jd)
                suspects.append(
                    SuspectGroup(
                        company=company,
                        title=title,
                        jobs=group,
                        reason=f"{n_have}/{len(group)} jobs have JD - cannot compare",
                    )
                )
                continue

            pairs = list(combinations(jobs_with_jd, 2))
            scores = {
                (a["id"], b["id"]): jaccard(jd_tokens[a["id"]], jd_tokens[b["id"]])
                for a, b in pairs
            }

            min_s = min(scores.values())
            max_s = max(scores.values())
            avg_s = sum(scores.values()) / len(scores)

            if min_s >= JACCARD_MERGE:
                # All pairs similar -> whole group is one job
                survivor = pick_survivor(group)
                merges.append(
                    MergeGroup(
                        company=company,
                        title=title,
                        survivor=survivor,
                        non_survivors=[j for j in group if j["id"] != survivor["id"]],
                        reason=f"JD similarity confirmed (min={min_s:.2f} avg={avg_s:.2f})",
                        score=avg_s,
                    )
                )

            elif max_s < JACCARD_DIFFERENT:
                # All pairs clearly different -> different client roles
                diff_roles.append(
                    DiffRoleGroup(
                        company=company,
                        title=title,
                        jobs=group,
                        reason=f"JD similarity low (max={max_s:.2f}) - likely different client roles",
                    )
                )

            else:
                # Mixed - find sub-clusters of mutually similar jobs
                similar_pairs = [(a, b) for (a, b), s in scores.items() if s >= JACCARD_MERGE]
                sub_clusters = find_sub_clusters({j["id"] for j in jobs_with_jd}, similar_pairs)

                for sc in sub_clusters:
                    if len(sc) < 2:
                        continue
                    sc_jobs = [j for j in jobs_with_jd if j["id"] in sc]
                    sc_scores = [s for (a, b), s in scores.items() if a in sc and b in sc]
                    sc_avg = sum(sc_scores) / len(sc_scores) if sc_scores else 0
                    # Attach no-JD jobs only if this is the sole merge cluster in the group
                    extra = (
                        jobs_without_jd if len([s for s in sub_clusters if len(s) > 1]) == 1 else []
                    )
                    all_sc = sc_jobs + extra
                    survivor = pick_survivor(all_sc)
                    merges.append(
                        MergeGroup(
                            company=company,
                            title=title,
                            survivor=survivor,
                            non_survivors=[j for j in all_sc if j["id"] != survivor["id"]],
                            reason=f"JD sub-cluster (size={len(sc)}, avg={sc_avg:.2f})",
                            score=sc_avg,
                        )
                    )

                # Leftover singletons -> suspects
                merged_ids = {j["id"] for m in merges for j in ([m.survivor] + m.non_survivors)}
                leftover = [
                    j
                    for j in group
                    if j["id"] not in merged_ids
                    and not any(j["id"] in sc for sc in sub_clusters if len(sc) > 1)
                ]
                if leftover:
                    leftover_ids = {j["id"] for j in leftover}
                    ambig = [
                        (a, b, s)
                        for (a, b), s in scores.items()
                        if (a in leftover_ids or b in leftover_ids)
                        and JACCARD_DIFFERENT <= s < JACCARD_MERGE
                    ]
                    reason = (
                        f"ambiguous JD similarity ({[f'{s:.2f}' for _, _, s in ambig]})"
                        if ambig
                        else "singleton after sub-clustering - no pair crossed either threshold"
                    )
                    suspects.append(
                        SuspectGroup(company=company, title=title, jobs=leftover, reason=reason)
                    )

        total_elim = sum(len(m.non_survivors) for m in merges)
        print("=== SUMMARY ===")
        print(f"  Confirmed merges : {len(merges)} groups, {total_elim} jobs to eliminate")
        print(f"  Remaining suspects: {len(suspects)} groups")
        print(f"  Confirmed diff roles (no merge needed): {len(diff_roles)} groups")
        print(f"  Listings missing JD: {len(no_jd_items)}\n")

        print("=== MERGE PLAN ===")
        for m in merges:
            sv = m.survivor
            print(f"\n  [{m.company} / {m.title}]")
            print(f"  Survivor  : {sv['id'][:8]} status={sv['status']}")
            eliminate = ", ".join(f"{j['id'][:8]}({j['status']})" for j in m.non_survivors)
            print(f"  Eliminate : {eliminate}")
            print(f"  Reason    : {m.reason}")

        print(f"\n=== SUSPECT GROUPS ({len(suspects)}) ===")
        for s in suspects:
            print(f"  {s.company} / {s.title} ({len(s.jobs)}x) - {s.reason}")

        merge_results: list[MergeResult] = []
        if dry_run:
            print("\n--- DRY RUN: no changes made. Run with --execute to apply. ---")
        else:
            print("\n=== EXECUTING MERGES ===")
            for m in merges:
                current_sv_id = m.survivor["id"]  # API may reassign survivor; track actual ID
                for ns in m.non_survivors:
                    ns_listing = get_listing(ns)
                    if not ns_listing:
                        print(f"  SKIP {ns['id'][:8]}: no listing")
                        merge_results.append(
                            MergeResult(
                                ns_id=ns["id"], sv_id=current_sv_id, status="skipped_no_listing"
                            )
                        )
                        continue
                    print(f"  {ns['id'][:8]} -> {current_sv_id[:8]} ... ", end="", flush=True)
                    result, err = api_post(
                        client,
                        "/listings/link-job",
                        {
                            "platform": ns_listing["platform"],
                            "platform_id": ns_listing["platform_id"],
                            "other_job_id": current_sv_id,
                        },
                    )
                    if err or result is None:
                        print(f"ERROR {err}")
                        merge_results.append(
                            MergeResult(
                                ns_id=ns["id"], sv_id=current_sv_id, status="error", detail=err
                            )
                        )
                    else:
                        current_sv_id = result["job_id"]  # use actual survivor for next merge
                        print(f"OK (survivor={current_sv_id[:8]})")
                        merge_results.append(
                            MergeResult(ns_id=ns["id"], sv_id=current_sv_id, status="merged")
                        )

    _write_merge_log(merge_log, merges, merge_results, ts, dry_run)
    _write_no_jd(no_jd_out, no_jd_items, ts)
    _write_clusters(clusters_out, suspects, diff_roles, ts)

    print("\nFiles written:")
    print(f"  {merge_log}")
    print(f"  {no_jd_out}")
    print(f"  {clusters_out}")


# ── File writers ─────────────────────────────────────────────────────────────


def _write_merge_log(
    path: Path, merges: list[MergeGroup], results: list[MergeResult], ts: str, dry_run: bool
) -> None:
    total_elim = sum(len(m.non_survivors) for m in merges)
    lines = [
        f"# Merge Log - {ts}",
        "",
        f"**{len(merges)} groups** | **{total_elim} jobs eliminated** | "
        f"{'DRY RUN - no changes applied' if dry_run else 'EXECUTED'}",
        "",
    ]
    result_by_ns = {r.ns_id: r for r in results}
    for m in merges:
        sv = m.survivor
        lines += [
            f"## {m.company} / {m.title}",
            f"- **Survivor**: `{sv['id'][:8]}` status={sv['status']}",
            f"- **Reason**: {m.reason}",
            "- **Eliminated**:",
        ]
        for ns in m.non_survivors:
            r = result_by_ns.get(ns["id"])
            status_str = f"-> {r.status}" if r else "-> (dry run)"
            lines.append(f"  - `{ns['id'][:8]}` status={ns['status']} {status_str}")
        lines.append("")
    path.write_text("\n".join(lines))


def _write_no_jd(path: Path, items: list[NoJdItem], ts: str) -> None:
    lines = [
        f"# Listings Without JD - {ts}",
        "",
        "These LinkedIn listings were part of duplicate groups but had no `description` captured.",
        "Open each link, let the tracker capture the JD, then re-run `merge_duplicates.py`.",
        "",
        f"**{len(items)} listings across {len({i.company for i in items})} companies**",
        "",
    ]
    by_company: dict[str, list[NoJdItem]] = defaultdict(list)
    for i in items:
        by_company[i.company].append(i)
    for company in sorted(by_company.keys()):
        lines.append(f"## {company}")
        for i in by_company[company]:
            url = (
                f"https://www.linkedin.com/jobs/view/{i.platform_id}/"
                if i.platform == "linkedin"
                else ""
            )
            link = f"[{i.title}]({url})" if url else i.title
            lines.append(f"- `{i.job_id[:8]}` {link} status={i.status}")
        lines.append("")
    path.write_text("\n".join(lines))


def _write_clusters(
    path: Path, suspects: list[SuspectGroup], diff_roles: list[DiffRoleGroup], ts: str
) -> None:
    lines = [
        f"# Unmerged same-title clusters - updated {ts}",
        "",
        "Remaining suspects after JD-similarity merge pass. Causes:",
        "- **ambiguous** - Jaccard 0.30-0.65 (inconclusive)",
        "- **missing JD** - one or more jobs lack a captured description",
        "",
        f"**{len(suspects)} clusters**",
        "",
    ]
    by_company: dict[str, list[SuspectGroup]] = defaultdict(list)
    for s in suspects:
        by_company[s.company].append(s)
    for company in sorted(by_company.keys()):
        clusters = by_company[company]
        lines.append(f"## {company} - {len(clusters)} cluster(s)")
        for s in clusters:
            lines.append(f"- **{s.title}** ({len(s.jobs)}x) - _{s.reason}_")
            for j in s.jobs:
                lst = get_listing(j)
                plat = f"{lst['platform']}/{lst['platform_id']}" if lst else "no-listing"
                lines.append(f"  - `{j['id'][:8]}` status={j['status']} platform={plat}")
        lines.append("")

    if diff_roles:
        lines += [
            "---",
            "",
            "## Confirmed different roles - removed from suspects",
            "",
            "Same company+title key but JD confirmed them as distinct positions "
            "(e.g. different clients at an agency).",
            "",
        ]
        for d in diff_roles:
            lines.append(f"- **{d.company} / {d.title}** ({len(d.jobs)}x) - {d.reason}")
        lines.append("")

    path.write_text("\n".join(lines))


if __name__ == "__main__":
    main()
