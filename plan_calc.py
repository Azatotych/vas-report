# -*- coding: utf-8 -*-
"""Расчёт распределения годового «Личного плана работы» по месяцам.

Чистые функции без БД. Правила (из reference/plan.md скилла mesyachny-otchet):
1. Месяцы заполняются «спереди» (front-fill): январь до фонда, затем февраль…;
   незакрытый остаток плана оседает в хвосте года (декабрь может быть полупустым).
2. Оперативки ≤ 30% нормы месяца; «вечные» оперативки — фиксированная
   ежемесячная нагрузка в каждом рабочем месяце.
3. Часы НИР нарастают к месяцу сдачи этапа (deadline_month), после сдачи — база.
4. Статьи (ред.-изд. работа) — остаток месяца, досыпается до нормы.
"""

VAC_HOURS = 8      # часов в дне отпуска
OP_CAP = 0.30      # оперативки <= 30% нормы месяца
PHYS = 5           # физподготовка, ч/мес (информационно, §8)

ALL_MONTHS = list(range(1, 13))


def split_hours(total, n):
    """Разбить total на n целых частей, сумма сохраняется (из generate.py)."""
    if n <= 0:
        return []
    base = total // n
    r = total - base * n
    return [base + (1 if k < r else 0) for k in range(n)]


def effective_funds(months):
    """Фонд месяца за вычетом отпуска: eff = max(0, fund - vacation_days*8).

    months: [{month, fund_hours, vacation_days}, ...]
    """
    fund = {r["month"]: r.get("fund_hours", 0) or 0 for r in months}
    vac = {r["month"]: r.get("vacation_days", 0) or 0 for r in months}
    return {m: max(0, fund.get(m, 0) - vac.get(m, 0) * VAC_HOURS) for m in ALL_MONTHS}


def front_fill_norms(eff, plan_total):
    """Нормы месяцев front-fill: с января до фонда, остаток плана — дальше.

    Возвращает (norms, overflow): overflow > 0 — план не влез в фонд года.
    """
    norms, remaining = {}, plan_total
    for m in ALL_MONTHS:
        take = min(eff.get(m, 0), remaining)
        norms[m] = take
        remaining -= take
    return norms, remaining


def _alloc_weighted(total, weights, caps=None):
    """Целочисленно распределить total по весам с потолками. -> (alloc, нераспределено)."""
    alloc = {m: 0 for m in weights}
    remaining = int(total)
    for _ in range(24):
        if remaining <= 0:
            break
        active = {m: w for m, w in weights.items()
                  if w > 0 and (caps is None or alloc[m] < caps.get(m, 0))}
        if not active:
            break
        tw = float(sum(active.values()))
        shares = {m: remaining * w / tw for m, w in active.items()}
        base = {m: int(shares[m]) for m in active}
        rem = remaining - sum(base.values())
        for m in sorted(active, key=lambda k: shares[k] - base[k], reverse=True)[:rem]:
            base[m] += 1
        moved = 0
        for m, add in base.items():
            if caps is not None:
                add = min(add, caps[m] - alloc[m])
            alloc[m] += add
            moved += add
        remaining -= moved
        if moved == 0:
            break
    return alloc, remaining


def _nir_weights(deadline, norms):
    """Веса НИР: линейный рост 1..k к месяцу сдачи, после сдачи — база 1.
    Без срока — пропорционально норме месяца (ровное распределение)."""
    work = [m for m in ALL_MONTHS if norms.get(m, 0) > 0]
    w = {m: 0 for m in ALL_MONTHS}
    if not work:
        return w
    if deadline:
        pre = [m for m in work if m <= deadline]
        for i, m in enumerate(pre, 1):
            w[m] = i
        for m in work:
            if m > deadline:
                w[m] = 1
        if not pre:                      # срок раньше первого рабочего месяца
            for m in work:
                w[m] = 1
    else:
        for m in work:
            w[m] = norms[m]
    return w


