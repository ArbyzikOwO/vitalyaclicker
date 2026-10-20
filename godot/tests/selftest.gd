extends SceneTree
## Самопроверка Godot-порта: экономика, казино, кредиты, сохранение и сборка UI.
## Запуск: godot --headless --path godot --script res://tests/selftest.gd

var fails := 0
var passes := 0
var _ui: Node = null
var _frame := 0
var _tabs := ["up", "skins", "casino", "crypto", "more", "click"]
var _ui_fail := 0

func ok(name: String, cond: bool, detail := "") -> void:
	if cond:
		passes += 1
		print("  ok   ", name)
	else:
		fails += 1
		print("  FAIL ", name, ("  — " + detail) if detail != "" else "")

func close(a: float, b: float, eps := 0.01) -> bool:
	return absf(a - b) <= eps * maxf(1.0, absf(b))

func _initialize() -> void:
	print("── ЛОГИКА ──")
	test_fresh()
	test_click_and_upgrades()
	test_spend()
	test_skins_and_craft()
	test_casino()
	test_loans()
	test_save_load()
	test_offline()
	test_fmt()

	print("── UI ──")
	_ui = load("res://scenes/main.tscn").instantiate()
	root.add_child(_ui)
	process_frame.connect(_on_frame)

func _on_frame() -> void:
	_frame += 1
	if _frame == 1:
		_ui.game.new_game()
		_ui.game.save_path = "user://ui_test_save.json"
		_ui.game.add_money(1e12, "auto")
		_ui.game.s["propusk"] = true
		_ui.game.s["mining"]["maxims"] = 3
		_ui.game.s["loans"].append({ "amount": 1000.0, "hours": 5, "start": Time.get_unix_time_from_system(), "paid": false })
		_ui._on_click()
		ok("UI: клик начисляет", _ui.game.total_money() > 1e12)
		return
	var idx := _frame - 2
	if idx < _tabs.size():
		var tab: String = _tabs[idx]
		_ui._show_tab(tab)
		var n: int = _ui._content.get_child_count()
		if n <= 0:
			_ui_fail += 1
		print("  %s   вкладка %-7s детей: %d" % ["ok  " if n > 0 else "FAIL", tab, n])
		return
	if idx == _tabs.size():
		# казино: крутим через UI-обработчик
		_ui._show_tab("casino")
		_ui._bet_input.text = "100"
		var before: float = _ui.game.total_money()
		_ui._on_spin()
		var after: float = _ui.game.total_money()
		ok("UI: прокрутка меняет баланс", after != before, "%.2f → %.2f" % [before, after])
		ok("UI: результат показан", _ui._result_lbl.text != "")
		# кредит: раннее погашение через UI
		_ui._show_tab("more")
		var owed: float = _ui.game.loan_owed(_ui.game.s["loans"][0])
		ok("UI: кредит виден", owed >= 1000.0)
		if _ui.game.s["loans"].size() > 0:
			_ui._on_loan_pay(0)
			ok("UI: кредит погашен", _ui.game.s["loans"].is_empty())
		return
	print("")
	if _ui_fail > 0:
		fails += _ui_fail
	print("ИТОГ: %d ok, %d fails" % [passes, fails])
	DirAccess.remove_absolute(ProjectSettings.globalize_path("user://ui_test_save.json"))
	DirAccess.remove_absolute(ProjectSettings.globalize_path("user://selftest_save.json"))
	quit(0 if fails == 0 else 1)

# ── тесты ─────────────────────────────────────────────────────────────────────
func test_fresh() -> void:
	var g := VCGame.new()
	ok("новая игра: денег 0", g.total_money() == 0.0)
	ok("новая игра: клик = 1", close(g.per_click(), 1.0))
	ok("новая игра: пассива 0", g.per_sec() == 0.0)
	ok("новая игра: скин 0 выбран", int(g.s["skin"]) == 0)
	ok("новая игра: 5 корзин", g.s["money"].size() == 5)

