# data-model.md — Standard Silver-Layer Contract

> **Generated** by `tools/gen_data_model.py` from the live schema (`fetch_data_dictionary()` → BigQuery INFORMATION_SCHEMA + curated SAP lineage + glossary). Do not hand-edit — re-run the generator.
> Generated at: 2026-06-25

## 1. Contract & binding rule

This is the platform-agnostic **Silver-layer contract**. Any deployment must expose these **view names** and **column names** (or a documented superset) so the app reads them unchanged. The app references only `{SEMANTIC_DS}.<view>.<column>`; `SEMANTIC_DS` is resolved at runtime (see `silver_target.py`), so a virtual Silver layer with identical names is consumed transparently.

**Option B (custom mapping):** the schema-mapping agent maps a client's discovered schema onto this contract and emits virtual views named exactly as below. Ambiguous or unmapped required columns are surfaced for human approval — never invented (DEPLOY.md §5).

**Scale:** 34 views · 569 columns · 6 dimensions · 28 fact/other views.

## 2. Dimensions

| dimension | grain (key) | cols |
|---|---|---|
| `dim_calendar_day` | calendar_day_of_week_number + calendar_week_number + calendar_month_number + calendar_quarter_number | 17 |
| `dim_carrier` | carrier_number + carrier_scac_code | 11 |
| `dim_customer` | customer_number | 19 |
| `dim_material` | material_number + brand_code + technology_code + segment_code | 22 |
| `dim_plant` | plant_code | 6 |
| `dim_vendor` | vendor_number | 6 |

## 3. Fact areas (CDM domains)

- **Sales, Orders & Customer Service** — `fct_chargebacks`, `fct_deliveries`, `fct_edi_application_advice`, `fct_edi_invoices`, `fct_edi_purchase_orders`, `fct_edi_ship_notices`, `fct_otif`, `fct_production_orders`, `fct_purchase_orders`, `fct_sales_orders`
- **Inventory & Fulfilment** — `fct_inventory_batch_snapshot`, `fct_inventory_movements`, `fct_inventory_projection`, `fct_inventory_storage_loc_snapshot`
- **Supply & Production** — `fct_bills_of_materials`, `fct_production_components_consumed`, `fct_production_confirmations`
- **Forecast & Demand Planning** — `fct_demand_drivers`, `fct_forecast`, `fct_forecast_accuracy`, `fct_promo_plan`
- **Logistics & Transportation** — `fct_shipments`
- **Other fact areas** — `fct_allocation_decisions`, `fct_capacity_plan`, `fct_drp_plan`, `fct_mps_plan`, `fct_mrp_plan`, `fct_plan_adherence`

## 4. Per-view column dictionary