def distribute(plan, nirs, months, eternal_total):
    """Авто-распределение плана по месяцам.

    plan: {hours_articles, hours_operatives, hours_naryady, hours_guk}
    nirs: [{id, name, deadline_month, hours_year, sort_order}]
    months: [{month, fund_hours, vacation_days}]
    eternal_total: суммарные часы «вечных» оперативок в месяц

    -> {norms, nir_months: {nir_id: {m: h}}, cells: {m: {articles, operatives,
        naryady, guk}}, warnings: [...]}
    """
    warnings = []
    eff = effective_funds(months)
    nir_total = sum(n.get("hours_year", 0) or 0 for n in nirs)
    plan_total = (nir_total + plan.get("hours_articles", 0) + plan.get("hours_operatives", 0)
                  + plan.get("hours_naryady", 0) + plan.get("hours_guk", 0))
    norms, overflow = front_fill_norms(eff, plan_total)
    if overflow > 0:
        warnings.append(dict(month=None, code="PLAN_GT_FUND",
                             message="План (%d ч) превышает фонд с учётом отпуска на %d ч"
                                     % (plan_total, overflow)))
    work = [m for m in ALL_MONTHS if norms[m] > 0]

    # остаток месяца после резерва вечных оперативок
    room = {m: max(0, norms[m] - (eternal_total if m in work else 0)) for m in ALL_MONTHS}

    # 1) НИРы — первыми (связаны сроками)
    nir_months = {}
    for n in sorted(nirs, key=lambda x: x.get("sort_order", 0) or 0):
        w = _nir_weights(n.get("deadline_month"), norms)
        a, und = _alloc_weighted(n.get("hours_year", 0) or 0, w, caps=room)
        if und > 0:
            warnings.append(dict(month=None, code="NIR_YEAR_MISMATCH",
                                 message="НИР «%s»: %d ч не поместились в план года"
                                         % (n.get("name", ""), und)))
        nir_months[n["id"]] = a
        for m in a:
            room[m] -= a[m]

    # 2) наряды и ГУК — пропорционально норме
    norm_w = {m: norms[m] for m in ALL_MONTHS}
    naryad, und = _alloc_weighted(plan.get("hours_naryady", 0), norm_w, caps=room)
    if und > 0:
        warnings.append(dict(month=None, code="CAT_YEAR_MISMATCH",
                             message="Наряды: %d ч не поместились" % und))
    for m in naryad:
        room[m] -= naryad[m]
    guk, und = _alloc_weighted(plan.get("hours_guk", 0), norm_w, caps=room)
    if und > 0:
        warnings.append(dict(month=None, code="CAT_YEAR_MISMATCH",
                             message="Другие виды научной работы: %d ч не поместились" % und))
    for m in guk:
        room[m] -= guk[m]

    # 3) оперативки: вечные в каждом рабочем месяце + гибкие до потолка 30%
    op = {m: (eternal_total if m in work else 0) for m in ALL_MONTHS}
    for m in work:
        if eternal_total > round(OP_CAP * norms[m]):
            warnings.append(dict(month=m, code="OP_CAP",
                                 message="Вечные оперативки (%d ч) выше лимита 30%% нормы (%d ч)"
                                         % (eternal_total, round(OP_CAP * norms[m]))))
    flex_target = plan.get("hours_operatives", 0) - eternal_total * len(work)
    if flex_target < 0:
        warnings.append(dict(month=None, code="CAT_YEAR_MISMATCH",
                             message="Годовые оперативки (%d ч) меньше суммы вечных за год (%d ч)"
                                     % (plan.get("hours_operatives", 0), eternal_total * len(work))))
    caps_flex = {m: max(0, min(round(OP_CAP * norms[m]) - op[m], room[m])) for m in work}
    fx, und = _alloc_weighted(max(0, flex_target), {m: norms[m] for m in work}, caps=caps_flex)
    if und > 0:
        warnings.append(dict(month=None, code="OP_CAP",
                             message="Оперативки: %d ч не разместились из-за лимита 30%%" % und))
    for m in fx:
        op[m] += fx[m]
        room[m] -= fx[m]

    # 4) статьи = остаток месяца (правило 1: добивают норму)
    art = {m: (room[m] if m in work else 0) for m in ALL_MONTHS}

    cells = {m: dict(articles=art[m], operatives=op[m],
                     naryady=naryad.get(m, 0), guk=guk.get(m, 0)) for m in ALL_MONTHS}
    return dict(norms=norms, nir_months=nir_months, cells=cells, warnings=warnings)


