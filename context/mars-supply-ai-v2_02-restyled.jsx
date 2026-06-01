import { useState, useEffect, useRef } from "react";
import { LayoutDashboard, Inbox, GitMerge, FileSearch, ShieldCheck, Home, Clock, BarChart2, TrendingUp, Truck, ShoppingCart, ChevronLeft, ChevronRight, Activity, BookOpen, Bot, PanelRightClose, PanelRightOpen } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const C = {
  red:"#DB033B",redLight:"#fef2f2",charcoal:"#1e293b",cream:"#F5F1E7",
  border:"#e2e8f0",muted:"#94a3b8",green:"#059669",teal:"#0d9488",
  blue:"#0284c7",orange:"#d97706",purple:"#7c3aed",white:"#FFFFFF",
  off:"#f8fafc",black:"#0f172a"
};
const MONO="'JetBrains Mono',ui-monospace,monospace";

// ── NEXUS CO-PILOT CONFIGURATION ──────────────────────────────────────────────
// Paste your Gemini API key here (get one free at aistudio.google.com → Get API key).
// For AI Studio deployment use: import.meta.env.VITE_GEMINI_API_KEY
// Leave empty to show the "configure key" state without crashing.
const NEXUS_API_KEY = "";
const NEXUS_MODEL   = "gemini-2.0-flash";
const AGENT_LABELS = {
  supply_planning:{label:"Supply Planning",color:C.blue},
  demand_planning:{label:"Demand Planning",color:C.orange},
  transportation:{label:"Transportation",color:C.teal},
  retail_intelligence:{label:"Retail Intelligence",color:C.purple},
};
const AGENT_KEYS = ["supply_planning","demand_planning","transportation","retail_intelligence"];
const dispColor = d => ({PROCEED:C.green,CAUTION:C.orange,BLOCK:C.red}[d]||C.muted);
const sevColor  = s => ({HIGH:C.red,MEDIUM:C.orange,LOW:"#DAA520",CRITICAL:"#7B0000"}[s]||C.muted);
const actColor  = a => ({ACCEPT:C.green,PARTIAL_FULFILL:C.orange,DEFER:C.blue,REJECT:C.red}[a]||C.muted);
const flagColor = t => ({above_forecast:C.orange,promo:C.blue,hard_block:C.red,buffer_build:C.purple,clean:C.green}[t]||C.muted);

// ── ORDERS ─────────────────────────────────────────────────────────────────
const ORDERS = [
  {id:"SO-44019",po:"PO-558831",sold_to:"CUST-04821",customer:"Walmart",
   sku:"SKU-1188",desc:"PEDIGREE Adult Chicken & Veg 18lb 4-pk",
   qty:6000,mabd:"2026-06-02",ship_to:"DC-TX-01",priority:1,
   flag:"58% above forecast",flag_type:"above_forecast"},
  {id:"SO-44020",po:"PO-331042",sold_to:"CUST-02190",customer:"PetSmart",
   sku:"SKU-2241",desc:"WHISKAS Tender Bites Tuna in Gravy 24ct",
   qty:4500,mabd:"2026-06-05",ship_to:"DC-NJ-02",priority:1,
   flag:"Promo spike — 3x weekly run rate",flag_type:"promo"},
  {id:"SO-44021",po:"PO-190887",sold_to:"CUST-07734",customer:"Chewy",
   sku:"SKU-3305",desc:"SHEBA PERFECT PORTIONS Premium Cuts 72ct",
   qty:3200,mabd:"2026-06-04",ship_to:"DC-FL-04",priority:2,
   flag:"Hard supply constraint — DC-FL-04",flag_type:"hard_block"},
  {id:"SO-44022",po:"PO-447219",sold_to:"CUST-01155",customer:"Target",
   sku:"SKU-4417",desc:"TEMPTATIONS Classic Chicken 16oz 12-pk",
   qty:8000,mabd:"2026-06-07",ship_to:"DC-CA-03",priority:2,
   flag:"Buffer build? 210% of consensus",flag_type:"buffer_build"},
  {id:"SO-44023",po:"PO-662104",sold_to:"CUST-03388",customer:"Amazon",
   sku:"SKU-5502",desc:"CESAR Chicken & Beef Variety Wet 24ct",
   qty:2800,mabd:"2026-06-06",ship_to:"DC-TX-01",priority:3,
   flag:"Aligned to forecast — routine reorder",flag_type:"clean"},
];

// ── AGENT STEPS ─────────────────────────────────────────────────────────────
const STEPS = {
  "SO-44019":{
    supply_planning:[
      {action:"tool_call",tool:"get_finished_goods_inventory",result:"SKU-1188 @ DC-TX-01: 4,200 cs on hand"},
      {action:"tool_call",tool:"get_production_schedule",result:"PRO-7781 end 2026-05-30 · 82% adherence — at risk"},
      {action:"tool_call",tool:"get_raw_material_availability",result:"Chicken meal: 7 days of supply, single-sourced"},
      {action:"tool_call",tool:"get_procurement_status",result:"1 inbound PO due before run · components adequate"},
      {action:"response",tool:"signal",result:"CAUTION — 4,200 cs available; 1,800 cs gap if PRO-7781 slips"},
    ],
    demand_planning:[
      {action:"tool_call",tool:"get_consensus_forecast",result:"4-week plan: 3,800 cs · order +58% above plan"},
      {action:"tool_call",tool:"get_historical_order_pattern",result:"12-wk avg 920 cs/wk — no prior spike of this size"},
      {action:"tool_call",tool:"get_customer_promo_calendar",result:"No active Walmart promo on SKU-1188 found"},
      {action:"tool_call",tool:"get_forecast_accuracy",result:"WMAPE 18.5% · bias -6.0% · SYSTEMATIC_UNDER flag"},
      {action:"response",tool:"signal",result:"CAUTION — 58% above forecast, no promo driver, plan quality flagged"},
    ],
    transportation:[
      {action:"tool_call",tool:"get_lane_performance",result:"DC-TX-01 to Walmart SE: 38hr avg · 91% OTP · 64 shipments"},
      {action:"tool_call",tool:"get_carrier_reliability",result:"J.B. Hunt · 97.2% OTP vs 95% target · meets target"},
      {action:"tool_call",tool:"get_chargeback_exposure",result:"$24,500 total exposure · $18K posted · $6.5K disputed"},
      {action:"tool_call",tool:"get_customer_otif_position",result:"Walmart OTIF: 88% trailing vs 95% target · -7 pp delta"},
      {action:"response",tool:"signal",result:"PROCEED — Lane viable, carrier meets target, MABD achievable today"},
    ],
    retail_intelligence:[
      {action:"tool_call",tool:"get_pos_data",result:"Walmart POS velocity +44% WoW · 91,000 units latest week"},
      {action:"tool_call",tool:"get_retailer_inventory_position",result:"Walmart DC OHI: 8d supply vs 22d normal — depleted"},
      {action:"tool_call",tool:"get_competitive_shelf_data",result:"Competitor OOS in 3/5 sampled stores — category surge"},
      {action:"tool_call",tool:"get_acv_distribution",result:"SKU-1188 ACV distribution: 78% — healthy coverage"},
      {action:"response",tool:"signal",result:"PROCEED — GENUINE_PULL confirmed · retailer below safety stock"},
    ],
  },
  "SO-44020":{
    supply_planning:[
      {action:"tool_call",tool:"get_finished_goods_inventory",result:"SKU-2241 @ DC-NJ-02: 5,800 cs · 26.1 days of supply"},
      {action:"tool_call",tool:"get_production_schedule",result:"No active production risk on SKU-2241 next 14 days"},
      {action:"tool_call",tool:"get_procurement_status",result:"No open POs required · components stocked"},
      {action:"response",tool:"signal",result:"PROCEED — 5,800 cs available, well within supply capacity"},
    ],
    demand_planning:[
      {action:"tool_call",tool:"get_consensus_forecast",result:"4-week plan: 1,500 cs/wk · within plan on promo-adjusted basis"},
      {action:"tool_call",tool:"get_customer_promo_calendar",result:"PetSmart CONFIRMED: Wet Food Week June 3-9 · APPROVED"},
      {action:"tool_call",tool:"get_forecast_accuracy",result:"WMAPE 12.4% · bias -1.2% · HEALTHY plan quality"},
      {action:"response",tool:"signal",result:"PROCEED — PROMO_DRIVEN demand, confidence 89%, pre-planned spike"},
    ],
    transportation:[
      {action:"tool_call",tool:"get_lane_performance",result:"DC-NJ-02 to PetSmart: 28hr avg · 96% OTP · 82 shipments"},
      {action:"tool_call",tool:"get_carrier_reliability",result:"Old Dominion Freight · 96.5% OTP vs 95% target · meets target"},
      {action:"tool_call",tool:"get_chargeback_exposure",result:"$4,200 total exposure · 1 chargeback trailing"},
      {action:"tool_call",tool:"get_customer_otif_position",result:"PetSmart OTIF: 96% trailing vs 95% target · +1 pp above"},
      {action:"response",tool:"signal",result:"PROCEED — Full delivery on time, zero OTIF risk"},
    ],
    retail_intelligence:[
      {action:"tool_call",tool:"get_pos_data",result:"POS elevated · 74,000 units · ACCELERATING trend"},
      {action:"tool_call",tool:"get_promo_context",result:"FEATURE_AND_DISPLAY promo · 2,800 cs incremental expected · APPROVED"},
      {action:"tool_call",tool:"get_acv_distribution",result:"SKU-2241 ACV distribution: 82% — strong shelf presence"},
      {action:"response",tool:"signal",result:"PROCEED — PROMO_DRIVEN genuine demand confirmed"},
    ],
  },
  "SO-44021":{
    supply_planning:[
      {action:"tool_call",tool:"get_finished_goods_inventory",result:"SKU-3305 @ DC-FL-04: 1,100 cs · 3.2 days of supply — CRITICAL"},
      {action:"tool_call",tool:"get_production_schedule",result:"PRO-8842 end 2026-06-10 — AFTER June 4 MABD"},
      {action:"tool_call",tool:"get_transfer_feasibility",result:"DC-NJ-02 transfer: 900 cs possible · still 1,200 cs short"},
      {action:"tool_call",tool:"get_procurement_status",result:"2 inbound POs on track · components not the constraint"},
      {action:"response",tool:"signal",result:"HARD BLOCK — STOCKOUT status, 2,100 cs hard shortfall, no path to MABD"},
    ],
    demand_planning:[
      {action:"tool_call",tool:"get_consensus_forecast",result:"4-week plan: 2,800 cs · order 3,200 is +14% within tolerance"},
      {action:"tool_call",tool:"get_forecast_accuracy",result:"WMAPE 14.1% · bias +3.2% · HEALTHY plan quality"},
      {action:"response",tool:"signal",result:"PROCEED — GENUINE_PULL, +14% within tolerance, no escalation needed"},
    ],
    transportation:[
      {action:"tool_call",tool:"get_lane_performance",result:"DC-FL-04 to Chewy: 44hr avg · 84% OTP · 38 shipments"},
      {action:"tool_call",tool:"get_carrier_reliability",result:"Estes Express · 84% OTP vs 95% target · fails target"},
      {action:"tool_call",tool:"get_chargeback_exposure",result:"$57,600 total exposure · $42K posted · $15.6K disputed"},
      {action:"tool_call",tool:"get_customer_otif_position",result:"Chewy OTIF: 81% trailing vs 95% target · -14 pp delta"},
      {action:"response",tool:"signal",result:"CAUTION — Lane viable but $57,600 chargeback risk if late"},
    ],
    retail_intelligence:[
      {action:"tool_call",tool:"get_pos_data",result:"Chewy DTC extrapolation: 52,000 units · FLAT trend"},
      {action:"tool_call",tool:"get_retailer_inventory_position",result:"No direct DC visibility — DTC channel, extrapolated"},
      {action:"tool_call",tool:"get_acv_distribution",result:"SKU-3305 ACV: 64% — partial distribution"},
      {action:"response",tool:"signal",result:"PROCEED — GENUINE_PULL, routine replenishment, limited data noted"},
    ],
  },
  "SO-44022":{
    supply_planning:[
      {action:"tool_call",tool:"get_finished_goods_inventory",result:"SKU-4417 @ DC-CA-03: 6,200 cs · 22.1d supply — fills only 6,200"},
      {action:"tool_call",tool:"get_production_schedule",result:"PRO-9104 end 2026-06-12 · 88% adherence — 3-week OOS post-ship"},
      {action:"tool_call",tool:"get_transfer_feasibility",result:"No surplus at other DCs — cannot supplement CA-03"},
      {action:"response",tool:"signal",result:"HARD BLOCK — Fulfilling 8,000 cs causes 3-week OOS; unacceptable"},
    ],
    demand_planning:[
      {action:"tool_call",tool:"get_consensus_forecast",result:"4-week plan: 3,800 cs · order 8,000 is 210% of consensus"},
      {action:"tool_call",tool:"get_customer_promo_calendar",result:"No Target promo found for SKU-4417 in June window"},
      {action:"tool_call",tool:"get_forecast_accuracy",result:"WMAPE 21.3% · bias +8.4% · SYSTEMATIC_OVER flag"},
      {action:"tool_call",tool:"get_historical_order_pattern",result:"Target pattern: 3 of last 4 quarters had above-plan spikes without promo"},
      {action:"response",tool:"signal",result:"BLOCK — BUFFER_BUILD classification, 210% of plan, escalation recommended"},
    ],
    transportation:[
      {action:"tool_call",tool:"get_lane_performance",result:"DC-CA-03 to Target: 52hr avg · 78% OTP · 45 shipments · cap 6,500 cs"},
      {action:"tool_call",tool:"get_carrier_reliability",result:"XPO Logistics · 78% OTP vs 92% target · significantly fails target"},
      {action:"tool_call",tool:"get_chargeback_exposure",result:"$89,400 total exposure · $67K posted · $22.4K disputed"},
      {action:"tool_call",tool:"get_customer_otif_position",result:"Target OTIF: 79% trailing vs 92% target · -13 pp delta"},
      {action:"response",tool:"signal",result:"CAUTION — Lane cap 6,500 cs (8,000 unshippable), carrier underperforming"},
    ],
    retail_intelligence:[
      {action:"tool_call",tool:"get_pos_data",result:"Target POS velocity: 48,000 units · FLAT for 6 consecutive weeks"},
      {action:"tool_call",tool:"get_retailer_inventory_position",result:"Target DC OHI: 28d supply vs 22d normal — already overstocked"},
      {action:"tool_call",tool:"get_acv_distribution",result:"SKU-4417 ACV: 71% · stable, no new distribution gains"},
      {action:"response",tool:"signal",result:"BLOCK — BUFFER_BUILD: flat POS + elevated OHI + 210% order = textbook pattern"},
    ],
  },
  "SO-44023":{
    supply_planning:[
      {action:"tool_call",tool:"get_finished_goods_inventory",result:"SKU-5502 @ DC-TX-01: 4,800 cs on hand — 24.6 days of supply"},
      {action:"tool_call",tool:"get_production_schedule",result:"No active production run required — FG fully stocked"},
      {action:"tool_call",tool:"get_raw_material_availability",result:"All components in stock — no constraint flagged"},
      {action:"response",tool:"signal",result:"PROCEED — 4,800 cs available; order of 2,800 cs fully coverable with no impact to safety stock"},
    ],
    demand_planning:[
      {action:"tool_call",tool:"get_consensus_forecast",result:"4-week plan: 2,900 cs — order within plan at 97% of forecast"},
      {action:"tool_call",tool:"get_historical_order_pattern",result:"Amazon reorders CESAR Variety every 5–6 weeks — this cadence matches"},
      {action:"tool_call",tool:"get_customer_promo_calendar",result:"No active promo — standard replenishment order"},
      {action:"tool_call",tool:"get_forecast_accuracy",result:"WMAPE 11.2% — HEALTHY accuracy; bias -0.8%, no systematic issue"},
      {action:"response",tool:"signal",result:"PROCEED — order aligned to forecast, healthy accuracy, routine cadence confirmed"},
    ],
    transportation:[
      {action:"tool_call",tool:"get_lane_performance",result:"DC-TX-01 to Amazon FC-DFW: 22hr avg · 98.1% OTP · 112 shipments"},
      {action:"tool_call",tool:"get_carrier_reliability",result:"UPS Freight · 98.1% OTP vs 95% target · well above threshold"},
      {action:"tool_call",tool:"get_chargeback_exposure",result:"Amazon OTIF: $0 pending chargebacks — clean account"},
      {action:"tool_call",tool:"get_customer_otif_position",result:"Amazon OTIF 98.4% trailing vs 97% target · +1.4 pp above target"},
      {action:"response",tool:"signal",result:"PROCEED — preferred high-frequency lane, carrier exceeds target, zero chargeback exposure"},
    ],
    retail_intelligence:[
      {action:"tool_call",tool:"get_pos_data",result:"CESAR Variety Amazon POS: +6% WoW · stable, healthy velocity"},
      {action:"tool_call",tool:"get_retailer_inventory_position",result:"Amazon OHI 18 days vs 21-day norm — lean, consistent with genuine reorder"},
      {action:"tool_call",tool:"get_classification_model",result:"GENUINE_PULL · confidence 0.94 · OHI lean, POS healthy, no promo distortion"},
      {action:"response",tool:"signal",result:"PROCEED — GENUINE_PULL confirmed at 94% confidence; no buffer-build signal"},
    ],
  },
};

// ── SYNTHESIS (with full spec-matching signal payloads) ───────────────────
const SYNTHESIS = {
  "SO-44019":{
    forecast_classification:"ABOVE_FORECAST",above_forecast_pct:0.58,plan_qty:3800,
    signals:{
      supply_planning:{
        disposition:"CAUTION",confidence:0.78,hard_block:false,
        summary:"FG covers 70%; gap closes only if PRO-7781 completes on plan. Raw material single-sourced adds risk.",
        evidence:[{tool:"get_finished_goods_inventory",finding:"4,200 cs on hand vs 6,000 ordered",point:"1,800 cs shortfall"},
                  {tool:"get_production_schedule",finding:"PRO-7781 at 82% adherence",point:"Run completion uncertain"}],
        full_signal:{
          fg_position:{inventory_cs:4200,committed_cs:1800,available_cs:2400,days_of_supply:9.5,projection_status:"BELOW_SS",short_by_cs:1800},
          production_order_risk:{upcoming_runs:2,pro_number:"PRO-7781",pro_end_date:"2026-05-30",
            pro_status:"REL",plan_adherence_pct:82.0,risk_summary:"Recent runs of this SKU averaged 82% plan adherence."},
          raw_material_signal:{directional_concern:false,rationale:"Chicken meal: 7 days supply — single sourced"},
          procurement_signal:{open_pos:1,rationale:"One inbound PO due before the run"},
          shelf_life_note:"Batch shelf life adequate; reported for information only",
        },
      },
      demand_planning:{
        disposition:"CAUTION",confidence:0.82,hard_block:false,
        summary:"58% above 4-week consensus; no promo driver found. Forecast showing systematic under-bias.",
        evidence:[{tool:"get_consensus_forecast",finding:"Plan 3,800 cs — order 58% above",point:"2,200 cs uplift unplanned"},
                  {tool:"get_customer_promo_calendar",finding:"No promo on record",point:"Spike unexplained"}],
        full_signal:{
          above_forecast_pct:0.58,
          consensus_plan_qty_cases:3800,
          above_forecast_classification:"ONE_OFF_ANOMALY",
          classification_confidence:0.72,
          classification_basis:["No promotional event found in the delivery window","Order 58% above 4-week rolling consensus","Historical pattern shows no comparable unplanned spikes"],
          forecast_accuracy_signal:{trailing_wmape_pct:18.5,trailing_bias_pct:-6.0,plan_quality_flag:"SYSTEMATIC_UNDER"},
          promo_attributed:false,
          demand_team_escalation_recommended:false,
          demand_team_escalation_reason:null,
        },
      },
      transportation:{
        disposition:"PROCEED",confidence:0.91,hard_block:false,
        summary:"Lane open; J.B. Hunt 97.2% OTP; MABD achievable if shipped today.",
        evidence:[{tool:"get_carrier_reliability",finding:"J.B. Hunt 97.2% OTP vs 95% target",point:"No delivery risk"},
                  {tool:"get_customer_otif_position",finding:"Walmart OTIF 88% vs 95% target",point:"-7 pp to target — protect OTIF"}],
        full_signal:{
          primary_lane:{origin_plant:"PLT-TX-01",destination_region:"Southeast",avg_transit_hours:38.0,
            on_time_arrival_pct:0.91,shipment_count:64,viable:true,notes:"Lane reliably hits 2-day delivery window"},
          carrier_options:[{carrier_name:"J.B. Hunt",carrier_number:"CAR-11",trailing_otp_pct:0.972,
            contracted_otp_target:0.95,meets_target:true}],
          chargeback_exposure:{trailing_chargeback_count:3,total_chargeback_usd:24500,
            posted_usd:18000,disputed_usd:6500,top_chargeback_types:["LATE_DELIVERY","FILL_RATE"]},
          customer_otif_position:{trailing_otif_pct:0.88,customer_otif_target_pct:0.95,delta_to_target_pct:-7.0},
          active_alert_count:2,
        },
      },
      retail_intelligence:{
        disposition:"PROCEED",confidence:0.87,hard_block:false,
        summary:"POS +44% WoW; Walmart OHI at 8d vs 22d norm. Competitor OOS confirms genuine category pull.",
        evidence:[{tool:"get_pos_data",finding:"Consumer velocity +44% WoW — 91,000 units",point:"Genuine demand acceleration"},
                  {tool:"get_retailer_inventory_position",finding:"Walmart DC: 8d supply vs 22d norm",point:"Retailer genuinely depleted"}],
        full_signal:{
          pull_vs_buffer_classification:"GENUINE_PULL",
          classification_confidence:0.87,
          classification_basis:["POS velocity +44% WoW — consumer demand accelerating","Walmart DC OHI at 8d vs 22d normal — retailer depleted","Competitor OOS in 3/5 sampled stores — category demand surge"],
          consumer_takeaway:{trailing_weeks_observed:8,latest_pos_units:91000,takeaway_trend:"ACCELERATING",
            avg_distribution_pct_acv:78.0,promo_active_in_window:false},
          promotional_context:{active_or_upcoming_promo:false,promo_type:null,expected_incremental_quantity:0,promo_status:null},
          data_gaps:["No store-level inventory feed available"],
        },
      },
    },
    conflicts:[{type:"DISPOSITION_DIVERGENCE",disputants:["supply_planning","demand_planning"],
      summary:"Supply & Demand cautious on availability and forecast gap; Transport & Retail see genuine demand and no blocker.",
      debate_rounds:1,resolution:"RESOLVED"}],
    rec:{action:"PARTIAL_FULFILL",qty:5100,fill_pct:85.0,confidence:0.84,
      outcome:"Ships 5,100 cs on time protecting OTIF score; backorders 900 cs. Genuine POS demand makes the backorder low-risk.",
      alternatives:[{label:"Full fulfill — 2 days late",qty:6000,outcome:"Meets quantity; risks OTIF chargeback."},
                    {label:"FG-only ship — no backorder",qty:4200,outcome:"Zero backorder risk; leaves 1,800 cs unmet."}]},
    chain:{drivers:["supply_planning","retail_intelligence"],
      tradeoffs:["Full quantity vs. on-time delivery","Backorder risk vs. OTIF penalty exposure"],
      flip:"If PRO-7781 completes above 95% adherence by May 30, full fulfillment on time becomes viable."},
    escalations:{supply_planning_team:{summary:"PRO-7781 adherence at 82% — confirm staffing for 2026-05-30 run.",severity:"MEDIUM",
      action:"Confirm production run staffing and raw material availability for PRO-7781."}},
  },

  "SO-44020":{
    forecast_classification:"WITHIN_FORECAST",plan_qty:4500,
    signals:{
      supply_planning:{
        disposition:"PROCEED",confidence:0.93,hard_block:false,
        summary:"5,800 cs available at DC-NJ-02; order well within supply capacity. No production risk.",
        evidence:[{tool:"get_finished_goods_inventory",finding:"5,800 cs FG available — 26.1 days of supply",point:"Sufficient inventory, no risk"}],
        full_signal:{
          fg_position:{inventory_cs:5800,committed_cs:800,available_cs:5000,days_of_supply:26.1,projection_status:"OK",short_by_cs:0},
          production_order_risk:{upcoming_runs:1,pro_number:null,pro_end_date:null,
            pro_status:"TECO",plan_adherence_pct:96.0,risk_summary:"No active production risk for SKU-2241"},
          raw_material_signal:{directional_concern:false,rationale:"All components in stock — no constraint"},
          procurement_signal:{open_pos:0,rationale:"No open POs required"},
          shelf_life_note:"Shelf life adequate; no issue",
        },
      },
      demand_planning:{
        disposition:"PROCEED",confidence:0.89,hard_block:false,
        summary:"PetSmart Wet Food Week June 3-9 confirmed in planning system. Spike is pre-planned and budgeted.",
        evidence:[{tool:"get_customer_promo_calendar",finding:"Wet Food Week June 3-9 confirmed — APPROVED",point:"Promo-backed demand"},
                  {tool:"get_forecast_accuracy",finding:"WMAPE 12.4% — healthy accuracy",point:"Forecast quality HEALTHY"}],
        full_signal:{
          above_forecast_pct:0.0,
          consensus_plan_qty_cases:4500,
          above_forecast_classification:"PROMO_DRIVEN",
          classification_confidence:0.89,
          classification_basis:["PetSmart Wet Food Week promo confirmed in planning system","Order size consistent with prior promo-period volumes","Consumer velocity accelerating ahead of promo window"],
          forecast_accuracy_signal:{trailing_wmape_pct:12.4,trailing_bias_pct:-1.2,plan_quality_flag:"HEALTHY"},
          promo_attributed:true,
          demand_team_escalation_recommended:false,
          demand_team_escalation_reason:null,
        },
      },
      transportation:{
        disposition:"PROCEED",confidence:0.95,hard_block:false,
        summary:"DC-NJ-02 lane open; Old Dominion 96.5% OTP; delivery by June 5 fully achievable.",
        evidence:[{tool:"get_carrier_reliability",finding:"Old Dominion 96.5% OTP vs 95% target",point:"Carrier meets target"},
                  {tool:"get_customer_otif_position",finding:"PetSmart OTIF 96% vs 95% target",point:"+1 pp above target — strong position"}],
        full_signal:{
          primary_lane:{origin_plant:"PLT-NJ-02",destination_region:"Northeast",avg_transit_hours:28.0,
            on_time_arrival_pct:0.96,shipment_count:82,viable:true,notes:"High-frequency lane with strong reliability"},
          carrier_options:[{carrier_name:"Old Dominion Freight",carrier_number:"CAR-22",trailing_otp_pct:0.965,
            contracted_otp_target:0.95,meets_target:true}],
          chargeback_exposure:{trailing_chargeback_count:1,total_chargeback_usd:4200,
            posted_usd:4200,disputed_usd:0,top_chargeback_types:["FILL_RATE"]},
          customer_otif_position:{trailing_otif_pct:0.96,customer_otif_target_pct:0.95,delta_to_target_pct:1.0},
          active_alert_count:0,
        },
      },
      retail_intelligence:{
        disposition:"PROCEED",confidence:0.88,hard_block:false,
        summary:"POS elevated and consistent with prior promo patterns. FEATURE_AND_DISPLAY promo approved. Genuine pull.",
        evidence:[{tool:"get_pos_data",finding:"POS elevated — promo-consistent pattern",point:"Consumer demand genuine"},
                  {tool:"get_promo_context",finding:"F&D promo APPROVED · 2,800 cs incremental expected",point:"Promo confirmed"}],
        full_signal:{
          pull_vs_buffer_classification:"PROMO_DRIVEN",
          classification_confidence:0.88,
          classification_basis:["PetSmart Wet Food Week promo confirmed and approved","POS velocity accelerating ahead of promo window","Order volume consistent with prior promotional period history"],
          consumer_takeaway:{trailing_weeks_observed:8,latest_pos_units:74000,takeaway_trend:"ACCELERATING",
            avg_distribution_pct_acv:82.0,promo_active_in_window:true},
          promotional_context:{active_or_upcoming_promo:true,promo_type:"FEATURE_AND_DISPLAY",
            expected_incremental_quantity:2800,promo_status:"APPROVED"},
          data_gaps:[],
        },
      },
    },
    conflicts:[],
    rec:{action:"ACCEPT",qty:4500,fill_pct:100,confidence:0.92,
      outcome:"Full 4,500 cs shipped on time. Promo event fully supported. OTIF and fill rate both protected.",alternatives:[]},
    chain:{drivers:["demand_planning","retail_intelligence"],tradeoffs:[],
      flip:"If PetSmart cancels the promo, re-evaluate for potential buffer-build risk."},
    escalations:{},
  },

  "SO-44021":{
    forecast_classification:"WITHIN_FORECAST",plan_qty:2800,
    signals:{
      supply_planning:{
        disposition:"BLOCK",confidence:0.97,hard_block:true,
        summary:"DC-FL-04 has 1,100 cs; next production run June 10 — after MABD. 2,100 cs hard shortfall with no mitigation path.",
        evidence:[{tool:"get_finished_goods_inventory",finding:"1,100 cs at DC-FL-04 vs 3,200 ordered",point:"2,100 cs hard shortfall"},
                  {tool:"get_production_schedule",finding:"PRO-8842 ends June 10 — after June 4 MABD",point:"Production cannot save MABD"}],
        full_signal:{
          fg_position:{inventory_cs:1100,committed_cs:600,available_cs:500,days_of_supply:3.2,projection_status:"STOCKOUT",short_by_cs:2100},
          production_order_risk:{upcoming_runs:1,pro_number:"PRO-8842",pro_end_date:"2026-06-10",
            pro_status:"REL",plan_adherence_pct:91.0,risk_summary:"Run is on-plan but completes after MABD — does not resolve the constraint"},
          raw_material_signal:{directional_concern:false,rationale:"Components stocked — production material not the issue"},
          procurement_signal:{open_pos:2,rationale:"Two inbound POs on track; not constraining"},
          shelf_life_note:"Shelf life adequate for available stock",
        },
      },
      demand_planning:{
        disposition:"PROCEED",confidence:0.81,hard_block:false,
        summary:"Order within 14% of 4-week plan — routine replenishment. Demand is genuine. No escalation needed.",
        evidence:[{tool:"get_consensus_forecast",finding:"Plan 2,800 cs; order 3,200 (+14%)",point:"Within tolerance"},
                  {tool:"get_forecast_accuracy",finding:"WMAPE 14.1% — healthy quality",point:"Forecast reliable"}],
        full_signal:{
          above_forecast_pct:0.14,
          consensus_plan_qty_cases:2800,
          above_forecast_classification:"GENUINE_PULL",
          classification_confidence:0.81,
          classification_basis:["Order within 14% of 4-week consensus — within tolerance","No abnormal ordering pattern detected for this customer","Routine replenishment cycle consistent with historical cadence"],
          forecast_accuracy_signal:{trailing_wmape_pct:14.1,trailing_bias_pct:3.2,plan_quality_flag:"HEALTHY"},
          promo_attributed:false,
          demand_team_escalation_recommended:false,
          demand_team_escalation_reason:null,
        },
      },
      transportation:{
        disposition:"CAUTION",confidence:0.72,hard_block:false,
        summary:"Lane is feasible but Chewy OTIF penalty of $18/cs creates $57,600 max exposure on late delivery.",
        evidence:[{tool:"get_chargeback_exposure",finding:"$57,600 total exposure if late",point:"Material penalty risk"},
                  {tool:"get_customer_otif_position",finding:"Chewy OTIF 81% vs 95% target",point:"-14 pp to target — already at risk"}],
        full_signal:{
          primary_lane:{origin_plant:"PLT-FL-04",destination_region:"Southeast",avg_transit_hours:44.0,
            on_time_arrival_pct:0.84,shipment_count:38,viable:true,notes:"Lane viable but OTP below benchmark"},
          carrier_options:[{carrier_name:"Estes Express",carrier_number:"CAR-34",trailing_otp_pct:0.84,
            contracted_otp_target:0.95,meets_target:false}],
          chargeback_exposure:{trailing_chargeback_count:5,total_chargeback_usd:57600,
            posted_usd:42000,disputed_usd:15600,top_chargeback_types:["LATE_DELIVERY"]},
          customer_otif_position:{trailing_otif_pct:0.81,customer_otif_target_pct:0.95,delta_to_target_pct:-14.0},
          active_alert_count:3,
        },
      },
      retail_intelligence:{
        disposition:"PROCEED",confidence:0.85,hard_block:false,
        summary:"POS velocity stable — routine replenishment demand. No buffer-build indicators. Limited DTC visibility noted.",
        evidence:[{tool:"get_pos_data",finding:"Chewy DTC extrapolation: 52,000 units, FLAT",point:"Routine demand, no anomaly"},
                  {tool:"get_acv_distribution",finding:"SKU-3305 ACV 64% — partial distribution",point:"Stable, not expanding"}],
        full_signal:{
          pull_vs_buffer_classification:"GENUINE_PULL",
          classification_confidence:0.85,
          classification_basis:["POS velocity stable and consistent with plan","No retailer OHI elevation detectable","Routine replenishment order cadence — no pattern anomaly"],
          consumer_takeaway:{trailing_weeks_observed:8,latest_pos_units:52000,takeaway_trend:"FLAT",
            avg_distribution_pct_acv:64.0,promo_active_in_window:false},
          promotional_context:{active_or_upcoming_promo:false,promo_type:null,expected_incremental_quantity:0,promo_status:null},
          data_gaps:["Chewy is DTC — POS data extrapolated from market share; store-level feed unavailable"],
        },
      },
    },
    conflicts:[{type:"HARD_BLOCK",disputants:["supply_planning"],
      summary:"Supply Planning hard block: physical inventory cannot meet MABD. Hard block is decisive — debate not applicable.",
      debate_rounds:0,resolution:"UNRESOLVED"}],
    rec:{action:"DEFER",qty:2000,fill_pct:62.5,confidence:0.91,
      outcome:"Ship 2,000 cs (DC-FL-04 stock + DC-NJ-02 transfer) now; defer 1,200 cs to post-June 10 production. Negotiate MABD extension with Chewy to avoid the $18/cs penalty.",
      alternatives:[{label:"Partial ship 2,000 cs — confirm backorder",qty:2000,outcome:"Avoids penalty if Chewy accepts extension; confirms supply intent."}]},
    chain:{drivers:["supply_planning","transportation"],
      tradeoffs:["Supply hard block overrides all other signals","Penalty exposure requires Chewy negotiation"],
      flip:"MABD extension from Chewy, or emergency DC-NJ-02 transfer approval of 1,200+ cs."},
    escalations:{supply_planning_team:{summary:"SKU-3305 critically low at DC-FL-04 — emergency transfer and expedited June 10 run needed.",severity:"HIGH",
      action:"Approve DC-to-DC transfer of 900 cs from DC-NJ-02 immediately; lock June 10 production slot."}},
  },

  "SO-44022":{
    forecast_classification:"ABOVE_FORECAST",above_forecast_pct:1.10,plan_qty:3800,
    signals:{
      supply_planning:{
        disposition:"BLOCK",confidence:0.94,hard_block:true,
        summary:"Fulfilling 8,000 cs depletes DC-CA-03 and causes 3-week OOS for all West Coast customers.",
        evidence:[{tool:"get_finished_goods_inventory",finding:"6,200 cs available; 8,000 cs requested",point:"3-week OOS if fulfilled"},
                  {tool:"get_production_schedule",finding:"PRO-9104 end June 12 — 3-week gap",point:"Unacceptable multi-customer OOS risk"}],
        full_signal:{
          fg_position:{inventory_cs:6200,committed_cs:1200,available_cs:5000,days_of_supply:22.1,projection_status:"BELOW_SS",short_by_cs:1800},
          production_order_risk:{upcoming_runs:1,pro_number:"PRO-9104",pro_end_date:"2026-06-12",
            pro_status:"REL",plan_adherence_pct:88.0,risk_summary:"Run on-plan but post-fulfillment gap would be 3 weeks"},
          raw_material_signal:{directional_concern:false,rationale:"Components stocked — supply constraint is FG only"},
          procurement_signal:{open_pos:0,rationale:"No open POs — not a factor"},
          shelf_life_note:"Shelf life adequate; not a factor",
        },
      },
      demand_planning:{
        disposition:"BLOCK",confidence:0.88,hard_block:false,
        summary:"210% of consensus with no promo justification — classic buffer-build pattern. Escalation to demand team recommended.",
        evidence:[{tool:"get_consensus_forecast",finding:"Plan 3,800 cs; order 8,000 cs (210%)",point:"No promo justification found"},
                  {tool:"get_historical_order_pattern",finding:"3 of 4 prior quarters: above-plan spikes without promo",point:"Repeat buffer-build pattern"}],
        full_signal:{
          above_forecast_pct:1.10,
          consensus_plan_qty_cases:3800,
          above_forecast_classification:"BUFFER_BUILD",
          classification_confidence:0.88,
          classification_basis:["Order at 210% of 4-week consensus with no promotional event","Historical pattern: 3 of last 4 quarters show unexplained above-plan orders from Target","POS data does not support consumer demand at this level"],
          forecast_accuracy_signal:{trailing_wmape_pct:21.3,trailing_bias_pct:8.4,plan_quality_flag:"SYSTEMATIC_OVER"},
          promo_attributed:false,
          demand_team_escalation_recommended:true,
          demand_team_escalation_reason:"Repeat buffer-build pattern from Target warrants joint business plan review and ordering guardrails discussion",
        },
      },
      transportation:{
        disposition:"CAUTION",confidence:0.76,hard_block:false,
        summary:"Lane capacity hard ceiling at 6,500 cs — 8,000 cs is physically unshippable. XPO significantly underperforming.",
        evidence:[{tool:"get_lane_performance",finding:"DC-CA-03 lane max 6,500 cs — 8,000 unshippable",point:"Volume physically impossible"},
                  {tool:"get_customer_otif_position",finding:"Target OTIF 79% vs 92% target",point:"-13 pp to target — already critical"}],
        full_signal:{
          primary_lane:{origin_plant:"PLT-CA-03",destination_region:"West",avg_transit_hours:52.0,
            on_time_arrival_pct:0.78,shipment_count:45,viable:false,notes:"Lane cap at 6,500 cs — 8,000 cs physically impossible"},
          carrier_options:[{carrier_name:"XPO Logistics",carrier_number:"CAR-47",trailing_otp_pct:0.78,
            contracted_otp_target:0.92,meets_target:false}],
          chargeback_exposure:{trailing_chargeback_count:8,total_chargeback_usd:89400,
            posted_usd:67000,disputed_usd:22400,top_chargeback_types:["LATE_DELIVERY","FILL_RATE","LABEL_ERROR"]},
          customer_otif_position:{trailing_otif_pct:0.79,customer_otif_target_pct:0.92,delta_to_target_pct:-13.0},
          active_alert_count:4,
        },
      },
      retail_intelligence:{
        disposition:"BLOCK",confidence:0.91,hard_block:false,
        summary:"POS flat for 6 weeks; Target DC at 28d supply vs 22d norm. Textbook buffer-build pattern confirmed.",
        evidence:[{tool:"get_pos_data",finding:"POS flat for 6 consecutive weeks — no consumer acceleration",point:"Consumer not pulling"},
                  {tool:"get_retailer_inventory_position",finding:"Target DC OHI: 28d supply vs 22d norm",point:"Already overstocked"}],
        full_signal:{
          pull_vs_buffer_classification:"BUFFER_BUILD",
          classification_confidence:0.91,
          classification_basis:["POS velocity flat for 6 consecutive weeks — no consumer acceleration","Target DC OHI at 28d vs 22d normal — retailer is overstocked","Order at 210% of consensus with flat POS = inventory accumulation, not pull"],
          consumer_takeaway:{trailing_weeks_observed:8,latest_pos_units:48000,takeaway_trend:"FLAT",
            avg_distribution_pct_acv:71.0,promo_active_in_window:false},
          promotional_context:{active_or_upcoming_promo:false,promo_type:null,expected_incremental_quantity:0,promo_status:null},
          data_gaps:[],
        },
      },
    },
    conflicts:[{type:"HARD_BLOCK",disputants:["supply_planning","demand_planning","retail_intelligence"],
      summary:"Three of four agents signal block; consensus is clear. No debate needed.",
      debate_rounds:0,resolution:"RESOLVED"}],
    rec:{action:"REJECT",qty:0,fill_pct:0,confidence:0.93,
      outcome:"Order rejected. Counter-offer: 3,800 cs at consensus plan qty, with re-order option post-June 12 production run.",
      alternatives:[{label:"Counter-offer: 3,800 cs consensus qty",qty:3800,outcome:"Protects DC-CA-03; meets genuine demand only."}]},
    chain:{drivers:["supply_planning","retail_intelligence","demand_planning"],
      tradeoffs:["Protecting multi-customer DC vs. single retailer volume","OTIF risk on West Coast accounts if DC-CA-03 depleted"],
      flip:"Verified Target promo event with POS acceleration would open partial fill discussion."},
    escalations:{demand_planning_team:{summary:"Target repeat above-forecast ordering without promo — flag for JBP review.",severity:"MEDIUM",
      action:"Schedule Target JBP review Q3 to align forecast and ordering behavior."}},
  },
  "SO-44023":{
    forecast_classification:"WITHIN_FORECAST",plan_qty:2900,
    signals:{
      supply_planning:{
        disposition:"PROCEED",confidence:0.97,hard_block:false,
        summary:"4,800 cs on hand at DC-TX-01; 2,800 cs order leaves healthy surplus above safety stock. Zero risk.",
        evidence:[{tool:"get_finished_goods_inventory",finding:"4,800 cs FG available — 24.6 days of supply",point:"Well above safety stock threshold"}],
        full_signal:{
          fg_position:{inventory_cs:4800,committed_cs:400,available_cs:4400,days_of_supply:24.6,projection_status:"OK",short_by_cs:0},
          production_order_risk:{upcoming_runs:0,pro_number:null,pro_end_date:null,
            pro_status:"TECO",plan_adherence_pct:99.0,risk_summary:"No production risk — FG fully stocked"},
          raw_material_signal:{directional_concern:false,rationale:"All components in stock — no constraint"},
          procurement_signal:{open_pos:0,rationale:"No open POs required"},
          shelf_life_note:"Shelf life adequate; no issue",
        },
      },
      demand_planning:{
        disposition:"PROCEED",confidence:0.95,hard_block:false,
        summary:"Order at 97% of 4-week consensus. WMAPE 11.2% — healthy accuracy. Routine Amazon replenishment cadence confirmed.",
        evidence:[{tool:"get_consensus_forecast",finding:"Plan 2,900 cs — order 97% of plan",point:"Within forecast"},
                  {tool:"get_forecast_accuracy",finding:"WMAPE 11.2% — HEALTHY",point:"High-confidence forecast base"}],
        full_signal:{
          above_forecast_pct:0.0,
          consensus_plan_qty_cases:2900,
          above_forecast_classification:"GENUINE_PULL",
          classification_confidence:0.95,
          classification_basis:["Order within 3% of 4-week consensus plan","Consistent 5-6 week reorder cadence confirmed","WMAPE 11.2% — reliable forecast base"],
          forecast_accuracy_signal:{trailing_wmape_pct:11.2,trailing_bias_pct:-0.8,plan_quality_flag:"HEALTHY"},
          promo_attributed:false,
          demand_team_escalation_recommended:false,
          demand_team_escalation_reason:null,
        },
      },
      transportation:{
        disposition:"PROCEED",confidence:0.98,hard_block:false,
        summary:"High-frequency lane to Amazon FC-DFW; UPS Freight 98.1% OTP — top carrier in network. Zero chargeback exposure.",
        evidence:[{tool:"get_carrier_reliability",finding:"UPS Freight 98.1% OTP vs 95% target",point:"Best carrier in network"},
                  {tool:"get_customer_otif_position",finding:"Amazon OTIF 98.4% vs 97% target",point:"+1.4 pp above target"}],
        full_signal:{
          primary_lane:{origin_plant:"PLT-TX-01",destination_region:"DFW",avg_transit_hours:22.0,
            on_time_arrival_pct:0.981,shipment_count:112,viable:true,notes:"Best-performing lane in the network"},
          carrier_options:[{carrier_name:"UPS Freight",carrier_number:"CAR-08",trailing_otp_pct:0.981,
            contracted_otp_target:0.95,meets_target:true,risk:"LOW"}],
          chargeback_exposure:{total_chargeback_usd:0,posted_usd:0,disputed_usd:0,top_chargeback_types:[]},
          customer_otif_position:{trailing_otif_pct:0.984,customer_otif_target_pct:0.97,delta_to_target_pct:0.014},
          active_alert_count:0,
        },
      },
      retail_intelligence:{
        disposition:"PROCEED",confidence:0.94,hard_block:false,
        summary:"GENUINE_PULL confirmed at 94% confidence. Amazon OHI lean at 18 days vs 21-day norm. Healthy POS velocity, no buffer-build signal.",
        evidence:[{tool:"get_classification_model",finding:"GENUINE_PULL · confidence 0.94",point:"Consumer demand confirmed"},
                  {tool:"get_retailer_inventory_position",finding:"OHI 18d vs 21d norm — lean",point:"Retailer genuinely needs stock"}],
        full_signal:{
          pull_vs_buffer_classification:"GENUINE_PULL",
          classification_confidence:0.94,
          classification_basis:["OHI lean — 18d vs 21d norm","POS velocity stable and healthy at +6% WoW","No promotional distortion","Reorder cadence consistent with history"],
          consumer_takeaway:{latest_pos_units:14200,takeaway_trend:"FLAT",avg_distribution_pct_acv:82.0,promo_active_in_window:false},
          promotional_context:{promo_type:null,expected_incremental_quantity:0,promo_status:"NONE"},
          data_gaps:[],
        },
      },
    },
    conflicts:[],
    rec:{action:"ACCEPT",qty:2800,fill_pct:100,confidence:0.96,
      outcome:"Full 2,800 cs shipped on time. All four agents aligned — no risk. Routine processing recommended.",
      alternatives:[]},
    chain:{drivers:["supply_planning","transportation"],tradeoffs:[],
      flip:"No conditions identified that would change this recommendation."},
    escalations:{},
  },
};

