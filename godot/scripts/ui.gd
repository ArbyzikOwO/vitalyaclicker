extends Control
## Интерфейс Godot-версии: верхняя панель, вкладки и разделы.
## Вся логика — в VCGame, здесь только отрисовка и обработка нажатий.

const GOLD := Color("ffc93c")
const GOLD2 := Color("ff9f1c")
const TEXT := Color("e8ecf3")
const MUTED := Color("8792a6")
const BG := Color("0b0e14")
const CARD := Color("1b2231")
const CARD2 := Color("151b27")
const LINE := Color("2b3548")
const GREEN := Color("3ddc84")
const RED := Color("ff5c5c")

var game: VCGame
var _money_lbl: Label
var _sub_lbl: Label
var _skin_btn: Button
var _tab_bar: HBoxContainer
var _content: VBoxContainer
var _toast_box: VBoxContainer
var _tab := "click"
var _refreshers: Array[Callable] = []
var _tick := 0.0
var _ui_tick := 0.0
var _save_tick := 0.0
var _news_tick := 0.0

func _ready() -> void:
	game = VCGame.new()
	var loaded := game.load_game()
	if loaded:
		var off := game.apply_offline()
		if off > 60.0:
			_toast_deferred("⏳ Оффлайн: +%s монет за %d мин" % [
				VCGame.fmt(game.per_sec() * off), int(off / 60.0)])
	if not loaded:
		game.new_game()
	_build_theme()
	_build_ui()
	_show_tab("click")

func _notification(what: int) -> void:
	if (what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_PREDELETE) and game != null:
		game.save()

func _process(delta: float) -> void:
	_tick += delta
	if _tick >= 0.25:
		game.tick(_tick)
		_tick = 0.0
	_ui_tick += delta
	if _ui_tick >= 0.4:
		_ui_tick = 0.0
		_update_header()
		for f in _refreshers:
			f.call()
	_save_tick += delta
	if _save_tick >= 5.0:
		_save_tick = 0.0
		game.save()
	_news_tick += delta
	if _news_tick >= 5.0:
		_news_tick = 0.0
		for txt in game.news_tick():
			_toast("📰 " + txt)

# ── тема и мелкие помощники ───────────────────────────────────────────────────
func _build_theme() -> void:
	var th := Theme.new()
	th.default_font_size = 14

	var normal := _sbox(CARD, LINE, 1, 12)
	var hover := _sbox(CARD.lightened(0.06), GOLD, 1, 12)
	var pressed := _sbox(CARD.darkened(0.18), GOLD, 1, 12)
	var focus := _sbox(CARD, GOLD, 1, 12)
	for st in [["normal", normal], ["hover", hover], ["pressed", pressed], ["focus", focus], ["disabled", _sbox(CARD.darkened(0.1), LINE, 1, 12)]]:
		th.set_stylebox(st[0], "Button", st[1])
	th.set_color("font_color", "Button", TEXT)
	th.set_color("font_hover_color", "Button", GOLD)
	th.set_color("font_pressed_color", "Button", GOLD)
	th.set_color("font_disabled_color", "Button", Color(MUTED, 0.6))
	th.set_font_size("font_size", "Button", 14)

	var le := _sbox(Color("0e1219"), LINE, 1, 10)
	le.set_content_margin_all(10)
	th.set_stylebox("normal", "LineEdit", le)
	th.set_stylebox("focus", "LineEdit", _sbox(Color("0e1219"), GOLD, 1, 10))
	th.set_color("font_color", "LineEdit", TEXT)
	th.set_color("font_placeholder_color", "LineEdit", Color(MUTED, 0.7))

	th.set_stylebox("panel", "PanelContainer", _sbox(CARD2, LINE, 1, 14))

	var slider_bg := _sbox(Color("0e1219"), LINE, 1, 6)
	th.set_stylebox("slider", "HSlider", slider_bg)
	th.set_stylebox("grabber_area", "HSlider", _sbox(GOLD2, GOLD2, 0, 6))
	th.set_stylebox("grabber_area_highlight", "HSlider", _sbox(GOLD, GOLD, 0, 6))
	theme = th

func _sbox(bg: Color, border: Color, w: int, radius: int) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = border
	sb.set_border_width_all(w)
	sb.set_corner_radius_all(radius)
	sb.set_content_margin_all(10)
	return sb

