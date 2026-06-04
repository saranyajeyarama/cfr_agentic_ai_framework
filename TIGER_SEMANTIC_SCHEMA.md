# `tiger_semantic` — Data Dictionary

**Project:** `resilience-riskradar` · **Dataset:** `tiger_semantic` · **Region:** US
**Objects:** 33 (6 dimensions + 27 facts). These are the **operational Common Data Model (CDM)** — the semantic layer the agents and dashboards read. They are **views** over the SAP/Anaplan raw landing tables (so `__TABLES__.row_count` reads 0; use `COUNT(*)` or `/data-health` for live volumes).

**Conventions**
- `dim_*` = dimension (master data, one row per entity) · `fct_*` = fact (events/transactions/plans).
- Keys: `sold_to` = SAP customer (KUNNR) · `ship_to` = delivery location · `material_number` = SAP MATNR (FERT/finished good) · `material_zrep_number` / `zrep_parent_material` = ZREP planning/parent material · `plant_code` = WERKS · `*_uom` = unit of measure (CS = cases).
- Quantities are in **cases (CS)** unless the column name says otherwise. `*_flag` columns are `'Y'`/`'N'` strings.

---

## DIMENSIONS

### `dim_calendar_day` — Calendar / fiscal date spine
| Column | Type | Meaning |
|---|---|---|
| calendar_date | DATE | The day (primary key). |
| calendar_day_of_week_number | INT64 | 1–7 day index. |
| calendar_day_of_week_name | STRING | Monday…Sunday. |
| calendar_day_of_month | INT64 | 1–31. |
| calendar_day_of_year | INT64 | 1–366. |
| calendar_week_number | INT64 | ISO week number. |
| calendar_week_label | STRING | Human week label (e.g. `2026-W23`). |
| calendar_month_number | INT64 | 1–12. |
| calendar_month_name | STRING | January…December. |
| calendar_month_label | STRING | e.g. `2026-06`. |
| calendar_quarter_number | INT64 | 1–4. |
| calendar_quarter_label | STRING | e.g. `2026-Q2`. |
| calendar_year | INT64 | Calendar year. |
| fiscal_year | INT64 | Mars fiscal year. |
| fiscal_quarter_label | STRING | Fiscal quarter label. |
| is_weekend_flag | STRING | `Y` if Sat/Sun. |
| is_business_day_flag | STRING | `Y` if a working day. |

### `dim_carrier` — Transportation carriers
| Column | Type | Meaning |
|---|---|---|
| carrier_number | STRING | Carrier ID (primary key). |
| carrier_name | STRING | Carrier name (e.g. J.B. Hunt). |
| carrier_scac_code | STRING | Standard Carrier Alpha Code. |
| carrier_type | STRING | e.g. Asset / Broker / Parcel. |
| transportation_mode | STRING | TL / LTL / Parcel / Intermodal. |
| service_regions | STRING | Regions served. |
| on_time_performance_target_pct | FLOAT64 | Contracted OTP target %. |
| tender_lead_time_days | INT64 | Days needed to tender a load. |
| active_flag | STRING | `Y` if currently used. |
| carrier_dispatch_city | STRING | Dispatch origin city. |
| carrier_dispatch_state | STRING | Dispatch origin state. |

### `dim_customer` — Customer (sold-to) master + OTIF rulebook
| Column | Type | Meaning |
|---|---|---|
| customer_number | STRING | SAP KUNNR (primary key). |
| customer_name | STRING | e.g. Walmart Inc. |
| customer_type | STRING | Channel/segment type. |
| customer_city | STRING | Bill-to city. |
| customer_region_state | STRING | Region/state — used for freight-lane lookup. |
| customer_country | STRING | Country (US). |
| customer_tax_indicator | STRING | Tax classification. |
| customer_account_group | STRING | SAP account group. |
| priority_tier_level | INT64 | 1 (highest) … 5 — allocation priority. |
| priority_tier_name | STRING | Tier label (e.g. Strategic). |
| revenue_rank | INT64 | Revenue ranking. |
| otif_aggressive_flag | STRING | `Y` if the customer runs an aggressive chargeback program. |
| strategic_notes | STRING | Free-text account notes. |
| otif_target_pct | FLOAT64 | Required OTIF % (e.g. 98). |
| fill_rate_threshold_pct | FLOAT64 | Min fill rate to count "in full". |
| on_time_window_days_early | INT64 | Allowed days early. |
| on_time_window_days_late | INT64 | Allowed days late before a miss. |
| mabd_enforcement_type | STRING | How the Must-Arrive-By-Date is enforced (FIRM / soft). |
| otif_program_name | STRING | e.g. "Walmart Section 6 / Vendor Manual". |

