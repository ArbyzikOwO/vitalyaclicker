class_name VCPlay
extends RefCounted
## Онлайн-игры: дуэли 1 на 1, рулетка на 2–4 игрока и столы с картами
## (блэкджек, дурак, пьяница, верю-не-верю, покер).
##
## Протокол полностью совпадает с веб-версией (online.js / server.js):
##   duel.tables / duel.create / duel.cancel / duel.join   → push duel.tables, duel.result
##   roul.rooms / roul.create / roul.join / .leave / .start / .bets
##   card.games / card.create / card.join / .leave / .start / .act
##
## Сервер — единственный судья: клиент только рисует присланное состояние
## и отправляет действия. Деньги приходят в pending-записях кошелька
## (их применяет VCSocial), поэтому здесь баланс не трогаем.

const DUEL_GAMES := { "coin": "Монетка", "dice": "Кости" }
const CARD_FALLBACK := [
	{ "key": "bj", "title": "Блэкджек", "min": 2, "max": 4 },
	{ "key": "durak", "title": "Дурак", "min": 2, "max": 6 },
	{ "key": "war", "title": "Пьяница", "min": 2, "max": 4 },
	{ "key": "cheat", "title": "Верю-не-верю", "min": 2, "max": 6 },
	{ "key": "poker", "title": "Покер", "min": 2, "max": 6 },
]
const SUIT_COLORS := { "♥": Color("d83a4a"), "♦": Color("d83a4a"), "♠": Color("1b2233"), "♣": Color("1b2233") }
const RED_NUMS := [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]
const ROUL_CHIPS := [1000, 10000, 100000, 1000000, 10000000, 100000000]

var ui: Node
var net: VCNet
var game: VCGame
var active := false
var hub := "duel"

var duel_tables: Array = []
var duel_mine := ""
var duel_res: Dictionary = {}
var duel_busy := false

var roul_rooms: Array = []
var roul_room: Dictionary = {}
var roul_bets: Dictionary = {}
var roul_stack: Array = []
var roul_chip := 1000
var roul_busy := false
var roul_last := ""

var card_rooms: Array = []
var card_room: Dictionary = {}
var card_state: Dictionary = {}
var card_games: Array = []
var card_timers: Array = []
var card_sel: Array = []
var card_busy := false
var card_game_key := "bj"
var card_show_opts := false

var _timer_lbl: Label
var _timer_at := 0.0
var _timer_mode := ""
var _roul_cells: Dictionary = {}
var _roul_total_lbl: Label
var _roul_ready_btn: Button
var _roul_chip_btns: Dictionary = {}
var _card_play_btn: Button
var _poker_raise: LineEdit
var _duel_bet: LineEdit
var _duel_game: OptionButton
var _roul_bet: LineEdit
var _roul_max: OptionButton
var _card_bet: LineEdit
var _card_max: OptionButton
var _card_timer: OptionButton
var _card_deck: OptionButton
var _card_transfer: CheckBox
var _card_toend: CheckBox
var _tick := 0.0

func setup(ui_node: Node, net_node: VCNet, game_node: VCGame) -> void:
	ui = ui_node
	net = net_node
	game = game_node

func on_login() -> void:
	active = true
	duel_res.clear()
	roul_room.clear()
	_roul_clear_bets()
	card_room.clear()
	card_state.clear()
	card_sel.clear()
	_refresh_all()

func on_logout() -> void:
	active = false
	duel_tables.clear()
	duel_mine = ""
	duel_res.clear()
	roul_rooms.clear()
	roul_room.clear()
	_roul_clear_bets()
	card_rooms.clear()
	card_room.clear()
	card_state.clear()
	card_sel.clear()
	roul_busy = false
	card_busy = false
	duel_busy = false

func tick(delta: float) -> void:
	if not active:
		return
	_tick += delta
	if _tick < 0.25:
		return
	_tick = 0.0
	if _timer_lbl != null and is_instance_valid(_timer_lbl) and _timer_at > 0.0:
		var left := _timer_at - Time.get_unix_time_from_system()
		if left <= 0.0:
			_timer_lbl.text = "время вышло"
			_timer_lbl.add_theme_color_override("font_color", ui.RED)
		else:
			_timer_lbl.text = "%d:%02d" % [int(left / 60.0), int(left) % 60]
			_timer_lbl.add_theme_color_override("font_color", ui.GOLD if left > 10.0 else ui.RED)

func on_show() -> void:
	if not active:
		return
	_refresh_all()

func _refresh_all() -> void:
	if not active or net == null or not net.authed:
		return
	_refresh_duel()
	_refresh_roul()
	_refresh_cards()

func _refresh_duel() -> void:
	var r: Dictionary = await net.request("duel.tables", {})
	if not bool(r.get("ok", true)):
		return
	duel_tables = r.get("tables", [])
	duel_mine = String(r.get("myTable", "") if r.get("myTable", null) != null else "")
	if ui._tab == "games" and hub == "duel":
		ui._rebuild()

func _refresh_roul() -> void:
	var r: Dictionary = await net.request("roul.rooms", {})
	if not bool(r.get("ok", true)):
		return
	roul_rooms = r.get("rooms", [])
	var rm: Variant = r.get("room")
	if rm != null and typeof(rm) == TYPE_DICTIONARY:
		roul_room = rm
		if String(roul_room.get("state", "")) != "bet":
			_roul_clear_bets()
	if ui._tab == "games" and hub == "roul":
		ui._rebuild()

func _refresh_cards() -> void:
	var r: Dictionary = await net.request("card.games", {})
	if not bool(r.get("ok", true)):
		return
	card_games = r.get("games", [])
	card_timers = r.get("timers", [])
	card_rooms = r.get("rooms", [])
	var rm: Variant = r.get("room")
	var gm: Variant = r.get("game")
	if rm != null and typeof(rm) == TYPE_DICTIONARY:
		card_room = rm
	else:
		card_room.clear()
	if gm != null and typeof(gm) == TYPE_DICTIONARY:
		card_state = gm
	elif String(card_room.get("state", "")) != "play":
		card_state.clear()
	if ui._tab == "games" and hub == "cards":
		ui._rebuild()

# ── push-события сервера ──────────────────────────────────────────────────────
## После партии сразу подтягиваем кошелёк: ставки и выигрыши приходят pending-ами.
func _wallet_pull() -> void:
	if ui != null and ui.social != null:
		ui.social.pull_wallet()

func on_push(m: Dictionary) -> void:
	if not active:
		return
	var t := String(m.get("t", ""))
	match t:
		"duel.tables":
			duel_tables = m.get("tables", [])
			if not duel_tables.any(func(x: Variant) -> bool: return typeof(x) == TYPE_DICTIONARY and String((x as Dictionary).get("id", "")) == duel_mine):
				duel_mine = ""
			if ui._tab == "games" and hub == "duel":
				ui._rebuild_keep_scroll()
		"duel.result":
			var res: Variant = m.get("res")
			if res != null and typeof(res) == TYPE_DICTIONARY:
				duel_res = res
			duel_mine = ""
			duel_busy = false
			ui._toast("⚔️ Дуэль завершена")
			_wallet_pull()
			if ui._tab == "games" and hub == "duel":
				ui._rebuild()
		"roul.rooms":
			roul_rooms = m.get("rooms", [])
			if ui._tab == "games" and hub == "roul":
				ui._rebuild_keep_scroll()
		"roul.room":
			var room: Variant = m.get("room")
			if room != null and typeof(room) == TYPE_DICTIONARY:
				roul_room = room
				if String(roul_room.get("state", "")) != "bet":
					_roul_clear_bets()
			roul_busy = false
			if String(roul_room.get("state", "")) == "done":
				_wallet_pull()
			if ui._tab == "games" and hub == "roul":
				if String(roul_room.get("state", "")) == "bet":
					ui._rebuild_keep_scroll()
				else:
					ui._rebuild()
		"roul.gone":
			roul_room.clear()
			_roul_clear_bets()
			roul_busy = false
			if ui._tab == "games" and hub == "roul":
				ui._rebuild()
		"card.rooms":
			card_rooms = m.get("rooms", [])
			if ui._tab == "games" and hub == "cards":
				ui._rebuild_keep_scroll()
		"card.room":
			var cr: Variant = m.get("room")
			if cr != null and typeof(cr) == TYPE_DICTIONARY:
				card_room = cr
				if String(card_room.get("state", "")) == "lobby":
					card_state.clear()
					card_sel.clear()
			card_busy = false
			if String(card_room.get("state", "")) == "done":
				_wallet_pull()
			if ui._tab == "games" and hub == "cards":
				if String(card_room.get("state", "")) == "play":
					ui._rebuild_keep_scroll()
				else:
					ui._rebuild()
		"card.state":
			var gs: Variant = m.get("game")
			if gs != null and typeof(gs) == TYPE_DICTIONARY:
				card_state = gs
				card_sel.clear()
				if bool(card_state.get("over", false)):
					_wallet_pull()
			card_busy = false
			if ui._tab == "games" and hub == "cards":
				if bool(card_state.get("over", false)):
					ui._rebuild()
				else:
					ui._rebuild_keep_scroll()
		"card.gone":
			card_room.clear()
			card_state.clear()
			card_sel.clear()
			card_busy = false
			if ui._tab == "games" and hub == "cards":
				ui._rebuild()

