"""
sap_translation.py — Layer-2 SAP Translation Layer (Section 7).

Pure, dependency-free helpers (stdlib only — NO bigquery, NO I/O) that:

  1. classify()            : agent decision -> {decision_type, sap_transaction_target, change_type}
                             (deterministic FALLBACK used when the synthesizer did not emit a
                              `sap_action`; the agent-emitted value wins when present)
  2. pad_*()               : SAP key conventions (material 18, sales-order/delivery 10, item 6)
  3. build_batp_payload()  : assemble the Section-7 `batp_payload` envelope (§7.1) with the
                             matching transaction template (§7.2 VA02 / §7.3 VL02N /
                             §7.4 MIGO / §7.5 ME21N), or transactions:[] + escalation.

Real order values (material, SO, qty, dates, customer) come from the decision; SAP master /
config values (sales_org, dist_channel, division, plant, storage_location, delivery_number,
shipping_point) come from the `master` dict (BigQuery lookup in data_pipeline.build_sap_payload).
Anything not found in `master` falls back to a clearly-flagged placeholder.

Classification mapping (agent prompt guidance mirrors this table):

  | Condition (priority order)                                   | decision_type           | tcode  | change_type     |
  | deadlock / hard_block (BLOCK) / confidence < 0.60 / REJECT   | ESCALATION              | None   | —               |
  | PARTIAL_FULFILL (split / shortfall)                          | ORDER_ADJUSTMENT        | VA02   | QUANTITY_CHANGE |
  | agent flags a cross-plant transfer                          | TRANSFER_RECOMMENDATION | ME21N  | —               | (agent only)
  | agent flags an at-risk delivery expedite                    | DELIVERY_FLAG           | VL02N  | EXPEDITE_FLAG   | (agent only)
  | DEFER                                                        | ORDER_ADJUSTMENT        | VA02   | DATE_CHANGE     |
  | ACCEPT (full, as-is)                                         | ORDER_ADJUSTMENT        | VA02   | QUANTITY_CHANGE |
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

CONFIDENCE_THRESHOLD = 0.60

# Illustrative SAP config placeholders (map to client config when SAP is wired).
_DEFAULTS = {
    "sales_org": "US10",
    "distribution_channel": "10",
    "division": "00",
    "storage_location": "FG01",
    "purchasing_org": "US01",
    "purchasing_group": "P01",
    "supplying_plant": "US02",
    "receiving_plant": "DC05",
    "shipping_point": "DC05",
    "plant": "DC05",
}

_VALID_DECISION_TYPES = {
    "TRANSFER_RECOMMENDATION", "ORDER_ADJUSTMENT", "DELIVERY_FLAG", "ESCALATION",
}
_VALID_TCODES = {"ME21N", "MIGO", "VA02", "VL02N"}


# ---------------------------------------------------------------------------
# SAP key conventions
# ---------------------------------------------------------------------------
def _pad(value: Any, width: int) -> str:
    """Digits-only, leading-zeros normalized, then zero-padded to `width`.
    Normalizing first means an already-(over)padded source like '004500055771'
    collapses to its significant '4500055771' before re-padding to exactly 10."""
    s = "".join(ch for ch in str(value or "") if ch.isdigit())
    if not s:
        return ""
    s = s.lstrip("0") or "0"
    return s.rjust(width, "0")


def pad_material(value: Any) -> str:
    """18-char SAP material (MARA-MATNR), right-justified zero-padded."""
    return _pad(value, 18)


def pad_so(value: Any) -> str:
    """10-digit SAP sales-order / purchase-doc number."""
    return _pad(value, 10)


def pad_delivery(value: Any) -> str:
    """10-digit SAP delivery number (LIKP-VBELN)."""
    return _pad(value, 10)


def pad_item(value: Any) -> str:
    """6-char SAP item/line number, e.g. 000010."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = 10
    return f"{n:06d}"


def derive_delivery_number(sales_order_number: Any) -> str:
    """Deterministic illustrative delivery number from a sales order
    (8000000000 + numeric SO), matching the Section-7 deliverable's 0080044019."""
    s = "".join(ch for ch in str(sales_order_number or "") if ch.isdigit())
    if not s:
        return ""
    return pad_delivery(str(8000000000 + int(s)))