### `dim_material` — Material (SKU) master
| Column | Type | Meaning |
|---|---|---|
| material_number | STRING | SAP MATNR / FERT (primary key). |
| material_description | STRING | Full SKU description. |
| material_type | STRING | FERT/HALB/ROH etc. |
| material_group | STRING | Material grouping. |
| base_uom | STRING | Base unit (CS/EA). |
| brand_code / brand_name | STRING | Brand. |
| technology_code / technology_name | STRING | Product technology/platform. |
| segment_code / segment_name | STRING | Market segment. |
| brand_technology | STRING | Brand+technology composite. |
| price_pack_group / price_pack_group_case | STRING | Price-pack architecture group. |
| sub_brand | STRING | Sub-brand. |
| consumer_pack_format | STRING | Consumer pack format. |
| brand_archetype | STRING | Brand archetype classification. |
| display_type | STRING | Display/PDQ type. |
| business_segment | STRING | Business segment. |
| zrep_parent_material | STRING | ZREP planning parent — **join key to forecast/DRP** (which key on ZREP, not FERT). |
| material_creation_date | DATE | When the SKU was created. |
| material_status | STRING | Active / discontinued. |

### `dim_plant` — Plants & distribution centers
| Column | Type | Meaning |
|---|---|---|
| plant_code | STRING | WERKS (primary key). |
| plant_name | STRING | Plant/DC name. |
| plant_city | STRING | City. |
| plant_region | STRING | Region. |
| plant_country | STRING | Country. |
| plant_type | STRING | `Manufacturing` (Mfg) or `Distribution` (DC). |

### `dim_vendor` — Suppliers
| Column | Type | Meaning |
|---|---|---|
| vendor_number | STRING | SAP LIFNR (primary key). |
| vendor_name | STRING | Supplier name. |
| vendor_city / vendor_region / vendor_country | STRING | Location. |
| vendor_type | STRING | Supplier classification. |

---

## FACTS — Orders, Deliveries & Fulfillment

### `fct_sales_orders` — Sales order lines (the demand signal)
| Column | Type | Meaning |
|---|---|---|
| sales_order_number / sales_order_item | STRING | Order + line key. |
| order_creation_date / order_creation_time | DATE/STRING | When created. |
| order_type | STRING | SAP order type. |
| sales_organization / distribution_channel / division | STRING | Sales-area keys. |
| sold_to / sold_to_name | STRING | Customer. |
| sold_to_priority_tier | INT64 | Denormalized priority tier (1=highest). |
| ship_to | STRING | Delivery location. |
| sales_office / sales_group | STRING | Sales org units. |
| document_currency | STRING | Currency. |
| requested_delivery_date | DATE | Customer's requested date (≈ MABD). |
| customer_po_number | STRING | Retailer PO number. |
| order_reason | STRING | Reason code. |
| order_header_total_value_usd | FLOAT64 | Order header value. |
| material_number / material_description / material_brand / material_brand_archetype / material_group | STRING | SKU attributes. |
| plant_code / plant_name | STRING | Fulfilling plant. |
| ordered_quantity_sales_uom | FLOAT64 | Quantity ordered (sales UoM). |
| sales_uom / base_uom | STRING | Units. |
| unit_price | FLOAT64 | Price per unit. |
| line_net_value_usd | FLOAT64 | Line value. |
| item_category | STRING | SAP item category. |
| rejection_reason | STRING | Set if the line was rejected (filter `IS NULL` for open orders). |

