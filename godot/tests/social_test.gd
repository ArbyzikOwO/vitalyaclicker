extends SceneTree
## Живая проверка социальной части на локальном сервере.
## Нужен действующий user://session.json (аккаунт GodotQA) и запущенный сервер.
## Запускать только на QA-копии проекта:
##   godot --headless --path <копия> --script res://tests/social_test.gd

var fails := 0
var passes := 0
var _ui: Node = null

func ok(name: String, cond: bool, detail := "") -> void:
	if cond:
		passes += 1
		print("  ok   ", name)
	else:
		fails += 1
		print("  FAIL ", name, ("  — " + detail) if detail != "" else "")

func _initialize() -> void:
	print("── ЖИВОЙ ТЕСТ: ЧАТ, ДРУЗЬЯ, ПЕРЕВОДЫ ──")
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
	print("")
	print("ИТОГ: %d ok, %d fails" % [passes, fails])
	quit(0 if fails == 0 else 1)

func _run() -> void:
	await _wait_until(func() -> bool: return bool(_ui._playing), 25000)
	ok("вход по сохранённой сессии", bool(_ui._playing))
	if not bool(_ui._playing):
		_finish()
		return
	var so: VCSocial = _ui.social
	ok("социальный модуль создан", so != null)
	await _wait_until(func() -> bool: return not (so.friends["friends"] as Array).is_empty(), 10000)
	ok("друзья загружены", not (so.friends["friends"] as Array).is_empty(), str(so.friends))
	ok("кошелёк доступен", so.avail > 0.0, str(so.avail))
	# чат и ParrotAI
	_ui._show_tab("chat")
	await process_frame
	ok("вкладка чата построена", so._chat_log != null)
	var peers: Array = so.peers
	var has_room := false
	var has_bot := false
	for p in peers:
		if String(p.get("id", "")) == "global":
			has_room = true
		if String(p.get("id", "")) == "@parrot":
			has_bot = true
	ok("есть общий чат", has_room)
	ok("есть отдельный ParrotAI", has_bot)
	so.select_peer("@parrot")
	await _wait_until(func() -> bool: return not so.cache.get(so.key("@parrot"), []).is_empty(), 10000)
	var before_msgs: Array = so.cache.get(so.key("@parrot"), [])
	ok("история ParrotAI загружена", not before_msgs.is_empty(), str(before_msgs.size()))
	if so._chat_input != null:
		so._chat_input.text = "Привет, ParrotAI! Расскажи коротко, как дела?"
		var target_size: int = before_msgs.size() + 2
		so._send()
		await _wait_until(func() -> bool: return (so.cache.get(so.key("@parrot"), []) as Array).size() >= target_size, 20000)
		var after_msgs: Array = so.cache.get(so.key("@parrot"), [])
		var last: Dictionary = after_msgs[after_msgs.size() - 1] if not after_msgs.is_empty() else {}
		ok("ParrotAI ответил", bool(last.get("bot", false)), String(last.get("text", "")))
		ok("сообщение отправлено", String(last.get("from", "")) != "")

	# друзья: принять заявку и убрать
	_ui._show_tab("friends")
	await process_frame
	ok("вкладка друзей построена", so._tr_card != null)
	if _has_friend(so.friends["incoming"] as Array, "LocalTester"):
		so._friend_accept("LocalTester")
		await _wait_until(func() -> bool: return _has_friend(so.friends["friends"] as Array, "LocalTester"), 10000)
		ok("входящая заявка принята", _has_friend(so.friends["friends"] as Array, "LocalTester"))
		so._friend_remove_now("LocalTester")
		await _wait_until(func() -> bool: return not _has_friend(so.friends["friends"] as Array, "LocalTester"), 10000)
		ok("друг удалён", not _has_friend(so.friends["friends"] as Array, "LocalTester"))
	else:
		ok("входящих заявок нет — пропуск", true)

	# перевод через UI
	await _wait_until(func() -> bool: return not so.transfer_busy, 5000)
	var before_tx: int = so.tx.size()
	if so._tr_name != null and so._tr_amt != null:
		so._tr_name.text = "GodotQA2"
		so._tr_amt.text = "1K"
		so._do_transfer()
		await _wait_until(func() -> bool: return not so.transfer_busy and so.tx.size() > before_tx, 25000)
		ok("перевод выполнен", so.tx.size() > before_tx, "%d → %d" % [before_tx, so.tx.size()])
		await _wait_until(func() -> bool: return so.pending_ack.is_empty(), 12000)
		ok("кошелёк синхронизирован", so.pending_ack.is_empty(), str(so.pending_ack))
		ok("перевод отмечен в истории", _has_tx(so.tx, "GodotQA2", -1050), str(so.tx))
	else:
		ok("поля перевода существуют", false)
	_finish()

func _has_friend(arr: Array, nm: String) -> bool:
	for f in arr:
		if typeof(f) == TYPE_DICTIONARY and String(f.get("name", "")).to_lower() == nm.to_lower():
			return true
	return false

func _has_tx(arr: Array, other: String, amount: int) -> bool:
	for t in arr:
		if typeof(t) != TYPE_DICTIONARY:
			continue
		if String(t.get("other", "")).to_lower() == other.to_lower() and int(t.get("amount", 0)) == amount:
			return true
	return false