# ── общий каркас вкладки ──────────────────────────────────────────────────────
func build(parent: VBoxContainer) -> void:
	parent.add_child(ui._label("🎲 ИГРЫ ОНЛАЙН", 13, ui.GOLD))
	if not active:
		parent.add_child(ui._panel_text("Игры доступны после входа в аккаунт."))
		return
	var tabs: HBoxContainer = ui._row(6)
	for item in [["duel", "⚔️ Дуэли"], ["roul", "🎡 Рулетка"], ["cards", "🃏 Столы"]]:
		var key := String(item[0])
		var b: Button = ui._button(String(item[1]), 12, ui.TEXT)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size = Vector2(0, 38)
		if key == hub:
			var sb: StyleBoxFlat = ui._sbox(ui.GOLD, ui.GOLD_SOFT, 1, 11, true)
			sb.shadow_color = Color(ui.GOLD2, 0.25)
			sb.shadow_size = 8
			sb.shadow_offset = Vector2(0, 2)
			b.add_theme_stylebox_override("normal", sb)
			b.add_theme_stylebox_override("hover", sb)
			for c in ["font_color", "font_hover_color", "font_focus_color", "font_pressed_color"]:
				b.add_theme_color_override(c, Color("221704"))
		else:
			b.add_theme_stylebox_override("normal", ui._sbox(Color(ui.CARD, 0.75), ui.LINE, 1, 11))
			b.add_theme_stylebox_override("hover", ui._sbox(Color(ui.CARD, 0.95), Color(ui.GOLD, 0.4), 1, 11))
			for c in ["font_color", "font_focus_color", "font_pressed_color"]:
				b.add_theme_color_override(c, ui.MUTED)
			b.add_theme_color_override("font_hover_color", ui.GOLD_SOFT)
		b.pressed.connect(_switch_hub.bind(key))
		tabs.add_child(b)
	parent.add_child(tabs)
	_timer_lbl = null
	_timer_at = 0.0
	_roul_cells.clear()
	_roul_chip_btns.clear()
	if hub == "duel":
		_build_duel(parent)
	elif hub == "roul":
		_build_roul(parent)
	else:
		_build_cards(parent)

func _switch_hub(key: String) -> void:
	hub = key
	ui._rebuild()
	if key == "duel":
		_refresh_duel()
	elif key == "roul":
		_refresh_roul()
	else:
		_refresh_cards()

func _set_timer(deadline: float, mode: String, parent: VBoxContainer) -> void:
	_timer_at = deadline / 1000.0 if deadline > 0.0 else 0.0
	_timer_mode = mode
	_timer_lbl = ui._label("", 11.5, ui.GOLD)
	_timer_lbl.clip_text = true
	parent.add_child(_timer_lbl)
	tick(1.0)

# ── дуэли ─────────────────────────────────────────────────────────────────────
func _build_duel(parent: VBoxContainer) -> void:
	if not duel_res.is_empty():
		_build_duel_result(parent)
	parent.add_child(ui._label("1 НА 1 · МОНЕТКА ИЛИ КОСТИ", 11.5, ui.MUTED))
	var card: PanelContainer = ui._card(Color(ui.GOLD, 0.18))
	var v: VBoxContainer = ui._vbox(8)
	v.add_child(ui._label("Создать стол", 13, ui.GOLD))
	var row: HBoxContainer = ui._row(6)
	_duel_game = OptionButton.new()
	_duel_game.add_item("Монетка")
	_duel_game.set_item_metadata(0, "coin")
	_duel_game.add_item("Кости")
	_duel_game.set_item_metadata(1, "dice")
	_duel_game.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_duel_game)
	_duel_bet = LineEdit.new()
	_duel_bet.placeholder_text = "Ставка, напр. 5K"
	_duel_bet.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_duel_bet.mouse_filter = Control.MOUSE_FILTER_PASS
	row.add_child(_duel_bet)
	var mk: Button = ui._button("Создать", 12, ui.GOLD)
	mk.pressed.connect(_create_duel)
	row.add_child(mk)
	v.add_child(row)
	v.add_child(ui._label("Ставка списывается у обоих. Победитель забирает банк; при ничьей — возврат.", 10, ui.MUTED, true))
	card.add_child(v)
	parent.add_child(card)

	if duel_mine != "":
		var mc: PanelContainer = ui._card(Color(ui.GOLD, 0.35), 14)
		var mv: VBoxContainer = ui._vbox(6)
		mv.add_child(ui._label("🪑 Ваш стол ждёт соперника", 12.5, ui.GOLD))
		var cancel: Button = ui._button("Отменить и вернуть ставку", 11, ui.RED)
		cancel.pressed.connect(_cancel_duel)
		mv.add_child(cancel)
		mc.add_child(mv)
		parent.add_child(mc)

	parent.add_child(ui._label("ОТКРЫТЫЕ СТОЛЫ (%d)" % duel_tables.size(), 11.5, ui.GOLD))
	if duel_tables.is_empty():
		parent.add_child(ui._panel_text("Пока никто не ждёт. Создайте стол — соперник найдётся."))
	else:
		for t in duel_tables:
			if typeof(t) != TYPE_DICTIONARY:
				continue
			var d: Dictionary = t
			var tid := String(d.get("id", ""))
			var rowc: PanelContainer = ui._card(Color(ui.LINE, 0.9), 13)
			var rv: VBoxContainer = ui._vbox(5)
			var top: HBoxContainer = ui._row(6)
			var gname := String(DUEL_GAMES.get(String(d.get("game", "coin")), "Игра"))
			top.add_child(ui._label("%s · 🪙 %s" % [gname, VCGame.fmt(float(d.get("bet", 0.0)))], 12.5, ui.TEXT))
			top.add_child(ui._spacer())
			top.add_child(ui._pill("👤 " + String(d.get("owner", "?")), ui.MUTED))
			rv.add_child(top)
			var jb: Button = ui._button("Войти в дуэль", 11.5, ui.GOLD)
			jb.disabled = tid == duel_mine
			jb.pressed.connect(_join_duel.bind(tid))
			rv.add_child(jb)
			rowc.add_child(rv)
			parent.add_child(rowc)
	var rf: Button = ui._button("🔄 Обновить столы", 11, ui.MUTED)
	rf.pressed.connect(_refresh_duel)
	parent.add_child(rf)

func _build_duel_result(parent: VBoxContainer) -> void:
	var won := bool(duel_res.get("youWon", false))
	var push := bool(duel_res.get("push", false))
	var col: Color = ui.GOLD if push else (ui.GREEN if won else ui.RED)
	var c: PanelContainer = ui._card(Color(col, 0.35), 16)
	var v: VBoxContainer = ui._vbox(6)
	var title := "🤝 Ничья" if push else ("🏆 Победа!" if won else "💥 Поражение")
	v.add_child(ui._label(title, 18, col))
	v.add_child(ui._label(String(duel_res.get("reason", "")), 11.5, ui.TEXT, true))
	var row: HBoxContainer = ui._row(8)
	row.add_child(ui._pill("Вы: " + String(duel_res.get("myRoll", "?")), col))
	row.add_child(ui._pill("Соперник: " + String(duel_res.get("oppRoll", "?")), ui.MUTED))
	row.add_child(ui._pill("+🪙 " + VCGame.fmt(float(duel_res.get("payout", 0.0))), ui.GOLD))
	v.add_child(row)
	var close: Button = ui._button("Закрыть", 11.5, ui.MUTED)
	close.pressed.connect(func() -> void:
		duel_res.clear()
		ui._rebuild()
	)
	v.add_child(close)
	c.add_child(v)
	parent.add_child(c)

func _create_duel() -> void:
	if duel_busy:
		return
	var bet := VCSocial.parse_amount(_duel_bet.text if _duel_bet != null else "")
	if bet <= 0.0:
		ui._toast("❌ Введите ставку")
		return
	var g := "coin"
	if _duel_game != null:
		g = String(_duel_game.get_item_metadata(_duel_game.selected))
	duel_busy = true
	var r: Dictionary = await net.request("duel.create", { "game": g, "bet": bet })
	duel_busy = false
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Не удалось создать стол")))
		return
	duel_mine = String(r.get("table", ""))
	ui._toast("⚔️ Стол создан — ждём соперника")
	await _refresh_duel()

func _cancel_duel() -> void:
	var r: Dictionary = await net.request("duel.cancel", {})
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Ошибка")))
		return
	duel_mine = ""
	ui._toast("↩️ Ставка вернётся в кошелёк")
	await _refresh_duel()

func _join_duel(tid: String) -> void:
	if duel_busy or tid == "":
		return
	duel_busy = true
	var r: Dictionary = await net.request("duel.join", { "table": tid })
	duel_busy = false
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Не удалось войти")))
		await _refresh_duel()