### `fct_deliveries` — Outbound delivery lines
| Column | Type | Meaning |
|---|---|---|
| delivery_number / delivery_item | STRING | Delivery + line key. |
| delivery_creation_date | DATE | Created. |
| delivery_type | STRING | SAP delivery type. |
| sales_organization / shipping_point | STRING | Org + shipping point. |
| goods_issue_date_actual | DATE | Actual goods-issue date. |
| planned_delivery_date | DATE | Planned delivery. |
| sold_to / sold_to_name / ship_to | STRING | Customer + destination. |
| delivery_status | STRING | Status. |
| material_number / material_description / material_brand | STRING | SKU. |
| plant_code / storage_location | STRING | Source. |
| delivered_quantity_sales_uom | FLOAT64 | Delivered qty. |
| base_uom / sales_uom | STRING | Units. |
| reference_sales_order_number / reference_sales_order_item | STRING | Source order link. |
| item_category | STRING | Item category. |
| fill_status | STRING | Full / partial / short. |

### `fct_otif` — On-Time-In-Full performance (the risk signal)
| Column | Type | Meaning |
|---|---|---|
| delivery_number | STRING | Delivery key. |
| sold_to / sold_to_name / sold_to_priority_tier | — | Customer + tier. |
| ship_to | STRING | Destination. |
| primary_material_number / primary_material_brand | STRING | Lead SKU on the delivery. |
| delivery_date_requested | DATE | Requested date. |
| delivery_date_promised | DATE | Promised (MABD) date. |
| ship_date_actual | DATE | Actual ship date. |
| delivery_date_actual_at_customer | DATE | Actual arrival. |
| ordered_quantity_cases / delivered_quantity_cases | FLOAT64 | Ordered vs delivered (CS). |
| fill_rate_pct | FLOAT64 | Delivered ÷ ordered. |
| days_late / days_early | INT64 | Timing variance. |
| on_time_flag / in_full_flag / otif_flag | STRING | `Y`/`N` component + combined OTIF. |
| otif_fail_reason | STRING | Why it missed. |
| shipment_number | STRING | Link to `fct_shipments`. |
| carrier_number / carrier_name / carrier_scac_code | STRING | Carrier. |
| otif_root_cause_category | STRING | Root cause bucket (e.g. CARRIER_DELAY). |
| otif_target_pct | FLOAT64 | Customer OTIF target (denormalized). |
| fill_rate_threshold_pct | FLOAT64 | In-full threshold. |

### `fct_allocation_decisions` — Allocation decisions under stockout
| Column | Type | Meaning |
|---|---|---|
| decision_id | STRING | Decision key. |
| stockout_event_id / _name / _severity / _root_cause | STRING | The constraint event driving allocation. |
| stockout_event_start_date / _end_date | DATE | Event window. |
| stockout_event_plant_code | STRING | Constrained plant. |
| sold_to / sold_to_name | STRING | Customer allocated to. |
| priority_tier_at_decision | INT64 | Tier at decision time. |
| affected_orders_count | INT64 | Orders affected. |
| ordered_quantity_cases | FLOAT64 | Requested. |
| allocated_quantity_cases | FLOAT64 | Planned allocation. |
| allocation_pct_planned | FLOAT64 | Allocation %. |
| delivered_quantity_cases | FLOAT64 | Actually delivered. |
| shortfall_quantity_cases | FLOAT64 | Unmet. |
| fill_rate_pct | FLOAT64 | Fill rate. |
| decision_date | DATE | When decided. |
| rules_applied | STRING | Allocation rules applied. |
| decision_reason | STRING | Rationale. |
| decision_approved_by | STRING | Approver. |
| decision_status | STRING | Status. |

> Note: this is the **historical SAP allocation log**. The agentic system's own decisions live in `tiger_decisions.fct_allocation_decisions` + `fct_triage_cache` + `fct_user_execution_telemetry`.