def _num(x: Any) -> Any:
    """Return an int when the value is whole, else a float, else 0."""
    try:
        f = float(x)
    except (TypeError, ValueError):
        return 0
    return int(f) if f == int(f) else round(f, 3)


# ---------------------------------------------------------------------------
# Classification (deterministic fallback)
# ---------------------------------------------------------------------------
def classify(reason: dict) -> dict:
    """Derive {decision_type, sap_transaction_target, change_type} from a
    decision_reason-shaped dict. Used when the agent did not emit `sap_action`.

    Recognized keys: agent_recommendation, agent_confidence_score,
    conflicts_detected[ {resolution} ], specialist_dispositions{ name:{disposition} }.
    """
    reason = reason or {}
    action = str(reason.get("agent_recommendation") or "").upper()
    conf = reason.get("agent_confidence_score")
    conflicts = reason.get("conflicts_detected") or []
    dispositions = reason.get("specialist_dispositions") or {}

    deadlock = any(str(c.get("resolution") or "").upper() == "DEADLOCK" for c in conflicts)
    hard_block = any(
        str(d.get("disposition") or "").upper() == "BLOCK"
        for d in dispositions.values() if isinstance(d, dict)
    )
    low_conf = isinstance(conf, (int, float)) and conf < CONFIDENCE_THRESHOLD

    if deadlock or hard_block or low_conf or action in ("REJECT", "") or action not in (
        "ACCEPT", "PARTIAL_FULFILL", "DEFER"
    ):
        return {"decision_type": "ESCALATION", "sap_transaction_target": None, "change_type": None}

    if action == "PARTIAL_FULFILL":
        return {"decision_type": "ORDER_ADJUSTMENT", "sap_transaction_target": "VA02",
                "change_type": "QUANTITY_CHANGE"}
    if action == "DEFER":
        return {"decision_type": "ORDER_ADJUSTMENT", "sap_transaction_target": "VA02",
                "change_type": "DATE_CHANGE"}
    # ACCEPT (full)
    return {"decision_type": "ORDER_ADJUSTMENT", "sap_transaction_target": "VA02",
            "change_type": "QUANTITY_CHANGE"}


def resolve_classification(reason: dict) -> dict:
    """Prefer the agent-emitted `sap_classification` (stored in decision_reason);
    fall back to classify(). Always returns a complete, validated dict."""
    reason = reason or {}
    stored = reason.get("sap_classification") or reason.get("sap_action") or {}
    dt = stored.get("decision_type")
    if dt in _VALID_DECISION_TYPES:
        tc = stored.get("sap_transaction_target")
        return {
            "decision_type": dt,
            "sap_transaction_target": tc if tc in _VALID_TCODES else None,
            "change_type": stored.get("change_type"),
        }
    return classify(reason)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def execution_mode_for(user_decision: Any) -> str:
    """APPROVED -> AUTO (cleared to execute); else HUMAN_REVIEW (Section-7 rule)."""
    return "AUTO" if str(user_decision or "").lower() == "approved" else "HUMAN_REVIEW"


# ---------------------------------------------------------------------------
# Transaction builders (Section 7.2 - 7.5)
# ---------------------------------------------------------------------------
def _m(master: dict, key: str, placeholders: list) -> str:
    """master[key] if present, else the flagged _DEFAULTS placeholder."""
    val = (master or {}).get(key)
    if val:
        return str(val)
    placeholders.append(key)
    return _DEFAULTS.get(key, "")