# ── рулетка ───────────────────────────────────────────────────────────────────
func _build_roul(parent: VBoxContainer) -> void:
	if roul_room.is_empty():
		_build_roul_lobby(parent)
		return
	var state := String(roul_room.get("state", "lobby"))
	if state == "done":
		_build_roul_result(parent)
		return
	var info: PanelContainer = ui._card(Color(ui.GOLD, 0.2), 14)
	var iv: VBoxContainer = ui._vbox(5)
	iv.add_child(ui._label("🎡 Стол на %d · ставка 🪙 %s" % [int(roul_room.get("max", 2)), VCGame.fmt(float(roul_room.get("bet", 0.0)))], 12.5, ui.GOLD))
	var players: Array = roul_room.get("players", [])
	var prow := GridContainer.new()
	prow.columns = 2
	prow.add_theme_constant_override("h_separation", 5)
	prow.add_theme_constant_override("v_separation", 5)
	prow.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for p in players:
		if typeof(p) != TYPE_DICTIONARY:
			continue
		var pd: Dictionary = p
		var label := String(pd.get("name", "?"))
		if bool(pd.get("ready", false)):
			label += " ✅"
		prow.add_child(ui._pill(label, ui.GREEN if bool(pd.get("ready", false)) else ui.MUTED))
	iv.add_child(prow)
	info.add_child(iv)
	parent.add_child(info)
	if state == "lobby":
		if bool((roul_room.get("you", {}) as Dictionary).get("name", "") == roul_room.get("owner", "")):
			var st: Button = ui._button("Начать игру (минимум 2)", 12, ui.GOLD)
			st.pressed.connect(_start_roul)
			parent.add_child(st)
		else:
			parent.add_child(ui._label("Ждём, когда создатель начнёт игру…", 11, ui.MUTED))
		var lv: Button = ui._button("Выйти из стола", 11, ui.RED)
		lv.pressed.connect(_leave_roul)
		parent.add_child(lv)
		return
	# state == bet
	var you: Dictionary = roul_room.get("you", {})
	if bool(you.get("ready", false)):
		parent.add_child(ui._label("✅ Ставки сделаны — ждём остальных. Колесо решит всё.", 11.5, ui.GREEN, true))
		_set_timer(float(roul_room.get("deadline", 0.0)), "roul", parent)
		var lv2: Button = ui._button("Выйти из стола (ставка вернётся)", 11, ui.RED)
		lv2.pressed.connect(_leave_roul)
		parent.add_child(lv2)
		return
	parent.add_child(ui._label("Расставьте фишки ровно на 🪙 %s. Нажмите на поле, чтобы добавить фишку." % VCGame.fmt(float(roul_room.get("bet", 0.0))), 10.5, ui.MUTED, true))
	_set_timer(float(roul_room.get("deadline", 0.0)), "roul", parent)
	var chips: HBoxContainer = ui._row(5)
	var ci := 0
	for val in ROUL_CHIPS:
		var cb: Button = ui._button(VCGame.fmt(float(val)), 10, ui.TEXT)
		cb.custom_minimum_size = Vector2(0, 30)
		cb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		if val == roul_chip:
			var sb: StyleBoxFlat = ui._sbox(Color(ui.GOLD, 0.85), ui.GOLD_SOFT, 1, 8)
			cb.add_theme_stylebox_override("normal", sb)
			cb.add_theme_color_override("font_color", Color("221704"))
		cb.pressed.connect(_pick_chip.bind(val))
		chips.add_child(cb)
		_roul_chip_btns[val] = cb
		ci += 1
	parent.add_child(chips)
	_roul_total_lbl = ui._label("", 11.5, ui.GOLD)
	parent.add_child(_roul_total_lbl)
	_build_roul_board(parent)
	_roul_ready_btn = ui._button("✅ Готово — крутить колесо", 13, ui.GOLD)
	_roul_ready_btn.pressed.connect(_ready_roul)
	parent.add_child(_roul_ready_btn)
	var undorow: HBoxContainer = ui._row(6)
	var undo: Button = ui._button("↩️ Снять фишку", 10.5, ui.TEXT)
	undo.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	undo.pressed.connect(_roul_undo)
	undorow.add_child(undo)
	var reset: Button = ui._button("🗑 Сбросить", 10.5, ui.MUTED)
	reset.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	reset.pressed.connect(_clear_roul_bets)
	undorow.add_child(reset)
	parent.add_child(undorow)
	_roul_refresh_bets()

func _build_roul_lobby(parent: VBoxContainer) -> void:
	var c: PanelContainer = ui._card(Color(ui.GOLD, 0.18))
	var v: VBoxContainer = ui._vbox(8)
	v.add_child(ui._label("Создать стол", 13, ui.GOLD))
	var row: HBoxContainer = ui._row(6)
	_roul_bet = LineEdit.new()
	_roul_bet.placeholder_text = "Ставка, напр. 10K"
	_roul_bet.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_roul_bet.mouse_filter = Control.MOUSE_FILTER_PASS
	row.add_child(_roul_bet)
	_roul_max = OptionButton.new()
	for n in [2, 3, 4]:
		_roul_max.add_item("%d игрока" % n)
		_roul_max.set_item_metadata(n - 2, n)
	_roul_max.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_roul_max)
	var mk: Button = ui._button("Создать", 12, ui.GOLD)
	mk.pressed.connect(_create_roul)
	row.add_child(mk)
	v.add_child(row)
	v.add_child(ui._label("Каждый ставит фишки на всю ставку стола. Колесо крутится один раз: банк забирает тот, чей расклад выиграл больше.", 10, ui.MUTED, true))
	c.add_child(v)
	parent.add_child(c)
	parent.add_child(ui._label("ОТКРЫТЫЕ СТОЛЫ (%d)" % roul_rooms.size(), 11.5, ui.GOLD))
	if roul_rooms.is_empty():
		parent.add_child(ui._panel_text("Пока нет столов. Создайте свой!"))
	else:
		for r in roul_rooms:
			if typeof(r) != TYPE_DICTIONARY:
				continue
			var rd: Dictionary = r
			var rid := String(rd.get("id", ""))
			var rc: PanelContainer = ui._card(Color(ui.LINE, 0.9), 13)
			var rv: VBoxContainer = ui._vbox(5)
			rv.add_child(ui._label("🎡 %d игрока · 🪙 %s · %d/%d" % [int(rd.get("max", 2)), VCGame.fmt(float(rd.get("bet", 0.0))), int(rd.get("players", 0)), int(rd.get("max", 2))], 12, ui.TEXT))
			var row2: HBoxContainer = ui._row(6)
			row2.add_child(ui._pill("👤 " + String(rd.get("owner", "?")), ui.MUTED))
			var jb: Button = ui._button("Сесть за стол", 11, ui.GOLD)
			jb.pressed.connect(_join_roul.bind(rid))
			row2.add_child(jb)
			rv.add_child(row2)
			rc.add_child(rv)
			parent.add_child(rc)
	var rf: Button = ui._button("🔄 Обновить столы", 11, ui.MUTED)
	rf.pressed.connect(_refresh_roul)
	parent.add_child(rf)

func _create_roul() -> void:
	if roul_busy:
		return
	var bet := VCSocial.parse_amount(_roul_bet.text if _roul_bet != null else "")
	if bet <= 0.0:
		ui._toast("❌ Введите ставку")
		return
	var mx := 2
	if _roul_max != null:
		mx = int(_roul_max.get_item_metadata(_roul_max.selected))
	roul_busy = true
	var r: Dictionary = await net.request("roul.create", { "bet": bet, "max": mx })
	roul_busy = false
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Не удалось создать стол")))
		return
	var room: Variant = r.get("room")
	if room != null and typeof(room) == TYPE_DICTIONARY:
		roul_room = room
	ui._toast("🎡 Стол создан")
	await _refresh_roul()

func _join_roul(rid: String) -> void:
	if roul_busy:
		return
	roul_busy = true
	var r: Dictionary = await net.request("roul.join", { "room": rid })
	roul_busy = false
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Не удалось сесть")))
		await _refresh_roul()
		return
	var room: Variant = r.get("room")
	if room != null and typeof(room) == TYPE_DICTIONARY:
		roul_room = room
	await _refresh_roul()

func _leave_roul() -> void:
	var r: Dictionary = await net.request("roul.leave", {})
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Ошибка")))
		return
	roul_room.clear()
	_roul_clear_bets()
	ui._toast("👋 Вы вышли из-за стола")
	await _refresh_roul()

func _start_roul() -> void:
	if roul_busy:
		return
	roul_busy = true
	var r: Dictionary = await net.request("roul.start", {})
	roul_busy = false
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Не удалось начать")))
		return
	var room: Variant = r.get("room")
	if room != null and typeof(room) == TYPE_DICTIONARY:
		roul_room = room
	await _refresh_roul()

func _pick_chip(val: int) -> void:
	roul_chip = val
	for k in _roul_chip_btns:
		var b: Button = _roul_chip_btns[k]
		if not is_instance_valid(b):
			continue
		if int(k) == val:
			b.add_theme_stylebox_override("normal", ui._sbox(Color(ui.GOLD, 0.85), ui.GOLD_SOFT, 1, 8))
			b.add_theme_color_override("font_color", Color("221704"))
		else:
			b.add_theme_stylebox_override("normal", ui._sbox(Color(ui.CARD, 0.8), ui.LINE, 1, 8))
			b.add_theme_color_override("font_color", ui.TEXT)

func _roul_stake_total() -> float:
	var s := 0.0
	for k in roul_bets:
		s += float(roul_bets[k])
	return s

func _roul_add(id: String) -> void:
	var stake := float(roul_room.get("bet", 0.0))
	var left := stake - _roul_stake_total()
	if left <= 0.0:
		ui._toast("Ставка уже разложена полностью")
		return
	var add := minf(float(roul_chip), left)
	roul_bets[id] = float(roul_bets.get(id, 0.0)) + add
	roul_stack.append({ "id": id, "amount": add })
	_roul_refresh_bets()

## Снимает последнюю поставленную фишку (даже если она легла на занятое поле).
func _roul_undo() -> void:
	if roul_stack.is_empty():
		ui._toast("Сначала поставьте фишку")
		return
	var last: Dictionary = roul_stack.pop_back()
	var id := String(last.get("id", ""))
	var amt := float(last.get("amount", 0.0))
	var cur := float(roul_bets.get(id, 0.0)) - amt
	if cur <= 0.5:
		roul_bets.erase(id)
	else:
		roul_bets[id] = cur
	_roul_refresh_bets()