### `fct_chargebacks` — Retailer chargebacks / deductions
| Column | Type | Meaning |
|---|---|---|
| chargeback_id / chargeback_rate_id | STRING | Keys. |
| sold_to / sold_to_name | STRING | Customer. |
| source_delivery_number / source_shipment_number | STRING | What triggered it. |
| chargeback_type | STRING | OTIF_LATE / OTIF_SHORT / etc. |
| charge_basis | STRING | Basis of the charge. |
| rate_applied_pct | FLOAT64 | % rate applied. |
| invoice_value_usd | FLOAT64 | Underlying invoice value. |
| chargeback_amount_usd | FLOAT64 | Deduction amount. |
| chargeback_assessed_date | DATE | Assessed date. |
| deduction_document_reference | STRING | Deduction doc. |
| chargeback_status | STRING | Status. |
| chargeback_root_cause_category | STRING | Root cause. |
| rate_card_description / rate_card_effective_date | — | Rate card. |
| dispute_filed_date / dispute_reason / dispute_resolution_status / dispute_resolved_date | — | Dispute lifecycle. |
| recovered_amount_usd | FLOAT64 | Amount recovered on dispute. |

---

## FACTS — EDI (B2B transaction stream)

### `fct_edi_purchase_orders` — Inbound EDI 850 (customer POs)
| Column | Type | Meaning |
|---|---|---|
| isa_control_id / gs_control_id / st_control_num | STRING | EDI envelope control numbers. |
| transaction_date / transaction_time | — | Receipt timestamp. |
| edi_transaction_type | STRING | EDI doc type (850). |
| sold_to / sold_to_name | STRING | Customer. |
| customer_po_number | STRING | Retailer PO. |
| sap_sales_order_number | STRING | Resulting SAP order. |
| total_line_items | INT64 | Line count. |
| total_quantity_requested_cases | FLOAT64 | Total requested (CS). |
| total_value_usd | FLOAT64 | PO value. |
| requested_delivery_date | DATE | Requested date. |
| edi_version | STRING | EDI version. |
| trading_partner_id | STRING | Partner ID. |
| transaction_status | STRING | Processing status. |

### `fct_edi_ship_notices` — Outbound EDI 856 (ASN)
| Column | Type | Meaning |
|---|---|---|
| isa/gs/st control ids | STRING | EDI envelope. |
| transaction_date / transaction_time | — | Timestamp. |
| sold_to / sold_to_name | STRING | Customer. |
| delivery_number / asn_number / bol_number / pro_number | STRING | Delivery + ASN/BOL/PRO references. |
| carrier_scac_code | STRING | Carrier SCAC. |
| ship_date / estimated_arrival_date | DATE | Ship + ETA. |
| total_quantity_shipped_cases | FLOAT64 | Shipped (CS). |
| total_pallets / total_cartons | FLOAT64 | Pallet/carton counts. |
| edi_version | STRING | Version. |
| asn_timeliness_flag | STRING | `Y` if ASN sent on time. |
| transaction_status | STRING | Status. |

### `fct_edi_invoices` — EDI 810 (invoices)
| Column | Type | Meaning |
|---|---|---|
| isa/gs/st control ids | STRING | EDI envelope. |
| transaction_date / transaction_time | — | Timestamp. |
| sold_to / sold_to_name | STRING | Customer. |
| invoice_document_number | STRING | Invoice number. |
| source_delivery_number | STRING | Delivery invoiced. |
| invoice_amount_usd | FLOAT64 | Invoice total. |
| payment_terms | STRING | Terms. |
| total_quantity_invoiced_cases | FLOAT64 | Invoiced (CS). |
| edi_version / transaction_status | STRING | Version + status. |

### `fct_edi_application_advice` — EDI 824 (application advice / acceptance)
| Column | Type | Meaning |
|---|---|---|
| isa/gs/st control ids | STRING | EDI envelope. |
| transaction_date / transaction_time | — | Timestamp. |
| sold_to / sold_to_name | STRING | Customer. |
| original_transaction_type / original_doc_number / original_isa_control_id | STRING | The document being acknowledged. |
| status_code | STRING | Accept / reject / partial. |
| reason_code / reason_description | STRING | Why (if rejected). |
| edi_version | STRING | Version. |
| resolved_flag | STRING | `Y` if resolved. |

---

## FACTS — Demand & Forecast