def _va02(decision: dict, master: dict, placeholders: list) -> dict:
    mat = pad_material(decision.get("material_number"))
    ordered = _num(decision.get("ordered"))
    allocated = _num(decision.get("allocated"))
    shortfall = _num(decision.get("shortfall"))
    rdd = master.get("requested_delivery_date") or decision.get("requested_delivery_date")
    primary_plant = _m(master, "plant", placeholders)
    storage = _m(master, "storage_location", placeholders)
    change_type = decision.get("change_type") or "QUANTITY_CHANGE"

    # ACCEPT (full) confirms the ordered qty; PARTIAL/DEFER adjust to allocated.
    line_qty = ordered if (decision.get("decision_type") == "ORDER_ADJUSTMENT"
                           and str(decision.get("agent_recommendation", "")).upper() == "ACCEPT"
                           and not shortfall) else (allocated or ordered)

    lines = [{
        "item_number": pad_item(10),
        "material_number": mat,
        "order_quantity": line_qty,
        "order_quantity_uom": master.get("sales_uom") or "CS",
        "delivering_plant": primary_plant,
        "storage_location": storage,
        "requested_delivery_date": rdd,
        "change_type": change_type,
    }]
    # PARTIAL split: source the shortfall from a second plant on item 000020.
    if shortfall and master.get("split_plant"):
        lines.append({
            "item_number": pad_item(20),
            "material_number": mat,
            "order_quantity": shortfall,
            "order_quantity_uom": master.get("sales_uom") or "CS",
            "delivering_plant": str(master.get("split_plant")),
            "storage_location": storage,
            "requested_delivery_date": rdd,
            "change_type": "PLANT_CHANGE",
        })
    so = pad_so(decision.get("sales_order_number"))
    if not so:
        placeholders.append("sales_order_number")  # decision carried no SO to target
    return {
        "transaction_code": "VA02",
        "document_type": "SALES_ORDER",
        "action": "CHANGE",
        "header": {
            "sales_order_number": so,
            "sales_org": _m(master, "sales_org", placeholders),
            "distribution_channel": _m(master, "distribution_channel", placeholders),
            "division": _m(master, "division", placeholders),
            "change_reason": decision.get("rationale") or "Agentic order adjustment.",
        },
        "line_items": lines,
    }


def _vl02n(decision: dict, master: dict, placeholders: list) -> dict:
    dlv = master.get("delivery_number") or derive_delivery_number(decision.get("sales_order_number"))
    if not master.get("delivery_number"):
        placeholders.append("delivery_number")
    qty = _num(decision.get("allocated")) or _num(decision.get("ordered"))
    return {
        "transaction_code": "VL02N",
        "document_type": "OUTBOUND_DELIVERY",
        "action": "CHANGE",
        "header": {
            "delivery_number": pad_delivery(dlv),
            "shipping_point": _m(master, "shipping_point", placeholders),
            "change_reason": decision.get("rationale") or "Expedite — protect MABD / OTIF.",
        },
        "line_items": [{
            "item_number": pad_item(10),
            "material_number": pad_material(decision.get("material_number")),
            "delivery_quantity": qty,
            "delivery_quantity_uom": master.get("sales_uom") or "CS",
            "batch_number": None,
            "change_type": "EXPEDITE_FLAG",
        }],
        "flags": {
            "expedite": True,
            "escalation_note": "Escalate to Transportation Manager if the carrier cutoff is missed.",
        },
    }


def _me21n_migo(decision: dict, master: dict, placeholders: list) -> list:
    """STO (ME21N, po_type UB) + goods issue (MIGO, movement 641)."""
    mat = pad_material(decision.get("material_number"))
    qty = _num(decision.get("shortfall")) or _num(decision.get("ordered")) or _num(decision.get("allocated"))
    supplying = str(master.get("split_plant") or _m(master, "supplying_plant", placeholders))
    receiving = str(master.get("plant") or _m(master, "receiving_plant", placeholders))
    storage = _m(master, "storage_location", placeholders)
    rdd = master.get("requested_delivery_date") or decision.get("requested_delivery_date")
    today = datetime.now(timezone.utc).date().isoformat()

    me21n = {
        "transaction_code": "ME21N",
        "document_type": "STOCK_TRANSPORT_ORDER",
        "action": "CREATE",
        "header": {
            "po_type": "UB",
            "supplying_plant": supplying,
            "purchasing_org": _m(master, "purchasing_org", placeholders),
            "purchasing_group": _m(master, "purchasing_group", placeholders),
            "document_date": today,
            "header_text": decision.get("rationale") or f"Intercompany STO {supplying}->{receiving}.",
        },
        "line_items": [{
            "line_number": pad_item(10),
            "material_number": mat,
            "quantity": qty,
            "unit_of_measure": master.get("sales_uom") or "CS",
            "delivery_date": rdd,
            "receiving_plant": receiving,
            "storage_location": storage,
            "item_text": "Network rebalance per CFR agent recommendation.",
        }],
    }
    migo = {
        "transaction_code": "MIGO",
        "document_type": "GOODS_MOVEMENT",
        "action": "CREATE",
        "header": {
            "movement_type": "641",
            "posting_date": today,
            "document_date": today,
            "reference_document": "STO::ME21N#000010 (formatter substitutes the real PO number post-create)",
            "header_text": f"GI against STO {supplying}->{receiving} for {mat}.",
        },
        "line_items": [{
            "line_number": pad_item(10),
            "material_number": mat,
            "quantity": qty,
            "unit_of_measure": master.get("sales_uom") or "CS",
            "plant_from": supplying,
            "storage_location_from": storage,
            "plant_to": receiving,
            "storage_location_to": storage,
            "batch_number": None,
            "special_stock_indicator": None,
        }],
    }
    return [me21n, migo]


