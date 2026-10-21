class_name VCSocial
extends RefCounted
## Социальная часть онлайн-режима: чат (комнаты, ParrotAI, личные сообщения),
## друзья, переводы и кошелёк.
##
## Протокол полностью совпадает с веб-версией (online.js):
##   chat.history {room|with}  chat.send {text, room|to}  → push chat.msg / chat.dm
##   friends.list / friends.add / .accept / .decline / .remove → push friends.update
##   wallet.pending / wallet.ack / wallet.history / transfer → push wallet
##
## Деньги из переводов приходят в pending-записях. Клиент применяет каждую
## запись ровно один раз (id запоминается в user://wallet_applied.json) и
## подтверждает их вместе с сохранением (save.put ack), чтобы баланс на сервере
## и в data.bin не разошлись.

const BOT_PEER := "@parrot"
const APPLIED_PATH := "user://wallet_applied.json"
const MAX_MSG := 120
const UNITS := {
	"k": 1e3, "m": 1e6, "b": 1e9, "t": 1e12,
	"к": 1e3, "м": 1e6, "б": 1e9, "т": 1e12,
	"kk": 1e6, "кк": 1e6,
	"qa": 1e15, "qi": 1e18, "sx": 1e21, "sp": 1e24, "oc": 1e27, "no": 1e30,
}

var ui: Node
var net: VCNet
var game: VCGame
var active := false

var friends: Dictionary = { "friends": [], "incoming": [], "outgoing": [] }
var peers: Array = []
var cur := "global"
var pending_peer := ""
var cache: Dictionary = {}
var unread: Dictionary = {}
var extra_peers: Dictionary = {}

var applied: Dictionary = {}
var applied_order: Array = []
var pending_ack: Array = []
var avail := 0.0
var tx: Array = []
var wallet_busy := false
var wallet_again := false
var wallet_tick := 0.0
var transfer_busy := false
var has_tx := false

var _chat_scroll: ScrollContainer
var _chat_log: VBoxContainer
var _chat_input: LineEdit
var _chat_sel: OptionButton
var _chat_status: Label
var _filling := false
var _sending := false
var _loading: Dictionary = {}
var _tr_name: LineEdit
var _tr_amt: LineEdit
var _tr_note: Label
var _tr_hist: VBoxContainer
var _tr_card: PanelContainer
var _avail_lbl: Label
var _tr_prefill := ""
var _re_mention: RegEx

func setup(ui_node: Node, net_node: VCNet, game_node: VCGame) -> void:
	ui = ui_node
	net = net_node
	game = game_node
	_re_mention = RegEx.new()
	_re_mention.compile("@([A-Za-z0-9_А-Яа-яЁё]{2,16})")

# ── сессия ────────────────────────────────────────────────────────────────────
func on_login() -> void:
	active = true
	wallet_tick = 0.0
	load_applied()
	avail = float(net.me.get("avail", 0.0))
	await refresh_friends()
	load_tx()
	await pull_wallet()

func on_logout() -> void:
	active = false
	cur = "global"
	pending_peer = ""
	friends = { "friends": [], "incoming": [], "outgoing": [] }
	peers.clear()
	cache.clear()
	unread.clear()
	extra_peers.clear()
	applied.clear()
	applied_order.clear()
	pending_ack.clear()
	tx.clear()
	has_tx = false
	avail = 0.0
	wallet_busy = false
	wallet_again = false
	transfer_busy = false
	_tr_prefill = ""
	ui._set_chat_badge(0)

func tick(delta: float) -> void:
	if not active:
		return
	wallet_tick += delta
	if wallet_tick >= 30.0:
		wallet_tick = 0.0
		pull_wallet()

# ── кошелёк ───────────────────────────────────────────────────────────────────
func load_applied() -> void:
	applied.clear()
	applied_order.clear()
	if net == null or not FileAccess.file_exists(APPLIED_PATH):
		return
	var f := FileAccess.open(APPLIED_PATH, FileAccess.READ)
	if f == null:
		return
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	f.close()
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	var d: Dictionary = parsed
	if String(d.get("name", "")) != net.user_name:
		return
	for id in d.get("ids", []):
		var k := String(id)
		if k != "" and not applied.has(k):
			applied[k] = true
			applied_order.append(k)