### `fct_forecast` — Consensus demand forecast (Anaplan)
| Column | Type | Meaning |
|---|---|---|
| forecast_version_id / forecast_version_name | STRING | Forecast cycle (e.g. `FCST_2027_12`). |
| forecast_create_date / forecast_lock_date | DATE | Created / locked. |
| forecast_status | STRING | DRAFT / LOCKED. |
| forecast_horizon_weeks | INT64 | Horizon length. |
| planner_owner | STRING | Demand planner. |
| material_zrep_number | STRING | ZREP material (join via `dim_material.zrep_parent_material`). |
| sold_to / sold_to_name / material_brand | — | Customer + brand. |
| forecast_week_start_date | DATE | Forecast week. |
| baseline_quantity | FLOAT64 | Statistical baseline. |
| statistical_model_used | STRING | e.g. ETS-AAA. |
| consensus_quantity | FLOAT64 | **Final consensus plan qty** (the number orders are compared against). |
| sales_overlay_quantity / marketing_overlay_quantity / promo_lift_quantity | FLOAT64 | Manual overlays + promo lift. |
| overlay_reason | STRING | Why overlaid. |

### `fct_forecast_accuracy` — Forecast accuracy / bias by lag
| Column | Type | Meaning |
|---|---|---|
| forecast_version_id | STRING | Forecast cycle. |
| material_zrep_number / sold_to / sold_to_name / material_brand | — | Keys. |
| lag_weeks | INT64 | Forecast lag (weeks before actual). |
| forecast_quantity / actual_quantity | FLOAT64 | Forecast vs actual. |
| absolute_error | FLOAT64 | |forecast − actual|. |
| forecast_bias | FLOAT64 | Signed error (over/under). |
| wmape_numerator / wmape_denominator | FLOAT64 | WMAPE components. |
| wmape_pct | FLOAT64 | Weighted MAPE %. |
| forecast_bias_pct | FLOAT64 | Bias %. SYSTEMATIC_OVER/UNDER signal. |

### `fct_demand_drivers` — Retail/consumer demand signals (POS)
| Column | Type | Meaning |
|---|---|---|
| material_zrep_number / sold_to | STRING | Keys. |
| driver_week_start_date | DATE | Week. |
| pos_units_consumer_takeaway | FLOAT64 | POS units sold (consumer takeaway). |
| pos_dollars_consumer_takeaway | FLOAT64 | POS dollars. |
| distribution_pct_acv | FLOAT64 | % ACV distribution. |
| promo_active_flag | STRING | `Y` if a promo was live. |
| avg_retail_price | FLOAT64 | Average shelf price. |

### `fct_promo_plan` — Trade promotion calendar
| Column | Type | Meaning |
|---|---|---|
| promo_id / promo_name | STRING | Promotion. |
| material_zrep_number / sold_to / sold_to_name / material_brand | — | Keys. |
| promo_type | STRING | Display / TPR / feature. |
| promo_season | STRING | Season. |
| promo_start_date / promo_end_date | DATE | Window. |
| baseline_lift_pct | FLOAT64 | Expected lift %. |
| expected_incremental_quantity | FLOAT64 | Incremental cases. |
| promo_status | STRING | Planned / active / closed. |

---

## FACTS — Inventory & Distribution Planning

### `fct_inventory_movements` — Material movements (goods receipts/issues/transfers)
| Column | Type | Meaning |
|---|---|---|
| material_document_number / _year / _item | STRING | SAP material doc key. |
| document_date / posting_date | DATE | Dates. |
| document_type / transaction_code / movement_type | STRING | Movement classification (e.g. 101 receipt, 601 issue). |
| created_by_user | STRING | User. |
| material_number / material_description | STRING | SKU. |
| plant_code / storage_location | STRING | Where. |
| movement_quantity / movement_uom | — | Signed qty + unit. |
| vendor_number / customer_number | STRING | Counterparty (if any). |
| production_order_number / purchase_order_number / delivery_number | STRING | Source document links. |
| batch_number | STRING | Batch. |
| base_uom_quantity | FLOAT64 | Qty in base UoM. |

### `fct_inventory_batch_snapshot` — Batch-level on-hand + shelf life
| Column | Type | Meaning |
|---|---|---|
| material_number / plant_code / storage_location | STRING | Where. |
| batch_number | STRING | Batch. |
| snapshot_date | DATE | As-of date (quarter-end snapshots). |
| batch_unrestricted_stock | FLOAT64 | Available stock. |
| batch_quality_inspection_stock | FLOAT64 | In QA hold. |
| batch_production_date / batch_expiry_date | DATE | Make + expiry dates. |
| days_to_expiry | INT64 | Shelf life remaining — drives MRSL/FEFO checks. |