func _label(text: String, size := 14, color := TEXT, wrap := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if wrap:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return l

func _button(text: String, size := 14, color := TEXT) -> Button:
	var b := Button.new()
	b.text = text
	b.add_theme_font_size_override("font_size", size)
	b.add_theme_color_override("font_color", color)
	b.custom_minimum_size = Vector2(0, 40)
	return b

func _card() -> PanelContainer:
	var p := PanelContainer.new()
	p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return p

func _row(sep := 8) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", sep)
	h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return h

func _vbox(sep := 8) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", sep)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return v

func _spacer() -> Control:
	var c := Control.new()
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return c

func _toast(text: String) -> void:
	var l := _label(text, 13, TEXT, true)
	var p := PanelContainer.new()
	var sb := _sbox(Color(0.13, 0.15, 0.2, 0.97), GOLD, 1, 10)
	p.add_theme_stylebox_override("panel", sb)
	p.add_child(l)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toast_box.add_child(p)
	var tw := create_tween()
	tw.tween_interval(2.6)
	tw.tween_property(p, "modulate:a", 0.0, 0.35)
	tw.tween_callback(p.queue_free)

func _toast_deferred(text: String) -> void:
	call_deferred("_toast", text)

# ── каркас ────────────────────────────────────────────────────────────────────
func _build_ui() -> void:
	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)

	var root := VBoxContainer.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.offset_left = 14
	root.offset_right = -14
	root.offset_top = 12
	root.offset_bottom = -10
	root.add_theme_constant_override("separation", 10)
	add_child(root)

	# верхняя панель
	var top := _card()
	var tv := _vbox(4)
	_money_lbl = _label("🪙 0", 30, GOLD)
	_money_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_sub_lbl = _label("0/сек · 1/клик", 12, MUTED)
	_sub_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tv.add_child(_money_lbl)
	tv.add_child(_sub_lbl)
	top.add_child(tv)
	root.add_child(top)

	# кнопка клика
	_skin_btn = _button("🪙 КЛИК", 24, GOLD)
	_skin_btn.custom_minimum_size = Vector2(0, 92)
	_skin_btn.add_theme_stylebox_override("normal", _sbox(CARD, GOLD, 2, 18))
	_skin_btn.add_theme_stylebox_override("hover", _sbox(CARD.lightened(0.07), GOLD, 2, 18))
	_skin_btn.add_theme_stylebox_override("pressed", _sbox(CARD.darkened(0.15), GOLD, 2, 18))
	_skin_btn.pressed.connect(_on_click)
	root.add_child(_skin_btn)

	# вкладки
	_tab_bar = HBoxContainer.new()
	_tab_bar.add_theme_constant_override("separation", 6)
	_tab_bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	root.add_child(_tab_bar)
	for t in [["click", "🖱️ Клик"], ["up", "⬆️ Апгрейды"], ["skins", "🎭 Скины"],
			["casino", "🎰 Казино"], ["crypto", "💎 Крипта"], ["more", "📦 Ещё"]]:
		var b := _button(String(t[1]), 12)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size = Vector2(0, 44)
		b.pressed.connect(_show_tab.bind(String(t[0])))
		_tab_bar.add_child(b)

	# контент
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	root.add_child(scroll)

	_content = _vbox(10)
	_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_content)

	# тосты поверх
	_toast_box = VBoxContainer.new()
	_toast_box.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	_toast_box.offset_left = 16
	_toast_box.offset_right = -16
	_toast_box.offset_top = -120
	_toast_box.offset_bottom = -16
	_toast_box.alignment = BoxContainer.ALIGNMENT_END
	_toast_box.add_theme_constant_override("separation", 6)
	_toast_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_toast_box)

func _update_header() -> void:
	_money_lbl.text = "🪙 " + VCGame.fmt(game.total_money())
	var sk := game.skin_by_id(int(game.s["skin"]))
	var nm := String(sk.get("name", "Виталя 69"))
	_sub_lbl.text = "%s/сек · %s/клик · скин: %s" % [
		VCGame.fmt(game.per_sec()), VCGame.fmt(game.per_click()), nm]
	if sk.has("src") and String(sk["src"]) != "":
		_skin_btn.text = "🪙 КЛИК\n" + nm
	else:
		_skin_btn.text = "🪙 КЛИК"

func _on_click() -> void:
	game.click()
	_update_header()

func _show_tab(tab: String) -> void:
	_tab = tab
	var i := 0
	for b in _tab_bar.get_children():
		var active := i == _tab_index(tab)
		var sb := _sbox(GOLD if active else CARD, GOLD if active else LINE, 1, 12)
		b.add_theme_stylebox_override("normal", sb)
		b.add_theme_color_override("font_color", GOLD if active else MUTED)
		i += 1
	_rebuild()

