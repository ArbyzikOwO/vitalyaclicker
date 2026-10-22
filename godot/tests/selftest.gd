extends SceneTree
## Самопроверка Godot-порта: экономика, казино, кредиты, сохранение и сборка UI.
## Запуск: godot --headless --path godot --script res://tests/selftest.gd

var fails := 0
var passes := 0
var _ui: Node = null
var _frame := 0
var _tabs := ["up", "skins", "casino", "crypto", "chat", "friends", "games", "more", "garden", "click"]
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
	test_cloud_bin()
	test_offline()
	test_fmt()
	test_social()
	test_garden()

	print("── UI ──")
	_ui = load("res://scenes/main.tscn").instantiate()
	_ui.set("_skip_gate", true)
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
		# казино: крутим через UI-обработчик (анимация ~1.5 с)
		_ui._show_tab("casino")
		_ui._bet_input.text = "100"
		var before: float = _ui.game.total_money()
		_ui._on_spin()
		await create_timer(2.6).timeout
		var after: float = _ui.game.total_money()
		ok("UI: прокрутка меняет баланс", after != before, "%.2f → %.2f" % [before, after])
		ok("UI: результат показан", _ui._result_lbl.text != "", _ui._result_lbl.text)
		# кредит: раннее погашение через UI
		_ui._show_tab("more")
		var owed: float = _ui.game.loan_owed(_ui.game.s["loans"][0])
		ok("UI: кредит виден", owed >= 1000.0)
		if _ui.game.s["loans"].size() > 0:
			_ui._on_loan_pay(0)
			ok("UI: кредит погашен", _ui.game.s["loans"].is_empty())
		_finish()
		return
	if idx > _tabs.size():
		return

func _finish() -> void:
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

