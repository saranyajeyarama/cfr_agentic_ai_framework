-- ============================================================================
-- Tiger Foods Customer Supply Agentic AI — Decision Capture Engine table
-- v2.01 — STANDALONE
-- ============================================================================
-- The writable decision log the agent system owns. Mirrors the column set of
-- the read-side tiger_semantic.fct_allocation_decisions so the two can be
-- UNION-ed by get_allocation_history(). Lives in its own dataset so agent
-- writes never touch the curated semantic layer.
--
-- Project:  resilience-riskradar
-- Dataset:  tiger_decisions
-- Table:    fct_allocation_decisions
--
-- DESIGN — Option A (confirmed): the agent writes ONLY these real columns.
-- Agent-specific fields (agent_recommendation, agent_confidence_score,
-- user_decision, decision_aligned_with_agent, cdm_domains_referenced,
-- conflicts, specialist dispositions, session_id, model versions) are packed
-- as a JSON object into the native decision_reason STRING column by
-- agent_tools.dce_write().
--
-- FUTURE: if the data team wants those agent fields as first-class columns,
-- it is a clean additive ALTER TABLE plus a one-line change in dce_write().
-- The JSON-in-decision_reason approach does not block that path. A sketch of
-- the additive columns is at the bottom of this file, commented out.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS `resilience-riskradar.tiger_decisions`
  OPTIONS (location = 'us-central1');


CREATE TABLE IF NOT EXISTS
  `resilience-riskradar.tiger_decisions.fct_allocation_decisions` (

  -- ----- Identity -----
  decision_id               STRING  NOT NULL
    OPTIONS (description = 'UUID for this agentic decision. PK.'),
  stockout_event_id         STRING
    OPTIONS (description = 'Linked stockout event. NULL for agent-originated rows.'),

  -- ----- Customer -----
  sold_to                   STRING
    OPTIONS (description = 'SAP sold-to customer number.'),
  priority_tier_at_decision INT64
    OPTIONS (description = 'Customer priority tier snapshot at decision time.'),
  affected_orders_count     INT64
    OPTIONS (description = 'Number of sales orders affected (1 for a single-order trigger).'),

  -- ----- Quantities -----
  ordered_quantity_cases    FLOAT64
    OPTIONS (description = 'Cases ordered.'),
  allocated_quantity_cases  FLOAT64
    OPTIONS (description = 'Cases the recommendation plans to fulfill.'),
  allocation_pct_planned    FLOAT64
    OPTIONS (description = 'Percent of order planned to fulfill.'),
  delivered_quantity_cases  FLOAT64
    OPTIONS (description = 'Cases actually delivered. NULL until the delivery posts; populated retrospectively.'),
  shortfall_quantity_cases  FLOAT64
    OPTIONS (description = 'ordered - allocated.'),
  fill_rate_pct             FLOAT64
    OPTIONS (description = 'Planned fill rate percent.'),

  -- ----- Decision metadata -----
  decision_date             DATE
    OPTIONS (description = 'Date the decision was captured.'),
  rules_applied             STRING
    OPTIONS (description = 'Semicolon-separated conflict-rule outcomes (e.g. HARD_BLOCK:RESOLVED).'),
  decision_reason           STRING
    OPTIONS (description = 'JSON object (Option A): rationale + agent recommendation, confidence, user decision, alignment, CDM domains, conflicts, specialist dispositions, session_id, model versions. Keyed _dce_schema=agent_v2_01.'),
  decision_approved_by      STRING
    OPTIONS (description = 'User who approved/rejected the recommendation.'),
  decision_status           STRING
    OPTIONS (description = 'EXECUTED (approved) or PLANNED (rejected/pending).')
)
OPTIONS (
  description = 'Tiger Foods agentic decision log (v2.01). Writable by the orchestrator after human approval. Column-compatible with tiger_semantic.fct_allocation_decisions for UNION reads.',
  labels = [('layer', 'decisions'), ('owner', 'agentic_ai'), ('version', 'v2_01')]
);


-- ============================================================================
-- Verification
-- ============================================================================
-- SELECT decision_status, COUNT(*) AS n,
--        AVG(fill_rate_pct) AS avg_fill_rate
-- FROM `resilience-riskradar.tiger_decisions.fct_allocation_decisions`
-- GROUP BY decision_status;

-- Inspect the JSON payload of the most recent decisions:
-- SELECT decision_id, decision_date, decision_status,
--        JSON_VALUE(decision_reason, '$.agent_recommendation') AS agent_rec,
--        JSON_VALUE(decision_reason, '$.user_decision')        AS user_dec,
--        JSON_VALUE(decision_reason, '$._dce_schema')          AS dce_schema
-- FROM `resilience-riskradar.tiger_decisions.fct_allocation_decisions`
-- ORDER BY decision_date DESC
-- LIMIT 20;


-- ============================================================================
-- FUTURE (optional) — promote agent fields to first-class columns
-- ============================================================================
-- If the data team decides the agent metadata should be queryable without
-- JSON extraction, this is the clean additive path. Uncomment, run, and
-- change dce_write() to populate these instead of (or alongside) the JSON.
--
-- ALTER TABLE `resilience-riskradar.tiger_decisions.fct_allocation_decisions`
--   ADD COLUMN IF NOT EXISTS agent_recommendation        STRING,
--   ADD COLUMN IF NOT EXISTS agent_confidence_score      FLOAT64,
--   ADD COLUMN IF NOT EXISTS user_decision               STRING,
--   ADD COLUMN IF NOT EXISTS decision_aligned_with_agent BOOL,
--   ADD COLUMN IF NOT EXISTS cdm_domains_referenced      ARRAY<STRING>,
--   ADD COLUMN IF NOT EXISTS session_id                  STRING,
--   ADD COLUMN IF NOT EXISTS orchestrator_version        STRING;
