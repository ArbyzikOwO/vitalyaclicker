extends SceneTree
## Живая проверка игр: дуэли, рулетка и столы с картами.
## Нужен запущенный локальный сервер и сессия GodotQA в user://session.json.
## Запускать только на QA-копии проекта:
##   godot --headless --path <копия> --script res://tests/play_test.gd

var fails := 0
var passes := 0
var _ui: Node = null
var _net2: VCNet = null
var _pushes2: Array = []
var _session_backup := ""

func ok(name: String, cond: bool, detail := "") -> void:
	if cond:
		passes += 1
		print("  ok   ", name)
	else:
		fails += 1
		print("  FAIL ", name, ("  — " + detail) if detail != "" else "")

func _initialize() -> void:
	print("── ЖИВОЙ ТЕСТ: ИГРЫ ──")
	_session_backup = FileAccess.get_file_as_string("user://session.json") if FileAccess.file_exists("user://session.json") else ""
	_ui = load("res://scenes/main.tscn").instantiate()
	root.add_child(_ui)
	_run()

func _wait_until(cond: Callable, ms: int) -> void:
	var deadline := Time.get_ticks_msec() + ms
	while Time.get_ticks_msec() < deadline:
		if bool(cond.call()):
			return
		await process_frame

func _finish() -> void:
	if _net2 != null:
		_net2.disconnect_ws()
	if _session_backup != "":
		var f := FileAccess.open("user://session.json", FileAccess.WRITE)
		if f != null:
			f.store_string(_session_backup)
			f.close()
	print("")
	print("ИТОГ: %d ok, %d fails" % [passes, fails])
	quit(0 if fails == 0 else 1)