### `fct_inventory_storage_loc_snapshot` — Storage-location stock buckets
| Column | Type | Meaning |
|---|---|---|
| material_number / material_description / plant_code / storage_location | — | Where. |
| snapshot_date | DATE | As-of. |
| unrestricted_stock_quantity | FLOAT64 | Available. |
| quality_inspection_stock | FLOAT64 | QA hold. |
| restricted_use_stock | FLOAT64 | Restricted. |
| blocked_stock | FLOAT64 | Blocked. |
| returns_stock | FLOAT64 | Returns. |

### `fct_inventory_projection` — Forward inventory projection / ATP (DRP output)
| Column | Type | Meaning |
|---|---|---|
| plan_version_id | STRING | Planning version. |
| material_fert_number | STRING | FERT material. |
| plant_code / storage_location | STRING | Where. |
| projection_week_start_date | DATE | Forward week. |
| opening_inventory_cases | FLOAT64 | Opening stock. |
| production_receipts_cases / transfer_receipts_cases | FLOAT64 | Inbound supply. |
| shipments_demand_cases | FLOAT64 | Outbound demand. |
| ending_inventory_cases | FLOAT64 | Projected ending stock. |
| days_of_supply | FLOAT64 | Forward DOS — **tight DOS = supply-constraint signal**. |
| safety_stock_target_cases | FLOAT64 | Safety-stock target. |
| projection_status | STRING | OK / BELOW_SS / STOCKOUT. |

### `fct_drp_plan` — Distribution Requirements Planning (DC replenishment)
| Column | Type | Meaning |
|---|---|---|
| plan_version_id | STRING | Version. |
| material_fert_number / dc_plant_code | STRING | SKU + DC. |
| drp_week_start_date | DATE | Week. |
| drp_forecast_demand_cases | FLOAT64 | Forecast demand at the DC. |
| drp_planned_receipts_cases | FLOAT64 | Planned inbound. |
| drp_projected_on_hand_cases | FLOAT64 | Projected on-hand. |
| drp_safety_stock_target_cases | FLOAT64 | Safety-stock target. |
| drp_days_of_supply | FLOAT64 | DOS. |
| drp_fill_gap_cases | FLOAT64 | Projected fill gap. |
| drp_status | STRING | Status. |

---

## FACTS — Supply & Production

### `fct_production_orders` — Production orders (with confirmation rollups)
| Column | Type | Meaning |
|---|---|---|
| production_order_number / production_order_item | STRING | Order + item. |
| plant_code / plant_name / production_plant | STRING | Where made. |
| production_order_type / production_order_status | STRING | Type + status (`CRTD` created, `REL` released, etc.). |
| production_supervisor | STRING | Owner. |
| planned_start_date / planned_end_date | DATE | Plan window. |
| actual_start_date / actual_end_date | DATE | Actuals. |
| order_release_date | DATE | Release date. |
| routing_number | STRING | Routing. |
| planned_material_number / item_material_number / item_material_description / item_brand | — | What's produced. |
| order_planned_quantity / item_planned_quantity | FLOAT64 | Planned qty. |
| item_delivered_quantity | FLOAT64 | Delivered to stock. |
| order_quantity_uom / item_uom | STRING | Units. |
| production_storage_location | STRING | Output storage loc. |
| item_finish_date | DATE | Item finish date. |
| actual_yield_quantity_total / actual_scrap_quantity_total | FLOAT64 | Yield + scrap. |
| confirmation_event_count | INT64 | # of confirmations. |
| first_confirmation_date / last_confirmation_date | DATE | Confirmation span. |
| is_fully_confirmed_flag | STRING | `Y` if complete. |
| plan_adherence_quantity_variance / plan_adherence_pct | FLOAT64 | Planned vs actual adherence. |
| yield_pct / scrap_pct | FLOAT64 | Yield + scrap %. |