# ---------------------------------------------------------------------------
# Fulfillment-plan path — a split-sourcing plan committed at the fulfillment
# center → a MULTI-transaction envelope (N-line VA02 + ME21N/MIGO per transfer
# line + VL02N when expedited). See FULFILLMENT_ORDER_CHANGE_SAP_ARCHITECTURE.
# ---------------------------------------------------------------------------
def _transfer_pair(mat: str, qty: Any, supplying: str, receiving: str,
                   storage: str, rdd: Any, uom: str, placeholders: list) -> list:
    """ME21N STO (UB) + MIGO 641 to replenish `receiving` from `supplying`."""
    today = datetime.now(timezone.utc).date().isoformat()
    pur_org = _DEFAULTS["purchasing_org"]; pur_grp = _DEFAULTS["purchasing_group"]
    placeholders.extend(["purchasing_org", "purchasing_group"])
    return [
        {"transaction_code": "ME21N", "document_type": "STOCK_TRANSPORT_ORDER", "action": "CREATE",
         "header": {"po_type": "UB", "supplying_plant": supplying, "purchasing_org": pur_org,
                    "purchasing_group": pur_grp, "document_date": today,
                    "header_text": f"STO {supplying}->{receiving} to cover {qty} cs split line"},
         "line_items": [{"line_number": pad_item(10), "material_number": mat, "quantity": _num(qty),
                         "unit_of_measure": uom, "delivery_date": rdd, "receiving_plant": receiving,
                         "storage_location": storage, "item_text": "Replenish for fulfillment split per CFR plan."}]},
        {"transaction_code": "MIGO", "document_type": "GOODS_MOVEMENT", "action": "CREATE",
         "header": {"movement_type": "641", "posting_date": today, "document_date": today,
                    "reference_document": "STO::ME21N#000010 (formatter substitutes the real PO number post-create)",
                    "header_text": f"GI against STO {supplying}->{receiving} for {mat}."},
         "line_items": [{"line_number": pad_item(10), "material_number": mat, "quantity": _num(qty),
                         "unit_of_measure": uom, "plant_from": supplying, "storage_location_from": storage,
                         "plant_to": receiving, "storage_location_to": storage,
                         "batch_number": None, "special_stock_indicator": None}]},
    ]