func test_click_and_upgrades() -> void:
	var g := VCGame.new()
	g.click()
	ok("клик даёт 1 монету", close(g.total_money(), 1.0))
	for i in 49:
		g.click()
	ok("50 кликов = 50 монет", close(g.total_money(), 50.0))
	ok("покупка Максима", g.buy_upgrade("maxim"))
	ok("Максим: уровень 1", g.level("maxim") == 1)
	ok("Максим: пассив 1/сек", close(g.per_sec(), 1.0))
	var u := {}
	for x in VCData.IDLE:
		if x["id"] == "maxim":
			u = x
	var cost1: float = g.upgrade_cost(u)
	g.add_money(1e6, "auto")
	g.buy_upgrade("maxim")
	ok("рост цены", g.upgrade_cost(u) > cost1, "%f → %f" % [cost1, g.upgrade_cost(u)])
	ok("Максим: уровень 2", g.level("maxim") == 2)
	g.add_money(1e7, "auto")
	g.buy_upgrade("gold")
	ok("золотой палец ×1.5", close(g.multiplier(), 1.5, 1e-9), str(g.multiplier()))
	var pc: float = g.per_click()
	ok("клик с множителем", close(pc, 1.0 * 1.5, 1e-6), str(pc))
	# «Старость» покупается один раз и не даёт множителя
	g.add_money(1e9, "auto")
	ok("Старость куплена", g.buy_upgrade("starost"))
	ok("Старость не покупается дважды", not g.buy_upgrade("starost"))

func test_spend() -> void:
	var g := VCGame.new()
	g.add_money(100.0, "click")
	g.add_money(50.0, "auto")
	ok("всего 150", close(g.total_money(), 150.0))
	ok("списание 120", g.spend(120.0))
	ok("остаток 30", close(g.total_money(), 30.0))
	ok("нельзя списать 31", not g.spend(31.0))
	ok("баланс не изменился", close(g.total_money(), 30.0))
	ok("отрицательных нет", float(g.s["money"]["click"]) >= 0.0 and float(g.s["money"]["auto"]) >= 0.0)

func test_skins_and_craft() -> void:
	var g := VCGame.new()
	g.add_money(1e9, "auto")
	ok("скин 1 куплен", g.buy_skin(1) == "")
	ok("скин 1 в списке", g.owns_skin(1))
	ok("скин 1 выбран", g.select_skin(1))
	ok("множитель скина 1.2", close(g.multiplier(), 1.2, 1e-6), str(g.multiplier()))
	ok("нельзя купить закрытый скин", g.buy_skin(100) != "")
	ok("нельзя выбрать некупленный", not g.select_skin(9))
	# крафт: 10 бандитов → ахуенный
	g.add_money(1e8, "auto")
	for i in 10:
		g.buy_skin(102)
	ok("10 бандитов", g.s["owned_skins"].count(102) == 10)
	ok("крафт доступен", g.can_craft(VCData.RECIPES[0]) >= 1)
	ok("крафт выполнен", g.craft(VCData.RECIPES[0], 1))
	ok("ахуенный получен", g.owns_skin(103))
	ok("бандитов осталось 0", g.s["owned_skins"].count(102) == 0)
	ok("удача младшего 0.08", close(VCGame.new().luck(), 0.0))
	g.s["owned_skins"].append(104)
	ok("удача суммируется", close(g.luck(), 0.08, 1e-9), str(g.luck()))
	ok("бафф футболиста", not g.has_baf("football"))
	g.s["owned_skins"].append(100)
	ok("бафф футболиста получен", g.has_baf("football"))

func test_casino() -> void:
	var g := VCGame.new()
	g.add_money(100e6, "auto")
	ok("без пропуска нельзя", not bool(g.spin(100.0)["ok"]))
	ok("пропуск куплен", g.buy_pass() == "")
	ok("пропуск не покупается дважды", g.buy_pass() != "")
	var starts: int = 0
	var losses := 0
	var wins := 0
	for i in 200:
		var before: float = g.total_money()
		var m: float = float(g.s["casino"]["multiplier"])
		var r: Dictionary = g.spin(100.0)
		var after: float = g.total_money()
		if not bool(r["ok"]):
			break
		if bool(r["win"]):
			wins += 1
			if not close(after, before - 100.0 + 100.0 * m, 1e-6):
				fails += 1
				print("  FAIL выплата казино: ", before, " → ", after, " m=", m)
		else:
			losses += 1
			if not close(after, before - 100.0, 1e-6):
				fails += 1
				print("  FAIL списание казино: ", before, " → ", after)
		starts += 1
		if g.total_money() < 100.0:
			g.add_money(1e6, "auto")
	ok("200 прокруток", starts == 200, str(starts))
	ok("есть и выигрыши, и проигрыши", wins > 0 and losses > 0, "w=%d l=%d" % [wins, losses])
	ok("шанс в разумных пределах", g.win_chance(1.5) > g.win_chance(50.0))
	# x50 обнуляет множитель и счётчик
	g.s["casino"]["total_spins"] = 0
	g.s["casino"]["multiplier"] = 50.0
	var saved_luck := 1.0
	while not g.ach_done("x50"):
		g.s["casino"]["multiplier"] = 50.0
		g.add_money(1e5, "auto")
		g.spin(10.0)
		saved_luck += 1.0
		if saved_luck > 5000:
			break
	ok("x50 достижение", g.ach_done("x50"))
	ok("множитель сброшен после x50", close(float(g.s["casino"]["multiplier"]), 1.5))