func save_applied() -> void:
	if applied_order.size() > 800:
		applied_order = applied_order.slice(applied_order.size() - 800)
	var f := FileAccess.open(APPLIED_PATH, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(JSON.stringify({ "name": net.user_name, "ids": applied_order }))
	f.close()

func pull_wallet() -> void:
	if not active or net == null or not net.authed:
		return
	if wallet_busy:
		wallet_again = true
		return
	wallet_busy = true
	var r: Dictionary = await net.wallet_pending()
	if bool(r.get("ok", false)):
		avail = float(r.get("avail", avail))
		_refresh_avail()
		var items: Array = r.get("items", [])
		if not items.is_empty():
			await _apply_wallet(items)
	wallet_busy = false
	if wallet_again:
		wallet_again = false
		pull_wallet()

func _apply_wallet(items: Array) -> void:
	var sorted: Array = items.duplicate()
	sorted.sort_custom(func(a, b) -> bool:
		var ca := 0 if String(a.get("kind", "")) == "credit" else 1
		var cb := 0 if String(b.get("kind", "")) == "credit" else 1
		return ca < cb)
	var note := ""
	var plus := 0.0
	var minus := 0.0
	var changed := false
	var added := false
	for it in sorted:
		if typeof(it) != TYPE_DICTIONARY:
			continue
		var d: Dictionary = it
		var id := String(d.get("id", ""))
		if id == "":
			continue
		if not pending_ack.has(id):
			pending_ack.append(id)
		if applied.has(id):
			continue
		var amt: float = floor(float(d.get("amount", 0)))
		if String(d.get("kind", "")) == "credit":
			if amt > 0.0:
				game.add_money(amt, "auto")
				plus += amt
				changed = true
		else:
			var take: float = minf(amt, floor(game.total_money()))
			if take > 0.0 and game.spend(take):
				minus += take
				changed = true
		applied[id] = true
		applied_order.append(id)
		added = true
		var n := String(d.get("note", ""))
		if n != "":
			note = n
	if added:
		save_applied()
	if plus > 0.0:
		ui._toast("💰 +🪙 %s%s" % [VCGame.fmt(plus), (" · " + note) if note != "" else ""])
	if minus > 0.0:
		ui._toast("💸 −🪙 %s%s" % [VCGame.fmt(minus), (" · " + note) if note != "" else ""])
	if changed:
		game.save()
		ui._shown_money = game.total_money()
		_refresh_avail()
		ui._update_header()
	if not pending_ack.is_empty():
		await ui._push_cloud(true, pending_ack.duplicate())

func ack_done(ids: Array) -> void:
	for id in ids:
		var i := pending_ack.find(String(id))
		if i >= 0:
			pending_ack.remove_at(i)

func on_saved(r: Dictionary) -> void:
	avail = float(r.get("avail", avail))
	_refresh_avail()

func on_wallet_push() -> void:
	pull_wallet()

func load_tx() -> void:
	if not active or net == null or not net.authed:
		return
	var r: Dictionary = await net.wallet_history()
	if not bool(r.get("ok", false)):
		return
	tx = r.get("tx", [])
	has_tx = true
	avail = float(r.get("avail", avail))
	_refresh_avail()
	_render_tx()

func _refresh_avail() -> void:
	if _avail_lbl != null and is_instance_valid(_avail_lbl):
		_avail_lbl.text = "В облаке доступно: 🪙 %s" % VCGame.fmt(avail)

func _render_tx() -> void:
	if _tr_hist == null or not is_instance_valid(_tr_hist):
		return
	for c in _tr_hist.get_children():
		_tr_hist.remove_child(c)
		c.queue_free()
	if tx.is_empty():
		_tr_hist.add_child(ui._label("Операций пока нет", 10.5, ui.MUTED))
		return
	var n := mini(6, tx.size())
	for i in n:
		var x: Dictionary = tx[i]
		var when: String = ui._time_str(float(x.get("at", 0)) / 1000.0)
		var typ := String(x.get("type", ""))
		var amount := float(x.get("amount", 0))
		var other := String(x.get("other", ""))
		var label := ""
		var col: Color = ui.MUTED
		if typ == "in":
			label = "%s  ⬅️ от %s" % [when, other]
			col = ui.GREEN
		elif typ == "out":
			label = "%s  ➡️ %s" % [when, other]
			col = ui.RED
		elif typ == "bank":
			label = "%s  🏦 банк" % when
		elif typ == "game":
			label = "%s  🎲 игра" % when
		elif typ == "duel":
			label = "%s  ⚔️ дуэль" % when
		else:
			label = "%s  %s" % [when, String(x.get("note", "операция"))]
		var txt := label
		if amount != 0.0:
			txt += "   %s🪙 %s" % ["+" if amount > 0.0 else "−", VCGame.fmt(absf(amount))]
		_tr_hist.add_child(ui._label(txt, 10.5, col, true))

static func parse_amount(raw: String) -> float:
	var s := raw.strip_edges().to_lower().replace(",", ".").replace(" ", "")
	var num := ""
	var suf := ""
	for ch in s:
		if (ch >= "0" and ch <= "9") or ch == ".":
			num += ch
		else:
			suf += ch
	if num == "" or not num.is_valid_float():
		return 0.0
	var mul := 1.0
	if suf != "":
		if not UNITS.has(suf):
			return 0.0
		mul = float(UNITS[suf])
	var v: float = floor(float(num) * mul)
	if not is_finite(v) or v <= 0.0 or v >= 1e30:
		return 0.0
	return v

static func bbcode_escape(s: String) -> String:
	return s.replace("[", "[lb]")

# ── чат ───────────────────────────────────────────────────────────────────────
func build_chat(parent: VBoxContainer) -> void:
	_chat_log = null
	_chat_scroll = null
	_chat_input = null
	_chat_sel = null
	_chat_status = null
	parent.add_child(ui._label("💬 ЧАТ", 13, ui.GOLD))
	if net == null or not net.authed:
		parent.add_child(ui._panel_text("Чат доступен после входа в аккаунт."))
		return
	var card: PanelContainer = ui._card(Color(ui.GOLD, 0.18))
	var v: VBoxContainer = ui._vbox(9)
	v.add_child(ui._label("Общий чат и комнаты, отдельный чат с ParrotAI, личные сообщения друзьям. Упоминание — @ник.", 11, ui.MUTED, true))
	_chat_sel = OptionButton.new()
	_chat_sel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_chat_sel.custom_minimum_size = Vector2(0, 40)
	_chat_sel.mouse_filter = Control.MOUSE_FILTER_PASS
	_chat_sel.item_selected.connect(_on_peer_selected)
	v.add_child(_chat_sel)
	_chat_status = ui._label("", 10.5, ui.MUTED, true)
	v.add_child(_chat_status)

	var log_card: PanelContainer = ui._card(Color(ui.LINE, 0.85), 14)
	var lv: VBoxContainer = ui._vbox(0)
	_chat_scroll = ScrollContainer.new()
	_chat_scroll.custom_minimum_size = Vector2(0, 322)
	_chat_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_chat_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_chat_scroll.follow_focus = true
	_chat_log = VBoxContainer.new()
	_chat_log.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_chat_log.add_theme_constant_override("separation", 6)
	_chat_scroll.add_child(_chat_log)
	lv.add_child(_chat_scroll)
	log_card.add_child(lv)
	v.add_child(log_card)

	var row: HBoxContainer = ui._row(6)
	_chat_input = LineEdit.new()
	_chat_input.placeholder_text = "Сообщение…"
	_chat_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_chat_input.custom_minimum_size = Vector2(0, 40)
	_chat_input.mouse_filter = Control.MOUSE_FILTER_PASS
	_chat_input.text_submitted.connect(func(_t: String) -> void: _send())
	row.add_child(_chat_input)
	var send: Button = ui._button("➤", 16, ui.GOLD)
	send.custom_minimum_size = Vector2(54, 40)
	send.pressed.connect(_send)
	row.add_child(send)
	v.add_child(row)
	card.add_child(v)
	parent.add_child(card)

	_filling = true
	_fill_peers()
	_filling = false
	_render()
	_update_status()
	if not cache.has(key(cur)):
		_load(cur)

func _make_peers() -> Array:
	var out: Array = []
	var cfg: Dictionary = {}
	if net != null:
		cfg = net.me.get("cfg", {})
	var rooms: Array = cfg.get("rooms", [])
	for r in rooms:
		if typeof(r) != TYPE_DICTIONARY:
			continue
		var rid := String(r.get("id", ""))
		if rid == "":
			continue
		out.append({ "id": rid, "kind": "room", "label": "%s %s" % [String(r.get("ico", "")), String(r.get("name", ""))] })
	if out.is_empty():
		out.append({ "id": "global", "kind": "room", "label": "💬 Общий" })
	var bot: Dictionary = cfg.get("bot", {})
	if bool(bot.get("on", false)):
		out.append({ "id": BOT_PEER, "kind": "bot", "label": "🦜 %s (ИИ)" % String(bot.get("name", "ParrotAI")) })
	for f in friends.get("friends", []):
		if typeof(f) != TYPE_DICTIONARY:
			continue
		var nm := String(f.get("name", ""))
		if nm == "":
			continue
		var on := bool(f.get("online", false))
		var u := int(unread.get(key(nm), 0))
		out.append({ "id": nm, "kind": "dm", "label": ("🟢 " if on else "⚪ ") + nm + ((" (%d)" % u) if u > 0 else "") })
	for k in extra_peers:
		var nm2 := String(extra_peers[k])
		if _has_peer_in(out, nm2):
			continue
		var u2 := int(unread.get(k, 0))
		out.append({ "id": nm2, "kind": "dm", "label": "⚪ " + nm2 + ((" (%d)" % u2) if u2 > 0 else "") })
	return out

func _has_peer_in(list: Array, id: String) -> bool:
	for p in list:
		if typeof(p) == TYPE_DICTIONARY and String(p.get("id", "")).to_lower() == id.to_lower():
			return true
	return false

func _has_peer(id: String) -> bool:
	return _has_peer_in(peers, id)

func _fill_peers() -> void:
	if _chat_sel == null or not is_instance_valid(_chat_sel):
		return
	peers = _make_peers()
	_chat_sel.clear()
	var sel := 0
	var found := false
	var applied := false
	var want := cur
	if pending_peer != "":
		want = pending_peer
	for i in peers.size():
		var p: Dictionary = peers[i]
		_chat_sel.add_item(String(p.get("label", String(p.get("id", "")))))
		if String(p.get("id", "")).to_lower() == want.to_lower():
			sel = i
			found = true
			cur = String(p.get("id", ""))
			if pending_peer != "":
				pending_peer = ""
				applied = true
	if not found:
		cur = String((peers[0] as Dictionary).get("id", "global")) if not peers.is_empty() else "global"
		sel = 0
	_chat_sel.select(sel)
	if applied:
		_render()
		_update_status()
		if not cache.has(key(cur)):
			_load(cur)

func _on_peer_selected(i: int) -> void:
	if _filling or i < 0 or i >= peers.size():
		return
	var p: Dictionary = peers[i]
	select_peer(String(p.get("id", "")))

func select_peer(id: String) -> void:
	if id == "":
		return
	cur = id
	unread.erase(key(id))
	_set_badge()
	_filling = true
	_fill_peers()
	_filling = false
	_render()
	_update_status()
	if not cache.has(key(id)):
		_load(id)

func _peer_kind(id: String) -> String:
	for p in peers:
		if typeof(p) == TYPE_DICTIONARY and String(p.get("id", "")).to_lower() == id.to_lower():
			return String(p.get("kind", "room"))
	return "dm"

func _is_room(id: String) -> bool:
	return _peer_kind(id) == "room"

func _update_status() -> void:
	if _chat_status == null or not is_instance_valid(_chat_status):
		return
	var kind := _peer_kind(cur)
	if kind == "room":
		_chat_status.text = "Сообщения этой комнаты видят все её участники."
	elif kind == "bot":
		var bot: Dictionary = net.me.get("cfg", {}).get("bot", {}) if net != null else {}
		_chat_status.text = "🦜 %s · %s" % [String(bot.get("name", "ParrotAI")), "включён" if bool(bot.get("on", false)) else "выключен"]
	else:
		var on := false
		for f in friends.get("friends", []):
			if String(f.get("name", "")).to_lower() == cur.to_lower():
				on = bool(f.get("online", false))
				break
		_chat_status.text = ("🟢 в сети" if on else "⚪ не в сети") + " · личные сообщения"

func _render() -> void:
	if _chat_log == null or not is_instance_valid(_chat_log):
		return
	for c in _chat_log.get_children():
		_chat_log.remove_child(c)
		c.queue_free()
	var arr: Array = cache.get(key(cur), [])
	if arr.is_empty():
		_chat_log.add_child(ui._label("Сообщений пока нет", 11, ui.MUTED))
	else:
		for m in arr:
			if typeof(m) == TYPE_DICTIONARY:
				_chat_log.add_child(_msg_node(m))
	_scroll_bottom()
	_update_status()

func _msg_node(m: Dictionary) -> Control:
	var raw := String(m.get("text", ""))
	var rt := RichTextLabel.new()
	rt.bbcode_enabled = true
	rt.fit_content = true
	rt.scroll_active = false
	rt.selection_enabled = true
	rt.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	rt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rt.add_theme_font_size_override("normal_font_size", 12)
	rt.add_theme_font_size_override("bold_font_size", 12)
	rt.add_theme_color_override("default_color", ui.TEXT)
	var text := bbcode_escape(raw)
	if bool(m.get("sys", false)):
		rt.text = "[center][i][color=#8b96ad]" + text + "[/color][/i][/center]"
		return rt
	var from := String(m.get("from", ""))
	var bot := bool(m.get("bot", false))
	var mine := net != null and from.to_lower() == String(net.user_name).to_lower()
	var col := "#7fb2ff"
	if bot:
		col = "#9b7bff"
	elif bool(m.get("owner", false)):
		col = "#ffd75e"
	elif bool(m.get("admin", false)):
		col = "#ff5d6c"
	elif mine:
		col = "#46e08a"
	var nick := ("🦜 " if bot else "") + from
	text = _mentions(text)
	var when: String = ui._time_str(float(m.get("at", 0)) / 1000.0)
	rt.text = "[color=#6f7d99]%s[/color]  [b][color=%s]%s[/color][/b]  %s" % [
		when, col, bbcode_escape(nick), text]
	return rt

func _mentions(text: String) -> String:
	if _re_mention == null:
		return text
	return _re_mention.sub(text, "[color=#ffd75e]@$1[/color]", true)

func _scroll_bottom() -> void:
	if _chat_scroll == null or not is_instance_valid(_chat_scroll):
		return
	await ui.get_tree().process_frame
	if is_instance_valid(_chat_scroll):
		_chat_scroll.scroll_vertical = 1 << 20

func _send() -> void:
	if _sending or not active or net == null or not net.authed:
		return
	if _chat_input == null or not is_instance_valid(_chat_input):
		return
	var text := _chat_input.text.strip_edges()
	if text == "":
		return
	var body := { "text": text }
	if _is_room(cur):
		body["room"] = cur
	else:
		body["to"] = cur
	_sending = true
	_chat_input.text = ""
	var r: Dictionary = await net.chat_send(body)
	_sending = false
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Сообщение не отправлено")))
		if _chat_input != null and is_instance_valid(_chat_input) and _chat_input.text == "":
			_chat_input.text = text

func _load(peer: String) -> void:
	if net == null or not net.authed:
		return
	var k := key(peer)
	if bool(_loading.get(k, false)):
		return
	_loading[k] = true
	var r: Dictionary
	if _is_room(peer):
		r = await net.chat_history({ "room": peer })
	else:
		r = await net.chat_history({ "with": peer })
	_loading.erase(k)
	if not active:
		return
	if not bool(r.get("ok", true)):
		if cur.to_lower() == k and ui._tab == "chat":
			ui._toast("❌ " + String(r.get("err", "Не удалось загрузить чат")))
		return
	if peer == BOT_PEER and r.has("bot"):
		var cfg: Dictionary = net.me.get("cfg", {})
		cfg["bot"] = { "peer": BOT_PEER, "name": String(r.get("bot", "ParrotAI")), "on": bool(r.get("on", false)) }
		net.me["cfg"] = cfg
	if r.has("msgs"):
		var old: Array = cache.get(k, [])
		cache[k] = _merge_msgs(old, r.get("msgs", []))
	if cur.to_lower() == k:
		_render()
	_filling = true
	_fill_peers()
	_filling = false

func _merge_msgs(old: Array, fresh: Array) -> Array:
	var out: Array = []
	var ids := {}
	for m in fresh:
		if typeof(m) != TYPE_DICTIONARY:
			continue
		out.append(m)
		ids[String(m.get("id", ""))] = true
	for m in old:
		if typeof(m) == TYPE_DICTIONARY and not ids.has(String(m.get("id", ""))):
			out.append(m)
	if out.size() > MAX_MSG:
		out = out.slice(out.size() - MAX_MSG)
	return out

func _add_msg(k: String, msg: Dictionary) -> void:
	var arr: Array = cache.get(k, [])
	var id := String(msg.get("id", ""))
	if id != "":
		for m in arr:
			if typeof(m) == TYPE_DICTIONARY and String(m.get("id", "")) == id:
				return
	arr.append(msg)
	if arr.size() > MAX_MSG:
		arr = arr.slice(arr.size() - MAX_MSG)
	cache[k] = arr
	if k == key(cur) and ui._tab == "chat" and _chat_log != null and is_instance_valid(_chat_log):
		_chat_log.add_child(_msg_node(msg))
		_scroll_bottom()
	elif k != key(cur):
		_bump(k)

func _bump(k: String) -> void:
	unread[k] = int(unread.get(k, 0)) + 1
	_set_badge()
	if _chat_sel != null and is_instance_valid(_chat_sel):
		_filling = true
		_fill_peers()
		_filling = false

func _set_badge() -> void:
	var n := 0
	for k in unread:
		n += int(unread[k])
	if ui.has_method("_set_chat_badge"):
		ui._set_chat_badge(n)

func on_push(m: Dictionary) -> void:
	if not active:
		return
	match String(m.get("t", "")):
		"chat.msg":
			var msg: Dictionary = m.get("msg", {})
			_add_msg(String(msg.get("room", "global")), msg)
		"chat.dm":
			_on_dm(m)
		"friends.update":
			if m.has("note"):
				ui._toast(String(m["note"]))
			refresh_friends()
		"wallet":
			on_wallet_push()
		"toast":
			ui._toast(String(m.get("text", "")))
		"xp":
			if net != null:
				net.me["xp"] = m.get("xp", net.me.get("xp", 0))
				net.me["level"] = m.get("level", net.me.get("level", 1))

func _on_dm(m: Dictionary) -> void:
	var peer := String(m.get("peer", BOT_PEER))
	var k := key(peer)
	var msg: Dictionary = m.get("msg", {})
	var from := String(msg.get("from", ""))
	var mine := net != null and from.to_lower() == String(net.user_name).to_lower()
	if not mine and k != BOT_PEER and not _has_peer(peer):
		extra_peers[k] = peer
		refresh_friends()
	_add_msg(k, msg)
	if mine:
		return
	var visible: bool = k == key(cur) and ui._tab == "chat"
	if not visible:
		var txt := String(msg.get("text", ""))
		if txt.length() > 70:
			txt = txt.substr(0, 70) + "…"
		if k == BOT_PEER:
			ui._toast("🦜 %s: %s" % [from, txt])
		else:
			ui._toast("✉️ %s: %s" % [from, txt])

func on_show_chat() -> void:
	if not active:
		return
	_set_badge()
	if not cache.has(key(cur)) or cache.get(key(cur), []).is_empty():
		_load(cur)

func prefill_transfer(nm: String) -> void:
	_tr_prefill = nm
	if _tr_name != null and is_instance_valid(_tr_name):
		_tr_name.text = nm
		_tr_name.grab_focus()
	if _tr_card != null and is_instance_valid(_tr_card) and ui._scroll != null:
		ui._scroll.call_deferred("ensure_control_visible", _tr_card)

# ── друзья ────────────────────────────────────────────────────────────────────
func refresh_friends() -> void:
	if not active or net == null or not net.authed:
		return
	var r: Dictionary = await net.friends_list()
	if not bool(r.get("ok", true)):
		return
	friends["friends"] = r.get("friends", [])
	friends["incoming"] = r.get("incoming", [])
	friends["outgoing"] = r.get("outgoing", [])
	if ui._tab == "friends":
		ui._rebuild()
	if ui._tab == "chat" and _chat_sel != null and is_instance_valid(_chat_sel):
		_filling = true
		_fill_peers()
		_filling = false

func _set_friends(r: Dictionary) -> void:
	friends["friends"] = r.get("friends", [])
	friends["incoming"] = r.get("incoming", [])
	friends["outgoing"] = r.get("outgoing", [])
	if ui._tab == "friends":
		ui._rebuild()
	if ui._tab == "chat" and _chat_sel != null and is_instance_valid(_chat_sel):
		_filling = true
		_fill_peers()
		_filling = false

func _friend_add(edit: LineEdit) -> void:
	if edit == null or not is_instance_valid(edit):
		return
	var nm := edit.text.strip_edges()
	if nm == "":
		return
	var r: Dictionary = await net.request("friends.add", { "name": nm })
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Ошибка")))
		return
	edit.text = ""
	ui._toast("👥 Заявка отправлена")
	_set_friends(r)

func _friend_accept(nm: String) -> void:
	var r: Dictionary = await net.request("friends.accept", { "name": nm })
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Ошибка")))
		return
	ui._toast("🤝 Теперь вы друзья")
	_set_friends(r)

func _friend_decline(nm: String) -> void:
	var r: Dictionary = await net.request("friends.decline", { "name": nm })
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Ошибка")))
		return
	_set_friends(r)

func _friend_remove(nm: String) -> void:
	ui._modal("Удалить друга?", "«%s» исчезнет из списка. Личные сообщения станут недоступны." % nm, [
		{ "label": "Удалить", "color": ui.RED, "cb": func() -> void: _friend_remove_now(nm) },
		{ "label": "Отмена", "color": ui.MUTED },
	])

func _friend_remove_now(nm: String) -> void:
	var r: Dictionary = await net.request("friends.remove", { "name": nm })
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Ошибка")))
		return
	ui._toast("👋 Друг удалён")
	_set_friends(r)

func open_dm(nm: String) -> void:
	if not _has_peer(nm):
		extra_peers[key(nm)] = nm
	ui._show_tab("chat")
	select_peer(nm)

func _friend_item(f: Dictionary, acts: Array) -> Control:
	var row: HBoxContainer = ui._row(5)
	var dot: Label = ui._label("🟢" if bool(f.get("online", false)) else "⚪", 11, ui.GREEN if bool(f.get("online", false)) else ui.MUTED)
	row.add_child(dot)
	var nm := String(f.get("name", ""))
	var col: Color = ui.TEXT
	if bool(f.get("owner", false)):
		col = ui.GOLD
	elif bool(f.get("admin", false)):
		col = ui.RED
	var nm_lbl: Label = ui._label(nm, 12, col)
	nm_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	nm_lbl.clip_text = true
	row.add_child(nm_lbl)
	row.add_child(ui._label("ур. %d" % int(f.get("level", 1)), 9.5, ui.MUTED))
	for a in acts:
		row.add_child(a)
	return row

func _mini(text: String, col: Color, cb: Callable) -> Button:
	var b: Button = ui._button(text, 11, col)
	b.custom_minimum_size = Vector2(30, 30)
	b.pressed.connect(cb)
	return b

func build_friends(parent: VBoxContainer) -> void:
	parent.add_child(ui._label("👥 ДРУЗЬЯ", 13, ui.GOLD))
	if not active:
		parent.add_child(ui._panel_text("Друзья доступны после входа в аккаунт."))
		return
	var add_card: PanelContainer = ui._card()
	var av: VBoxContainer = ui._vbox(8)
	var ar: HBoxContainer = ui._row(6)
	var name_edit := LineEdit.new()
	name_edit.placeholder_text = "Ник игрока"
	name_edit.max_length = 16
	name_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_edit.mouse_filter = Control.MOUSE_FILTER_PASS
	name_edit.text_submitted.connect(func(_t: String) -> void: _friend_add(name_edit))
	ar.add_child(name_edit)
	var add_btn: Button = ui._button("+ Добавить", 12)
	add_btn.pressed.connect(_friend_add.bind(name_edit))
	ar.add_child(add_btn)
	av.add_child(ar)
	av.add_child(ui._label("Заявка появится у игрока сразу. Личные сообщения — только друзьям.", 10, ui.MUTED, true))
	add_card.add_child(av)
	parent.add_child(add_card)

	var inc: Array = friends.get("incoming", [])
	if not inc.is_empty():
		parent.add_child(ui._label("ВХОДЯЩИЕ ЗАЯВКИ", 11.5, ui.GOLD))
		var ic: PanelContainer = ui._card(Color(ui.GREEN, 0.25), 14)
		var iv: VBoxContainer = ui._vbox(6)
		for f in inc:
			if typeof(f) != TYPE_DICTIONARY:
				continue
			var nm := String(f.get("name", ""))
			iv.add_child(_friend_item(f, [
				_mini("✅", ui.GREEN, func() -> void: _friend_accept(nm)),
				_mini("✖", ui.RED, func() -> void: _friend_decline(nm)),
			]))
		ic.add_child(iv)
		parent.add_child(ic)

	var outg: Array = friends.get("outgoing", [])
	if not outg.is_empty():
		parent.add_child(ui._label("ИСХОДЯЩИЕ ЗАЯВКИ", 11.5, ui.GOLD))
		var oc: PanelContainer = ui._card(Color(ui.LINE, 0.9), 14)
		var ov: VBoxContainer = ui._vbox(6)
		for f in outg:
			if typeof(f) != TYPE_DICTIONARY:
				continue
			var nm2 := String(f.get("name", ""))
			ov.add_child(_friend_item(f, [
				_mini("Отменить", ui.RED, func() -> void: _friend_decline(nm2)),
			]))
		oc.add_child(ov)
		parent.add_child(oc)

	var fl: Array = friends.get("friends", [])
	parent.add_child(ui._label("СПИСОК ДРУЗЕЙ (%d)" % fl.size(), 11.5, ui.GOLD))
	var fc: PanelContainer = ui._card(Color(ui.LINE, 0.9), 14)
	var fv: VBoxContainer = ui._vbox(6)
	if fl.is_empty():
		fv.add_child(ui._label("Пока никого. Добавьте друга по нику!", 11, ui.MUTED, true))
	else:
		for f in fl:
			if typeof(f) != TYPE_DICTIONARY:
				continue
			var nm3 := String(f.get("name", ""))
			fv.add_child(_friend_item(f, [
				_mini("💬", ui.TEXT, func() -> void: open_dm(nm3)),
				_mini("💸", ui.GOLD, func() -> void: prefill_transfer(nm3)),
				_mini("🗑", ui.RED, func() -> void: _friend_remove(nm3)),
			]))
	fc.add_child(fv)
	parent.add_child(fc)

	_build_transfer(parent)
	load_tx()

func _build_transfer(parent: VBoxContainer) -> void:
	parent.add_child(ui._label("💸 ПЕРЕВОД", 13, ui.GOLD))
	_tr_name = null
	_tr_amt = null
	_tr_note = null
	_avail_lbl = null
	_tr_hist = null
	_tr_card = null
	var cfg: Dictionary = net.me.get("cfg", {}) if net != null else {}
	var fee_pct: int = int(round(float(cfg.get("fee", 0.05)) * 100.0))
	var min_tr: float = float(cfg.get("minTransfer", 1000.0))
	var card: PanelContainer = ui._card(Color(ui.GOLD, 0.18))
	var v: VBoxContainer = ui._vbox(8)
	v.add_child(ui._label("Комиссия %d%% платится сверху: получатель получает ровно указанную сумму. Минимум 🪙 %s. Можно писать 5K, 2.5M, 1B, 3T." % [fee_pct, VCGame.fmt(min_tr)], 11, ui.MUTED, true))
	_tr_name = LineEdit.new()
	_tr_name.placeholder_text = "Ник получателя"
	_tr_name.max_length = 16
	_tr_name.text = _tr_prefill
	_tr_name.mouse_filter = Control.MOUSE_FILTER_PASS
	v.add_child(_tr_name)
	_tr_amt = LineEdit.new()
	_tr_amt.placeholder_text = "Сумма, например 10M"
	_tr_amt.mouse_filter = Control.MOUSE_FILTER_PASS
	_tr_amt.text_changed.connect(_tr_preview)
	v.add_child(_tr_amt)
	_tr_note = ui._label("Введите сумму", 10.5, ui.MUTED, true)
	v.add_child(_tr_note)
	_avail_lbl = ui._label("В облаке доступно: 🪙 %s" % VCGame.fmt(avail), 11, ui.GREEN)
	v.add_child(_avail_lbl)
	var send: Button = ui._button("💸 Отправить", 13, ui.GOLD)
	send.custom_minimum_size = Vector2(0, 42)
	send.pressed.connect(_do_transfer)
	v.add_child(send)
	card.add_child(v)
	parent.add_child(card)
	_tr_card = card

	_tr_hist = ui._vbox(4)
	parent.add_child(ui._label("ПОСЛЕДНИЕ ОПЕРАЦИИ", 11.5, ui.GOLD))
	parent.add_child(_tr_hist)
	_render_tx()

func _tr_preview(text: String) -> void:
	if _tr_note == null or not is_instance_valid(_tr_note):
		return
	var amt := parse_amount(text)
	var cfg: Dictionary = net.me.get("cfg", {}) if net != null else {}
	if amt <= 0.0:
		_tr_note.text = "Введите сумму"
		_tr_note.add_theme_color_override("font_color", ui.MUTED)
		return
	var fee := maxf(1.0, ceil(amt * float(cfg.get("fee", 0.05))))
	_tr_note.text = "Получатель получит 🪙 %s · спишется 🪙 %s (комиссия 🪙 %s)" % [
		VCGame.fmt(amt), VCGame.fmt(amt + fee), VCGame.fmt(fee)]
	var enough := game.total_money() >= amt + fee
	_tr_note.add_theme_color_override("font_color", ui.GREEN if enough else ui.RED)

func _do_transfer() -> void:
	if transfer_busy or not active or net == null or not net.authed:
		return
	if _tr_name == null or _tr_amt == null:
		return
	if ui._conflict_open:
		ui._toast("Сначала решите, какое сохранение оставить")
		return
	var to := _tr_name.text.strip_edges()
	if to == "":
		ui._toast("Введите ник получателя")
		return
	var amt := parse_amount(_tr_amt.text)
	var cfg: Dictionary = net.me.get("cfg", {})
	if amt < float(cfg.get("minTransfer", 1000.0)):
		ui._toast("Минимум 🪙 %s" % VCGame.fmt(float(cfg.get("minTransfer", 1000.0))))
		return
	var fee := maxf(1.0, ceil(amt * float(cfg.get("fee", 0.05))))
	if game.total_money() < amt + fee:
		ui._toast("Не хватает денег: нужно 🪙 %s" % VCGame.fmt(amt + fee))
		return
	transfer_busy = true
	var tries := 0
	while ui._pushing and tries < 40:
		await ui.get_tree().create_timer(0.1).timeout
		tries += 1
	var pushed: Dictionary = await ui._push_cloud(false)
	if not bool(pushed.get("ok", false)):
		transfer_busy = false
		if String(pushed.get("err", "")) != "conflict":
			ui._toast("❌ " + String(pushed.get("err", "Нет связи с облаком")))
		else:
			ui._toast("Сначала решите, какое сохранение оставить")
		return
	var r: Dictionary = await net.transfer(to, amt)
	transfer_busy = false
	if not bool(r.get("ok", false)):
		ui._toast("❌ " + String(r.get("err", "Перевод не выполнен")))
		return
	avail = float(r.get("avail", avail))
	ui._toast("💸 Переведено 🪙 %s · комиссия 🪙 %s" % [VCGame.fmt(amt), VCGame.fmt(fee)])
	if _tr_amt != null and is_instance_valid(_tr_amt):
		_tr_amt.text = ""
	_tr_preview("")
	await pull_wallet()
	load_tx()

func key(s: String) -> String:
	return s.strip_edges().to_lower()