func _tab_index(tab: String) -> int:
	return ["click", "up", "skins", "casino", "crypto", "more"].find(tab)

func _rebuild() -> void:
	for c in _content.get_children():
		c.queue_free()
	_refreshers.clear()
	match _tab:
		"click": _build_click()
		"up": _build_upgrades()
		"skins": _build_skins()
		"casino": _build_casino()
		"crypto": _build_crypto()
		"more": _build_more()
	_update_header()

# ── КЛИК ──────────────────────────────────────────────────────────────────────
func _build_click() -> void:
	var c := _card()
	var v := _vbox(8)
	v.add_child(_label("ТВОЙ СКИН", 12, MUTED))
	var sk := game.skin_by_id(int(game.s["skin"]))
	var h := _row(12)
	var img := _skin_image(sk, 96)
	h.add_child(img)
	var info := _vbox(4)
	info.add_child(_label(String(sk.get("name", "Виталя 69")), 18, GOLD))
	var mult := float(sk.get("mult", 1.0))
	info.add_child(_label("Множитель ×%s" % VCGame.fmt_mult(mult), 13, TEXT))
	if sk.has("note"):
		info.add_child(_label(String(sk["note"]), 12, MUTED, true))
	h.add_child(info)
	v.add_child(h)

	var stats := _vbox(4)
	stats.add_child(_label("Кликов: %d" % int(game.s["clicks"]), 13, TEXT))
	stats.add_child(_label("Всего монет: 🪙 %s" % VCGame.fmt(game.total_money()), 13, TEXT))
	stats.add_child(_label("В секунду: %s · за клик: %s" % [VCGame.fmt(game.per_sec()), VCGame.fmt(game.per_click())], 13, MUTED))
	v.add_child(stats)
	c.add_child(v)
	_content.add_child(c)

	var tip := _panel_text("Жми большую кнопку сверху. Апгрейды увеличивают доход, скины — множитель и удачу. Прогресс сохраняется сам.")
	_content.add_child(tip)
	var stage := _card()
	var sv := _vbox(4)
	sv.add_child(_label("ПОРТ НА GODOT · ЭТАП 1", 12, GOLD))
	sv.add_child(_label("Готова оффлайн-игра: клик, апгрейды, скины и крафт, казино, крипта, майнинг, кредиты, новости, достижения, автосохранение и оффлайн-доход. Облако, аккаунты, чат, карты и сад — следующие этапы.", 11, MUTED, true))
	stage.add_child(sv)
	_content.add_child(stage)

func _panel_text(text: String) -> PanelContainer:
	var p := _card()
	p.add_child(_label(text, 12, MUTED, true))
	return p

func _skin_image(sk: Dictionary, px: int) -> Control:
	var src := String(sk.get("src", ""))
	if src == "":
		var holder := PanelContainer.new()
		holder.custom_minimum_size = Vector2(px, px)
		var sb := _sbox(CARD, LINE, 1, 14)
		holder.add_theme_stylebox_override("panel", sb)
		var l := _label("⚡", 38, GOLD)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		holder.add_child(l)
		return holder
	var path := "res://assets/skins/" + src
	if not ResourceLoader.exists(path):
		var p2 := PanelContainer.new()
		p2.custom_minimum_size = Vector2(px, px)
		p2.add_child(_label("нет фото", 11, MUTED))
		return p2
	var tr := TextureRect.new()
	tr.texture = load(path)
	tr.custom_minimum_size = Vector2(px, px)
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	tr.clip_contents = true
	return tr

# ── АПГРЕЙДЫ ──────────────────────────────────────────────────────────────────
func _build_upgrades() -> void:
	var head := _row()
	head.add_child(_label("УЛУЧШЕНИЯ", 13, GOLD))
	head.add_child(_spacer())
	head.add_child(_label("ур. / цена", 11, MUTED))
	_content.add_child(head)

	for u in VCData.IDLE + VCData.CLICK:
		var id := String(u["id"])
		var card := _card()
		var h := _row(10)
		var ic := _label(String(u.get("icon", "⭐")), 24, TEXT)
		ic.custom_minimum_size = Vector2(34, 0)
		h.add_child(ic)
		var mid := _vbox(2)
		var title := _label(String(u["name"]), 14, TEXT)
		mid.add_child(title)
		mid.add_child(_label(String(u.get("desc", "")), 11.5, MUTED))
		h.add_child(mid)
		h.add_child(_spacer())
		var right := _vbox(4)
		var lvl := _label("ур. %d" % game.level(id), 12, GOLD)
		lvl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		var cost := upgrade_cost_now(u)
		var buy := _button(_cost_text(cost), 12)
		if id == "starost" and game.level(id) > 0:
			buy.text = "Куплено"
			buy.disabled = true
		buy.pressed.connect(_on_buy_upgrade.bind(id))
		right.add_child(lvl)
		right.add_child(buy)
		h.add_child(right)
		card.add_child(h)
		_content.add_child(card)
		_refreshers.append(func():
			lvl.text = "ур. %d" % game.level(id)
			if not buy.disabled:
				buy.text = _cost_text(upgrade_cost_now(u))
				buy.modulate.a = 1.0 if game.total_money() >= upgrade_cost_now(u) else 0.6
		)

