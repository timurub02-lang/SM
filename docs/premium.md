# Premium drafts

Finance has Calculation, Orders and Employees views sharing a calculation period. CDEK eligibility requires exactly one positive remittance; the period uses its paymentDate. Commission uses collectedCents (customer payment), not amountCents (net remittance). Moscow courier/post use the recorded receipt amount and Moscow receipt date.

Nominal paydays are the 15th and next month's 1st. Cutoff leaves four full working days strictly between cutoff and nominal payday. The actual payday moves to the preceding working day without changing that cutoff. Example: October period 2 cutoff October 26, nominal November 1, actual October 30; next period begins October 27.

Calendar snapshots: https://xmlcalendar.ru/data/ru/2025/calendar.json, https://xmlcalendar.ru/data/ru/2026/calendar.json, https://xmlcalendar.ru/data/ru/2027/calendar.json. Asterisk marks a working shortened day, including transferred working Saturdays. Government 2027 transfer decision: http://government.ru/docs/59913/. The catalog supports periods whose full boundaries and paydays are covered; unsupported dates are shown separately, never guessed. Update snapshots before adding later years.

Draft adjustments are saved in settings by period and employee with revision checks. Operator rates update employees.bonus in the same transaction; salary part, vacation, official part, debt/advance, penalty, extra and SZ stay in the selected period. Operator salary defaults to zero until the period amount is entered; the general profile salary is not silently charged in full twice per month. Official part can only be changed by admin. Department heads can edit only their own operators and their own leader adjustments; operators are read-only.

Positive totals round to nearest RUB 50, negative totals remain exact and never reduce other people's payouts. UDL second-half preview requires an explicit first-half percentage bonus. The period-specific bonus from the old program is not inferred from an incomplete historical order set.

These are editable draft previews, not payment confirmations. Prior-paid reconciliation, payroll Excel import, signatures, locking/closing, archive snapshots and automatic debt carry are not implemented by this change. No payroll is sent to cash accounts. The admin must reconcile imported LV orders before any actual payout workflow is enabled.