func _run() -> void:
	await _wait_until(func() -> bool: return bool(_ui._playing), 25000)
	ok("вход по сохранённой сессии", bool(_ui._playing))
	if not bool(_ui._playing):
		_finish()
		return
	var pl: VCPlay = _ui.play
	ok("модуль игр создан", pl != null)
	await _ui.net.request("duel.cancel", {})
	await _ui.net.request("roul.leave", {})
	await _ui.net.request("card.leave", {})
	_ui._show_tab("games")
	await process_frame
	ok("вкладка игр построена", _ui._content.get_child_count() > 0, str(_ui._content.get_child_count()))

	# второй клиент — GodotQA2
	_net2 = VCNet.new()
	root.add_child(_net2)
	var login: Dictionary = await _net2.http_post("/api/login", { "name": "GodotQA2", "password": "godot1234" })
	if not bool(login.get("ok", false)):
		ok("вход второго игрока", false, str(login))
		_finish()
		return
	_net2.token = String(login.get("token", ""))
	_net2.user_name = String(login.get("name", "GodotQA2"))
	_net2.signed_at = Time.get_unix_time_from_system()
	var linked: bool = await _net2.ensure_link()
	ok("второй игрок подключён", linked)
	if not linked:
		_finish()
		return
	_net2.pushed.connect(func(m: Dictionary) -> void: _pushes2.append(m))
	await _net2.request("duel.cancel", {})
	await _net2.request("roul.leave", {})
	await _net2.request("card.leave", {})
	await _wait_until(func() -> bool: return not pl.card_games.is_empty() and not pl.card_timers.is_empty(), 10000)
	ok("список игр получен", pl.card_games.size() >= 5, str(pl.card_games.size()))

	# фишки: на одно поле можно поставить несколько, последняя снимается
	pl.roul_room = { "bet": 2000.0 }
	pl.roul_chip = 1000
	pl._roul_clear_bets()
	pl._roul_add("n:7")
	pl._roul_add("n:7")
	ok("две фишки на одном числе", absf(pl._roul_stake_total() - 2000.0) < 0.5, str(pl.roul_bets))
	pl._roul_undo()
	ok("снятие последней фишки", absf(pl._roul_stake_total() - 1000.0) < 0.5, str(pl.roul_bets))
	pl._roul_clear_bets()
	pl.roul_room.clear()
	ok("очки без дробной части", pl._num(20.0) == "20", pl._num(20.0))

	# ── дуэль ──
	pl.hub = "duel"
	_ui._rebuild()
	var dc: Dictionary = await _ui.net.request("duel.create", { "game": "coin", "bet": 1000 })
	ok("дуэль создана", bool(dc.get("ok", false)), str(dc))
	pl.duel_mine = String(dc.get("table", ""))
	await _wait_until(func() -> bool: return pl.duel_mine != "", 5000)
	ok("свой стол отмечен", pl.duel_mine != "")
	var dj: Dictionary = await _net2.request("duel.join", { "table": pl.duel_mine })
	ok("соперник вошёл", bool(dj.get("ok", false)), str(dj))
	await _wait_until(func() -> bool: return not pl.duel_res.is_empty(), 10000)
	ok("результат дуэли получен", not pl.duel_res.is_empty(), str(pl.duel_res))
	ok("результат содержит бросок", String(pl.duel_res.get("myRoll", "")) != "", str(pl.duel_res))
	await _wait_until(func() -> bool: return _ui.play.duel_tables.is_empty(), 8000)
	ok("стол закрыт после дуэли", pl.duel_mine == "")
	pl.duel_res.clear()

	# ── рулетка ──
	pl.hub = "roul"
	_ui._rebuild()
	var rc: Dictionary = await _ui.net.request("roul.create", { "bet": 1000, "max": 2 })
	ok("рулетка создана", bool(rc.get("ok", false)), str(rc))
	var rcr: Variant = rc.get("room")
	if rcr != null and typeof(rcr) == TYPE_DICTIONARY:
		pl.roul_room = rcr
	await _wait_until(func() -> bool: return not pl.roul_room.is_empty(), 5000)
	var rid := String(pl.roul_room.get("id", ""))
	var rj: Dictionary = await _net2.request("roul.join", { "room": rid })
	ok("второй сел за рулетку", bool(rj.get("ok", false)), str(rj))
	await _wait_until(func() -> bool: return (pl.roul_room.get("players", []) as Array).size() == 2, 8000)
	var rs: Dictionary = await _ui.net.request("roul.start", {})
	ok("рулетка начата", bool(rs.get("ok", false)), str(rs))
	await _wait_until(func() -> bool: return String(pl.roul_room.get("state", "")) == "bet", 8000)
	var b1: Dictionary = await _ui.net.request("roul.bets", { "bets": [{ "id": "red", "amount": 1000 }] })
	ok("ставка первого принята", bool(b1.get("ok", false)), str(b1))
	var b2: Dictionary = await _net2.request("roul.bets", { "bets": [{ "id": "red", "amount": 1000 }] })
	ok("ставка второго принята", bool(b2.get("ok", false)), str(b2))
	await _wait_until(func() -> bool: return String(pl.roul_room.get("state", "")) == "done", 10000)
	var num := int(pl.roul_room.get("num", -1))
	ok("колесо остановилось", num >= 0 and num <= 36, str(num))
	var you: Dictionary = pl.roul_room.get("you", {})
	ok("выплата при равных ставках", absf(float(you.get("payout", 0.0)) - 1000.0) < 0.5, str(you))
	pl.roul_room.clear()
	pl.roul_bets.clear()

	# ── блэкджек ──
	pl.hub = "cards"
	_ui._rebuild()
	var cc: Dictionary = await _ui.net.request("card.create", { "game": "bj", "bet": 1000, "max": 2, "turnMs": 0 })
	ok("стол блэкджека создан", bool(cc.get("ok", false)), str(cc))
	var ccr: Variant = cc.get("room")
	if ccr != null and typeof(ccr) == TYPE_DICTIONARY:
		pl.card_room = ccr
	await _wait_until(func() -> bool: return String(pl.card_room.get("state", "")) == "lobby", 5000)
	var kid := String(pl.card_room.get("id", ""))
	var cj: Dictionary = await _net2.request("card.join", { "room": kid })
	ok("второй сел за стол", bool(cj.get("ok", false)), str(cj))
	await _wait_until(func() -> bool: return (pl.card_room.get("players", []) as Array).size() == 2, 8000)
	var cs: Dictionary = await _ui.net.request("card.start", {})
	ok("блэкджек начат", bool(cs.get("ok", false)), str(cs))
	await _wait_until(func() -> bool: return not pl.card_state.is_empty(), 8000)
	ok("раздача получена", not pl.card_state.is_empty(), str(pl.card_state))
	ok("вид блэкджека", String(pl.card_state.get("game", "")) == "bj")
	var guard := 0
	while not bool(pl.card_state.get("over", false)) and guard < 24:
		guard += 1
		var turn := int(pl.card_state.get("turn", -1))
		if turn < 0:
			break
		if turn == 0:
			await _ui.net.request("card.act", { "act": "stand" })
		else:
			await _net2.request("card.act", { "act": "stand" })
		var prev := turn
		await _wait_until(func() -> bool: return bool(pl.card_state.get("over", false)) or int(pl.card_state.get("turn", -1)) != prev, 5000)
	ok("блэкджек доигран", bool(pl.card_state.get("over", false)), "guard=%d" % guard)
	var money: Array = pl.card_state.get("money", [])
	var sum := 0
	for m in money:
		sum += int(m)
	ok("банк вернулся игрокам", money.size() == 2 and sum == 2000, "%s sum=%d" % [str(money), sum])
	pl.card_room.clear()
	pl.card_state.clear()
	pl.card_sel.clear()
	await process_frame
	_ui._rebuild()
	ok("лобби столов снова доступно", _ui._content.get_child_count() > 0)

	# остальные игры: создаём, раздаём и проверяем отрисовку
	for key in ["war", "cheat", "durak", "poker"]:
		await _one_card_table(pl, key)
	_finish()