// ── WATCHTOWER DATA ──────────────────────────────────────────────────────────
const WATCHTOWER_DATA = {
  kpis:[
    {label:"OTIF Score",value:"94.2%",delta:"+0.3 pp",up:true,target:"95.0%"},
    {label:"Fill Rate",value:"97.8%",delta:"-0.1 pp",up:false,target:"98.0%"},
    {label:"Fines at Risk",value:"$412K",delta:"+$38K",up:false,target:"<$250K"},
    {label:"Open Orders",value:"127",delta:"+12",up:null,target:"--"},
    {label:"Orders in Triage",value:"4",delta:"",up:null,target:"--",alert:true},
    {label:"AI Resolution",value:"8.4 min",delta:"-2.1 min",up:true,target:"<10 min"},
  ],
  alerts:[
    {id:"ALT-001",sev:"HIGH",title:"PEDIGREE 18lb: Supply shortfall at DC-TX-01",detail:"PRO-7781 at 82% adherence — 1,800 cs gap on Walmart SO-44019.",time:"14 min ago"},
    {id:"ALT-002",sev:"HIGH",title:"SHEBA PERFECT PORTIONS: DC-FL-04 critically low",detail:"1,100 cs on hand vs 3,200 ordered. Next production run post-MABD.",time:"31 min ago"},
    {id:"ALT-003",sev:"MEDIUM",title:"Target SO-44022: Buffer build flagged",detail:"210% above-forecast, flat POS, elevated OHI — three agents signal BLOCK.",time:"1 hr ago"},
    {id:"ALT-004",sev:"LOW",title:"DC-TX-01 temperature excursion resolved",detail:"Brief excursion — no product impact confirmed.",time:"3 hr ago"},
  ],
  network:[
    {dc:"DC-TX-01",loc:"Dallas, TX",fill:72,alerts:2,status:"caution"},
    {dc:"DC-NJ-02",loc:"Newark, NJ",fill:88,alerts:0,status:"ok"},
    {dc:"DC-CA-03",loc:"Fresno, CA",fill:91,alerts:1,status:"caution"},
    {dc:"DC-FL-04",loc:"Orlando, FL",fill:34,alerts:2,status:"critical"},
  ],
};
const ROOT_CAUSES = [
  {id:"RC-001",cause:"Production Schedule Adherence",cases:4800,value:"$312K",owner:"Supply Planning",issues:3,sev:"HIGH"},
  {id:"RC-002",cause:"Demand Signal Accuracy",cases:2200,value:"$143K",owner:"Demand Planning",issues:5,sev:"MEDIUM"},
  {id:"RC-003",cause:"DC Inventory Imbalance",cases:1900,value:"$124K",owner:"Supply Planning",issues:2,sev:"MEDIUM"},
  {id:"RC-004",cause:"Carrier Capacity (Peak Periods)",cases:900,value:"$59K",owner:"Transportation",issues:1,sev:"LOW"},
];
const SAFETY_STOCKS = [
  {sku:"SKU-1188",desc:"PEDIGREE Adult Chicken 18lb",current:2100,rec:3200,delta:1100,
   reason:"Forecast error rate +12% YoY; production adherence volatile",
   weekly:[{w:"W1",v:920},{w:"W2",v:980},{w:"W3",v:1050},{w:"W4",v:930},{w:"W5",v:1100},{w:"W6",v:1040},{w:"W7",v:890},{w:"W8",v:1150}]},
  {sku:"SKU-2241",desc:"WHISKAS Tender Bites Tuna 24ct",current:1400,rec:1800,delta:400,
   reason:"Promo frequency increased; co-man lead time +1 day",
   weekly:[{w:"W1",v:440},{w:"W2",v:460},{w:"W3",v:480},{w:"W4",v:1420},{w:"W5",v:470},{w:"W6",v:450},{w:"W7",v:460},{w:"W8",v:440}]},
  {sku:"SKU-3305",desc:"SHEBA PERFECT PORTIONS 72ct",current:1800,rec:2400,delta:600,
   reason:"DC-FL-04 replenishment unreliable; single-DC sourcing",
   weekly:[{w:"W1",v:700},{w:"W2",v:680},{w:"W3",v:710},{w:"W4",v:695},{w:"W5",v:720},{w:"W6",v:700},{w:"W7",v:690},{w:"W8",v:680}]},
  {sku:"SKU-4417",desc:"TEMPTATIONS Classic 16oz 12-pk",current:2800,rec:2800,delta:0,
   reason:"Stable demand, predictable forecast — no change needed",
   weekly:[{w:"W1",v:940},{w:"W2",v:960},{w:"W3",v:950},{w:"W4",v:930},{w:"W5",v:970},{w:"W6",v:945},{w:"W7",v:955},{w:"W8",v:940}]},
];

// ── SHARED UI HELPERS ───────────────────────────────────────────────────────
function Pill({label,color,size=11}){
  return <span style={{background:color,color:"#fff",borderRadius:4,padding:"2px 8px",
    fontSize:size,fontWeight:700,letterSpacing:"0.02em",whiteSpace:"nowrap"}}>{label}</span>;
}
function MiniBar({value,max=100,color}){
  return <div style={{height:5,background:C.border,borderRadius:3,overflow:"hidden"}}>
    <div style={{height:"100%",width:`${Math.min(100,(value/max)*100)}%`,background:color||C.blue,borderRadius:3,transition:"width 0.8s"}}/>
  </div>;
}
function SectionHead({title}){
  return <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em",
    marginBottom:12,paddingBottom:8,borderBottom:`1px solid ${C.border}`}}>{title}</div>;
}
function Blinker(){
  const [t,setT]=useState(0);
  useEffect(()=>{const i=setInterval(()=>setT(x=>(x+1)%4),380);return()=>clearInterval(i);},[]);
  return <span style={{color:C.muted,marginLeft:1}}>{["   ",".  ",".. ","..."][t]}</span>;
}

// ── SIGNAL KPI RENDERING ────────────────────────────────────────────────────
// Status => background/text color
const STATUS = {
  ok:{bg:"#edf7ee",col:C.green},
  warn:{bg:"#fff8e6",col:C.orange},
  bad:{bg:"#fde8ec",col:C.red},
  info:{bg:"#e6f5fb",col:C.blue},
  neutral:{bg:C.off,col:C.charcoal},
};

function KpiChip({label,value,status="neutral"}){
  const s=STATUS[status]||STATUS.neutral;
  return (
    <div style={{background:s.bg,borderRadius:5,padding:"6px 8px",border:`1px solid ${C.border}`}}>
      <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:2,lineHeight:1}}>{label}</div>
      <div style={{fontSize:12,fontWeight:700,color:s.col,lineHeight:1.3}}>{value}</div>
    </div>
  );
}

function KpiGroup({title,chips,cols=2}){
  return (
    <div style={{marginBottom:10}}>
      <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:5,fontWeight:700,
        borderBottom:`1px solid ${C.border}`,paddingBottom:3}}>{title}</div>
      <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:4}}>
        {chips.map((c,i)=><KpiChip key={i} {...c}/>)}
      </div>
    </div>
  );
}

function BasisList({items,color}){
  if(!items||!items.length)return null;
  return (
    <div style={{marginTop:4}}>
      {items.map((b,i)=>(
        <div key={i} style={{fontSize:10,color:C.charcoal,marginBottom:3,paddingLeft:8,
          borderLeft:`2px solid ${color}`,lineHeight:1.4}}>{b}</div>
      ))}
    </div>
  );
}

// ── SIGNAL LINE-ITEM HELPERS ─────────────────────────────────────────────────
// A single labelled metric row — label left, coloured value right
function SigRow({label,value,status="neutral",mono=false}){
  const col={ok:C.green,warn:C.orange,bad:C.red,info:C.blue,neutral:C.charcoal}[status]||C.charcoal;
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",
      padding:"3.5px 0 3.5px 10px",borderBottom:`1px solid ${C.border}`}}>
      <span style={{fontSize:11,color:C.muted,lineHeight:1.4,flexShrink:0,
        marginRight:8}}>{label}</span>
      <span style={{fontSize:11,fontWeight:600,color:col,
        fontFamily:mono?MONO:"inherit",textAlign:"right"}}>{value}</span>
    </div>
  );
}
// A labelled group with an agent-coloured left border
function SigSection({title,color,children}){
  return (
    <div style={{marginBottom:10}}>
      <div style={{fontSize:9,color:color,textTransform:"uppercase",letterSpacing:"0.12em",
        fontWeight:700,marginBottom:3,paddingLeft:8,
        borderLeft:`3px solid ${color}`}}>{title}</div>
      {children}
    </div>
  );
}

function renderSupplySignal(fs,color){
  const fg=fs.fg_position;
  const dosS=fg.days_of_supply>14?"ok":fg.days_of_supply>7?"warn":"bad";
  const projS={OK:"ok",BELOW_SS:"warn",STOCKOUT:"bad"}[fg.projection_status]||"neutral";
  const adhS=fs.production_order_risk.plan_adherence_pct>=95?"ok":fs.production_order_risk.plan_adherence_pct>=85?"warn":"bad";
  const proS={TECO:"ok",REL:"warn",CRTD:"neutral"}[fs.production_order_risk.pro_status]||"neutral";
  return (
    <div>
      <SigSection title="Inventory — Available to Promise" color={color}>
        <SigRow label="On Hand (Total)" value={`${fg.inventory_cs.toLocaleString()} cs`} mono/>
        <SigRow label="Committed — other orders" value={`${(fg.committed_cs||0).toLocaleString()} cs`} status={fg.committed_cs>0?"warn":"ok"} mono/>
        <SigRow label="Avail. to Promise (ATP)" value={`${(fg.available_cs||fg.inventory_cs).toLocaleString()} cs`} status={fg.available_cs===0?"bad":fg.available_cs<500?"warn":"ok"} mono/>
        <SigRow label="Days of Supply" value={`${fg.days_of_supply} d`} status={dosS} mono/>
        <SigRow label="Projection Status" value={fg.projection_status.replace(/_/g," ")} status={projS}/>
        <SigRow label="Short vs ATP" value={fg.short_by_cs>0?`${fg.short_by_cs.toLocaleString()} cs`:"None"} status={fg.short_by_cs>0?"bad":"ok"} mono/>
      </SigSection>
      {fs.production_order_risk.pro_number?(
        <SigSection title="Production Order" color={color}>
          <SigRow label="Production Order #" value={fs.production_order_risk.pro_number}/>
          <SigRow label="Planned End Date" value={fs.production_order_risk.pro_end_date}/>
          <SigRow label="Plan Adherence" value={`${fs.production_order_risk.plan_adherence_pct}%`} status={adhS} mono/>
          <SigRow label="Order Status" value={fs.production_order_risk.pro_status} status={proS}/>
        </SigSection>
      ):(
        <SigSection title="Production Risk" color={color}>
          <SigRow label="Active Risk Run" value="None" status="ok"/>
          <SigRow label="Upcoming Runs" value={fs.production_order_risk.upcoming_runs.toString()} mono/>
        </SigSection>
      )}
      <SigSection title="Materials & Procurement" color={color}>
        <SigRow label="Raw Material Risk" value={fs.raw_material_signal.directional_concern?"Concern":"Clear"} status={fs.raw_material_signal.directional_concern?"bad":"ok"}/>
        <SigRow label="Open POs" value={fs.procurement_signal.open_pos.toString()} status={fs.procurement_signal.open_pos>0?"warn":"ok"} mono/>
      </SigSection>
      {fs.shelf_life_note&&(
        <div style={{fontSize:10,color:C.muted,fontStyle:"italic",paddingLeft:10,marginTop:2}}>{fs.shelf_life_note}</div>
      )}
    </div>
  );
}

function renderDemandSignal(fs,color){
  const classCol={GENUINE_PULL:"ok",BUFFER_BUILD:"bad",PROMO_DRIVEN:"info",
    SYSTEMATIC_PLAN_ERROR:"bad",ONE_OFF_ANOMALY:"warn",INSUFFICIENT_DATA:"neutral"};
  const qualCol={HEALTHY:"ok",SYSTEMATIC_UNDER:"warn",SYSTEMATIC_OVER:"warn",
    NOISY:"warn",INSUFFICIENT_DATA:"neutral"};
  const fcPct=Math.round(fs.above_forecast_pct*100);
  return (
    <div>
      <SigSection title="Forecast Position" color={color}>
        <SigRow label="vs Consensus Plan" value={fcPct>0?`+${fcPct}% above plan`:"Within plan"} status={fcPct>30?"bad":fcPct>10?"warn":"ok"} mono/>
        <SigRow label="Consensus Plan Qty" value={`${fs.consensus_plan_qty_cases.toLocaleString()} cs`} mono/>
        <SigRow label="Classification" value={fs.above_forecast_classification.replace(/_/g," ")} status={classCol[fs.above_forecast_classification]||"neutral"}/>
        <SigRow label="Confidence" value={`${Math.round(fs.classification_confidence*100)}%`} status={fs.classification_confidence>=0.8?"ok":fs.classification_confidence>=0.65?"warn":"bad"} mono/>
      </SigSection>
      {fs.classification_basis&&fs.classification_basis.length>0&&(
        <SigSection title="Classification Basis" color={color}>
          {fs.classification_basis.map((b,i)=>(
            <div key={i} style={{display:"flex",gap:6,padding:"3.5px 0 3.5px 10px",
              borderBottom:`1px solid ${C.border}`,alignItems:"flex-start"}}>
              <span style={{color:color,fontSize:10,flexShrink:0,lineHeight:1.7}}>▸</span>
              <span style={{fontSize:11,color:C.charcoal,lineHeight:1.5}}>{b}</span>
            </div>
          ))}
        </SigSection>
      )}
      <SigSection title="Forecast Quality" color={color}>
        <SigRow label="Trailing WMAPE" value={`${fs.forecast_accuracy_signal.trailing_wmape_pct}%`} status={fs.forecast_accuracy_signal.trailing_wmape_pct<15?"ok":fs.forecast_accuracy_signal.trailing_wmape_pct<25?"warn":"bad"} mono/>
        <SigRow label="Forecast Bias" value={`${fs.forecast_accuracy_signal.trailing_bias_pct>0?"+":""}${fs.forecast_accuracy_signal.trailing_bias_pct}%`} status={Math.abs(fs.forecast_accuracy_signal.trailing_bias_pct)<5?"ok":Math.abs(fs.forecast_accuracy_signal.trailing_bias_pct)<10?"warn":"bad"} mono/>
        <SigRow label="Plan Quality" value={fs.forecast_accuracy_signal.plan_quality_flag.replace(/_/g," ")} status={qualCol[fs.forecast_accuracy_signal.plan_quality_flag]||"neutral"}/>
        <SigRow label="Promo Attributed" value={fs.promo_attributed?"Yes":"No"} status={fs.promo_attributed?"info":"neutral"}/>
      </SigSection>
      {fs.demand_team_escalation_recommended&&(
        <div style={{padding:"6px 10px",background:"#fde8ec",borderRadius:5,
          fontSize:11,color:C.red,fontWeight:600,marginTop:4}}>
          ⚠ Escalation to Demand Planning team recommended
        </div>
      )}
      {fs.demand_team_escalation_reason&&(
        <div style={{fontSize:10,color:C.muted,marginTop:4,fontStyle:"italic",paddingLeft:10}}>
          {fs.demand_team_escalation_reason}
        </div>
      )}
    </div>
  );
}

function renderTransportSignal(fs,color){
  const carrier=fs.carrier_options[0]||{};
  const laneS=fs.primary_lane.on_time_arrival_pct>=0.95?"ok":fs.primary_lane.on_time_arrival_pct>=0.85?"warn":"bad";
  const carrierS=carrier.meets_target?"ok":"bad";
  const cbS=fs.chargeback_exposure.total_chargeback_usd<10000?"ok":fs.chargeback_exposure.total_chargeback_usd<50000?"warn":"bad";
  const otifS=fs.customer_otif_position.trailing_otif_pct>=fs.customer_otif_position.customer_otif_target_pct?"ok":
              fs.customer_otif_position.trailing_otif_pct>=0.85?"warn":"bad";
  const deltaS=fs.customer_otif_position.delta_to_target_pct>=0?"ok":
               fs.customer_otif_position.delta_to_target_pct>=-5?"warn":"bad";
  return (
    <div>
      <SigSection title="Primary Lane" color={color}>
        <SigRow label="Avg Transit" value={`${fs.primary_lane.avg_transit_hours} hrs`} status={fs.primary_lane.avg_transit_hours<48?"ok":"warn"} mono/>
        <SigRow label="Lane OTP" value={`${Math.round(fs.primary_lane.on_time_arrival_pct*100)}%`} status={laneS} mono/>
        <SigRow label="Lane Viable" value={fs.primary_lane.viable?"Yes":"No"} status={fs.primary_lane.viable?"ok":"bad"}/>
        <SigRow label="Shipments (90d)" value={fs.primary_lane.shipment_count.toString()} mono/>
      </SigSection>
      {fs.primary_lane.notes&&(
        <div style={{fontSize:10,color:C.muted,fontStyle:"italic",
          paddingLeft:10,marginTop:-6,marginBottom:8}}>{fs.primary_lane.notes}</div>
      )}
      <SigSection title="Carrier" color={color}>
        <SigRow label="Carrier" value={carrier.carrier_name||"—"}/>
        <SigRow label="Trailing OTP" value={`${Math.round((carrier.trailing_otp_pct||0)*100)}%`} status={carrierS} mono/>
        <SigRow label="Contracted Target" value={`${Math.round((carrier.contracted_otp_target||0)*100)}%`} mono/>
        <SigRow label="Meets Target" value={carrier.meets_target?"Yes":"No"} status={carrierS}/>
      </SigSection>
      <SigSection title="Customer OTIF Position" color={color}>
        <SigRow label="Trailing OTIF" value={`${Math.round(fs.customer_otif_position.trailing_otif_pct*100)}%`} status={otifS} mono/>
        <SigRow label="OTIF Target" value={`${Math.round(fs.customer_otif_position.customer_otif_target_pct*100)}%`} mono/>
        <SigRow label="Delta to Target" value={`${fs.customer_otif_position.delta_to_target_pct>0?"+":""}${fs.customer_otif_position.delta_to_target_pct} pp`} status={deltaS} mono/>
        <SigRow label="Active Alerts" value={fs.active_alert_count.toString()} status={fs.active_alert_count===0?"ok":fs.active_alert_count<=2?"warn":"bad"} mono/>
      </SigSection>
      <SigSection title="Chargeback Exposure" color={color}>
        <SigRow label="Total Exposure" value={`$${(fs.chargeback_exposure.total_chargeback_usd/1000).toFixed(1)}K`} status={cbS} mono/>
        <SigRow label="Posted" value={`$${(fs.chargeback_exposure.posted_usd/1000).toFixed(1)}K`} status={cbS} mono/>
        <SigRow label="Disputed" value={`$${(fs.chargeback_exposure.disputed_usd/1000).toFixed(1)}K`} mono/>
        {fs.chargeback_exposure.top_chargeback_types&&fs.chargeback_exposure.top_chargeback_types.length>0&&(
          <SigRow label="Chargeback Types" value={fs.chargeback_exposure.top_chargeback_types.join(" · ")}/>
        )}
      </SigSection>
    </div>
  );
}