func _roul_clear_bets() -> void:
	roul_bets.clear()
	roul_stack.clear()

func _clear_roul_bets() -> void:
	_roul_clear_bets()
	_roul_refresh_bets()

func _roul_refresh_bets() -> void:
	var stake := float(roul_room.get("bet", 0.0))
	var total := _roul_stake_total()
	if _roul_total_lbl != null and is_instance_valid(_roul_total_lbl):
		var left := stake - total
		_roul_total_lbl.text = "Разложено 🪙 %s из 🪙 %s · осталось 🪙 %s" % [VCGame.fmt(total), VCGame.fmt(stake), VCGame.fmt(maxf(0.0, left))]
		_roul_total_lbl.add_theme_color_override("font_color", ui.GREEN if left <= 0.0 else ui.GOLD)
	if _roul_ready_btn != null and is_instance_valid(_roul_ready_btn):
		_roul_ready_btn.disabled = absf(total - stake) > 0.5
	for id in _roul_cells:
		var b: Button = _roul_cells[id]
		if not is_instance_valid(b):
			continue
		var base := String(b.get_meta("base", b.text))
		var amt := float(roul_bets.get(id, 0.0))
		b.text = base + (" •" if amt > 0.0 else "")

func _build_roul_board(parent: VBoxContainer) -> void:
	var cap: HBoxContainer = ui._row(3)
	cap.add_child(ui._label("ЧИСЛА", 10, ui.MUTED))
	cap.add_child(ui._spacer())
	cap.add_child(ui._label("нажмите: +фишка · «Снять» убирает последнюю", 9, ui.MUTED))
	parent.add_child(cap)
	var grid := GridContainer.new()
	grid.columns = 6
	grid.add_theme_constant_override("h_separation", 3)
	grid.add_theme_constant_override("v_separation", 3)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for n in 37:
		var b: Button = ui._button(str(n), 11, ui.TEXT)
		b.custom_minimum_size = Vector2(0, 34)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var bg: Color = Color("1b9a55") if n == 0 else (Color("7d1f2b") if n in RED_NUMS else Color("161b26"))
		b.add_theme_stylebox_override("normal", ui._sbox(bg, Color(bg, 0.9).lightened(0.25), 1, 7))
		b.add_theme_stylebox_override("hover", ui._sbox(bg.lightened(0.12), ui.GOLD, 1, 7))
		b.set_meta("base", str(n))
		b.pressed.connect(_roul_cell_pressed.bind("n:" + str(n), b))
		grid.add_child(b)
		_roul_cells["n:" + str(n)] = b
	parent.add_child(grid)
	var out := GridContainer.new()
	out.columns = 4
	out.add_theme_constant_override("h_separation", 3)
	out.add_theme_constant_override("v_separation", 3)
	out.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var out_defs := [
		["d:1", "1-12", "12"], ["d:2", "13-24", "12"], ["d:3", "25-36", "12"],
		["k:1", "Кол. 1", "12"], ["k:2", "Кол. 2", "12"], ["k:3", "Кол. 3", "12"],
		["red", "🔴 Красное", "2"], ["black", "⚫ Чёрное", "2"],
		["even", "Чёт", "2"], ["odd", "Нечет", "2"],
		["low", "1-18", "2"], ["high", "19-36", "2"],
	]
	for def in out_defs:
		var b: Button = ui._button(String(def[1]), 9, ui.TEXT)
		b.custom_minimum_size = Vector2(0, 34)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var bg2 := Color("7d1f2b") if String(def[0]) == "red" else (Color("161b26") if String(def[0]) == "black" else Color("222a3d"))
		b.add_theme_stylebox_override("normal", ui._sbox(bg2, Color(bg2, 0.9).lightened(0.25), 1, 7))
		b.add_theme_stylebox_override("hover", ui._sbox(bg2.lightened(0.12), ui.GOLD, 1, 7))
		b.set_meta("base", String(def[1]))
		b.pressed.connect(_roul_cell_pressed.bind(String(def[0]), b))
		out.add_child(b)
		_roul_cells[String(def[0])] = b
	parent.add_child(out)

func _roul_cell_pressed(id: String, _b: Button) -> void:
	_roul_add(id)

func _ready_roul() -> void:
	if roul_busy:
		return
	var stake := float(roul_room.get("bet", 0.0))
	if absf(_roul_stake_total() - stake) > 0.5:
		ui._toast("Разложите ровно всю ставку")
		return
	var arr: Array = []
	for k in roul_bets:
		arr.append({ "id": String(k), "amount": int(round(float(roul_bets[k]))) })
	roul_busy = true
	var r: Dictionary = await net.request("roul.bets", { "bets": arr })
	roul_busy = false
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Ставки не приняты")))
		return
	var room: Variant = r.get("room")
	if room != null and typeof(room) == TYPE_DICTIONARY:
		roul_room = room
	ui._toast("✅ Ставки приняты")
	await _refresh_roul()

func _build_roul_result(parent: VBoxContainer) -> void:
	var num := int(roul_room.get("num", -1))
	var colname := String(roul_room.get("color", "black"))
	var col: Color = Color("1b9a55") if colname == "green" else (Color("d83a4a") if colname == "red" else Color("222a3d"))
	var c: PanelContainer = ui._card(Color(col, 0.8), 18)
	var v: VBoxContainer = ui._vbox(7)
	v.add_child(ui._label("ВЫПАЛО", 11, ui.MUTED))
	v.add_child(ui._label(str(num), 46, ui.TEXT if colname != "red" else Color("ffe3e6")))
	v.add_child(ui._label("Красное" if colname == "red" else ("Зелёное" if colname == "green" else "Чёрное"), 12, ui.GOLD))
	var you: Dictionary = roul_room.get("you", {})
	var payout := float(you.get("payout", 0.0))
	var netv := payout - float(roul_room.get("bet", 0.0))
	var title := "🤝 Ничья — ставка вернулась" if absf(netv) < 0.5 else ("🏆 Вы выиграли 🪙 " + VCGame.fmt(netv) if netv > 0.0 else "💥 Вы проиграли 🪙 " + VCGame.fmt(-netv))
	v.add_child(ui._label(title, 15, ui.GREEN if netv > 0.0 else (ui.RED if netv < 0.0 else ui.GOLD)))
	v.add_child(ui._label("Выплата: 🪙 %s · ваша ставка: 🪙 %s" % [VCGame.fmt(payout), VCGame.fmt(float(roul_room.get("bet", 0.0)))], 10.5, ui.MUTED))
	var bets: Array = you.get("bets", [])
	if not bets.is_empty():
		var bl: Array[String] = []
		for b in bets:
			if typeof(b) == TYPE_DICTIONARY:
				bl.append("%s × %s" % [String((b as Dictionary).get("id", "?")), VCGame.fmt(float((b as Dictionary).get("amount", 0.0)))])
		v.add_child(ui._label("Ставки: " + ", ".join(bl), 10, ui.MUTED, true))
	var plist: Array = roul_room.get("players", [])
	var prow := GridContainer.new()
	prow.columns = 2
	prow.add_theme_constant_override("h_separation", 5)
	prow.add_theme_constant_override("v_separation", 5)
	prow.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for p in plist:
		if typeof(p) != TYPE_DICTIONARY:
			continue
		var pd: Dictionary = p
		var pn := float(pd.get("payout", 0.0)) - float(roul_room.get("bet", 0.0))
		prow.add_child(ui._pill("%s: %s" % [String(pd.get("name", "?")), ("+" if pn > 0.0 else "") + VCGame.fmt(pn)], ui.GREEN if pn > 0.0 else (ui.RED if pn < 0.0 else ui.MUTED)))
	v.add_child(prow)
	var close: Button = ui._button("Вернуться в лобби", 12, ui.GOLD)
	close.pressed.connect(func() -> void:
		roul_room.clear()
		_roul_clear_bets()
		_refresh_roul()
	)
	v.add_child(close)
	c.add_child(v)
	parent.add_child(c)

# ── карточные столы: лобби ────────────────────────────────────────────────────
func _card_def(key: String) -> Dictionary:
	for g in card_games:
		if typeof(g) == TYPE_DICTIONARY and String((g as Dictionary).get("key", "")) == key:
			return g
	for g in CARD_FALLBACK:
		if String(g.get("key", "")) == key:
			return g
	return CARD_FALLBACK[0]

func _build_cards(parent: VBoxContainer) -> void:
	if card_room.is_empty():
		_build_cards_lobby(parent)
		return
	if String(card_room.get("state", "lobby")) == "lobby":
		_build_card_room_lobby(parent)
	else:
		_build_card_play(parent)

