#!/usr/bin/env python3
"""Generate docs/database.md and docs/schema/schema.json from docs/schema/model.py.

Run from the repository root: python3 scripts/gen_schema_docs.py
Fails if a foreign key points at a table that does not exist.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "docs" / "schema"))

import model  # noqa: E402

COLUMN = re.compile(
    r"^(?P<name>\w+)\s+(?P<type>[\w\[\]]+)(?P<null>\?)?(?:\s*->\s*(?P<ref>\w+))?(?:\s*\|\s*(?P<note>.+))?$"
)

OFFLINE_LABEL = {
    "read_write": "read and write on devices",
    "read_only": "read-only on devices",
    "server_only": "server only",
}

RLS_LABEL = {
    "clinic": "Clinic-scoped: org_id + row-level security",
    "global": "Platform-wide: no tenant, written by Sakalya or the system",
    "user": "User-scoped: rows belong to one signed-in user",
}


def parse() -> dict:
    tables = {}
    for table in model.TABLES:
        cols = []
        for raw in table["cols"]:
            match = COLUMN.match(raw.strip())
            if not match:
                sys.exit(f"cannot parse column in {table['name']}: {raw!r}")
            cols.append(
                {
                    "name": match["name"],
                    "type": match["type"],
                    "nullable": bool(match["null"]),
                    "ref": match["ref"],
                    "note": (match["note"] or "").strip(),
                }
            )
        tables[table["name"]] = {
            "name": table["name"],
            "domain": table["domain"],
            "purpose": table["purpose"],
            "rls": table["rls"],
            "star": table.get("star", False),
            "partitioned": table.get("partitioned", False),
            "notes": table.get("notes", ""),
            "cols": cols,
        }

    missing = [
        f"{t['name']}.{c['name']} -> {c['ref']}"
        for t in tables.values()
        for c in t["cols"]
        if c["ref"] and c["ref"] not in tables
    ]
    if missing:
        sys.exit("unknown foreign key targets:\n  " + "\n  ".join(missing))

    referenced_by = defaultdict(list)
    for t in tables.values():
        for c in t["cols"]:
            if c["ref"]:
                referenced_by[c["ref"]].append(f"{t['name']}.{c['name']}")
    for name, t in tables.items():
        t["referenced_by"] = sorted(referenced_by.get(name, []))

    for group in (model.SENSITIVITY_OVERRIDES, model.OFFLINE_READ_WRITE, model.OFFLINE_READ_ONLY):
        unknown = [name for name in group if name not in tables]
        if unknown:
            sys.exit(f"classification names unknown tables: {unknown}")
    for name, t in tables.items():
        t["sensitivity"] = model.SENSITIVITY_OVERRIDES.get(name, model.SENSITIVITY_BY_DOMAIN[t["domain"]])
        t["offline"] = (
            "read_write" if name in model.OFFLINE_READ_WRITE
            else "read_only" if name in model.OFFLINE_READ_ONLY
            else "server_only"
        )

    domain_names = {d[0] for d in model.DOMAINS}
    for t in tables.values():
        if t["domain"] not in domain_names:
            sys.exit(f"unknown domain {t['domain']} on {t['name']}")

    journeys = []
    for key, title, steps in model.JOURNEYS:
        for _, used, _ in steps:
            for name in used:
                if name not in tables:
                    sys.exit(f"journey {key} uses unknown table {name}")
        journeys.append(
            {
                "key": key,
                "title": title,
                "steps": [{"actor": a, "tables": u, "what": w} for a, u, w in steps],
            }
        )

    return {
        "domains": [{"key": k, "label": l, "purpose": p} for k, l, p in model.DOMAINS],
        "tables": list(tables.values()),
        "journeys": journeys,
    }


def domain_edges(schema: dict) -> Counter:
    domain_of = {t["name"]: t["domain"] for t in schema["tables"]}
    edges: Counter = Counter()
    for t in schema["tables"]:
        for c in t["cols"]:
            if c["ref"] and c["ref"] != "organizations":
                a, b = t["domain"], domain_of[c["ref"]]
                if a != b:
                    edges[(a, b)] += 1
    return edges


def mermaid_domain_map(schema: dict) -> str:
    lines = ["flowchart LR"]
    for d in schema["domains"]:
        count = sum(1 for t in schema["tables"] if t["domain"] == d["key"])
        lines.append(f'  {d["key"]}["{d["label"]}<br/>{count} tables"]')
    for (a, b), n in sorted(domain_edges(schema).items()):
        lines.append(f"  {a} -->|{n}| {b}")
    return "\n".join(lines)


def mermaid_domain_er(schema: dict, domain: str) -> str:
    names = {t["name"] for t in schema["tables"] if t["domain"] == domain}
    lines = ["erDiagram"]
    linked = set()
    for t in schema["tables"]:
        if t["name"] not in names:
            continue
        for c in t["cols"]:
            if c["ref"] in names:
                left = "|o" if c["nullable"] else "||"
                lines.append(f'  {c["ref"]} {left}--o{{ {t["name"]} : "{c["name"]}"')
                linked.update({c["ref"], t["name"]})
    for name in sorted(names - linked):
        lines.append(f"  {name} {{\n    uuid id\n  }}")
    return "\n".join(lines)


def markdown(schema: dict) -> str:
    tables = schema["tables"]
    by_domain = defaultdict(list)
    for t in tables:
        by_domain[t["domain"]].append(t)
    stars = [t["name"] for t in tables if t["star"]]

    out = [
        "# Database",
        "",
        "<!-- Generated by scripts/gen_schema_docs.py from docs/schema/model.py. Do not edit by hand. -->",
        "",
        f"{len(tables)} tables in {len(schema['domains'])} areas. "
        f"{len(stars)} are needed for the foundation milestone (marked ★). "
        "This is the design; once migrations exist they become the truth and this file is regenerated from them.",
        "",
        "## Conventions every table follows",
        "",
        "- **Clinic-scoped tables** also have `org_id uuid -> organizations`, `id uuid`, a primary key of `(org_id, id)`, "
        "`created_at`, `created_by`, `updated_at`, `updated_by`, and `deleted_at` where rows can be removed. "
        "Foreign keys include `org_id`, so a row can never point at another clinic's row. "
        "Row-level security limits every query to `org_id = app.tenant_id()`.",
        "- **Platform tables** have `id uuid` as the primary key and no row-level tenant filter; only the console and the system write them.",
        "- **User tables** belong to one signed-in user.",
        "- IDs are UUIDv7. Money is `bigint` paise. Times are `timestamptz` in UTC. Enums are Postgres enum types.",
        "- Readable numbers (`SC-1042`, `SC/26-27/000318`) come from `number_sequences`.",
        "- Tables marked *partitioned* are split by month.",
        "- **Immutable once final:** signed notes (corrections are addenda), issued prescriptions (cancel and reissue), issued bills (void and replace), and observations (a correction supersedes). Readable numbers are assigned by the server at issue, never on a device.",
        "- **Clinical codes are optional:** free text always works; `code_system`, `code`, `code_display` and `code_version` leave room for ICD, SNOMED and LOINC when interoperability needs them.",
        "- **Provenance:** important clinical rows record `source` (clinician, assistant, patient, import, device, AI draft, ABDM) and who verified it.",
        "- **Sensitivity** (public, internal, personal, financial, health) decides what may be logged, exported, sent to analytics, shown to support, or given to AI. **Offline** says whether phones may write a table, only read it, or never hold it.",
        "- **Schema checks in CI:** every clinic table must have `org_id`, a composite key, tenant-aware foreign keys, row-level security with a policy, and an audit trigger. A test fails the build otherwise.",
        "",
        "## How the areas connect",
        "",
        "Arrows show foreign keys between areas (links to `organizations` omitted). The number is how many.",
        "",
        "```mermaid",
        mermaid_domain_map(schema),
        "```",
        "",
        "## Journeys: which tables a real task touches",
        "",
    ]
    for j in schema["journeys"]:
        out.append(f"### {j['title']}")
        out.append("")
        for i, step in enumerate(j["steps"], 1):
            used = ", ".join(f"`{n}`" for n in step["tables"])
            out.append(f"{i}. **{step['actor']}**: {step['what']} ({used})")
        out.append("")

    out += ["## Offline", "", "What the phone apps may do without a connection.", ""]
    for mode in ("read_write", "read_only"):
        names = ", ".join(f"`{t['name']}`" for t in tables if t["offline"] == mode)
        out += [f"- **{OFFLINE_LABEL[mode].capitalize()}:** {names}", ""]
    out += ["- **Server only:** everything else, including bill and prescription numbers, payments, share links, audit and access logs, permissions and plans.", ""]

    for d in schema["domains"]:
        items = by_domain[d["key"]]
        out += [f"## {d['label']} (`{d['key']}`)", "", d["purpose"], "", "```mermaid", mermaid_domain_er(schema, d["key"]), "```", ""]
        for t in items:
            flags = []
            if t["star"]:
                flags.append("★ foundation")
            if t["partitioned"]:
                flags.append("partitioned")
            flag_text = f" ({', '.join(flags)})" if flags else ""
            out += [
                f"### `{t['name']}`{flag_text}",
                "",
                t["purpose"],
                "",
                f"*{RLS_LABEL[t['rls']]} · sensitivity: {t['sensitivity']} · offline: {OFFLINE_LABEL[t['offline']]}*",
                "",
            ]
            out += ["| Column | Type | Notes |", "|---|---|---|"]
            for c in t["cols"]:
                kind = c["type"] + ("?" if c["nullable"] else "")
                note = c["note"]
                if c["ref"]:
                    note = f"→ `{c['ref']}`" + (f". {note}" if note else "")
                out.append(f"| `{c['name']}` | `{kind}` | {note} |")
            out.append("")
            if t["notes"]:
                out += [t["notes"], ""]
            if t["referenced_by"]:
                out += ["Referenced by: " + ", ".join(f"`{r}`" for r in t["referenced_by"]), ""]
    return "\n".join(out)


def main() -> None:
    schema = parse()
    (ROOT / "docs" / "schema" / "schema.json").write_text(json.dumps(schema, indent=1) + "\n")
    (ROOT / "docs" / "database.md").write_text(markdown(schema))
    stars = sum(1 for t in schema["tables"] if t["star"])
    print(f"{len(schema['tables'])} tables, {stars} foundation, {len(schema['journeys'])} journeys")


if __name__ == "__main__":
    main()