function renderRetailSignal(fs,color){
  const classCol={GENUINE_PULL:"ok",BUFFER_BUILD:"bad",PROMO_DRIVEN:"info",INSUFFICIENT_DATA:"neutral"};
  const trendCol={ACCELERATING:"ok",FLAT:"neutral",DECELERATING:"warn",INSUFFICIENT_DATA:"neutral"};
  const hasPromo=fs.promotional_context.promo_type||fs.promotional_context.expected_incremental_quantity>0;
  return (
    <div>
      <SigSection title="Demand Classification" color={color}>
        <SigRow label="Classification" value={fs.pull_vs_buffer_classification.replace(/_/g," ")} status={classCol[fs.pull_vs_buffer_classification]||"neutral"}/>
        <SigRow label="Confidence" value={`${Math.round(fs.classification_confidence*100)}%`} status={fs.classification_confidence>=0.8?"ok":fs.classification_confidence>=0.65?"warn":"bad"} mono/>
      </SigSection>
      {fs.classification_basis&&fs.classification_basis.length>0&&(
        <SigSection title="Classification Basis" color={color}>
          {fs.classification_basis.map((b,i)=>(
            <div key={i} style={{display:"flex",gap:6,padding:"3.5px 0 3.5px 10px",
              borderBottom:`1px solid ${C.border}`,alignItems:"flex-start"}}>
              <span style={{color:color,fontSize:10,flexShrink:0,lineHeight:1.7}}>▸</span>
              <span style={{fontSize:11,color:C.charcoal,lineHeight:1.5}}>{b}</span>
            </div>
          ))}
        </SigSection>
      )}
      <SigSection title="Consumer Takeaway" color={color}>
        <SigRow label="Latest POS Units" value={fs.consumer_takeaway.latest_pos_units.toLocaleString()} mono/>
        <SigRow label="Takeaway Trend" value={fs.consumer_takeaway.takeaway_trend.replace(/_/g," ")} status={trendCol[fs.consumer_takeaway.takeaway_trend]||"neutral"}/>
        <SigRow label="ACV Distribution" value={`${fs.consumer_takeaway.avg_distribution_pct_acv}%`} status={fs.consumer_takeaway.avg_distribution_pct_acv>=75?"ok":fs.consumer_takeaway.avg_distribution_pct_acv>=60?"warn":"bad"} mono/>
        <SigRow label="Promo Active in Window" value={fs.consumer_takeaway.promo_active_in_window?"Yes":"No"} status={fs.consumer_takeaway.promo_active_in_window?"info":"neutral"}/>
      </SigSection>
      <SigSection title="Promotional Context" color={color}>
        <SigRow label="Promo Type" value={hasPromo&&fs.promotional_context.promo_type?fs.promotional_context.promo_type.replace(/_/g," "):"None"} status={hasPromo?"info":"neutral"}/>
        <SigRow label="Incremental Qty" value={fs.promotional_context.expected_incremental_quantity>0?`${fs.promotional_context.expected_incremental_quantity.toLocaleString()} cs`:"N/A"} status={hasPromo?"info":"neutral"} mono/>
        <SigRow label="Promo Status" value={fs.promotional_context.promo_status||"N/A"} status={fs.promotional_context.promo_status==="APPROVED"?"ok":fs.promotional_context.promo_status&&fs.promotional_context.promo_status!=="NONE"?"warn":"neutral"}/>
      </SigSection>
      {fs.data_gaps&&fs.data_gaps.length>0&&(
        <div style={{padding:"5px 9px 5px 10px",background:"#fff8e6",
          borderRadius:4,fontSize:10,color:C.orange,marginTop:4}}>
          ⚠ Data gaps: {fs.data_gaps.join("; ")}
        </div>
      )}
    </div>
  );
}

function renderFullSignal(agentKey,fs,color){
  if(!fs)return null;
  if(agentKey==="supply_planning")return renderSupplySignal(fs,color);
  if(agentKey==="demand_planning")return renderDemandSignal(fs,color);
  if(agentKey==="transportation")return renderTransportSignal(fs,color);
  if(agentKey==="retail_intelligence")return renderRetailSignal(fs,color);
  return null;
}




// ── FULFILLMENT INCIDENTS + DECISION LOG DATA ─────────────────────────────
const SIMULATOR_INCIDENTS = [
  {
    id:"SO-44021", order_id:"SO-44021", customer:"Chewy", sku:"SHEBA PERFECT PORTIONS 72ct",
    title:"Supply Stockout — Chewy SO-44021",
    description:"DC-FL-04 has 1,100 cs vs 3,200 ordered. Production run completes June 10 — after MABD.",
    fine_at_risk:57600, risk_probability:0.91,
    otif_rulebook:"Chewy charges $18/cs for any late delivery",
    scenarios:[
      {id:"a",name:"Default: Ship 1,100 cs Now",tagline:"Immediate partial — exposes backorder fine",
       is_recommended:false,freight_cost:0,fine_usd:38160,net_impact:-38160,savings_vs_default:0,fulfill_cs:1100,
       rationale:"Ships only what is available. The remaining 2,100 cs triggers the $18/cs Chewy OTIF penalty in full. Highest cost path."},
      {id:"b",name:"DC Split: FL-04 + NJ-02 Transfer",tagline:"Move 900 cs from NJ-02 to bridge the gap",
       is_recommended:true,freight_cost:4200,fine_usd:0,net_impact:-4200,savings_vs_default:33960,fulfill_cs:2000,
       rationale:"Ship 1,100 cs FL-04 + 900 cs transferred from DC-NJ-02. Avoids the OTIF penalty entirely. $4,200 freight vs $38,160 fine — net saving of $33,960."},
      {id:"c",name:"Full Defer — Negotiate MABD Extension",tagline:"Push delivery to June 10",
       is_recommended:false,freight_cost:0,fine_usd:57600,net_impact:-57600,savings_vs_default:-19440,fulfill_cs:0,
       rationale:"If Chewy rejects the MABD extension, full $18/cs penalty applies to all 3,200 cs = $57,600. Only viable if a written extension is confirmed before shipping."},
    ],
    execution_steps:["Approve DC-NJ-02 → DC-FL-04 transfer (900 cs)","Schedule combined pickup June 4","Notify Chewy account team: 2,000 cs ship + 1,200 cs backorder ETA June 11"],
  },
  {
    id:"SO-44019", order_id:"SO-44019", customer:"Walmart", sku:"PEDIGREE Adult Chicken 18lb 4-pk",
    title:"Tight Supply Gap — Walmart SO-44019",
    description:"4,200 cs on hand vs 6,000 ordered. PRO-7781 at 82% adherence — run may not close the gap before MABD.",
    fine_at_risk:42000, risk_probability:0.78,
    otif_rulebook:"Walmart charges $7/cs for late delivery",
    scenarios:[
      {id:"a",name:"Full Fulfill — 2 Days Late",tagline:"Wait for PRO-7781 completion",
       is_recommended:false,freight_cost:0,fine_usd:42000,net_impact:-42000,savings_vs_default:0,fulfill_cs:6000,
       rationale:"Waits for PRO-7781. Ships 6,000 cs but 2 days after MABD — triggers $7/cs Walmart OTIF fine on all cases. Highest risk if run slips further."},
      {id:"b",name:"Partial Fulfill: 5,100 cs On Time",tagline:"Ship available now, backorder 900 cs",
       is_recommended:true,freight_cost:0,fine_usd:0,net_impact:-14850,savings_vs_default:27150,fulfill_cs:5100,
       rationale:"Ship 5,100 cs today. Protects OTIF score. Backorder 900 cs at $16.50/cs landed = $14,850. Saves $27,150 vs late delivery. Genuine POS demand makes backorder low-risk."},
      {id:"c",name:"FG Only: 4,200 cs Today",tagline:"Ship only confirmed on-hand inventory",
       is_recommended:false,freight_cost:0,fine_usd:0,net_impact:-22500,savings_vs_default:19500,fulfill_cs:4200,
       rationale:"Ships only confirmed FG. Zero OTIF risk. Backorder 1,800 cs at $12.50/cs = $22,500. More conservative than Option B with higher backorder cost."},
    ],
    execution_steps:["Allocate 4,200 cs FG from DC-TX-01","Confirm PRO-7781 900 cs partial pull with Supply Planning","Notify Walmart of partial shipment + backorder ETA"],
  },
  {
    id:"SO-44022", order_id:"SO-44022", customer:"Target", sku:"TEMPTATIONS Classic Chicken 16oz 12-pk",
    title:"Buffer Build Risk — Target SO-44022",
    description:"210% of consensus, flat POS, elevated OHI. Three agents signal BLOCK. Full fulfillment depletes DC-CA-03 for 3 weeks.",
    fine_at_risk:89400, risk_probability:0.93,
    otif_rulebook:"Downstream multi-customer OOS fine exposure — West Coast DCs",
    scenarios:[
      {id:"a",name:"Accept Full 8,000 cs",tagline:"Honor the full PO",
       is_recommended:false,freight_cost:0,fine_usd:89400,net_impact:-89400,savings_vs_default:0,fulfill_cs:8000,
       rationale:"Fulfills Target's full PO but depletes DC-CA-03. Downstream fine exposure to Amazon, Petco, Chewy West = $89,400. Also physically impossible — lane cap is 6,500 cs."},
      {id:"b",name:"Counter-Offer: 3,800 cs Consensus",tagline:"Offer plan quantity only",
       is_recommended:true,freight_cost:0,fine_usd:0,net_impact:0,savings_vs_default:89400,fulfill_cs:3800,
       rationale:"Counter at 3,800 cs (consensus plan qty). Protects DC-CA-03 for all West Coast customers. Saves $89,400 downstream risk. Agent confidence 93%."},
      {id:"c",name:"Reject — No Counter",tagline:"Decline the order entirely",
       is_recommended:false,freight_cost:0,fine_usd:0,net_impact:0,savings_vs_default:89400,fulfill_cs:0,
       rationale:"Same financial protection as Option B but creates an unnecessary relationship issue. Counter-offer is always preferable to an outright reject when genuine demand exists."},
    ],
    execution_steps:["Send 3,800 cs counter-offer to Target account team","Log buffer-build flag for Q3 JBP review","Monitor DC-CA-03 OHI for recovery"],
  },
  {
    id:"SO-44020", order_id:"SO-44020", customer:"PetSmart", sku:"WHISKAS Tender Bites Tuna in Gravy 24ct",
    title:"Promo Spike Verification — PetSmart SO-44020",
    description:"Wet Food Week June 3-9 confirmed. 4,500 cs verified promo-driven. All agents PROCEED. Standard fulfillment.",
    fine_at_risk:12000, risk_probability:0.08,
    otif_rulebook:"PetSmart charges $14/cs for late delivery",
    scenarios:[
      {id:"a",name:"Accept in Full — On Time",tagline:"Standard fulfillment, no issues",
       is_recommended:true,freight_cost:0,fine_usd:0,net_impact:0,savings_vs_default:12000,fulfill_cs:4500,
       rationale:"5,800 cs at DC-NJ-02 (26d supply). Promo confirmed. Ship by June 2 for June 5 MABD. Zero risk. Agent confidence 92%."},
      {id:"b",name:"Partial: 4,000 cs + Backorder",tagline:"Conservative partial — not warranted",
       is_recommended:false,freight_cost:0,fine_usd:3500,net_impact:-6000,savings_vs_default:6000,fulfill_cs:4000,
       rationale:"No supply reason to short this order. Creates unnecessary backorder cost and minor OTIF exposure. Avoid when supply is adequate."},
      {id:"c",name:"Defer to June 6",tagline:"Miss the promo window entirely",
       is_recommended:false,freight_cost:2400,fine_usd:12000,net_impact:-14400,savings_vs_default:-2400,fulfill_cs:4500,
       rationale:"Misses Wet Food Week entirely. Expedite freight + OTIF fine = $14,400. Worst case — only relevant if DC-NJ-02 capacity is compromised (it is not)."},
    ],
    execution_steps:["Allocate 4,500 cs from DC-NJ-02 (zero OHI impact)","Schedule Old Dominion pickup June 2","No further action required — straightforward approval"],
  },
];

const INITIAL_DECISION_LOG = [
  {id:"dc-001",ts:"2026-05-19T08:14:00Z",order:"SO-44017",customer:"Target",
   sku:"PEDIGREE Adult Chicken 18lb",agent_rec:"Partial fulfill — 5,000 cs (83%)",
   user_decision:"approved",override:null,
   outcome:"Fulfilled · on MABD · CFR 83%",agent_aligned:true,financial:"-$12,400"},
  {id:"dc-002",ts:"2026-05-18T15:32:00Z",order:"SO-44016",customer:"Walmart",
   sku:"WHISKAS Purrfectly Chicken 24ct",agent_rec:"Hold — MRSL non-compliant batch",
   user_decision:"rejected",override:"Sales VP Override — ship it",
   outcome:"DC rejection · $34,000 chargeback · agent was correct",agent_aligned:false,financial:"-$34,000"},
  {id:"dc-003",ts:"2026-05-17T11:20:00Z",order:"SO-44015",customer:"Chewy",
   sku:"SHEBA PERFECT PORTIONS 72ct",agent_rec:"Split ship 2,400 cs via DC-NJ-02",
   user_decision:"approved",override:null,
   outcome:"Fulfilled 2,400 cs · no penalty · backorder acknowledged",agent_aligned:true,financial:"-$4,200"},
  {id:"dc-004",ts:"2026-05-16T09:45:00Z",order:"SO-44014",customer:"Amazon",
   sku:"PEDIGREE Choice Cuts Beef 36ct",agent_rec:"Accept in full — 3,200 cs",
   user_decision:"approved",override:null,
   outcome:"Fulfilled on time · CFR 100%",agent_aligned:true,financial:"$0"},
  {id:"dc-005",ts:"2026-05-15T14:18:00Z",order:"SO-44013",customer:"PetSmart",
   sku:"TEMPTATIONS Classic 16oz",agent_rec:"Defer — production run needed",
   user_decision:"rejected",override:"Customer requested full PO confirmation",
   outcome:"PENDING — partial in transit",agent_aligned:false,financial:"TBD"},
];


// ── DATA HEALTH ───────────────────────────────────────────────────────────────
const DATA_HEALTH = [
  {
    agent:"Supply Planning Agent", color:C.blue,
    sources:[
      {name:"Inventory Positions",      system:"SAP ERP · MM60",              lastLoad:"2026-05-19T07:14:22Z", freq:"Every 4 h",    next:"2026-05-19T11:14:22Z", status:"FRESH"},
      {name:"Production Orders",        system:"SAP PP · CO03",               lastLoad:"2026-05-19T06:45:11Z", freq:"Every 4 h",    next:"2026-05-19T10:45:11Z", status:"FRESH"},
      {name:"Raw Material Stock",       system:"SAP MM · MB52",               lastLoad:"2026-05-19T07:14:22Z", freq:"Every 4 h",    next:"2026-05-19T11:14:22Z", status:"FRESH"},
      {name:"DC Physical Inventory",    system:"WMS · Blue Yonder",           lastLoad:"2026-05-18T23:00:00Z", freq:"Every 8 h",    next:"2026-05-19T07:00:00Z", status:"STALE"},
    ]
  },
  {
    agent:"Demand Planning Agent", color:C.orange,
    sources:[
      {name:"Consensus Forecast",       system:"SAP IBP · Demand Planning",   lastLoad:"2026-05-19T04:00:00Z", freq:"Daily 4 AM",   next:"2026-05-20T04:00:00Z", status:"FRESH"},
      {name:"Customer Orders (EDI)",    system:"EDI Gateway · SPS Commerce",  lastLoad:"2026-05-19T07:55:01Z", freq:"Every 1 h",    next:"2026-05-19T08:55:01Z", status:"FRESH"},
      {name:"Trade Promo Calendar",     system:"TPM · Salesforce CRM",        lastLoad:"2026-05-18T22:00:00Z", freq:"Daily 10 PM",  next:"2026-05-19T22:00:00Z", status:"FRESH"},
      {name:"Forecast Accuracy (WMAPE)","system":"IBP · Analytics Engine",    lastLoad:"2026-05-19T04:00:00Z", freq:"Daily 4 AM",   next:"2026-05-20T04:00:00Z", status:"FRESH"},
    ]
  },
  {
    agent:"Transportation Agent", color:C.teal,
    sources:[
      {name:"Lane & Carrier Performance",system:"TMS · Oracle OTM",           lastLoad:"2026-05-19T06:00:00Z", freq:"Every 6 h",    next:"2026-05-19T12:00:00Z", status:"FRESH"},
      {name:"Chargeback Exposure",      system:"Deduction Mgmt · HighRadius", lastLoad:"2026-05-19T03:00:00Z", freq:"Daily 3 AM",   next:"2026-05-20T03:00:00Z", status:"FRESH"},
      {name:"Customer OTIF Scoreboard", system:"TMS · OTIF Analytics",        lastLoad:"2026-05-19T06:00:00Z", freq:"Every 6 h",    next:"2026-05-19T12:00:00Z", status:"FRESH"},
      {name:"Active Transport Alerts",  system:"Alert Engine · Internal",     lastLoad:"2026-05-19T07:58:44Z", freq:"Every 15 min", next:"2026-05-19T08:13:44Z", status:"FRESH"},
    ]
  },
  {
    agent:"Retail Intelligence Agent", color:C.purple,
    sources:[
      {name:"POS Syndicated Data",      system:"IRI / Circana · NielsenIQ",   lastLoad:"2026-05-18T23:00:00Z", freq:"Weekly (Mon)", next:"2026-05-25T23:00:00Z", status:"WARNING"},
      {name:"Retailer OHI Positions",   system:"Retail Link · Luminate",      lastLoad:"2026-05-18T23:00:00Z", freq:"Daily 11 PM",  next:"2026-05-19T23:00:00Z", status:"FRESH"},
      {name:"Promo Event Confirmation", system:"TPM · Salesforce CRM",        lastLoad:"2026-05-18T22:00:00Z", freq:"Daily 10 PM",  next:"2026-05-19T22:00:00Z", status:"FRESH"},
      {name:"Classification Engine",    system:"ML Engine · Internal",        lastLoad:"2026-05-19T07:14:22Z", freq:"Every 4 h",    next:"2026-05-19T11:14:22Z", status:"FRESH"},
    ]
  },
];


// ── DATA DICTIONARY ───────────────────────────────────────────────────────────
const DICT_SECTIONS = [
  {
    section:"Order & Fulfillment",
    terms:[
      {term:"MABD",full:"Must Arrive By Date",def:"The customer-specified date by which an order must physically arrive at the destination DC. Missing the MABD triggers OTIF penalties.",screens:["Order Triage","Fulfillment Sim"]},
      {term:"OTIF",full:"On Time In Full",def:"A retailer compliance metric measuring the percentage of orders delivered on time and at the correct quantity. Each retailer sets their own target (e.g. Walmart 95%, Amazon 97%). Failure results in chargebacks.",screens:["Order Triage","Transportation","Watchtower"]},
      {term:"Fill Rate",full:null,def:"The percentage of an order quantity that is actually shipped. A fill rate of 83% means 83 cases were shipped for every 100 ordered. Directly tied to Case Fill Rate (CFR).",screens:["Order Triage","Watchtower"]},
      {term:"ATP",full:"Available to Promise",def:"The portion of on-hand inventory not already committed to other accepted orders. ATP = On Hand − Committed. The recommendation engine uses ATP, not total stock, to evaluate whether a new order can be fulfilled.",screens:["Order Triage","Supply Planning"]},
      {term:"Committed Inventory",full:null,def:"Stock already allocated to previously accepted orders. This inventory is reserved and cannot be promised to new orders without risking a short-ship on the existing commitment.",screens:["Order Triage","Supply Planning"]},
      {term:"Partial Fulfillment",full:null,def:"Shipping a portion of an ordered quantity — typically the maximum available ATP — when full supply is unavailable. Preferred over deferral when it protects OTIF on the cases shipped.",screens:["Order Triage","Fulfillment Sim"]},
      {term:"cs",full:"Cases",def:"The standard unit of measure used throughout the platform. One case contains a manufacturer-defined number of retail units (e.g. 24 cans, 12 bags). All quantities are expressed in cases.",screens:["All screens"]},
      {term:"PO",full:"Purchase Order",def:"A formal order placed by a retailer to a supplier specifying SKU, quantity, price, and delivery terms. Each PO generates a Sales Order (SO) in SAP.",screens:["Order Triage","Decision Log"]},
      {term:"SO",full:"Sales Order",def:"The supplier-side record of a customer's purchase order, created in SAP. The platform evaluates SO-level decisions (accept, modify, reject).",screens:["Order Triage","Decision Log","Fulfillment Sim"]},
    ]
  },
  {
    section:"Inventory",
    terms:[
      {term:"DoS",full:"Days of Supply",def:"How many days current on-hand inventory will last at the current demand rate. Calculated as On Hand ÷ Average Daily Demand. Below 7 days is critical; 7–14 days is a warning.",screens:["Supply Planning","Order Triage"]},
      {term:"On Hand",full:null,def:"Total finished goods (FG) inventory physically present at a DC, as reported by the warehouse management system. Does not account for commitments — use ATP for available supply.",screens:["Supply Planning","Order Triage"]},
      {term:"Safety Stock",full:null,def:"A minimum inventory buffer maintained at each DC to absorb demand variability and supply uncertainty. When on-hand inventory falls below safety stock, the status is flagged BELOW_SS.",screens:["Safety Stock","Supply Planning"]},
      {term:"Stockout",full:null,def:"A condition where on-hand inventory is zero or insufficient to fulfill any orders. The most severe inventory status — triggers immediate escalation.",screens:["Supply Planning","Order Triage","Watchtower"]},
      {term:"BELOW_SS",full:"Below Safety Stock",def:"Inventory exists but has fallen below the safety stock threshold. Orders can still be partially fulfilled but the DC is in a vulnerable position for subsequent demand.",screens:["Supply Planning","Order Triage"]},
      {term:"Network Total",full:null,def:"The sum of on-hand inventory across all DCs for a given SKU. Used to evaluate whether split-sourcing across multiple DCs can cover an order that a single DC cannot.",screens:["Order Triage","Fulfillment Sim","Supply Planning"]},
      {term:"After Fill",full:null,def:"The inventory remaining at a DC after fulfilling an order. If After Fill drops below safety stock, the order puts the DC at risk for subsequent demand.",screens:["Order Triage","Supply Planning"]},
    ]
  },
  {
    section:"Demand & Forecast",
    terms:[
      {term:"Consensus Forecast",full:null,def:"The agreed-upon demand plan produced collaboratively by Sales, Finance, and Supply Planning — typically on a 4-week rolling basis. Orders significantly above the consensus are flagged for review.",screens:["Demand Planning","Order Triage"]},
      {term:"WMAPE",full:"Weighted Mean Absolute Percentage Error",def:"The primary measure of forecast accuracy. Lower is better. WMAPE < 15% is HEALTHY; 15–22% is a warning; > 22% indicates a systematic forecasting problem.",screens:["Demand Planning","Order Triage"]},
      {term:"Forecast Bias",full:null,def:"The systematic tendency to forecast too high (positive bias) or too low (negative bias). A bias of -6% means the forecast consistently under-predicts demand by 6%, leading to preventable supply gaps.",screens:["Demand Planning","Order Triage"]},
      {term:"Above Forecast %",full:null,def:"How much an incoming order exceeds the consensus plan, expressed as a percentage. An order 58% above forecast is flagged for demand classification before being accepted.",screens:["Order Triage","Demand Planning"]},
      {term:"GENUINE_PULL",full:null,def:"A demand classification indicating that an order is driven by real consumer sell-through. POS data confirms consumers are buying the product off shelves at a rate consistent with the order.",screens:["Order Triage","Retail Intelligence","Demand Planning"]},
      {term:"BUFFER_BUILD",full:null,def:"A demand classification where a retailer is ordering significantly above consumer sell-through, stockpiling inventory at the DC level. The key risk: the retailer will not reorder for weeks, leaving the supplier over-exposed.",screens:["Order Triage","Retail Intelligence","Demand Planning","Watchtower"]},
      {term:"PROMO_DRIVEN",full:null,def:"An above-forecast order that is fully explained by a confirmed promotional event (e.g. a feature ad, a price reduction). These orders are expected and planned — they do not require escalation.",screens:["Order Triage","Demand Planning","Retail Intelligence"]},
      {term:"ONE_OFF_ANOMALY",full:null,def:"An order spike with no identifiable driver — not a promo, not a trend, not a buffer build. Treated as a caution signal; the recommendation engine applies conservatism until a cause is identified.",screens:["Order Triage","Demand Planning"]},
      {term:"Classification Confidence",full:null,def:"The model's certainty in its demand classification (GENUINE_PULL, BUFFER_BUILD, etc.), expressed as a percentage. Below 65% is considered low confidence and reduces the weight given to that signal.",screens:["Order Triage","Retail Intelligence","Demand Planning"]},
      {term:"Promo Attribution",full:null,def:"A flag indicating that an order's volume is attributed to a confirmed promotional event. Promo-attributed orders bypass certain above-forecast thresholds because the spike is planned and budgeted.",screens:["Demand Planning","Order Triage"]},
    ]
  },
  {
    section:"Transportation & Logistics",
    terms:[
      {term:"OTP",full:"On-Time Performance",def:"A carrier-level metric measuring the percentage of shipments that arrive on or before the scheduled delivery date. Each carrier has a contracted OTP target (typically 95%). Below-target carriers are flagged.",screens:["Transportation","Order Triage"]},
      {term:"Lane",full:null,def:"A defined shipping route between an origin DC and a customer destination. Lanes have historical performance data (OTP, average transit time, shipment volume) used to assess delivery risk.",screens:["Transportation","Fulfillment Sim"]},
      {term:"Chargeback (CB)",full:null,def:"A financial penalty charged by a retailer to a supplier for failing to meet compliance requirements — most commonly late delivery, incorrect quantity, or labeling errors. Chargebacks can be posted (confirmed) or disputed.",screens:["Transportation","Order Triage","Watchtower"]},
      {term:"OTIF Target",full:null,def:"Each retailer's minimum acceptable OTIF threshold, set contractually. Walmart requires 95%, Amazon 97%. Performance below target triggers automatic chargeback calculations.",screens:["Transportation","Order Triage"]},
      {term:"Delta to Target",full:null,def:"The gap between actual trailing OTIF and the customer's OTIF target. A delta of -7 pp means OTIF is 7 percentage points below the threshold — a significant compliance risk.",screens:["Transportation"]},
      {term:"Demurrage",full:null,def:"Charges incurred when freight containers or trailers are held beyond the agreed free-time window at a port or terminal. Demurrage Avoided in the Watchtower reflects savings from timely agent-assisted decisions.",screens:["Watchtower"]},
      {term:"Split Sourcing",full:null,def:"Fulfilling a single order by combining inventory from multiple DCs when no single DC has sufficient stock. The Transportation Agent evaluates whether the additional freight cost is less than the OTIF fine exposure.",screens:["Fulfillment Sim","Order Triage"]},
    ]
  },
  {
    section:"Retail Intelligence",
    terms:[
      {term:"POS",full:"Point of Sale",def:"Consumer transaction data captured at the retail checkout. POS shows actual consumer sell-through (units leaving shelves), as opposed to orders placed by the retailer. A healthy order should be supported by strong POS.",screens:["Retail Intelligence","Order Triage"]},
      {term:"OHI",full:"On-Hand Inventory",def:"The retailer's reported stock level at their DCs or stores. High OHI relative to norm, combined with a large inbound order, is a strong buffer-build signal.",screens:["Retail Intelligence","Order Triage"]},
      {term:"OHI vs Norm",full:null,def:"A comparison of a retailer's current OHI to their typical historical inventory level for that SKU. OHI significantly above norm indicates the retailer may already be over-stocked.",screens:["Retail Intelligence","Order Triage"]},
      {term:"ACV Distribution",full:"All Commodity Volume Distribution",def:"The percentage of retail stores carrying a product, weighted by each store's sales volume. 82% ACV means the product is available in stores representing 82% of total category sales. Used to calibrate expected POS volume.",screens:["Retail Intelligence"]},
      {term:"POS Velocity",full:null,def:"The rate of consumer purchases, typically measured in units per week. An accelerating POS velocity supports a genuine demand interpretation; flat or declining velocity alongside a large order is a buffer-build warning.",screens:["Retail Intelligence","Order Triage"]},
      {term:"Risk Score",full:null,def:"A composite buffer-build risk score from 1 (low) to 5 (high), calculated from OHI vs norm, POS trend, order size vs forecast, and classification confidence. Score of 5 triggers an automatic BLOCK recommendation.",screens:["Retail Intelligence","Watchtower"]},
      {term:"Takeaway Trend",full:null,def:"The direction of consumer POS velocity over the trailing 8 weeks: ACCELERATING, FLAT, or DECELERATING. A decelerating trend combined with a large order is a strong buffer-build indicator.",screens:["Retail Intelligence"]},
    ]
  },
  {
    section:"Financial",
    terms:[
      {term:"Fines at Risk",full:null,def:"The total projected chargeback and OTIF penalty exposure across all active orders in the next 7 days, assuming no corrective action is taken. Shown in the TopBar as a real-time risk signal.",screens:["Watchtower","Fulfillment Sim","Transportation"]},
      {term:"Revenue Preserved MTD",full:null,def:"The cumulative revenue protected month-to-date by accepting orders that might otherwise have been deferred or rejected. Calculated as the value of cases shipped following an agent-assisted approval.",screens:["Watchtower"]},
      {term:"Net Impact",full:null,def:"The total financial impact of a fulfillment scenario, combining freight cost and fine exposure. A negative net impact represents a cost. The scenario with the least negative (or zero) net impact is recommended.",screens:["Fulfillment Sim"]},
      {term:"Savings vs Default",full:null,def:"How much better a fulfillment scenario is, in dollars, compared to taking no action (the default path). A saving of $33,960 means choosing this scenario avoids $33,960 in costs relative to doing nothing.",screens:["Fulfillment Sim"]},
      {term:"Fine per cs",full:"Fine per Case",def:"The per-case chargeback rate a retailer applies when delivery is late or incomplete. Walmart charges $7/cs; Chewy charges $18/cs. Used by the Transportation Agent to calculate fine exposure for partial fulfillment scenarios.",screens:["Fulfillment Sim","Transportation"]},
      {term:"CB Exposure",full:"Chargeback Exposure",def:"The total dollar amount of pending chargebacks for a customer — split between posted (confirmed, awaiting deduction) and disputed (under review). High exposure reduces the financial case for accepting marginal orders.",screens:["Transportation","Order Triage"]},
    ]
  },
  {
    section:"Agent & System",
    terms:[
      {term:"CFR",full:"Case Fill Rate",def:"The headline supply chain performance metric: cases shipped ÷ cases ordered, expressed as a percentage. CFR of 97.8% means 97.8 of every 100 ordered cases were fulfilled. The platform is designed to protect and improve CFR.",screens:["Watchtower","Root Cause Hub"]},
      {term:"Agent Acceptance Rate",full:null,def:"The percentage of AI agent recommendations that the human operator approves without modification. A high acceptance rate (>85%) indicates the agents are well-calibrated to operational reality.",screens:["Watchtower","Decision Log"]},
      {term:"Disposition",full:null,def:"Each specialist agent's verdict on an order: PROCEED (no issues found), CAUTION (a risk exists but is manageable), or BLOCK (a hard constraint makes fulfillment inadvisable). The orchestrator aggregates all four dispositions.",screens:["Order Triage"]},
      {term:"Hard Block",full:null,def:"A disposition flag indicating that an agent has found a condition that makes fulfillment impossible or highly inadvisable regardless of other signals — e.g. a confirmed stockout with no alternative sourcing.",screens:["Order Triage"]},
      {term:"Orchestrator",full:null,def:"The coordinating agent that aggregates signals from all four specialist agents, resolves conflicts through a structured debate process, and produces a single Green / Amber / Red status and recommendation for the human operator.",screens:["Order Triage"]},
      {term:"PRO",full:"Production Order",def:"A manufacturing order in SAP that schedules the production of a specific SKU. PRO adherence % measures how closely the actual output tracks the planned quantity and completion date.",screens:["Supply Planning","Order Triage"]},
      {term:"Plan Adherence %",full:null,def:"The percentage of planned production output that is actually achieved. 82% adherence means only 82 cases are produced for every 100 planned — creating supply risk when orders depend on that production run completing on time.",screens:["Supply Planning","Order Triage"]},
      {term:"WMAPE Flag",full:null,def:"A qualitative label applied to a SKU's forecast quality: HEALTHY (<15% WMAPE), SYSTEMATIC_UNDER (consistent under-forecasting), SYSTEMATIC_OVER (consistent over-forecasting), or NOISY (high variance with no clear pattern).",screens:["Demand Planning","Order Triage"]},
      {term:"ATP Coverage",full:"Available to Promise Coverage",def:"The percentage of an order quantity that can be covered by uncommitted inventory. ATP Coverage below 100% means a full acceptance is not possible — the recommendation engine will suggest a partial fill or alternative sourcing.",screens:["Order Triage","Supply Planning"]},
    ]
  },
];

// ── SARAH ENHANCEMENT DATA ────────────────────────────────────────────────
// DC inventory matrix per SKU (used in InventorySnapshot + DC Sourcing)
const SKU_DC_MATRIX = {
  "SKU-1188":[
    {dc:"DC-TX-01",cs:4200,dos:9.5,status:"BELOW_SS",ss:3200,ship_to:"Walmart SE"},
    {dc:"DC-NJ-02",cs:6800,dos:15.2,status:"OK",ss:3200,ship_to:"Walmart NE"},
    {dc:"DC-CA-03",cs:1200,dos:4.3,status:"BELOW_SS",ss:3200,ship_to:"Walmart West"},
    {dc:"DC-FL-04",cs:2100,dos:7.8,status:"BELOW_SS",ss:3200,ship_to:"Walmart SE Alt"},
  ],
  "SKU-2241":[
    {dc:"DC-NJ-02",cs:5800,dos:26.1,status:"OK",ss:1800,ship_to:"PetSmart NE"},
    {dc:"DC-TX-01",cs:3100,dos:14.2,status:"OK",ss:1800,ship_to:"PetSmart S"},
    {dc:"DC-FL-04",cs:1800,dos:8.1,status:"BELOW_SS",ss:1800,ship_to:"PetSmart SE"},
    {dc:"DC-CA-03",cs:2900,dos:13.1,status:"OK",ss:1800,ship_to:"PetSmart West"},
  ],
  "SKU-3305":[
    {dc:"DC-FL-04",cs:1100,dos:3.2,status:"STOCKOUT",ss:2400,ship_to:"Chewy SE"},
    {dc:"DC-NJ-02",cs:2900,dos:16.1,status:"OK",ss:2400,ship_to:"Chewy NE"},
    {dc:"DC-TX-01",cs:1400,dos:7.8,status:"BELOW_SS",ss:2400,ship_to:"Chewy S"},
    {dc:"DC-CA-03",cs:800,dos:4.4,status:"BELOW_SS",ss:2400,ship_to:"Chewy West"},
  ],
  "SKU-4417":[
    {dc:"DC-CA-03",cs:6200,dos:22.1,status:"BELOW_SS",ss:2800,ship_to:"Target West"},
    {dc:"DC-TX-01",cs:3800,dos:13.5,status:"OK",ss:2800,ship_to:"Target S"},
    {dc:"DC-NJ-02",cs:4100,dos:14.6,status:"OK",ss:2800,ship_to:"Target NE"},
    {dc:"DC-FL-04",cs:2200,dos:7.8,status:"BELOW_SS",ss:2800,ship_to:"Target SE"},
  ],
};