func _build_cards_lobby(parent: VBoxContainer) -> void:
	parent.add_child(ui._label("СТОЛЫ С КАРТАМИ", 11.5, ui.MUTED))
	var c: PanelContainer = ui._card(Color(ui.GOLD, 0.18))
	var v: VBoxContainer = ui._vbox(8)
	v.add_child(ui._label("Создать стол", 13, ui.GOLD))
	var gs: OptionButton = OptionButton.new()
	var sel := 0
	for i in CARD_FALLBACK.size():
		var gd: Dictionary = _card_def(String(CARD_FALLBACK[i].get("key", "bj")))
		gs.add_item(String(gd.get("title", CARD_FALLBACK[i].get("title", "Игра"))))
		gs.set_item_metadata(i, String(gd.get("key", "bj")))
		if String(gd.get("key", "bj")) == card_game_key:
			sel = i
	gs.selected = sel
	gs.item_selected.connect(_on_card_game_changed.bind(gs))
	v.add_child(gs)

	var row: HBoxContainer = ui._row(6)
	_card_bet = LineEdit.new()
	_card_bet.placeholder_text = "Ставка, напр. 10K"
	_card_bet.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_card_bet.mouse_filter = Control.MOUSE_FILTER_PASS
	row.add_child(_card_bet)
	_card_max = OptionButton.new()
	_card_max.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_card_max)
	v.add_child(row)

	var row2: HBoxContainer = ui._row(6)
	_card_timer = OptionButton.new()
	_card_timer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var tl: Array = card_timers if not card_timers.is_empty() else [
		{ "ms": 15000, "label": "15 сек" }, { "ms": 30000, "label": "30 сек" },
		{ "ms": 60000, "label": "60 сек" }, { "ms": 120000, "label": "120 сек" },
		{ "ms": 0, "label": "без таймера" },
	]
	var ti := 2
	for i in tl.size():
		var td: Dictionary = tl[i]
		_card_timer.add_item(String(td.get("label", "60 сек")))
		_card_timer.set_item_metadata(i, int(td.get("ms", 60000)))
		if int(td.get("ms", 60000)) == 60000:
			ti = i
	_card_timer.selected = ti
	row2.add_child(_card_timer)
	v.add_child(row2)

	var durak_box: VBoxContainer = ui._vbox(4)
	var dr: HBoxContainer = ui._row(6)
	_card_deck = OptionButton.new()
	_card_deck.add_item("Колода 36")
	_card_deck.set_item_metadata(0, 36)
	_card_deck.add_item("Колода 52")
	_card_deck.set_item_metadata(1, 52)
	_card_deck.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	dr.add_child(_card_deck)
	_card_transfer = CheckBox.new()
	_card_transfer.text = "Переводной"
	_card_transfer.button_pressed = true
	_card_transfer.add_theme_font_size_override("font_size", 10)
	dr.add_child(_card_transfer)
	_card_toend = CheckBox.new()
	_card_toend.text = "До конца"
	_card_toend.button_pressed = true
	_card_toend.add_theme_font_size_override("font_size", 10)
	dr.add_child(_card_toend)
	durak_box.add_child(dr)
	durak_box.visible = card_game_key == "durak"
	v.add_child(durak_box)
	_fill_card_max(gs, _card_max)
	gs.set_meta("durak_box", durak_box)
	gs.set_meta("max_opt", _card_max)

	var mk: Button = ui._button("Создать стол", 13, ui.GOLD)
	mk.pressed.connect(_create_card)
	v.add_child(mk)
	v.add_child(ui._label("Выход из идущей партии = сдаться: ставка уходит остальным.", 10, ui.MUTED, true))
	c.add_child(v)
	parent.add_child(c)

	parent.add_child(ui._label("ОТКРЫТЫЕ СТОЛЫ (%d)" % card_rooms.size(), 11.5, ui.GOLD))
	if card_rooms.is_empty():
		parent.add_child(ui._panel_text("Пока нет столов. Создайте первый!"))
	else:
		for r in card_rooms:
			if typeof(r) != TYPE_DICTIONARY:
				continue
			var rd: Dictionary = r
			var rid := String(rd.get("id", ""))
			var rc: PanelContainer = ui._card(Color(ui.LINE, 0.9), 13)
			var rv: VBoxContainer = ui._vbox(5)
			var top: HBoxContainer = ui._row(6)
			top.add_child(ui._label(String(rd.get("title", "Стол")), 13, ui.TEXT))
			top.add_child(ui._spacer())
			top.add_child(ui._pill("🪙 " + VCGame.fmt(float(rd.get("bet", 0.0))), ui.GOLD))
			rv.add_child(top)
			var sub := "Игроков: %d/%d · владелец %s" % [int(rd.get("players", 0)), int(rd.get("max", 2)), String(rd.get("owner", "?"))]
			rv.add_child(ui._label(sub, 10, ui.MUTED))
			if String(rd.get("game", "")) == "durak":
				var o: Dictionary = rd.get("opts", {})
				rv.add_child(ui._label("Колода %d · перевод %s · до конца %s" % [
					int(o.get("deck", 36)),
					"вкл" if bool(o.get("transfer", true)) else "выкл",
					"вкл" if bool(o.get("toEnd", true)) else "выкл",
				], 9.5, ui.MUTED))
			var jb: Button = ui._button("Сесть за стол", 11, ui.GOLD)
			jb.pressed.connect(_join_card.bind(rid))
			rv.add_child(jb)
			rc.add_child(rv)
			parent.add_child(rc)
	var rf: Button = ui._button("🔄 Обновить столы", 11, ui.MUTED)
	rf.pressed.connect(_refresh_cards)
	parent.add_child(rf)

func _on_card_game_changed(idx: int, gs: OptionButton) -> void:
	card_game_key = String(gs.get_item_metadata(idx))
	var box: Variant = gs.get_meta("durak_box", null)
	if box != null and is_instance_valid(box as Node):
		(box as Node).visible = card_game_key == "durak"
	var mo: Variant = gs.get_meta("max_opt", null)
	if mo != null and is_instance_valid(mo as OptionButton):
		_fill_card_max(gs, mo as OptionButton)

func _fill_card_max(gs: OptionButton, max_opt: OptionButton) -> void:
	var gd: Dictionary = _card_def(String(gs.get_item_metadata(gs.selected)))
	var mn := int(gd.get("min", 2))
	var mx := int(gd.get("max", 4))
	max_opt.clear()
	for n in range(mn, mx + 1):
		max_opt.add_item("%d игрока" % n)
		max_opt.set_item_metadata(n - mn, n)
	max_opt.selected = 0

func _create_card() -> void:
	if card_busy:
		return
	var bet := VCSocial.parse_amount(_card_bet.text if _card_bet != null else "")
	if bet <= 0.0:
		ui._toast("❌ Введите ставку")
		return
	var mx := 2
	if _card_max != null and _card_max.selected >= 0:
		mx = int(_card_max.get_item_metadata(_card_max.selected))
	var ms := 60000
	if _card_timer != null and _card_timer.selected >= 0:
		ms = int(_card_timer.get_item_metadata(_card_timer.selected))
	var opts := {}
	if card_game_key == "durak":
		opts = {
			"deck": int(_card_deck.get_item_metadata(_card_deck.selected)) if _card_deck != null else 36,
			"transfer": _card_transfer.button_pressed if _card_transfer != null else true,
			"toEnd": _card_toend.button_pressed if _card_toend != null else true,
		}
	card_busy = true
	var r: Dictionary = await net.request("card.create", { "game": card_game_key, "bet": bet, "max": mx, "opts": opts, "turnMs": ms })
	card_busy = false
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Не удалось создать стол")))
		return
	var room: Variant = r.get("room")
	if room != null and typeof(room) == TYPE_DICTIONARY:
		card_room = room
	ui._toast("🃏 Стол создан")
	await _refresh_cards()

func _join_card(rid: String) -> void:
	if card_busy:
		return
	card_busy = true
	var r: Dictionary = await net.request("card.join", { "room": rid })
	card_busy = false
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Не удалось сесть")))
		await _refresh_cards()
		return
	var room: Variant = r.get("room")
	if room != null and typeof(room) == TYPE_DICTIONARY:
		card_room = room
	await _refresh_cards()

func _leave_card() -> void:
	var r: Dictionary = await net.request("card.leave", {})
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Ошибка")))
		return
	card_room.clear()
	card_state.clear()
	card_sel.clear()
	ui._toast("👋 Вы вышли из-за стола")
	await _refresh_cards()

func _start_card() -> void:
	if card_busy:
		return
	card_busy = true
	var r: Dictionary = await net.request("card.start", {})
	card_busy = false
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Не удалось начать")))
		return
	var room: Variant = r.get("room")
	if room != null and typeof(room) == TYPE_DICTIONARY:
		card_room = room
	await _refresh_cards()