Classification: `key` (grain/identifier) · `measure` (numeric) · `date` · `dimension` (descriptive). Lineage: source table / field / BW InfoObject, with origin (`ddl` = from the view's own DDL, `curated` = SAP-standard fallback, `derived` = inferred).

#### `dim_calendar_day`  —  grain: calendar_day_of_week_number + calendar_week_number + calendar_month_number + calendar_quarter_number  ·  17 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `calendar_date` | DATE | date |  | Calendar date — date / time field (DATE, nullable). | d / 0CALDAY (ddl) |
| `calendar_day_of_week_number` | INT64 | key |  | Calendar day of week number — key identifier (INT64, nullable). | END / 0CALDAYOFW (ddl) |
| `calendar_day_of_week_name` | STRING | dimension |  | Calendar day of week name — descriptive attribute (STRING, nullable). | — (derived) |
| `calendar_day_of_month` | INT64 | measure |  | Calendar day of month — numeric measure (INT64, nullable). | — (derived) |
| `calendar_day_of_year` | INT64 | measure |  | Calendar day of year — numeric measure (INT64, nullable). | — (derived) |
| `calendar_week_number` | INT64 | key |  | Calendar week number — key identifier (INT64, nullable). | 0CALWEEK (ddl) |
| `calendar_week_label` | STRING | dimension |  | Calendar week label — descriptive attribute (STRING, nullable). | — (derived) |
| `calendar_month_number` | INT64 | key |  | Calendar month number — key identifier (INT64, nullable). | 0CALMONTH2 (ddl) |
| `calendar_month_name` | STRING | dimension |  | Calendar month name — descriptive attribute (STRING, nullable). | — (derived) |
| `calendar_month_label` | STRING | dimension |  | Calendar month label — descriptive attribute (STRING, nullable). | 0CALMONTH (ddl) |
| `calendar_quarter_number` | INT64 | key |  | Calendar quarter number — key identifier (INT64, nullable). | 0CALQUARTER1 (ddl) |
| `calendar_quarter_label` | STRING | dimension |  | Calendar quarter label — descriptive attribute (STRING, nullable). | 0CALQUARTER (ddl) |
| `calendar_year` | INT64 | measure |  | Calendar year — numeric measure (INT64, nullable). | 0CALYEAR (ddl) |
| `fiscal_year` | INT64 | measure |  | Fiscal year — numeric measure (INT64, nullable). | 0FISCYEAR (ddl) |
| `fiscal_quarter_label` | STRING | dimension |  | Fiscal quarter label — descriptive attribute (STRING, nullable). | 0FISCPER3 (ddl) |
| `is_weekend_flag` | STRING | dimension |  | Is weekend flag — descriptive attribute (STRING, nullable). | — (derived) |
| `is_business_day_flag` | STRING | dimension |  | Is business day flag — descriptive attribute (STRING, nullable). | — (derived) |

#### `dim_carrier`  —  grain: carrier_number + carrier_scac_code  ·  11 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `carrier_number` | STRING | key |  | Carrier number — key identifier (STRING, nullable). | LIFNR / 0VENDOR (ddl) |
| `carrier_name` | STRING | dimension |  | Carrier name — descriptive attribute (STRING, nullable). | NAME1 / ZCARR_NAME (ddl) |
| `carrier_scac_code` | STRING | key |  | Carrier scac code — key identifier (STRING, nullable). | SCAC / ZSCAC (ddl) |
| `carrier_type` | STRING | dimension |  | TL, LTL, Parcel, Intermodal | CARRIER_TYPE / ZCARR_TYP (ddl) |
| `transportation_mode` | STRING | dimension |  | Transportation mode — descriptive attribute (STRING, nullable). | MODE / ZTRANS_MODE (ddl) |
| `service_regions` | STRING | dimension |  | Service regions — descriptive attribute (STRING, nullable). | SERVICE_REGIONS (ddl) |
| `on_time_performance_target_pct` | FLOAT64 | measure |  | On time performance target percent — numeric measure (FLOAT64, nullable). | ON_TIME_PCT_TARGET / ZOTP_TGT (ddl) |
| `tender_lead_time_days` | INT64 | measure |  | Tender lead time days — numeric measure (INT64, nullable). | TENDER_LEAD_DAYS / ZTNDR_LT (ddl) |
| `active_flag` | STRING | dimension |  | Active flag — descriptive attribute (STRING, nullable). | ACTIVE / ZACTIVE (ddl) |
| `carrier_dispatch_city` | STRING | dimension |  | Carrier dispatch city — descriptive attribute (STRING, nullable). | ORT01 / 0CITY (ddl) |
| `carrier_dispatch_state` | STRING | dimension |  | Carrier dispatch state — descriptive attribute (STRING, nullable). | REGIO / 0REGION (ddl) |

#### `dim_customer`  —  grain: customer_number  ·  19 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `customer_number` | STRING | key |  | Customer number — key identifier (STRING, nullable). | KNA1 / KUNNR / 0CUSTOMER (ddl) |
| `customer_name` | STRING | dimension |  | Customer name — descriptive attribute (STRING, nullable). | KNA1 / NAME1 / 0CUST_NAME (ddl) |
| `customer_type` | STRING | dimension |  | Sold-to / Ship-to | KNA1 / KUNNR_TYPE (ddl) |
| `customer_city` | STRING | dimension |  | Customer city — descriptive attribute (STRING, nullable). | KNA1 / ORT01 / 0CITY (ddl) |
| `customer_region_state` | STRING | dimension |  | Customer region state — descriptive attribute (STRING, nullable). | KNA1 / REGIO / 0REGION (ddl) |
| `customer_country` | STRING | dimension |  | Customer country — descriptive attribute (STRING, nullable). | KNA1 / LAND1 / 0COUNTRY (ddl) |
| `customer_tax_indicator` | STRING | dimension |  | Customer tax indicator — descriptive attribute (STRING, nullable). | KNA1 / STCEG (ddl) |
| `customer_account_group` | STRING | dimension |  | Customer account group — descriptive attribute (STRING, nullable). | KNA1 / KTOKD / 0ACCT_GRP (ddl) |
| `priority_tier_level` | INT64 | measure |  | Priority tier level — numeric measure (INT64, nullable). | ZCUST_PRIORITY / TIER_LEVEL / ZCUST_TIER (ddl) |
| `priority_tier_name` | STRING | dimension |  | Priority tier name — descriptive attribute (STRING, nullable). | ZCUST_PRIORITY / TIER_NAME (ddl) |
| `revenue_rank` | INT64 | measure |  | Revenue rank — numeric measure (INT64, nullable). | ZCUST_PRIORITY / REVENUE_RANK (ddl) |
| `otif_aggressive_flag` | STRING | dimension |  | OTIF aggressive flag — descriptive attribute (STRING, nullable). | ZCUST_PRIORITY / OTIF_AGGRESSIVE / ZOTIF_AGG (ddl) |
| `strategic_notes` | STRING | dimension |  | Strategic notes — descriptive attribute (STRING, nullable). | ZCUST_PRIORITY / STRATEGIC_NOTES (ddl) |
| `otif_target_pct` | FLOAT64 | measure |  | OTIF target percent — numeric measure (FLOAT64, nullable). | ZOTIF_REQUIREMENTS / OTIF_TARGET_PCT / ZOTIF_TGT (ddl) |
| `fill_rate_threshold_pct` | FLOAT64 | measure |  | Fill rate threshold percent — numeric measure (FLOAT64, nullable). | ZOTIF_REQUIREMENTS / FILL_RATE_THRESHOLD_PCT / ZFILL_THR (ddl) |
| `on_time_window_days_early` | INT64 | measure |  | On time window days early — numeric measure (INT64, nullable). | sap_z_otif_requirements / ON_TIME_WINDOW_DAYS_EARLY / ZOT_EARLY (ddl) |
| `on_time_window_days_late` | INT64 | measure |  | On time window days late — numeric measure (INT64, nullable). | sap_z_otif_requirements / ON_TIME_WINDOW_DAYS_LATE / ZOT_LATE (ddl) |
| `mabd_enforcement_type` | STRING | dimension |  | Must-arrive-by-date enforcement type — descriptive attribute (STRING, nullable). | sap_z_otif_requirements / MABD_TYPE / ZMABD_TYPE (ddl) |
| `otif_program_name` | STRING | dimension |  | OTIF program name — descriptive attribute (STRING, nullable). | ZOTIF_REQUIREMENTS / OTIF_PROGRAM_NAME (ddl) |

#### `dim_material`  —  grain: material_number + brand_code + technology_code + segment_code  ·  22 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `material_number` | STRING | key |  | Material number — key identifier (STRING, nullable). | MARA / MATNR / 0MATERIAL (ddl) |
| `material_description` | STRING | dimension |  | Material description — descriptive attribute (STRING, nullable). | MAKT / MAKTX / 0MAT_TEXT (ddl) |
| `material_type` | STRING | dimension |  | Material type — descriptive attribute (STRING, nullable). | MTART / 0MATL_TYPE (ddl) |
| `material_group` | STRING | dimension |  | Material group — descriptive attribute (STRING, nullable). | MATKL / 0MATL_GROUP (ddl) |
| `base_uom` | STRING | dimension |  | Base unit-of-measure — descriptive attribute (STRING, nullable). | MEINS / 0BASE_UOM (ddl) |
| `brand_code` | STRING | key |  | Brand code — key identifier (STRING, nullable). | BRAND_CODE / ZBRAND_CD (ddl) |
| `brand_name` | STRING | dimension |  | Brand name — descriptive attribute (STRING, nullable). | BRAND / ZBRAND (ddl) |
| `technology_code` | STRING | key |  | Technology code — key identifier (STRING, nullable). | TECHNOLOGY_CODE / ZTECH_CD (ddl) |
| `technology_name` | STRING | dimension |  | Technology name — descriptive attribute (STRING, nullable). | TECHNOLOGY / ZTECH (ddl) |
| `segment_code` | STRING | key |  | Segment code — key identifier (STRING, nullable). | SEGMENT_CODE / ZSEG_CD (ddl) |
| `segment_name` | STRING | dimension |  | Segment name — descriptive attribute (STRING, nullable). | SEGMENT / ZSEG (ddl) |
| `brand_technology` | STRING | dimension |  | Brand technology — descriptive attribute (STRING, nullable). | BRANDTECH / ZBR_TECH (ddl) |
| `price_pack_group` | STRING | dimension |  | Price pack group — descriptive attribute (STRING, nullable). | PPG / ZPPG (ddl) |
| `price_pack_group_case` | STRING | dimension |  | Price pack group case — descriptive attribute (STRING, nullable). | PPG_CASE / ZPPG_CS (ddl) |
| `sub_brand` | STRING | dimension |  | Sub brand — descriptive attribute (STRING, nullable). | SUB_BRAND / ZSUB_BRAND (ddl) |
| `consumer_pack_format` | STRING | dimension |  | Consumer pack format — descriptive attribute (STRING, nullable). | CONSUMER_PACK_FORMAT / ZPACK_FMT (ddl) |
| `brand_archetype` | STRING | dimension |  | Brand archetype — descriptive attribute (STRING, nullable). | BRAND_ARCHETYPE / ZARCHETYPE (ddl) |
| `display_type` | STRING | dimension |  | Display type — descriptive attribute (STRING, nullable). | DISPLAY / ZDISPLAY (ddl) |
| `business_segment` | STRING | dimension |  | Business segment — descriptive attribute (STRING, nullable). | BUSINESS_SEGMENT / ZBUS_SEG (ddl) |
| `zrep_parent_material` | STRING | dimension |  | Zrep parent material — descriptive attribute (STRING, nullable). | ZREP_PARENT / ZREP_PRNT (ddl) |
| `material_creation_date` | DATE | date |  | Material creation date — date / time field (DATE, nullable). | 0CREATEDON (ddl) |
| `material_status` | STRING | dimension |  | Material status — descriptive attribute (STRING, nullable). | MSTAE / 0MSTAE (ddl) |

#### `dim_plant`  —  grain: plant_code  ·  6 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | T001W / WERKS / 0PLANT (ddl) |
| `plant_name` | STRING | dimension |  | Plant name — descriptive attribute (STRING, nullable). | T001W / NAME1 / 0PLANT_NAME (ddl) |
| `plant_city` | STRING | dimension |  | Plant city — descriptive attribute (STRING, nullable). | ORT01 / 0CITY (ddl) |
| `plant_region` | STRING | dimension |  | Plant region — descriptive attribute (STRING, nullable). | REGIO / 0REGION (ddl) |
| `plant_country` | STRING | dimension |  | Plant country — descriptive attribute (STRING, nullable). | LAND1 / 0COUNTRY (ddl) |
| `plant_type` | STRING | dimension |  | Manufacturing / Distribution Center | PLANT_TYPE / ZPLANT_TYP (ddl) |

#### `dim_vendor`  —  grain: vendor_number  ·  6 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `vendor_number` | STRING | key |  | Vendor number — key identifier (STRING, nullable). | LFA1 / LIFNR / 0VENDOR (ddl) |
| `vendor_name` | STRING | dimension |  | Vendor name — descriptive attribute (STRING, nullable). | NAME1 / 0VENDOR_NAME (ddl) |
| `vendor_city` | STRING | dimension |  | Vendor city — descriptive attribute (STRING, nullable). | ORT01 / 0CITY (ddl) |
| `vendor_region` | STRING | dimension |  | Vendor region — descriptive attribute (STRING, nullable). | REGIO / 0REGION (ddl) |
| `vendor_country` | STRING | dimension |  | Vendor country — descriptive attribute (STRING, nullable). | LAND1 / 0COUNTRY (ddl) |
| `vendor_type` | STRING | dimension |  | Vendor type — descriptive attribute (STRING, nullable). | VENDOR_TYPE / 0VENDOR_TYP (ddl) |

#### `fct_allocation_decisions`  —  grain: decision_id + stockout_event_id + stockout_event_plant_code  ·  23 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `decision_id` | STRING | key |  | Decision ID — key identifier (STRING, nullable). | sap_z_alloc_decisions / DECISION_ID / ZDEC_ID (ddl) |
| `stockout_event_id` | STRING | key |  | Stockout event ID — key identifier (STRING, nullable). | sap_z_alloc_decisions / EVENT_ID / ZEVT_ID (ddl) |
| `stockout_event_name` | STRING | dimension |  | denormalized | sap_z_stockout_events / EVENT_NAME (ddl) |
| `stockout_event_severity` | STRING | dimension |  | denormalized | sap_z_stockout_events / SEVERITY / ZSEVERITY (ddl) |
| `stockout_event_root_cause` | STRING | dimension |  | denormalized | sap_z_stockout_events / ROOT_CAUSE (ddl) |
| `stockout_event_start_date` | DATE | date |  | Stockout event start date — date / time field (DATE, nullable). | ZEVT_STR (ddl) |
| `stockout_event_end_date` | DATE | date |  | Stockout event end date — date / time field (DATE, nullable). | ZEVT_END (ddl) |
| `stockout_event_plant_code` | STRING | key |  | Stockout event plant code — key identifier (STRING, nullable). | sap_z_stockout_events / WERKS / 0PLANT (ddl) |
| `sold_to` | STRING | dimension |  | Sold to — descriptive attribute (STRING, nullable). | sap_z_alloc_decisions / KUNNR_SOLDTO / 0SOLD_TO (ddl) |
| `sold_to_name` | STRING | dimension |  | denormalized | dim_customer / customer_name / 0CUST_NAME (ddl) |
| `priority_tier_at_decision` | INT64 | measure |  | Priority tier at decision — numeric measure (INT64, nullable). | sap_z_alloc_decisions / PRIORITY_TIER / ZCUST_TIER (ddl) |
| `affected_orders_count` | INT64 | measure |  | Affected orders count — numeric measure (INT64, nullable). | sap_z_alloc_decisions / AFFECTED_ORDERS / ZAFF_ORD (ddl) |
| `ordered_quantity_cases` | FLOAT64 | measure |  | Ordered quantity cases — numeric measure (FLOAT64, nullable). | sap_z_alloc_decisions / ORDERED_QTY_CS / ZORD_QTY (ddl) |
| `allocated_quantity_cases` | FLOAT64 | measure |  | Allocated quantity cases — numeric measure (FLOAT64, nullable). | sap_z_alloc_decisions / ALLOCATED_QTY_CS / ZALL_QTY (ddl) |
| `allocation_pct_planned` | FLOAT64 | measure |  | Allocation percent planned — numeric measure (FLOAT64, nullable). | sap_z_alloc_decisions / ALLOCATION_PCT_PLANNED / ZALL_PCT (ddl) |
| `delivered_quantity_cases` | FLOAT64 | measure |  | Delivered quantity cases — numeric measure (FLOAT64, nullable). | sap_z_alloc_decisions / DELIVERED_QTY_CS / ZDEL_QTY (ddl) |
| `shortfall_quantity_cases` | FLOAT64 | measure |  | Shortfall quantity cases — numeric measure (FLOAT64, nullable). | sap_z_alloc_decisions / SHORTFALL_QTY_CS / ZSHORT_QTY (ddl) |
| `fill_rate_pct` | FLOAT64 | measure |  | Fill rate percent — numeric measure (FLOAT64, nullable). | sap_z_alloc_decisions / FILL_RATE_PCT / ZFILL_PCT (ddl) |
| `decision_date` | DATE | date |  | Decision date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `rules_applied` | STRING | dimension |  | Rules applied — descriptive attribute (STRING, nullable). | sap_z_alloc_decisions / RULE_APPLIED (ddl) |
| `decision_reason` | STRING | dimension |  | Decision reason — descriptive attribute (STRING, nullable). | sap_z_alloc_decisions / DECISION_REASON (ddl) |
| `decision_approved_by` | STRING | dimension |  | Decision approved by — descriptive attribute (STRING, nullable). | sap_z_alloc_decisions / APPROVED_BY (ddl) |
| `decision_status` | STRING | dimension |  | Decision status — descriptive attribute (STRING, nullable). | sap_z_alloc_decisions / STATUS / ZDEC_STAT (ddl) |

#### `fct_bills_of_materials`  —  grain: bom_number + bom_item_number + header_material_number + bom_plant_code  ·  15 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `bom_number` | STRING | key |  | Bom number — key identifier (STRING, nullable). | sap_stko_bom_header / STLNR / 0BOM (ddl) |
| `bom_alternative` | STRING | dimension |  | Bom alternative — descriptive attribute (STRING, nullable). | sap_stko_bom_header / STLAL / 0BOM_ALT (ddl) |
| `bom_item_number` | STRING | key |  | Bom item number — key identifier (STRING, nullable). | sap_stpo_bom_items / POSNR / 0ITM_NUMBER (ddl) |
| `header_material_number` | STRING | key |  | parent | sap_stko_bom_header / MATNR / 0MATERIAL (ddl) |
| `header_material_description` | STRING | dimension |  | denormalized | dim_material / material_description / 0MAT_TEXT (ddl) |
| `bom_plant_code` | STRING | key |  | Bom plant code — key identifier (STRING, nullable). | sap_stko_bom_header / WERKS / 0PLANT (ddl) |
| `header_base_quantity` | FLOAT64 | measure |  | Header base quantity — numeric measure (FLOAT64, nullable). | sap_stko_bom_header / BMENG / 0BMENG (ddl) |
| `header_base_uom` | STRING | dimension |  | Header base unit-of-measure — descriptive attribute (STRING, nullable). | sap_stko_bom_header / BMEIN / 0BASE_UOM (ddl) |
| `bom_status` | STRING | dimension |  | Bom status — descriptive attribute (STRING, nullable). | sap_stko_bom_header / STLST / 0BOM_STAT (ddl) |
| `bom_valid_from_date` | DATE | date |  | Bom valid from date — date / time field (DATE, nullable). | 0DATUV (ddl) |
| `component_material_number` | STRING | key |  | component | sap_stpo_bom_items / IDNRK / 0MATERIAL (ddl) |
| `component_description` | STRING | dimension |  | denormalized | dim_material / material_description / 0MAT_TEXT (ddl) |
| `component_quantity` | FLOAT64 | measure |  | Component quantity — numeric measure (FLOAT64, nullable). | sap_stpo_bom_items / MENGE / 0COMP_QTY (ddl) |
| `component_uom` | STRING | dimension |  | Component unit-of-measure — descriptive attribute (STRING, nullable). | sap_stpo_bom_items / MEINS / 0BASE_UOM (ddl) |
| `bom_item_category` | STRING | dimension |  | Bom item category — descriptive attribute (STRING, nullable). | sap_stpo_bom_items / POSTP / 0POSTP (ddl) |

#### `fct_capacity_plan`  —  grain: plan_version_id + plant_code + line_id  ·  22 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `plan_version_id` | STRING | key |  | Plan version ID — key identifier (STRING, nullable). | omp_capacity_plan / PLAN_VERSION_ID / ZPLAN_VER (ddl) |
| `plan_name` | STRING | dimension |  | Plan name — descriptive attribute (STRING, nullable). | omp_plan_versions / PLAN_NAME (ddl) |
| `plan_create_date` | DATE | date |  | Plan create date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `plan_release_date` | DATE | date |  | Plan release date — date / time field (DATE, nullable). | ZRLS_DT (ddl) |
| `plan_status` | STRING | dimension |  | Plan status — descriptive attribute (STRING, nullable). | omp_plan_versions / STATUS / ZPLAN_STAT (ddl) |
| `plan_horizon_weeks` | INT64 | measure |  | Plan horizon weeks — numeric measure (INT64, nullable). | omp_plan_versions / HORIZON_WEEKS / ZHORIZON (ddl) |
| `planner_owner` | STRING | dimension |  | Planner owner — descriptive attribute (STRING, nullable). | omp_plan_versions / PLANNER_OWNER (ddl) |
| `anaplan_input_version` | STRING | dimension |  | Anaplan input version — descriptive attribute (STRING, nullable). | omp_plan_versions / ANAPLAN_INPUT_VERSION / ZFCST_VER (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | omp_capacity_plan / WERKS / 0PLANT (ddl) |
| `plant_name` | STRING | dimension |  | denormalized | dim_plant / plant_name / 0PLANT_NAME (ddl) |
| `line_id` | STRING | key |  | Line ID — key identifier (STRING, nullable). | omp_capacity_plan / LINE_ID / ZLINE_ID (ddl) |
| `line_name` | STRING | dimension |  | Line name — descriptive attribute (STRING, nullable). | omp_capacity_plan / LINE_NAME (ddl) |
| `line_technology` | STRING | dimension |  | Line technology — descriptive attribute (STRING, nullable). | omp_production_lines / TECHNOLOGY / ZTECH (ddl) |
| `line_capacity_hours_per_week` | INT64 | measure |  | Line capacity hours per week — numeric measure (INT64, nullable). | omp_production_lines / CAPACITY_HRS_WEEK / ZCAP_HRS (ddl) |
| `line_efficiency_factor` | FLOAT64 | measure |  | Line efficiency factor — numeric measure (FLOAT64, nullable). | omp_production_lines / EFFICIENCY_FACTOR / ZEFF_FCT (ddl) |
| `line_output_rate_cases_per_hour` | INT64 | measure |  | Line output rate cases per hour — numeric measure (INT64, nullable). | omp_production_lines / OUTPUT_RATE_CASES_PER_HR / ZCS_HR (ddl) |
| `line_primary_brands` | STRING | dimension |  | Line primary brands — descriptive attribute (STRING, nullable). | omp_production_lines / PRIMARY_BRANDS (ddl) |
| `capacity_week_start_date` | DATE | date |  | Capacity week start date — date / time field (DATE, nullable). | 0CALWEEK (ddl) |
| `available_hours` | FLOAT64 | measure |  | Available hours — numeric measure (FLOAT64, nullable). | omp_capacity_plan / AVAILABLE_HOURS / ZAVAIL_HRS (ddl) |
| `required_hours` | FLOAT64 | measure |  | Required hours — numeric measure (FLOAT64, nullable). | omp_capacity_plan / REQUIRED_HOURS / ZREQ_HRS (ddl) |
| `capacity_utilization_pct` | FLOAT64 | measure |  | Capacity utilization percent — numeric measure (FLOAT64, nullable). | omp_capacity_plan / UTILIZATION_PCT / ZUTIL_PCT (ddl) |
| `capacity_status` | STRING | dimension |  | Capacity status — descriptive attribute (STRING, nullable). | omp_capacity_plan / STATUS / ZCAP_STAT (ddl) |

#### `fct_chargebacks`  —  grain: chargeback_id + chargeback_rate_id + source_delivery_number + source_shipment_number  ·  22 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `chargeback_id` | STRING | key |  | Chargeback ID — key identifier (STRING, nullable). | sap_z_cb_assessed / CB_ID / ZCB_ID (ddl) |
| `chargeback_rate_id` | STRING | key |  | Chargeback rate ID — key identifier (STRING, nullable). | sap_z_cb_assessed / RATE_ID / ZRATE_ID (ddl) |
| `sold_to` | STRING | dimension |  | Sold to — descriptive attribute (STRING, nullable). | sap_z_cb_assessed / KUNNR_SOLDTO / 0SOLD_TO (ddl) |
| `sold_to_name` | STRING | dimension |  | denormalized | dim_customer / customer_name / 0CUST_NAME (ddl) |
| `source_delivery_number` | STRING | key |  | Source delivery number — key identifier (STRING, nullable). | sap_z_cb_assessed / VBELN_DELIVERY / 0DELIV_NUMB (ddl) |
| `source_shipment_number` | STRING | key |  | Source shipment number — key identifier (STRING, nullable). | sap_z_cb_assessed / TKNUM_SHIPMENT / 0TKNUM (ddl) |
| `chargeback_type` | STRING | dimension |  | Chargeback type — descriptive attribute (STRING, nullable). | sap_z_cb_assessed / CHARGEBACK_TYPE / ZCB_TYPE (ddl) |
| `charge_basis` | STRING | dimension |  | Charge basis — descriptive attribute (STRING, nullable). | sap_z_cb_assessed / BASIS / ZCB_BASIS (ddl) |
| `rate_applied_pct` | FLOAT64 | measure |  | Rate applied percent — numeric measure (FLOAT64, nullable). | sap_z_cb_assessed / RATE_APPLIED_PCT / ZRATE_PCT (ddl) |
| `invoice_value_usd` | FLOAT64 | measure |  | Invoice value USD — numeric measure (FLOAT64, nullable). | sap_z_cb_assessed / INVOICE_VALUE_USD / ZINV_VAL (ddl) |
| `chargeback_amount_usd` | FLOAT64 | measure |  | Chargeback amount USD — numeric measure (FLOAT64, nullable). | sap_z_cb_assessed / AMOUNT_USD / ZCB_AMT (ddl) |
| `chargeback_assessed_date` | DATE | date |  | Chargeback assessed date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `deduction_document_reference` | STRING | dimension |  | Deduction document reference — descriptive attribute (STRING, nullable). | sap_z_cb_assessed / DEDUCTION_DOC_REF / ZDED_REF (ddl) |
| `chargeback_status` | STRING | dimension |  | Chargeback status — descriptive attribute (STRING, nullable). | sap_z_cb_assessed / STATUS / ZCB_STAT (ddl) |
| `chargeback_root_cause_category` | STRING | dimension |  | Chargeback root cause category — descriptive attribute (STRING, nullable). | sap_z_cb_assessed / ROOT_CAUSE_CATEGORY / ZRC_CAT (ddl) |
| `rate_card_description` | STRING | dimension |  | denormalized | sap_z_cb_rates / DESCRIPTION (ddl) |
| `rate_card_effective_date` | DATE | date |  | denormalized | ZEFF_DT (ddl) |
| `dispute_filed_date` | DATE | date |  | denormalized | ZFILE_DT (ddl) |
| `dispute_reason` | STRING | dimension |  | Dispute reason — descriptive attribute (STRING, nullable). | sap_z_cb_disputes / DISPUTE_REASON (ddl) |
| `dispute_resolution_status` | STRING | dimension |  | Dispute resolution status — descriptive attribute (STRING, nullable). | sap_z_cb_disputes / RESOLUTION_STATUS / ZRES_STAT (ddl) |
| `dispute_resolved_date` | DATE | date |  | Dispute resolved date — date / time field (DATE, nullable). | ZRES_DT (ddl) |
| `recovered_amount_usd` | FLOAT64 | measure |  | Recovered amount USD — numeric measure (FLOAT64, nullable). | sap_z_cb_disputes / RECOVERED_USD / ZREC_AMT (ddl) |

#### `fct_deliveries`  —  grain: delivery_number + material_number + plant_code + reference_sales_order_number  ·  24 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `delivery_number` | STRING | key |  | Delivery number — key identifier (STRING, nullable). | sap_likp_delivery_header / VBELN / 0DELIV_NUMB (ddl) |
| `delivery_item` | STRING | dimension |  | Delivery item — descriptive attribute (STRING, nullable). | sap_lips_delivery_items / POSNR / 0DELIV_ITEM (ddl) |
| `delivery_creation_date` | DATE | date |  | Delivery creation date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `delivery_type` | STRING | dimension |  | Delivery type — descriptive attribute (STRING, nullable). | sap_likp_delivery_header / LFART / 0DLV_DOC_TYP (ddl) |
| `sales_organization` | STRING | dimension |  | Sales organization — descriptive attribute (STRING, nullable). | sap_likp_delivery_header / VKORG / 0SALESORG (ddl) |
| `shipping_point` | STRING | dimension |  | Shipping point — descriptive attribute (STRING, nullable). | sap_likp_delivery_header / VSTEL / 0SHIP_POINT (ddl) |
| `goods_issue_date_actual` | DATE | date |  | Goods issue date actual — date / time field (DATE, nullable). | 0DLV_DATE (ddl) |
| `planned_delivery_date` | DATE | date |  | Planned delivery date — date / time field (DATE, nullable). | 0LFDAT (ddl) |
| `sold_to` | STRING | dimension |  | Sold to — descriptive attribute (STRING, nullable). | sap_likp_delivery_header / KUNAG / 0SOLD_TO (ddl) |
| `sold_to_name` | STRING | dimension |  | denormalized | dim_customer / customer_name / 0CUST_NAME (ddl) |
| `ship_to` | STRING | dimension |  | Ship to — descriptive attribute (STRING, nullable). | sap_likp_delivery_header / KUNWE / 0SHIP_TO (ddl) |
| `delivery_status` | STRING | dimension |  | Delivery status — descriptive attribute (STRING, nullable). | sap_likp_delivery_header / WBSTK / 0WBSTK (ddl) |
| `material_number` | STRING | key |  | Material number — key identifier (STRING, nullable). | sap_lips_delivery_items / MATNR / 0MATERIAL (ddl) |
| `material_description` | STRING | dimension |  | denormalized | dim_material / material_description / 0MAT_TEXT (ddl) |
| `material_brand` | STRING | dimension |  | denormalized | dim_material / brand_name / ZBRAND (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | sap_lips_delivery_items / WERKS / 0PLANT (ddl) |
| `storage_location` | STRING | dimension |  | Storage location — descriptive attribute (STRING, nullable). | sap_lips_delivery_items / LGORT / 0STOR_LOC (ddl) |
| `delivered_quantity_sales_uom` | FLOAT64 | measure |  | Delivered quantity sales unit-of-measure — numeric measure (FLOAT64, nullable). | sap_lips_delivery_items / LFIMG / 0QUANT_B (ddl) |
| `base_uom` | STRING | dimension |  | Base unit-of-measure — descriptive attribute (STRING, nullable). | sap_lips_delivery_items / MEINS / 0BASE_UOM (ddl) |
| `sales_uom` | STRING | dimension |  | Sales unit-of-measure — descriptive attribute (STRING, nullable). | sap_lips_delivery_items / VRKME / 0SALES_UNIT (ddl) |
| `reference_sales_order_number` | STRING | key |  | Reference sales order number — key identifier (STRING, nullable). | sap_lips_delivery_items / VGBEL / 0REFER_DOC (ddl) |
| `reference_sales_order_item` | STRING | dimension |  | Reference sales order item — descriptive attribute (STRING, nullable). | sap_lips_delivery_items / VGPOS / 0REFER_ITM (ddl) |
| `item_category` | STRING | dimension |  | Item category — descriptive attribute (STRING, nullable). | sap_lips_delivery_items / PSTYV / 0ITEM_CATEG (ddl) |
| `fill_status` | STRING | dimension |  | Fill status — descriptive attribute (STRING, nullable). | sap_lips_delivery_items / FILL_STATUS / ZFILL_STAT (ddl) |

#### `fct_demand_drivers`  —  grain: material_zrep_number  ·  8 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `material_zrep_number` | STRING | key |  | Material zrep number — key identifier (STRING, nullable). | anaplan_demand_drivers / MATNR_ZREP / 0MATERIAL (ddl) |
| `sold_to` | STRING | dimension |  | Sold to — descriptive attribute (STRING, nullable). | anaplan_demand_drivers / KUNNR_SOLDTO / 0SOLD_TO (ddl) |
| `driver_week_start_date` | DATE | date |  | Driver week start date — date / time field (DATE, nullable). | 0CALWEEK (ddl) |
| `pos_units_consumer_takeaway` | FLOAT64 | measure |  | Pos units consumer takeaway — numeric measure (FLOAT64, nullable). | anaplan_demand_drivers / POS_UNITS / ZPOS_UNITS (ddl) |
| `pos_dollars_consumer_takeaway` | FLOAT64 | measure |  | Pos dollars consumer takeaway — numeric measure (FLOAT64, nullable). | anaplan_demand_drivers / POS_DOLLARS / ZPOS_DLR (ddl) |
| `distribution_pct_acv` | FLOAT64 | measure |  | Distribution percent acv — numeric measure (FLOAT64, nullable). | anaplan_demand_drivers / DISTRIBUTION_PCT / ZACV (ddl) |
| `promo_active_flag` | STRING | dimension |  | Promo active flag — descriptive attribute (STRING, nullable). | anaplan_demand_drivers / PROMO_FLAG / ZPROMO_FLG (ddl) |
| `avg_retail_price` | FLOAT64 | measure |  | Average retail price — numeric measure (FLOAT64, nullable). | anaplan_demand_drivers / AVG_RETAIL_PRICE / ZARP (ddl) |

#### `fct_drp_plan`  —  grain: plan_version_id + material_fert_number + dc_plant_code  ·  11 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `plan_version_id` | STRING | key |  | Plan version ID — key identifier (STRING, nullable). | PLAN_VERSION_ID / ZPLAN_VER (ddl) |
| `material_fert_number` | STRING | key |  | Material fert number — key identifier (STRING, nullable). | MATNR_FERT / 0MATERIAL (ddl) |
| `dc_plant_code` | STRING | key |  | DC plant code — key identifier (STRING, nullable). | WERKS_DC / 0PLANT (ddl) |
| `drp_week_start_date` | DATE | date |  | Drp week start date — date / time field (DATE, nullable). | 0CALWEEK (ddl) |
| `drp_forecast_demand_cases` | FLOAT64 | measure |  | Drp forecast demand cases — numeric measure (FLOAT64, nullable). | FORECAST_DEMAND_CS / ZDRP_DEM (ddl) |
| `drp_planned_receipts_cases` | FLOAT64 | measure |  | Drp planned receipts cases — numeric measure (FLOAT64, nullable). | PLANNED_RECEIPTS_CS / ZDRP_RCP (ddl) |
| `drp_projected_on_hand_cases` | FLOAT64 | measure |  | Drp projected on hand cases — numeric measure (FLOAT64, nullable). | PROJECTED_ON_HAND_CS / ZDRP_POH (ddl) |
| `drp_safety_stock_target_cases` | FLOAT64 | measure |  | Drp safety stock target cases — numeric measure (FLOAT64, nullable). | SAFETY_STOCK_TARGET_CS / ZSS_TGT (ddl) |
| `drp_days_of_supply` | FLOAT64 | measure |  | Drp days of supply — numeric measure (FLOAT64, nullable). | DAYS_OF_SUPPLY / ZDOS (ddl) |
| `drp_fill_gap_cases` | FLOAT64 | measure |  | Drp fill gap cases — numeric measure (FLOAT64, nullable). | FILL_GAP_CS / ZFILL_GAP (ddl) |
| `drp_status` | STRING | dimension |  | Drp status — descriptive attribute (STRING, nullable). | STATUS / ZDRP_STAT (ddl) |

#### `fct_edi_application_advice`  —  grain: isa_control_id + gs_control_id + original_doc_number + original_isa_control_id  ·  15 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `isa_control_id` | STRING | key |  | Isa control ID — key identifier (STRING, nullable). | sap_z_edi_824 / ISA_CONTROL_ID / ZISA_ID (ddl) |
| `gs_control_id` | STRING | key |  | Gs control ID — key identifier (STRING, nullable). | sap_z_edi_824 / GS_CONTROL_ID / ZGS_ID (ddl) |
| `st_control_num` | STRING | dimension |  | St control number — descriptive attribute (STRING, nullable). | sap_z_edi_824 / ST_CONTROL_NUM / ZST_NUM (ddl) |
| `transaction_date` | DATE | date |  | Transaction date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `transaction_time` | STRING | dimension |  | Transaction time — descriptive attribute (STRING, nullable). | sap_z_edi_824 / TRANSACTION_TIME (ddl) |
| `sold_to` | STRING | dimension |  | Sold to — descriptive attribute (STRING, nullable). | sap_z_edi_824 / KUNNR_SOLDTO / 0SOLD_TO (ddl) |
| `sold_to_name` | STRING | dimension |  | denormalized | dim_customer / customer_name / 0CUST_NAME (ddl) |
| `original_transaction_type` | STRING | dimension |  | Original transaction type — descriptive attribute (STRING, nullable). | sap_z_edi_824 / ORIGINAL_TRANSACTION_TYPE / ZORG_TYP (ddl) |
| `original_doc_number` | STRING | key |  | Original doc number — key identifier (STRING, nullable). | sap_z_edi_824 / ORIGINAL_DOC_NUMBER / ZORG_DOC (ddl) |
| `original_isa_control_id` | STRING | key |  | Original isa control ID — key identifier (STRING, nullable). | sap_z_edi_824 / ORIGINAL_ISA_ID / ZORG_ISA (ddl) |
| `status_code` | STRING | key |  | Status code — key identifier (STRING, nullable). | sap_z_edi_824 / STATUS_CODE / ZSTAT_CD (ddl) |
| `reason_code` | STRING | key |  | Reason code — key identifier (STRING, nullable). | sap_z_edi_824 / REASON_CODE / ZRSN_CD (ddl) |
| `reason_description` | STRING | dimension |  | Reason description — descriptive attribute (STRING, nullable). | sap_z_edi_824 / REASON_DESCRIPTION (ddl) |
| `edi_version` | STRING | dimension |  | Edi version — descriptive attribute (STRING, nullable). | sap_z_edi_824 / EDI_VERSION / ZEDI_VER (ddl) |
| `resolved_flag` | STRING | dimension |  | Resolved flag — descriptive attribute (STRING, nullable). | sap_z_edi_824 / RESOLVED_FLAG / ZRESOLVED (ddl) |

#### `fct_edi_invoices`  —  grain: isa_control_id + gs_control_id + invoice_document_number + source_delivery_number  ·  14 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `isa_control_id` | STRING | key |  | Isa control ID — key identifier (STRING, nullable). | sap_z_edi_810 / ISA_CONTROL_ID / ZISA_ID (ddl) |
| `gs_control_id` | STRING | key |  | Gs control ID — key identifier (STRING, nullable). | sap_z_edi_810 / GS_CONTROL_ID / ZGS_ID (ddl) |
| `st_control_num` | STRING | dimension |  | St control number — descriptive attribute (STRING, nullable). | sap_z_edi_810 / ST_CONTROL_NUM / ZST_NUM (ddl) |
| `transaction_date` | DATE | date |  | Transaction date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `transaction_time` | STRING | dimension |  | Transaction time — descriptive attribute (STRING, nullable). | sap_z_edi_810 / TRANSACTION_TIME (ddl) |
| `sold_to` | STRING | dimension |  | Sold to — descriptive attribute (STRING, nullable). | sap_z_edi_810 / KUNNR_SOLDTO / 0SOLD_TO (ddl) |
| `sold_to_name` | STRING | dimension |  | denormalized | dim_customer / customer_name / 0CUST_NAME (ddl) |
| `invoice_document_number` | STRING | key |  | Invoice document number — key identifier (STRING, nullable). | sap_z_edi_810 / VBELN_INVOICE / 0BILL_NUM (ddl) |
| `source_delivery_number` | STRING | key |  | Source delivery number — key identifier (STRING, nullable). | sap_z_edi_810 / VBELN_LIKP / 0DELIV_NUMB (ddl) |
| `invoice_amount_usd` | FLOAT64 | measure |  | Invoice amount USD — numeric measure (FLOAT64, nullable). | sap_z_edi_810 / INVOICE_AMOUNT_USD / ZINV_AMT (ddl) |
| `payment_terms` | STRING | dimension |  | Payment terms — descriptive attribute (STRING, nullable). | sap_z_edi_810 / PAYMENT_TERMS / 0PMNTTRMS (ddl) |
| `total_quantity_invoiced_cases` | FLOAT64 | measure |  | Total quantity invoiced cases — numeric measure (FLOAT64, nullable). | sap_z_edi_810 / TOTAL_QTY_INVOICED_CS / ZINV_QTY (ddl) |
| `edi_version` | STRING | dimension |  | Edi version — descriptive attribute (STRING, nullable). | sap_z_edi_810 / EDI_VERSION / ZEDI_VER (ddl) |
| `transaction_status` | STRING | dimension |  | Transaction status — descriptive attribute (STRING, nullable). | sap_z_edi_810 / STATUS / ZEDI_STAT (ddl) |

#### `fct_edi_purchase_orders`  —  grain: isa_control_id + gs_control_id + customer_po_number + sap_sales_order_number  ·  17 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `isa_control_id` | STRING | key |  | Isa control ID — key identifier (STRING, nullable). | sap_z_edi_850 / ISA_CONTROL_ID / ZISA_ID (ddl) |
| `gs_control_id` | STRING | key |  | Gs control ID — key identifier (STRING, nullable). | sap_z_edi_850 / GS_CONTROL_ID / ZGS_ID (ddl) |
| `st_control_num` | STRING | dimension |  | St control number — descriptive attribute (STRING, nullable). | sap_z_edi_850 / ST_CONTROL_NUM / ZST_NUM (ddl) |
| `transaction_date` | DATE | date |  | Transaction date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `transaction_time` | STRING | dimension |  | Transaction time — descriptive attribute (STRING, nullable). | sap_z_edi_850 / TRANSACTION_TIME (ddl) |
| `edi_transaction_type` | STRING | dimension |  | Edi transaction type — descriptive attribute (STRING, nullable). | sap_z_edi_850 / TRANSACTION_TYPE / ZEDI_TYP (ddl) |
| `sold_to` | STRING | dimension |  | Sold to — descriptive attribute (STRING, nullable). | sap_z_edi_850 / KUNNR_SOLDTO / 0SOLD_TO (ddl) |
| `sold_to_name` | STRING | dimension |  | denormalized | dim_customer / customer_name / 0CUST_NAME (ddl) |
| `customer_po_number` | STRING | key |  | Customer purchase-order number — key identifier (STRING, nullable). | sap_z_edi_850 / CUSTOMER_PO_NUMBER / 0PO_NUMBER (ddl) |
| `sap_sales_order_number` | STRING | key |  | Sap sales order number — key identifier (STRING, nullable). | sap_z_edi_850 / VBELN_SAP / 0DOC_NUMBER (ddl) |
| `total_line_items` | INT64 | measure |  | Total line items — numeric measure (INT64, nullable). | sap_z_edi_850 / TOTAL_LINE_ITEMS / ZLINES (ddl) |
| `total_quantity_requested_cases` | FLOAT64 | measure |  | Total quantity requested cases — numeric measure (FLOAT64, nullable). | sap_z_edi_850 / TOTAL_QTY_REQUESTED_CS / ZTOT_QTY (ddl) |
| `total_value_usd` | FLOAT64 | measure |  | Total value USD — numeric measure (FLOAT64, nullable). | sap_z_edi_850 / TOTAL_VALUE_USD / ZTOT_VAL (ddl) |
| `requested_delivery_date` | DATE | date |  | Requested delivery date — date / time field (DATE, nullable). | VBAK / VDATU / 0REQ_DLV_DAT (ddl) |
| `edi_version` | STRING | dimension |  | Edi version — descriptive attribute (STRING, nullable). | sap_z_edi_850 / EDI_VERSION / ZEDI_VER (ddl) |
| `trading_partner_id` | STRING | key |  | Trading partner ID — key identifier (STRING, nullable). | sap_z_edi_850 / TRADING_PARTNER_ID / ZTP_ID (ddl) |
| `transaction_status` | STRING | dimension |  | Transaction status — descriptive attribute (STRING, nullable). | sap_z_edi_850 / STATUS / ZEDI_STAT (ddl) |

#### `fct_edi_ship_notices`  —  grain: isa_control_id + gs_control_id + delivery_number + asn_number  ·  20 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `isa_control_id` | STRING | key |  | Isa control ID — key identifier (STRING, nullable). | sap_z_edi_856 / ISA_CONTROL_ID / ZISA_ID (ddl) |
| `gs_control_id` | STRING | key |  | Gs control ID — key identifier (STRING, nullable). | sap_z_edi_856 / GS_CONTROL_ID / ZGS_ID (ddl) |
| `st_control_num` | STRING | dimension |  | St control number — descriptive attribute (STRING, nullable). | sap_z_edi_856 / ST_CONTROL_NUM / ZST_NUM (ddl) |
| `transaction_date` | DATE | date |  | Transaction date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `transaction_time` | STRING | dimension |  | Transaction time — descriptive attribute (STRING, nullable). | sap_z_edi_856 / TRANSACTION_TIME (ddl) |
| `sold_to` | STRING | dimension |  | Sold to — descriptive attribute (STRING, nullable). | sap_z_edi_856 / KUNNR_SOLDTO / 0SOLD_TO (ddl) |
| `sold_to_name` | STRING | dimension |  | denormalized | dim_customer / customer_name / 0CUST_NAME (ddl) |
| `delivery_number` | STRING | key |  | Delivery number — key identifier (STRING, nullable). | sap_z_edi_856 / VBELN_LIKP / 0DELIV_NUMB (ddl) |
| `asn_number` | STRING | key |  | Asn number — key identifier (STRING, nullable). | sap_z_edi_856 / ASN_NUMBER / ZASN_NUM (ddl) |
| `bol_number` | STRING | key |  | Bol number — key identifier (STRING, nullable). | sap_z_edi_856 / BOL_NUMBER / ZBOL_NUM (ddl) |
| `pro_number` | STRING | key |  | Pro number — key identifier (STRING, nullable). | sap_z_edi_856 / PRO_NUMBER / ZPRO_NUM (ddl) |
| `carrier_scac_code` | STRING | key |  | Carrier scac code — key identifier (STRING, nullable). | sap_z_edi_856 / SCAC / ZSCAC (ddl) |
| `ship_date` | DATE | date |  | Ship date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `estimated_arrival_date` | DATE | date |  | Estimated arrival date — date / time field (DATE, nullable). | ZETA (ddl) |
| `total_quantity_shipped_cases` | FLOAT64 | measure |  | Total quantity shipped cases — numeric measure (FLOAT64, nullable). | sap_z_edi_856 / TOTAL_QTY_SHIPPED_CS / ZSHIP_QTY (ddl) |
| `total_pallets` | FLOAT64 | measure |  | Total pallets — numeric measure (FLOAT64, nullable). | sap_z_edi_856 / TOTAL_PALLETS / ZPALLETS (ddl) |
| `total_cartons` | FLOAT64 | measure |  | Total cartons — numeric measure (FLOAT64, nullable). | sap_z_edi_856 / TOTAL_CARTONS / ZCARTONS (ddl) |
| `edi_version` | STRING | dimension |  | Edi version — descriptive attribute (STRING, nullable). | sap_z_edi_856 / EDI_VERSION / ZEDI_VER (ddl) |
| `asn_timeliness_flag` | STRING | dimension |  | Asn timeliness flag — descriptive attribute (STRING, nullable). | sap_z_edi_856 / TIMELINESS_FLAG / ZTIMELY (ddl) |
| `transaction_status` | STRING | dimension |  | Transaction status — descriptive attribute (STRING, nullable). | sap_z_edi_856 / STATUS / ZEDI_STAT (ddl) |

#### `fct_forecast`  —  grain: forecast_version_id + material_zrep_number  ·  19 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `forecast_version_id` | STRING | key |  | Forecast version ID — key identifier (STRING, nullable). | anaplan_fcst_versions / VERSION_ID / ZFCST_VER (ddl) |
| `forecast_version_name` | STRING | dimension |  | Forecast version name — descriptive attribute (STRING, nullable). | anaplan_fcst_versions / VERSION_NAME (ddl) |
| `forecast_create_date` | DATE | date |  | Forecast create date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `forecast_lock_date` | DATE | date |  | Forecast lock date — date / time field (DATE, nullable). | ZLOCK_DT (ddl) |
| `forecast_status` | STRING | dimension |  | Forecast status — descriptive attribute (STRING, nullable). | anaplan_fcst_versions / STATUS / ZFCST_STAT (ddl) |
| `forecast_horizon_weeks` | INT64 | measure |  | Forecast horizon weeks — numeric measure (INT64, nullable). | anaplan_fcst_versions / HORIZON_WEEKS / ZHORIZON (ddl) |
| `planner_owner` | STRING | dimension |  | Planner owner — descriptive attribute (STRING, nullable). | anaplan_fcst_versions / PLANNER_OWNER (ddl) |
| `material_zrep_number` | STRING | key |  | Material zrep number — key identifier (STRING, nullable). | anaplan_consensus_forecast / MATNR_ZREP / 0MATERIAL (ddl) |
| `sold_to` | STRING | dimension |  | Sold to — descriptive attribute (STRING, nullable). | anaplan_consensus_forecast / KUNNR_SOLDTO / 0SOLD_TO (ddl) |
| `sold_to_name` | STRING | dimension |  | denormalized | dim_customer / customer_name / 0CUST_NAME (ddl) |
| `material_brand` | STRING | dimension |  | denormalized | dim_material / brand_name / ZBRAND (ddl) |
| `forecast_week_start_date` | DATE | date |  | Forecast week start date — date / time field (DATE, nullable). | 0CALWEEK (ddl) |
| `baseline_quantity` | FLOAT64 | measure |  | Baseline quantity — numeric measure (FLOAT64, nullable). | anaplan_baseline_forecast / BASELINE_QTY / ZFCST_BASE (ddl) |
| `statistical_model_used` | STRING | dimension |  | Statistical model used — descriptive attribute (STRING, nullable). | anaplan_baseline_forecast / STAT_MODEL / ZSTAT_MOD (ddl) |
| `consensus_quantity` | FLOAT64 | measure |  | Consensus quantity — numeric measure (FLOAT64, nullable). | anaplan_consensus_forecast / CONSENSUS_QTY / ZFCST_CON (ddl) |
| `sales_overlay_quantity` | FLOAT64 | measure |  | Sales overlay quantity — numeric measure (FLOAT64, nullable). | anaplan_consensus_forecast / SALES_OVERLAY_QTY / ZOVR_SLS (ddl) |
| `marketing_overlay_quantity` | FLOAT64 | measure |  | Marketing overlay quantity — numeric measure (FLOAT64, nullable). | anaplan_consensus_forecast / MARKETING_OVERLAY_QTY / ZOVR_MKT (ddl) |
| `promo_lift_quantity` | FLOAT64 | measure |  | Promo lift quantity — numeric measure (FLOAT64, nullable). | anaplan_consensus_forecast / PROMO_LIFT_QTY / ZPROMO_LFT (ddl) |
| `overlay_reason` | STRING | dimension |  | Overlay reason — descriptive attribute (STRING, nullable). | anaplan_consensus_forecast / OVERLAY_REASON (ddl) |

#### `fct_forecast_accuracy`  —  grain: forecast_version_id + material_zrep_number  ·  14 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `forecast_version_id` | STRING | key |  | Forecast version ID — key identifier (STRING, nullable). | anaplan_forecast_accuracy / VERSION_ID / ZFCST_VER (ddl) |
| `material_zrep_number` | STRING | key |  | Material zrep number — key identifier (STRING, nullable). | anaplan_forecast_accuracy / MATNR_ZREP / 0MATERIAL (ddl) |
| `sold_to` | STRING | dimension |  | Sold to — descriptive attribute (STRING, nullable). | anaplan_forecast_accuracy / KUNNR_SOLDTO / 0SOLD_TO (ddl) |
| `sold_to_name` | STRING | dimension |  | denormalized | dim_customer / customer_name / 0CUST_NAME (ddl) |
| `material_brand` | STRING | dimension |  | denormalized | dim_material / brand_name / ZBRAND (ddl) |
| `lag_weeks` | INT64 | measure |  | Lag weeks — numeric measure (INT64, nullable). | anaplan_forecast_accuracy / LAG_WEEKS / ZLAG_WK (ddl) |
| `forecast_quantity` | FLOAT64 | measure |  | Forecast quantity — numeric measure (FLOAT64, nullable). | anaplan_forecast_accuracy / FORECAST_QTY / ZFCST_QTY (ddl) |
| `actual_quantity` | FLOAT64 | measure |  | Actual quantity — numeric measure (FLOAT64, nullable). | anaplan_forecast_accuracy / ACTUAL_QTY / ZACT_QTY (ddl) |
| `absolute_error` | FLOAT64 | measure |  | Absolute error — numeric measure (FLOAT64, nullable). | anaplan_forecast_accuracy / ABS_ERROR / ZABS_ERR (ddl) |
| `forecast_bias` | FLOAT64 | measure |  | Forecast bias — numeric measure (FLOAT64, nullable). | anaplan_forecast_accuracy / BIAS / ZBIAS (ddl) |
| `wmape_numerator` | FLOAT64 | measure |  | Wmape numerator — numeric measure (FLOAT64, nullable). | anaplan_forecast_accuracy / WMAPE_NUMERATOR / ZWMAPE_N (ddl) |
| `wmape_denominator` | FLOAT64 | measure |  | Wmape denominator — numeric measure (FLOAT64, nullable). | anaplan_forecast_accuracy / WMAPE_DENOMINATOR / ZWMAPE_D (ddl) |
| `wmape_pct` | FLOAT64 | measure |  | Wmape percent — numeric measure (FLOAT64, nullable). | anaplan_forecast_accuracy / WMAPE_PCT / ZWMAPE_PCT (ddl) |
| `forecast_bias_pct` | FLOAT64 | measure |  | Forecast bias percent — numeric measure (FLOAT64, nullable). | anaplan_forecast_accuracy / BIAS_PCT / ZBIAS_PCT (ddl) |

#### `fct_inventory_batch_snapshot`  —  grain: material_number + plant_code + batch_number  ·  10 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `material_number` | STRING | key |  | Material number — key identifier (STRING, nullable). | sap_mchb_batch_stock / MATNR / 0MATERIAL (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | sap_mchb_batch_stock / WERKS / 0PLANT (ddl) |
| `storage_location` | STRING | dimension |  | Storage location — descriptive attribute (STRING, nullable). | sap_mchb_batch_stock / LGORT / 0STOR_LOC (ddl) |
| `batch_number` | STRING | key |  | Batch number — key identifier (STRING, nullable). | sap_mchb_batch_stock / CHARG / 0BATCH (ddl) |
| `snapshot_date` | DATE | date |  | Snapshot date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `batch_unrestricted_stock` | FLOAT64 | measure |  | Batch unrestricted stock — numeric measure (FLOAT64, nullable). | sap_mchb_batch_stock / CLABS / 0CLABS (ddl) |
| `batch_quality_inspection_stock` | FLOAT64 | measure |  | Batch quality inspection stock — numeric measure (FLOAT64, nullable). | sap_mchb_batch_stock / CINSM / 0CINSM (ddl) |
| `batch_production_date` | DATE | date |  | Batch production date — date / time field (DATE, nullable). | ZPROD_DT (ddl) |
| `batch_expiry_date` | DATE | date |  | Batch expiry date — date / time field (DATE, nullable). | ZEXPY_DT (ddl) |
| `days_to_expiry` | INT64 | measure |  | Days to expiry — numeric measure (INT64, nullable). | sap_mchb_batch_stock / DAYS_TO_EXPIRY / ZDAYS_EXPY (ddl) |

#### `fct_inventory_movements`  —  grain: material_document_number + transaction_code + material_number + plant_code  ·  22 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `material_document_number` | STRING | key |  | Material document number — key identifier (STRING, nullable). | sap_mkpf_material_doc_header / MBLNR / 0MAT_DOC (ddl) |
| `material_document_year` | STRING | dimension |  | Material document year — descriptive attribute (STRING, nullable). | sap_mkpf_material_doc_header / MJAHR / 0MAT_DOC_YR (ddl) |
| `material_document_item` | STRING | dimension |  | Material document item — descriptive attribute (STRING, nullable). | sap_mseg_material_doc_items / ZEILE / 0MAT_DOC_ITM (ddl) |
| `document_date` | DATE | date |  | Document date — date / time field (DATE, nullable). | 0DOC_DATE (ddl) |
| `posting_date` | DATE | date |  | Posting date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `document_type` | STRING | dimension |  | Document type — descriptive attribute (STRING, nullable). | sap_mkpf_material_doc_header / BLART / 0BLART (ddl) |
| `created_by_user` | STRING | dimension |  | Created by user — descriptive attribute (STRING, nullable). | sap_mkpf_material_doc_header / USNAM / 0CREATEDBY (ddl) |
| `transaction_code` | STRING | key |  | Transaction code — key identifier (STRING, nullable). | sap_mkpf_material_doc_header / TCODE2 / 0TCODE (ddl) |
| `movement_type` | STRING | dimension |  | Movement type — descriptive attribute (STRING, nullable). | sap_mseg_material_doc_items / BWART / 0PROCESS_KEY (ddl) |
| `material_number` | STRING | key |  | Material number — key identifier (STRING, nullable). | sap_mseg_material_doc_items / MATNR / 0MATERIAL (ddl) |
| `material_description` | STRING | dimension |  | denormalized | dim_material / material_description / 0MAT_TEXT (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | sap_mseg_material_doc_items / WERKS / 0PLANT (ddl) |
| `storage_location` | STRING | dimension |  | Storage location — descriptive attribute (STRING, nullable). | sap_mseg_material_doc_items / LGORT / 0STOR_LOC (ddl) |
| `movement_quantity` | FLOAT64 | measure |  | Movement quantity — numeric measure (FLOAT64, nullable). | sap_mseg_material_doc_items / MENGE / 0QUANT_B (ddl) |
| `movement_uom` | STRING | dimension |  | Movement unit-of-measure — descriptive attribute (STRING, nullable). | sap_mseg_material_doc_items / MEINS / 0BASE_UOM (ddl) |
| `vendor_number` | STRING | key |  | Vendor number — key identifier (STRING, nullable). | sap_mseg_material_doc_items / LIFNR / 0VENDOR (ddl) |
| `customer_number` | STRING | key |  | Customer number — key identifier (STRING, nullable). | sap_mseg_material_doc_items / KUNNR / 0CUSTOMER (ddl) |
| `production_order_number` | STRING | key |  | Production order number — key identifier (STRING, nullable). | sap_mseg_material_doc_items / AUFNR / 0PROD_ORDER (ddl) |
| `purchase_order_number` | STRING | key |  | Purchase order number — key identifier (STRING, nullable). | sap_mseg_material_doc_items / EBELN / 0OI_EBELN (ddl) |
| `delivery_number` | STRING | key |  | Delivery number — key identifier (STRING, nullable). | sap_mseg_material_doc_items / VBELN_LF / 0DELIV_NUMB (ddl) |
| `batch_number` | STRING | key |  | Batch number — key identifier (STRING, nullable). | sap_mseg_material_doc_items / CHARG / 0BATCH (ddl) |
| `base_uom_quantity` | FLOAT64 | measure |  | Base unit-of-measure quantity — numeric measure (FLOAT64, nullable). | sap_mseg_material_doc_items / BPMNG / 0BPMNG (ddl) |

#### `fct_inventory_projection`  —  grain: plan_version_id + material_fert_number + plant_code  ·  13 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `plan_version_id` | STRING | key |  | Plan version ID — key identifier (STRING, nullable). | PLAN_VERSION_ID / ZPLAN_VER (ddl) |
| `material_fert_number` | STRING | key |  | Material fert number — key identifier (STRING, nullable). | MATNR_FERT / 0MATERIAL (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | T001W / WERKS / 0PLANT (ddl) |
| `storage_location` | STRING | dimension |  | Storage location — descriptive attribute (STRING, nullable). | MARD / LGORT / 0STOR_LOC (ddl) |
| `projection_week_start_date` | DATE | date |  | Projection week start date — date / time field (DATE, nullable). | 0CALWEEK (ddl) |
| `opening_inventory_cases` | FLOAT64 | measure |  | Opening inventory cases — numeric measure (FLOAT64, nullable). | OPENING_INVENTORY / ZOPEN_INV (ddl) |
| `production_receipts_cases` | FLOAT64 | measure |  | Production receipts cases — numeric measure (FLOAT64, nullable). | PRODUCTION_RECEIPTS / ZPROD_RCP (ddl) |
| `transfer_receipts_cases` | FLOAT64 | measure |  | Transfer receipts cases — numeric measure (FLOAT64, nullable). | TRANSFER_RECEIPTS / ZTRN_RCP (ddl) |
| `shipments_demand_cases` | FLOAT64 | measure |  | Shipments demand cases — numeric measure (FLOAT64, nullable). | SHIPMENTS_DEMAND / ZSHIP_DEM (ddl) |
| `ending_inventory_cases` | FLOAT64 | measure |  | Ending inventory cases — numeric measure (FLOAT64, nullable). | ENDING_INVENTORY / ZEND_INV (ddl) |
| `days_of_supply` | FLOAT64 | measure |  | Days of supply — numeric measure (FLOAT64, nullable). | DAYS_OF_SUPPLY / ZDOS (ddl) |
| `safety_stock_target_cases` | FLOAT64 | measure |  | Safety stock target cases — numeric measure (FLOAT64, nullable). | SAFETY_STOCK_TARGET / ZSS_TGT (ddl) |
| `projection_status` | STRING | dimension |  | Projection status — descriptive attribute (STRING, nullable). | STATUS / ZPROJ_STAT (ddl) |

#### `fct_inventory_storage_loc_snapshot`  —  grain: material_number + plant_code  ·  10 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `material_number` | STRING | key |  | Material number — key identifier (STRING, nullable). | sap_mard_storage_loc_stock / MATNR / 0MATERIAL (ddl) |
| `material_description` | STRING | dimension |  | denormalized | dim_material / material_description / 0MAT_TEXT (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | sap_mard_storage_loc_stock / WERKS / 0PLANT (ddl) |
| `storage_location` | STRING | dimension |  | Storage location — descriptive attribute (STRING, nullable). | sap_mard_storage_loc_stock / LGORT / 0STOR_LOC (ddl) |
| `snapshot_date` | DATE | date |  | Snapshot date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `unrestricted_stock_quantity` | FLOAT64 | measure |  | Unrestricted stock quantity — numeric measure (FLOAT64, nullable). | sap_mard_storage_loc_stock / LABST / 0LABST (ddl) |
| `quality_inspection_stock` | FLOAT64 | measure |  | Quality inspection stock — numeric measure (FLOAT64, nullable). | sap_mard_storage_loc_stock / INSME / 0INSME (ddl) |
| `restricted_use_stock` | FLOAT64 | measure |  | Restricted use stock — numeric measure (FLOAT64, nullable). | sap_mard_storage_loc_stock / EINME / 0EINME (ddl) |
| `blocked_stock` | FLOAT64 | measure |  | Blocked stock — numeric measure (FLOAT64, nullable). | sap_mard_storage_loc_stock / SPEME / 0SPEME (ddl) |
| `returns_stock` | FLOAT64 | measure |  | Returns stock — numeric measure (FLOAT64, nullable). | sap_mard_storage_loc_stock / RETME / 0RETME (ddl) |

#### `fct_mps_plan`  —  grain: plan_version_id + material_fert_number + plant_code + line_id  ·  12 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `plan_version_id` | STRING | key |  | Plan version ID — key identifier (STRING, nullable). | PLAN_VERSION_ID / ZPLAN_VER (ddl) |
| `material_fert_number` | STRING | key |  | Material fert number — key identifier (STRING, nullable). | MATNR_FERT / 0MATERIAL (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | T001W / WERKS / 0PLANT (ddl) |
| `line_id` | STRING | key |  | Line ID — key identifier (STRING, nullable). | LINE_ID / ZLINE_ID (ddl) |
| `mps_week_start_date` | DATE | date |  | Mps week start date — date / time field (DATE, nullable). | 0CALWEEK (ddl) |
| `mps_planned_quantity_cases` | FLOAT64 | measure |  | Mps planned quantity cases — numeric measure (FLOAT64, nullable). | PLANNED_QTY_CS / ZMPS_PLN (ddl) |
| `mps_firmed_quantity_cases` | FLOAT64 | measure |  | Mps firmed quantity cases — numeric measure (FLOAT64, nullable). | FIRMED_QTY_CS / ZMPS_FRM (ddl) |
| `mps_planned_hours` | FLOAT64 | measure |  | Mps planned hours — numeric measure (FLOAT64, nullable). | PLANNED_HOURS / ZMPS_HRS (ddl) |
| `mps_forecast_demand_cases` | FLOAT64 | measure |  | Mps forecast demand cases — numeric measure (FLOAT64, nullable). | FORECAST_DEMAND_CS / ZMPS_DEM (ddl) |
| `mps_safety_stock_target_cases` | FLOAT64 | measure |  | Mps safety stock target cases — numeric measure (FLOAT64, nullable). | SAFETY_STOCK_TARGET_CS / ZSS_TGT (ddl) |
| `mps_status` | STRING | dimension |  | Mps status — descriptive attribute (STRING, nullable). | STATUS / ZMPS_STAT (ddl) |
| `mps_plan_reason_code` | STRING | key |  | Mps plan reason code — key identifier (STRING, nullable). | PLAN_REASON_CODE / ZRSN_CD (ddl) |

#### `fct_mrp_plan`  —  grain: plan_version_id + component_material_number + plant_code  ·  11 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `plan_version_id` | STRING | key |  | Plan version ID — key identifier (STRING, nullable). | PLAN_VERSION_ID / ZPLAN_VER (ddl) |
| `component_material_number` | STRING | key |  | Component material number — key identifier (STRING, nullable). | MATNR_COMPONENT / 0MATERIAL (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | T001W / WERKS / 0PLANT (ddl) |
| `mrp_week_start_date` | DATE | date |  | Mrp week start date — date / time field (DATE, nullable). | 0CALWEEK (ddl) |
| `mrp_gross_requirements` | FLOAT64 | measure |  | Mrp gross requirements — numeric measure (FLOAT64, nullable). | GROSS_REQUIREMENTS / ZGR_REQ (ddl) |
| `mrp_scheduled_receipts` | FLOAT64 | measure |  | Mrp scheduled receipts — numeric measure (FLOAT64, nullable). | SCHEDULED_RECEIPTS / ZSCH_RCP (ddl) |
| `mrp_projected_on_hand` | FLOAT64 | measure |  | Mrp projected on hand — numeric measure (FLOAT64, nullable). | PROJECTED_ON_HAND / ZMRP_POH (ddl) |
| `mrp_net_requirements` | FLOAT64 | measure |  | Mrp net requirements — numeric measure (FLOAT64, nullable). | NET_REQUIREMENTS / ZNET_REQ (ddl) |
| `mrp_planned_po_quantity` | FLOAT64 | measure |  | Mrp planned purchase-order quantity — numeric measure (FLOAT64, nullable). | PLANNED_PO_QTY / ZPLN_PO (ddl) |
| `mrp_requirement_uom` | STRING | dimension |  | Mrp requirement unit-of-measure — descriptive attribute (STRING, nullable). | UNIT / 0BASE_UOM (ddl) |
| `mrp_status` | STRING | dimension |  | Mrp status — descriptive attribute (STRING, nullable). | STATUS / ZMRP_STAT (ddl) |

#### `fct_otif`  —  grain: delivery_number + primary_material_number + shipment_number + carrier_number  ·  27 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `delivery_number` | STRING | key |  | Delivery number — key identifier (STRING, nullable). | sap_z_otif_results / VBELN / 0DELIV_NUMB (ddl) |
| `sold_to` | STRING | dimension |  | Sold to — descriptive attribute (STRING, nullable). | sap_z_otif_results / KUNNR_SOLDTO / 0SOLD_TO (ddl) |
| `sold_to_name` | STRING | dimension |  | denormalized | dim_customer / customer_name / 0CUST_NAME (ddl) |
| `sold_to_priority_tier` | INT64 | measure |  | denormalized | dim_customer / priority_tier_level / ZCUST_TIER (ddl) |
| `ship_to` | STRING | dimension |  | Ship to — descriptive attribute (STRING, nullable). | sap_z_otif_results / KUNNR_SHIPTO / 0SHIP_TO (ddl) |
| `primary_material_number` | STRING | key |  | Primary material number — key identifier (STRING, nullable). | sap_z_otif_results / MATNR_PRIMARY / 0MATERIAL (ddl) |
| `primary_material_brand` | STRING | dimension |  | denormalized | dim_material / brand_name / ZBRAND (ddl) |
| `delivery_date_requested` | DATE | date |  | Delivery date requested — date / time field (DATE, nullable). | ZDLV_REQ (ddl) |
| `delivery_date_promised` | DATE | date |  | Delivery date promised — date / time field (DATE, nullable). | ZDLV_PROM (ddl) |
| `ship_date_actual` | DATE | date |  | Ship date actual — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `delivery_date_actual_at_customer` | DATE | date |  | Delivery date actual at customer — date / time field (DATE, nullable). | ZDLV_ACT (ddl) |
| `ordered_quantity_cases` | FLOAT64 | measure |  | Ordered quantity cases — numeric measure (FLOAT64, nullable). | sap_z_otif_results / ORDERED_QTY_CS / ZORD_QTY (ddl) |
| `delivered_quantity_cases` | FLOAT64 | measure |  | Delivered quantity cases — numeric measure (FLOAT64, nullable). | sap_z_otif_results / DELIVERED_QTY_CS / ZDEL_QTY (ddl) |
| `fill_rate_pct` | FLOAT64 | measure |  | Fill rate percent — numeric measure (FLOAT64, nullable). | sap_z_otif_results / FILL_RATE_PCT / ZFILL_PCT (ddl) |
| `days_late` | INT64 | measure |  | Days late — numeric measure (INT64, nullable). | sap_z_otif_results / DAYS_LATE / ZDAYS_LT (ddl) |
| `days_early` | INT64 | measure |  | Days early — numeric measure (INT64, nullable). | sap_z_otif_results / DAYS_EARLY / ZDAYS_ER (ddl) |
| `on_time_flag` | STRING | dimension |  | On time flag — descriptive attribute (STRING, nullable). | sap_z_otif_results / ON_TIME_FLAG / ZOT_FLAG (ddl) |
| `in_full_flag` | STRING | dimension |  | In full flag — descriptive attribute (STRING, nullable). | sap_z_otif_results / IN_FULL_FLAG / ZIF_FLAG (ddl) |
| `otif_flag` | STRING | dimension |  | OTIF flag — descriptive attribute (STRING, nullable). | sap_z_otif_results / OTIF_FLAG / ZOTIF_FLG (ddl) |
| `otif_fail_reason` | STRING | dimension |  | OTIF fail reason — descriptive attribute (STRING, nullable). | sap_z_otif_results / OTIF_FAIL_REASON / ZOTIF_RSN (ddl) |
| `shipment_number` | STRING | key |  | Shipment number — key identifier (STRING, nullable). | sap_z_otif_results / TKNUM / 0TKNUM (ddl) |
| `carrier_number` | STRING | key |  | Carrier number — key identifier (STRING, nullable). | sap_z_otif_results / TDLNR_CARRIER / 0VENDOR (ddl) |
| `carrier_name` | STRING | dimension |  | denormalized | dim_carrier / carrier_name / ZCARR_NAME (ddl) |
| `carrier_scac_code` | STRING | key |  | denormalized | dim_carrier / carrier_scac_code / ZSCAC (ddl) |
| `otif_root_cause_category` | STRING | dimension |  | OTIF root cause category — descriptive attribute (STRING, nullable). | sap_z_otif_results / ROOT_CAUSE_CATEGORY / ZRC_CAT (ddl) |
| `otif_target_pct` | FLOAT64 | measure |  | denormalized | dim_customer / otif_target_pct / ZOTIF_TGT (ddl) |
| `fill_rate_threshold_pct` | FLOAT64 | measure |  | denormalized | dim_customer / fill_rate_threshold_pct / ZFILL_THR (ddl) |

#### `fct_plan_adherence`  —  grain: material_fert_number + plant_code  ·  9 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `material_fert_number` | STRING | key |  | Material fert number — key identifier (STRING, nullable). | MATNR_FERT / 0MATERIAL (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | T001W / WERKS / 0PLANT (ddl) |
| `adherence_week_start_date` | DATE | date |  | Adherence week start date — date / time field (DATE, nullable). | 0CALWEEK (ddl) |
| `adherence_planned_quantity_cs` | FLOAT64 | measure |  | Adherence planned quantity cs — numeric measure (FLOAT64, nullable). | PLANNED_QTY_CS / ZPLN_QTY (ddl) |
| `adherence_actual_quantity_cs` | FLOAT64 | measure |  | Adherence actual quantity cs — numeric measure (FLOAT64, nullable). | ACTUAL_QTY_CS / ZACT_QTY (ddl) |
| `adherence_variance_cases` | FLOAT64 | measure |  | Adherence variance cases — numeric measure (FLOAT64, nullable). | VARIANCE_QTY_CS / ZVAR_QTY (ddl) |
| `adherence_variance_pct` | FLOAT64 | measure |  | Adherence variance percent — numeric measure (FLOAT64, nullable). | VARIANCE_PCT / ZVAR_PCT (ddl) |
| `adherence_status` | STRING | dimension |  | Adherence status — descriptive attribute (STRING, nullable). | STATUS / ZADH_STAT (ddl) |
| `adherence_root_cause_category` | STRING | dimension |  | Adherence root cause category — descriptive attribute (STRING, nullable). | ROOT_CAUSE_CATEGORY / ZRC_CAT (ddl) |

#### `fct_production_components_consumed`  —  grain: reservation_number + production_order_number + component_material_number + plant_code  ·  12 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `reservation_number` | STRING | key |  | Reservation number — key identifier (STRING, nullable). | sap_resb_reservations / RSNUM / 0RSNUM (ddl) |
| `reservation_item` | STRING | dimension |  | Reservation item — descriptive attribute (STRING, nullable). | sap_resb_reservations / RSPOS / 0RSPOS (ddl) |
| `production_order_number` | STRING | key |  | Production order number — key identifier (STRING, nullable). | sap_resb_reservations / AUFNR / 0PROD_ORDER (ddl) |
| `component_material_number` | STRING | key |  | Component material number — key identifier (STRING, nullable). | sap_resb_reservations / MATNR / 0MATERIAL (ddl) |
| `component_description` | STRING | dimension |  | denormalized | dim_material / material_description / 0MAT_TEXT (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | sap_resb_reservations / WERKS / 0PLANT (ddl) |
| `storage_location` | STRING | dimension |  | Storage location — descriptive attribute (STRING, nullable). | sap_resb_reservations / LGORT / 0STOR_LOC (ddl) |
| `requirement_quantity` | FLOAT64 | measure |  | Requirement quantity — numeric measure (FLOAT64, nullable). | sap_resb_reservations / BDMNG / 0BDMNG (ddl) |
| `actual_consumed_quantity` | FLOAT64 | measure |  | Actual consumed quantity — numeric measure (FLOAT64, nullable). | sap_resb_reservations / ENMNG / 0ENMNG (ddl) |
| `component_uom` | STRING | dimension |  | Component unit-of-measure — descriptive attribute (STRING, nullable). | sap_resb_reservations / MEINS / 0BASE_UOM (ddl) |
| `requirement_date` | DATE | date |  | Requirement date — date / time field (DATE, nullable). | 0BDTER (ddl) |
| `deletion_indicator` | STRING | dimension |  | Deletion indicator — descriptive attribute (STRING, nullable). | sap_resb_reservations / XLOEK / 0XLOEK (ddl) |

#### `fct_production_confirmations`  —  grain: confirmation_number + production_order_number + operation_number + plant_code  ·  9 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `confirmation_number` | STRING | key |  | Confirmation number — key identifier (STRING, nullable). | RUECK / 0CONF_NUM (ddl) |
| `production_order_number` | STRING | key |  | Production order number — key identifier (STRING, nullable). | AUFNR / 0PROD_ORDER (ddl) |
| `operation_number` | STRING | key |  | Operation number — key identifier (STRING, nullable). | VORNR / 0OPER_NUM (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | T001W / WERKS / 0PLANT (ddl) |
| `confirmation_posting_date` | DATE | date |  | Confirmation posting date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `yield_quantity` | FLOAT64 | measure |  | Yield quantity — numeric measure (FLOAT64, nullable). | LMNGA / 0YIELD_QTY (ddl) |
| `scrap_quantity` | FLOAT64 | measure |  | Scrap quantity — numeric measure (FLOAT64, nullable). | XMNGA / 0SCRAP_QTY (ddl) |
| `confirmation_uom` | STRING | dimension |  | Confirmation unit-of-measure — descriptive attribute (STRING, nullable). | MEINH / 0BASE_UOM (ddl) |
| `final_confirmation_flag` | STRING | dimension |  | Final confirmation flag — descriptive attribute (STRING, nullable). | AUERU / 0AUERU (ddl) |

#### `fct_production_orders`  —  grain: production_order_number + plant_code + routing_number + planned_material_number  ·  35 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `production_order_number` | STRING | key |  | Production order number — key identifier (STRING, nullable). | sap_afko_production_order_header / AUFNR / 0PROD_ORDER (ddl) |
| `production_order_item` | STRING | dimension |  | Production order item — descriptive attribute (STRING, nullable). | sap_afpo_production_order_items / POSNR / 0ITM_NUMBER (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | sap_afko_production_order_header / WERKS / 0PLANT (ddl) |
| `plant_name` | STRING | dimension |  | denormalized | dim_plant / plant_name / 0PLANT_NAME (ddl) |
| `production_order_type` | STRING | dimension |  | Production order type — descriptive attribute (STRING, nullable). | sap_afko_production_order_header / AUART / 0PRODORDTYP (ddl) |
| `production_order_status` | STRING | dimension |  | Production order status — descriptive attribute (STRING, nullable). | sap_afko_production_order_header / STAT / 0PRODSTAT (ddl) |
| `production_supervisor` | STRING | dimension |  | Production supervisor — descriptive attribute (STRING, nullable). | sap_afko_production_order_header / DISPO / 0MRP_CTRLR (ddl) |
| `planned_start_date` | DATE | date |  | Planned start date — date / time field (DATE, nullable). | 0BAS_START (ddl) |
| `planned_end_date` | DATE | date |  | Planned end date — date / time field (DATE, nullable). | 0BAS_FIN (ddl) |
| `actual_start_date` | DATE | date |  | Actual start date — date / time field (DATE, nullable). | 0ACT_START (ddl) |
| `actual_end_date` | DATE | date |  | Actual end date — date / time field (DATE, nullable). | 0ACT_FIN (ddl) |
| `order_release_date` | DATE | date |  | Order release date — date / time field (DATE, nullable). | 0FTRMI (ddl) |
| `routing_number` | STRING | key |  | Routing number — key identifier (STRING, nullable). | sap_afko_production_order_header / PLNNR / 0ROUTING (ddl) |
| `planned_material_number` | STRING | key |  | header level | sap_afko_production_order_header / PLNBEZ / 0MATERIAL (ddl) |
| `order_planned_quantity` | FLOAT64 | measure |  | Order planned quantity — numeric measure (FLOAT64, nullable). | sap_afko_production_order_header / GAMNG / 0PRODORDQTY (ddl) |
| `order_quantity_uom` | STRING | dimension |  | Order quantity unit-of-measure — descriptive attribute (STRING, nullable). | sap_afko_production_order_header / GMEIN / 0BASE_UOM (ddl) |
| `item_material_number` | STRING | key |  | item level | sap_afpo_production_order_items / MATNR / 0MATERIAL (ddl) |
| `item_material_description` | STRING | dimension |  | denormalized | dim_material / material_description / 0MAT_TEXT (ddl) |
| `item_brand` | STRING | dimension |  | denormalized | dim_material / brand_name / ZBRAND (ddl) |
| `production_plant` | STRING | dimension |  | Production plant — descriptive attribute (STRING, nullable). | sap_afpo_production_order_items / DWERK / 0PLANT (ddl) |
| `production_storage_location` | STRING | dimension |  | Production storage location — descriptive attribute (STRING, nullable). | sap_afpo_production_order_items / LGORT / 0STOR_LOC (ddl) |
| `item_planned_quantity` | FLOAT64 | measure |  | Item planned quantity — numeric measure (FLOAT64, nullable). | sap_afpo_production_order_items / PSMNG / 0PSMNG (ddl) |
| `item_delivered_quantity` | FLOAT64 | measure |  | AFPO header rollup | sap_afpo_production_order_items / WEMNG / 0WEMNG (ddl) |
| `item_uom` | STRING | dimension |  | Item unit-of-measure — descriptive attribute (STRING, nullable). | sap_afpo_production_order_items / MEINS / 0BASE_UOM (ddl) |
| `item_finish_date` | DATE | date |  | Item finish date — date / time field (DATE, nullable). | 0DGLT (ddl) |
| `actual_yield_quantity_total` | FLOAT64 | measure |  | aggregated SUM of AFRU.LMNGA | afru_agg / yield_total / ZYLD_TOT (ddl) |
| `actual_scrap_quantity_total` | FLOAT64 | measure |  | aggregated SUM of AFRU.XMNGA | afru_agg / scrap_total / ZSCRAP_TOT (ddl) |
| `confirmation_event_count` | INT64 | measure |  | Confirmation event count — numeric measure (INT64, nullable). | ZCONF_CNT (ddl) |
| `first_confirmation_date` | DATE | date |  | First confirmation date — date / time field (DATE, nullable). | afru_agg / first_conf_date / ZFRST_CONF (ddl) |
| `last_confirmation_date` | DATE | date |  | Last confirmation date — date / time field (DATE, nullable). | afru_agg / last_conf_date / ZLAST_CONF (ddl) |
| `is_fully_confirmed_flag` | STRING | dimension |  | Is fully confirmed flag — descriptive attribute (STRING, nullable). | ZFULL_CONF (ddl) |
| `plan_adherence_quantity_variance` | FLOAT64 | measure |  | Plan adherence quantity variance — numeric measure (FLOAT64, nullable). | ZADH_QVAR (ddl) |
| `plan_adherence_pct` | FLOAT64 | measure |  | Plan adherence percent — numeric measure (FLOAT64, nullable). | ZADH_PCT (ddl) |
| `yield_pct` | FLOAT64 | measure |  | Yield percent — numeric measure (FLOAT64, nullable). | ZYLD_PCT (ddl) |
| `scrap_pct` | FLOAT64 | measure |  | Scrap percent — numeric measure (FLOAT64, nullable). | ZSCRAP_PCT (ddl) |

#### `fct_promo_plan`  —  grain: promo_id + material_zrep_number  ·  13 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `promo_id` | STRING | key |  | Promo ID — key identifier (STRING, nullable). | anaplan_promo_plan / PROMO_ID / ZPROMO_ID (ddl) |
| `promo_name` | STRING | dimension |  | Promo name — descriptive attribute (STRING, nullable). | anaplan_promo_plan / PROMO_NAME (ddl) |
| `material_zrep_number` | STRING | key |  | Material zrep number — key identifier (STRING, nullable). | anaplan_promo_plan / MATNR_ZREP / 0MATERIAL (ddl) |
| `sold_to` | STRING | dimension |  | Sold to — descriptive attribute (STRING, nullable). | anaplan_promo_plan / KUNNR_SOLDTO / 0SOLD_TO (ddl) |
| `sold_to_name` | STRING | dimension |  | denormalized | dim_customer / customer_name / 0CUST_NAME (ddl) |
| `material_brand` | STRING | dimension |  | denormalized | dim_material / brand_name / ZBRAND (ddl) |
| `promo_type` | STRING | dimension |  | Promo type — descriptive attribute (STRING, nullable). | anaplan_promo_plan / PROMO_TYPE / ZPROMO_TYP (ddl) |
| `promo_season` | STRING | dimension |  | Promo season — descriptive attribute (STRING, nullable). | anaplan_promo_plan / SEASON / ZSEASON (ddl) |
| `promo_start_date` | DATE | date |  | Promo start date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `promo_end_date` | DATE | date |  | Promo end date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `baseline_lift_pct` | FLOAT64 | measure |  | Baseline lift percent — numeric measure (FLOAT64, nullable). | anaplan_promo_plan / BASELINE_LIFT_PCT / ZLIFT_PCT (ddl) |
| `expected_incremental_quantity` | FLOAT64 | measure |  | Expected incremental quantity — numeric measure (FLOAT64, nullable). | anaplan_promo_plan / EXPECTED_INCREMENTAL_QTY / ZINCR_QTY (ddl) |
| `promo_status` | STRING | dimension |  | Promo status — descriptive attribute (STRING, nullable). | anaplan_promo_plan / STATUS / ZPRMO_STAT (ddl) |

#### `fct_purchase_orders`  —  grain: purchase_order_number + company_code + vendor_number + material_number  ·  27 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `purchase_order_number` | STRING | key |  | Purchase order number — key identifier (STRING, nullable). | sap_ekko_purchase_order_header / EBELN / 0OI_EBELN (ddl) |
| `purchase_order_item` | STRING | dimension |  | Purchase order item — descriptive attribute (STRING, nullable). | sap_ekpo_purchase_order_items / EBELP / 0OI_EBELP (ddl) |
| `company_code` | STRING | key |  | Company code — key identifier (STRING, nullable). | sap_ekko_purchase_order_header / BUKRS / 0COMP_CODE (ddl) |
| `po_document_type` | STRING | dimension |  | Purchase-order document type — descriptive attribute (STRING, nullable). | sap_ekko_purchase_order_header / BSART / 0DOC_TYPE (ddl) |
| `po_category` | STRING | dimension |  | Purchase-order category — descriptive attribute (STRING, nullable). | sap_ekko_purchase_order_header / BSTYP / 0PO_CATEGORY (ddl) |
| `po_creation_date` | DATE | date |  | Purchase-order creation date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `po_document_date` | DATE | date |  | Purchase-order document date — date / time field (DATE, nullable). | 0PO_BEDAT (ddl) |
| `created_by_user` | STRING | dimension |  | Created by user — descriptive attribute (STRING, nullable). | sap_ekko_purchase_order_header / ERNAM / 0CREATEDBY (ddl) |
| `vendor_number` | STRING | key |  | Vendor number — key identifier (STRING, nullable). | sap_ekko_purchase_order_header / LIFNR / 0VENDOR (ddl) |
| `vendor_name` | STRING | dimension |  | denormalized | dim_vendor / vendor_name / 0VENDOR_NAME (ddl) |
| `purchasing_organization` | STRING | dimension |  | Purchasing organization — descriptive attribute (STRING, nullable). | sap_ekko_purchase_order_header / EKORG / 0PURCH_ORG (ddl) |
| `purchasing_group` | STRING | dimension |  | Purchasing group — descriptive attribute (STRING, nullable). | sap_ekko_purchase_order_header / EKGRP / 0PUR_GROUP (ddl) |
| `document_currency` | STRING | dimension |  | Document currency — descriptive attribute (STRING, nullable). | sap_ekko_purchase_order_header / WAERS / 0DOC_CURRCY (ddl) |
| `material_number` | STRING | key |  | Material number — key identifier (STRING, nullable). | sap_ekpo_purchase_order_items / MATNR / 0MATERIAL (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | sap_ekpo_purchase_order_items / WERKS / 0PLANT (ddl) |
| `storage_location` | STRING | dimension |  | Storage location — descriptive attribute (STRING, nullable). | sap_ekpo_purchase_order_items / LGORT / 0STOR_LOC (ddl) |
| `po_quantity` | FLOAT64 | measure |  | Purchase-order quantity — numeric measure (FLOAT64, nullable). | sap_ekpo_purchase_order_items / MENGE / 0QUANT_B (ddl) |
| `po_uom` | STRING | dimension |  | Purchase-order unit-of-measure — descriptive attribute (STRING, nullable). | sap_ekpo_purchase_order_items / MEINS / 0BASE_UOM (ddl) |
| `unit_price` | FLOAT64 | measure |  | Unit price — numeric measure (FLOAT64, nullable). | sap_ekpo_purchase_order_items / NETPR / 0NETPRICE (ddl) |
| `po_line_net_value` | FLOAT64 | measure |  | Purchase-order line net value — numeric measure (FLOAT64, nullable). | sap_ekpo_purchase_order_items / NETWR / 0NETVAL_INV (ddl) |
| `price_unit_uom` | STRING | dimension |  | Price unit unit-of-measure — descriptive attribute (STRING, nullable). | sap_ekpo_purchase_order_items / BPRME / 0PRICE_UOM (ddl) |
| `delivery_complete_flag` | STRING | dimension |  | Delivery complete flag — descriptive attribute (STRING, nullable). | sap_ekpo_purchase_order_items / ELIKZ / 0ELIKZ (ddl) |
| `deletion_indicator` | STRING | dimension |  | Deletion indicator — descriptive attribute (STRING, nullable). | sap_ekpo_purchase_order_items / LOEKZ / 0LOEKZ (ddl) |
| `scheduled_delivery_date` | DATE | date |  | Scheduled delivery date — date / time field (DATE, nullable). | — (derived) |
| `statistical_delivery_date` | DATE | date |  | Statistical delivery date — date / time field (DATE, nullable). | — (derived) |
| `scheduled_total_quantity` | FLOAT64 | measure |  | Scheduled total quantity — numeric measure (FLOAT64, nullable). | — (derived) |
| `received_total_quantity` | FLOAT64 | measure |  | Received total quantity — numeric measure (FLOAT64, nullable). | — (derived) |

#### `fct_sales_orders`  —  grain: sales_order_number + customer_po_number + material_number + plant_code  ·  33 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `sales_order_number` | STRING | key |  | Sales order number — key identifier (STRING, nullable). | sap_vbak_sales_order_header / VBELN / 0DOC_NUMBER (ddl) |
| `sales_order_item` | STRING | dimension |  | Sales order item — descriptive attribute (STRING, nullable). | sap_vbap_sales_order_items / POSNR / 0ITM_NUMBER (ddl) |
| `order_creation_date` | DATE | date |  | Order creation date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `order_creation_time` | STRING | dimension |  | Order creation time — descriptive attribute (STRING, nullable). | sap_vbak_sales_order_header / ERZET (ddl) |
| `order_type` | STRING | dimension |  | Order type — descriptive attribute (STRING, nullable). | sap_vbak_sales_order_header / AUART / 0SD_DOC_TYPE (ddl) |
| `sales_organization` | STRING | dimension |  | Sales organization — descriptive attribute (STRING, nullable). | sap_vbak_sales_order_header / VKORG / 0SALESORG (ddl) |
| `distribution_channel` | STRING | dimension |  | Distribution channel — descriptive attribute (STRING, nullable). | sap_vbak_sales_order_header / VTWEG / 0DISTR_CHAN (ddl) |
| `division` | STRING | dimension |  | Division — descriptive attribute (STRING, nullable). | sap_vbak_sales_order_header / SPART / 0DIVISION (ddl) |
| `sold_to` | STRING | dimension |  | Sold to — descriptive attribute (STRING, nullable). | sap_vbak_sales_order_header / KUNNR / 0SOLD_TO (ddl) |
| `sold_to_name` | STRING | dimension |  | denormalized | dim_customer / customer_name / 0CUST_NAME (ddl) |
| `sold_to_priority_tier` | INT64 | measure |  | denormalized | dim_customer / priority_tier_level / ZCUST_TIER (ddl) |
| `ship_to` | STRING | dimension |  | Ship to — descriptive attribute (STRING, nullable). | sap_vbap_sales_order_items / KUNNR_SHIPTO / 0SHIP_TO (ddl) |
| `sales_office` | STRING | dimension |  | Sales office — descriptive attribute (STRING, nullable). | sap_vbak_sales_order_header / VKBUR / 0SALESOFF (ddl) |
| `sales_group` | STRING | dimension |  | Sales group — descriptive attribute (STRING, nullable). | sap_vbak_sales_order_header / VKGRP / 0SALES_GRP (ddl) |
| `document_currency` | STRING | dimension |  | Document currency — descriptive attribute (STRING, nullable). | sap_vbak_sales_order_header / WAERK / 0DOC_CURRCY (ddl) |
| `requested_delivery_date` | DATE | date |  | Requested delivery date — date / time field (DATE, nullable). | VBAK / VDATU / 0REQ_DLV_DAT (ddl) |
| `customer_po_number` | STRING | key |  | Customer purchase-order number — key identifier (STRING, nullable). | sap_vbak_sales_order_header / BSTNK / 0PO_NUMBER (ddl) |
| `order_reason` | STRING | dimension |  | Order reason — descriptive attribute (STRING, nullable). | sap_vbak_sales_order_header / AUGRU / 0ORDER_REAS (ddl) |
| `order_header_total_value_usd` | FLOAT64 | measure |  | Order header total value USD — numeric measure (FLOAT64, nullable). | sap_vbak_sales_order_header / NETWR / 0NETVALORD (ddl) |
| `material_number` | STRING | key |  | Material number — key identifier (STRING, nullable). | sap_vbap_sales_order_items / MATNR / 0MATERIAL (ddl) |
| `material_description` | STRING | dimension |  | denormalized | dim_material / material_description / 0MAT_TEXT (ddl) |
| `material_brand` | STRING | dimension |  | denormalized | dim_material / brand_name / ZBRAND (ddl) |
| `material_brand_archetype` | STRING | dimension |  | denormalized | dim_material / brand_archetype / ZARCHETYPE (ddl) |
| `material_group` | STRING | dimension |  | Material group — descriptive attribute (STRING, nullable). | sap_vbap_sales_order_items / MATKL / 0MATL_GROUP (ddl) |
| `plant_code` | STRING | key |  | Plant code — key identifier (STRING, nullable). | sap_vbap_sales_order_items / WERKS / 0PLANT (ddl) |
| `plant_name` | STRING | dimension |  | denormalized | dim_plant / plant_name / 0PLANT_NAME (ddl) |
| `ordered_quantity_sales_uom` | FLOAT64 | measure |  | Ordered quantity sales unit-of-measure — numeric measure (FLOAT64, nullable). | sap_vbap_sales_order_items / KWMENG / 0QUANT_B (ddl) |
| `sales_uom` | STRING | dimension |  | Sales unit-of-measure — descriptive attribute (STRING, nullable). | sap_vbap_sales_order_items / VRKME / 0SALES_UNIT (ddl) |
| `base_uom` | STRING | dimension |  | Base unit-of-measure — descriptive attribute (STRING, nullable). | sap_vbap_sales_order_items / MEINS / 0BASE_UOM (ddl) |
| `unit_price` | FLOAT64 | measure |  | Unit price — numeric measure (FLOAT64, nullable). | sap_vbap_sales_order_items / NETPR / 0NETPRICE (ddl) |
| `line_net_value_usd` | FLOAT64 | measure |  | Line net value USD — numeric measure (FLOAT64, nullable). | sap_vbap_sales_order_items / NETWR / 0NETVAL_INV (ddl) |
| `item_category` | STRING | dimension |  | Item category — descriptive attribute (STRING, nullable). | sap_vbap_sales_order_items / PSTYV / 0ITEM_CATEG (ddl) |
| `rejection_reason` | STRING | dimension |  | Rejection reason — descriptive attribute (STRING, nullable). | sap_vbap_sales_order_items / ABGRU / 0RJCT_RSN (ddl) |

#### `fct_shipments`  —  grain: shipment_number + carrier_number + carrier_scac_code  ·  21 cols

| column | type | class | null | description | lineage (src) |
|---|---|---|---|---|---|
| `shipment_number` | STRING | key |  | Shipment number — key identifier (STRING, nullable). | sap_vttk_shipment_header / TKNUM / 0TKNUM (ddl) |
| `shipment_creation_date` | DATE | date |  | Shipment creation date — date / time field (DATE, nullable). | 0CALDAY (ddl) |
| `shipment_last_changed_date` | DATE | date |  | Shipment last changed date — date / time field (DATE, nullable). | 0CHANGED_ON (ddl) |
| `transportation_mode` | STRING | dimension |  | Transportation mode — descriptive attribute (STRING, nullable). | sap_vttk_shipment_header / VSART / 0TRSP_MODE (ddl) |
| `carrier_number` | STRING | key |  | Carrier number — key identifier (STRING, nullable). | sap_vttk_shipment_header / TDLNR / 0VENDOR (ddl) |
| `carrier_name` | STRING | dimension |  | denormalized | dim_carrier / carrier_name / ZCARR_NAME (ddl) |
| `carrier_scac_code` | STRING | key |  | Carrier scac code — key identifier (STRING, nullable). | sap_vttk_shipment_header / SCAC / ZSCAC (ddl) |
| `shipment_route` | STRING | dimension |  | Shipment route — descriptive attribute (STRING, nullable). | sap_vttk_shipment_header / ROUTE / 0ROUTE (ddl) |
| `service_level` | STRING | dimension |  | Service level — descriptive attribute (STRING, nullable). | sap_vttk_shipment_header / SIGNI / 0SIGNI (ddl) |
| `planned_departure_date` | DATE | date |  | Planned departure date — date / time field (DATE, nullable). | 0DPTBG (ddl) |
| `actual_departure_date` | DATE | date |  | Actual departure date — date / time field (DATE, nullable). | 0DTABG (ddl) |
| `planned_arrival_date` | DATE | date |  | Planned arrival date — date / time field (DATE, nullable). | 0DPTEN (ddl) |
| `actual_arrival_date` | DATE | date |  | Actual arrival date — date / time field (DATE, nullable). | 0DTAEN (ddl) |
| `shipment_status` | STRING | dimension |  | Shipment status — descriptive attribute (STRING, nullable). | sap_vttk_shipment_header / STERM_NORM / 0STAT (ddl) |
| `origin_plant` | STRING | dimension |  | Origin plant — descriptive attribute (STRING, nullable). | sap_vttk_shipment_header / WERKS_FROM / 0PLANT (ddl) |
| `destination_region` | STRING | dimension |  | Destination region — descriptive attribute (STRING, nullable). | sap_vttk_shipment_header / DEST_REGION / ZDEST_REG (ddl) |
| `total_deliveries_on_shipment` | INT64 | measure |  | Total deliveries on shipment — numeric measure (INT64, nullable). | sap_vttk_shipment_header / TOTAL_DELIVERIES / ZTOT_DEL (ddl) |
| `total_shipment_value_usd` | FLOAT64 | measure |  | Total shipment value USD — numeric measure (FLOAT64, nullable). | sap_vttk_shipment_header / TOTAL_NETWR_USD / ZSHP_VAL (ddl) |
| `loading_duration_hours` | FLOAT64 | measure |  | aggregated | vtts_agg / loading_hrs / ZLOAD_HRS (ddl) |
| `transit_duration_hours` | FLOAT64 | measure |  | aggregated | vtts_agg / transit_hrs / ZTRAN_HRS (ddl) |
| `unloading_duration_hours` | FLOAT64 | measure |  | aggregated | vtts_agg / unloading_hrs / ZUNLD_HRS (ddl) |

## 5. Key conventions

- `sold_to` = SAP customer (KUNNR); `material_number` = SAP material (MATNR, FERT level).
- `material_zrep_number` / `zrep_parent_material` = ZREP planning parent — the join key for forecast/DRP (resolve FERT→ZREP via `dim_material`).
- `plant_code` = SAP plant (WERKS); `vendor_number` = LIFNR.
- Quantities are in **cases (CS)** unless a `*_uom` column says otherwise.
- Boolean-like flags are `'Y'`/`'N'` strings (e.g. `otif_flag`, `on_time_flag`).
- 'Open' order = `rejection_reason IS NULL` (no status column).

## 6. Business glossary

| term | full | definition |
|---|---|---|
| **MABD** | Must Arrive By Date | The customer-specified date by which an order must physically arrive at the destination DC. Missing the MABD triggers OTIF penalties. |
| **OTIF** | On Time In Full | A retailer compliance metric measuring the percentage of orders delivered on time and at the correct quantity. Each retailer sets their own target (e.g. Walmart 98%, Amazon 99%, Target 95%). Failure results in chargebacks. |
| **Fill Rate** |  | The percentage of an order quantity that is actually shipped. A fill rate of 83% means 83 cases were shipped for every 100 ordered. Directly tied to Case Fill Rate (CFR). |
| **ATP** | Available to Promise | The portion of on-hand inventory not already committed to other accepted orders. ATP = On Hand − Committed. The recommendation engine uses ATP, not total stock, to evaluate whether a new order can be fulfilled. |
| **Committed Inventory** |  | Stock already allocated to previously accepted orders. This inventory is reserved and cannot be promised to new orders without risking a short-ship on the existing commitment. |
| **Partial Fulfillment** |  | Shipping a portion of an ordered quantity — typically the maximum available ATP — when full supply is unavailable. Preferred over deferral when it protects OTIF on the cases shipped. |
| **cs** | Cases | The standard unit of measure used throughout the platform. One case contains a manufacturer-defined number of retail units (e.g. 24 cans, 12 bags). All quantities are expressed in cases. |
| **PO** | Purchase Order | A formal order placed by a retailer to a supplier specifying SKU, quantity, price, and delivery terms. Each PO generates a Sales Order (SO) in SAP. |
| **SO** | Sales Order | The supplier-side record of a customer's purchase order, created in SAP. The platform evaluates SO-level decisions (accept, modify, reject). |
| **DoS** | Days of Supply | How many days current on-hand inventory will last at the current demand rate. Calculated as On Hand ÷ Average Daily Demand. Below 7 days is critical; 7–14 days is a warning. |
| **On Hand** |  | Total finished goods (FG) inventory physically present at a DC, as reported by the warehouse management system. Does not account for commitments — use ATP for available supply. |
| **Safety Stock** |  | A minimum inventory buffer maintained at each DC to absorb demand variability and supply uncertainty. When on-hand inventory falls below safety stock, the status is flagged BELOW_SS. |
| **Stockout** |  | A condition where on-hand inventory is zero or insufficient to fulfill any orders. The most severe inventory status — triggers immediate escalation. |
| **BELOW_SS** | Below Safety Stock | Inventory exists but has fallen below the safety stock threshold. Orders can still be partially fulfilled but the DC is in a vulnerable position for subsequent demand. |
| **Network Total** |  | The sum of on-hand inventory across all DCs for a given SKU. Used to evaluate whether split-sourcing across multiple DCs can cover an order that a single DC cannot. |
| **After Fill** |  | The inventory remaining at a DC after fulfilling an order. If After Fill drops below safety stock, the order puts the DC at risk for subsequent demand. |
| **Consensus Forecast** |  | The agreed-upon demand plan produced collaboratively by Sales, Finance, and Supply Planning — typically on a 4-week rolling basis. Orders significantly above the consensus are flagged for review. |
| **WMAPE** | Weighted Mean Absolute Percentage Error | The primary measure of forecast accuracy. Lower is better. WMAPE < 15% is HEALTHY; 15–22% is a warning; > 22% indicates a systematic forecasting problem. |
| **Forecast Bias** |  | The systematic tendency to forecast too high (positive bias) or too low (negative bias). A bias of -6% means the forecast consistently under-predicts demand by 6%, leading to preventable supply gaps. |
| **Above Forecast %** |  | How much an incoming order exceeds the consensus plan, expressed as a percentage. An order 58% above forecast is flagged for demand classification before being accepted. |
| **GENUINE_PULL** |  | A demand classification indicating that an order is driven by real consumer sell-through. POS data confirms consumers are buying the product off shelves at a rate consistent with the order. |
| **BUFFER_BUILD** |  | A demand classification where a retailer is ordering significantly above consumer sell-through, stockpiling inventory at the DC level. The key risk: the retailer will not reorder for weeks, leaving the supplier over-exposed. |
| **PROMO_DRIVEN** |  | An above-forecast order that is fully explained by a confirmed promotional event (e.g. a feature ad, a price reduction). These orders are expected and planned — they do not require escalation. |
| **ONE_OFF_ANOMALY** |  | An order spike with no identifiable driver — not a promo, not a trend, not a buffer build. Treated as a caution signal; the recommendation engine applies conservatism until a cause is identified. |
| **Classification Confidence** |  | The model's certainty in its demand classification (GENUINE_PULL, BUFFER_BUILD, etc.), expressed as a percentage. Below 65% is considered low confidence and reduces the weight given to that signal. |
| **Promo Attribution** |  | A flag indicating that an order's volume is attributed to a confirmed promotional event. Promo-attributed orders bypass certain above-forecast thresholds because the spike is planned and budgeted. |
| **OTP** | On-Time Performance | A carrier-level metric measuring the percentage of shipments that arrive on or before the scheduled delivery date. Each carrier has a contracted OTP target (typically 95%). Below-target carriers are flagged. |
| **Lane** |  | A defined shipping route between an origin DC and a customer destination. Lanes have historical performance data (OTP, average transit time, shipment volume) used to assess delivery risk. |
| **Chargeback (CB)** |  | A financial penalty charged by a retailer to a supplier for failing to meet compliance requirements — most commonly late delivery, incorrect quantity, or labeling errors. Chargebacks can be posted (confirmed) or disputed. |
| **OTIF Target** |  | Each retailer's minimum acceptable OTIF threshold, set contractually (dim_customer.otif_target_pct). Walmart 98%, Amazon 99%, Target & Kroger 95%, Petsmart 92%, Dollar General 90%. Performance below target triggers automatic chargeback calculations. |
| **Delta to Target** |  | The gap between actual trailing OTIF and the customer's OTIF target. A delta of -7 pp means OTIF is 7 percentage points below the threshold — a significant compliance risk. |
| **Demurrage** |  | Charges incurred when freight containers or trailers are held beyond the agreed free-time window at a port or terminal. (Not currently surfaced — the source warehouse has no demurrage/detention feed.) |
| **OTIF Fines at Risk (7d)** |  | Watchtower ribbon metric: the estimated chargeback exposure from OTIF failures in the 7 days before the latest OTIF date, computed as failed-order cases × average unit price × 2%. Sourced from fct_otif joined to sales-order value. |
| **Split Sourcing** |  | Fulfilling a single order by combining inventory from multiple DCs when no single DC has sufficient stock. The Transportation Agent evaluates whether the additional freight cost is less than the OTIF fine exposure. |
| **POS** | Point of Sale | Consumer transaction data captured at the retail checkout. POS shows actual consumer sell-through (units leaving shelves), as opposed to orders placed by the retailer. A healthy order should be supported by strong POS. |
| **OHI** | On-Hand Inventory | The retailer's reported stock level at their DCs or stores. High OHI relative to norm, combined with a large inbound order, is a strong buffer-build signal. |
| **OHI vs Norm** |  | A comparison of a retailer's current OHI to their typical historical inventory level for that SKU. OHI significantly above norm indicates the retailer may already be over-stocked. |
| **ACV Distribution** | All Commodity Volume Distribution | The percentage of retail stores carrying a product, weighted by each store's sales volume. 82% ACV means the product is available in stores representing 82% of total category sales. Used to calibrate expected POS volume. |
| **POS Velocity** |  | The rate of consumer purchases, typically measured in units per week. An accelerating POS velocity supports a genuine demand interpretation; flat or declining velocity alongside a large order is a buffer-build warning. |
| **Risk Score** |  | A composite buffer-build risk score from 1 (low) to 5 (high), calculated from OHI vs norm, POS trend, order size vs forecast, and classification confidence. Score of 5 triggers an automatic BLOCK recommendation. |
| **Takeaway Trend** |  | The direction of consumer POS velocity over the trailing 8 weeks: ACCELERATING, FLAT, or DECELERATING. A decelerating trend combined with a large order is a strong buffer-build indicator. |
| **Fines at Risk** |  | The total projected chargeback and OTIF penalty exposure across all active orders in the next 7 days, assuming no corrective action is taken. Shown in the TopBar as a real-time risk signal. |
| **Revenue Preserved MTD** |  | The cumulative revenue protected month-to-date by accepting orders that might otherwise have been deferred or rejected. Calculated as the value of cases shipped following an agent-assisted approval. |
| **Net Impact** |  | The total financial impact of a fulfillment scenario, combining freight cost and fine exposure. A negative net impact represents a cost. The scenario with the least negative (or zero) net impact is recommended. |
| **Savings vs Default** |  | How much better a fulfillment scenario is, in dollars, compared to taking no action (the default path). A saving of $33,960 means choosing this scenario avoids $33,960 in costs relative to doing nothing. |
| **Fine per cs** | Fine per Case | The per-case chargeback rate a retailer applies when delivery is late or incomplete — derived per customer from fct_chargebacks (e.g. Walmart ≈ $8/cs, Amazon ≈ $7.5/cs, Petsmart ≈ $71/cs). Used by the Transportation Agent to calculate fine exposure for partial fulfillment scenarios. |
| **CB Exposure** | Chargeback Exposure | The total dollar amount of pending chargebacks for a customer — split between posted (confirmed, awaiting deduction) and disputed (under review). High exposure reduces the financial case for accepting marginal orders. |
| **CFR** | Case Fill Rate | The headline supply chain performance metric: cases shipped ÷ cases ordered, expressed as a percentage. CFR of 93.0% means 93 of every 100 ordered cases were fulfilled. The platform is designed to protect and improve CFR. |
| **Agent Acceptance Rate** |  | The percentage of AI agent recommendations that the human operator approves without modification. A high acceptance rate (>85%) indicates the agents are well-calibrated to operational reality. |
| **Disposition** |  | Each specialist agent's verdict on an order: PROCEED (no issues found), CAUTION (a risk exists but is manageable), or BLOCK (a hard constraint makes fulfillment inadvisable). The orchestrator aggregates all four dispositions. |
| **Hard Block** |  | A disposition flag indicating that an agent has found a condition that makes fulfillment impossible or highly inadvisable regardless of other signals — e.g. a confirmed stockout with no alternative sourcing. |
| **Orchestrator** |  | The coordinating agent that aggregates signals from all four specialist agents, resolves conflicts through a structured debate process, and produces a single Green / Amber / Red status and recommendation for the human operator. |
| **PRO** | Production Order | A manufacturing order in SAP that schedules the production of a specific SKU. PRO adherence % measures how closely the actual output tracks the planned quantity and completion date. |
| **Plan Adherence %** |  | The percentage of planned production output that is actually achieved. 82% adherence means only 82 cases are produced for every 100 planned — creating supply risk when orders depend on that production run completing on time. |
| **WMAPE Flag** |  | A qualitative label applied to a SKU's forecast quality: HEALTHY (<15% WMAPE), SYSTEMATIC_UNDER (consistent under-forecasting), SYSTEMATIC_OVER (consistent over-forecasting), or NOISY (high variance with no clear pattern). |
| **ATP Coverage** | Available to Promise Coverage | The percentage of an order quantity that can be covered by uncommitted inventory. ATP Coverage below 100% means a full acceptance is not possible — the recommendation engine will suggest a partial fill or alternative sourcing. |

## 7. Write layer (decisions)

Agent decisions/audit are written to a **separate** dataset (`DECISIONS_DS`, default `<project>.tiger_decisions`): `fct_allocation_decisions`, `fct_fulfillment_plan`, and the case/finops log tables. A client deployment must provision a writable decisions dataset; it is NOT mapped from client sources (it is the app's own output).

## 8. Required vs v3-deferred

All dimensions + the Sales/Inventory/Supply/Procurement/Forecast/Logistics fact areas are **required**. The following are **v3-deferred** — absence is expected, not an error:

_(none detected)_