func _one_card_table(pl: VCPlay, key: String) -> void:
	var opts: Dictionary = { "deck": 36, "transfer": true, "toEnd": true } if key == "durak" else {}
	var cc: Dictionary = await _ui.net.request("card.create", { "game": key, "bet": 1000, "max": 2, "opts": opts, "turnMs": 0 })
	ok("%s: стол создан" % key, bool(cc.get("ok", false)), str(cc))
	if not bool(cc.get("ok", false)):
		return
	var room: Variant = cc.get("room")
	if room != null and typeof(room) == TYPE_DICTIONARY:
		pl.card_room = room
	var kid := String(pl.card_room.get("id", ""))
	var jr: Dictionary = await _net2.request("card.join", { "room": kid })
	ok("%s: второй сел" % key, bool(jr.get("ok", false)), str(jr))
	await _wait_until(func() -> bool: return (pl.card_room.get("players", []) as Array).size() == 2, 6000)
	var sr: Dictionary = await _ui.net.request("card.start", {})
	ok("%s: раздача начата" % key, bool(sr.get("ok", false)), str(sr))
	await _wait_until(func() -> bool: return not pl.card_state.is_empty(), 8000)
	ok("%s: вид получен" % key, String(pl.card_state.get("game", "")) == key, String(pl.card_state.get("game", "")))
	if key == "war":
		# проверяем действие через UI-обёртку, а не только прямой запрос
		await pl._card_act({ "act": "open" })
		await _wait_until(func() -> bool: return _count_opened(pl.card_state) >= 1 or bool(pl.card_state.get("over", false)), 6000)
		ok("war: карта открыта из UI", _count_opened(pl.card_state) >= 1, str(pl.card_state.get("opened", [])))
		await _net2.request("card.act", { "act": "open" })
		await _wait_until(func() -> bool: return String(pl.card_state.get("phase", "")) == "result" or bool(pl.card_state.get("over", false)), 6000)
		ok("war: раунд завершён", String(pl.card_state.get("phase", "")) == "result", String(pl.card_state.get("phase", "")))
		await pl._card_act({ "act": "next" })
		await _wait_until(func() -> bool: return String(pl.card_state.get("phase", "")) == "reveal" or bool(pl.card_state.get("over", false)), 6000)
		ok("war: следующий раунд", String(pl.card_state.get("phase", "")) == "reveal" or bool(pl.card_state.get("over", false)), String(pl.card_state.get("phase", "")))
	if key == "durak":
		# атака или взятие через тот же путь, что и кнопки интерфейса
		var acted := false
		var hand0 := (pl.card_state.get("hand", []) as Array).size()
		if int(pl.card_state.get("attacker", -1)) == 0:
			await pl._card_act({ "act": "attack", "card": 0 })
			await _wait_until(func() -> bool: return (pl.card_state.get("table", []) as Array).size() > 0, 5000)
			acted = (pl.card_state.get("table", []) as Array).size() > 0
		elif int(pl.card_state.get("attacker", -1)) == 1:
			await _net2.request("card.act", { "act": "attack", "card": 0 })
			await _wait_until(func() -> bool: return (pl.card_state.get("table", []) as Array).size() > 0, 5000)
			await pl._card_act({ "act": "take" })
			await _wait_until(func() -> bool: return (pl.card_state.get("table", []) as Array).is_empty() or bool(pl.card_state.get("over", false)), 5000)
			acted = (pl.card_state.get("hand", []) as Array).size() > hand0
		ok("durak: действие из UI", acted, "attacker=%s table=%s" % [str(pl.card_state.get("attacker", -1)), str(pl.card_state.get("table", []))])
	if key == "cheat":
		# выложить карту и поверить — обе кнопки используют _card_act
		var ch0 := (pl.card_state.get("hand", []) as Array).size()
		var chok := false
		if int(pl.card_state.get("turn", -1)) == 0:
			await pl._card_act({ "act": "play", "cards": [0] })
			await _wait_until(func() -> bool: return String(pl.card_state.get("phase", "")) == "challenge", 5000)
			chok = String(pl.card_state.get("phase", "")) == "challenge" and (pl.card_state.get("hand", []) as Array).size() == ch0 - 1
			await _net2.request("card.act", { "act": "believe" })
			await _wait_until(func() -> bool: return String(pl.card_state.get("phase", "")) == "place" or bool(pl.card_state.get("over", false)), 5000)
			chok = chok and String(pl.card_state.get("phase", "")) == "place"
		else:
			await _net2.request("card.act", { "act": "play", "cards": [0] })
			await _wait_until(func() -> bool: return String(pl.card_state.get("phase", "")) == "challenge", 5000)
			await pl._card_act({ "act": "believe" })
			await _wait_until(func() -> bool: return String(pl.card_state.get("phase", "")) == "place" or bool(pl.card_state.get("over", false)), 5000)
			chok = String(pl.card_state.get("phase", "")) == "place"
		ok("cheat: ход из UI", chok, "phase=%s hand=%d" % [str(pl.card_state.get("phase", "")), (pl.card_state.get("hand", []) as Array).size()])
	if key == "poker":
		# малый блайнд уравнивает, большой проверяет — должен открыться флоп
		var turn0 := int(pl.card_state.get("turn", -1))
		ok("poker: первым ходит малый блайнд", turn0 == 1, str(turn0))
		if turn0 == 1:
			await _net2.request("card.act", { "act": "call" })
			await _wait_until(func() -> bool: return int(pl.card_state.get("turn", -1)) == 0, 5000)
			await pl._card_act({ "act": "check" })
			await _wait_until(func() -> bool: return String(pl.card_state.get("street", "")) == "flop" or bool(pl.card_state.get("over", false)), 6000)
			var board: Array = pl.card_state.get("board", [])
			ok("poker: флоп после UI-действий", String(pl.card_state.get("street", "")) == "flop" and board.size() == 3, "street=%s board=%d" % [str(pl.card_state.get("street", "")), board.size()])
	pl.card_sel.clear()
	_ui._rebuild()
	ok("%s: интерфейс построен" % key, _ui._content.get_child_count() > 0, str(_ui._content.get_child_count()))
	var lv: Dictionary = await _ui.net.request("card.leave", {})
	ok("%s: выход из партии" % key, bool(lv.get("ok", false)), str(lv))
	await _wait_until(func() -> bool: return pl.card_room.is_empty(), 8000)
	await _net2.request("card.leave", {})
	pl.card_room.clear()
	pl.card_state.clear()
	pl.card_sel.clear()
	await process_frame

func _count_opened(g: Dictionary) -> int:
	var n := 0
	for x in g.get("opened", []):
		if bool(x):
			n += 1
	return n