func _build_card_room_lobby(parent: VBoxContainer) -> void:
	var c: PanelContainer = ui._card(Color(ui.GOLD, 0.25), 16)
	var v: VBoxContainer = ui._vbox(7)
	v.add_child(ui._label("🃏 " + String(card_room.get("title", "Стол")), 18, ui.GOLD))
	v.add_child(ui._label("Ставка 🪙 %s · банк 🪙 %s · до %d игроков" % [
		VCGame.fmt(float(card_room.get("bet", 0.0))),
		VCGame.fmt(float(card_room.get("bet", 0.0)) * float((card_room.get("players", []) as Array).size())),
		int(card_room.get("max", 2)),
	], 11, ui.MUTED))
	if String(card_room.get("game", "")) == "durak":
		var o: Dictionary = card_room.get("opts", {})
		v.add_child(ui._label("Колода %d · перевод %s · до конца %s" % [
			int(o.get("deck", 36)),
			"вкл" if bool(o.get("transfer", true)) else "выкл",
			"вкл" if bool(o.get("toEnd", true)) else "выкл",
		], 10, ui.MUTED))
	var players: Array = card_room.get("players", [])
	v.add_child(ui._label("ИГРОКИ (%d/%d)" % [players.size(), int(card_room.get("max", 2))], 11, ui.GOLD))
	for p in players:
		if typeof(p) != TYPE_DICTIONARY:
			continue
		var pd: Dictionary = p
		var line := "👤 " + String(pd.get("name", "?"))
		if bool(pd.get("owner", false)):
			line += " · создатель"
		if not bool(pd.get("online", true)):
			line += " · офлайн"
		if bool(pd.get("gone", false)):
			line += " · вышел"
		v.add_child(ui._label(line, 11.5, ui.TEXT))
	var you: Dictionary = card_room.get("you", {})
	var owner := bool(you.get("owner", false))
	var gd: Dictionary = _card_def(String(card_room.get("game", "")))
	var need := int(gd.get("min", 2))
	if owner:
		var st: Button = ui._button("Начать игру", 13, ui.GOLD)
		st.disabled = players.size() < need
		st.pressed.connect(_start_card)
		v.add_child(st)
		if players.size() < need:
			v.add_child(ui._label("Нужно минимум %d игрока" % need, 10, ui.MUTED))
	else:
		v.add_child(ui._label("Ждём, когда создатель начнёт игру…", 11, ui.MUTED))
	var lv: Button = ui._button("Выйти из-за стола", 11, ui.RED)
	lv.pressed.connect(_leave_card)
	v.add_child(lv)
	c.add_child(v)
	parent.add_child(c)

func _build_card_play(parent: VBoxContainer) -> void:
	if card_state.is_empty():
		parent.add_child(ui._panel_text("Ждём раздачу…"))
		_build_card_leave(parent, false)
		return
	var v: Dictionary = card_state
	var over := bool(v.get("over", false))
	var head: PanelContainer = ui._card(Color(ui.GOLD, 0.22), 14)
	var hv: VBoxContainer = ui._vbox(5)
	var top: HBoxContainer = ui._row(6)
	top.add_child(ui._label("🃏 " + String(v.get("title", "Игра")), 15, ui.GOLD))
	top.add_child(ui._spacer())
	top.add_child(ui._pill("банк 🪙 " + VCGame.fmt(float(v.get("pot", 0.0))), ui.GOLD))
	hv.add_child(top)
	var turn := int(v.get("turn", -1))
	var names: Array = v.get("names", [])
	var turn_txt := "—"
	if turn >= 0 and turn < names.size():
		turn_txt = String(names[turn]) + (" (вы)" if turn == int(v.get("you", -1)) else "")
	hv.add_child(ui._label("Ставка 🪙 %s · ход: %s" % [VCGame.fmt(float(v.get("stake", 0.0))), turn_txt], 11, ui.MUTED))
	if not over:
		_set_timer(float(v.get("deadline", 0.0)), "card", hv)
	head.add_child(hv)
	parent.add_child(head)
	if over:
		_build_card_money(parent, v)
	var game_key := String(v.get("game", ""))
	match game_key:
		"bj": _build_bj(parent, v)
		"war": _build_war(parent, v)
		"cheat": _build_cheat(parent, v)
		"durak": _build_durak(parent, v)
		"poker": _build_poker(parent, v)
		_: parent.add_child(ui._panel_text("Неизвестная игра: " + game_key))
	_build_card_log(parent, v)
	if not over:
		_build_card_leave(parent, true)
	else:
		var close: Button = ui._button("Закрыть стол", 12, ui.GOLD)
		close.pressed.connect(func() -> void:
			card_room.clear()
			card_state.clear()
			card_sel.clear()
			await _refresh_cards()
		)
		parent.add_child(close)

func _build_card_money(parent: VBoxContainer, v: Dictionary) -> void:
	var money: Variant = v.get("money")
	if money == null or typeof(money) != TYPE_ARRAY:
		return
	var arr: Array = money
	if arr.is_empty():
		return
	var names: Array = v.get("names", [])
	var you := int(v.get("you", -1))
	var bet := float(v.get("stake", 0.0))
	var c: PanelContainer = ui._card(Color(ui.GREEN, 0.28), 14)
	var vv: VBoxContainer = ui._vbox(4)
	vv.add_child(ui._label("ИТОГИ ПАРТИИ", 11, ui.GOLD))
	for i in arr.size():
		var amount := float(arr[i])
		var net := amount - bet
		var nm := String(names[i]) if i < names.size() else ("Игрок %d" % (i + 1))
		if i == you:
			nm += " (вы)"
		var col: Color = ui.GREEN if net > 0.0 else (ui.RED if net < 0.0 else ui.MUTED)
		var line := "%s: 🪙 %s (%s%s)" % [nm, VCGame.fmt(amount), "+" if net > 0.0 else "", VCGame.fmt(net)]
		vv.add_child(ui._label(line, 11, col))
	if String(v.get("forfeit", "")) != "":
		vv.add_child(ui._label("Вышел: " + String(v.get("forfeit", "")), 10, ui.RED))
	c.add_child(vv)
	parent.add_child(c)

func _build_card_log(parent: VBoxContainer, v: Dictionary) -> void:
	var log: Array = v.get("log", [])
	if log.is_empty():
		return
	var c: PanelContainer = ui._card(Color(ui.LINE, 0.75), 12)
	var vv: VBoxContainer = ui._vbox(2)
	vv.add_child(ui._label("ПРОТОКОЛ", 9.5, ui.MUTED))
	var start := maxi(0, log.size() - 7)
	for i in range(start, log.size()):
		vv.add_child(ui._label("· " + String(log[i]), 9.5, ui.MUTED, true))
	c.add_child(vv)
	parent.add_child(c)

func _build_card_leave(parent: VBoxContainer, playing: bool) -> void:
	var lv: Button = ui._button("🚪 Выйти (сдаться)" if playing else "🚪 Выйти", 10.5, ui.RED)
	lv.pressed.connect(func() -> void:
		if playing:
			ui._modal("Выйти из партии?", "Раунд сразу закончится: ваша ставка достанется остальным.", [
				{ "label": "Остаться", "color": ui.TEXT, "cb": Callable() },
				{ "label": "Выйти", "color": ui.RED, "cb": _leave_card },
			])
		else:
			_leave_card()
	)
	parent.add_child(lv)

# ── карточные столы: вид карт ─────────────────────────────────────────────────
func _card_face(code: Dictionary, w := 34, h := 48) -> Control:
	var p := PanelContainer.new()
	p.custom_minimum_size = Vector2(w, h)
	p.add_theme_stylebox_override("panel", ui._sbox(Color("f6f1e6"), Color("c8bfae"), 1, 6))
	p.mouse_filter = Control.MOUSE_FILTER_PASS
	var r := String(code.get("r", "?"))
	var s := String(code.get("s", ""))
	var l: Label = ui._label(r + s, 13, SUIT_COLORS.get(s, ui.TEXT))
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	p.add_child(l)
	return p

func _card_back(w := 34, h := 48) -> Control:
	var p := PanelContainer.new()
	p.custom_minimum_size = Vector2(w, h)
	p.add_theme_stylebox_override("panel", ui._sbox(Color("243252"), Color("3b4d78"), 1, 6))
	p.mouse_filter = Control.MOUSE_FILTER_PASS
	var l: Label = ui._label("✦", 12, Color("7188bb"))
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	p.add_child(l)
	return p

func _card_button(code: Dictionary, idx: int, selected: bool, on_toggle: Callable) -> Button:
	var b: Button = ui._button("", 13, ui.TEXT)
	b.custom_minimum_size = Vector2(38, 52)
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	var r := String(code.get("r", "?"))
	var s := String(code.get("s", ""))
	b.text = r + s
	b.add_theme_color_override("font_color", SUIT_COLORS.get(s, ui.TEXT))
	b.add_theme_color_override("font_hover_color", SUIT_COLORS.get(s, ui.TEXT))
	b.add_theme_color_override("font_pressed_color", SUIT_COLORS.get(s, ui.TEXT))
	b.add_theme_color_override("font_focus_color", SUIT_COLORS.get(s, ui.TEXT))
	var border: Color = ui.GOLD if selected else Color("c8bfae")
	var bg: Color = Color("fff4c7") if selected else Color("f6f1e6")
	b.add_theme_stylebox_override("normal", ui._sbox(bg, border, 2 if selected else 1, 6))
	b.add_theme_stylebox_override("hover", ui._sbox(Color("fff9de"), ui.GOLD, 1, 6))
	b.add_theme_stylebox_override("pressed", ui._sbox(Color("ffe9a8"), ui.GOLD, 2, 6))
	b.toggle_mode = true
	b.button_pressed = selected
	b.toggled.connect(func(on: bool) -> void: on_toggle.call(on, idx, b))
	return b

func _hand_row(cards: Array, selectable: bool) -> Control:
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 4)
	row.add_theme_constant_override("v_separation", 4)
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if cards.is_empty():
		row.add_child(ui._label("нет карт", 10, ui.MUTED))
		return row
	for i in cards.size():
		if typeof(cards[i]) != TYPE_DICTIONARY:
			continue
		var cd: Dictionary = cards[i]
		if selectable:
			row.add_child(_card_button(cd, i, card_sel.has(i), _on_card_toggled))
		else:
			row.add_child(_card_face(cd))
	return row

func _on_card_toggled(on: bool, idx: int, b: Button) -> void:
	if on:
		if card_sel.size() >= 3 and String(card_state.get("game", "")) == "cheat":
			b.set_pressed_no_signal(false)
			ui._toast("Можно выложить не больше 3 карт")
			return
		if not card_sel.has(idx):
			card_sel.append(idx)
	else:
		card_sel.erase(idx)
	if _card_play_btn != null and is_instance_valid(_card_play_btn):
		_card_play_btn.disabled = card_sel.is_empty()