func upgrade_cost_now(u: Dictionary) -> float:
	return game.upgrade_cost(u)

func _cost_text(cost: float) -> String:
	return "🪙 " + VCGame.fmt(cost)

func _on_buy_upgrade(id: String) -> void:
	if game.buy_upgrade(id):
		_toast("⬆️ Куплено: %s" % _up_name(id))
		_rebuild()
	else:
		_toast("❌ Не хватает монет")

func _up_name(id: String) -> String:
	for u in VCData.IDLE + VCData.CLICK:
		if u["id"] == id:
			return String(u["name"])
	return id

# ── СКИНЫ ─────────────────────────────────────────────────────────────────────
func _build_skins() -> void:
	_content.add_child(_label("СКИНЫ", 13, GOLD))
	var grid := HFlowContainer.new()
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_content.add_child(grid)
	for sk in VCData.SKINS:
		grid.add_child(_skin_card(sk))

	var h2 := _row()
	h2.add_child(_label("КРАФТ", 13, GOLD))
	h2.add_child(_spacer())
	h2.add_child(_label("10 одинаковых → 1 другой", 11, MUTED))
	_content.add_child(h2)
	for r in VCData.RECIPES:
		var card := _card()
		var h := _row(8)
		var have := _recipe_have(r)
		h.add_child(_label("%d× %s → %s" % [int(r["count"]), _skin_name(int(r["need"])), _skin_name(int(r["give"]))], 12.5, TEXT))
		h.add_child(_spacer())
		var b := _button("Скрафтить", 12)
		b.disabled = have < 1
		b.pressed.connect(_on_craft.bind(r))
		h.add_child(b)
		card.add_child(h)
		_content.add_child(card)

func _skin_name(id: int) -> String:
	var sk := game.skin_by_id(id)
	return String(sk.get("name", str(id)))

func _recipe_have(r: Dictionary) -> int:
	return game.can_craft(r)

func _skin_card(sk: Dictionary) -> Control:
	var id := int(sk["id"])
	var card := _card()
	card.custom_minimum_size = Vector2(128, 0)
	var v := _vbox(4)
	v.add_child(_skin_image(sk, 104))
	var name := _label(String(sk["name"]), 12, TEXT)
	name.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(name)
	v.add_child(_label("×%s" % VCGame.fmt_mult(float(sk.get("mult", 1.0))), 11, MUTED))
	if sk.has("note"):
		var note := _label(String(sk["note"]), 10, MUTED, true)
		v.add_child(note)
	var owned := game.owns_skin(id)
	var selected := int(game.s["skin"]) == id
	var btn := _button("Выбран" if selected else ("Выбрать" if owned else _skin_price_text(sk)), 11)
	btn.disabled = selected
	if not owned:
		var price := float(sk.get("price", -1.0))
		btn.disabled = price < 0.0 or game.total_money() < price
		btn.pressed.connect(_on_buy_skin.bind(id))
	else:
		btn.pressed.connect(_on_select_skin.bind(id))
	v.add_child(btn)
	card.add_child(v)
	return card

func _skin_price_text(sk: Dictionary) -> String:
	var price := float(sk.get("price", -1.0))
	if price < 0.0:
		return "Крафт"
	return "🪙 " + VCGame.fmt(price)

func _on_buy_skin(id: int) -> void:
	var err := game.buy_skin(id)
	if err != "":
		_toast("❌ " + err)
		return
	game.select_skin(id)
	_toast("🎭 Куплен скин: " + _skin_name(id))
	_rebuild()

func _on_select_skin(id: int) -> void:
	if game.select_skin(id):
		_toast("🎭 Скин: " + _skin_name(id))
		_rebuild()
		_update_header()

func _on_craft(r: Dictionary) -> void:
	if not game.craft(r, 1):
		_toast("❌ Мало скинов для крафта")
		return
	_toast("⚒️ Скрафчено: " + _skin_name(int(r["give"])))
	_rebuild()