// CFR data (Root Cause enhancements)
const CFR_TREND = [
  {w:"W-11",cfr:96.2},{w:"W-10",cfr:97.1},{w:"W-9",cfr:96.8},{w:"W-8",cfr:95.4},
  {w:"W-7",cfr:94.1},{w:"W-6",cfr:93.8},{w:"W-5",cfr:95.2},{w:"W-4",cfr:94.9},
  {w:"W-3",cfr:96.1},{w:"W-2",cfr:97.4},{w:"W-1",cfr:97.8},{w:"Now",cfr:97.8},
];
const CFR_ATTRIBUTION = [
  {cause:"Supply Shortfall",pct:54,cases:4800,col:C.red},
  {cause:"Demand Planning Gap",pct:25,cases:2200,col:C.orange},
  {cause:"DC Imbalance",pct:14,cases:1200,col:C.blue},
  {cause:"Carrier Issues",pct:7,cases:620,col:C.muted},
];
const CFR_BY_CUSTOMER = [
  {customer:"Amazon",cfr:99.1,target:98.0,short:0,trend:"up"},
  {customer:"PetSmart",cfr:98.2,target:98.0,short:180,trend:"up"},
  {customer:"Petco",cfr:97.1,target:97.0,short:410,trend:"flat"},
  {customer:"Walmart",cfr:95.8,target:98.0,short:1840,trend:"down"},
  {customer:"Chewy",cfr:94.2,target:97.0,short:2100,trend:"down"},
  {customer:"Target",cfr:91.4,target:96.0,short:4100,trend:"down"},
];
const CFR_RESOLUTION = [
  {id:"RC-001",cause:"Production Schedule Adherence",status:"IN_PROGRESS",owner:"J. Smith",due:"June 15"},
  {id:"RC-002",cause:"Demand Signal Accuracy",status:"OPEN",owner:"R. Patel",due:"June 30"},
  {id:"RC-003",cause:"DC Inventory Imbalance",status:"RESOLVED",owner:"T. Brown",due:"May 20"},
  {id:"RC-004",cause:"Carrier Capacity (Peak)",status:"IN_PROGRESS",owner:"M. Lee",due:"June 10"},
];

// Promo-Safety Stock linkage (Safety Stock enhancements)
const PROMO_SS_IMPACT = [
  {sku:"SKU-2241",desc:"WHISKAS Tender Bites Tuna 24ct",event:"Wet Food Week",dates:"June 3-9",
   current_ss:1400,baseline_rec:1800,promo_rec:3200,uplift:1800,status:"APPROVED",readiness:"AT RISK"},
  {sku:"SKU-3305",desc:"SHEBA PERFECT PORTIONS 72ct",event:"Summer Savings Event",dates:"June 15-30",
   current_ss:1800,baseline_rec:2400,promo_rec:3800,uplift:1400,status:"PENDING",readiness:"AT RISK"},
  {sku:"SKU-5521",desc:"ROYAL CANIN Indoor 7+ 6lb",event:"Premium Pet Event",dates:"July 4-18",
   current_ss:2100,baseline_rec:2100,promo_rec:3000,uplift:900,status:"APPROVED",readiness:"MONITOR"},
  {sku:"SKU-1188",desc:"PEDIGREE Adult Chicken 18lb",event:"Pet Nutrition Month",dates:"July 1-31",
   current_ss:2100,baseline_rec:3200,promo_rec:4800,uplift:1600,status:"PENDING",readiness:"AT RISK"},
];

// Manager dashboard data
const SARAH_BRIEFING = {
  orders_to_decide:ORDERS,
  cfr_week:97.8,cfr_target:98.0,cfr_delta:-0.2,
  fill_rate:97.8,fill_target:98.0,
  ss_at_risk:3,
  promos_unready:3,
  top_alerts:[
    {sev:"HIGH",title:"PEDIGREE 18lb: 1,800 cs gap on Walmart order",action:"Review SO-44019 in Order Triage",screen:"triage"},
    {sev:"HIGH",title:"SHEBA at DC-FL-04: STOCKOUT — Chewy order at risk",action:"Review SO-44021 in Order Triage",screen:"triage"},
    {sev:"MEDIUM",title:"Wet Food Week promo SS inadequate for SKU-2241",action:"Adjust safety stock before June 3",screen:"safetystock"},
  ],
};


// ── NETWORK TOPOLOGY DATA ─────────────────────────────────────────────────
const NETWORK_NODES = [
  {id:"plant-us01",name:"Plant US01",city:"Nashville, TN",type:"plant",lat:36.1627,lng:-86.7816,
   status:"warning",reason:"Production line 4 at 66% — packaging material shortage on PEDIGREE 18lb"},
  {id:"plant-us02",name:"Plant US02",city:"Dayton, OH",type:"plant",lat:39.7589,lng:-84.1916,
   status:"healthy",reason:"All production lines running at plan"},
  {id:"DC-TX-01",name:"DC-TX-01",city:"Dallas, TX",type:"dc",lat:32.7767,lng:-96.7970,
   status:"warning",reason:"PEDIGREE 18lb: 1,800 cs gap on Walmart SO-44019 · PRO-7781 adherence at 82%"},
  {id:"DC-NJ-02",name:"DC-NJ-02",city:"Newark, NJ",type:"dc",lat:40.7357,lng:-74.1724,
   status:"healthy",reason:"CFR 98.2% — all orders on track · PetSmart Wet Food Week ready"},
  {id:"DC-CA-03",name:"DC-CA-03",city:"Fresno, CA",type:"dc",lat:36.7378,lng:-119.7871,
   status:"warning",reason:"Target buffer-build order SO-44022 flagged · 3 agents signal BLOCK"},
  {id:"DC-FL-04",name:"DC-FL-04",city:"Orlando, FL",type:"dc",lat:28.5383,lng:-81.3792,
   status:"critical",reason:"SHEBA PERFECT PORTIONS: STOCKOUT · 1,100 cs on hand vs 3,200 ordered by Chewy"},
];
const NETWORK_CONNECTIONS = [
  {from:"plant-us01",to:"DC-TX-01",status:"warning",animated:true},
  {from:"plant-us01",to:"DC-FL-04",status:"critical",animated:true},
  {from:"plant-us02",to:"DC-NJ-02",status:"healthy"},
  {from:"plant-us01",to:"DC-CA-03",status:"healthy"},
  {from:"DC-NJ-02",to:"DC-FL-04",status:"warning",animated:true,label:"Transfer route"},
];

// ── PORTFOLIO DATA (agent pages) ─────────────────────────────────────────
const PORT_SUPPLY = {
  inventory:[
    {sku:"SKU-3305",desc:"SHEBA PERFECT PORTIONS 72ct",dc:"DC-FL-04",cs:1100,dos:3.2,status:"STOCKOUT",short:2100},
    {sku:"SKU-1188",desc:"PEDIGREE Adult Chicken 18lb",dc:"DC-TX-01",cs:4200,dos:9.5,status:"BELOW_SS",short:1800},
    {sku:"SKU-4417",desc:"TEMPTATIONS Classic 16oz",dc:"DC-CA-03",cs:6200,dos:22.1,status:"BELOW_SS",short:1800},
    {sku:"SKU-6634",desc:"IAMS Proactive Health Adult",dc:"DC-CA-03",cs:2100,dos:11.4,status:"BELOW_SS",short:900},
    {sku:"SKU-1188",desc:"PEDIGREE Adult Chicken 18lb",dc:"DC-NJ-02",cs:6800,dos:15.2,status:"OK",short:0},
    {sku:"SKU-2241",desc:"WHISKAS Tender Bites Tuna 24ct",dc:"DC-NJ-02",cs:5800,dos:26.1,status:"OK",short:0},
    {sku:"SKU-3305",desc:"SHEBA PERFECT PORTIONS 72ct",dc:"DC-NJ-02",cs:2900,dos:16.1,status:"OK",short:0},
    {sku:"SKU-5521",desc:"ROYAL CANIN Indoor 7+ 6lb",dc:"DC-TX-01",cs:3400,dos:18.2,status:"OK",short:0},
  ],
  production:[
    {pro:"PRO-7781",sku:"SKU-1188",desc:"PEDIGREE Adult Chicken 18lb",end:"2026-05-30",status:"REL",adherence:82.0,risk:"HIGH"},
    {pro:"PRO-8842",sku:"SKU-3305",desc:"SHEBA PERFECT PORTIONS 72ct",end:"2026-06-10",status:"REL",adherence:91.0,risk:"MEDIUM"},
    {pro:"PRO-9104",sku:"SKU-4417",desc:"TEMPTATIONS Classic 16oz",end:"2026-06-12",status:"REL",adherence:88.0,risk:"MEDIUM"},
    {pro:"PRO-9220",sku:"SKU-5521",desc:"ROYAL CANIN Indoor 7+ 6lb",end:"2026-06-08",status:"REL",adherence:97.0,risk:"LOW"},
    {pro:"PRO-9301",sku:"SKU-6634",desc:"IAMS Proactive Health Adult",end:"2026-06-15",status:"CRTD",adherence:95.0,risk:"LOW"},
    {pro:"PRO-9415",sku:"SKU-2241",desc:"WHISKAS Tender Bites Tuna 24ct",end:"2026-07-02",status:"CRTD",adherence:96.0,risk:"LOW"},
  ],
  raw_materials:[
    {material:"Chicken Meal (Animal Protein)",concern:true,dos:7,rationale:"Single-sourced; supplier lead time 14d",skus:"SKU-1188, SKU-5521"},
    {material:"Ocean Tuna (Co-Manufacturer)",concern:false,dos:28,rationale:"Two approved suppliers; adequate stock",skus:"SKU-2241"},
    {material:"Lamb Meal & Rice Blend",concern:false,dos:21,rationale:"Stable supply; no constraint",skus:"SKU-3305"},
    {material:"Turkey & Whole Grain Blend",concern:false,dos:35,rationale:"Healthy buffer; no action needed",skus:"SKU-4417, SKU-6634"},
  ],
};

const PORT_DEMAND = {
  positions:[
    {customer:"Target",sku:"SKU-4417",desc:"TEMPTATIONS Classic 16oz",vs_plan:110,plan_cs:3800,
     classification:"BUFFER_BUILD",conf:0.88,wmape:21.3,bias:8.4,quality:"SYSTEMATIC_OVER",promo:false,escalation:true},
    {customer:"Walmart",sku:"SKU-1188",desc:"PEDIGREE Adult Chicken 18lb",vs_plan:58,plan_cs:3800,
     classification:"ONE_OFF_ANOMALY",conf:0.72,wmape:18.5,bias:-6.0,quality:"SYSTEMATIC_UNDER",promo:false,escalation:false},
    {customer:"Walmart",sku:"SKU-6634",desc:"IAMS Proactive Health Adult",vs_plan:22,plan_cs:2100,
     classification:"GENUINE_PULL",conf:0.74,wmape:19.8,bias:4.5,quality:"SYSTEMATIC_UNDER",promo:false,escalation:false},
    {customer:"Chewy",sku:"SKU-3305",desc:"SHEBA PERFECT PORTIONS 72ct",vs_plan:14,plan_cs:2800,
     classification:"GENUINE_PULL",conf:0.81,wmape:14.1,bias:3.2,quality:"HEALTHY",promo:false,escalation:false},
    {customer:"PetSmart",sku:"SKU-5521",desc:"ROYAL CANIN Indoor 7+ 6lb",vs_plan:-8,plan_cs:1200,
     classification:"GENUINE_PULL",conf:0.77,wmape:15.2,bias:-2.1,quality:"HEALTHY",promo:false,escalation:false},
    {customer:"PetSmart",sku:"SKU-2241",desc:"WHISKAS Tender Bites Tuna 24ct",vs_plan:0,plan_cs:4500,
     classification:"PROMO_DRIVEN",conf:0.89,wmape:12.4,bias:-1.2,quality:"HEALTHY",promo:true,escalation:false},
  ],
  promo_calendar:[
    {customer:"PetSmart",sku:"SKU-2241",name:"Wet Food Week",type:"FEATURE_AND_DISPLAY",dates:"June 3–9",incr:2800,status:"APPROVED"},
    {customer:"Chewy",sku:"SKU-3305",name:"Summer Savings Event",type:"PRICE_REDUCTION",dates:"June 15–30",incr:1200,status:"PENDING"},
    {customer:"Target",sku:"SKU-5521",name:"Premium Pet Event",type:"END_CAP_DISPLAY",dates:"July 4–18",incr:900,status:"APPROVED"},
    {customer:"Walmart",sku:"SKU-1188",name:"Pet Nutrition Month",type:"FEATURE",dates:"July 1–31",incr:2200,status:"PENDING"},
  ],
};

const PORT_TRANSPORT = {
  lanes:[
    {id:"NJ-PS",lane:"DC-NJ-02 → PetSmart NE",origin:"DC-NJ-02",dest:"PetSmart NE",transit:28,otp:0.96,ships:82,viable:true,carrier:"Old Dominion"},
    {id:"TX-JH",lane:"DC-TX-01 → Walmart SE",origin:"DC-TX-01",dest:"Walmart SE",transit:38,otp:0.91,ships:64,viable:true,carrier:"J.B. Hunt"},
    {id:"NJ-AM",lane:"DC-NJ-02 → Amazon NE",origin:"DC-NJ-02",dest:"Amazon NE",transit:24,otp:0.98,ships:120,viable:true,carrier:"Amazon Freight"},
    {id:"TX-WE",lane:"DC-TX-01 → Petco SW",origin:"DC-TX-01",dest:"Petco SW",transit:36,otp:0.93,ships:58,viable:true,carrier:"Werner Enterprises"},
    {id:"FL-EX",lane:"DC-FL-04 → Chewy SE",origin:"DC-FL-04",dest:"Chewy SE",transit:44,otp:0.84,ships:38,viable:true,carrier:"Estes Express"},
    {id:"CA-XP",lane:"DC-CA-03 → Target West",origin:"DC-CA-03",dest:"Target West",transit:52,otp:0.78,ships:45,viable:false,carrier:"XPO Logistics"},
  ],
  carriers:[
    {name:"Amazon Freight",otp:0.98,target:0.98,ships:120,cb:0,meets:true},
    {name:"J.B. Hunt",otp:0.972,target:0.95,ships:64,cb:3,meets:true},
    {name:"Old Dominion Freight",otp:0.965,target:0.95,ships:82,cb:1,meets:true},
    {name:"Werner Enterprises",otp:0.93,target:0.92,ships:58,cb:2,meets:true},
    {name:"Estes Express",otp:0.84,target:0.95,ships:38,cb:5,meets:false},
    {name:"XPO Logistics",otp:0.78,target:0.92,ships:45,cb:8,meets:false},
  ],
  otif:[
    {customer:"Amazon",otif:0.98,target:0.98,delta:0.0,cb:0,exposure:0},
    {customer:"PetSmart",otif:0.96,target:0.95,delta:1.0,cb:1,exposure:4200},
    {customer:"Petco",otif:0.91,target:0.92,delta:-1.0,cb:2,exposure:8900},
    {customer:"Walmart",otif:0.88,target:0.95,delta:-7.0,cb:3,exposure:24500},
    {customer:"Chewy",otif:0.81,target:0.95,delta:-14.0,cb:5,exposure:57600},
    {customer:"Target",otif:0.79,target:0.92,delta:-13.0,cb:8,exposure:89400},
  ],
};

const PORT_RETAIL = {
  classifications:[
    {customer:"Target",sku:"SKU-4417",desc:"TEMPTATIONS Classic 16oz",
     cls:"BUFFER_BUILD",conf:0.91,pos:48000,trend:"FLAT",ohi:28,ohi_norm:22,promo:false,risk:5},
    {customer:"PetSmart",sku:"SKU-5521",desc:"ROYAL CANIN Indoor 7+",
     cls:"GENUINE_PULL",conf:0.77,pos:29000,trend:"DECELERATING",ohi:24,ohi_norm:22,promo:false,risk:3},
    {customer:"Walmart",sku:"SKU-6634",desc:"IAMS Proactive Health Adult",
     cls:"GENUINE_PULL",conf:0.74,pos:38000,trend:"FLAT",ohi:19,ohi_norm:22,promo:false,risk:2},
    {customer:"Petco",sku:"SKU-1188",desc:"PEDIGREE Adult Chicken 18lb",
     cls:"GENUINE_PULL",conf:0.79,pos:42000,trend:"FLAT",ohi:20,ohi_norm:22,promo:false,risk:2},
    {customer:"Chewy",sku:"SKU-3305",desc:"SHEBA PERFECT PORTIONS 72ct",
     cls:"GENUINE_PULL",conf:0.85,pos:52000,trend:"FLAT",ohi:null,ohi_norm:null,promo:false,risk:2},
    {customer:"Walmart",sku:"SKU-1188",desc:"PEDIGREE Adult Chicken 18lb",
     cls:"GENUINE_PULL",conf:0.87,pos:91000,trend:"ACCELERATING",ohi:8,ohi_norm:22,promo:false,risk:2},
    {customer:"Amazon",sku:"SKU-2241",desc:"WHISKAS Tender Bites Tuna 24ct",
     cls:"GENUINE_PULL",conf:0.82,pos:64000,trend:"ACCELERATING",ohi:14,ohi_norm:18,promo:true,risk:1},
    {customer:"PetSmart",sku:"SKU-2241",desc:"WHISKAS Tender Bites Tuna 24ct",
     cls:"PROMO_DRIVEN",conf:0.88,pos:74000,trend:"ACCELERATING",ohi:18,ohi_norm:22,promo:true,risk:1},
  ],
  pos_trends:[
    {sku:"SKU-1188",desc:"PEDIGREE Adult Chicken 18lb",trend:"ACCELERATING",acv:78.0,
     weekly:[{w:"W1",v:74},{w:"W2",v:76},{w:"W3",v:79},{w:"W4",v:82},{w:"W5",v:85},{w:"W6",v:88},{w:"W7",v:91},{w:"W8",v:91}]},
    {sku:"SKU-2241",desc:"WHISKAS Tender Bites Tuna 24ct",trend:"ACCELERATING",acv:82.0,
     weekly:[{w:"W1",v:58},{w:"W2",v:60},{w:"W3",v:61},{w:"W4",v:62},{w:"W5",v:65},{w:"W6",v:68},{w:"W7",v:74},{w:"W8",v:74}]},
    {sku:"SKU-3305",desc:"SHEBA PERFECT PORTIONS 72ct",trend:"FLAT",acv:64.0,
     weekly:[{w:"W1",v:50},{w:"W2",v:52},{w:"W3",v:51},{w:"W4",v:53},{w:"W5",v:52},{w:"W6",v:51},{w:"W7",v:52},{w:"W8",v:52}]},
    {sku:"SKU-4417",desc:"TEMPTATIONS Classic 16oz",trend:"FLAT",acv:71.0,
     weekly:[{w:"W1",v:49},{w:"W2",v:48},{w:"W3",v:49},{w:"W4",v:47},{w:"W5",v:48},{w:"W6",v:49},{w:"W7",v:48},{w:"W8",v:48}]},
    {sku:"SKU-5521",desc:"ROYAL CANIN Indoor 7+",trend:"DECELERATING",acv:55.0,
     weekly:[{w:"W1",v:32},{w:"W2",v:31},{w:"W3",v:30},{w:"W4",v:29},{w:"W5",v:30},{w:"W6",v:29},{w:"W7",v:29},{w:"W8",v:28}]},
  ],
};

// ── TOP BAR ─────────────────────────────────────────────────────────────────
function TopBar(){
  return (
    <header style={{height:56,borderBottom:`2px solid ${C.red}`,background:"#fff",
      display:"flex",alignItems:"center",padding:"0 20px 0 16px",flexShrink:0,
      boxShadow:"0 1px 2px rgba(0,0,0,0.05)"}}>
      <div style={{display:"flex",flexDirection:"column",marginRight:20,flexShrink:0}}>
        <span style={{fontWeight:700,color:C.red,fontSize:14,lineHeight:1.2}}>Mars Pet Nutrition</span>
        <span style={{color:C.muted,fontSize:10,letterSpacing:"0.04em"}}>OpEx Tower — Customer Supply</span>
      </div>
      <div style={{width:1,height:32,background:C.border,marginRight:20,flexShrink:0}}/>
      <div style={{display:"flex",alignItems:"center",flex:1,gap:0}}>
        {[
          {label:"Network CFR",value:"97.8%",color:C.green},
          {label:"Fines at Risk 7D",value:"$412K",color:C.red},
          {label:"Rev Preserved MTD",value:"$1.24M",color:C.charcoal},
          {label:"Agent Accept Rate",value:"83%",color:C.blue},
        ].map((k,i,a)=>(
          <div key={k.label} style={{display:"flex",flexDirection:"column",
            paddingRight:18,marginRight:18,flexShrink:0,
            borderRight:i<a.length-1?`1px solid ${C.border}`:"none"}}>
            <span style={{fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",
              color:C.muted,fontWeight:600,marginBottom:1}}>{k.label}</span>
            <span style={{fontSize:17,fontWeight:700,color:k.color,
              fontFamily:MONO,lineHeight:1}}>{k.value}</span>
          </div>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",
          borderRadius:20,border:"1px solid #fcd34d",fontSize:9,fontWeight:700,
          color:"#92400e",background:"#fffbeb",textTransform:"uppercase",
          letterSpacing:"0.07em"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"#f59e0b",
            display:"inline-block"}}/>
          Mock Data
        </div>
        <div style={{width:32,height:32,borderRadius:"50%",background:C.off,
          border:`1px solid ${C.border}`,display:"flex",alignItems:"center",
          justifyContent:"center",fontSize:11,fontWeight:700,color:C.charcoal}}>
          SO
        </div>
      </div>
    </header>
  );
}

// ── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({screen,setScreen}){
  const [col,setCol]=useState(false);
  const navItems=[
    {id:"watchtower",label:"Watchtower",Icon:LayoutDashboard},
    {id:"triage",label:"Order Triage",Icon:Inbox,badge:5},
    {id:"simulator",label:"Fulfillment Simulator",Icon:GitMerge},
    {id:"rootcause",label:"Root Cause Hub",Icon:FileSearch},
    {id:"safetystock",label:"Safety Stock Optimizer",Icon:ShieldCheck},
    {id:"divider"},
    {id:"manager",label:"My Dashboard",Icon:Home},
    {id:"decisions",label:"Decision Log",Icon:Clock},
  ];
  const agentItems=[
    {id:"agent-supply",label:"Supply Planning",Icon:BarChart2,color:C.blue},
    {id:"agent-demand",label:"Demand Planning",Icon:TrendingUp,color:C.orange},
    {id:"agent-transport",label:"Transportation",Icon:Truck,color:C.teal},
    {id:"agent-retail",label:"Retail Intelligence",Icon:ShoppingCart,color:C.purple},
  ];
  return (
    <nav style={{width:col?60:220,background:"#fff",borderRight:`1px solid ${C.border}`,
      display:"flex",flexDirection:"column",flexShrink:0,transition:"width 0.18s",
      overflowX:"hidden",overflowY:"hidden"}}>
      <div style={{height:56,padding:col?"0":"0 12px",borderBottom:`1px solid ${C.border}`,
        display:"flex",alignItems:"center",justifyContent:col?"center":"space-between",
        flexShrink:0}}>
        {!col&&<span style={{fontSize:10,fontWeight:600,color:C.muted,
          textTransform:"uppercase",letterSpacing:"0.1em"}}>Workspace</span>}
        <button onClick={()=>setCol(c=>!c)} style={{background:"none",border:"none",
          cursor:"pointer",color:C.muted,display:"flex",alignItems:"center",padding:4}}>
          {col?<ChevronRight size={15}/>:<ChevronLeft size={15}/>}
        </button>
      </div>
      <div style={{flex:1,overflowY:"auto",overflowX:"hidden",paddingTop:6}}>
        {navItems.map(item=>{
          if(item.id==="divider") return (
            <div key="div" style={{display:col?"none":"block",margin:"6px 12px 2px",
              borderTop:`1px solid ${C.border}`,paddingTop:6,fontSize:9,color:C.muted,
              textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:600}}>New in v2</div>
          );
          if(item.id==="divider-info") return (
            <div key="div-info" style={{display:col?"none":"block",margin:"6px 12px 2px",
              borderTop:`1px solid ${C.border}`,paddingTop:6,fontSize:9,color:C.muted,
              textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:600}}>Info</div>
          );
          const {Icon}=item;
          const active=screen===item.id;
          return (
            <button key={item.id} onClick={()=>setScreen(item.id)} style={{
              display:"flex",alignItems:"center",gap:col?0:10,width:"100%",
              padding:col?"11px 0":"9px 16px",border:"none",cursor:"pointer",
              fontFamily:"inherit",textAlign:"left",justifyContent:col?"center":"flex-start",
              background:active?C.redLight:"transparent",
              borderRight:active?`3px solid ${C.red}`:"3px solid transparent",
              color:active?C.charcoal:C.muted,fontSize:13,fontWeight:active?600:500,
            }}>
              <Icon size={17} color={active?C.red:C.muted}
                strokeWidth={active?2.5:1.8} style={{flexShrink:0}}/>
              {!col&&<span style={{flex:1,whiteSpace:"nowrap"}}>{item.label}</span>}
              {!col&&item.badge&&<span style={{background:C.red,color:"#fff",
                borderRadius:10,padding:"1px 6px",fontSize:10,fontWeight:700}}>
                {item.badge}</span>}
            </button>
          );
        })}
        <div style={{display:col?"none":"block",margin:"8px 12px 2px",
          borderTop:`1px solid ${C.border}`,paddingTop:6,fontSize:9,color:C.muted,
          textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:600}}>Agent Views</div>
        {agentItems.map(({id,label,Icon,color})=>{
          const active=screen===id;
          return (
            <button key={id} onClick={()=>setScreen(id)} style={{
              display:"flex",alignItems:"center",gap:col?0:9,width:"100%",
              padding:col?"9px 0":"7px 16px",border:"none",cursor:"pointer",
              fontFamily:"inherit",textAlign:"left",justifyContent:col?"center":"flex-start",
              background:active?`${color}12`:"transparent",
              borderRight:active?`3px solid ${color}`:"3px solid transparent",
              color:active?color:C.muted,fontSize:12,fontWeight:active?600:500,
            }}>
              <Icon size={15} color={active?color:C.muted}
                strokeWidth={active?2.5:1.8} style={{flexShrink:0}}/>
              {!col&&<span>{label}</span>}
            </button>
          );
        })}
        {/* Info section */}
        <div style={{display:col?"none":"block",margin:"8px 12px 2px",
          borderTop:`1px solid ${C.border}`,paddingTop:6,fontSize:9,color:C.muted,
          textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:600}}>Info</div>
        <button onClick={()=>setScreen("datahealth")} style={{
          display:"flex",alignItems:"center",gap:col?0:10,width:"100%",
          padding:col?"11px 0":"9px 16px",border:"none",cursor:"pointer",
          fontFamily:"inherit",textAlign:"left",justifyContent:col?"center":"flex-start",
          background:screen==="datahealth"?C.redLight:"transparent",
          borderRight:screen==="datahealth"?`3px solid ${C.red}`:"3px solid transparent",
          color:screen==="datahealth"?C.charcoal:C.muted,fontSize:13,fontWeight:screen==="datahealth"?600:500,
        }}>
          <Activity size={17} color={screen==="datahealth"?C.red:C.muted}
            strokeWidth={screen==="datahealth"?2.5:1.8} style={{flexShrink:0}}/>
          {!col&&<span style={{flex:1,whiteSpace:"nowrap"}}>Data Health</span>}
        </button>
        <button onClick={()=>setScreen("dictionary")} style={{
          display:"flex",alignItems:"center",gap:col?0:10,width:"100%",
          padding:col?"11px 0":"9px 16px",border:"none",cursor:"pointer",
          fontFamily:"inherit",textAlign:"left",justifyContent:col?"center":"flex-start",
          background:screen==="dictionary"?C.redLight:"transparent",
          borderRight:screen==="dictionary"?`3px solid ${C.red}`:"3px solid transparent",
          color:screen==="dictionary"?C.charcoal:C.muted,fontSize:13,
          fontWeight:screen==="dictionary"?600:500,
        }}>
          <BookOpen size={17} color={screen==="dictionary"?C.red:C.muted}
            strokeWidth={screen==="dictionary"?2.5:1.8} style={{flexShrink:0}}/>
          {!col&&<span style={{flex:1,whiteSpace:"nowrap"}}>Data Dictionary</span>}
        </button>
      </div>
      {!col&&(
        <div style={{padding:"8px 14px",borderTop:`1px solid ${C.border}`,
          fontSize:9,color:C.muted}}>
          © 2026 Mars, Incorporated
        </div>
      )}
    </nav>
  );
}