### `fct_production_confirmations` — Operation confirmations
| Column | Type | Meaning |
|---|---|---|
| confirmation_number | STRING | Confirmation key. |
| production_order_number / operation_number | STRING | Order + operation. |
| plant_code | STRING | Plant. |
| confirmation_posting_date | DATE | Posting date. |
| yield_quantity / scrap_quantity | FLOAT64 | Good + scrap output. |
| confirmation_uom | STRING | Unit. |
| final_confirmation_flag | STRING | `Y` if final. |

### `fct_production_components_consumed` — Component consumption (reservations)
| Column | Type | Meaning |
|---|---|---|
| reservation_number / reservation_item | STRING | Reservation key. |
| production_order_number | STRING | Parent order. |
| component_material_number / component_description | STRING | Component (raw/pack). |
| plant_code / storage_location | STRING | Where. |
| requirement_quantity / actual_consumed_quantity | FLOAT64 | Required vs consumed. |
| component_uom | STRING | Unit. |
| requirement_date | DATE | When needed. |
| deletion_indicator | STRING | Deleted flag. |

### `fct_bills_of_materials` — BOM (finished good → components)
| Column | Type | Meaning |
|---|---|---|
| bom_number / bom_alternative / bom_item_number | STRING | BOM keys. |
| header_material_number / header_material_description | STRING | Finished good. |
| bom_plant_code | STRING | Plant. |
| header_base_quantity / header_base_uom | — | Base qty the BOM is stated per. |
| bom_status | STRING | Status. |
| bom_valid_from_date | DATE | Validity start. |
| component_material_number / component_description | STRING | Component. |
| component_quantity / component_uom | — | Component qty per base. |
| bom_item_category | STRING | Item category. |

### `fct_plan_adherence` — Production plan adherence by week
| Column | Type | Meaning |
|---|---|---|
| material_fert_number / plant_code | STRING | SKU + plant. |
| adherence_week_start_date | DATE | Week. |
| adherence_planned_quantity_cs / adherence_actual_quantity_cs | FLOAT64 | Planned vs actual (CS). |
| adherence_variance_cases / adherence_variance_pct | FLOAT64 | Variance. |
| adherence_status | STRING | Status. |
| adherence_root_cause_category | STRING | Why off-plan. |

### `fct_capacity_plan` — Line capacity plan
| Column | Type | Meaning |
|---|---|---|
| plan_version_id / plan_name | STRING | Capacity plan version. |
| plan_create_date / plan_release_date | DATE | Dates. |
| plan_status | STRING | Status. |
| plan_horizon_weeks | INT64 | Horizon. |
| planner_owner | STRING | Owner. |
| anaplan_input_version | STRING | Source Anaplan version. |
| plant_code / plant_name | STRING | Plant. |
| line_id / line_name / line_technology | STRING | Production line. |
| line_capacity_hours_per_week | INT64 | Capacity hours. |
| line_efficiency_factor | FLOAT64 | Efficiency. |
| line_output_rate_cases_per_hour | INT64 | Output rate. |
| line_primary_brands | STRING | Brands on the line. |
| capacity_week_start_date | DATE | Week. |
| available_hours / required_hours | FLOAT64 | Available vs required. |
| capacity_utilization_pct | FLOAT64 | Utilization %. |
| capacity_status | STRING | OK / over / under. |

### `fct_mps_plan` — Master Production Schedule
| Column | Type | Meaning |
|---|---|---|
| plan_version_id | STRING | Version. |
| material_fert_number / plant_code / line_id | STRING | SKU + plant + line. |
| mps_week_start_date | DATE | Week. |
| mps_planned_quantity_cases / mps_firmed_quantity_cases | FLOAT64 | Planned vs firmed. |
| mps_planned_hours | FLOAT64 | Planned hours. |
| mps_forecast_demand_cases | FLOAT64 | Demand. |
| mps_safety_stock_target_cases | FLOAT64 | Safety stock. |
| mps_status | STRING | Status. |
| mps_plan_reason_code | STRING | Reason. |