# ── КАЗИНО ────────────────────────────────────────────────────────────────────
var _bet_input: LineEdit
var _mult_slider: HSlider
var _mult_lbl: Label
var _chance_lbl: Label
var _result_lbl: Label
var _spins_lbl: Label

func _build_casino() -> void:
	if not bool(game.s["propusk"]):
		var card := _card()
		var v := _vbox(8)
		v.add_child(_label("🎟️ КАЗИНО ЗАКРЫТО", 16, GOLD))
		v.add_child(_label("Нужен пропуск в Бурмалду — он открывает слоты, множители и удачу.", 12, MUTED, true))
		var b := _button("Купить пропуск · 🪙 " + VCGame.fmt(float(VCData.CASINO["pass_price"])), 14, GOLD)
		b.disabled = game.total_money() < float(VCData.CASINO["pass_price"])
		b.pressed.connect(_on_buy_pass)
		v.add_child(b)
		card.add_child(v)
		_content.add_child(card)
		return

	var top := _card()
	var tv := _vbox(8)
	_spins_lbl = _label("", 12, MUTED)
	tv.add_child(_spins_lbl)
	var bet_row := _row(8)
	bet_row.add_child(_label("Ставка", 13, TEXT))
	_bet_input = LineEdit.new()
	_bet_input.text = "1000"
	_bet_input.placeholder_text = "ставка"
	_bet_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bet_row.add_child(_bet_input)
	tv.add_child(bet_row)

	var mrow := _row(8)
	mrow.add_child(_label("Множитель", 13, TEXT))
	_mult_lbl = _label("x1.5", 14, GOLD)
	mrow.add_child(_spacer())
	mrow.add_child(_mult_lbl)
	tv.add_child(mrow)
	_mult_slider = HSlider.new()
	_mult_slider.min_value = float(VCData.CASINO["mult_min"])
	_mult_slider.max_value = float(VCData.CASINO["mult_max"])
	_mult_slider.step = float(VCData.CASINO["step"])
	_mult_slider.value = float(game.s["casino"]["multiplier"])
	_mult_slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_mult_slider.value_changed.connect(_on_mult_changed)
	tv.add_child(_mult_slider)
	_chance_lbl = _label("", 12, MUTED)
	tv.add_child(_chance_lbl)

	var spin := _button("🎰 КРУТИТЬ", 20, GOLD)
	spin.custom_minimum_size = Vector2(0, 62)
	spin.add_theme_stylebox_override("normal", _sbox(CARD, GOLD, 2, 16))
	spin.pressed.connect(_on_spin)
	tv.add_child(spin)
	_result_lbl = _label("", 16, TEXT)
	_result_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tv.add_child(_result_lbl)
	top.add_child(tv)
	_content.add_child(top)

	if not bool(game.s["vnv_pass"]):
		var vip := _card()
		var vv := _vbox(6)
		vv.add_child(_label("🎫 Пропуск в Верхний Новгород", 14, TEXT))
		vv.add_child(_label("Обнуляет счётчик прокруток и множитель — «безлимит».", 11.5, MUTED, true))
		var vb := _button("Купить · 🪙 " + VCGame.fmt(float(VCData.CASINO["vip_price"])), 12)
		vb.disabled = game.total_money() < float(VCData.CASINO["vip_price"])
		vb.pressed.connect(_on_buy_vip)
		vv.add_child(vb)
		vip.add_child(vv)
		_content.add_child(vip)

	_refreshers.append(_refresh_casino)

func _refresh_casino() -> void:
	if _spins_lbl == null or not is_instance_valid(_spins_lbl):
		return
	_spins_lbl.text = "Прокруток: %d · сброс каждые %d" % [int(game.s["casino"]["total_spins"]), int(VCData.CASINO["decay_spins"])]
	var m := float(game.s["casino"]["multiplier"])
	_mult_lbl.text = "x" + VCGame.fmt_mult(m)
	_chance_lbl.text = "Шанс выигрыша: " + VCGame.fmt_chance(game.win_chance(m))

func _on_mult_changed(v: float) -> void:
	game.set_multiplier(v)
	_refresh_casino()

func _on_buy_pass() -> void:
	var err := game.buy_pass()
	if err != "":
		_toast("❌ " + err)
		return
	_toast("🎟️ Казино открыто")
	_rebuild()

func _on_buy_vip() -> void:
	var err := game.buy_vip()
	if err != "":
		_toast("❌ " + err)
		return
	_toast("🎫 Верхний Новгород куплен")
	_rebuild()