func test_loans() -> void:
	var g := VCGame.new()
	var before: float = g.total_money()
	ok("кредит выдан", g.loan_take(1000.0, 5) == "")
	ok("деньги пришли", close(g.total_money(), before + 1000.0))
	ok("второй кредит нельзя", g.loan_take(1000.0, 1) != "")
	ok("долг ≈ 1000", close(g.loan_owed(g.s["loans"][0]), 1000.0, 0.01))
	ok("досрочно погашен", g.loan_pay_early(0) == "")
	ok("кредитов нет", g.s["loans"].is_empty())
	ok("погашение не больше тела", close(g.total_money(), before, 0.02))
	# просрочка: денег мало → часть уходит, долг уменьшается, срок переносится
	var h := VCGame.new()
	h.loan_take(5000.0, 1)
	h.s["money"] = { "click": 0.0, "auto": 0.0, "casino": 0.0, "crypto": 0.0, "mining": 2000.0 }
	h.s["loans"][0]["start"] = Time.get_unix_time_from_system() - 7200
	h.process_loans()
	ok("просроченный кредит остался", h.s["loans"].size() == 1)
	var left: float = float(h.s["loans"][0]["amount"])
	ok("долг уменьшился на платёж", close(left, 3100.0, 0.03), str(left))
	ok("долг не сброшен к телу", left < 4000.0, str(left))
	ok("срок 1 час", int(h.s["loans"][0]["hours"]) == 1)
	ok("деньги списаны", close(h.total_money(), 0.0, 0.001), str(h.total_money()))

func test_save_load() -> void:
	var g := VCGame.new()
	g.save_path = "user://selftest_save.json"
	g.add_money(123456.0, "auto")
	g.buy_upgrade("maxim")
	g.buy_skin(1)
	g.select_skin(1)
	g.s["clicks"] = 77
	g.s["propusk"] = true
	g.s["crypto"]["operativka"]["held"] = 42.0
	g.save()
	var h := VCGame.new()
	h.save_path = "user://selftest_save.json"
	ok("сохранение читается", h.load_game())
	ok("деньги совпали", close(h.total_money(), g.total_money(), 1e-9), "%.4f vs %.4f" % [h.total_money(), g.total_money()])
	ok("апгрейд совпал", h.level("maxim") == 1)
	ok("скин совпал", int(h.s["skin"]) == 1)
	ok("клики совпали", int(h.s["clicks"]) == 77)
	ok("пропуск совпал", bool(h.s["propusk"]))
	ok("крипта совпала", close(float(h.s["crypto"]["operativka"]["held"]), 42.0))
	ok("версия 24", int(h.s["version"]) == 24)
	DirAccess.remove_absolute(ProjectSettings.globalize_path("user://selftest_save.json"))

func test_offline() -> void:
	var g := VCGame.new()
	g.save_path = "user://offline_test.json"
	g.add_money(1e9, "auto")
	g.buy_upgrade("maxim")     # 1/сек
	var rate: float = g.per_sec()
	g.s["last_seen"] = Time.get_unix_time_from_system() - 3600.0
	var before: float = g.total_money()
	var sec: float = g.apply_offline()
	ok("оффлайн ≈ час", close(sec, 3600.0, 0.02), str(sec))
	ok("оффлайн-доход начислен", close(g.total_money() - before, rate * sec, 0.02), "%.2f" % (g.total_money() - before))
	# кэп 24 часа
	g.s["last_seen"] = Time.get_unix_time_from_system() - 100000.0
	ok("оффлайн не больше 24ч", close(g.apply_offline(), 86400.0, 0.02))

func test_fmt() -> void:
	ok("fmt 0", VCGame.fmt(0.0) == "0", VCGame.fmt(0.0))
	ok("fmt 999", VCGame.fmt(999.0) == "999", VCGame.fmt(999.0))
	ok("fmt 1K", VCGame.fmt(1500.0) == "1.50K", VCGame.fmt(1500.0))
	ok("fmt 1M", VCGame.fmt(1e6) == "1.00M", VCGame.fmt(1e6))
	ok("fmt 1.5B", VCGame.fmt(1.5e9) == "1.50B", VCGame.fmt(1.5e9))
	ok("fmt_mult 1", VCGame.fmt_mult(1.0) == "1")
	ok("fmt_mult 1.5", VCGame.fmt_mult(1.5) == "1.5")
	ok("fmt_chance", VCGame.fmt_chance(0.25) == "25.00%", VCGame.fmt_chance(0.25))