### `fct_mrp_plan` — Material Requirements Planning (components)
| Column | Type | Meaning |
|---|---|---|
| plan_version_id | STRING | Version. |
| component_material_number / plant_code | STRING | Component + plant. |
| mrp_week_start_date | DATE | Week. |
| mrp_gross_requirements | FLOAT64 | Gross need. |
| mrp_scheduled_receipts | FLOAT64 | Inbound. |
| mrp_projected_on_hand | FLOAT64 | Projected on-hand. |
| mrp_net_requirements | FLOAT64 | Net need. |
| mrp_planned_po_quantity | FLOAT64 | Planned PO qty. |
| mrp_requirement_uom | STRING | Unit. |
| mrp_status | STRING | Status. |

---

## FACTS — Procurement & Logistics

### `fct_purchase_orders` — Purchase orders to vendors
| Column | Type | Meaning |
|---|---|---|
| purchase_order_number / purchase_order_item | STRING | PO + line. |
| company_code | STRING | Company code. |
| po_document_type / po_category | STRING | PO type. |
| po_creation_date / po_document_date | DATE | Dates. |
| created_by_user | STRING | Buyer. |
| vendor_number / vendor_name | STRING | Supplier. |
| purchasing_organization / purchasing_group | STRING | Purchasing org units. |
| document_currency | STRING | Currency. |
| material_number | STRING | Material bought. |
| plant_code / storage_location | STRING | Destination. |
| po_quantity / po_uom | — | Ordered qty. |
| unit_price / po_line_net_value / price_unit_uom | — | Pricing. |
| delivery_complete_flag | STRING | `Y` if fully received. |
| deletion_indicator | STRING | Deleted flag. |
| scheduled_delivery_date / statistical_delivery_date | DATE | Expected receipt dates. |
| scheduled_total_quantity / received_total_quantity | FLOAT64 | Scheduled vs received. |

### `fct_shipments` — Transportation shipments (lanes, transit, carriers)
| Column | Type | Meaning |
|---|---|---|
| shipment_number | STRING | Shipment key. |
| shipment_creation_date / shipment_last_changed_date | DATE | Dates. |
| transportation_mode | STRING | TL/LTL/etc. |
| carrier_number / carrier_name / carrier_scac_code | STRING | Carrier. |
| shipment_route | STRING | Route. |
| service_level | STRING | Service level. |
| planned_departure_date / actual_departure_date | DATE | Departure plan vs actual. |
| planned_arrival_date / actual_arrival_date | DATE | Arrival plan vs actual. |
| shipment_status | STRING | Status. |
| origin_plant | STRING | Origin plant — **lane key**. |
| destination_region | STRING | Destination region (Southeast, Mid-Atlantic, Central, Pacific, …) — **lane key**. |
| total_deliveries_on_shipment | INT64 | Deliveries consolidated. |
| total_shipment_value_usd | FLOAT64 | Value. |
| loading_duration_hours / transit_duration_hours / unloading_duration_hours | FLOAT64 | Time legs — `transit_duration_hours` drives the simulator's transit estimates. |

---

## How the agents/screens use these (quick map)

| Surface | Primary `tiger_semantic` views |
|---|---|
| **Order Triage** queue (`/v23/orders`) | `fct_sales_orders` × `dim_material` × `fct_forecast` × `fct_inventory_projection` |
| **Supply Planning** agent | `fct_inventory_projection`, `fct_inventory_batch_snapshot`, `fct_production_orders`, `fct_bills_of_materials`, `fct_purchase_orders` |
| **Demand Planning** agent | `fct_forecast`, `fct_forecast_accuracy`, `fct_sales_orders` |
| **Transportation** agent | `fct_otif`, `fct_chargebacks`, `fct_shipments`, `dim_carrier` |
| **Retail Intelligence** agent | `fct_demand_drivers`, `fct_promo_plan`, `fct_sales_orders` |
| **Fulfillment Simulator** | inventory (ATP) + `dim_plant` + `fct_shipments` + `dim_carrier` + `dim_customer` (penalty/region) |
| **Watchtower / Root Cause / Safety Stock** dashboards | `fct_otif`, `fct_chargebacks`, `fct_sales_orders`, `fct_forecast`, `fct_inventory_*` |

> **Decision outputs are written elsewhere** — `tiger_decisions.fct_allocation_decisions` (DCE), `fct_triage_cache` (cached agent synthesis), `fct_user_execution_telemetry` (human overrides). `tiger_semantic` is read-only operational data.