func _on_spin() -> void:
	var bet := 0.0
	if _bet_input != null:
		bet = float(_bet_input.text)
	var r := game.spin(bet)
	if not bool(r.get("ok", false)):
		_toast("❌ " + String(r.get("err", "Ошибка")))
		return
	if bool(r["win"]):
		_result_lbl.text = "🎉 ВЫИГРЫШ ×%s  +%s 🪙" % [VCGame.fmt_mult(float(r["mult"])), VCGame.fmt(float(r["amount"]) - float(r["bet"]))]
		_result_lbl.add_theme_color_override("font_color", GREEN)
	else:
		_result_lbl.text = "💀 ПРОИГРЫШ  −%s 🪙" % VCGame.fmt(float(r["bet"]))
		_result_lbl.add_theme_color_override("font_color", RED)
	_mult_slider.value = float(game.s["casino"]["multiplier"])
	_refresh_casino()
	_update_header()

# ── КРИПТА И МАЙНИНГ ──────────────────────────────────────────────────────────
var _crypto_labels := {}

func _build_crypto() -> void:
	_content.add_child(_label("КРИПТА", 13, GOLD))
	_crypto_labels.clear()
	for k in VCData.CRYPTO["keys"]:
		var card := _card()
		var v := _vbox(6)
		var h := _row()
		h.add_child(_label(String(VCData.CRYPTO["coins"][k]["name"]), 15, TEXT))
		h.add_child(_spacer())
		var price_lbl := _label("", 14, GOLD)
		h.add_child(price_lbl)
		v.add_child(h)
		var held_lbl := _label("", 12, MUTED)
		v.add_child(held_lbl)
		var row := _row(6)
		var qty := LineEdit.new()
		qty.text = "1"
		qty.custom_minimum_size = Vector2(70, 0)
		row.add_child(qty)
		var buy := _button("Купить", 12)
		buy.pressed.connect(_on_crypto_buy.bind(k, qty))
		row.add_child(buy)
		var sell := _button("Продать всё", 12)
		sell.pressed.connect(_on_crypto_sell.bind(k))
		row.add_child(sell)
		row.add_child(_spacer())
		v.add_child(row)
		card.add_child(v)
		_content.add_child(card)
		_crypto_labels[k] = { "price": price_lbl, "held": held_lbl, "buy": buy }

	_content.add_child(_label("МАЙНИНГ", 13, GOLD))
	var mm := game.mining_mult()
	var info := _panel_text("Видеокарты майнят крипту на фермах. Ломаются со временем — Максим-мастер меняет их сам. Бонус майнинга: ×%s" % VCGame.fmt_mult(mm))
	_content.add_child(info)

	for t in VCData.GPU_PRIORITY:
		var g: Dictionary = VCData.GPU_TYPES[t]
		var card := _card()
		var h := _row(8)
		var v := _vbox(2)
		v.add_child(_label(String(g["name"]), 14, TEXT))
		v.add_child(_label("скорость %s/сек · ломается ~%d ч" % [VCGame.fmt_mult(float(g["speed"])), int(g["hours_to_break"])], 11, MUTED))
		h.add_child(v)
		h.add_child(_spacer())
		var b := _button("🪙 " + VCGame.fmt(float(g["price"])), 12)
		b.pressed.connect(_on_gpu_buy.bind(t))
		h.add_child(b)
		card.add_child(h)
		_content.add_child(card)

	var free_lbl := _label("", 12, MUTED)
	var maxims_lbl := _label("", 12, MUTED)
	_content.add_child(free_lbl)
	_content.add_child(maxims_lbl)

	var mrow := _row(6)
	var mb := _button("Купить Максима · 🪙 " + VCGame.fmt(float(VCData.MINING["maxim_price"])), 12)
	mb.pressed.connect(_on_maxim_buy)
	mrow.add_child(mb)
	var mt := _button("Вкл/выкл", 12)
	mt.pressed.connect(_on_maxim_toggle)
	mrow.add_child(mt)
	_content.add_child(mrow)

	for i in game.s["mining"]["farms"].size():
		var f: Dictionary = game.s["mining"]["farms"][i]
		var card := _card()
		var v := _vbox(6)
		var h := _row()
		h.add_child(_label("Ферма %d → %s" % [i + 1, String(VCData.CRYPTO["coins"][f["crypto"]]["name"])], 13, TEXT))
		h.add_child(_spacer())
		var cnt := _label("%d/%d GPU" % [f["gpus"].size(), int(f["max_gpus"])], 11, MUTED)
		h.add_child(cnt)
		v.add_child(h)
		var chips := _row(4)
		if f["gpus"].is_empty():
			chips.add_child(_label("пусто", 11, MUTED))
		else:
			for gi in f["gpus"].size():
				var gpu: Dictionary = f["gpus"][gi]
				var lbl := "⚠ " + String(gpu["type"]) if bool(gpu["broken"]) else String(gpu["type"])
				var rb := _button(lbl, 10)
				rb.custom_minimum_size = Vector2(0, 30)
				rb.pressed.connect(_on_gpu_remove.bind(i, gi))
				chips.add_child(rb)
		v.add_child(chips)
		var actions := _row(6)
		var inst := _button("Установить GPU", 12)
		inst.pressed.connect(_on_gpu_install.bind(i))
		actions.add_child(inst)
		var slot := _button("+ слот · 🪙 " + VCGame.fmt(float(VCData.MINING["farm_slot_price"])), 11)
		slot.pressed.connect(_on_farm_slot.bind(i))
		actions.add_child(slot)
		v.add_child(actions)
		card.add_child(v)
		_content.add_child(card)

	_refreshers.append(func():
		for k in _crypto_labels:
			var e: Dictionary = _crypto_labels[k]
			var held := float(game.s["crypto"][k]["held"])
			e["price"].text = "🪙 " + VCGame.fmt(game.crypto_price(k))
			e["held"].text = "У тебя: %s · стоит 🪙 %s" % [VCGame.fmt(held), VCGame.fmt(held * game.crypto_price(k))]
			e["buy"].modulate.a = 1.0 if game.total_money() > 0.0 else 0.5
		if is_instance_valid(free_lbl):
			var free_count := 0
			for g in game.s["mining"]["gpus"]:
				if not bool(g["broken"]):
					free_count += 1
			free_lbl.text = "Всего GPU: %d · свободно: %d" % [game.gpus_total(), free_count]
			maxims_lbl.text = "Максимов: %d · режим: %s" % [int(game.s["mining"]["maxims"]), "вкл" if bool(game.s["mining"]["maxims_enabled"]) else "выкл"]
	)

