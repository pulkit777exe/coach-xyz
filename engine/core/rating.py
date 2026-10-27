"""Performance rating for a session: training vs match."""
from __future__ import annotations

VALID_MODES = {"training", "match"}
OPPOSITION = {
    "weaker": (0.85, 1.15),
    "even": (1.0, 1.0),
    "stronger": (1.15, 0.85),
}


def _mode(mode):
    if mode is None or str(mode).strip() == "":
        return "training", True
    m = str(mode).strip().lower()
    if m not in VALID_MODES:
        raise ValueError(f"invalid mode: {mode}")
    return m, False


def _window_weight(t, windows):
    if not windows:
        return 1.0
    for w in windows:
        try:
            if float(w["from"]) <= t <= float(w["to"]):
                return float(w.get("stakes", 1.0))
        except (KeyError, TypeError, ValueError):
            continue
    return 1.0


def compute(events, pack, *, mode=None, opposition=None, windows=None, outcomes_known=True, assumed=None):
    mode_val, assumed_flag = _mode(mode)
    if assumed is not None:
        assumed_flag = bool(assumed)
    if mode_val == "match" and opposition is not None and str(opposition).lower() not in OPPOSITION:
        raise ValueError(f"invalid opposition: {opposition}")
    # validate windows stakes
    if windows:
        for w in windows:
            stakes = float(w.get("stakes", 1.0))
            if stakes < 0.5 or stakes > 2.0:
                raise ValueError(f"invalid stakes: {stakes}")

    rating_cfg = getattr(pack, "rating", None)
    swing = getattr(rating_cfg, "swing", 1.0)
    default_expected = getattr(rating_cfg, "default_expected", 0.5)
    expected_map = getattr(rating_cfg, "expected", {}) or {}
    extras_map = getattr(rating_cfg, "extras", {}) or {}

    positive = set(getattr(pack, "positive", []) or [])
    negative = set(getattr(pack, "negative", []) or [])

    gain_mult, loss_mult = (1.0, 1.0)
    if mode_val == "match":
        opp = (opposition or "even").lower()
        gain_mult, loss_mult = OPPOSITION.get(opp, (1.0, 1.0))

    total = 0.0
    breakdown = []
    decisive = 0
    form_contribs = []

    for e in events or []:
        etype = e.get("type")
        result = e.get("result")
        t = float(e.get("t", 0.0))
        expected = expected_map.get(etype, default_expected)
        base = 0.0
        kind = None
        if result in positive:
            base = swing * (1.0 - expected)
            kind = "outcome_gain"
            decisive += 1
        elif result in negative:
            base = -swing * expected
            extra = extras_map.get(result, 0.0)
            base += extra
            kind = "outcome_loss"
            decisive += 1
        else:
            kind = "neutral"

        impact = base
        if mode_val == "training":
            # outcomes worth 0.6x
            impact *= 0.6
            if result in negative:
                # misses forgiven by half
                impact *= 0.5
            # good form adds up to +/-0.3 (collected, applied in aggregate)
            score = e.get("score")
            if score is not None:
                form_contribs.append((score, e))
        else:
            # match: conditions scale gains/losses
            if impact > 0:
                impact *= gain_mult
            elif impact < 0:
                impact *= loss_mult
            # windows weight stretch
            if windows:
                impact *= _window_weight(t, windows)

        # attach impact to event (mutate copy not needed; mutate original)
        e["impact"] = round(impact, 4) if outcomes_known else None
        if not outcomes_known:
            impact = 0.0
            e["impact"] = None

        total += impact
        if kind in ("outcome_gain", "outcome_loss"):
            breakdown.append({
                "event": e.get("id"),
                "t": t,
                "type": etype,
                "result": result,
                "factor": kind,
                "impact": round(impact, 4),
                "explanation": f"{result} at {t}s: {impact:+.3f}",
            })

    # good form aggregate +/-0.3 in training
    if mode_val == "training" and outcomes_known and form_contribs:
        # average form deviation from 5, scaled
        avg_score = sum(fc[0] for fc in form_contribs) / len(form_contribs)
        form_total = (avg_score - 5.0) / 5.0 * 0.3
        form_total = max(-0.3, min(0.3, form_total))
        total += form_total
        breakdown.append({
            "factor": "good_form",
            "impact": round(form_total, 4),
            "explanation": f"form contribution {form_total:+.3f} (avg form {avg_score:.1f})",
        })

    if mode_val == "match" and windows:
        breakdown.append({
            "factor": "windows",
            "explanation": "window stakes applied to events in range",
        })

    if mode_val == "match" and opposition:
        breakdown.append({
            "factor": "opposition",
            "impact": None,
            "explanation": f"opposition={opposition} scales gains/losses",
        })

    if not outcomes_known:
        rating = None
        breakdown = [{"factor": "outcomes_unknown", "explanation": "model unavailable; no outcomes known"}]
        confidence = 0.0
    else:
        rating = round(total, 4)
        n = len(events or [])
        confidence = 0.0 if n == 0 else min(1.0, decisive / max(1, n) + 0.2 * min(decisive, 3) / 3)
        # simpler: based on decisive events count
        confidence = min(1.0, decisive / 5.0) if decisive else (0.2 if n else 0.0)
        if decisive == 0:
            confidence = 0.1

    return {
        "rating": rating,
        "mode": mode_val,
        "mode_assumed": assumed_flag,
        "breakdown": breakdown,
        "confidence": round(float(confidence), 2),
    }

# aliases
rate = compute
compute_rating = compute
compute_performance = compute
performance = compute
build = compute
build_performance = compute
