from pathlib import Path

path = Path(__file__).resolve().parent / "server.py"
text = path.read_text(encoding="utf-8")
start = text.index("def run_scope_ai(body: Dict[str, Any]) -> Dict[str, Any]:")
end = text.index("\ndef main():")
new = r'''
def _ascii_clean(s: str) -> str:
    """Remove mojibake / non-printable junk from model output."""
    if not s:
        return ""
    s = s.lstrip("\ufeff")
    for bad, good in (
        ("\u2014", "-"),
        ("\u2013", "-"),
        ("\u2018", "'"),
        ("\u2019", "'"),
        ("\u201c", '"'),
        ("\u201d", '"'),
        ("\u2022", "-"),
        ("\u00a0", " "),
    ):
        s = s.replace(bad, good)
    return "".join(ch if (ord(ch) >= 32 and ord(ch) < 127) or ch in "\n\r\t" else "" for ch in s)


def run_scope_ai(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Step 2 - WL Painting proposal.
    Prefer polishing a LOGIC DRAFT built from real takeoff quantities.
    Only add clarifications from evidence-based plan-sweep findings.
    """
    notes = body.get("notes") or ""
    company = body.get("company") or "WL Painting Inc."
    sweep_text = (body.get("sweep_text") or body.get("plansweep") or "").strip()
    draft_scope = (body.get("draft_scope") or "").strip()
    evidence_text = (body.get("evidence_text") or "").strip()

    system = (
        "You edit bid documents for WL Painting Inc. "
        "NO tools. Final document only. "
        "Keep every Scope of Work line from the LOGIC DRAFT that has a quantity. "
        "You may clarify wording, but MUST NOT invent paint areas, rooms, or systems "
        "unsupported by EVIDENCE or the LOGIC DRAFT. ASCII only."
    )
    user = f"""Polish into the final WL Painting proposal.

COMPANY: {company}

===== LOGIC DRAFT (source of truth for scope lines + numbers) =====
{draft_scope or '(no draft - do not invent quantities; say takeoff pending in Clarifications)'}

===== EVIDENCE PACK =====
{evidence_text[:10000] or '(none)'}

===== PLAN-SWEEP (use ONLY findings that cite Evidence; ignore generic guesses) =====
{sweep_text[:10000] or '(none)'}

===== ESTIMATOR NOTES =====
{notes or '(none)'}

OUTPUT RULES:
1) Structure:
Project: ...
Scope of Work
1. Provide labor and materials to ...
Clarifications
1. ...
Exclusions
- ...

2) Keep draft quantity numbers exact (rephrase verbs only).
3) From sweep: only add clarification/exclusion if finding has Evidence cited.
4) No checkbox dumps. ASCII only. Start with Project:
"""

    result = _ai_chat(system, user, mode="scope")
    result["mode"] = "scope"
    if result.get("text"):
        result["text"] = _ascii_clean(result["text"])
    if not (result.get("text") or "").strip() and draft_scope:
        result["text"] = draft_scope
        result["ok"] = True
        result["fallback"] = "draft_scope"
    return result


def run_plansweep_ai(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Step 1 - Evidence-based plan-sweep only.
    No generic amenity checklists unless tied to a hard fact.
    """
    notes = body.get("notes") or ""
    evidence_text = (body.get("evidence_text") or "").strip()
    job = body.get("job") or {}
    project_name = job.get("name", "") or "Project"

    if not evidence_text:
        drawings = body.get("drawings") or []
        quantities = body.get("quantities") or []
        draw_lines = [f"- {d.get('name') or d}" for d in drawings[:100]] or ["- (none)"]
        qty_lines = [
            f"- {q.get('name', '')}: {q.get('qty', 0)} {q.get('unit', '')}"
            for q in quantities[:50]
        ] or ["- (none)"]
        evidence_text = (
            f"JOB\n- Name: {project_name}\n- Number: {job.get('jobNumber', '')}\n"
            f"PAGES/DRAWINGS\n" + "\n".join(draw_lines) + "\nQUANTITIES\n" + "\n".join(qty_lines)
            + f"\nNOTES\n{notes or '(none)'}\n"
        )

    system = (
        "You are a painting estimator auditor. "
        "Report ONLY findings supported by the evidence pack. "
        "NO tools. Final markdown only. ASCII only. "
        "If evidence is thin, say so - never invent finish schedules or amenity lists."
    )
    user = f"""EVIDENCE-BASED PLAN-SWEEP for WL Painting.

ONLY write findings grounded in the EVIDENCE PACK.
Every finding needs: Evidence | Why it matters | Action.

FORBIDDEN:
- Generic Planet Fitness / gym amenity laundry lists without a cited page, qty, or note
- Invented finish tags (P-1, P-2) unless those strings appear in evidence/notes
- Planning sentences
- Non-ASCII or garbage characters

===== EVIDENCE PACK =====
{evidence_text[:16000]}

===== OUTPUT FORMAT =====
## Evidence-based plan-sweep - {project_name}

### A. What we know (from file)
- Restate hard facts only (job, measured qtys, pages loaded, notes). Max 12 bullets.

### B. Real findings
For each finding (quality over quantity, typically 3-10):
#### Finding N - short title
- Evidence: <point to page/qty/note fact>
- Why it matters: <painting logic, 1-2 sentences>
- Action: <measure or verify next>

### C. Cannot determine yet
- Genuine unknowns only (no speculation).

### D. Scope logic for proposal
Numbered rules Step 2 must follow, e.g. only measured qty>0 becomes paid scope lines.

### E. Suggested next measures
- Only what evidence implies (existing zero-qty conditions, page names, notes).

If measured quantities exist, discuss those numbers. Do not invent unrelated rooms.
"""

    result = _ai_chat(system, user, mode="plansweep")
    result["mode"] = "plansweep"
    if result.get("text"):
        result["text"] = _ascii_clean(result["text"])
    return result


'''
path.write_text(text[:start] + new + text[end:], encoding="utf-8")
compile(path.read_text(encoding="utf-8"), str(path), "exec")
print("ok")