func _on_crypto_buy(k: String, qty_edit: LineEdit) -> void:
	var qty := int(float(qty_edit.text)) if qty_edit.text.is_valid_float() else 1
	var err := game.crypto_buy(k, max(1, qty))
	if err != "":
		_toast("❌ " + err)
		return
	_toast("💎 Куплено: %d" % max(1, qty))
	_update_header()

func _on_crypto_sell(k: String) -> void:
	var err := game.crypto_sell(k)
	if err != "":
		_toast("❌ " + err)
		return
	_toast("💎 Продано")
	_update_header()

func _on_gpu_buy(t: String) -> void:
	var err := game.gpu_buy(t)
	if err != "":
		_toast("❌ " + err)
		return
	_toast("⛏️ Куплена " + t)
	_rebuild()

func _on_gpu_install(i: int) -> void:
	for gi in game.s["mining"]["gpus"].size():
		var g: Dictionary = game.s["mining"]["gpus"][gi]
		if not bool(g["broken"]):
			var err := game.gpu_install(i, gi)
			if err != "":
				_toast("❌ " + err)
			else:
				_toast("⛏️ Установлено")
				_rebuild()
			return
	_toast("Нет свободных GPU")

func _on_gpu_remove(i: int, gi: int) -> void:
	game.gpu_remove(i, gi)
	_rebuild()

func _on_farm_slot(i: int) -> void:
	var err := game.farm_slot_up(i)
	if err != "":
		_toast("❌ " + err)
		return
	_toast("➕ Слот добавлен")
	_rebuild()

func _on_maxim_buy() -> void:
	var err := game.maxim_buy()
	if err != "":
		_toast("❌ " + err)
		return
	_toast("🧑 Куплен Максим")
	_rebuild()

func _on_maxim_toggle() -> void:
	var err := game.maxim_toggle()
	if err != "":
		_toast("❌ " + err)
		return
	_toast("Максим-мастер переключён")
	_rebuild()

# ── ЕЩЁ: КРЕДИТЫ, ДОСТИЖЕНИЯ, НОВОСТИ ─────────────────────────────────────────
var _loan_refresh: Callable