func test_cloud_bin() -> void:
	print("── ОБЛАКО data.bin ──")
	# ключ денег: значения из веб-версии (FNV-1a), проверено Node
	ok("cloud: ключ 13", VCSaveBin.money_key({ "click": 13, "auto": 0, "casino": 0, "crypto": 0, "mining": 0 }) == 3342930402)
	ok("cloud: ключ нулей", VCSaveBin.money_key({ "click": 0, "auto": 0, "casino": 0, "crypto": 0, "mining": 0 }) == 1518730916)
	ok("cloud: ключ с дробями", VCSaveBin.money_key({ "click": 123.5, "auto": 1e6, "casino": 0, "crypto": 2500, "mining": 7 }) == 1097217617)
	ok("cloud: ключ порядок не важен", VCSaveBin.money_key({ "mining": 7, "crypto": 2500, "casino": 0, "auto": 1e6, "click": 123.5 }) == 1097217617)

	var g := VCGame.new()
	g.s["money"] = { "click": 123.5, "auto": 1e6, "casino": 0.0, "crypto": 2500.0, "mining": 7.0 }
	g.s["clicks"] = 321
	g.s["upgrades"]["maxim"] = 5
	g.s["upgrades"]["gold"] = 2
	g.s["owned_skins"] = [0, 3, 3, 12]
	g.s["skin"] = 3
	g.s["casino"]["total_spins"] = 42
	g.s["casino"]["multiplier"] = 2.5
	g.s["propusk"] = true
	g.s["vnv_pass"] = true
	g.s["crypto"]["operativka"]["price"] = 321.0
	g.s["crypto"]["operativka"]["held"] = 4.5
	g.s["crypto"]["operativka"]["history"] = [100.0, 200.0, 321.0]
	g.s["mining"]["gpus"].append({ "type": "rx580", "speed": 50.0, "broken": false })
	g.s["mining"]["maxims"] = 2
	g.s["mining"]["maxims_enabled"] = true
	g.s["mining"]["farms"][0]["gpus"].append({ "type": "rtx5080", "speed": 100.0, "broken": true, "installed_at": 111.0 })
	g.s["loans"].append({ "amount": 5000.0, "hours": 3, "start": 1000.0, "paid": false })
	g.s["achievements"]["click1"] = true
	g.s["achievements"]["g_sprout"] = true
	g.s["news"].append({ "id": 2, "text": "x", "effect": "op+10", "dir": 1, "time": 555.0, "done": false })
	g.s["news_history"].append({ "id": 2, "text": "x", "time": 444.0, "dir": 1 })
	g.s["last_seen"] = 777777.0
	g.s["cloud_extra"] = {
		"sound_choice": 1, "starost_on": true, "auto_reset_at": 42.0,
		"auto_click_warns": 2.0, "auto_click_warns_reset_at": 3.0, "blocked": false,
	}

	var bytes := g.to_cloud()
	ok("cloud: запись не пустая", bytes.size() > 100, str(bytes.size()))
	ok("cloud: magic", bytes.decode_u32(0) == 0x56434442)
	ok("cloud: версия 24", bytes.decode_u32(4) == 24)
	ok("cloud: ключ в файле", bytes.decode_u32(8) == 1097217617)
	ok("cloud: деньги в файле", bytes.decode_double(12) == 123.5)

	var res := VCSaveBin.decode(bytes)
	ok("cloud: чтение ок", bool(res["ok"]), String(res["err"]))
	var s2: Dictionary = res["state"]
	ok("cloud: деньги", close(float(s2["money"]["auto"]), 1e6))
	ok("cloud: клики", int(s2["clicks"]) == 321)
	ok("cloud: апгрейды", int(s2["upgrades"].get("maxim", 0)) == 5 and int(s2["upgrades"].get("gold", 0)) == 2)
	ok("cloud: скины с дублями", (s2["owned_skins"] as Array).size() == 4 and int(s2["skin"]) == 3)
	ok("cloud: казино", int(s2["casino"]["total_spins"]) == 42 and close(float(s2["casino"]["multiplier"]), 2.5))
	ok("cloud: пропуск и внв", bool(s2["propusk"]) and bool(s2["vnv_pass"]))
	ok("cloud: крипта", close(float(s2["crypto"]["operativka"]["price"]), 321.0) and close(float(s2["crypto"]["operativka"]["held"]), 4.5))
	ok("cloud: история цен", (s2["crypto"]["operativka"]["history"] as Array).size() == 3)
	ok("cloud: видеокарты", (s2["mining"]["gpus"] as Array).size() == 1 and String(s2["mining"]["gpus"][0]["type"]) == "rx580")
	ok("cloud: ферма", (s2["mining"]["farms"][0]["gpus"] as Array).size() == 1 and bool(s2["mining"]["farms"][0]["gpus"][0]["broken"]))
	ok("cloud: кредит", (s2["loans"] as Array).size() == 1 and close(float(s2["loans"][0]["amount"]), 5000.0))
	ok("cloud: достижение", bool(s2["achievements"].get("click1", false)))
	ok("cloud: достижение сада", bool(s2["achievements"].get("g_sprout", false)))
	ok("cloud: новость", (s2["news"] as Array).size() == 1 and int(s2["news"][0]["id"]) == 2)
	ok("cloud: история новостей", (s2["news_history"] as Array).size() == 1)
	ok("cloud: звук перенесён", int(res["extra"].get("sound_choice", -1)) == 1)
	ok("cloud: время выхода", close(float(s2["last_seen"]), 777777.0))

	var g2 := VCGame.new()
	var err2 := g2.from_cloud(bytes)
	ok("cloud: from_cloud без ошибок", err2 == "", err2)
	ok("cloud: баланс после импорта", close(g2.total_money(), 1000123.5 + 2500.0 + 7.0, 1e-9), "%.2f" % g2.total_money())
	var bytes2 := g2.to_cloud()
	var res2 := VCSaveBin.decode(bytes2)
	ok("cloud: повторное чтение", bool(res2["ok"]), String(res2["err"]))
	ok("cloud: повторный импорт денег", close(float(res2["state"]["money"]["crypto"]), 2500.0))
	ok("cloud: повторный импорт достижений", bool(res2["state"]["achievements"].get("g_sprout", false)))

	var bad := bytes.duplicate()
	bad.encode_u32(8, 12345)
	ok("cloud: плохой ключ отвергнут", not bool(VCSaveBin.decode(bad)["ok"]))
	ok("cloud: обрезка отвергнута", not bool(VCSaveBin.decode(bytes.slice(0, 40))["ok"]))
	ok("cloud: неверная версия отвергнута", not bool(VCSaveBin.decode(bytes.slice(0, 60))["ok"]))

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