// ── NETWORK TOPOLOGY MAP ─────────────────────────────────────────────────
function NetworkTopologyMap(){
  const [hovered,setHovered]=useState(null);
  const [mousePos,setMousePos]=useState({x:0,y:0});
  const svgRef=useRef(null);
  const W=720, H=390;

  // Equirectangular projection centred on continental US.
  // centre: (-96.5°lng, 37.5°lat), scale: 11.8px/°lng, 14.8px/°lat
  const px=(lat,lng)=>[
    Math.round(W/2+(lng+96.5)*11.8),
    Math.round(H/2-(lat-37.5)*14.8)
  ];

  // ── Hardcoded continental US border (simplified, ~34 key points, clockwise) ──
  // Points computed via equirectangular formula above so they align with node positions.
  const US_BORDER=[
    [27,25],   // WA — Pacific / Canada corner
    [59,47],   // Puget Sound
    [36,69],   // OR coast
    [36,128],  // OR/CA coast
    [53,195],  // San Francisco
    [77,239],  // Point Conception
    [117,266], // San Diego
    [148,269], // CA/AZ — Colorado River
    [213,284], // AZ/NM corner
    [242,281], // El Paso TX
    [266,313], // Big Bend TX
    [349,367], // Brownsville TX
    [437,306], // New Orleans / Gulf Coast
    [472,302], // AL / FL panhandle
    [508,299], // FL panhandle east
    [525,337], // Tampa area
    [534,385], // South Florida tip
    [552,368], // Miami / SE Florida
    [548,328], // East FL coast
    [608,228], // Cape Hatteras NC
    [602,204], // Virginia Beach VA
    [614,180], // Delaware Bay
    [639,148], // Long Island NY
    [673,128], // Cape Cod MA
    [708,87],  // Easternmost Maine
    [682,54],  // Maine coast
    [620,84],  // VT/NY — Canada border
    [519,121], // Buffalo / Lake Erie south shore
    [502,62],  // Lake Superior south
    [460,40],  // Lake Superior NW
    [354,25],  // North Dakota — Canada border
    [213,25],  // Montana — Canada border
  ];
  const US_PATH="M"+US_BORDER.map(([x,y])=>`${x},${y}`).join(" L")+" Z";

  // Simplified Great Lakes (as water cutouts)
  const LAKES=[
    // Lake Superior
    "M460,40 L502,48 L510,56 L496,62 L476,58 L462,50 Z",
    // Lake Michigan
    "M484,80 L490,110 L484,128 L476,110 L478,88 Z",
    // Lake Erie
    "M519,105 L538,108 L540,118 L522,122 L510,118 Z",
    // Lake Ontario
    "M560,90 L582,92 L580,102 L564,104 L552,98 Z",
  ];

  // Storm overlay position
  const [stx,sty]=px(36.5,-86.0);

  const connColor=s=>s==="critical"?C.red:s==="warning"?C.orange:C.green;
  const nodeColor=s=>s==="critical"?C.red:s==="warning"?C.orange:C.green;

  const onMove=e=>{
    if(!svgRef.current)return;
    const r=svgRef.current.getBoundingClientRect();
    setMousePos({x:e.clientX-r.left,y:e.clientY-r.top});
  };

  return (
    <div style={{position:"relative",borderRadius:8,overflow:"hidden",
      border:`1px solid ${C.border}`,background:"#c4d4e8"}}
      onMouseMove={onMove}>
      <style>{`
        @keyframes mapdash{to{stroke-dashoffset:-14}}
        .map-anim-dash{animation:mapdash 0.8s linear infinite}
        @keyframes mapp{0%,100%{opacity:0.25}50%{opacity:0.6}}
        .map-pulse{animation:mapp 1.8s ease-in-out infinite}
      `}</style>
      <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
        style={{display:"block",height:390}}>

        {/* Ocean background */}
        <rect width={W} height={H} fill="#c4d4e8"/>

        {/* US land fill */}
        <path d={US_PATH} fill="#e4ebf4" stroke="#b8cde0" strokeWidth={1.2}
          strokeLinejoin="round"/>

        {/* Great Lakes (water, same colour as ocean) */}
        {LAKES.map((d,i)=>(
          <path key={i} d={d} fill="#c4d4e8" stroke="#b8cde0" strokeWidth={0.6}/>
        ))}

        {/* Storm disruption overlay */}
        <g transform={`translate(${stx},${sty})`} style={{pointerEvents:"none"}}>
          <ellipse rx={36} ry={23} fill="#94a3b8" fillOpacity={0.32}/>
          <ellipse rx={36} ry={23} fill="none" stroke="#64748b"
            strokeWidth={0.8} strokeDasharray="3 2"/>
          <text y={2} fill="#334155" fontSize={7} fontWeight={700}
            textAnchor="middle" letterSpacing="0.5">⛈ STORM RISK</text>
        </g>

        {/* Connection lines */}
        {NETWORK_CONNECTIONS.map((conn,i)=>{
          const fn=NETWORK_NODES.find(n=>n.id===conn.from);
          const tn=NETWORK_NODES.find(n=>n.id===conn.to);
          if(!fn||!tn)return null;
          const [x1,y1]=px(fn.lat,fn.lng);
          const [x2,y2]=px(tn.lat,tn.lng);
          const col=connColor(conn.status);
          const mx=(x1+x2)/2, my=(y1+y2)/2-20;
          return (
            <path key={i} d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
              fill="none" stroke={col} strokeWidth={conn.animated?2.5:2}
              strokeDasharray={conn.animated?"7 5":"none"}
              className={conn.animated?"map-anim-dash":""}
              strokeOpacity={0.9}/>
          );
        })}

        {/* Nodes */}
        {NETWORK_NODES.map(node=>{
          const [x,y]=px(node.lat,node.lng);
          const col=nodeColor(node.status);
          const hov=hovered&&hovered.id===node.id;
          return (
            <g key={node.id} transform={`translate(${x},${y})`}
              onMouseEnter={()=>setHovered(node)}
              onMouseLeave={()=>setHovered(null)}
              style={{cursor:"pointer"}}>
              {node.status!=="healthy"&&(
                <circle r={18} fill={col} fillOpacity={0.15} className="map-pulse"/>
              )}
              {node.type==="plant"?(
                <rect x={-7} y={-7} width={14} height={14} rx={2}
                  fill={col} stroke="#fff" strokeWidth={hov?2.5:2}/>
              ):(
                <circle r={hov?8:6.5} fill={col} stroke="#fff" strokeWidth={2}/>
              )}
              {node.status==="critical"&&(
                <g transform="translate(5,-5)">
                  <circle r={5} fill={C.red} stroke="#fff" strokeWidth={1}/>
                  <text y={3.5} fill="#fff" fontSize={8} fontWeight={900}
                    textAnchor="middle">!</text>
                </g>
              )}
              <text x={0} y={node.type==="plant"?20:18}
                fill="#1e293b" fontSize={9.5} fontWeight={700} textAnchor="middle"
                paintOrder="stroke" stroke="#e4ebf4" strokeWidth={3} strokeLinejoin="round">
                {node.name}
              </text>
              <text x={0} y={node.type==="plant"?30:28}
                fill="#475569" fontSize={7.5} textAnchor="middle"
                paintOrder="stroke" stroke="#e4ebf4" strokeWidth={2.5} strokeLinejoin="round">
                {node.city.split(",")[0]}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {hovered&&(
        <div style={{position:"absolute",
          left:Math.min(mousePos.x+14,W-230),
          top:Math.max(mousePos.y-64,8),
          background:"#1e293b",color:"#fff",padding:"8px 12px",
          borderRadius:8,fontSize:11,maxWidth:220,pointerEvents:"none",
          zIndex:10,boxShadow:"0 4px 14px rgba(0,0,0,0.35)"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
            <span style={{display:"inline-block",width:8,height:8,
              borderRadius:hovered.type==="plant"?2:"50%",
              background:nodeColor(hovered.status)}}/>
            <span style={{fontWeight:700}}>{hovered.name}</span>
            <span style={{fontSize:9,background:nodeColor(hovered.status),
              color:"#fff",borderRadius:3,padding:"1px 5px",fontWeight:700,
              textTransform:"uppercase"}}>{hovered.status}</span>
          </div>
          <div style={{fontSize:10,color:"#94a3b8",marginBottom:4}}>{hovered.city}</div>
          <div style={{fontSize:10,color:"#cbd5e1",lineHeight:1.5}}>{hovered.reason}</div>
        </div>
      )}

      {/* Legend */}
      <div style={{position:"absolute",bottom:10,left:10,display:"flex",gap:12,
        background:"rgba(255,255,255,0.93)",padding:"5px 10px",borderRadius:6,
        border:`1px solid ${C.border}`,fontSize:10,fontWeight:600,color:C.charcoal}}>
        <span style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{display:"inline-block",width:9,height:9,borderRadius:2,background:C.green}}/> Healthy
        </span>
        <span style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{display:"inline-block",width:9,height:9,borderRadius:"50%",background:C.orange}}/> Caution
        </span>
        <span style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{display:"inline-block",width:9,height:9,borderRadius:"50%",background:C.red}}/> Critical
        </span>
        <span style={{display:"flex",alignItems:"center",gap:4,marginLeft:4,paddingLeft:8,borderLeft:`1px solid ${C.border}`}}>
          <span style={{display:"inline-block",width:10,height:4,borderRadius:1,background:C.charcoal}}/> ■ Plant
        </span>
        <span style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{display:"inline-block",width:9,height:9,borderRadius:"50%",background:C.charcoal}}/> DC
        </span>
      </div>
    </div>
  );
}

// ── UC-1 WATCHTOWER ──────────────────────────────────────────────────────────
function Watchtower(){
  const {kpis,alerts}=WATCHTOWER_DATA;
  return (
    <div style={{padding:24,maxWidth:1200}}>
      <div style={{marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:C.charcoal}}>Agent Watchtower</div>
          <div style={{fontSize:12,color:C.muted,marginTop:2}}>Operational visibility &amp; predictive alerts — Mars Pet Nutrition</div>
        </div>
        <div style={{padding:"4px 12px",background:"#edf7ee",border:`1px solid ${C.green}`,
          borderRadius:20,fontSize:10,fontWeight:700,color:C.green,letterSpacing:"0.08em",textTransform:"uppercase"}}>
          Network Health: Stable
        </div>
      </div>

      {/* Impact Ribbon */}
      <div style={{background:C.charcoal,borderRadius:10,padding:"14px 24px",
        display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:0,marginBottom:20}}>
        {[
          {label:"Demurrage Avoided This Week",value:"$34,000",color:C.teal},
          {label:"Cases at Risk This Week",value:"14,200",color:C.orange},
          {label:"Agent Acceptance Rate",value:"83%",color:C.green},
        ].map((k,i)=>(
          <div key={k.label} style={{textAlign:"center",padding:"4px 0",
            borderLeft:i>0?`1px solid #3a3a3a`:"none"}}>
            <div style={{fontSize:26,fontWeight:700,color:k.color,letterSpacing:"0.02em",fontFamily:MONO}}>{k.value}</div>
            <div style={{fontSize:9,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.12em",marginTop:4}}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* KPI Strip */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:12,marginBottom:20}}>
        {kpis.map(k=>(
          <div key={k.label} style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:"13px 16px",
            borderTop:k.alert?`3px solid ${C.orange}`:`3px solid ${C.red}`}}>
            <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:21,fontWeight:700,color:C.charcoal,lineHeight:1,fontFamily:MONO}}>{k.value}</div>
            {k.delta&&<div style={{fontSize:11,marginTop:4,color:k.up===true?C.green:k.up===false?C.red:C.muted}}>{k.delta}</div>}
            <div style={{fontSize:10,color:C.muted,marginTop:4}}>Target: {k.target}</div>
          </div>
        ))}
      </div>

      {/* Main layout: Alerts left + Map right */}
      <div style={{display:"grid",gridTemplateColumns:"340px 1fr",gap:16}}>
        {/* Alert Inbox */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>
              Agent Priority Inbox
            </div>
            <span style={{fontSize:10,background:`${C.red}18`,color:C.red,fontWeight:700,
              borderRadius:10,padding:"1px 8px"}}>{alerts.length} Alerts</span>
          </div>
          {alerts.map(a=>{
            const isCrit=a.sev==="HIGH";
            const bc=sevColor(a.sev);
            return (
              <div key={a.id} style={{background:"#fff",borderLeft:`4px solid ${bc}`,
                padding:14,borderRadius:6,boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:9,fontWeight:700,color:bc,background:`${bc}15`,
                    borderRadius:3,padding:"2px 6px",letterSpacing:"0.06em",textTransform:"uppercase"}}>
                    {a.sev}: Alert
                  </span>
                  <span style={{fontSize:10,color:C.muted}}>{a.time}</span>
                </div>
                <div style={{fontSize:13,fontWeight:700,color:C.charcoal,marginBottom:4,lineHeight:1.35}}>{a.title}</div>
                <div style={{fontSize:11,color:C.muted,lineHeight:1.5,paddingBottom:10,marginBottom:10,
                  borderBottom:`1px solid ${C.border}`}}>{a.detail}</div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{fontSize:11,fontWeight:700,color:C.charcoal}}>Risk: see triage</span>
                  <button style={{padding:"4px 12px",background:isCrit?C.charcoal:"transparent",
                    color:isCrit?"#fff":C.red,border:isCrit?"none":`1px solid ${C.border}`,
                    borderRadius:4,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                    {isCrit?"Resolve →":"Review"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Topology Map */}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:"0.1em"}}>
            Network Constraint Topology
          </div>
          <NetworkTopologyMap/>
        </div>
      </div>
    </div>
  );
}

// ── AGENT CARD (expanded) ───────────────────────────────────────────────────
function AgentCard({agentKey,steps,signal,done}){
  const meta=AGENT_LABELS[agentKey];
  const logRef=useRef(null);
  useEffect(()=>{if(logRef.current)logRef.current.scrollTop=logRef.current.scrollHeight;},[steps]);
  return (
    <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:14,
      borderTop:`3px solid ${meta.color}`,display:"flex",flexDirection:"column",gap:10}}>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{fontSize:12,fontWeight:700,color:meta.color}}>{meta.label}</div>
        {done&&signal
          ?<Pill label={signal.disposition} color={dispColor(signal.disposition)} size={10}/>
          :steps.length>0
            ?<span style={{fontSize:10,color:C.muted}}>Working<Blinker/></span>
            :<span style={{fontSize:10,color:C.muted}}>Waiting<Blinker/></span>}
      </div>

      {/* Terminal log */}
      <div ref={logRef} style={{height:64,overflowY:"auto",background:"#1a1a1a",borderRadius:4,
        padding:"5px 8px",fontFamily:"monospace",fontSize:10,color:"#ccc",flexShrink:0}}>
        {steps.map((s,i)=>(
          <div key={i} style={{marginBottom:2}}>
            <span style={{color:s.action==="response"?meta.color:"#555",marginRight:4}}>
              {s.action==="response"?"◆":s.action==="tool_call"?"->":"·"}
            </span>
            {s.action==="tool_call"
              ?<><span style={{color:"#999"}}>{s.tool}</span><span style={{color:"#555"}}> — {s.result}</span></>
              :<span style={{color:"#eee"}}>{s.result}</span>}
          </div>
        ))}
      </div>

      {/* Full signal KPIs — shown once agent completes */}
      {done&&signal&&signal.full_signal&&(
        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10}}>
          {renderFullSignal(agentKey,signal.full_signal,meta.color)}
        </div>
      )}

      {/* Summary + confidence bar — always shown when done */}
      {done&&signal&&(
        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10}}>
          <div style={{fontSize:11,color:C.charcoal,lineHeight:1.45,marginBottom:8,fontStyle:"italic"}}>
            {signal.summary}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:10,color:C.muted,flexShrink:0}}>Confidence</span>
            <div style={{flex:1,height:4,background:C.border,borderRadius:2}}>
              <div style={{width:`${signal.confidence*100}%`,height:"100%",background:meta.color,borderRadius:2}}/>
            </div>
            <span style={{color:meta.color,fontWeight:700,fontSize:11}}>{Math.round(signal.confidence*100)}%</span>
          </div>
          {signal.hard_block&&(
            <div style={{marginTop:8,display:"inline-block",background:C.red,color:"#fff",
              borderRadius:4,padding:"3px 10px",fontSize:11,fontWeight:700}}>HARD BLOCK RAISED</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── RECOMMENDATION CARD ──────────────────────────────────────────────────────
function RecommendationCard({syn,onApprove,onReject,decided}){
  const r=syn.rec;
  const [rejectMode,setRejectMode]=useState(false);
  const [reason,setReason]=useState("");
  const escKeys=Object.keys(syn.escalations).filter(k=>syn.escalations[k]);
  return (
    <div style={{border:`2px solid ${actColor(r.action)}`,borderRadius:10,overflow:"hidden",background:"#fff"}}>
      <div style={{background:actColor(r.action),padding:"13px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{color:"#fff"}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",opacity:0.8}}>CUSTOMER SUPPLY · RECOMMENDATION</div>
          <div style={{fontSize:22,fontWeight:900,letterSpacing:"0.04em",marginTop:3}}>{r.action.replace(/_/g," ")}</div>
        </div>
        <div style={{textAlign:"right",color:"#fff"}}>
          <div style={{fontSize:11,opacity:0.8}}>Confidence</div>
          <div style={{fontSize:26,fontWeight:900}}>{Math.round(r.confidence*100)}%</div>
        </div>
      </div>
      <div style={{padding:20,display:"flex",flexDirection:"column",gap:14}}>
        {r.qty>0&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
            {[["Fulfill Qty",`${r.qty.toLocaleString()} cs`],["Fill Rate",`${r.fill_pct}%`],["Action",r.action.replace(/_/g," ")]].map(([l,v])=>(
              <div key={l} style={{background:C.off,borderRadius:6,padding:"10px 12px",textAlign:"center"}}>
                <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>{l}</div>
                <div style={{fontSize:15,fontWeight:700,color:C.charcoal,marginTop:4}}>{v}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{background:C.off,borderRadius:6,padding:"10px 14px"}}>
          <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Expected Outcome</div>
          <div style={{fontSize:12,color:C.charcoal,lineHeight:1.55}}>{r.outcome}</div>
        </div>
        {syn.chain.tradeoffs.length>0&&(
          <div>
            <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Key Trade-offs</div>
            {syn.chain.tradeoffs.map((t,i)=>(
              <div key={i} style={{display:"flex",gap:8,marginBottom:5,fontSize:12,color:C.charcoal}}>
                <span style={{color:C.red,fontWeight:700,flexShrink:0}}>++</span>{t}
              </div>
            ))}
            <div style={{marginTop:8,fontSize:11,color:C.muted,fontStyle:"italic"}}>
              <strong style={{color:C.charcoal,fontStyle:"normal"}}>Would flip if: </strong>{syn.chain.flip}
            </div>
          </div>
        )}
        {r.alternatives.length>0&&(
          <div>
            <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Alternatives Considered</div>
            {r.alternatives.map((a,i)=>(
              <div key={i} style={{background:C.off,borderRadius:6,padding:"8px 12px",marginBottom:5,fontSize:12}}>
                <strong>{a.label}</strong> — {a.outcome}
              </div>
            ))}
          </div>
        )}
        {escKeys.length>0&&(
          <div>
            <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Escalations</div>
            {escKeys.map(k=>{
              const e=syn.escalations[k];
              return (
                <div key={k} style={{border:`1px solid ${sevColor(e.severity)}`,borderRadius:6,padding:"8px 12px",background:C.off,marginBottom:6}}>
                  <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4}}>
                    <Pill label={e.severity} color={sevColor(e.severity)} size={10}/>
                    <span style={{fontSize:11,fontWeight:600,color:C.charcoal}}>{k.replace(/_/g," ")}</span>
                  </div>
                  <div style={{fontSize:11,color:C.charcoal,marginBottom:3}}>{e.summary}</div>
                  <div style={{fontSize:11,color:C.muted}}>Action: {e.action}</div>
                </div>
              );
            })}
          </div>
        )}
        {!decided&&!rejectMode&&(
          <div style={{display:"flex",gap:10,marginTop:4}}>
            <button onClick={onApprove} style={{flex:1,padding:"11px 0",background:C.green,color:"#fff",border:"none",borderRadius:6,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Approve</button>
            <button onClick={()=>setRejectMode(true)} style={{flex:1,padding:"11px 0",background:"transparent",color:C.red,border:`2px solid ${C.red}`,borderRadius:6,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Reject</button>
          </div>
        )}
        {!decided&&rejectMode&&(
          <div style={{background:C.off,borderRadius:8,padding:14}}>
            <div style={{fontSize:13,fontWeight:600,color:C.charcoal,marginBottom:8}}>Override reason (required to reject)</div>
            <textarea value={reason} onChange={e=>setReason(e.target.value)}
              placeholder="Explain why you are overriding the AI recommendation..."
              style={{width:"100%",minHeight:64,padding:8,border:`1px solid ${C.border}`,borderRadius:4,fontFamily:"inherit",fontSize:12,resize:"vertical",boxSizing:"border-box"}}/>
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <button onClick={()=>onReject(reason)} style={{flex:1,padding:9,background:C.red,color:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Confirm Reject</button>
              <button onClick={()=>setRejectMode(false)} style={{padding:"9px 14px",background:"#fff",border:`1px solid ${C.border}`,borderRadius:6,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── UC-2 ORDER TRIAGE ────────────────────────────────────────────────────────
function OrderTriage({onDecision=()=>{} }){
  const [selId,setSelId]=useState(null);
  const [stage,setStage]=useState("idle");
  const [liveSteps,setLiveSteps]=useState({supply_planning:[],demand_planning:[],transportation:[],retail_intelligence:[]});
  const [doneAgents,setDoneAgents]=useState(new Set());
  const [synthesis,setSynthesis]=useState(null);
  const [decision,setDecision]=useState(null);
  const timers=useRef([]);
  const clear=()=>{timers.current.forEach(clearTimeout);timers.current=[];};

  function selectOrder(id){
    clear();
    setSelId(id);setStage("triggering");
    setLiveSteps({supply_planning:[],demand_planning:[],transportation:[],retail_intelligence:[]});
    setDoneAgents(new Set());setSynthesis(null);setDecision(null);
    const syn=SYNTHESIS[id];
    const allSteps=STEPS[id];
    timers.current.push(setTimeout(()=>setStage("fanout"),700));
    let maxDelay=0;
    AGENT_KEYS.forEach((agent,ai)=>{
      const agSteps=allSteps[agent]||[];
      agSteps.forEach((step,si)=>{
        const d=900+ai*220+si*820;
        if(d>maxDelay)maxDelay=d;
        timers.current.push(setTimeout(()=>{
          setLiveSteps(prev=>({...prev,[agent]:[...prev[agent],step]}));
        },d));
      });
      const doneD=900+ai*220+agSteps.length*820+300;
      if(doneD>maxDelay)maxDelay=doneD;
      timers.current.push(setTimeout(()=>{
        setDoneAgents(prev=>new Set([...prev,agent]));
      },doneD));
    });
    const base=maxDelay+700;
    const conflicts=syn.conflicts;
    if(conflicts.length>0){
      timers.current.push(setTimeout(()=>setStage("conflicting"),base));
      if(conflicts[0].debate_rounds>0){
        timers.current.push(setTimeout(()=>setStage("debating"),base+1400));
        timers.current.push(setTimeout(()=>setStage("synthesizing"),base+4000));
        timers.current.push(setTimeout(()=>{setStage("recommendation");setSynthesis(syn);},base+6200));
      }else{
        timers.current.push(setTimeout(()=>setStage("synthesizing"),base+1100));
        timers.current.push(setTimeout(()=>{setStage("recommendation");setSynthesis(syn);},base+3200));
      }
    }else{
      timers.current.push(setTimeout(()=>setStage("synthesizing"),base));
      timers.current.push(setTimeout(()=>{setStage("recommendation");setSynthesis(syn);},base+2300));
    }
  }
  useEffect(()=>()=>clear(),[]);

  const selOrder=ORDERS.find(o=>o.id===selId);
  const synData=selId?SYNTHESIS[selId]:null;
  const stageMsg={
    triggering:"Normalizing order event — preparing agent dispatch",
    fanout:"4 specialist agents running in parallel",
    conflicting:"Conflict detected — reviewing agent signals",
    debating:"Debate in progress — agents revising their positions",
    synthesizing:"Customer Supply Agent synthesizing final recommendation",
  };

  return (
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
      {/* Queue */}
      <div style={{width:296,background:"#fff",borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"16px 16px 12px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{fontSize:16,fontWeight:700,color:C.charcoal}}>Order Triage</div>
          <div style={{fontSize:12,color:C.muted,marginTop:3}}>4 orders flagged for AI evaluation</div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:10}}>
          {ORDERS.map(o=>{
            const sel=o.id===selId;
            const fc=flagColor(o.flag_type);
            return (
              <div key={o.id} onClick={()=>selectOrder(o.id)} style={{
                padding:"12px 14px",borderRadius:8,marginBottom:8,cursor:"pointer",
                border:sel?`2px solid ${C.red}`:`1px solid ${C.border}`,
                background:sel?"rgba(219,3,59,0.04)":"#fff",
                borderLeft:sel?`4px solid ${C.red}`:`4px solid ${fc}`,
              }}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:13,fontWeight:700,color:C.charcoal}}>{o.customer}</span>
                  <Pill label={`P${o.priority}`} color={o.priority===1?C.red:C.orange} size={9}/>
                </div>
                <div style={{fontSize:11,color:C.charcoal,marginBottom:3,lineHeight:1.35}}>{o.desc}</div>
                <div style={{fontSize:11,color:C.muted,marginBottom:7}}>{o.qty.toLocaleString()} cs · {o.id} · {o.mabd}</div>
                <div style={{fontSize:10,background:`${fc}16`,color:fc,borderRadius:4,padding:"2px 7px",display:"inline-block",fontWeight:600}}>{o.flag}</div>
                {sel&&decision&&(
                  <div style={{marginTop:6,fontSize:11,color:decision.type==="approved"?C.green:C.red,fontWeight:700}}>
                    {decision.type==="approved"?"Approved":"Rejected"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Eval panel */}
      <div style={{flex:1,overflowY:"auto",padding:20,background:C.off}}>
        {stage==="idle"&&(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"55%",color:C.muted,textAlign:"center",gap:14}}>
            <div style={{fontSize:48,opacity:0.18}}>⚡</div>
            <div style={{fontSize:18,fontWeight:600,color:C.charcoal}}>Select an order to begin AI evaluation</div>
            <div style={{fontSize:13,maxWidth:420,lineHeight:1.65,color:C.muted}}>
              The 5-agent system will evaluate supply, demand, transportation and retail intelligence in parallel,
              then synthesize a single recommendation for your approval or rejection.
            </div>
          </div>
        )}
        {stage!=="idle"&&selOrder&&(
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            {/* Order header */}
            <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:"14px 18px",display:"flex",gap:16,alignItems:"center"}}>
              <div style={{flex:1}}>
                <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>{selOrder.customer} — {selOrder.desc}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:3}}>{selOrder.id} · {selOrder.qty.toLocaleString()} cs · MABD {selOrder.mabd} · {selOrder.ship_to}</div>
              </div>
              <Pill label={selOrder.flag} color={flagColor(selOrder.flag_type)} size={11}/>
            </div>

            {/* Inventory snapshot — shown immediately on selection */}
            {stage!=="idle"&&selOrder&&(
              <InventorySnapshot order={selOrder}/>
            )}

            {/* Stage bar */}
            {["triggering","fanout","conflicting","debating","synthesizing"].includes(stage)&&(
              <div style={{background:C.charcoal,borderRadius:8,padding:"10px 16px",color:"#fff",display:"flex",alignItems:"center",gap:8,fontSize:13}}>
                <span style={{color:C.teal,fontSize:16}}>●</span>
                <span style={{color:["conflicting","debating"].includes(stage)?C.orange:stage==="synthesizing"?C.teal:"#fff"}}>
                  {stageMsg[stage]}{["triggering","fanout","debating","synthesizing"].includes(stage)&&<Blinker/>}
                </span>
              </div>
            )}

            {/* 2x2 agent grid */}
            {["fanout","conflicting","debating","synthesizing","recommendation","decided"].includes(stage)&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                {AGENT_KEYS.map(k=>(
                  <AgentCard key={k} agentKey={k} steps={liveSteps[k]}
                    signal={synData&&synData.signals[k]} done={doneAgents.has(k)}/>
                ))}
              </div>
            )}

            {/* Conflict */}
            {["conflicting","debating"].includes(stage)&&synData&&synData.conflicts.length>0&&(
              <div style={{background:"#fff",border:`2px solid ${C.orange}`,borderRadius:8,padding:"14px 18px"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <Pill label="CONFLICT DETECTED" color={C.orange}/>
                  <span style={{fontSize:13,fontWeight:600,color:C.charcoal}}>{synData.conflicts[0].type.replace(/_/g," ")}</span>
                </div>
                <div style={{fontSize:12,color:C.charcoal,marginBottom:5}}>
                  <strong>Disputants: </strong>{synData.conflicts[0].disputants.map(d=>AGENT_LABELS[d]&&AGENT_LABELS[d].label||d).join(" vs. ")}
                </div>
                <div style={{fontSize:12,color:C.muted,marginBottom:stage==="debating"?10:0}}>{synData.conflicts[0].summary}</div>
                {stage==="debating"&&(
                  <div style={{padding:"8px 12px",background:"rgba(243,162,0,0.08)",borderRadius:6,fontSize:12,color:C.orange}}>
                    Debate round 1 of {synData.conflicts[0].debate_rounds} — agents revising positions<Blinker/>
                  </div>
                )}
              </div>
            )}

            {/* Synthesis in progress */}
            {stage==="synthesizing"&&(
              <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:"14px 18px",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:20,color:C.red}}>◆</span>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:C.charcoal}}>Customer Supply Agent</div>
                  <div style={{fontSize:12,color:C.muted}}>Synthesizing all specialist signals into a single recommendation<Blinker/></div>
                </div>
              </div>
            )}

            {/* Recommendation */}
            {stage==="recommendation"&&synthesis&&!decision&&(
              <RecommendationCard syn={synthesis} decided={false}
                onApprove={()=>{
                  setDecision({type:"approved"});
                  onDecision({id:`dec-${Date.now()}`,ts:new Date().toISOString(),
                    order:selId,customer:selOrder.customer,sku:selOrder.desc,
                    agent_rec:(synthesis.rec.action+" "+synthesis.rec.qty.toLocaleString()+" cs").replace(/_/g," "),
                    user_decision:"approved",override:null,
                    outcome:"PENDING — order dispatched",agent_aligned:true,
                    financial:synthesis.rec.qty>0?`${synthesis.rec.qty.toLocaleString()} cs`:"-"});
                }}
                onReject={r=>{
                  setDecision({type:"rejected",reason:r});
                  onDecision({id:`dec-${Date.now()}`,ts:new Date().toISOString(),
                    order:selId,customer:selOrder.customer,sku:selOrder.desc,
                    agent_rec:(synthesis.rec.action).replace(/_/g," "),
                    user_decision:"rejected",override:r||"No reason given",
                    outcome:"PENDING — override logged",agent_aligned:false,financial:"TBD"});
                }}/>
            )}

            {/* Decision captured */}
            {decision&&synthesis&&(
              <>
                <RecommendationCard syn={synthesis} decided={true} onApprove={()=>{}} onReject={()=>{}}/>
                <div style={{background:decision.type==="approved"?C.green:C.red,borderRadius:8,padding:"14px 20px",color:"#fff"}}>
                  <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>
                    {decision.type==="approved"?"Recommendation Approved — Executing":"Recommendation Rejected — Logged"}
                  </div>
                  <div style={{fontSize:12,opacity:0.9}}>
                    Decision captured · planner.ops@mars.com · Aligned with AI: {decision.type==="approved"?"Yes":"No"} · Status: EXECUTED
                  </div>
                  {decision.reason&&<div style={{fontSize:12,marginTop:6,opacity:0.85}}>Override reason: "{decision.reason}"</div>}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── UC-3 FULFILLMENT SIMULATOR ────────────────────────────────────────────
function FulfillmentSimulator(){
  const [activeId,setActiveId]=useState(SIMULATOR_INCIDENTS[0].id);
  const [selScenId,setSelScenId]=useState(null);
  const [executing,setExecuting]=useState(false);
  const [executed,setExecuted]=useState({});

  const incident=SIMULATOR_INCIDENTS.find(i=>i.id===activeId)||SIMULATOR_INCIDENTS[0];
  const recScen=incident.scenarios.find(s=>s.is_recommended)||incident.scenarios[0];
  const selScen=incident.scenarios.find(s=>s.id===(selScenId||recScen.id))||recScen;
  const defaultScen=incident.scenarios[0];

  function handleIncidentClick(id){
    setActiveId(id);setSelScenId(null);setExecuting(false);
  }
  function handleExecute(){
    setExecuting(true);
    setTimeout(()=>{setExecuted(prev=>({...prev,[activeId]:selScen.name}));setExecuting(false);},1800);
  }

  const fmtUSD=v=>{
    if(v===0)return "$0";
    const abs=Math.abs(v);
    const s=abs>=1000?`$${(abs/1000).toFixed(1)}K`:`$${abs.toLocaleString()}`;
    return v<0?`-${s}`:s;
  };

  return (
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
      {/* Incident queue */}
      <div style={{width:268,background:"#fff",borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"16px 16px 12px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{fontSize:16,fontWeight:700,color:C.charcoal}}>Fulfillment Incidents</div>
          <div style={{fontSize:12,color:C.muted,marginTop:3}}>Active risks — by fine exposure</div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:10}}>
          {[...SIMULATOR_INCIDENTS].sort((a,b)=>b.fine_at_risk-a.fine_at_risk).map(inc=>{
            const sel=inc.id===activeId;
            const isExecuted=!!executed[inc.id];
            return (
              <div key={inc.id} onClick={()=>handleIncidentClick(inc.id)} style={{
                padding:"12px 14px",borderRadius:8,marginBottom:8,cursor:"pointer",
                border:sel?`2px solid ${C.red}`:`1px solid ${C.border}`,
                background:isExecuted?"rgba(0,176,80,0.04)":sel?"rgba(219,3,59,0.04)":"#fff",
                borderLeft:sel?`4px solid ${C.red}`:isExecuted?`4px solid ${C.green}`:`4px solid ${C.orange}`,
              }}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                  <span style={{fontSize:13,fontWeight:700,color:C.charcoal}}>{inc.customer}</span>
                  {isExecuted
                    ?<Pill label="Executed" color={C.green} size={9}/>
                    :<span style={{fontSize:11,fontWeight:700,color:C.red}}>${(inc.fine_at_risk/1000).toFixed(0)}K at risk</span>}
                </div>
                <div style={{fontSize:11,color:C.charcoal,marginBottom:4,lineHeight:1.35}}>{inc.sku}</div>
                <div style={{height:4,background:C.border,borderRadius:2,overflow:"hidden"}}>
                  <div style={{width:`${inc.risk_probability*100}%`,height:"100%",
                    background:inc.risk_probability>0.8?C.red:inc.risk_probability>0.5?C.orange:C.green,borderRadius:2}}/>
                </div>
                <div style={{fontSize:10,color:C.muted,marginTop:3}}>
                  Risk probability: {Math.round(inc.risk_probability*100)}%
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scenario panel */}
      <div style={{flex:1,overflowY:"auto",padding:20,background:C.off}}>
        {/* AC7 — Transportation Agent: Shipment Optimizer Tool Call */}
        {(()=>{
          const order=ORDERS.find(o=>o.id===incident.order_id);
          const callMs=(incident.fine_at_risk%700)+800; // deterministic pseudo-random
          const params=order?JSON.stringify({
            order_id:incident.order_id,
            origin_dc:order.ship_to,
            destination_customer:incident.customer,
            qty_cs:order.qty,
            mabd:order.mabd,
            fine_per_cs_late:Math.round(incident.fine_at_risk/order.qty),
            carrier_pool:"contracted_preferred",
            scenario_count:incident.scenarios.length,
          },null,0):"{}";
          return (
            <div style={{background:"#0f172a",borderRadius:8,padding:"12px 16px",
              marginBottom:14,fontFamily:MONO}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{fontSize:9,fontWeight:700,color:"#38bdf8",textTransform:"uppercase",
                  letterSpacing:"0.1em"}}>Transportation Agent</span>
                <span style={{fontSize:9,color:"#475569"}}>→</span>
                <span style={{fontSize:9,fontWeight:700,color:"#a78bfa",textTransform:"uppercase",
                  letterSpacing:"0.08em"}}>tool_call: call_shipment_optimizer</span>
                <span style={{marginLeft:"auto",fontSize:9,color:"#22c55e",fontWeight:600}}>
                  ✓ {callMs}ms
                </span>
              </div>
              <div style={{fontSize:10,color:"#64748b",marginBottom:6,letterSpacing:"0.02em"}}>
                Input
              </div>
              <div style={{fontSize:10,color:"#94a3b8",background:"#1e293b",borderRadius:4,
                padding:"8px 10px",marginBottom:8,lineHeight:1.7,wordBreak:"break-all"}}>
                {params}
              </div>
              <div style={{fontSize:10,color:"#64748b",marginBottom:4}}>Output</div>
              <div style={{fontSize:10,color:"#4ade80",lineHeight:1.6}}>
                {`→ ${incident.scenarios.length} ranked fulfillment scenarios generated`}<br/>
                {`→ Recommended: "${incident.scenarios.find(s=>s.is_recommended)?.name||"—"}"`}<br/>
                {`→ Net saving vs. default: $${((incident.scenarios.find(s=>s.is_recommended)?.savings_vs_default||0)/1000).toFixed(1)}K`}
              </div>
            </div>
          );
        })()}
        {/* Incident header */}
        <div style={{background:C.charcoal,borderRadius:8,padding:"14px 18px",marginBottom:16,
          display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#fff",marginBottom:4}}>{incident.title}</div>
            <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.5,marginBottom:8}}>{incident.description}</div>
            <div style={{fontSize:11,color:"#64748b",fontStyle:"italic"}}>{incident.otif_rulebook}</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>Fine at Risk</div>
            <div style={{fontSize:26,fontWeight:700,color:C.red,fontFamily:"monospace"}}>${(incident.fine_at_risk/1000).toFixed(0)}K</div>
            <div style={{fontSize:10,color:"#64748b"}}>{Math.round(incident.risk_probability*100)}% probability</div>
          </div>
        </div>

        {/* Scenario comparison */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
          {incident.scenarios.map(s=>{
            const isSel=s.id===(selScenId||recScen.id);
            const isRec=s.is_recommended;
            const borderC=isSel?C.red:isRec?C.green:C.border;
            const topC=isRec?C.green:s.net_impact<-30000?C.red:s.net_impact<-5000?C.orange:C.blue;
            return (
              <div key={s.id} onClick={()=>setSelScenId(s.id)} style={{
                background:"#fff",border:`2px solid ${borderC}`,borderRadius:8,padding:16,
                cursor:"pointer",borderTop:`4px solid ${topC}`,position:"relative",
                boxShadow:isSel?"0 0 0 2px rgba(219,3,59,0.15)":"none",
              }}>
                {isRec&&<div style={{position:"absolute",top:-1,right:12,
                  background:C.green,color:"#fff",fontSize:9,fontWeight:700,
                  padding:"2px 8px",borderRadius:"0 0 6px 6px",letterSpacing:"0.06em"}}>
                  AI RECOMMENDED
                </div>}
                <div style={{fontSize:13,fontWeight:700,color:C.charcoal,marginBottom:4,marginTop:isRec?8:0,lineHeight:1.3}}>
                  {s.name}
                </div>
                <div style={{fontSize:10,color:C.muted,marginBottom:12}}>{s.tagline}</div>

                {/* Financial breakdown */}
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  {[
                    ["Fulfill Qty",`${s.fulfill_cs.toLocaleString()} cs`],
                    ["Freight Cost",fmtUSD(-s.freight_cost)],
                    ["Fine / Penalty",fmtUSD(-s.fine_usd)],
                    ["Net Impact",fmtUSD(s.net_impact)],
                  ].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",
                      fontSize:12,paddingBottom:5,borderBottom:`1px solid ${C.border}`}}>
                      <span style={{color:C.muted}}>{l}</span>
                      <span style={{fontWeight:700,
                        color:l==="Net Impact"?s.net_impact===0?C.green:C.red
                          :l==="Fine / Penalty"&&s.fine_usd>0?C.red:C.charcoal}}>
                        {v}
                      </span>
                    </div>
                  ))}
                  {s.savings_vs_default>0&&(
                    <div style={{background:"rgba(0,176,80,0.08)",borderRadius:5,padding:"5px 8px",
                      display:"flex",justifyContent:"space-between",fontSize:12,marginTop:2}}>
                      <span style={{color:C.green,fontWeight:700}}>Saves vs default</span>
                      <span style={{color:C.green,fontWeight:700}}>${(s.savings_vs_default/1000).toFixed(1)}K</span>
                    </div>
                  )}
                  {s.savings_vs_default<0&&(
                    <div style={{background:"rgba(219,3,59,0.06)",borderRadius:5,padding:"5px 8px",
                      display:"flex",justifyContent:"space-between",fontSize:12,marginTop:2}}>
                      <span style={{color:C.red,fontWeight:700}}>Extra cost vs default</span>
                      <span style={{color:C.red,fontWeight:700}}>${(Math.abs(s.savings_vs_default)/1000).toFixed(1)}K</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected scenario rationale + execution steps */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
          <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
            <div style={{fontSize:12,fontWeight:700,color:C.charcoal,marginBottom:8}}>AI Rationale — {selScen.name}</div>
            <div style={{fontSize:12,color:C.charcoal,lineHeight:1.6}}>{selScen.rationale}</div>
          </div>
          <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
            <div style={{fontSize:12,fontWeight:700,color:C.charcoal,marginBottom:8}}>Execution Steps</div>
            {incident.execution_steps.map((step,i)=>(
              <div key={i} style={{display:"flex",gap:8,marginBottom:6,fontSize:12,color:C.charcoal,alignItems:"flex-start"}}>
                <span style={{background:C.red,color:"#fff",borderRadius:"50%",width:18,height:18,
                  display:"inline-flex",alignItems:"center",justifyContent:"center",
                  fontSize:10,fontWeight:700,flexShrink:0}}>{i+1}</span>
                {step}
              </div>
            ))}
          </div>
        </div>

        {/* Execute */}
        {executed[activeId]?(
          <div style={{background:C.green,borderRadius:8,padding:"12px 18px",
            display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <span style={{fontSize:16,color:"#fff"}}>✓</span>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>Executed: {executed[activeId]}</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,0.8)",marginTop:2}}>Decision logged · agents notified · order dispatched</div>
            </div>
          </div>
        ):(
          <div style={{display:"flex",gap:10,marginBottom:16}}>
            <button onClick={handleExecute} disabled={executing} style={{
              flex:1,padding:"12px 0",background:executing?C.muted:C.red,
              color:"#fff",border:"none",borderRadius:6,fontSize:14,fontWeight:700,
              cursor:executing?"default":"pointer",fontFamily:"inherit"}}>
              {executing?"Executing...`":`Execute: ${selScen.name}`}
            </button>
            <button onClick={()=>setSelScenId(recScen.id)} style={{padding:"12px 18px",
              background:"transparent",color:C.red,border:`2px solid ${C.red}`,
              borderRadius:6,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              Use AI Recommendation
            </button>
          </div>
        )}

        {/* DC Sourcing Explorer — kept from before */}
        {(()=>{
          const order=ORDERS.find(o=>o.id===incident.order_id);
          if(!order)return null;
          const dcData=SKU_DC_MATRIX[order.sku]||[];
          const networkTotal=dcData.reduce((s,x)=>s+x.cs,0);
          const primaryDC=dcData.find(x=>x.dc===order.ship_to)||dcData[0]||{};
          const splitNeeded=primaryDC.cs<order.qty;
          const statColor=s=>({OK:C.green,BELOW_SS:C.orange,STOCKOUT:C.red}[s]||C.muted);
          let remaining=order.qty;
          const splitPlan=[];
          [...dcData].sort((a,b)=>{if(a.dc===order.ship_to)return -1;if(b.dc===order.ship_to)return 1;return b.cs-a.cs;}).forEach(dc=>{
            if(remaining<=0)return;
            const take=Math.min(dc.cs,remaining);
            if(take>0){splitPlan.push({...dc,take,pct:Math.round(take/order.qty*100)});remaining-=take;}
          });
          return (
            <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>DC Sourcing Explorer — {order.sku}</div>
                  <div style={{fontSize:12,color:C.muted,marginTop:3}}>Network inventory vs. {order.qty.toLocaleString()} cs ordered</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Network Total</div>
                  <div style={{fontSize:20,fontWeight:700,color:networkTotal>=order.qty?C.green:C.orange}}>{networkTotal.toLocaleString()} cs</div>
                </div>
              </div>
              <div style={{marginBottom:12}}>
                <div style={{display:"grid",gridTemplateColumns:"90px 90px 50px 80px 1fr 70px",
                  background:C.off,padding:"5px 10px",borderRadius:4,marginBottom:4}}>
                  {["DC","Available","DoS","Status","Coverage","After Fill"].map(h=>(
                    <div key={h} style={{fontSize:9,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</div>
                  ))}
                </div>
                {dcData.map((r,i)=>{
                  const pct=Math.min(100,Math.round(r.cs/order.qty*100));
                  const afterFill=Math.max(0,r.cs-(splitPlan.find(s=>s.dc===r.dc)||{take:0}).take);
                  const isPrimary=r.dc===order.ship_to;
                  return (
                    <div key={i} style={{display:"grid",gridTemplateColumns:"90px 90px 50px 80px 1fr 70px",
                      padding:"7px 10px",borderBottom:`1px solid ${C.border}`,alignItems:"center",
                      background:isPrimary?"rgba(30,171,218,0.05)":"transparent"}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:700,color:isPrimary?C.blue:C.charcoal}}>{r.dc}</div>
                        {isPrimary&&<div style={{fontSize:9,color:C.blue}}>Primary</div>}
                      </div>
                      <span style={{fontWeight:600,fontSize:12}}>{r.cs.toLocaleString()} cs</span>
                      <span style={{fontSize:11,color:r.dos<7?C.red:r.dos<14?C.orange:C.green,fontWeight:600}}>{r.dos}d</span>
                      <span style={{fontSize:10,fontWeight:700,color:statColor(r.status)}}>{r.status.replace("_"," ")}</span>
                      <div style={{paddingRight:10}}>
                        <div style={{display:"flex",alignItems:"center",gap:5}}>
                          <div style={{flex:1,height:5,background:C.border,borderRadius:2,overflow:"hidden"}}>
                            <div style={{width:`${pct}%`,height:"100%",background:pct>=100?C.green:pct>=70?C.orange:C.red,borderRadius:2}}/>
                          </div>
                          <span style={{fontSize:11,fontWeight:700,color:pct>=100?C.green:pct>=70?C.orange:C.red,minWidth:28,textAlign:"right"}}>{pct}%</span>
                        </div>
                      </div>
                      <span style={{fontSize:11,fontWeight:600,textAlign:"right",color:afterFill<r.ss?C.orange:C.green}}>{afterFill.toLocaleString()} cs</span>
                    </div>
                  );
                })}
              </div>
              {splitNeeded?(
                <div style={{background:"rgba(30,171,218,0.06)",border:`1px solid ${C.blue}`,borderRadius:8,padding:14}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.blue,marginBottom:10}}>AI Split Sourcing Plan</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {splitPlan.map((s,i)=>(
                      <div key={i} style={{background:"#fff",borderRadius:6,padding:"8px 12px",border:`1px solid ${C.border}`,fontSize:11}}>
                        <div style={{fontWeight:700,color:C.charcoal,marginBottom:2}}>{s.dc}</div>
                        <div style={{color:C.blue,fontWeight:700,fontSize:14}}>{s.take.toLocaleString()} cs</div>
                        <div style={{color:C.muted}}>{s.pct}% of order</div>
                      </div>
                    ))}
                    {networkTotal<order.qty&&(
                      <div style={{background:C.off,borderRadius:6,padding:"8px 12px",border:`1px dashed ${C.border}`,fontSize:11}}>
                        <div style={{fontWeight:700,color:C.muted,marginBottom:2}}>Backorder</div>
                        <div style={{color:C.orange,fontWeight:700,fontSize:14}}>{(order.qty-networkTotal).toLocaleString()} cs</div>
                      </div>
                    )}
                  </div>
                </div>
              ):(
                <div style={{background:"rgba(0,176,80,0.06)",border:`1px solid ${C.green}`,borderRadius:8,padding:12,fontSize:12,color:C.green,fontWeight:700}}>
                  Primary DC can fulfill the full order — no split sourcing required.
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── UC-4 ROOT CAUSE HUB ───────────────────────────────────────────────────
function RootCauseHub(){
  const [draftId,setDraftId]=useState(null);
  const [note,setNote]=useState("");
  const [sent,setSent]=useState(new Set());
  const totalCases=ROOT_CAUSES.reduce((s,r)=>s+r.cases,0);
  const chartData=ROOT_CAUSES.map(r=>({name:r.cause.length>24?r.cause.substring(0,22)+"...":r.cause,cases:r.cases}));
  const resStatusColor={RESOLVED:C.green,IN_PROGRESS:C.orange,OPEN:C.red};
  const resStatusLabel={RESOLVED:"Resolved",IN_PROGRESS:"In Progress",OPEN:"Open"};
  function draftNote(rc){
    setDraftId(rc.id);
    setNote(`Team,\n\nI am escalating ${rc.cause} as a priority issue for the Supply Operations review.\n\nImpact (last 90 days): ${rc.cases.toLocaleString()} cases lost, ${rc.value} in exposure. ${rc.issues} open issues remain unresolved.\n\nOwner: ${rc.owner}\n\nRequested action: immediate escalation meeting this week.\n\nMars Pet Nutrition — Supply Operations`);
  }
  return (
    <div style={{padding:24}}>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:20,fontWeight:700,color:C.charcoal}}>Root Cause Hub</div>
        <div style={{fontSize:12,color:C.muted,marginTop:2}}>Fulfillment failures grouped by root cause — last 90 days</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 360px",gap:16}}>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:20,marginBottom:4}}>
            <SectionHead title="Cases Lost by Root Cause"/>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} layout="vertical" margin={{left:10,right:20,top:0,bottom:0}}>
                <XAxis type="number" tick={{fontSize:10,fill:C.muted}} axisLine={false} tickLine={false}/>
                <YAxis type="category" dataKey="name" tick={{fontSize:10,fill:C.charcoal}} width={150} axisLine={false} tickLine={false}/>
                <Tooltip formatter={(v)=>[`${v.toLocaleString()} cs`,""]} contentStyle={{fontSize:11}}/>
                <Bar dataKey="cases" fill={C.red} radius={[0,3,3,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* CFR Summary row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16}}>
        {[
          {label:"CFR This Week",value:"97.8%",target:"98.0%",status:"warn"},
          {label:"Cases Short (90d)",value:"8,820 cs",target:"—",status:"warn"},
          {label:"Customers Below Target",value:"3 of 6",target:"—",status:"bad"},
          {label:"Open Root Cause Issues",value:"6",target:"—",status:"warn"},
        ].map(k=>(
          <div key={k.label} style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:"12px 14px"}}>
            <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:20,fontWeight:700,color:k.status==="bad"?C.red:k.status==="warn"?C.orange:C.green}}>{k.value}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:4}}>Target: {k.target}</div>
          </div>
        ))}
      </div>

      {/* Demand vs Supply attribution + customer CFR */}
      <div style={{display:"grid",gridTemplateColumns:"340px 1fr",gap:16,marginBottom:16}}>
        {/* Attribution */}
        <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
          <div style={{fontSize:15,fontWeight:700,color:C.charcoal,marginBottom:4}}>CFR Loss Attribution</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:14}}>What is driving short shipments?</div>
          {CFR_ATTRIBUTION.map((a,i)=>(
            <div key={i} style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                <span style={{color:C.charcoal,fontWeight:600}}>{a.cause}</span>
                <span style={{color:a.col,fontWeight:700}}>{a.pct}%</span>
              </div>
              <div style={{height:8,background:C.border,borderRadius:4,overflow:"hidden"}}>
                <div style={{width:`${a.pct}%`,height:"100%",background:a.col,borderRadius:4}}/>
              </div>
              <div style={{fontSize:10,color:C.muted,marginTop:2}}>{a.cases.toLocaleString()} cases lost</div>
            </div>
          ))}
          <div style={{marginTop:12,padding:"8px 10px",background:C.off,borderRadius:6,fontSize:11}}>
            <strong style={{color:C.red}}>79%</strong><span style={{color:C.charcoal}}> of CFR loss traceable to supply-side failures</span>
          </div>
        </div>

        {/* Customer CFR scoreboard */}
        <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
          <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${C.border}`}}>
            <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>Customer CFR Scoreboard</div>
            <div style={{fontSize:12,color:C.muted,marginTop:3}}>Trailing 90 days — sorted by worst first</div>
          </div>
          {CFR_BY_CUSTOMER.map((r,i)=>{
            const delta=+(r.cfr-r.target).toFixed(1);
            const s=r.cfr>=r.target?"ok":r.cfr>=95?"warn":"bad";
            const sc={ok:C.green,warn:C.orange,bad:C.red}[s];
            return (
              <div key={i} style={{display:"grid",gridTemplateColumns:"100px 1fr 70px 70px 80px 80px",
                padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":C.off,fontSize:12,alignItems:"center"}}>
                <span style={{fontWeight:700,color:C.charcoal}}>{r.customer}</span>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:80,height:5,background:C.border,borderRadius:2,overflow:"hidden"}}>
                      <div style={{width:`${((r.cfr-88)/12)*100}%`,height:"100%",background:sc,borderRadius:2}}/>
                    </div>
                    <span style={{fontWeight:700,color:sc}}>{r.cfr}%</span>
                  </div>
                </div>
                <span style={{color:C.muted,fontSize:10}}>Tgt {r.target}%</span>
                <span style={{fontWeight:700,color:delta>=0?C.green:C.red}}>{delta>=0?"+":""}{delta} pp</span>
                <span style={{color:r.short>0?C.red:C.green,fontWeight:600}}>
                  {r.short>0?`${r.short.toLocaleString()} cs`:"On track"}
                </span>
                <Pill label={r.cfr>=r.target?"On Target":"Below"} color={sc} size={9}/>
              </div>
            );
          })}
        </div>
      </div>

      {/* Resolution status tracker */}
      <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:20,marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:700,color:C.charcoal,marginBottom:14}}>Resolution Tracker</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
          {CFR_RESOLUTION.map((r,i)=>(
            <div key={i} style={{borderRadius:8,padding:12,border:`1px solid ${C.border}`,
              borderTop:`3px solid ${resStatusColor[r.status]}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <span style={{fontSize:10,fontWeight:700,color:resStatusColor[r.status],textTransform:"uppercase"}}>{resStatusLabel[r.status]}</span>
              </div>
              <div style={{fontSize:12,fontWeight:600,color:C.charcoal,marginBottom:6,lineHeight:1.35}}>{r.cause}</div>
              <div style={{fontSize:10,color:C.muted}}>Owner: <strong style={{color:C.charcoal}}>{r.owner}</strong></div>
              <div style={{fontSize:10,color:C.muted}}>Due: <strong style={{color:r.status==="OPEN"?C.red:C.charcoal}}>{r.due}</strong></div>
            </div>
          ))}
        </div>
      </div>

      {ROOT_CAUSES.map(rc=>(
            <div key={rc.id} style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:16,borderLeft:`4px solid ${sevColor(rc.sev)}`}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:10}}>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <Pill label={rc.sev} color={sevColor(rc.sev)}/>
                    <span style={{fontSize:15,fontWeight:700,color:C.charcoal}}>{rc.cause}</span>
                  </div>
                  <div style={{fontSize:12,color:C.muted}}>Owner: {rc.owner} · {rc.issues} open issues</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:16,fontWeight:700,color:C.charcoal}}>{rc.value}</div>
                  <div style={{fontSize:11,color:C.muted}}>{rc.cases.toLocaleString()} cs lost</div>
                </div>
              </div>
              <MiniBar value={rc.cases} max={totalCases} color={sevColor(rc.sev)}/>
              <div style={{marginTop:10,display:"flex",gap:8,alignItems:"center"}}>
                <button onClick={()=>draftNote(rc)} style={{fontSize:11,color:C.red,border:`1px solid ${C.red}`,borderRadius:4,
                  padding:"3px 10px",background:"transparent",cursor:"pointer",fontFamily:"inherit"}}>
                  Draft Escalation Note
                </button>
                {sent.has(rc.id)&&<span style={{fontSize:11,color:C.green,fontWeight:600}}>Sent</span>}
              </div>
            </div>
          ))}
        </div>
        <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:20,alignSelf:"start"}}>
          <SectionHead title="Escalation Drafter"/>
          {!draftId?(
            <div style={{color:C.muted,fontSize:12,textAlign:"center",marginTop:24,lineHeight:1.7}}>
              Click "Draft Escalation Note" on any root cause to auto-generate a draft here for editing and sending.
            </div>
          ):(
            <>
              <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Auto-generated from agent findings — edit before sending</div>
              <textarea value={note} onChange={e=>setNote(e.target.value)}
                style={{width:"100%",height:220,padding:10,border:`1px solid ${C.border}`,borderRadius:6,
                  fontFamily:"inherit",fontSize:12,resize:"vertical",boxSizing:"border-box"}}/>
              <button onClick={()=>{setSent(prev=>new Set([...prev,draftId]));setDraftId(null);}}
                style={{marginTop:10,width:"100%",padding:"9px 0",background:C.red,color:"#fff",border:"none",
                  borderRadius:6,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                Send Escalation
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── UC-5 SAFETY STOCK OPTIMIZER ───────────────────────────────────────────
function SafetyStockOptimizer(){
  const [applied,setApplied]=useState(new Set());
  function apply(sku){setApplied(prev=>new Set([...prev,sku]));}
  return (
    <div style={{padding:24}}>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:20,fontWeight:700,color:C.charcoal}}>Safety Stock Optimizer</div>
        <div style={{fontSize:12,color:C.muted,marginTop:2}}>AI-recommended safety stock adjustments — per SKU, current week</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {SAFETY_STOCKS.map(ss=>{
          const hasChange=ss.delta!==0;
          const isApplied=applied.has(ss.sku);
          return (
            <div key={ss.sku} style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:18,
              borderLeft:`4px solid ${hasChange?C.orange:C.green}`}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 200px 220px 100px",gap:16,alignItems:"center"}}>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:C.charcoal,marginBottom:3}}>{ss.desc}</div>
                  <div style={{fontSize:11,color:C.muted,marginBottom:6}}>{ss.sku}</div>
                  <div style={{fontSize:11,color:C.charcoal,lineHeight:1.5}}>{ss.reason}</div>
                </div>
                <div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:8}}>Current vs. Recommended (cs)</div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:17,fontWeight:700,color:C.charcoal}}>{ss.current.toLocaleString()}</span>
                    <span style={{color:C.muted,fontSize:16}}>→</span>
                    <span style={{fontSize:17,fontWeight:700,color:isApplied?C.green:hasChange?C.red:C.green}}>{ss.rec.toLocaleString()}</span>
                  </div>
                  {hasChange&&<div style={{marginTop:4,fontSize:11,color:C.orange,fontWeight:600}}>+{ss.delta.toLocaleString()} cs uplift</div>}
                </div>
                <div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:6}}>Weekly demand trend (8 weeks)</div>
                  <ResponsiveContainer width="100%" height={50}>
                    <BarChart data={ss.weekly} margin={{top:0,bottom:0,left:0,right:0}}>
                      <Bar dataKey="v" fill={hasChange?C.orange:C.green} radius={[2,2,0,0]}/>
                      <Tooltip formatter={(v)=>[`${v} cs`,""]} contentStyle={{fontSize:10}}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{display:"flex",justifyContent:"center"}}>
                  {hasChange?(
                    isApplied
                      ?<span style={{fontSize:12,color:C.green,fontWeight:700}}>Applied</span>
                      :<button onClick={()=>apply(ss.sku)} style={{padding:"8px 14px",background:C.red,color:"#fff",
                          border:"none",borderRadius:6,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Apply</button>
                  ):(
                    <span style={{fontSize:12,color:C.green,fontWeight:700}}>Optimal</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{marginTop:16,background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.charcoal}}>
          <span><strong>Total safety stock uplift if all applied:</strong> +{SAFETY_STOCKS.reduce((s,x)=>s+x.delta,0).toLocaleString()} cs across {SAFETY_STOCKS.filter(x=>x.delta>0).length} SKUs</span>
          <span style={{color:C.muted}}>Estimated working capital impact: <strong style={{color:C.charcoal}}>+$137K</strong></span>
        </div>
      </div>

      {/* Promo-Linked Safety Stock */}
      <div style={{marginTop:24}}>
        <div style={{marginBottom:14,display:"flex",alignItems:"baseline",gap:10}}>
          <div style={{fontSize:18,fontWeight:700,color:C.charcoal}}>Promotional Event Safety Stock</div>
          <div style={{fontSize:12,color:C.muted}}>AI-adjusted requirements linked to your promotional calendar</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {PROMO_SS_IMPACT.map((p,i)=>{
            const rc={"READY":C.green,"MONITOR":C.orange,"AT RISK":C.red}[p.readiness]||C.muted;
            const promoS={"APPROVED":C.green,"PENDING":C.orange}[p.status]||C.muted;
            const gapToPromo=p.promo_rec-p.current_ss;
            return (
              <div key={i} style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:18,
                borderLeft:`4px solid ${rc}`}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 160px 160px 160px 100px",gap:16,alignItems:"center"}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                      <span style={{fontSize:15,fontWeight:700,color:C.charcoal}}>{p.event}</span>
                      <Pill label={p.status} color={promoS} size={10}/>
                      <Pill label={p.readiness} color={rc} size={10}/>
                    </div>
                    <div style={{fontSize:11,color:C.muted,marginBottom:2}}>{p.sku} — {p.desc}</div>
                    <div style={{fontSize:11,color:C.charcoal}}>Event window: <strong>{p.dates}</strong></div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Current SS</div>
                    <div style={{fontSize:18,fontWeight:700,color:C.charcoal}}>{p.current_ss.toLocaleString()} cs</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Baseline Rec.</div>
                    <div style={{fontSize:18,fontWeight:700,color:C.orange}}>{p.baseline_rec.toLocaleString()} cs</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:10,color:rc,fontWeight:700,marginBottom:4}}>Promo-Adjusted Rec.</div>
                    <div style={{fontSize:18,fontWeight:700,color:rc}}>{p.promo_rec.toLocaleString()} cs</div>
                    <div style={{fontSize:10,color:C.muted,marginTop:2}}>+{p.uplift.toLocaleString()} cs vs baseline</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    {gapToPromo>0?(
                      <button style={{padding:"8px 12px",background:rc,color:"#fff",border:"none",borderRadius:6,
                        fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",width:"100%"}}>
                        Set to {p.promo_rec.toLocaleString()} cs
                      </button>
                    ):(
                      <span style={{fontSize:12,color:C.green,fontWeight:700}}>Ready</span>
                    )}
                    <div style={{fontSize:10,color:C.muted,marginTop:4}}>Gap: +{gapToPromo.toLocaleString()} cs</div>
                  </div>
                </div>
                {/* Gap bar */}
                <div style={{marginTop:12}}>
                  <div style={{fontSize:9,color:C.muted,marginBottom:4}}>Safety stock coverage: Current vs Promo Requirement</div>
                  <div style={{position:"relative",height:8,background:C.border,borderRadius:4,overflow:"visible"}}>
                    <div style={{position:"absolute",left:0,top:0,height:"100%",
                      width:`${Math.min(100,p.current_ss/p.promo_rec*100)}%`,
                      background:rc,borderRadius:4}}/>
                    <div style={{position:"absolute",left:`${p.baseline_rec/p.promo_rec*100}%`,
                      top:-3,width:2,height:14,background:C.orange,borderRadius:1}}
                      title="Baseline recommendation"/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.muted,marginTop:3}}>
                    <span>Current: {p.current_ss.toLocaleString()} cs</span>
                    <span style={{color:C.orange}}>Baseline: {p.baseline_rec.toLocaleString()} cs</span>
                    <span style={{color:rc}}>Promo target: {p.promo_rec.toLocaleString()} cs</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ── AGENT PAGE SHARED HELPERS ─────────────────────────────────────────────
function AgentPageHeader({title,role,color,question}){
  return (
    <div style={{background:color,padding:"22px 28px 20px",position:"relative",overflow:"hidden"}}>
      {/* Subtle decorative shape */}
      <div style={{position:"absolute",top:-20,right:-20,width:160,height:160,
        borderRadius:"50%",background:"rgba(255,255,255,0.06)",pointerEvents:"none"}}/>
      <div style={{position:"absolute",bottom:-30,right:80,width:100,height:100,
        borderRadius:"50%",background:"rgba(255,255,255,0.04)",pointerEvents:"none"}}/>
      <div style={{position:"relative"}}>
        <div style={{fontSize:10,color:"rgba(255,255,255,0.55)",textTransform:"uppercase",
          letterSpacing:"0.2em",marginBottom:8,fontWeight:700}}>Agent View</div>
        <div style={{fontSize:28,fontWeight:700,color:"#fff",marginBottom:10,
          letterSpacing:"-0.02em",lineHeight:1.1}}>{title}</div>
        <div style={{display:"flex",alignItems:"flex-start",gap:8,
          borderTop:"1px solid rgba(255,255,255,0.15)",paddingTop:10}}>
          <span style={{fontSize:14,color:"rgba(255,255,255,0.45)",flexShrink:0,lineHeight:1.5}}>◈</span>
          <span style={{fontSize:13,color:"rgba(255,255,255,0.88)",lineHeight:1.6}}>{question}</span>
        </div>
      </div>
    </div>
  );
}
function AgentKpi({label,value,delta,status}){
  const cols={
    ok:{v:C.green,bg:"#f0fdf4",bar:C.green},
    warn:{v:C.orange,bg:"#fffbeb",bar:C.orange},
    bad:{v:C.red,bg:"#fff1f2",bar:C.red},
    neutral:{v:C.charcoal,bg:C.off,bar:C.border}
  };
  const s=cols[status||"neutral"];
  return (
    <div style={{background:s.bg,borderRadius:8,padding:"14px 16px 12px",
      border:`1px solid ${C.border}`,borderTop:`3px solid ${s.bar}`}}>
      <div style={{fontSize:11,color:C.muted,textTransform:"uppercase",letterSpacing:"0.07em",
        marginBottom:8,lineHeight:1.3,fontWeight:500}}>{label}</div>
      <div style={{fontSize:28,fontWeight:700,color:s.v,lineHeight:1,
        fontFamily:MONO,letterSpacing:"-0.02em"}}>{value}</div>
      {delta&&<div style={{fontSize:11,color:C.muted,marginTop:6,lineHeight:1.3}}>{delta}</div>}
    </div>
  );
}
function TableHeader({cols}){
  return (
    <div style={{display:"grid",gridTemplateColumns:cols.map(c=>c.w||"1fr").join(" "),gap:0,
      background:"#f1f5f9",borderBottom:`1px solid ${C.border}`,padding:"7px 12px"}}>
      {cols.map(c=>(
        <div key={c.label} style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",
          letterSpacing:"0.08em",textAlign:c.right?"right":"left"}}>{c.label}</div>
      ))}
    </div>
  );
}
function AdherenceBar({pct,color}){
  const c=pct>=95?C.green:pct>=85?C.orange:C.red;
  return (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <div style={{flex:1,height:5,background:C.border,borderRadius:3,overflow:"hidden"}}>
        <div style={{width:`${pct}%`,height:"100%",background:c,borderRadius:3}}/>
      </div>
      <span style={{fontSize:12,fontWeight:700,color:c,minWidth:36,textAlign:"right",fontFamily:MONO}}>{pct}%</span>
    </div>
  );
}

// ── SUPPLY PLANNING AGENT PAGE ────────────────────────────────────────────
function SupplyPlanningPage(){
  const inv=PORT_SUPPLY.inventory;
  const prod=PORT_SUPPLY.production;
  const rm=PORT_SUPPLY.raw_materials;
  const statColor=s=>s==="OK"?C.green:s==="BELOW_SS"?C.orange:C.red;
  const riskColor=r=>r==="HIGH"?C.red:r==="MEDIUM"?C.orange:C.green;
  const proStatusColor=s=>s==="TECO"?C.green:s==="REL"?C.orange:C.muted;
  const belowSS=inv.filter(x=>x.status==="BELOW_SS").length;
  const stockout=inv.filter(x=>x.status==="STOCKOUT").length;
  const avgDos=(inv.reduce((s,x)=>s+x.dos,0)/inv.length).toFixed(1);
  const runsAtRisk=prod.filter(x=>x.risk==="HIGH"||x.risk==="MEDIUM").length;
  const rmConcerns=rm.filter(x=>x.concern).length;
  return (
    <div>
      <AgentPageHeader title="Supply Planning Agent" color={C.blue}
        question="Can we physically supply this? Inventory, production schedules, raw materials."/>
      <div style={{padding:24}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:24}}>
          <AgentKpi label="SKUs Below SS" value={belowSS.toString()} status={belowSS>0?"warn":"ok"} delta="across all DCs"/>
          <AgentKpi label="SKUs at Stockout" value={stockout.toString()} status={stockout>0?"bad":"ok"} delta="critical priority"/>
          <AgentKpi label="Avg Days of Supply" value={`${avgDos} d`} status={parseFloat(avgDos)>14?"ok":parseFloat(avgDos)>7?"warn":"bad"} delta="portfolio average"/>
          <AgentKpi label="Production Runs at Risk" value={runsAtRisk.toString()} status={runsAtRisk>2?"bad":runsAtRisk>0?"warn":"ok"} delta="HIGH or MEDIUM risk"/>
          <AgentKpi label="Raw Material Concerns" value={rmConcerns.toString()} status={rmConcerns>0?"warn":"ok"} delta="directional concern"/>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
          {/* Inventory Positions */}
          <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
            <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${C.border}`}}>
              <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>Inventory Positions</div>
              <div style={{fontSize:12,color:C.muted,marginTop:3}}>By SKU & DC — sorted by risk</div>
            </div>
            <TableHeader cols={[{label:"SKU",w:"80px"},{label:"DC",w:"80px"},{label:"On Hand"},{label:"DoS",w:"50px"},{label:"Status",w:"90px"},{label:"Short By",w:"70px",right:true}]}/>
            {inv.map((r,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"80px 80px 1fr 50px 90px 70px",
                padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":C.off,fontSize:12}}>
                <span style={{color:C.charcoal,fontWeight:600,fontSize:10}}>{r.sku}</span>
                <span style={{color:C.muted}}>{r.dc}</span>
                <span style={{color:C.charcoal,fontWeight:700,fontFamily:MONO}}>{r.cs.toLocaleString()} cs</span>
                <span style={{color:r.dos<7?C.red:r.dos<14?C.orange:C.green,fontWeight:600}}>{r.dos}d</span>
                <span style={{color:statColor(r.status),fontWeight:700,fontSize:10}}>{r.status.replace("_"," ")}</span>
                <span style={{textAlign:"right",color:r.short>0?C.red:C.green,fontWeight:600}}>
                  {r.short>0?`${r.short.toLocaleString()} cs`:"—"}
                </span>
              </div>
            ))}
          </div>

          {/* Production Schedule */}
          <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
            <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${C.border}`}}>
              <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>Production Schedule Adherence</div>
              <div style={{fontSize:12,color:C.muted,marginTop:3}}>Active & upcoming runs — sorted by risk</div>
            </div>
            <TableHeader cols={[{label:"PRO #",w:"80px"},{label:"SKU",w:"76px"},{label:"End Date",w:"90px"},{label:"Status",w:"44px"},{label:"Adherence"},{label:"Risk",w:"58px"}]}/>
            {prod.map((r,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"80px 76px 90px 44px 1fr 58px",
                padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":C.off,fontSize:12,alignItems:"center"}}>
                <span style={{color:C.charcoal,fontWeight:700}}>{r.pro}</span>
                <span style={{color:C.muted,fontSize:10}}>{r.sku}</span>
                <span style={{color:C.charcoal}}>{r.end}</span>
                <span style={{color:proStatusColor(r.status),fontWeight:700,fontSize:10}}>{r.status}</span>
                <AdherenceBar pct={r.adherence}/>
                <span style={{color:riskColor(r.risk),fontWeight:700,fontSize:10,textAlign:"right"}}>{r.risk}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Raw Materials */}
        <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
          <div style={{fontSize:15,fontWeight:700,color:C.charcoal,marginBottom:4}}>Raw Material Status</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:14}}>Directional concern flags — key inputs across portfolio</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
            {rm.map((r,i)=>(
              <div key={i} style={{borderRadius:8,padding:14,border:`1px solid ${C.border}`,
                borderLeft:`4px solid ${r.concern?C.red:C.green}`,background:r.concern?"#fde8ec08":C.off}}>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontSize:12,fontWeight:700,color:C.charcoal,lineHeight:1.35,flex:1,marginRight:8}}>{r.material}</span>
                  <Pill label={r.concern?"CONCERN":"CLEAR"} color={r.concern?C.red:C.green} size={9}/>
                </div>
                <div style={{fontSize:11,color:C.muted,marginBottom:4}}>
                  DoS: <strong style={{color:r.dos<10?C.red:r.dos<21?C.orange:C.green,fontSize:13,fontFamily:MONO}}>{r.dos}d</strong>
                </div>
                <div style={{fontSize:10,color:C.charcoal,marginBottom:6,lineHeight:1.4}}>{r.rationale}</div>
                <div style={{fontSize:9,color:C.muted}}>SKUs: {r.skus}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── DEMAND PLANNING AGENT PAGE ────────────────────────────────────────────
function DemandPlanningPage(){
  const pos=PORT_DEMAND.positions;
  const promo=PORT_DEMAND.promo_calendar;
  const classColor={GENUINE_PULL:C.green,BUFFER_BUILD:C.red,PROMO_DRIVEN:C.blue,
    ONE_OFF_ANOMALY:C.orange,SYSTEMATIC_PLAN_ERROR:C.red,INSUFFICIENT_DATA:C.muted};
  const qualColor={HEALTHY:C.green,SYSTEMATIC_UNDER:C.orange,SYSTEMATIC_OVER:C.orange,NOISY:C.orange,INSUFFICIENT_DATA:C.muted};
  const promoStatusColor={APPROVED:C.green,PENDING:C.orange,CANCELLED:C.red};
  const aboveForecast=pos.filter(x=>x.vs_plan>15).length;
  const bufferBuild=pos.filter(x=>x.classification==="BUFFER_BUILD").length;
  const avgWmape=(pos.reduce((s,x)=>s+x.wmape,0)/pos.length).toFixed(1);
  const promoCount=pos.filter(x=>x.promo).length;
  const escCount=pos.filter(x=>x.escalation).length;
  return (
    <div>
      <AgentPageHeader title="Demand Planning Agent" color={C.orange}
        question="Is this order consistent with the forecast? Is it abnormally high, and why?"/>
      <div style={{padding:24}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:24}}>
          <AgentKpi label="Orders Above Forecast" value={aboveForecast.toString()} status={aboveForecast>2?"bad":aboveForecast>0?"warn":"ok"} delta="> 15% above plan"/>
          <AgentKpi label="Buffer Build Detections" value={bufferBuild.toString()} status={bufferBuild>0?"bad":"ok"} delta="high confidence flags"/>
          <AgentKpi label="Portfolio Avg WMAPE" value={`${avgWmape}%`} status={parseFloat(avgWmape)<15?"ok":parseFloat(avgWmape)<22?"warn":"bad"} delta="trailing 90 days"/>
          <AgentKpi label="Promo Attributed" value={promoCount.toString()} status="neutral" delta="orders with promo driver"/>
          <AgentKpi label="Escalations Flagged" value={escCount.toString()} status={escCount>0?"warn":"ok"} delta="demand team review"/>
        </div>

        {/* Forecast Position Table */}
        <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",marginBottom:16}}>
          <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${C.border}`}}>
            <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>Forecast Position by Order</div>
            <div style={{fontSize:12,color:C.muted,marginTop:3}}>Sorted by most above forecast — all active orders</div>
          </div>
          <TableHeader cols={[{label:"Customer",w:"90px"},{label:"SKU",w:"76px"},{label:"vs Plan",w:"80px"},{label:"Classification"},{label:"WMAPE",w:"65px"},{label:"Bias",w:"56px"},{label:"Quality",w:"110px"},{label:"Promo",w:"50px"},{label:"Esc",w:"36px"}]}/>
          {pos.map((r,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"90px 76px 80px 1fr 65px 56px 110px 50px 36px",
              padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":C.off,fontSize:12,alignItems:"center"}}>
              <span style={{fontWeight:600,color:C.charcoal}}>{r.customer}</span>
              <span style={{color:C.muted,fontSize:10}}>{r.sku}</span>
              <span style={{fontWeight:700,color:r.vs_plan>30?C.red:r.vs_plan>10?C.orange:r.vs_plan<0?C.muted:C.green}}>
                {r.vs_plan>0?"+":""}{r.vs_plan}%
              </span>
              <span style={{color:classColor[r.classification]||C.muted,fontWeight:700,fontSize:10}}>
                {r.classification.replace(/_/g," ")}
              </span>
              <span style={{textAlign:"right",color:r.wmape<15?C.green:r.wmape<25?C.orange:C.red,fontWeight:600}}>{r.wmape}%</span>
              <span style={{textAlign:"right",color:Math.abs(r.bias)<5?C.green:C.orange,fontWeight:600}}>
                {r.bias>0?"+":""}{r.bias}%
              </span>
              <span style={{color:qualColor[r.quality]||C.muted,fontSize:10,fontWeight:600}}>
                {r.quality.replace(/_/g," ")}
              </span>
              <span style={{color:r.promo?C.blue:C.muted,fontWeight:700,fontSize:10,textAlign:"center"}}>{r.promo?"Yes":"—"}</span>
              <span style={{color:r.escalation?C.red:C.muted,fontWeight:700,fontSize:10,textAlign:"center"}}>{r.escalation?"⚠":"—"}</span>
            </div>
          ))}
        </div>

        {/* Promo Calendar */}
        <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
          <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${C.border}`}}>
            <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>Promotional Calendar</div>
            <div style={{fontSize:12,color:C.muted,marginTop:3}}>Upcoming and active events — planning window</div>
          </div>
          <TableHeader cols={[{label:"Customer",w:"90px"},{label:"SKU",w:"76px"},{label:"Event Name"},{label:"Promo Type"},{label:"Dates",w:"110px"},{label:"Incremental",w:"90px",right:true},{label:"Status",w:"80px"}]}/>
          {promo.map((r,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"90px 76px 1fr 1fr 110px 90px 80px",
              padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":C.off,fontSize:12,alignItems:"center"}}>
              <span style={{fontWeight:600,color:C.charcoal}}>{r.customer}</span>
              <span style={{color:C.muted,fontSize:10}}>{r.sku}</span>
              <span style={{color:C.charcoal}}>{r.name}</span>
              <span style={{color:C.muted,fontSize:10}}>{r.type.replace(/_/g," ")}</span>
              <span style={{color:C.charcoal}}>{r.dates}</span>
              <span style={{textAlign:"right",fontWeight:600,color:C.blue}}>{r.incr.toLocaleString()} cs</span>
              <Pill label={r.status} color={promoStatusColor[r.status]||C.muted} size={10}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── TRANSPORTATION AGENT PAGE ─────────────────────────────────────────────
function TransportationPage(){
  const lanes=PORT_TRANSPORT.lanes;
  const carriers=PORT_TRANSPORT.carriers;
  const otif=PORT_TRANSPORT.otif;
  const failingLanes=lanes.filter(x=>x.otp<0.9||!x.viable).length;
  const failCarriers=carriers.filter(x=>!x.meets).length;
  const totalCB=otif.reduce((s,x)=>s+x.exposure,0);
  const belowOtif=otif.filter(x=>x.otif<x.target).length;
  const activeAlerts=10;
  return (
    <div>
      <AgentPageHeader title="Transportation Agent" color={C.teal}
        question="Can we deliver on time? Lane feasibility, carrier reliability, OTIF exposure."/>
      <div style={{padding:24}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:24}}>
          <AgentKpi label="Active Lanes" value={lanes.length.toString()} status="neutral" delta="across all DCs"/>
          <AgentKpi label="Lanes Failing OTP" value={failingLanes.toString()} status={failingLanes>1?"bad":failingLanes>0?"warn":"ok"} delta="below target or non-viable"/>
          <AgentKpi label="Total CB Exposure" value={`$${(totalCB/1000).toFixed(0)}K`} status={totalCB>100000?"bad":totalCB>30000?"warn":"ok"} delta="posted + disputed"/>
          <AgentKpi label="Customers Below OTIF Target" value={belowOtif.toString()} status={belowOtif>2?"bad":belowOtif>0?"warn":"ok"} delta="trailing 90 days"/>
          <AgentKpi label="Active Alerts" value={activeAlerts.toString()} status={activeAlerts>8?"bad":activeAlerts>4?"warn":"ok"} delta="delivery & carrier"/>
        </div>

        {/* OTIF Scoreboard */}
        <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",marginBottom:16}}>
          <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${C.border}`}}>
            <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>Customer OTIF Scoreboard</div>
            <div style={{fontSize:12,color:C.muted,marginTop:3}}>Trailing 90 days — sorted by worst first</div>
          </div>
          <TableHeader cols={[{label:"Customer",w:"110px"},{label:"Trailing OTIF"},{label:"Target",w:"70px"},{label:"Delta",w:"70px"},{label:"CB Exposure",w:"100px",right:true},{label:"Chargebacks",w:"90px",right:true},{label:"Status",w:"80px"}]}/>
          {otif.map((r,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"110px 1fr 70px 70px 100px 90px 80px",
              padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":C.off,fontSize:12,alignItems:"center"}}>
              <span style={{fontWeight:700,color:C.charcoal}}>{r.customer}</span>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{flex:1,height:5,background:C.border,borderRadius:2,overflow:"hidden",maxWidth:100}}>
                    <div style={{width:`${r.otif*100}%`,height:"100%",background:r.otif>=r.target?C.green:r.otif>=0.85?C.orange:C.red,borderRadius:2}}/>
                  </div>
                  <span style={{fontWeight:700,color:r.otif>=r.target?C.green:r.otif>=0.85?C.orange:C.red}}>{Math.round(r.otif*100)}%</span>
                </div>
              </div>
              <span style={{color:C.muted}}>{Math.round(r.target*100)}%</span>
              <span style={{fontWeight:700,color:r.delta>=0?C.green:r.delta>=-5?C.orange:C.red}}>
                {r.delta>0?"+":""}{r.delta} pp
              </span>
              <span style={{textAlign:"right",fontWeight:600,color:r.exposure>50000?C.red:r.exposure>10000?C.orange:C.green}}>
                {r.exposure>0?`$${(r.exposure/1000).toFixed(1)}K`:"$0"}
              </span>
              <span style={{textAlign:"right",color:r.cb>4?C.red:r.cb>1?C.orange:C.green,fontWeight:600}}>{r.cb}</span>
              <Pill label={r.otif>=r.target?"ON TARGET":"BELOW TARGET"} color={r.otif>=r.target?C.green:C.red} size={9}/>
            </div>
          ))}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          {/* Carrier League */}
          <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
            <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${C.border}`}}>
              <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>Carrier League Table</div>
              <div style={{fontSize:12,color:C.muted,marginTop:3}}>OTP vs contracted target — ranked</div>
            </div>
            <TableHeader cols={[{label:"Rank",w:"36px"},{label:"Carrier"},{label:"OTP",w:"56px"},{label:"Target",w:"56px"},{label:"CBs",w:"36px"},{label:"Status",w:"80px"}]}/>
            {carriers.map((r,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"36px 1fr 56px 56px 36px 80px",
                padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":C.off,fontSize:12,alignItems:"center"}}>
                <span style={{fontWeight:700,color:C.muted,fontSize:12}}>#{i+1}</span>
                <span style={{fontWeight:600,color:C.charcoal,fontSize:12}}>{r.name}</span>
                <span style={{fontWeight:700,color:r.meets?C.green:C.red,textAlign:"right"}}>{Math.round(r.otp*100)}%</span>
                <span style={{color:C.muted,textAlign:"right"}}>{Math.round(r.target*100)}%</span>
                <span style={{color:r.cb>3?C.red:r.cb>1?C.orange:C.green,fontWeight:600,textAlign:"right"}}>{r.cb}</span>
                <Pill label={r.meets?"MEETS":"FAILS"} color={r.meets?C.green:C.red} size={9}/>
              </div>
            ))}
          </div>

          {/* Lane Performance */}
          <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
            <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${C.border}`}}>
              <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>Lane Performance</div>
              <div style={{fontSize:12,color:C.muted,marginTop:3}}>All active lanes — sorted by OTP</div>
            </div>
            <TableHeader cols={[{label:"Lane"},{label:"Transit",w:"54px"},{label:"OTP",w:"52px"},{label:"Ships",w:"44px"},{label:"Viable",w:"52px"}]}/>
            {[...lanes].sort((a,b)=>b.otp-a.otp).map((r,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 54px 52px 44px 52px",
                padding:"10px 12px",borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":C.off,fontSize:12,alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:600,color:C.charcoal,fontSize:11}}>{r.lane}</div>
                  <div style={{fontSize:9,color:C.muted}}>{r.carrier}</div>
                </div>
                <span style={{color:C.muted,textAlign:"right"}}>{r.transit}h</span>
                <span style={{fontWeight:700,color:r.otp>=0.95?C.green:r.otp>=0.85?C.orange:C.red,textAlign:"right"}}>
                  {Math.round(r.otp*100)}%
                </span>
                <span style={{color:C.muted,textAlign:"right"}}>{r.ships}</span>
                <span style={{color:r.viable?C.green:C.red,fontWeight:700,fontSize:10,textAlign:"center"}}>{r.viable?"Yes":"No"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── RETAIL INTELLIGENCE AGENT PAGE ────────────────────────────────────────
function RetailIntelligencePage(){
  const cls=PORT_RETAIL.classifications;
  const pos=PORT_RETAIL.pos_trends;
  const clsColor={GENUINE_PULL:C.green,BUFFER_BUILD:C.red,PROMO_DRIVEN:C.blue,INSUFFICIENT_DATA:C.muted};
  const trendColor={ACCELERATING:C.green,FLAT:C.muted,DECELERATING:C.orange};
  const bufferBuilds=cls.filter(x=>x.cls==="BUFFER_BUILD").length;
  const genuinePull=cls.filter(x=>x.cls==="GENUINE_PULL").length;
  const promoDriven=cls.filter(x=>x.cls==="PROMO_DRIVEN").length;
  const avgConf=Math.round(cls.reduce((s,x)=>s+x.conf,0)/cls.length*100);
  const accelerating=pos.filter(x=>x.trend==="ACCELERATING").length;
  return (
    <div>
      <AgentPageHeader title="Retail Intelligence Agent" color={C.purple}
        question="Is this real consumer demand, or a retailer stockpiling? Promo-driven? Consumer takeaway rising?"/>
      <div style={{padding:24}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:24}}>
          <AgentKpi label="Buffer Build Flags" value={bufferBuilds.toString()} status={bufferBuilds>0?"bad":"ok"} delta="high-confidence detections"/>
          <AgentKpi label="Genuine Pull Confirmed" value={genuinePull.toString()} status="ok" delta="across portfolio"/>
          <AgentKpi label="Promo Driven" value={promoDriven.toString()} status="neutral" delta="promo-attributed orders"/>
          <AgentKpi label="Avg Classification Confidence" value={`${avgConf}%`} status={avgConf>=80?"ok":avgConf>=65?"warn":"bad"} delta="portfolio average"/>
          <AgentKpi label="Accelerating POS Trends" value={accelerating.toString()} status={accelerating>=2?"ok":"neutral"} delta="SKUs with ACCELERATING tag"/>
        </div>

        {/* Buffer-Build Risk Scoreboard */}
        <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",marginBottom:16}}>
          <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>Demand Classification Scoreboard</div>
              <div style={{fontSize:12,color:C.muted,marginTop:3}}>All active customer-SKU combinations — sorted by risk score</div>
            </div>
            <div style={{fontSize:11,color:C.muted}}>Risk: 5 = highest buffer-build concern · 1 = low risk</div>
          </div>
          <TableHeader cols={[{label:"Customer",w:"90px"},{label:"SKU",w:"76px"},{label:"Description"},{label:"Classification",w:"130px"},{label:"Confidence",w:"80px"},{label:"OHI vs Norm",w:"100px"},{label:"POS Trend",w:"90px"},{label:"Risk",w:"40px",right:true}]}/>
          {cls.map((r,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"90px 76px 1fr 130px 80px 100px 90px 40px",
              padding:"10px 12px",borderBottom:`1px solid ${C.border}`,
              background:r.cls==="BUFFER_BUILD"?"rgba(219,3,59,0.03)":i%2===0?"#fff":C.off,
              fontSize:12,alignItems:"center"}}>
              <span style={{fontWeight:700,color:C.charcoal}}>{r.customer}</span>
              <span style={{color:C.muted,fontSize:10}}>{r.sku}</span>
              <span style={{color:C.charcoal,fontSize:11}}>{r.desc}</span>
              <span style={{color:clsColor[r.cls]||C.muted,fontWeight:700,fontSize:10}}>{r.cls.replace(/_/g," ")}</span>
              <span style={{color:r.conf>=0.8?C.green:r.conf>=0.65?C.orange:C.red,fontWeight:700}}>
                {Math.round(r.conf*100)}%
              </span>
              <span style={{color:r.ohi===null?C.muted:r.ohi>r.ohi_norm?C.red:r.ohi<r.ohi_norm*0.5?C.orange:C.green,fontWeight:600}}>
                {r.ohi===null?"DTC — N/A":`${r.ohi}d vs ${r.ohi_norm}d`}
              </span>
              <span style={{color:trendColor[r.trend]||C.muted,fontWeight:700}}>{r.trend}</span>
              <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end"}}>
                <span style={{
                  display:"inline-block",width:26,height:26,borderRadius:"50%",lineHeight:"26px",textAlign:"center",
                  fontWeight:900,fontSize:12,
                  background:r.risk>=5?C.red:r.risk>=3?C.orange:r.risk>=2?C.blue:"#edf7ee",
                  color:r.risk>=2?"#fff":C.green,
                }}>{r.risk}</span>
              </div>
            </div>
          ))}
        </div>

        {/* POS Velocity */}
        <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
          <div style={{fontSize:15,fontWeight:700,color:C.charcoal,marginBottom:4}}>POS Velocity Trends — Portfolio View</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:16}}>8-week trailing consumer units ('000s) · all channels combined</div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {pos.map((r,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 280px 70px 80px",gap:16,alignItems:"center",
                padding:"10px 14px",background:C.off,borderRadius:8,border:`1px solid ${C.border}`}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:C.charcoal,marginBottom:2}}>{r.desc}</div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:11,color:C.muted}}>{r.sku}</span>
                    <Pill label={r.trend} color={trendColor[r.trend]||C.muted} size={10}/>
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,color:C.muted,marginBottom:4}}>Units (000s) — 8-week trend</div>
                  <ResponsiveContainer width="100%" height={40}>
                    <BarChart data={r.weekly} margin={{top:0,bottom:0,left:0,right:0}}>
                      <Bar dataKey="v" fill={trendColor[r.trend]||C.blue} radius={[2,2,0,0]}/>
                      <Tooltip formatter={(v)=>[`${v}K units`,""]} contentStyle={{fontSize:10}}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:9,color:C.muted,marginBottom:4}}>Latest POS</div>
                  <div style={{fontSize:18,fontWeight:700,color:C.charcoal,fontFamily:MONO}}>{r.weekly[r.weekly.length-1].v}K</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:9,color:C.muted,marginBottom:4}}>ACV Dist.</div>
                  <div style={{fontSize:18,fontWeight:700,color:r.acv>=75?C.green:r.acv>=60?C.orange:C.red,fontFamily:MONO}}>{r.acv}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}




// ── NEXUS SYSTEM PROMPT BUILDER ───────────────────────────────────────────────
function buildNexusContext(){
  const orderSummary=ORDERS.map(o=>{
    const syn=SYNTHESIS[o.id];
    const agentSignals=syn?.signals?Object.fromEntries(
      Object.entries(syn.signals).map(([k,v])=>[k,{
        disposition:v.disposition,
        confidence:Math.round(v.confidence*100)+"%",
        summary:v.summary
      }])
    ):{};
    return {
      order_id:o.id,po:o.po,customer:o.customer,sku:o.desc,
      qty_cs:o.qty,mabd:o.mabd,ship_to:o.ship_to,flag:o.flag,
      recommendation:syn?.rec?{
        action:syn.rec.action,qty_cs:syn.rec.qty,
        fill_pct:syn.rec.fill_pct,
        confidence:Math.round(syn.rec.confidence*100)+"%",
        outcome:syn.rec.outcome
      }:null,
      agent_signals:agentSignals
    };
  });

  const networkSummary=NETWORK_NODES.map(n=>({
    name:n.name,location:n.city,type:n.type,
    status:n.status,issue:n.reason
  }));

  const riskSummary=SIMULATOR_INCIDENTS.map(i=>({
    customer:i.customer,issue:i.title,
    fine_at_risk:"$"+(i.fine_at_risk/1000).toFixed(0)+"K",
    risk_probability:Math.round(i.risk_probability*100)+"%",
    recommended_action:i.scenarios.find(s=>s.is_recommended)?.name||"—",
    potential_saving:"$"+((i.scenarios.find(s=>s.is_recommended)?.savings_vs_default||0)/1000).toFixed(1)+"K"
  }));

  const kpis=(WATCHTOWER_DATA?.kpis||[]).slice(0,6).map(k=>({
    metric:k.label,value:k.value,target:k.target
  }));

  return `You are Nexus, an AI Co-Pilot embedded in the Mars Pet Nutrition Supply AI Control Tower. You assist the Customer Supply Team in making faster, better-informed fulfillment decisions.

You have full visibility into today's operational state. Use only the data below — never invent figures.

## Active Orders in Triage (${ORDERS.length} orders)
${JSON.stringify(orderSummary,null,2)}

## Supply Network Status
${JSON.stringify(networkSummary,null,2)}

## Fulfillment Financial Risk
${JSON.stringify(riskSummary,null,2)}

## Network KPIs
${JSON.stringify(kpis,null,2)}

## Response guidelines
- Be concise and actionable. Reference specific SO numbers, customers, SKUs, and dollar figures.
- If asked what to prioritize, rank by financial risk (highest first).
- Use bullet points for lists. Keep responses under 200 words unless detail is explicitly requested.
- Never fabricate data not present in the context above.`;
}

// ── DATA DICTIONARY PAGE ─────────────────────────────────────────────────────
function DataDictionaryPage(){
  const [query,setQuery]=useState("");
  const [activeSection,setActiveSection]=useState("All");

  const q=query.toLowerCase().trim();
  const sections=DICT_SECTIONS.map(s=>({
    ...s,
    terms:s.terms.filter(t=>
      !q||
      t.term.toLowerCase().includes(q)||
      (t.full||"").toLowerCase().includes(q)||
      t.def.toLowerCase().includes(q)
    )
  })).filter(s=>s.terms.length>0&&(activeSection==="All"||s.section===activeSection));

  const totalTerms=DICT_SECTIONS.reduce((s,sec)=>s+sec.terms.length,0);
  const matchCount=sections.reduce((s,sec)=>s+sec.terms.length,0);

  const sectionColors={
    "Order & Fulfillment":C.blue,
    "Inventory":C.teal,
    "Demand & Forecast":C.orange,
    "Transportation & Logistics":C.red,
    "Retail Intelligence":C.purple,
    "Financial":C.green,
    "Agent & System":C.charcoal,
  };

  return (
    <div>
      {/* Header */}
      <div style={{background:C.charcoal,padding:"22px 28px 20px",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-20,right:-20,width:160,height:160,
          borderRadius:"50%",background:"rgba(255,255,255,0.05)",pointerEvents:"none"}}/>
        <div style={{position:"absolute",bottom:-30,right:80,width:100,height:100,
          borderRadius:"50%",background:"rgba(255,255,255,0.03)",pointerEvents:"none"}}/>
        <div style={{position:"relative"}}>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.55)",textTransform:"uppercase",
            letterSpacing:"0.2em",marginBottom:8,fontWeight:700}}>Info</div>
          <div style={{fontSize:28,fontWeight:700,color:"#fff",marginBottom:10,
            letterSpacing:"-0.02em",lineHeight:1.1}}>Data Dictionary</div>
          <div style={{display:"flex",alignItems:"flex-start",gap:8,
            borderTop:"1px solid rgba(255,255,255,0.15)",paddingTop:10}}>
            <span style={{fontSize:14,color:"rgba(255,255,255,0.4)",flexShrink:0,lineHeight:1.5}}>◈</span>
            <span style={{fontSize:13,color:"rgba(255,255,255,0.88)",lineHeight:1.6}}>
              Functional definitions for every KPI and metric used across the Supply AI platform.
              {" "}{totalTerms} terms across {DICT_SECTIONS.length} domains.
            </span>
          </div>
        </div>
      </div>

      <div style={{padding:24,maxWidth:1100}}>
        {/* Search + filter bar */}
        <div style={{display:"flex",gap:12,marginBottom:20,alignItems:"center"}}>
          <input
            value={query}
            onChange={e=>setQuery(e.target.value)}
            placeholder={`Search ${totalTerms} terms...`}
            style={{flex:1,padding:"9px 14px",border:`1px solid ${C.border}`,borderRadius:6,
              fontSize:13,fontFamily:"inherit",outline:"none",background:"#fff",
              color:C.charcoal}}
          />
          {["All",...DICT_SECTIONS.map(s=>s.section)].map(sec=>(
            <button key={sec} onClick={()=>setActiveSection(sec)} style={{
              padding:"7px 12px",border:`1px solid ${activeSection===sec?C.red:C.border}`,
              borderRadius:6,fontSize:11,fontWeight:activeSection===sec?700:500,
              background:activeSection===sec?C.redLight:"#fff",
              color:activeSection===sec?C.red:C.muted,cursor:"pointer",
              fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0,
            }}>
              {sec==="All"?"All Sections":sec}
            </button>
          ))}
        </div>
        {q&&<div style={{fontSize:12,color:C.muted,marginBottom:16}}>
          {matchCount} result{matchCount!==1?"s":""} for "{query}"
        </div>}

        {/* Dictionary sections */}
        {sections.map(sec=>{
          const col=sectionColors[sec.section]||C.charcoal;
          return (
            <div key={sec.section} style={{background:"#fff",border:`1px solid ${C.border}`,
              borderRadius:8,overflow:"hidden",marginBottom:16}}>
              {/* Section header */}
              <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.border}`,
                display:"flex",alignItems:"center",gap:10,
                background:"#f8fafc"}}>
                <span style={{width:10,height:10,borderRadius:"50%",background:col,
                  display:"inline-block",flexShrink:0,
                  boxShadow:`0 0 0 3px ${col}22`}}/>
                <div style={{fontSize:14,fontWeight:700,color:C.charcoal,flex:1}}>
                  {sec.section}
                </div>
                <div style={{fontSize:11,color:C.muted}}>
                  {sec.terms.length} term{sec.terms.length!==1?"s":""}
                </div>
              </div>

              {/* Term rows */}
              {sec.terms.map((t,i)=>(
                <div key={t.term} style={{
                  display:"grid",gridTemplateColumns:"200px 1fr 160px",
                  padding:"12px 18px",
                  borderBottom:i<sec.terms.length-1?`1px solid ${C.border}`:"none",
                  background:i%2===0?"#fff":"#fafafa",
                  alignItems:"start",gap:16}}>
                  {/* Term + abbreviation */}
                  <div>
                    <div style={{fontWeight:700,color:C.charcoal,fontSize:13,
                      fontFamily:MONO,marginBottom:t.full?3:0}}>{t.term}</div>
                    {t.full&&<div style={{fontSize:10,color:C.muted,lineHeight:1.3}}>
                      {t.full}
                    </div>}
                  </div>
                  {/* Definition */}
                  <div style={{fontSize:12,color:C.charcoal,lineHeight:1.65}}>
                    {t.def}
                  </div>
                  {/* Used in */}
                  <div style={{display:"flex",flexWrap:"wrap",gap:4,paddingTop:2}}>
                    {t.screens.map(s=>(
                      <span key={s} style={{fontSize:9,fontWeight:600,
                        background:`${col}14`,color:col,
                        borderRadius:4,padding:"2px 6px",
                        border:`1px solid ${col}30`,
                        whiteSpace:"nowrap"}}>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {sections.length===0&&(
          <div style={{textAlign:"center",padding:"48px 0",color:C.muted}}>
            <div style={{fontSize:32,marginBottom:12,opacity:0.3}}>⌕</div>
            <div style={{fontSize:15,fontWeight:600,color:C.charcoal,marginBottom:4}}>
              No terms match "{query}"
            </div>
            <div style={{fontSize:13}}>Try a different keyword or clear the search.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── DATA HEALTH PAGE ─────────────────────────────────────────────────────────
function DataHealthPage(){
  const REF = new Date("2026-05-19T08:05:00Z");
  const statusColor={FRESH:C.green,WARNING:C.orange,STALE:C.red};
  const all=DATA_HEALTH.flatMap(g=>g.sources);
  const freshN=all.filter(s=>s.status==="FRESH").length;
  const warnN=all.filter(s=>s.status==="WARNING").length;
  const staleN=all.filter(s=>s.status==="STALE").length;

  function age(ts){
    const diff=Math.max(0,REF-new Date(ts));
    const m=Math.floor(diff/60000);
    const h=Math.floor(m/60);
    const d=Math.floor(h/24);
    if(d>0)return `${d}d ${h%24}h ago`;
    if(h>0)return `${h}h ${m%60}m ago`;
    return `${m}m ago`;
  }
  function fmt(ts,withSec){
    const d=new Date(ts);
    const date=d.toLocaleDateString("en-GB",{day:"2-digit",month:"short"});
    const time=withSec
      ?d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit"})
      :d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
    return `${date} ${time}`;
  }

  return (
    <div>
      {/* Page Header — reuses AgentPageHeader visual style */}
      <div style={{background:C.charcoal,padding:"22px 28px 20px",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-20,right:-20,width:160,height:160,
          borderRadius:"50%",background:"rgba(255,255,255,0.05)",pointerEvents:"none"}}/>
        <div style={{position:"absolute",bottom:-30,right:80,width:100,height:100,
          borderRadius:"50%",background:"rgba(255,255,255,0.03)",pointerEvents:"none"}}/>
        <div style={{position:"relative"}}>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.55)",textTransform:"uppercase",
            letterSpacing:"0.2em",marginBottom:8,fontWeight:700}}>Info</div>
          <div style={{fontSize:28,fontWeight:700,color:"#fff",marginBottom:10,
            letterSpacing:"-0.02em",lineHeight:1.1}}>Data Health</div>
          <div style={{display:"flex",alignItems:"flex-start",gap:8,
            borderTop:"1px solid rgba(255,255,255,0.15)",paddingTop:10}}>
            <span style={{fontSize:14,color:"rgba(255,255,255,0.4)",flexShrink:0,lineHeight:1.5}}>◈</span>
            <span style={{fontSize:13,color:"rgba(255,255,255,0.88)",lineHeight:1.6}}>
              Last load timestamps and freshness status for every functional data source
              that feeds the five Supply AI agents. Reference time: {fmt("2026-05-19T08:05:00Z",false)} UTC.
            </span>
          </div>
        </div>
      </div>

      <div style={{padding:24,maxWidth:1280}}>
        {/* Summary KPIs */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
          <AgentKpi label="Total Sources" value={all.length.toString()} status="neutral" delta="across all 4 agents"/>
          <AgentKpi label="Fresh" value={freshN.toString()} status="ok" delta="within refresh window"/>
          <AgentKpi label="Warning" value={warnN.toString()} status={warnN>0?"warn":"ok"} delta="infrequent / approaching stale"/>
          <AgentKpi label="Stale" value={staleN.toString()} status={staleN>0?"bad":"ok"} delta="overdue for refresh"/>
        </div>

        {/* Per-agent source tables */}
        {DATA_HEALTH.map(group=>(
          <div key={group.agent} style={{background:"#fff",border:`1px solid ${C.border}`,
            borderRadius:8,overflow:"hidden",marginBottom:16}}>
            {/* Card header */}
            <div style={{padding:"14px 18px 10px",borderBottom:`1px solid ${C.border}`,
              display:"flex",alignItems:"center",gap:10}}>
              <span style={{width:10,height:10,borderRadius:"50%",background:group.color,
                display:"inline-block",flexShrink:0,boxShadow:`0 0 0 3px ${group.color}22`}}/>
              <div style={{fontSize:15,fontWeight:700,color:C.charcoal,flex:1}}>{group.agent}</div>
              <div style={{fontSize:11,color:C.muted}}>
                {group.sources.filter(s=>s.status==="FRESH").length} of {group.sources.length} sources fresh
              </div>
            </div>

            {/* Table header */}
            <div style={{display:"grid",
              gridTemplateColumns:"200px 1fr 148px 88px 108px 148px 90px",
              background:"#f1f5f9",borderBottom:`1px solid ${C.border}`,padding:"7px 14px"}}>
              {["Data Source","System / Integration","Last Loaded","Age","Frequency","Next Refresh","Status"].map(h=>(
                <div key={h} style={{fontSize:10,fontWeight:700,color:"#64748b",
                  textTransform:"uppercase",letterSpacing:"0.08em"}}>{h}</div>
              ))}
            </div>

            {/* Rows */}
            {group.sources.map((s,i)=>{
              const sc=statusColor[s.status];
              const isStale=s.status==="STALE";
              return (
                <div key={i} style={{display:"grid",
                  gridTemplateColumns:"200px 1fr 148px 88px 108px 148px 90px",
                  padding:"11px 14px",borderBottom:i<group.sources.length-1?`1px solid ${C.border}`:"none",
                  background:isStale?"rgba(219,3,59,0.025)":i%2===0?"#fff":C.off,
                  fontSize:12,alignItems:"center"}}>
                  <span style={{fontWeight:600,color:C.charcoal}}>{s.name}</span>
                  <span style={{color:C.muted,fontSize:11}}>{s.system}</span>
                  <span style={{fontFamily:MONO,fontSize:11,color:C.charcoal,
                    fontWeight:isStale?700:400,color:isStale?C.red:C.charcoal}}>
                    {fmt(s.lastLoad,true)}
                  </span>
                  <span style={{fontWeight:600,fontSize:11,color:sc}}>{age(s.lastLoad)}</span>
                  <span style={{color:C.muted,fontSize:11}}>{s.freq}</span>
                  <span style={{fontFamily:MONO,fontSize:11,color:C.muted}}>{fmt(s.next,false)}</span>
                  <Pill label={s.status} color={sc} size={9}/>
                </div>
              );
            })}
          </div>
        ))}

        {/* Footer note */}
        <div style={{fontSize:11,color:C.muted,textAlign:"center",marginTop:8,lineHeight:1.6}}>
          All timestamps in UTC. Freshness is determined by comparing last load time to the expected refresh frequency.
          A source marked <strong style={{color:C.orange}}>WARNING</strong> uses a weekly cadence by design (e.g. syndicated POS data).
          A source marked <strong style={{color:C.red}}>STALE</strong> has missed its expected refresh window.
        </div>
      </div>
    </div>
  );
}

// ── NEXUS CO-PILOT (RIGHT SIDEBAR) ───────────────────────────────────────────
function NexusCoPilot(){
  const [col,setCol]=useState(false);
  const [input,setInput]=useState('');
  const [loading,setLoading]=useState(false);
  const [apiStatus,setApiStatus]=useState(NEXUS_API_KEY?'ready':'no_key');
  const [messages,setMessages]=useState([{
    role:'agent',
    text:'Good morning. I have full visibility into your <strong>5 active orders</strong>, network status, and financial risk landscape. The highest-priority item right now is the <strong style="color:#DB033B">Chewy stockout — $57.6K at risk</strong>. Where would you like to start?'
  }]);
  const bottomRef=useRef(null);

  useEffect(()=>{
    if(!col) bottomRef.current?.scrollIntoView({behavior:'smooth'});
  },[messages,col]);

  async function handleSend(){
    if(!input.trim()||loading||!NEXUS_API_KEY)return;
    const userText=input.trim();
    setInput('');
    const newMsgs=[...messages,{role:'user',text:userText}];
    setMessages(newMsgs);
    setLoading(true);
    try{
      // Build Gemini conversation (skip initial greeting — not API-generated)
      const contents=newMsgs
        .filter((_,i)=>i>0) // skip hardcoded opening message
        .map(m=>({
          role:m.role==='user'?'user':'model',
          parts:[{text:m.text.replace(/<[^>]*>/g,'')}] // strip HTML for API
        }));

      const res=await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${NEXUS_MODEL}:generateContent?key=${NEXUS_API_KEY}`,
        {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            system_instruction:{parts:[{text:buildNexusContext()}]},
            contents,
            generationConfig:{maxOutputTokens:800,temperature:0.4}
          })
        }
      );
      const data=await res.json();
      if(data.error)throw new Error(data.error.message);
      const text=data.candidates?.[0]?.content?.parts?.[0]?.text||'No response received.';
      setMessages(prev=>[...prev,{role:'agent',text}]);
      setApiStatus('ready');
    }catch(e){
      setMessages(prev=>[...prev,{role:'agent',
        text:`⚠ ${e.message}. Check your Gemini API key and ensure the Generative Language API is enabled in your Google Cloud project.`}]);
      setApiStatus('error');
    }finally{
      setLoading(false);
    }
  }

  function handleKey(e){
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();}
  }

  const QUICK_PROMPTS=[
    'What should I prioritize right now?',
    'Summarize the Chewy stockout risk',
    'Which orders have agent conflicts?',
  ];

  const statusDot={
    ready:C.green, error:C.red, no_key:'#f59e0b', idle:'#94a3b8'
  }[apiStatus]||C.muted;

  const statusLabel={
    ready:'Gemini 2.0 Flash · Ready',
    error:'API Error',
    no_key:'API Key Required',
    idle:'Initialising…'
  }[apiStatus];

  // ── Collapsed ───────────────────────────────────────────────────────────────
  if(col) return (
    <aside style={{width:60,borderLeft:`1px solid ${C.border}`,background:'#fff',
      display:'flex',flexDirection:'column',flexShrink:0,zIndex:20}}>
      <div style={{height:56,display:'flex',alignItems:'center',justifyContent:'center',
        borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        <button onClick={()=>setCol(false)} style={{width:36,height:36,display:'flex',
          alignItems:'center',justifyContent:'center',borderRadius:8,
          border:'none',background:'transparent',cursor:'pointer',color:C.muted}}>
          <PanelRightOpen size={18}/>
        </button>
      </div>
      <div style={{flex:1,display:'flex',flexDirection:'column',
        alignItems:'center',paddingTop:20,gap:0}}>
        <div onClick={()=>setCol(false)}
          title="Open Nexus — Mars AI Co-Pilot"
          style={{position:'relative',cursor:'pointer'}}>
          <div style={{width:38,height:38,borderRadius:'50%',background:C.redLight,
            display:'flex',alignItems:'center',justifyContent:'center',
            border:`1px solid ${C.border}`}}>
            <Bot size={18} color={C.red}/>
          </div>
          <div style={{position:'absolute',top:1,right:1,width:10,height:10,
            borderRadius:'50%',border:'2px solid #fff',background:statusDot}}/>
        </div>
      </div>
    </aside>
  );

  // ── Expanded ────────────────────────────────────────────────────────────────
  return (
    <aside style={{width:320,borderLeft:`1px solid ${C.border}`,background:'#fff',
      display:'flex',flexDirection:'column',flexShrink:0,zIndex:20}}>
      <style>{`
        @keyframes nx-b{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        .nx-d{width:6px;height:6px;border-radius:50%;background:#94a3b8;
          animation:nx-b 1s ease-in-out infinite;display:inline-block;}
        .nx-d:nth-child(2){animation-delay:0.15s}
        .nx-d:nth-child(3){animation-delay:0.30s}
        .nx-qp:hover{border-color:#DB033B!important;background:#fef2f2!important;color:#1e293b!important}
      `}</style>

      {/* Header */}
      <div style={{height:56,display:'flex',alignItems:'center',
        justifyContent:'space-between',padding:'0 14px',
        borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        <div style={{display:'flex',flexDirection:'column',gap:2}}>
          <div style={{display:'flex',alignItems:'center',gap:7}}>
            <div style={{width:8,height:8,borderRadius:'50%',flexShrink:0,
              background:statusDot}}/>
            <span style={{fontSize:13,fontWeight:700,color:C.charcoal}}>
              Nexus — Mars AI Co-Pilot
            </span>
          </div>
          <span style={{fontSize:9,fontWeight:700,letterSpacing:'0.1em',
            textTransform:'uppercase',color:C.muted,paddingLeft:15}}>
            {statusLabel}
          </span>
        </div>
        <button onClick={()=>setCol(true)} style={{padding:6,border:'none',
          background:'transparent',cursor:'pointer',color:C.muted,
          borderRadius:6,display:'flex',alignItems:'center'}}>
          <PanelRightClose size={16}/>
        </button>
      </div>

      {/* No key warning */}
      {apiStatus==='no_key'&&(
        <div style={{margin:'12px 12px 0',padding:'10px 12px',background:'#fffbeb',
          border:'1px solid #fcd34d',borderRadius:8,fontSize:11,
          color:'#92400e',lineHeight:1.7}}>
          <strong>API key required.</strong> Set{' '}
          <code style={{background:'#fef3c7',padding:'1px 5px',borderRadius:3,
            fontFamily:MONO,fontSize:10}}>NEXUS_API_KEY</code>{' '}
          at the top of the file.<br/>
          Get a free key at <strong>aistudio.google.com</strong> → Get API key.
        </div>
      )}

      {/* Messages */}
      <div style={{flex:1,overflowY:'auto',padding:'14px 12px',
        display:'flex',flexDirection:'column',gap:12}}>
        {messages.map((m,i)=>(
          <div key={i} style={{display:'flex',
            flexDirection:m.role==='user'?'row-reverse':'row'}}>
            <div style={{
              padding:'9px 12px',fontSize:12,lineHeight:1.65,maxWidth:'86%',
              background:m.role==='agent'?'#f1f5f9':C.red,
              color:m.role==='agent'?'#334155':'#fff',
              borderRadius:m.role==='agent'?'2px 12px 12px 12px':'12px 2px 12px 12px',
            }} dangerouslySetInnerHTML={{__html:
              m.text.replace(/\n/g,'<br/>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
            }}/>
          </div>
        ))}
        {loading&&(
          <div style={{display:'flex'}}>
            <div style={{padding:'10px 14px',background:'#f1f5f9',
              borderRadius:'2px 12px 12px 12px',
              display:'flex',gap:5,alignItems:'center'}}>
              <div className="nx-d"/>
              <div className="nx-d"/>
              <div className="nx-d"/>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Quick prompts + input */}
      <div style={{padding:'10px 12px 14px',borderTop:`1px solid ${C.border}`,
        flexShrink:0}}>
        <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:10}}>
          {QUICK_PROMPTS.map(q=>(
            <button key={q} className="nx-qp" onClick={()=>setInput(q)}
              disabled={loading||!NEXUS_API_KEY}
              style={{fontSize:10,textAlign:'left',padding:'6px 10px',
                border:`1px solid ${C.border}`,borderRadius:8,background:'#fff',
                color:C.muted,cursor:'pointer',fontFamily:'inherit',fontWeight:500,
                opacity:loading||!NEXUS_API_KEY?0.4:1,transition:'all 0.12s'}}>
              {q}
            </button>
          ))}
        </div>
        <div style={{position:'relative'}}>
          <input value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={handleKey} disabled={loading||!NEXUS_API_KEY}
            placeholder={NEXUS_API_KEY?'Ask Nexus anything…':'Set NEXUS_API_KEY to chat'}
            style={{width:'100%',background:'#f1f5f9',border:'none',borderRadius:20,
              padding:'9px 42px 9px 16px',fontSize:12,color:C.charcoal,
              fontFamily:'inherit',outline:'none',boxSizing:'border-box',
              opacity:!NEXUS_API_KEY?0.55:1}}/>
          <button onClick={handleSend}
            disabled={!input.trim()||loading||!NEXUS_API_KEY}
            style={{position:'absolute',right:5,top:'50%',transform:'translateY(-50%)',
              width:30,height:30,borderRadius:'50%',background:C.red,border:'none',
              cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
              opacity:!input.trim()||loading||!NEXUS_API_KEY?0.35:1,
              transition:'opacity 0.15s'}}>
            <svg width="12" height="12" fill="none" stroke="#fff" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"
                d="M14 5l7 7m0 0l-7 7m7-7H3"/>
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}

// ── DECISION LOG ─────────────────────────────────────────────────────────
function DecisionLog({log}){
  const aligned=log.filter(d=>d.agent_aligned).length;
  const overridesGoneBad=log.filter(d=>!d.agent_aligned&&(d.outcome.includes("chargeback")||d.outcome.includes("rejection"))).length;
  const acceptRate=Math.round(aligned/log.length*100);
  const tsLabel=ts=>{
    const d=new Date(ts);
    return d.toLocaleDateString("en-GB",{day:"2-digit",month:"short"})+" "+d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
  };
  const outcomeColor=o=>o.includes("chargeback")||o.includes("rejection")?C.red:o==="PENDING"||o.includes("TBD")||o.includes("transit")?C.muted:C.green;
  return (
    <div style={{padding:24,maxWidth:1200}}>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:20,fontWeight:700,color:C.charcoal}}>Decision Log</div>
        <div style={{fontSize:12,color:C.muted,marginTop:2}}>Every order decision captured with outcomes — accountability and learning loop</div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        {[
          {label:"Total Decisions",value:log.length.toString(),status:"neutral"},
          {label:"Aligned with AI",value:`${aligned} of ${log.length}`,status:aligned/log.length>=0.7?"ok":"warn"},
          {label:"AI Acceptance Rate",value:`${acceptRate}%`,status:acceptRate>=80?"ok":acceptRate>=60?"warn":"bad"},
          {label:"Overrides Gone Wrong",value:overridesGoneBad.toString(),status:overridesGoneBad===0?"ok":overridesGoneBad<=1?"warn":"bad"},
        ].map(k=><AgentKpi key={k.label} label={k.label} value={k.value} status={k.status}/>)}
      </div>

      {/* Override outcome spotlight */}
      {log.filter(d=>!d.agent_aligned).length>0&&(
        <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:16,marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:700,color:C.charcoal,marginBottom:12}}>Override Outcomes — Where Human and AI Disagreed</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {log.filter(d=>!d.agent_aligned).map(d=>(
              <div key={d.id} style={{display:"grid",gridTemplateColumns:"90px 90px 1fr 1fr 100px 90px",
                gap:12,padding:"10px 14px",background:C.off,borderRadius:6,
                borderLeft:`4px solid ${d.outcome.includes("chargeback")||d.outcome.includes("rejection")?C.red:C.orange}`,
                fontSize:11,alignItems:"center"}}>
                <span style={{color:C.muted,fontSize:10}}>{tsLabel(d.ts)}</span>
                <span style={{fontWeight:700,color:C.charcoal}}>{d.order}</span>
                <div>
                  <div style={{fontWeight:600,color:C.charcoal}}>{d.customer} — {d.sku}</div>
                  <div style={{color:C.muted,marginTop:2}}>Agent said: {d.agent_rec}</div>
                </div>
                <div>
                  <div style={{fontWeight:600,color:C.red}}>Override: "{d.override}"</div>
                </div>
                <div style={{color:outcomeColor(d.outcome),fontWeight:600,fontSize:11}}>{d.outcome}</div>
                <div style={{fontWeight:700,color:d.financial.startsWith("-")?C.red:C.green}}>{d.financial}</div>
              </div>
            ))}
          </div>
          {overridesGoneBad>0&&(
            <div style={{marginTop:10,padding:"8px 12px",background:"rgba(219,3,59,0.06)",borderRadius:6,fontSize:12,color:C.red}}>
              {overridesGoneBad} override{overridesGoneBad>1?"s":""} resulted in chargebacks or DC rejections. The AI recommendation would have avoided these outcomes.
            </div>
          )}
        </div>
      )}

      {/* Full log table */}
      <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
        <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${C.border}`,
          display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>Complete Decision History</div>
            <div style={{fontSize:12,color:C.muted,marginTop:3}}>Newest first — including current session</div>
          </div>
          <span style={{fontSize:11,color:C.muted}}>{log.length} entries</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"86px 76px 86px 1fr 90px 1fr 1fr 72px 70px",
          background:C.off,padding:"5px 12px",borderBottom:`1px solid ${C.border}`}}>
          {["Time","Order","Customer","Agent Rec.","Decision","Override Reason","Outcome","Financial","AI Aligned"].map(h=>(
            <div key={h} style={{fontSize:9,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</div>
          ))}
        </div>
        {log.map((d,i)=>{
          const approved=d.user_decision==="approved";
          const isCurrent=d.id.startsWith("dec-");
          return (
            <div key={d.id} style={{display:"grid",gridTemplateColumns:"86px 76px 86px 1fr 90px 1fr 1fr 72px 70px",
              padding:"8px 12px",borderBottom:`1px solid ${C.border}`,
              background:isCurrent?"rgba(30,171,218,0.04)":i%2===0?"#fff":C.off,
              fontSize:11,alignItems:"center"}}>
              <span style={{fontSize:10,color:C.muted}}>{tsLabel(d.ts)}</span>
              <span style={{fontWeight:600,color:C.charcoal,fontSize:10}}>{d.order}</span>
              <span style={{color:C.charcoal,fontWeight:600}}>{d.customer}</span>
              <span style={{color:C.charcoal,fontSize:10}}>{d.agent_rec}</span>
              <Pill label={approved?"Approved":"Rejected"} color={approved?C.green:C.red} size={9}/>
              <span style={{color:C.muted,fontSize:10}}>{d.override||"—"}</span>
              <span style={{color:outcomeColor(d.outcome),fontSize:11}}>{d.outcome}</span>
              <span style={{fontWeight:700,color:d.financial.startsWith("-")?C.red:d.financial==="$0"?C.green:C.muted}}>{d.financial}</span>
              <div style={{display:"flex",alignItems:"center",gap:3}}>
                <span style={{color:d.agent_aligned?C.green:C.red,fontWeight:700}}>{d.agent_aligned?"✓":"✗"}</span>
                <span style={{color:d.agent_aligned?C.green:C.red,fontSize:10}}>{d.agent_aligned?"Yes":"No"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MANAGER DASHBOARD ─────────────────────────────────────────────────────
function ManagerDashboard({setScreen}){
  const statS=s=>({ok:{bg:"#edf7ee",v:C.green},warn:{bg:"#fff8e6",v:C.orange},bad:{bg:"#fde8ec",v:C.red}}[s]);
  const cfrS=SARAH_BRIEFING.cfr_week>=SARAH_BRIEFING.cfr_target?"ok":SARAH_BRIEFING.cfr_week>=96?"warn":"bad";
  const readinessColor={"READY":C.green,"MONITOR":C.orange,"AT RISK":C.red};
  return (
    <div style={{padding:24,maxWidth:1100}}>
      <div style={{marginBottom:20,display:"flex",alignItems:"flex-end",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:C.charcoal}}>Good morning, Sarah.</div>
          <div style={{fontSize:13,color:C.muted,marginTop:3}}>
            Customer Service Manager · Mars Petcare · {new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
          </div>
        </div>
        <div style={{fontSize:12,color:C.muted,textAlign:"right"}}>
          <div style={{fontWeight:600,color:C.charcoal}}>4 orders need your decision</div>
          <div>AI evaluations ready</div>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        {[
          {label:"Orders to Decide",value:"4",sub:"Awaiting your approval",status:"warn",icon:"⚡",screen:"triage"},
          {label:"Case Fill Rate",value:`${SARAH_BRIEFING.cfr_week}%`,sub:`Target ${SARAH_BRIEFING.cfr_target}% · ${SARAH_BRIEFING.cfr_delta} pp`,status:cfrS,icon:"◎",screen:"rootcause"},
          {label:"Safety Stock Warnings",value:`${SARAH_BRIEFING.ss_at_risk}`,sub:"SKUs below recommended",status:"warn",icon:"△",screen:"safetystock"},
          {label:"Promos Unready",value:`${SARAH_BRIEFING.promos_unready}`,sub:"SS not set for upcoming events",status:"bad",icon:"◈",screen:"safetystock"},
        ].map(t=>{
          const s=statS(t.status);
          return (
            <div key={t.label} onClick={()=>setScreen(t.screen)}
              style={{background:s.bg,borderRadius:10,padding:"16px 18px",border:`1px solid ${C.border}`,
                cursor:"pointer",borderBottom:`3px solid ${s.v}`}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <span style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>{t.label}</span>
                <span style={{fontSize:16,color:s.v}}>{t.icon}</span>
              </div>
              <div style={{fontSize:26,fontWeight:700,color:s.v,lineHeight:1,marginBottom:4}}>{t.value}</div>
              <div style={{fontSize:11,color:C.muted}}>{t.sub}</div>
            </div>
          );
        })}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
            <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>Orders Requiring Your Decision</div>
            <button onClick={()=>setScreen("triage")} style={{fontSize:11,color:C.red,border:`1px solid ${C.red}`,
              borderRadius:4,padding:"3px 10px",background:"transparent",cursor:"pointer",fontFamily:"inherit"}}>
              Open Triage
            </button>
          </div>
          {SARAH_BRIEFING.orders_to_decide.map(o=>{
            const fc=flagColor(o.flag_type);
            const recAction={above_forecast:"PARTIAL_FULFILL",promo:"ACCEPT",hard_block:"DEFER",buffer_build:"REJECT"}[o.flag_type];
            return (
              <div key={o.id} onClick={()=>setScreen("triage")}
                style={{padding:"10px 12px",background:C.off,borderRadius:6,marginBottom:8,
                  borderLeft:`4px solid ${fc}`,cursor:"pointer"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:13,fontWeight:700,color:C.charcoal}}>{o.customer}</span>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <span style={{fontSize:10,color:fc,fontWeight:700}}>{o.flag}</span>
                    <Pill label={recAction} color={actColor(recAction)} size={9}/>
                  </div>
                </div>
                <div style={{fontSize:11,color:C.muted}}>{o.desc} · {o.qty.toLocaleString()} cs · MABD {o.mabd}</div>
              </div>
            );
          })}
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
            <div style={{fontSize:14,fontWeight:700,color:C.charcoal,marginBottom:14}}>Critical Alerts Requiring Action</div>
            {SARAH_BRIEFING.top_alerts.map((a,i)=>(
              <div key={i} onClick={()=>setScreen(a.screen)}
                style={{padding:"9px 12px",background:C.off,borderRadius:6,marginBottom:8,
                  borderLeft:`4px solid ${sevColor(a.sev)}`,cursor:"pointer"}}>
                <div style={{display:"flex",gap:6,alignItems:"flex-start",marginBottom:3}}>
                  <Pill label={a.sev} color={sevColor(a.sev)} size={9}/>
                  <span style={{fontSize:12,fontWeight:600,color:C.charcoal,lineHeight:1.35}}>{a.title}</span>
                </div>
                <div style={{fontSize:11,color:C.blue}}>{a.action} →</div>
              </div>
            ))}
          </div>
          <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>Promo Readiness</div>
              <button onClick={()=>setScreen("safetystock")} style={{fontSize:11,color:C.red,border:`1px solid ${C.red}`,
                borderRadius:4,padding:"3px 10px",background:"transparent",cursor:"pointer",fontFamily:"inherit"}}>
                Adjust SS
              </button>
            </div>
            {PROMO_SS_IMPACT.slice(0,3).map((p,i)=>{
              const rc=readinessColor[p.readiness]||C.muted;
              return (
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                  padding:"8px 0",borderBottom:i<2?`1px solid ${C.border}`:"none",gap:8}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:600,color:C.charcoal}}>{p.event}</div>
                    <div style={{fontSize:11,color:C.muted}}>{p.sku} · {p.dates}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <Pill label={p.readiness} color={rc} size={9}/>
                    {p.readiness!=="READY"&&<div style={{fontSize:10,color:C.muted,marginTop:3}}>Need +{p.uplift.toLocaleString()} cs</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,padding:20}}>
        <div style={{display:"flex",alignItems:"center",gap:20,marginBottom:14}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:C.charcoal}}>Case Fill Rate — 12-Week Trend</div>
            <div style={{fontSize:12,color:C.muted,marginTop:3}}>Target: {SARAH_BRIEFING.cfr_target}% · Current: {SARAH_BRIEFING.cfr_week}%</div>
          </div>
          <button onClick={()=>setScreen("rootcause")} style={{marginLeft:"auto",fontSize:11,color:C.red,
            border:`1px solid ${C.red}`,borderRadius:4,padding:"3px 10px",background:"transparent",cursor:"pointer",fontFamily:"inherit"}}>
            View Root Causes
          </button>
        </div>
        <ResponsiveContainer width="100%" height={100}>
          <BarChart data={CFR_TREND} margin={{top:0,bottom:0,left:0,right:0}}>
            <XAxis dataKey="w" tick={{fontSize:9,fill:C.muted}} axisLine={false} tickLine={false}/>
            <YAxis domain={[92,100]} tick={{fontSize:9,fill:C.muted}} axisLine={false} tickLine={false} width={28}/>
            <Tooltip formatter={(v)=>[`${v}%`,"CFR"]} contentStyle={{fontSize:11}}/>
            <Bar dataKey="cfr" radius={[3,3,0,0]}>
              {CFR_TREND.map((e,i)=>(
                <rect key={i} fill={e.cfr>=SARAH_BRIEFING.cfr_target?C.green:e.cfr>=96?C.orange:C.red}/>
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── INVENTORY SNAPSHOT ─────────────────────────────────────────────────────
function InventorySnapshot({order}){
  const dcData=SKU_DC_MATRIX[order.sku]||[];
  const networkTotal=dcData.reduce((s,x)=>s+x.cs,0);
  const orderQty=order.qty;
  const coveragePct=Math.min(100,Math.round(networkTotal/orderQty*100));
  const coverageColor=coveragePct>=100?C.green:coveragePct>=70?C.orange:C.red;
  const statColor=s=>({OK:C.green,BELOW_SS:C.orange,STOCKOUT:C.red}[s]||C.muted);
  return (
    <div style={{background:"#fff",border:`2px solid ${coverageColor}`,borderRadius:8,padding:16}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:C.charcoal}}>Real-Time Inventory Snapshot — {order.sku}</div>
          <div style={{fontSize:12,color:C.muted,marginTop:3}}>Network availability vs. order of {orderQty.toLocaleString()} cs</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:3}}>Network Coverage</div>
          <div style={{fontSize:22,fontWeight:700,color:coverageColor}}>{coveragePct}%</div>
          <div style={{fontSize:10,color:C.muted}}>{networkTotal.toLocaleString()} cs network-wide</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"80px 90px 50px 80px 1fr 80px",gap:0,
        background:C.off,borderRadius:4,padding:"5px 10px",marginBottom:6}}>
        {["DC","Available","DoS","Status","Coverage vs Order","After Fill"].map(h=>(
          <div key={h} style={{fontSize:9,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</div>
        ))}
      </div>
      {dcData.map((r,i)=>{
        const pct=Math.min(100,Math.round(r.cs/orderQty*100));
        const afterFill=Math.max(0,r.cs-orderQty);
        const isPrimary=r.dc===order.ship_to;
        return (
          <div key={i} style={{display:"grid",gridTemplateColumns:"80px 90px 50px 80px 1fr 80px",
            padding:"7px 10px",borderBottom:`1px solid ${C.border}`,alignItems:"center",
            background:isPrimary?"rgba(30,171,218,0.05)":"transparent"}}>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:isPrimary?C.blue:C.charcoal}}>{r.dc}</div>
              {isPrimary&&<div style={{fontSize:9,color:C.blue}}>Primary DC</div>}
            </div>
            <span style={{fontSize:12,fontWeight:600,color:C.charcoal}}>{r.cs.toLocaleString()} cs</span>
            <span style={{fontSize:11,color:r.dos<7?C.red:r.dos<14?C.orange:C.green,fontWeight:600}}>{r.dos}d</span>
            <span style={{fontSize:10,fontWeight:700,color:statColor(r.status)}}>{r.status.replace("_"," ")}</span>
            <div style={{paddingRight:12}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{flex:1,height:5,background:C.border,borderRadius:2,overflow:"hidden"}}>
                  <div style={{width:`${pct}%`,height:"100%",
                    background:pct>=100?C.green:pct>=70?C.orange:C.red,borderRadius:2}}/>
                </div>
                <span style={{fontSize:11,fontWeight:700,
                  color:pct>=100?C.green:pct>=70?C.orange:C.red,minWidth:32,textAlign:"right"}}>{pct}%</span>
              </div>
            </div>
            <span style={{fontSize:11,fontWeight:600,textAlign:"right",
              color:afterFill<r.ss?C.orange:C.green}}>
              {afterFill>0?`${afterFill.toLocaleString()} cs`:"Depleted"}
            </span>
          </div>
        );
      })}
      {/* ATP summary — committed vs available */}
      {(()=>{
        const syn=SYNTHESIS[order.id];
        const atp=syn?.signals?.supply_planning?.full_signal?.fg_position;
        if(!atp||atp.committed_cs===undefined)return null;
        const atpColor=atp.available_cs===0?C.red:atp.available_cs<atp.inventory_cs*0.2?C.orange:C.green;
        const atpCoversOrder=atp.available_cs>=orderQty;
        return (
          <div style={{margin:"10px 0 0",padding:"10px 14px",background:"#f1f5f9",borderRadius:6,
            borderLeft:`4px solid ${atpCoversOrder?C.green:C.red}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.charcoal,marginBottom:8,
              textTransform:"uppercase",letterSpacing:"0.07em"}}>
              Committed vs Available to Promise — Primary DC ({order.ship_to})
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
              {[
                {label:"On Hand (Total)",value:`${atp.inventory_cs.toLocaleString()} cs`,color:C.charcoal},
                {label:"Committed",value:`${atp.committed_cs.toLocaleString()} cs`,color:C.orange},
                {label:"Avail. to Promise",value:`${atp.available_cs.toLocaleString()} cs`,color:atpColor},
                {label:"Order Requires",value:`${orderQty.toLocaleString()} cs`,
                  color:atpCoversOrder?C.green:C.red},
              ].map(k=>(
                <div key={k.label} style={{textAlign:"center"}}>
                  <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",
                    letterSpacing:"0.05em",marginBottom:3}}>{k.label}</div>
                  <div style={{fontSize:14,fontWeight:700,color:k.color,fontFamily:MONO}}>{k.value}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:8,fontSize:11,fontWeight:600,
              color:atpCoversOrder?C.green:C.red}}>
              {atpCoversOrder
                ?`✓ ATP covers full order — ${(atp.available_cs-orderQty).toLocaleString()} cs surplus after commitment`
                :`⚠ ATP shortfall of ${(orderQty-atp.available_cs).toLocaleString()} cs — partial fulfillment or split sourcing required`}
            </div>
          </div>
        );
      })()}
      <div style={{marginTop:10,padding:"8px 10px",background:C.off,borderRadius:6,
        display:"flex",gap:16,fontSize:11,flexWrap:"wrap"}}>
        <span style={{color:C.muted}}>Max fulfillable: <strong style={{color:coverageColor}}>
          {Math.min(networkTotal,orderQty).toLocaleString()} cs
        </strong></span>
        <span style={{color:C.muted}}>|</span>
        <span style={{color:C.muted}}>Primary DC ({order.ship_to}): <strong style={{color:C.charcoal}}>
          {(dcData.find(x=>x.dc===order.ship_to)||{cs:0}).cs.toLocaleString()} cs
        </strong></span>
        {networkTotal>=orderQty&&(
          <span style={{color:C.green,fontWeight:600}}>Network can cover full order via split sourcing</span>
        )}
      </div>
    </div>
  );
}

// ── APP ───────────────────────────────────────────────────────────────────
export default function App(){
  const [screen,setScreen]=useState("watchtower");
  const [decisionLog,setDecisionLog]=useState(INITIAL_DECISION_LOG);
  const addDecision=e=>setDecisionLog(prev=>[e,...prev]);
  useEffect(()=>{
    const lk=document.createElement("link");
    lk.href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap";
    lk.rel="stylesheet";document.head.appendChild(lk);
    return()=>{try{document.head.removeChild(lk);}catch(e){}};
  },[]);
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden",fontFamily:"'Inter',system-ui,sans-serif",fontSize:13,background:C.off}}>
      <TopBar/>
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        <Sidebar screen={screen} setScreen={setScreen}/>
        <div style={{flex:1,overflow:"auto",background:C.off}}>
          {screen==="manager"&&<ManagerDashboard setScreen={setScreen}/>}
          {screen==="watchtower"&&<Watchtower/>}
          {screen==="triage"&&<OrderTriage onDecision={addDecision}/>}
          {screen==="simulator"&&<FulfillmentSimulator/>}
          {screen==="rootcause"&&<RootCauseHub/>}
          {screen==="safetystock"&&<SafetyStockOptimizer/>}
          {screen==="decisions"&&<DecisionLog log={decisionLog}/>}
          {screen==="agent-supply"&&<SupplyPlanningPage/>}
          {screen==="agent-demand"&&<DemandPlanningPage/>}
          {screen==="agent-transport"&&<TransportationPage/>}
          {screen==="agent-retail"&&<RetailIntelligencePage/>}
          {screen==="datahealth"&&<DataHealthPage/>}
          {screen==="dictionary"&&<DataDictionaryPage/>}
        </div>
        <NexusCoPilot/>
      </div>
    </div>
  );
}