func _build_more() -> void:
	_content.add_child(_label("КРЕДИТ", 13, GOLD))
	var card := _card()
	var v := _vbox(8)
	v.add_child(_label("Один кредит до 1 трлн, срок 1–5 часов, +1%/час. Досрочно — проценты только за использованное время.", 11.5, MUTED, true))
	var row := _row(6)
	var amount := LineEdit.new()
	amount.text = "1000000"
	amount.placeholder_text = "сумма"
	amount.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var hours := LineEdit.new()
	hours.text = "1"
	hours.placeholder_text = "часы"
	hours.custom_minimum_size = Vector2(70, 0)
	row.add_child(amount)
	row.add_child(hours)
	var take := _button("Взять", 12)
	take.pressed.connect(_on_loan_take.bind(amount, hours))
	row.add_child(take)
	v.add_child(row)
	card.add_child(v)
	_content.add_child(card)

	var loans_box := _vbox(6)
	_content.add_child(loans_box)
	_loan_refresh = func():
		for c in loans_box.get_children():
			c.queue_free()
		if game.s["loans"].is_empty():
			loans_box.add_child(_panel_text("Активных кредитов нет"))
			return
		for i in game.s["loans"].size():
			var l: Dictionary = game.s["loans"][i]
			var owed: float = floor(game.loan_owed(l))
			var lc := _card()
			var h := _row(6)
			var lv := _vbox(2)
			lv.add_child(_label("Долг: 🪙 %s" % VCGame.fmt(owed), 13, GOLD))
			lv.add_child(_label("Взято %s · срок %d ч" % [VCGame.fmt(float(l["amount"])), int(l["hours"])], 11, MUTED))
			h.add_child(lv)
			h.add_child(_spacer())
			var pay := _button("💸 Погасить", 12)
			pay.disabled = game.total_money() < owed
			pay.pressed.connect(_on_loan_pay.bind(i))
			h.add_child(pay)
			lc.add_child(h)
			loans_box.add_child(lc)
	_loan_refresh.call()
	_refreshers.append(_loan_refresh)

	_content.add_child(_label("ДОСТИЖЕНИЯ", 13, GOLD))
	var done := 0
	for a in VCData.ACH:
		if game.ach_done(String(a["id"])):
			done += 1
	_content.add_child(_label("Открыто: %d / %d" % [done, VCData.ACH.size()], 12, MUTED))
	var list := _vbox(4)
	_content.add_child(list)
	for a in VCData.ACH:
		var ok := game.ach_done(String(a["id"]))
		var h := _row(6)
		h.add_child(_label(String(a["emoji"]), 16, TEXT))
		var av := _vbox(0)
		av.add_child(_label(String(a["name"]), 12.5, GREEN if ok else TEXT))
		av.add_child(_label(String(a["desc"]), 10.5, MUTED))
		h.add_child(av)
		h.add_child(_spacer())
		h.add_child(_label("✅" if ok else "—", 13, GREEN if ok else MUTED))
		list.add_child(h)

	_content.add_child(_label("НОВОСТИ", 13, GOLD))
	var news := _vbox(4)
	_content.add_child(news)
	if game.s["news_history"].is_empty():
		news.add_child(_panel_text("Пока новостей не было"))
	else:
		for n in game.s["news_history"]:
			var col := GREEN if int(n.get("dir", 0)) > 0 else (RED if int(n.get("dir", 0)) < 0 else MUTED)
			news.add_child(_label("%s  ·  %s" % [_time_str(float(n["time"])), String(n["text"])], 11.5, col, true))

	var sys := _card()
	var sysv := _vbox(6)
	sysv.add_child(_label("СОХРАНЕНИЕ", 12, GOLD))
	sysv.add_child(_label("Файл: %s\nВерсия сохранения: %d · автосейв каждые 5 секунд" % [
		ProjectSettings.globalize_path(game.save_path), int(game.s["version"])], 10.5, MUTED, true))
	var sb := _button("💾 Сохранить сейчас", 12)
	sb.pressed.connect(func() -> void:
		game.save()
		_toast("💾 Сохранено")
	)
	sysv.add_child(sb)
	sys.add_child(sysv)
	_content.add_child(sys)

func _time_str(unix: float) -> String:
	var t := Time.get_time_dict_from_unix_time(int(unix))
	return "%02d:%02d" % [int(t["hour"]), int(t["minute"])]

func _on_loan_take(amount_edit: LineEdit, hours_edit: LineEdit) -> void:
	var amount: float = float(amount_edit.text) if amount_edit.text.is_valid_float() else 0.0
	var hours: int = int(float(hours_edit.text)) if hours_edit.text.is_valid_float() else 1
	var err := game.loan_take(amount, hours)
	if err != "":
		_toast("❌ " + err)
		return
	_toast("🏦 Кредит получен")
	_rebuild()

func _on_loan_pay(i: int) -> void:
	var err := game.loan_pay_early(i)
	if err != "":
		_toast("❌ " + err)
		return
	_toast("✅ Кредит погашен")
	_rebuild()