func _players_line(v: Dictionary, counts: Array = [], totals: Array = []) -> Control:
	var row := GridContainer.new()
	row.columns = 3
	row.add_theme_constant_override("h_separation", 5)
	row.add_theme_constant_override("v_separation", 5)
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var names: Array = v.get("names", [])
	var turn := int(v.get("turn", -1))
	var you := int(v.get("you", -1))
	for i in names.size():
		var nm := String(names[i])
		if i == you:
			nm = "Вы"
		var extra := ""
		if i < counts.size():
			extra = " · %d" % int(counts[i])
		if i < totals.size() and totals[i] != null:
			extra += " (%s)" % str(totals[i])
		var text := ("➤ " if i == turn else "") + nm + extra
		var col: Color = ui.GOLD if i == turn else (ui.TEXT if i == you else ui.MUTED)
		row.add_child(ui._pill(text, col))
	return row

func _card_act(args: Dictionary) -> void:
	if card_busy:
		return
	card_busy = true
	card_sel.clear()
	var r: Dictionary = await net.request("card.act", args)
	card_busy = false
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Ход не принят")))

func _first_sel() -> int:
	return int(card_sel[0]) if not card_sel.is_empty() else -1

## JSON-числа приходят float, но очки и счётчики карт лучше показывать целыми.
func _num(v: Variant) -> String:
	if typeof(v) == TYPE_INT:
		return str(int(v))
	if typeof(v) == TYPE_FLOAT:
		var f := float(v)
		if is_equal_approx(f, round(f)):
			return str(int(round(f)))
		return "%.1f" % f
	return str(v)

# ── блэкджек ──────────────────────────────────────────────────────────────────
func _build_bj(parent: VBoxContainer, v: Dictionary) -> void:
	var hands: Array = v.get("hand", [])
	parent.add_child(ui._label("ВАША РУКА · %s" % _num(v.get("total", 0)), 11, ui.GOLD))
	parent.add_child(_hand_row(hands, false))
	if bool(v.get("bust", false)):
		parent.add_child(ui._label("Перебор", 12, ui.RED))
	elif bool(v.get("stood", false)):
		parent.add_child(ui._label("Вы остановились", 11, ui.MUTED))
	var players: Array = v.get("players", [])
	var c: PanelContainer = ui._card(Color(ui.LINE, 0.7), 12)
	var cv: VBoxContainer = ui._vbox(4)
	for i in players.size():
		if typeof(players[i]) != TYPE_DICTIONARY:
			continue
		var pd: Dictionary = players[i]
		var names: Array = v.get("names", [])
		var nm := String(names[i]) if i < names.size() else ("Игрок %d" % (i + 1))
		var st := "%d карт" % int(pd.get("count", 0))
		if pd.get("total") != null:
			st += " · %s" % _num(pd.get("total"))
		if bool(pd.get("natural", false)):
			st += " · блэкджек"
		if bool(pd.get("bust", false)):
			st += " · перебор"
		if bool(pd.get("stood", false)):
			st += " · стоп"
		if bool(pd.get("out", false)):
			st += " · вышел"
		if bool(pd.get("win", false)):
			st += " 🏆"
		cv.add_child(ui._label("%s: %s" % [nm, st], 10.5, ui.GOLD if bool(pd.get("win", false)) else ui.TEXT))
	c.add_child(cv)
	parent.add_child(c)
	var can: Dictionary = v.get("can", {})
	var row: HBoxContainer = ui._row(6)
	var hit: Button = ui._button("🃏 Ещё", 12, ui.TEXT)
	hit.disabled = not bool(can.get("hit", false))
	hit.pressed.connect(func() -> void: _card_act({ "act": "hit" }))
	row.add_child(hit)
	var stand: Button = ui._button("✋ Стоп", 12, ui.GOLD)
	stand.disabled = not bool(can.get("stand", false))
	stand.pressed.connect(func() -> void: _card_act({ "act": "stand" }))
	row.add_child(stand)
	parent.add_child(row)

# ── пьяница ───────────────────────────────────────────────────────────────────
func _build_war(parent: VBoxContainer, v: Dictionary) -> void:
	var counts: Array = v.get("counts", [])
	parent.add_child(_players_line(v, counts))
	var info := "Раунд %d/%d · базар: %d карт" % [int(v.get("round", 0)), int(v.get("maxRounds", 0)), int(v.get("pile", 0))]
	parent.add_child(ui._label(info, 10.5, ui.MUTED))
	var drawn: Array = v.get("drawn", [])
	if not drawn.is_empty():
		var row: HBoxContainer = ui._row(6)
		row.alignment = BoxContainer.ALIGNMENT_CENTER
		var names: Array = v.get("names", [])
		for d in drawn:
			if typeof(d) != TYPE_DICTIONARY:
				continue
			var dd: Dictionary = d
			var idx := int(dd.get("i", 0))
			var box: VBoxContainer = ui._vbox(2)
			var nm := String(names[idx]) if idx < names.size() else ("Игрок %d" % (idx + 1))
			box.add_child(ui._label(nm, 9, ui.MUTED))
			var cd: Variant = dd.get("c")
			if cd != null and typeof(cd) == TYPE_DICTIONARY:
				box.add_child(_card_face(cd))
			row.add_child(box)
		parent.add_child(row)
	else:
		parent.add_child(ui._label("Карты ещё не открыты", 10.5, ui.MUTED))
	var last: Variant = v.get("last")
	if last != null and typeof(last) == TYPE_DICTIONARY:
		var ld: Dictionary = last
		if String(ld.get("winner", "")) != "":
			parent.add_child(ui._label("Раунд забрал: " + String(ld.get("winner", "")), 11, ui.GREEN))
	var row2: HBoxContainer = ui._row(6)
	var op: Button = ui._button("🃏 Открыть карту", 12, ui.GOLD)
	op.disabled = not bool(v.get("canOpen", false))
	op.pressed.connect(func() -> void: _card_act({ "act": "open" }))
	row2.add_child(op)
	var nx: Button = ui._button("➡️ Дальше", 12, ui.TEXT)
	nx.disabled = not bool(v.get("canNext", false))
	nx.pressed.connect(func() -> void: _card_act({ "act": "next" }))
	row2.add_child(nx)
	parent.add_child(row2)
	var fast: Button = ui._button("⏩ Доиграть всё", 10.5, ui.MUTED)
	fast.disabled = not bool(v.get("canFast", false))
	fast.pressed.connect(func() -> void: _card_act({ "act": "fast" }))
	parent.add_child(fast)
	if bool(v.get("over", false)):
		var wl: Array = v.get("winners", [])
		var names2: Array = v.get("names", [])
		if wl.is_empty():
			parent.add_child(ui._label("Ничья: карты не разошлись", 12, ui.GOLD))
		else:
			var txt := "Победил: "
			for k in wl:
				txt += String(names2[int(k)]) + " "
			parent.add_child(ui._label(txt, 12, ui.GREEN))

# ── верю-не-верю ─────────────────────────────────────────────────────────────
func _build_cheat(parent: VBoxContainer, v: Dictionary) -> void:
	var counts: Array = v.get("counts", [])
	parent.add_child(_players_line(v, counts))
	parent.add_child(ui._label("Объявленный ранг: %s · в сбросе: %d" % [str(v.get("rank", "?")), int(v.get("pile", 0))], 10.5, ui.MUTED))
	var pending: Variant = v.get("pending")
	if pending != null and typeof(pending) == TYPE_DICTIONARY:
		var pd: Dictionary = pending
		parent.add_child(ui._label("%s положил %d карт(ы) как «%s»" % [String(pd.get("byName", "?")), int(pd.get("count", 0)), String(pd.get("rank", "?"))], 11.5, ui.GOLD, true))
	parent.add_child(ui._label("ВАША РУКА · выбрано %d" % card_sel.size(), 11, ui.GOLD))
	var hand: Array = v.get("hand", [])
	parent.add_child(_hand_row(hand, true))
	var can: Dictionary = v.get("can", {})
	var row: HBoxContainer = ui._row(6)
	_card_play_btn = ui._button("Выложить", 12, ui.GOLD)
	_card_play_btn.disabled = card_sel.is_empty()
	_card_play_btn.visible = bool(can.get("place", false))
	_card_play_btn.pressed.connect(func() -> void:
		if card_sel.is_empty():
			ui._toast("Выберите 1–3 карты")
			return
		_card_act({ "act": "play", "cards": card_sel.duplicate() })
	)
	row.add_child(_card_play_btn)
	var bel: Button = ui._button("✅ Верю", 12, ui.GREEN)
	bel.disabled = not bool(can.get("believe", false))
	bel.pressed.connect(func() -> void: _card_act({ "act": "believe" }))
	row.add_child(bel)
	var doubt: Button = ui._button("❌ Не верю", 12, ui.RED)
	doubt.disabled = not bool(can.get("doubt", false))
	doubt.pressed.connect(func() -> void: _card_act({ "act": "doubt" }))
	row.add_child(doubt)
	parent.add_child(row)
	if bool(v.get("over", false)):
		var wi := int(v.get("winner", -1))
		var names: Array = v.get("names", [])
		parent.add_child(ui._label("Победил: " + (String(names[wi]) if wi >= 0 and wi < names.size() else "—"), 12, ui.GREEN))

