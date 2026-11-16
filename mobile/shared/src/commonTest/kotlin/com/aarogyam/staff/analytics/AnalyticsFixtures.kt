package com.aarogyam.staff.analytics

internal fun analyticsBucket(
    start: String,
    new: Int,
    returning: Int,
    income: Long,
    expenses: Long,
    booked: Int,
    open: Int,
    appts: Int,
    chair2Booked: Int = 0,
) = """{"start":"$start","first_day":"$start","last_day":"$start","patients":{"new":$new,"returning":$returning},
       "income_paise":$income,"expenses_paise":$expenses,"payments":3,"stock_purchases_paise":0,
       "expenses":[{"category":"lab","amount_paise":$expenses},{"category":"rent","amount_paise":0}],
       "chair_utilization":[
         {"room_id":"r1","booked_minutes":$booked,"open_minutes":$open,"appointments":$appts,"utilization_bps":0},
         {"room_id":"r2","booked_minutes":$chair2Booked,"open_minutes":$open,"appointments":0,"utilization_bps":0}]}"""

internal fun analyticsBody(
    money: Boolean,
    vararg buckets: String,
    heat: String = """[{"weekday":2,"hour":11,"booked_minutes":90,"appointments":3}]""",
) = """{"from":"2026-08-01","to":"2026-10-09","bucket":"week","open_minutes_per_day":540,"money_visible":$money,
       "chairs":[{"id":"r1","name":"Chair 1","uses_clinic_hours":true},{"id":"r2","name":"Chair 2","uses_clinic_hours":true}],
       "buckets":[${buckets.joinToString(",")}],
       "occupancy":{"by_chair_hour":[],"by_weekday_hour":$heat},
       "procedures_by_category":[{"key":"filling","count":2,"amount_paise":${if (money) "5000" else "null"}},
         {"key":"root_canal","count":7,"amount_paise":${if (money) "70000" else "null"}}],
       "chair_time":{"treatment":300,"consult":100,"admin":100},
       "visit_sources":{"booked":30,"walk_in":10},
       "busy_hours":[{"weekday":1,"hour":10,"visits":4}],"lab_turnaround":{"orders_received":4,"average_days":2.5},
       "patients":{"age_bands":[{"key":"18_34","count":9}],"sex":[{"key":"female","count":6},{"key":"male","count":8}],
       "visit_kinds":[{"key":"new","count":3},{"key":"procedure","count":5}],"referral_sources":[]}}"""
