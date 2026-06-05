/**
 * Data Dictionary — static glossary of supply-chain terminology.
 *
 * Lifted verbatim from the AI Studio reference
 * (context/mars-supply-ai-v2_02-restyled.jsx lines 1050–1141).
 *
 * Note on the project's "no mock data" rule (Phase 0.1):
 * This dataset is intentionally allowed because it is **reference content**,
 * not mock operational data. The terms here are stable supply-chain
 * definitions — they would be identical whether sourced from a backend
 * route, a CMS, or this file. Embedding them in code avoids a wholly
 * unnecessary round-trip while still respecting the rule's intent (no
 * fake KPIs, no fake orders, no fake telemetry).
 *
 * 55 terms across 7 sections.
 */

export type DictTerm = {
  /** Short form / abbreviation as displayed in the table */
  term: string;
  /** Full spelling. `null` when `term` is already the full word (e.g. "On Hand"). */
  full: string | null;
  /** Plain-English definition. */
  def: string;
  /** Screens where this term appears. Used to render the small chips on the right. */
  screens: string[];
};

export type DictSection = {
  /** Section heading (e.g. "Order & Fulfillment"). */
  section: string;
  terms: DictTerm[];
};

export const DICT_SECTIONS: DictSection[] = [
  {
    section: 'Order & Fulfillment',
    terms: [
      { term: 'MABD', full: 'Must Arrive By Date', def: 'The customer-specified date by which an order must physically arrive at the destination DC. Missing the MABD triggers OTIF penalties.', screens: ['Order Triage', 'Fulfillment Sim'] },
      { term: 'OTIF', full: 'On Time In Full', def: 'A retailer compliance metric measuring the percentage of orders delivered on time and at the correct quantity. Each retailer sets their own target (e.g. Walmart 98%, Amazon 99%, Target 95%). Failure results in chargebacks.', screens: ['Order Triage', 'Transportation', 'Watchtower'] },
      { term: 'Fill Rate', full: null, def: 'The percentage of an order quantity that is actually shipped. A fill rate of 83% means 83 cases were shipped for every 100 ordered. Directly tied to Case Fill Rate (CFR).', screens: ['Order Triage', 'Watchtower'] },
      { term: 'ATP', full: 'Available to Promise', def: 'The portion of on-hand inventory not already committed to other accepted orders. ATP = On Hand − Committed. The recommendation engine uses ATP, not total stock, to evaluate whether a new order can be fulfilled.', screens: ['Order Triage', 'Supply Planning'] },
      { term: 'Committed Inventory', full: null, def: 'Stock already allocated to previously accepted orders. This inventory is reserved and cannot be promised to new orders without risking a short-ship on the existing commitment.', screens: ['Order Triage', 'Supply Planning'] },
      { term: 'Partial Fulfillment', full: null, def: 'Shipping a portion of an ordered quantity — typically the maximum available ATP — when full supply is unavailable. Preferred over deferral when it protects OTIF on the cases shipped.', screens: ['Order Triage', 'Fulfillment Sim'] },
      { term: 'cs', full: 'Cases', def: 'The standard unit of measure used throughout the platform. One case contains a manufacturer-defined number of retail units (e.g. 24 cans, 12 bags). All quantities are expressed in cases.', screens: ['All screens'] },
      { term: 'PO', full: 'Purchase Order', def: 'A formal order placed by a retailer to a supplier specifying SKU, quantity, price, and delivery terms. Each PO generates a Sales Order (SO) in SAP.', screens: ['Order Triage', 'Decision Log'] },
      { term: 'SO', full: 'Sales Order', def: "The supplier-side record of a customer's purchase order, created in SAP. The platform evaluates SO-level decisions (accept, modify, reject).", screens: ['Order Triage', 'Decision Log', 'Fulfillment Sim'] },
    ],
  },
  {
    section: 'Inventory',
    terms: [
      { term: 'DoS', full: 'Days of Supply', def: 'How many days current on-hand inventory will last at the current demand rate. Calculated as On Hand ÷ Average Daily Demand. Below 7 days is critical; 7–14 days is a warning.', screens: ['Supply Planning', 'Order Triage'] },
      { term: 'On Hand', full: null, def: 'Total finished goods (FG) inventory physically present at a DC, as reported by the warehouse management system. Does not account for commitments — use ATP for available supply.', screens: ['Supply Planning', 'Order Triage'] },
      { term: 'Safety Stock', full: null, def: 'A minimum inventory buffer maintained at each DC to absorb demand variability and supply uncertainty. When on-hand inventory falls below safety stock, the status is flagged BELOW_SS.', screens: ['Safety Stock', 'Supply Planning'] },
      { term: 'Stockout', full: null, def: 'A condition where on-hand inventory is zero or insufficient to fulfill any orders. The most severe inventory status — triggers immediate escalation.', screens: ['Supply Planning', 'Order Triage', 'Watchtower'] },
      { term: 'BELOW_SS', full: 'Below Safety Stock', def: 'Inventory exists but has fallen below the safety stock threshold. Orders can still be partially fulfilled but the DC is in a vulnerable position for subsequent demand.', screens: ['Supply Planning', 'Order Triage'] },
      { term: 'Network Total', full: null, def: 'The sum of on-hand inventory across all DCs for a given SKU. Used to evaluate whether split-sourcing across multiple DCs can cover an order that a single DC cannot.', screens: ['Order Triage', 'Fulfillment Sim', 'Supply Planning'] },
      { term: 'After Fill', full: null, def: 'The inventory remaining at a DC after fulfilling an order. If After Fill drops below safety stock, the order puts the DC at risk for subsequent demand.', screens: ['Order Triage', 'Supply Planning'] },
    ],
  },
  {
    section: 'Demand & Forecast',
    terms: [
      { term: 'Consensus Forecast', full: null, def: 'The agreed-upon demand plan produced collaboratively by Sales, Finance, and Supply Planning — typically on a 4-week rolling basis. Orders significantly above the consensus are flagged for review.', screens: ['Demand Planning', 'Order Triage'] },
      { term: 'WMAPE', full: 'Weighted Mean Absolute Percentage Error', def: 'The primary measure of forecast accuracy. Lower is better. WMAPE < 15% is HEALTHY; 15–22% is a warning; > 22% indicates a systematic forecasting problem.', screens: ['Demand Planning', 'Order Triage'] },
      { term: 'Forecast Bias', full: null, def: 'The systematic tendency to forecast too high (positive bias) or too low (negative bias). A bias of -6% means the forecast consistently under-predicts demand by 6%, leading to preventable supply gaps.', screens: ['Demand Planning', 'Order Triage'] },
      { term: 'Above Forecast %', full: null, def: 'How much an incoming order exceeds the consensus plan, expressed as a percentage. An order 58% above forecast is flagged for demand classification before being accepted.', screens: ['Order Triage', 'Demand Planning'] },
      { term: 'GENUINE_PULL', full: null, def: 'A demand classification indicating that an order is driven by real consumer sell-through. POS data confirms consumers are buying the product off shelves at a rate consistent with the order.', screens: ['Order Triage', 'Retail Intelligence', 'Demand Planning'] },
      { term: 'BUFFER_BUILD', full: null, def: 'A demand classification where a retailer is ordering significantly above consumer sell-through, stockpiling inventory at the DC level. The key risk: the retailer will not reorder for weeks, leaving the supplier over-exposed.', screens: ['Order Triage', 'Retail Intelligence', 'Demand Planning', 'Watchtower'] },
      { term: 'PROMO_DRIVEN', full: null, def: 'An above-forecast order that is fully explained by a confirmed promotional event (e.g. a feature ad, a price reduction). These orders are expected and planned — they do not require escalation.', screens: ['Order Triage', 'Demand Planning', 'Retail Intelligence'] },
      { term: 'ONE_OFF_ANOMALY', full: null, def: 'An order spike with no identifiable driver — not a promo, not a trend, not a buffer build. Treated as a caution signal; the recommendation engine applies conservatism until a cause is identified.', screens: ['Order Triage', 'Demand Planning'] },
      { term: 'Classification Confidence', full: null, def: "The model's certainty in its demand classification (GENUINE_PULL, BUFFER_BUILD, etc.), expressed as a percentage. Below 65% is considered low confidence and reduces the weight given to that signal.", screens: ['Order Triage', 'Retail Intelligence', 'Demand Planning'] },
      { term: 'Promo Attribution', full: null, def: "A flag indicating that an order's volume is attributed to a confirmed promotional event. Promo-attributed orders bypass certain above-forecast thresholds because the spike is planned and budgeted.", screens: ['Demand Planning', 'Order Triage'] },
    ],
  },
  {
    section: 'Transportation & Logistics',
    terms: [
      { term: 'OTP', full: 'On-Time Performance', def: 'A carrier-level metric measuring the percentage of shipments that arrive on or before the scheduled delivery date. Each carrier has a contracted OTP target (typically 95%). Below-target carriers are flagged.', screens: ['Transportation', 'Order Triage'] },
      { term: 'Lane', full: null, def: 'A defined shipping route between an origin DC and a customer destination. Lanes have historical performance data (OTP, average transit time, shipment volume) used to assess delivery risk.', screens: ['Transportation', 'Fulfillment Sim'] },
      { term: 'Chargeback (CB)', full: null, def: 'A financial penalty charged by a retailer to a supplier for failing to meet compliance requirements — most commonly late delivery, incorrect quantity, or labeling errors. Chargebacks can be posted (confirmed) or disputed.', screens: ['Transportation', 'Order Triage', 'Watchtower'] },
      { term: 'OTIF Target', full: null, def: "Each retailer's minimum acceptable OTIF threshold, set contractually (dim_customer.otif_target_pct). Walmart 98%, Amazon 99%, Target & Kroger 95%, Petsmart 92%, Dollar General 90%. Performance below target triggers automatic chargeback calculations.", screens: ['Transportation', 'Order Triage'] },
      { term: 'Delta to Target', full: null, def: "The gap between actual trailing OTIF and the customer's OTIF target. A delta of -7 pp means OTIF is 7 percentage points below the threshold — a significant compliance risk.", screens: ['Transportation'] },
      { term: 'Demurrage', full: null, def: 'Charges incurred when freight containers or trailers are held beyond the agreed free-time window at a port or terminal. (Not currently surfaced — the source warehouse has no demurrage/detention feed.)', screens: [] },
      { term: 'OTIF Fines at Risk (7d)', full: null, def: 'Watchtower ribbon metric: the estimated chargeback exposure from OTIF failures in the 7 days before the latest OTIF date, computed as failed-order cases × average unit price × 2%. Sourced from fct_otif joined to sales-order value.', screens: ['Watchtower'] },
      { term: 'Split Sourcing', full: null, def: 'Fulfilling a single order by combining inventory from multiple DCs when no single DC has sufficient stock. The Transportation Agent evaluates whether the additional freight cost is less than the OTIF fine exposure.', screens: ['Fulfillment Sim', 'Order Triage'] },
    ],
  },
  {
    section: 'Retail Intelligence',
    terms: [
      { term: 'POS', full: 'Point of Sale', def: 'Consumer transaction data captured at the retail checkout. POS shows actual consumer sell-through (units leaving shelves), as opposed to orders placed by the retailer. A healthy order should be supported by strong POS.', screens: ['Retail Intelligence', 'Order Triage'] },
      { term: 'OHI', full: 'On-Hand Inventory', def: "The retailer's reported stock level at their DCs or stores. High OHI relative to norm, combined with a large inbound order, is a strong buffer-build signal.", screens: ['Retail Intelligence', 'Order Triage'] },
      { term: 'OHI vs Norm', full: null, def: "A comparison of a retailer's current OHI to their typical historical inventory level for that SKU. OHI significantly above norm indicates the retailer may already be over-stocked.", screens: ['Retail Intelligence', 'Order Triage'] },
      { term: 'ACV Distribution', full: 'All Commodity Volume Distribution', def: "The percentage of retail stores carrying a product, weighted by each store's sales volume. 82% ACV means the product is available in stores representing 82% of total category sales. Used to calibrate expected POS volume.", screens: ['Retail Intelligence'] },
      { term: 'POS Velocity', full: null, def: 'The rate of consumer purchases, typically measured in units per week. An accelerating POS velocity supports a genuine demand interpretation; flat or declining velocity alongside a large order is a buffer-build warning.', screens: ['Retail Intelligence', 'Order Triage'] },
      { term: 'Risk Score', full: null, def: 'A composite buffer-build risk score from 1 (low) to 5 (high), calculated from OHI vs norm, POS trend, order size vs forecast, and classification confidence. Score of 5 triggers an automatic BLOCK recommendation.', screens: ['Retail Intelligence', 'Watchtower'] },
      { term: 'Takeaway Trend', full: null, def: 'The direction of consumer POS velocity over the trailing 8 weeks: ACCELERATING, FLAT, or DECELERATING. A decelerating trend combined with a large order is a strong buffer-build indicator.', screens: ['Retail Intelligence'] },
    ],
  },
  {
    section: 'Financial',
    terms: [
      { term: 'Fines at Risk', full: null, def: 'The total projected chargeback and OTIF penalty exposure across all active orders in the next 7 days, assuming no corrective action is taken. Shown in the TopBar as a real-time risk signal.', screens: ['Watchtower', 'Fulfillment Sim', 'Transportation'] },
      { term: 'Revenue Preserved MTD', full: null, def: 'The cumulative revenue protected month-to-date by accepting orders that might otherwise have been deferred or rejected. Calculated as the value of cases shipped following an agent-assisted approval.', screens: ['Watchtower'] },
      { term: 'Net Impact', full: null, def: 'The total financial impact of a fulfillment scenario, combining freight cost and fine exposure. A negative net impact represents a cost. The scenario with the least negative (or zero) net impact is recommended.', screens: ['Fulfillment Sim'] },
      { term: 'Savings vs Default', full: null, def: 'How much better a fulfillment scenario is, in dollars, compared to taking no action (the default path). A saving of $33,960 means choosing this scenario avoids $33,960 in costs relative to doing nothing.', screens: ['Fulfillment Sim'] },
      { term: 'Fine per cs', full: 'Fine per Case', def: 'The per-case chargeback rate a retailer applies when delivery is late or incomplete — derived per customer from fct_chargebacks (e.g. Walmart ≈ $8/cs, Amazon ≈ $7.5/cs, Petsmart ≈ $71/cs). Used by the Transportation Agent to calculate fine exposure for partial fulfillment scenarios.', screens: ['Fulfillment Sim', 'Transportation'] },
      { term: 'CB Exposure', full: 'Chargeback Exposure', def: 'The total dollar amount of pending chargebacks for a customer — split between posted (confirmed, awaiting deduction) and disputed (under review). High exposure reduces the financial case for accepting marginal orders.', screens: ['Transportation', 'Order Triage'] },
    ],
  },
  {
    section: 'Agent & System',
    terms: [
      { term: 'CFR', full: 'Case Fill Rate', def: 'The headline supply chain performance metric: cases shipped ÷ cases ordered, expressed as a percentage. CFR of 93.0% means 93 of every 100 ordered cases were fulfilled. The platform is designed to protect and improve CFR.', screens: ['Watchtower', 'Root Cause Hub'] },
      { term: 'Agent Acceptance Rate', full: null, def: 'The percentage of AI agent recommendations that the human operator approves without modification. A high acceptance rate (>85%) indicates the agents are well-calibrated to operational reality.', screens: ['Watchtower', 'Decision Log'] },
      { term: 'Disposition', full: null, def: "Each specialist agent's verdict on an order: PROCEED (no issues found), CAUTION (a risk exists but is manageable), or BLOCK (a hard constraint makes fulfillment inadvisable). The orchestrator aggregates all four dispositions.", screens: ['Order Triage'] },
      { term: 'Hard Block', full: null, def: 'A disposition flag indicating that an agent has found a condition that makes fulfillment impossible or highly inadvisable regardless of other signals — e.g. a confirmed stockout with no alternative sourcing.', screens: ['Order Triage'] },
      { term: 'Orchestrator', full: null, def: 'The coordinating agent that aggregates signals from all four specialist agents, resolves conflicts through a structured debate process, and produces a single Green / Amber / Red status and recommendation for the human operator.', screens: ['Order Triage'] },
      { term: 'PRO', full: 'Production Order', def: 'A manufacturing order in SAP that schedules the production of a specific SKU. PRO adherence % measures how closely the actual output tracks the planned quantity and completion date.', screens: ['Supply Planning', 'Order Triage'] },
      { term: 'Plan Adherence %', full: null, def: 'The percentage of planned production output that is actually achieved. 82% adherence means only 82 cases are produced for every 100 planned — creating supply risk when orders depend on that production run completing on time.', screens: ['Supply Planning', 'Order Triage'] },
      { term: 'WMAPE Flag', full: null, def: "A qualitative label applied to a SKU's forecast quality: HEALTHY (<15% WMAPE), SYSTEMATIC_UNDER (consistent under-forecasting), SYSTEMATIC_OVER (consistent over-forecasting), or NOISY (high variance with no clear pattern).", screens: ['Demand Planning', 'Order Triage'] },
      { term: 'ATP Coverage', full: 'Available to Promise Coverage', def: 'The percentage of an order quantity that can be covered by uncommitted inventory. ATP Coverage below 100% means a full acceptance is not possible — the recommendation engine will suggest a partial fill or alternative sourcing.', screens: ['Order Triage', 'Supply Planning'] },
    ],
  },
];