# ── дурак ─────────────────────────────────────────────────────────────────────
func _build_durak(parent: VBoxContainer, v: Dictionary) -> void:
	var counts: Array = v.get("counts", [])
	parent.add_child(_players_line(v, counts))
	var attacker := int(v.get("attacker", -1))
	var defender := int(v.get("defender", -1))
	var names: Array = v.get("names", [])
	var atk := String(names[attacker]) if attacker >= 0 and attacker < names.size() else "—"
	var dfn := String(names[defender]) if defender >= 0 and defender < names.size() else "—"
	parent.add_child(ui._label("Козырь %s · колода %d · сброс %d · раунд %d" % [str(v.get("trump", "?")), int(v.get("deck", 0)), int(v.get("discard", 0)), int(v.get("round", 1))], 10.5, ui.MUTED))
	parent.add_child(ui._label("Атакует: %s · отбивается: %s" % [atk, dfn], 10.5, ui.MUTED))
	var table: Array = v.get("table", [])
	if table.is_empty():
		parent.add_child(ui._label("Стол пуст", 10.5, ui.MUTED))
	else:
		var tr := HFlowContainer.new()
		tr.add_theme_constant_override("h_separation", 8)
		tr.add_theme_constant_override("v_separation", 8)
		tr.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		for p in table:
			if typeof(p) != TYPE_DICTIONARY:
				continue
			var pd: Dictionary = p
			var pair: VBoxContainer = ui._vbox(2)
			var ca: Variant = pd.get("a")
			if ca != null and typeof(ca) == TYPE_DICTIONARY:
				pair.add_child(_card_face(ca))
			var cd: Variant = pd.get("d")
			if cd != null and typeof(cd) == TYPE_DICTIONARY:
				pair.add_child(_card_face(cd))
			else:
				pair.add_child(ui._label("не отбито", 8.5, ui.RED))
			tr.add_child(pair)
		parent.add_child(tr)
	parent.add_child(ui._label("ВАША РУКА · выбрано %d" % card_sel.size(), 11, ui.GOLD))
	var hand: Array = v.get("hand", [])
	parent.add_child(_hand_row(hand, true))
	var can: Dictionary = v.get("can", {})
	var row: HBoxContainer = ui._row(6)
	var atk_btn: Button = ui._button("🃏 Положить", 11.5, ui.GOLD)
	atk_btn.disabled = not bool(can.get("attack", false))
	atk_btn.pressed.connect(func() -> void:
		var idx := _first_sel()
		if idx < 0:
			ui._toast("Выберите карту")
			return
		_card_act({ "act": "add" if bool(can.get("add", false)) else "attack", "card": idx })
	)
	row.add_child(atk_btn)
	var def_btn: Button = ui._button("🛡 Отбить", 11.5, ui.GREEN)
	def_btn.disabled = not bool(can.get("defend", false))
	def_btn.pressed.connect(func() -> void:
		var idx := _first_sel()
		if idx < 0:
			ui._toast("Выберите карту")
			return
		_card_act({ "act": "defend", "card": idx })
	)
	row.add_child(def_btn)
	var tr_btn: Button = ui._button("↔️ Перевести", 11.5, ui.TEXT)
	tr_btn.disabled = not bool(can.get("transfer", false))
	tr_btn.pressed.connect(func() -> void:
		var idx := _first_sel()
		if idx < 0:
			ui._toast("Выберите карту того же ранга")
			return
		_card_act({ "act": "transfer", "card": idx })
	)
	row.add_child(tr_btn)
	parent.add_child(row)
	var row2: HBoxContainer = ui._row(6)
	var take: Button = ui._button("✋ Взять", 11.5, ui.TEXT)
	take.disabled = not bool(can.get("take", false))
	take.pressed.connect(func() -> void: _card_act({ "act": "take" }))
	row2.add_child(take)
	var passb: Button = ui._button("✅ Бито", 11.5, ui.GREEN)
	passb.disabled = not bool(can.get("pass", false))
	passb.pressed.connect(func() -> void: _card_act({ "act": "pass" }))
	row2.add_child(passb)
	parent.add_child(row2)
	if bool(v.get("over", false)):
		var wi := int(v.get("winner", -1))
		var du := int(v.get("durak", -1))
		var msg := "Победил: " + (String(names[wi]) if wi >= 0 and wi < names.size() else "—")
		if du >= 0 and du < names.size():
			msg += " · дурак: " + String(names[du])
		parent.add_child(ui._label(msg, 12, ui.GREEN))

# ── покер ─────────────────────────────────────────────────────────────────────
func _build_poker(parent: VBoxContainer, v: Dictionary) -> void:
	var board: Array = v.get("board", [])
	parent.add_child(ui._label("БОРД", 10, ui.MUTED))
	var br: HBoxContainer = ui._row(4)
	br.alignment = BoxContainer.ALIGNMENT_CENTER
	if board.is_empty():
		br.add_child(ui._label("—", 12, ui.MUTED))
	for c in board:
		if typeof(c) == TYPE_DICTIONARY:
			br.add_child(_card_face(c))
	parent.add_child(br)
	parent.add_child(ui._label("ВАША РУКА", 10, ui.MUTED))
	parent.add_child(_hand_row(v.get("hand", []), false))
	var you := int(v.get("you", -1))
	var names: Array = v.get("names", [])
	var players: Array = v.get("players", [])
	var c: PanelContainer = ui._card(Color(ui.LINE, 0.7), 12)
	var cv: VBoxContainer = ui._vbox(3)
	for i in players.size():
		if typeof(players[i]) != TYPE_DICTIONARY:
			continue
		var pd: Dictionary = players[i]
		var nm := "Вы" if i == you else (String(names[i]) if i < names.size() else ("Игрок %d" % (i + 1)))
		var st := "стек %s · в банке %s" % [VCGame.fmt(float(pd.get("stack", 0.0))), VCGame.fmt(float(pd.get("bet", 0.0)))]
		if bool(pd.get("folded", false)):
			st += " · сброс"
		if bool(pd.get("allin", false)):
			st += " · олл-ин"
		cv.add_child(ui._label(nm + ": " + st, 10, ui.TEXT if i == you else ui.MUTED))
	c.add_child(cv)
	parent.add_child(c)
	var street_names := { "preflop": "префлоп", "flop": "флоп", "turn": "тёрн", "river": "ривер", "showdown": "вскрытие" }
	parent.add_child(ui._label("Улица: %s · банк 🪙 %s · ваш стек 🪙 %s · уравнять %s" % [
		String(street_names.get(String(v.get("street", "")), String(v.get("street", "")))),
		VCGame.fmt(float(v.get("pot", 0.0))),
		VCGame.fmt(float(v.get("stack", 0.0))),
		VCGame.fmt(float(v.get("toCall", 0.0))),
	], 10.5, ui.MUTED, true))
	var can: Dictionary = v.get("can", {})
	var row: HBoxContainer = ui._row(5)
	var fold: Button = ui._button("Сброс", 11.5, ui.RED)
	fold.disabled = not bool(can.get("fold", false))
	fold.pressed.connect(func() -> void: _card_act({ "act": "fold" }))
	row.add_child(fold)
	var chk: Button = ui._button("Чек", 11.5, ui.TEXT)
	chk.disabled = not bool(can.get("check", false))
	chk.pressed.connect(func() -> void: _card_act({ "act": "check" }))
	row.add_child(chk)
	var call: Button = ui._button("Колл " + VCGame.fmt(float(can.get("callAmount", 0.0))), 11.5, ui.GOLD)
	call.disabled = not bool(can.get("call", false))
	call.pressed.connect(func() -> void: _card_act({ "act": "call" }))
	row.add_child(call)
	parent.add_child(row)
	var rr: HBoxContainer = ui._row(5)
	_poker_raise = LineEdit.new()
	_poker_raise.placeholder_text = "Рейз до… (мин %s)" % VCGame.fmt(float(can.get("minRaise", 0.0)))
	_poker_raise.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_poker_raise.mouse_filter = Control.MOUSE_FILTER_PASS
	rr.add_child(_poker_raise)
	var raise: Button = ui._button("Рейз", 11.5, ui.GOLD)
	raise.disabled = not bool(can.get("raise", false))
	raise.pressed.connect(func() -> void:
		var amount := VCSocial.parse_amount(_poker_raise.text if _poker_raise != null else "")
		if amount <= 0.0:
			ui._toast("Введите сумму рейза")
			return
		_card_act({ "act": "raise", "amount": amount })
	)
	rr.add_child(raise)
	parent.add_child(rr)
	if v.get("showdown", null) != null:
		var rev: Variant = v.get("handsRevealed")
		if rev != null and typeof(rev) == TYPE_ARRAY:
			var arr: Array = rev
			for i in arr.size():
				if typeof(arr[i]) != TYPE_ARRAY:
					continue
				var nm2 := String(names[i]) if i < names.size() else ("Игрок %d" % (i + 1))
				parent.add_child(ui._label("Вскрытие · " + nm2, 10, ui.MUTED))
				parent.add_child(_hand_row(arr[i], false))
	var winners: Array = v.get("winners", [])
	if bool(v.get("over", false)) and not winners.is_empty():
		var wt: Array[String] = []
		for k in winners:
			var idx := int(k)
			wt.append(String(names[idx]) if idx >= 0 and idx < names.size() else "?")
		parent.add_child(ui._label("🏆 " + ", ".join(wt), 12, ui.GREEN))