def validate(plan, nirs, months, nir_months, eternal_total):
    """Проверка сохранённого (в т.ч. вручную правленного) распределения.

    months: [{month, fund_hours, vacation_days, hours_articles, hours_operatives,
              hours_naryady, hours_guk}]
    nir_months: {nir_id: {month: hours}}
    -> [{month, code, message}]
    """
    w = []
    eff = effective_funds(months)
    by_m = {r["month"]: r for r in months}
    for m in ALL_MONTHS:
        r = by_m.get(m)
        if not r:
            continue
        nir_sum = sum(nm.get(m, 0) or 0 for nm in nir_months.values())
        s = (nir_sum + (r.get("hours_articles") or 0) + (r.get("hours_operatives") or 0)
             + (r.get("hours_naryady") or 0) + (r.get("hours_guk") or 0))
        if s > eff[m]:
            w.append(dict(month=m, code="SUM_MISMATCH",
                          message="Загрузка %d ч превышает фонд месяца %d ч" % (s, eff[m])))
        opm = r.get("hours_operatives") or 0
        if s > 0 and opm > round(OP_CAP * s):
            w.append(dict(month=m, code="OP_CAP",
                          message="Оперативки %d ч > 30%% от загрузки месяца (%d ч)"
                                  % (opm, round(OP_CAP * s))))
        if s > 0 and 0 < opm < eternal_total:
            w.append(dict(month=m, code="OP_BELOW_ETERNAL",
                          message="Оперативки %d ч меньше суммы вечных (%d ч/мес)"
                                  % (opm, eternal_total)))
    for n in nirs:
        got = sum((nir_months.get(n["id"]) or {}).values())
        if got != (n.get("hours_year", 0) or 0):
            w.append(dict(month=None, code="NIR_YEAR_MISMATCH",
                          message="НИР «%s»: по месяцам %d ч, в плане года %d ч"
                                  % (n.get("name", ""), got, n.get("hours_year", 0) or 0)))
    for key, label in [("hours_articles", "Статьи"), ("hours_operatives", "Оперативки"),
                       ("hours_naryady", "Наряды"), ("hours_guk", "Другие виды научной работы")]:
        got = sum((r.get(key) or 0) for r in months)
        want = plan.get(key, 0) or 0
        if got != want:
            w.append(dict(month=None, code="CAT_YEAR_MISMATCH",
                          message="%s: по месяцам %d ч, в плане года %d ч" % (label, got, want)))
    return w


def vacation_summary(plan, nirs, months):
    """Баннер отпуска: total = (Σ фонда - план)/8, used = Σ vacation_days."""
    fund_total = sum((r.get("fund_hours") or 0) for r in months)
    nir_total = sum(n.get("hours_year", 0) or 0 for n in nirs)
    plan_total = (nir_total + plan.get("hours_articles", 0) + plan.get("hours_operatives", 0)
                  + plan.get("hours_naryady", 0) + plan.get("hours_guk", 0))
    free_hours = fund_total - plan_total
    total_days = max(0, free_hours // VAC_HOURS)
    used_days = sum((r.get("vacation_days") or 0) for r in months)
    return dict(fund_total=fund_total, plan_total=plan_total, free_hours=free_hours,
                vacation_days_total=total_days, vacation_days_used=used_days,
                vacation_days_left=total_days - used_days)