func test_social() -> void:
	print("── ЧАТ, ДРУЗЬЯ, ПЕРЕВОДЫ ──")
	ok("сумма 5K", close(VCSocial.parse_amount("5K"), 5000.0))
	ok("сумма 2.5M", close(VCSocial.parse_amount("2.5M"), 2.5e6))
	ok("сумма 1B", close(VCSocial.parse_amount("1B"), 1e9))
	ok("сумма 3T", close(VCSocial.parse_amount("3T"), 3e12))
	ok("сумма 1к", close(VCSocial.parse_amount("1к"), 1000.0))
	ok("сумма с пробелом", close(VCSocial.parse_amount(" 10 M "), 1e7))
	ok("сумма с запятой", close(VCSocial.parse_amount("2,5M"), 2.5e6))
	ok("пустая сумма", VCSocial.parse_amount("") == 0.0)
	ok("мусор в сумме", VCSocial.parse_amount("abc") == 0.0)
	ok("нулевая сумма", VCSocial.parse_amount("0") == 0.0)
	ok("неизвестный суффикс", VCSocial.parse_amount("5zz") == 0.0)
	ok("bbcode открытая скобка", VCSocial.bbcode_escape("[b]x") == "[lb]b]x", VCSocial.bbcode_escape("[b]x"))
	var so := VCSocial.new()
	so.setup(null, null, null)
	ok("ключ чата без регистра", so.key(" GodotQA ") == "godotqa", so.key(" GodotQA "))
	var merged: Array = so._merge_msgs(
		[{ "id": "a", "text": "старое" }, { "id": "b", "text": "новое" }],
		[{ "id": "a", "text": "из истории" }])
	ok("история чата склеена", merged.size() == 2 and String(merged[0]["text"]) == "из истории")
	ok("новое сообщение не потеряно", String(merged[1]["id"]) == "b")

func test_garden() -> void:
	print("── САД ──")
	var g := VCGarden.new()
	g.persist_local = false
	ok("сад: версия 24", int(g.data.get("version", 0)) == 24)
	ok("сад: 10×10", g.garden_size() == 10)
	ok("сад: касса 0", g.money() == 0.0)
	g.data["seeds"]["rose"] = 2
	g.select_plant("rose")
	ok("сад: посажено", g.plant_at(0, 0))
	ok("сад: семян осталось 1", g.seed_count("rose") == 1)
	var c := g.cell_at(0, 0)
	ok("сад: растёт", String(g.stage(c).get("stage", "")) == "growing")
	c["plantedAt"] = g.now_ms() - 3600001.0
	ok("сад: спелое", String(g.stage(c).get("stage", "")) == "mature")
	ok("сад: собрано", g.harvest_at(0, 0))
	ok("сад: урожай 1", g.harvested_count("rose") == 1)
	var got := g.sell_all()
	ok("сад: продано", got > 0.0)
	ok("сад: касса пополнилась", g.money() > 0.0)
	var enc := JSON.stringify(g.data)
	var dec: Variant = JSON.parse_string(enc)
	ok("сад: json читается", typeof(dec) == TYPE_DICTIONARY)
	if typeof(dec) == TYPE_DICTIONARY:
		ok("сад: поля сохранились", int((dec as Dictionary).get("version", 0)) == 24)
	g.data["money"] = 1e15
	var before := g.money()
	var bought := g.buy_pack("rose")
	ok("сад: покупка семян", g.seed_count("rose") > 0 and g.money() < before, bought)
	ok("сад: расширение", g.buy_size().begins_with("🌾") and g.garden_size() == 15)
	var game := VCGame.new()
	game.garden = g
	game.add_money(100.0, "click")
	ok("сад: общий баланс", close(game.total_money(), game.main_money() + g.money()))
	var spent := [0.0]
	var main := [100.0]
	g.set_wallet(
		func(x: float) -> bool:
			spent[0] = float(spent[0]) + x
			return true,
		func() -> float: return float(main[0])
	)
	g.data["money"] = 50.0
	ok("сад: трата из кассы", g.spend_total(25.0))
	ok("сад: касса уменьшилась", close(g.money(), 25.0))
	g.data["money"] = 20.0
	spent[0] = 0.0
	ok("сад: добирает main", g.spend_total(70.0))
	ok("сад: main списан", close(float(spent[0]), 50.0))
	game.garden = null
	var game2 := VCGame.new()
	var g2 := VCGarden.new()
	g2.persist_local = false
	g2.data["money"] = 50.0
	game2.garden = g2
	game2.add_money(10.0, "click")
	ok("сад: main тратит сад", game2.spend(30.0))
	ok("сад: корзины main пусты", close(game2.main_money(), 0.0))
	ok("сад: сад оплатил остаток", close(g2.money(), 30.0))
	game2.garden = null