def _build_from_plan(decision: dict, plan: dict, master: dict, placeholders: list) -> list:
    """Multi-transaction set from a committed fulfillment plan.
    VA02 (one line item per plan line) + ME21N/MIGO per transfer line + VL02N on expedite."""
    mat = pad_material(decision.get("material_number"))
    uom = master.get("sales_uom") or "CS"
    storage_default = _m(master, "storage_location", placeholders)
    rdd = master.get("requested_delivery_date") or decision.get("requested_delivery_date")
    original_plant = str(master.get("plant") or "").strip()
    lines = plan.get("lines") or []

    so = pad_so(decision.get("sales_order_number"))
    if not so:
        placeholders.append("sales_order_number")

    va_lines = []
    for i, ln in enumerate(lines):
        plant = str(ln.get("plant") or "")
        storage = ln.get("storage_location") or storage_default
        change_type = "QUANTITY_CHANGE" if (not original_plant or plant == original_plant) else "PLANT_CHANGE"
        va_lines.append({
            "item_number": pad_item(10 * (i + 1)),
            "material_number": mat,
            "order_quantity": _num(ln.get("qty")),
            "order_quantity_uom": uom,
            "delivering_plant": plant,
            "storage_location": storage,
            "requested_delivery_date": rdd,
            "change_type": change_type,
        })
    sid = plan.get("scenario_id") or ""
    txns = [{
        "transaction_code": "VA02", "document_type": "SALES_ORDER", "action": "CHANGE",
        "header": {"sales_order_number": so, "sales_org": _m(master, "sales_org", placeholders),
                   "distribution_channel": _m(master, "distribution_channel", placeholders),
                   "division": _m(master, "division", placeholders),
                   "change_reason": decision.get("rationale") or f"Split sourcing per fulfillment plan {sid}."},
        "line_items": va_lines,
    }]
    # Inter-DC replenishment for any line whose plant lacks on-hand stock.
    for ln in lines:
        if not ln.get("on_hand", True) and ln.get("replenish_from"):
            txns += _transfer_pair(mat, ln.get("qty"), str(ln.get("replenish_from")),
                                   str(ln.get("plant")), ln.get("storage_location") or storage_default,
                                   rdd, uom, placeholders)
    # Expedite the at-risk delivery.
    if plan.get("expedite"):
        txns.append(_vl02n(decision, master, placeholders))
    return txns


# ---------------------------------------------------------------------------
# Envelope assembly (Section 7.1)
# ---------------------------------------------------------------------------
def build_batp_payload(decision: dict, master: Optional[dict] = None) -> dict:
    """Assemble the Section-7 `batp_payload` envelope for one decision.

    `decision` must carry: source_log_id, user_decision, material_number,
    sales_order_number, ordered, allocated, shortfall, requested_delivery_date,
    rationale, agent_recommendation, plus resolved decision_type /
    sap_transaction_target / change_type. `master` carries looked-up SAP fields.
    """
    master = master or {}
    placeholders: list = []
    decision_type = decision.get("decision_type") or "ESCALATION"
    exec_mode = execution_mode_for(decision.get("user_decision"))

    envelope: dict = {
        "payload_id": str(uuid.uuid4()),
        "source_log_id": decision.get("source_log_id"),
        "generated_at": _iso_now(),
        "target_system": "SAP_ECC",
        "execution_mode": exec_mode,
        "transactions": [],
    }

    plan = decision.get("fulfillment_plan")
    if plan and (plan.get("lines")):
        # A committed fulfillment-center plan drives the transactions directly
        # (overrides the single decision_type branch below).
        envelope["transactions"] = _build_from_plan(decision, plan, master, placeholders)
        envelope["fulfillment_plan_ref"] = {
            "scenario_id": plan.get("scenario_id"),
            "plan_version": plan.get("plan_version"),
            "source": plan.get("source"),
        }
    elif decision_type == "ESCALATION":
        envelope["escalation"] = {
            "reason": decision.get("rationale") or "Escalated — no executable SAP change.",
            "escalate_to": "Supply Planning Manager queue",
            "disputants": decision.get("disputants") or [],
            "sla_hours": 4,
            "note": "Layer 2 emits NO SAP transaction until a human resolves the escalation.",
        }
    elif decision_type == "TRANSFER_RECOMMENDATION":
        envelope["transactions"] = _me21n_migo(decision, master, placeholders)
    elif decision_type == "DELIVERY_FLAG":
        envelope["transactions"] = [_vl02n(decision, master, placeholders)]
    else:  # ORDER_ADJUSTMENT
        envelope["transactions"] = [_va02(decision, master, placeholders)]

    if placeholders:
        envelope["config_placeholders"] = sorted(set(placeholders))
        envelope["config_placeholders_note"] = (
            "These SAP master/config fields were not resolved from BigQuery and use "
            "illustrative defaults — map to client config before live execution."
        )
    return {"batp_payload": envelope}
