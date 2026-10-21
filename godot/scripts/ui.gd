extends Control
## Интерфейс Godot-версии: верхняя панель, вкладки и разделы.
## Вся логика — в VCGame, здесь только отрисовка и обработка нажатий.

const GOLD := Color("ffd75e")
const GOLD2 := Color("ff9f1c")
const GOLD_SOFT := Color("ffe9a8")
const TEXT := Color("eef2f9")
const MUTED := Color("8b96ad")
const BG := Color("080b14")
const CARD := Color("161d2d")
const CARD2 := Color("111726")
const LINE := Color("2a3550")
const GREEN := Color("46e08a")
const RED := Color("ff5d6c")
const PURPLE := Color("9b7bff")

var game: VCGame
var _root: VBoxContainer
var _money_lbl: Label
var _rate_lbl: Label
var _click_lbl: Label
var _skin_lbl: Label
var _skin_btn: Button
var _tab_bar: GridContainer
var _tab_btns: Dictionary = {}
var _content: VBoxContainer
var _scroll: ScrollContainer
var _toast_box: VBoxContainer
var _tab := "click"
var _shown_money := 0.0
var _refreshers: Array[Callable] = []
var _tick := 0.0
var _ui_tick := 0.0
var _save_tick := 0.0
var _news_tick := 0.0
var _side := -1.0

var net: VCNet
var social: VCSocial
var _gate: Control
var _gate_status: Label
var _gate_name: LineEdit
var _gate_pw: LineEdit
var _gate_server: LineEdit
var _gate_busy := false
var _playing := false
var _cloud_rev := 0
var _cloud_tick := 0.0
var _last_digest := ""
var _pushing := false
var _conflict_open := false
var _link_err_at := 0.0
var _skip_gate := false

func _ready() -> void:
	game = VCGame.new()
	game.load_game()   # локальный кэш; облако при входе важнее
	net = VCNet.new()
	net.link_changed.connect(_on_link_changed)
	net.pushed.connect(_on_push)
	add_child(net)
	social = VCSocial.new()
	social.setup(self, net, game)
	_build_theme()
	_build_ui()
	_gate = _build_gate()
	add_child(_gate)
	_root.visible = false
	_shown_money = game.total_money()
	_show_tab("click")
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--peer=") and social != null:
			social.pending_peer = a.substr(7)
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--tab="):
			_show_tab(a.substr(6))
	var win := get_window()
	if win:
		win.min_size = Vector2i(400, 620)
	if _skip_gate or "--offline" in OS.get_cmdline_user_args():
		_begin_play()
		return
	_start_session()

func _notification(what: int) -> void:
	if (what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_PREDELETE) and game != null:
		game.save()

func _process(delta: float) -> void:
	if not _playing:
		_resize_content()
		return
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
		var fired := game.news_tick()
		if fired.size() > 2:
			_toast("📰 Новостей: %d — цены на крипту изменились" % fired.size())
		else:
			for txt in fired:
				_toast("📰 " + txt)
	_animate_money(delta)
	_resize_content()
	_sync_check(delta)
	if social != null:
		social.tick(delta)

func _animate_money(delta: float) -> void:
	var target := game.total_money()
	var diff := target - _shown_money
	if absf(diff) < 0.5:
		_shown_money = target
	else:
		_shown_money += diff * clampf(delta * 9.0, 0.0, 1.0)
	if _money_lbl:
		var txt := "🪙 " + VCGame.fmt(_shown_money)
		if _money_lbl.text != txt:
			_money_lbl.text = txt

func _resize_content() -> void:
	if _root == null:
		return
	var side := maxf(12.0, (size.x - 720.0) * 0.5)
	if absf(side - _side) > 0.5:
		_side = side
		_root.offset_left = side
		_root.offset_right = -side

# ── тема и мелкие помощники ───────────────────────────────────────────────────
func _build_theme() -> void:
	var th := Theme.new()
	th.default_font_size = 15

	var normal := _sbox(CARD, LINE, 1, 12)
	var hover := _sbox(CARD.lightened(0.07), Color(GOLD, 0.55), 1, 12)
	var pressed := _sbox(CARD.darkened(0.2), GOLD, 1, 12)
	var focus := _sbox(Color(0, 0, 0, 0), GOLD, 1, 12)
	var disabled := _sbox(CARD2, Color(LINE, 0.55), 1, 12)
	for pair in [["normal", normal], ["hover", hover], ["pressed", pressed], ["focus", focus], ["disabled", disabled]]:
		th.set_stylebox(pair[0], "Button", pair[1])
	th.set_color("font_color", "Button", TEXT)
	th.set_color("font_hover_color", "Button", GOLD_SOFT)
	th.set_color("font_pressed_color", "Button", GOLD)
	th.set_color("font_disabled_color", "Button", Color(MUTED, 0.68))
	th.set_font_size("font_size", "Button", 14)

	var le := _sbox(Color("0b101c"), LINE, 1, 10)
	le.set_content_margin_all(10)
	th.set_stylebox("normal", "LineEdit", le)
	th.set_stylebox("focus", "LineEdit", _sbox(Color("0b101c"), GOLD, 1, 10))
	th.set_color("font_color", "LineEdit", TEXT)
	th.set_color("font_placeholder_color", "LineEdit", Color(MUTED, 0.7))

	var ob := _sbox(Color("0b101c"), LINE, 1, 10)
	th.set_stylebox("normal", "OptionButton", ob)
	th.set_stylebox("hover", "OptionButton", _sbox(Color("0b101c"), Color(GOLD, 0.65), 1, 10))
	th.set_stylebox("pressed", "OptionButton", _sbox(CARD.darkened(0.15), GOLD, 1, 10))
	th.set_stylebox("focus", "OptionButton", _sbox(Color(0, 0, 0, 0), GOLD, 1, 10))
	th.set_stylebox("disabled", "OptionButton", _sbox(CARD2, Color(LINE, 0.55), 1, 10))
	th.set_color("font_color", "OptionButton", TEXT)
	th.set_color("font_hover_color", "OptionButton", GOLD_SOFT)
	th.set_color("font_pressed_color", "OptionButton", GOLD)
	th.set_color("font_focus_color", "OptionButton", TEXT)
	th.set_font_size("font_size", "OptionButton", 12)
	th.set_stylebox("panel", "PopupMenu", _sbox(CARD, Color(GOLD, 0.35), 1, 12, true))
	th.set_stylebox("hover", "PopupMenu", _sbox(CARD.lightened(0.08), Color(GOLD, 0.6), 1, 8))
	th.set_color("font_color", "PopupMenu", TEXT)
	th.set_color("font_hover_color", "PopupMenu", GOLD_SOFT)
	th.set_color("font_disabled_color", "PopupMenu", MUTED)
	th.set_font_size("font_size", "PopupMenu", 12)

	th.set_stylebox("panel", "PanelContainer", _sbox(CARD, LINE, 1, 18, true))

	var slider_bg := _sbox(Color("0b101c"), Color(0, 0, 0, 0), 0, 5)
	slider_bg.set_content_margin_all(0)
	th.set_stylebox("slider", "HSlider", slider_bg)
	th.set_stylebox("grabber_area", "HSlider", _sbox(GOLD2, GOLD2, 0, 5))
	th.set_stylebox("grabber_area_highlight", "HSlider", _sbox(GOLD, GOLD, 0, 5))
	th.set_icon("grabber", "HSlider", _dot_tex(20, GOLD))
	th.set_icon("grabber_highlight", "HSlider", _dot_tex(22, GOLD_SOFT))
	th.set_icon("grabber_disabled", "HSlider", _dot_tex(20, MUTED))

	var track := _sbox(Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 4)
	track.content_margin_left = 3
	track.content_margin_right = 3
	th.set_stylebox("scroll", "VScrollBar", track)
	var grab := _sbox(Color(1, 1, 1, 0.13), Color(0, 0, 0, 0), 0, 4)
	grab.content_margin_left = 3
	grab.content_margin_right = 3
	th.set_stylebox("grabber", "VScrollBar", grab)
	th.set_stylebox("grabber_highlight", "VScrollBar", _sbox(Color(1, 1, 1, 0.24), Color(0, 0, 0, 0), 0, 4))
	th.set_stylebox("grabber_pressed", "VScrollBar", _sbox(GOLD, GOLD, 0, 4))

	var bar_bg := _sbox(Color("0b101c"), Color(0, 0, 0, 0), 0, 4)
	bar_bg.set_content_margin_all(0)
	var bar_fill := _sbox(GOLD, GOLD, 0, 4)
	bar_fill.set_content_margin_all(0)
	th.set_stylebox("background", "ProgressBar", bar_bg)
	th.set_stylebox("fill", "ProgressBar", bar_fill)
	theme = th

func _dot_tex(px: int, color: Color) -> ImageTexture:
	var img := Image.create(px, px, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var c := (px - 1) * 0.5
	var r := c - 2.0
	for y in px:
		for x in px:
			var d := Vector2(x - c, y - c).length()
			var a := clampf(r - d + 0.6, 0.0, 1.0)
			if a > 0.0:
				img.set_pixel(x, y, Color(color, a))
	return ImageTexture.create_from_image(img)

func _sbox(bg: Color, border: Color, w: int, radius: int, shadow := false) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = border
	sb.set_border_width_all(w)
	sb.set_corner_radius_all(radius)
	sb.set_content_margin_all(12)
	if shadow:
		sb.shadow_color = Color(0, 0, 0, 0.38)
		sb.shadow_size = 12
		sb.shadow_offset = Vector2(0, 5)
	return sb

func _label(text: String, size := 14, color := TEXT, wrap := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if wrap:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

func _glow_label(l: Label, color: Color, size := 2) -> void:
	l.add_theme_color_override("font_shadow_color", Color(color, 0.45))
	l.add_theme_constant_override("shadow_offset_x", 0)
	l.add_theme_constant_override("shadow_offset_y", size)
	l.add_theme_constant_override("shadow_outline_size", size * 3)

func _button(text: String, size := 14, color := TEXT) -> Button:
	var b := Button.new()
	b.text = text
	b.add_theme_font_size_override("font_size", size)
	b.add_theme_color_override("font_color", color)
	b.custom_minimum_size = Vector2(0, 40)
	b.mouse_filter = Control.MOUSE_FILTER_PASS
	return b

func _card(border := LINE, radius := 18) -> PanelContainer:
	var p := PanelContainer.new()
	p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	p.add_theme_stylebox_override("panel", _sbox(CARD, border, 1, radius, true))
	p.mouse_filter = Control.MOUSE_FILTER_PASS
	return p

func _pill(text: String, color := TEXT) -> PanelContainer:
	var p := PanelContainer.new()
	var sb := _sbox(Color(color, 0.10), Color(color, 0.26), 1, 9)
	sb.set_content_margin_all(5)
	p.add_theme_stylebox_override("panel", sb)
	p.add_child(_label(text, 10.5, color))
	p.mouse_filter = Control.MOUSE_FILTER_PASS
	return p

func _row(sep := 8) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", sep)
	h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.mouse_filter = Control.MOUSE_FILTER_PASS
	return h

func _vbox(sep := 8) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", sep)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.mouse_filter = Control.MOUSE_FILTER_PASS
	return v

func _spacer() -> Control:
	var c := Control.new()
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	c.mouse_filter = Control.MOUSE_FILTER_PASS
	return c

func _toast(text: String) -> void:
	if _toast_box == null:
		return
	while _toast_box.get_child_count() >= 2:
		var old := _toast_box.get_child(0)
		_toast_box.remove_child(old)
		old.queue_free()
	var l := _label(text, 12.5, TEXT, true)
	var p := PanelContainer.new()
	var sb := _sbox(Color(0.07, 0.09, 0.15, 0.98), Color(GOLD, 0.5), 1, 12, true)
	sb.border_width_left = 3
	sb.border_color = GOLD
	sb.set_content_margin_all(10)
	p.add_theme_stylebox_override("panel", sb)
	p.add_child(l)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.modulate.a = 0.0
	_toast_box.add_child(p)
	var tw := create_tween()
	tw.tween_property(p, "modulate:a", 1.0, 0.16)
	tw.tween_interval(2.4)
	tw.tween_property(p, "modulate:a", 0.0, 0.4)
	tw.tween_callback(p.queue_free)

func _toast_deferred(text: String) -> void:
	call_deferred("_toast", text)

# ── каркас ────────────────────────────────────────────────────────────────────
func _build_ui() -> void:
	# фон: глубокий градиент + живые монетки и свечения
	var bg := TextureRect.new()
	var grad := Gradient.new()
	grad.offsets = PackedFloat32Array([0.0, 0.55, 1.0])
	grad.colors = PackedColorArray([Color("06080f"), Color("0b1120"), Color("141c33")])
	var gt := GradientTexture2D.new()
	gt.gradient = grad
	gt.fill_from = Vector2(0, 0)
	gt.fill_to = Vector2(0, 1)
	gt.width = 8
	gt.height = 256
	bg.texture = gt
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	bg.stretch_mode = TextureRect.STRETCH_SCALE
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)

	add_child(VCFX.new())

	_root = VBoxContainer.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.offset_left = 14
	_root.offset_right = -14
	_root.offset_top = 12
	_root.offset_bottom = -10
	_root.add_theme_constant_override("separation", 10)
	add_child(_root)

	# шапка: баланс + три показателя
	var top := _card(Color(GOLD, 0.20), 20)
	var tv := _vbox(10)
	var cap := _label("ТВОЙ БАЛАНС", 10, MUTED)
	cap.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_money_lbl = _label("🪙 0", 38, GOLD)
	_money_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_glow_label(_money_lbl, GOLD2, 3)
	var stats := _row(8)
	stats.add_child(_stat_pill("в секунду", GREEN))
	stats.add_child(_stat_pill("за клик", GOLD))
	var skin_pill := _stat_pill("скин", PURPLE)
	stats.add_child(skin_pill)
	_skin_val_lbl = _skin_pill_value
	tv.add_child(cap)
	tv.add_child(_money_lbl)
	tv.add_child(stats)
	top.add_child(tv)
	_root.add_child(top)

	# большая кнопка клика
	_skin_btn = _button("", 24, GOLD)
	_skin_btn.custom_minimum_size = Vector2(0, 104)
	var bn := _sbox(Color("1a2234"), Color(GOLD, 0.75), 2, 20, true)
	bn.shadow_color = Color(GOLD2, 0.18)
	bn.shadow_size = 20
	bn.shadow_offset = Vector2(0, 8)
	var bh := _sbox(Color("1f2a42"), Color(GOLD, 0.95), 2, 20, true)
	bh.shadow_color = Color(GOLD2, 0.30)
	bh.shadow_size = 24
	bh.shadow_offset = Vector2(0, 8)
	var bp := _sbox(Color("121a2a"), Color(GOLD, 0.55), 2, 20)
	_skin_btn.add_theme_stylebox_override("normal", bn)
	_skin_btn.add_theme_stylebox_override("hover", bh)
	_skin_btn.add_theme_stylebox_override("pressed", bp)
	_skin_btn.pressed.connect(_on_click)
	_skin_btn.resized.connect(func() -> void: _skin_btn.pivot_offset = _skin_btn.size * 0.5)
	_root.add_child(_skin_btn)

	# вкладки: сетка 4×2 — на узком экране в один ряд не влезают
	_tab_bar = GridContainer.new()
	_tab_bar.columns = 4
	_tab_bar.add_theme_constant_override("h_separation", 6)
	_tab_bar.add_theme_constant_override("v_separation", 6)
	_tab_bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_root.add_child(_tab_bar)
	for t in [["click", "👆 Клик"], ["up", "📈 Апгрейды"], ["skins", "🎨 Скины"], ["casino", "🎰 Казино"],
			["crypto", "💎 Крипта"], ["chat", "💬 Чат"], ["friends", "👥 Друзья"], ["more", "📦 Ещё"]]:
		var b := _button(String(t[1]), 12)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size = Vector2(0, 42)
		b.clip_text = true
		b.pressed.connect(_show_tab.bind(String(t[0])))
		_tab_bar.add_child(b)
		_tab_btns[String(t[0])] = b

	# контент
	_scroll = ScrollContainer.new()
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_scroll.follow_focus = true
	_root.add_child(_scroll)

	_content = _vbox(12)
	_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_scroll.add_child(_content)

	# тосты поверх
	_toast_box = VBoxContainer.new()
	_toast_box.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	_toast_box.offset_left = 18
	_toast_box.offset_right = -18
	_toast_box.offset_top = -160
	_toast_box.offset_bottom = -16
	_toast_box.alignment = BoxContainer.ALIGNMENT_END
	_toast_box.add_theme_constant_override("separation", 6)
	_toast_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_toast_box)

var _stat_vals: Array[Label] = []
var _skin_pill_value: Label
var _skin_val_lbl: Label

func _stat_pill(caption: String, color: Color) -> PanelContainer:
	var p := PanelContainer.new()
	p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var sb := _sbox(Color(color, 0.07), Color(color, 0.20), 1, 12)
	sb.set_content_margin_all(8)
	p.add_theme_stylebox_override("panel", sb)
	p.mouse_filter = Control.MOUSE_FILTER_PASS
	var v := _vbox(1)
	var val := _label("0", 15, color)
	val.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	val.clip_text = true
	var cap := _label(caption, 10, MUTED)
	cap.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(val)
	v.add_child(cap)
	p.add_child(v)
	_stat_vals.append(val)
	_skin_pill_value = val
	return p

func _update_header() -> void:
	var sk := game.skin_by_id(int(game.s["skin"]))
	var nm := String(sk.get("name", "Виталя 69"))
	if _stat_vals.size() >= 2:
		_stat_vals[0].text = VCGame.fmt(game.per_sec())
		_stat_vals[1].text = VCGame.fmt(game.per_click())
	if _skin_val_lbl:
		_skin_val_lbl.text = nm
		var fs := 14
		if nm.length() > 16:
			fs = 9
		elif nm.length() > 13:
			fs = 10
		elif nm.length() > 10:
			fs = 11
		elif nm.length() > 8:
			fs = 12
		_skin_val_lbl.add_theme_font_size_override("font_size", fs)
	if _skin_btn:
		_skin_btn.text = "🪙  КЛИК\n+" + VCGame.fmt(game.per_click()) + " за клик"

func _on_click() -> void:
	game.click()
	_update_header()
	_spawn_click_fx()
	if _skin_btn:
		_skin_btn.pivot_offset = _skin_btn.size * 0.5
		_skin_btn.scale = Vector2(0.975, 0.975)
		var tw := create_tween()
		tw.tween_property(_skin_btn, "scale", Vector2.ONE, 0.22).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)

func _spawn_click_fx() -> void:
	if _skin_btn == null:
		return
	var l := _label("+" + VCGame.fmt(game.per_click()), 20, GOLD)
	l.add_theme_color_override("font_shadow_color", Color(GOLD2, 0.55))
	l.add_theme_constant_override("shadow_offset_y", 2)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.z_index = 20
	var p0 := _skin_btn.global_position - global_position
	var origin := p0 + Vector2(randf_range(40.0, maxf(60.0, _skin_btn.size.x - 90.0)), 16.0)
	l.position = origin
	add_child(l)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(l, "position:y", origin.y - 84.0, 0.9).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_property(l, "modulate:a", 0.0, 0.5).set_delay(0.45)
	tw.chain().tween_callback(l.queue_free)

func _show_tab(tab: String) -> void:
	_tab = tab
	var i := 0
	for b in _tab_bar.get_children():
		var active := i == _tab_index(tab)
		if active:
			var sb := _sbox(GOLD, GOLD_SOFT, 1, 12, true)
			sb.shadow_color = Color(GOLD2, 0.28)
			sb.shadow_size = 10
			sb.shadow_offset = Vector2(0, 3)
			b.add_theme_stylebox_override("normal", sb)
			b.add_theme_stylebox_override("hover", sb)
			for c in ["font_color", "font_hover_color", "font_focus_color", "font_pressed_color"]:
				b.add_theme_color_override(c, Color("221704"))
		else:
			var sb2 := _sbox(Color(CARD, 0.75), LINE, 1, 12)
			b.add_theme_stylebox_override("normal", sb2)
			b.add_theme_stylebox_override("hover", _sbox(CARD.lightened(0.06), Color(GOLD, 0.4), 1, 12))
			for c in ["font_color", "font_focus_color", "font_pressed_color"]:
				b.add_theme_color_override(c, MUTED)
			b.add_theme_color_override("font_hover_color", GOLD_SOFT)
		i += 1
	_rebuild()
	if social != null:
		if tab == "chat":
			social.on_show_chat()
		elif tab == "friends":
			social.refresh_friends()

func _tab_index(tab: String) -> int:
	return ["click", "up", "skins", "casino", "crypto", "chat", "friends", "more"].find(tab)

func _set_chat_badge(n: int) -> void:
	var b: Button = _tab_btns.get("chat")
	if b == null:
		return
	b.text = "💬 Чат" + ("•" if n > 0 else "")

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
		"chat": _build_chat()
		"friends": _build_friends()
		"more": _build_more()
	_update_header()
	if _scroll:
		_scroll.set_deferred("scroll_vertical", 0)

# ── КЛИК ──────────────────────────────────────────────────────────────────────
func _build_click() -> void:
	var sk := game.skin_by_id(int(game.s["skin"]))
	var nm := String(sk.get("name", "Виталя 69"))
	var mult := float(sk.get("mult", 1.0))
	var c := _card(Color(GOLD, 0.18), 20)
	var v := _vbox(12)

	var h := _row(14)
	var holder := PanelContainer.new()
	var hs := _sbox(CARD2, Color(GOLD, 0.25), 1, 16)
	hs.set_content_margin_all(3)
	holder.add_theme_stylebox_override("panel", hs)
	holder.add_child(_skin_image(sk, 100))
	h.add_child(holder)

	var info := _vbox(6)
	var name_l := _label(nm, 20, GOLD, true)
	_glow_label(name_l, GOLD2, 1)
	info.add_child(name_l)
	var chips := _row(6)
	chips.add_child(_pill("×%s к доходу" % VCGame.fmt_mult(mult), GOLD))
	var lk := game.luck()
	if lk > 0.0:
		chips.add_child(_pill("+%s%% удача" % str(roundi(lk * 100.0)), GREEN))
	chips.add_child(_spacer())
	info.add_child(chips)
	if sk.has("note"):
		info.add_child(_label(String(sk["note"]), 11.5, MUTED, true))
	h.add_child(info)
	v.add_child(h)

	var st := _row(8)
	st.add_child(_mini_stat("КЛИКОВ", str(int(game.s["clicks"]))))
	st.add_child(_mini_stat("ВСЕГО МОНЕТ", VCGame.fmt(game.total_money())))
	st.add_child(_mini_stat("В СЕКУНДУ", VCGame.fmt(game.per_sec())))
	v.add_child(st)

	c.add_child(v)
	_content.add_child(c)

	var tip := _panel_text("Жми большую кнопку сверху. Апгрейды увеличивают доход, скины — множитель и удачу. Прогресс сохраняется сам.")
	_content.add_child(tip)
	var stage := _card(Color(PURPLE, 0.20), 16)
	var sv := _vbox(4)
	sv.add_child(_label("ПОРТ НА GODOT · ЭТАП 2", 11, PURPLE))
	sv.add_child(_label("Аккаунт и облако: прогресс в формате веб-версии (data.bin) синхронизируется сам, сессия помнится 7 дней. Клик, апгрейды, скины и крафт, казино, крипта, майнинг, кредиты, новости, достижения и оффлайн-доход — на месте. Чат, друзья, карты и сад — следующие этапы.", 11, MUTED, true))
	stage.add_child(sv)
	_content.add_child(stage)

func _mini_stat(caption: String, value: String) -> PanelContainer:
	var p := PanelContainer.new()
	p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var sb := _sbox(Color(1, 1, 1, 0.035), Color(1, 1, 1, 0.07), 1, 12)
	sb.set_content_margin_all(8)
	p.add_theme_stylebox_override("panel", sb)
	var v := _vbox(0)
	var val := _label(value, 14, TEXT)
	val.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	val.clip_text = true
	var cap := _label(caption, 9, MUTED)
	cap.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(val)
	v.add_child(cap)
	p.add_child(v)
	return p

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
		var v := _vbox(7)
		var h := _row(10)
		var badge := PanelContainer.new()
		var bs := _sbox(Color(GOLD, 0.10), Color(GOLD, 0.22), 1, 12)
		bs.set_content_margin_all(8)
		badge.add_theme_stylebox_override("panel", bs)
		badge.add_child(_label(String(u.get("icon", "⭐")), 22, TEXT))
		h.add_child(badge)
		var mid := _vbox(2)
		mid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		mid.add_child(_label(String(u["name"]), 14, TEXT, true))
		mid.add_child(_label(String(u.get("desc", "")), 11, MUTED, true))
		h.add_child(mid)
		var right := _vbox(3)
		var lvl := _label("ур. %d" % game.level(id), 11, MUTED)
		lvl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		var cost := upgrade_cost_now(u)
		var buy := _button(_cost_text(cost), 12, GOLD)
		buy.custom_minimum_size = Vector2(92, 36)
		if id == "starost" and game.level(id) > 0:
			buy.text = "Куплено"
			buy.disabled = true
		buy.pressed.connect(_on_buy_upgrade.bind(id))
		right.add_child(lvl)
		right.add_child(buy)
		h.add_child(right)
		v.add_child(h)

		var bar := ProgressBar.new()
		bar.max_value = 100.0
		bar.value = 0.0
		bar.show_percentage = false
		bar.custom_minimum_size = Vector2(0, 5)
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		v.add_child(bar)

		card.add_child(v)
		_content.add_child(card)
		_refreshers.append(func():
			lvl.text = "ур. %d" % game.level(id)
			if buy.disabled:
				bar.value = 100.0
				return
			var c2 := upgrade_cost_now(u)
			buy.text = _cost_text(c2)
			var can := game.total_money() >= c2
			buy.add_theme_color_override("font_color", GOLD if can else Color(MUTED, 0.8))
			bar.value = clampf(game.total_money() / maxf(c2, 1.0) * 100.0, 0.0, 100.0)
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
	var head := _row()
	head.add_child(_label("СКИНЫ", 13, GOLD))
	head.add_child(_spacer())
	var uniq := 0
	for sk in VCData.SKINS:
		if game.owns_skin(int(sk["id"])):
			uniq += 1
	head.add_child(_pill("%d / %d" % [uniq, VCData.SKINS.size()], GOLD))
	_content.add_child(head)
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
		var card := _card(Color(GOLD, 0.12), 14)
		var h := _row(8)
		var have := _recipe_have(r)
		var lv := _vbox(2)
		lv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		lv.add_child(_label("%d× %s → %s" % [int(r["count"]), _skin_name(int(r["need"])), _skin_name(int(r["give"]))], 12.5, TEXT, true))
		lv.add_child(_label("доступно: %d" % have, 10.5, MUTED))
		h.add_child(lv)
		var b := _button("Скрафтить", 12, GOLD if have > 0 else MUTED)
		b.custom_minimum_size = Vector2(96, 36)
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
	var owned := game.owns_skin(id)
	var selected := int(game.s["skin"]) == id
	var mult := float(sk.get("mult", 1.0))
	var ring := LINE
	if selected:
		ring = GOLD
	elif mult >= 6.0:
		ring = Color(GOLD, 0.5)
	elif mult >= 3.0:
		ring = Color(PURPLE, 0.5)

	var card := _card(ring, 16)
	if selected:
		var sb := _sbox(CARD, GOLD, 2, 16, true)
		sb.shadow_color = Color(GOLD2, 0.30)
		sb.shadow_size = 16
		sb.shadow_offset = Vector2(0, 4)
		card.add_theme_stylebox_override("panel", sb)
	card.custom_minimum_size = Vector2(100, 0)
	var v := _vbox(5)
	var holder := PanelContainer.new()
	var hs := _sbox(CARD2, Color(0, 0, 0, 0), 0, 12)
	hs.set_content_margin_all(2)
	holder.add_theme_stylebox_override("panel", hs)
	holder.add_child(_skin_image(sk, 96))
	v.add_child(holder)

	var name := _label(String(sk["name"]), 12, TEXT, true)
	v.add_child(name)
	var chips := _row(4)
	chips.add_child(_pill("×%s" % VCGame.fmt_mult(mult), GOLD if mult >= 3.0 else MUTED))
	if selected:
		chips.add_child(_pill("✓ выбран", GREEN))
	elif owned:
		chips.add_child(_pill("есть", GREEN))
	chips.add_child(_spacer())
	v.add_child(chips)
	if sk.has("note"):
		v.add_child(_label(String(sk["note"]), 9.5, MUTED, true))

	var btn := _button("Выбран" if selected else ("Выбрать" if owned else _skin_price_text(sk)), 11)
	btn.custom_minimum_size = Vector2(0, 34)
	btn.disabled = selected
	if not owned:
		var price := float(sk.get("price", -1.0))
		btn.disabled = price < 0.0 or game.total_money() < price
		if not btn.disabled:
			btn.add_theme_color_override("font_color", GOLD)
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
var _drums: Array[Label] = []
var _spin_btn: Button
var _spinning := false
const REEL := ["🍒", "🍋", "🔔", "💎", "7️⃣", "⭐", "🍀", "🪙"]
var _result_lbl: Label
var _spins_lbl: Label

func _build_casino() -> void:
	_spinning = false
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

	var top := _card(Color(GOLD, 0.15), 20)
	var tv := _vbox(10)
	_spins_lbl = _label("", 11, MUTED)
	_spins_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tv.add_child(_spins_lbl)

	_drums.clear()
	var reels := _row(8)
	for i in 3:
		var cell := PanelContainer.new()
		cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		cell.custom_minimum_size = Vector2(0, 84)
		var cs := _sbox(Color("0b101c"), Color(GOLD, 0.28), 1, 14, true)
		cs.set_content_margin_all(6)
		cell.add_theme_stylebox_override("panel", cs)
		var d := _label(REEL.pick_random(), 40, TEXT)
		d.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		d.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		cell.add_child(d)
		_drums.append(d)
		reels.add_child(cell)
	tv.add_child(reels)

	var bet_row := _row(8)
	bet_row.add_child(_label("Ставка", 13, TEXT))
	_bet_input = LineEdit.new()
	_bet_input.text = "1000"
	_bet_input.mouse_filter = Control.MOUSE_FILTER_PASS
	_bet_input.placeholder_text = "ставка"
	_bet_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bet_row.add_child(_bet_input)
	tv.add_child(bet_row)

	var mrow := _row(8)
	mrow.add_child(_label("Множитель", 13, TEXT))
	_mult_lbl = _label("x1.5", 16, GOLD)
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
	_chance_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tv.add_child(_chance_lbl)

	_spin_btn = _button("🎰  КРУТИТЬ", 20, GOLD)
	_spin_btn.custom_minimum_size = Vector2(0, 60)
	var sn := _sbox(Color("1a2234"), Color(GOLD, 0.75), 2, 16, true)
	sn.shadow_color = Color(GOLD2, 0.20)
	sn.shadow_size = 18
	sn.shadow_offset = Vector2(0, 6)
	_spin_btn.add_theme_stylebox_override("normal", sn)
	_spin_btn.add_theme_stylebox_override("hover", _sbox(Color("202b45"), GOLD, 2, 16, true))
	_spin_btn.pressed.connect(_on_spin)
	tv.add_child(_spin_btn)
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
	if _spinning:
		return
	var bet := 0.0
	if _bet_input != null:
		bet = float(_bet_input.text)
	var r := game.spin(bet)
	if not bool(r.get("ok", false)):
		_toast("❌ " + String(r.get("err", "Ошибка")))
		return
	_spinning = true
	if _spin_btn:
		_spin_btn.disabled = true
		_spin_btn.text = "крутится…"
	if _result_lbl:
		_result_lbl.text = ""
		_result_lbl.modulate = Color.WHITE

	var final: Array = []
	if bool(r["win"]):
		var w: String = String(REEL.pick_random())
		final = [w, w, w]
	else:
		var pool: Array = REEL.duplicate()
		pool.shuffle()
		final = [pool[0], pool[1], pool[2]]

	for i in 22:
		if _drums.is_empty() or not is_instance_valid(_drums[0]):
			_spinning = false
			return
		for d in _drums:
			d.text = String(REEL.pick_random())
		await get_tree().create_timer(0.035 + float(i) * 0.003).timeout
	for i in 3:
		if i < _drums.size() and is_instance_valid(_drums[i]):
			_drums[i].text = String(final[i])
		await get_tree().create_timer(0.08).timeout

	_spinning = false
	if _spin_btn and is_instance_valid(_spin_btn):
		_spin_btn.disabled = false
		_spin_btn.text = "🎰  КРУТИТЬ"
	if _result_lbl == null or not is_instance_valid(_result_lbl):
		return
	if bool(r["win"]):
		_result_lbl.text = "🎉 ВЫИГРЫШ ×%s   +%s 🪙" % [VCGame.fmt_mult(float(r["mult"])), VCGame.fmt(float(r["amount"]) - float(r["bet"]))]
		_result_lbl.add_theme_color_override("font_color", GREEN)
		_result_lbl.modulate = Color(1.5, 1.5, 1.5)
		var tw := create_tween()
		tw.tween_property(_result_lbl, "modulate", Color.WHITE, 0.55)
	else:
		_result_lbl.text = "💀 ПРОИГРЫШ   −%s 🪙" % VCGame.fmt(float(r["bet"]))
		_result_lbl.add_theme_color_override("font_color", RED)
	if _mult_slider:
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
		qty.mouse_filter = Control.MOUSE_FILTER_PASS
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
		var chips := HFlowContainer.new()
		chips.add_theme_constant_override("h_separation", 4)
		chips.add_theme_constant_override("v_separation", 4)
		chips.size_flags_horizontal = Control.SIZE_EXPAND_FILL
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

func _build_chat() -> void:
	if social == null:
		return
	social.build_chat(_content)

func _build_friends() -> void:
	if social == null:
		return
	social.build_friends(_content)

func _build_more() -> void:
	_content.add_child(_label("АККАУНТ", 13, GOLD))
	var acc_card := _card(Color(GOLD, 0.22))
	var acc_v := _vbox(8)
	if net != null and net.user_name != "" and net.authed:
		acc_v.add_child(_label("👤 " + net.user_name, 17, TEXT))
		acc_v.add_child(_label("Сервер: %s" % net.base, 10.5, MUTED, true))
		acc_v.add_child(_label("Облако: rev %d · автосинк каждые 10 секунд" % _cloud_rev, 10.5, MUTED, true))
		if social != null:
			acc_v.add_child(_label("В кошельке: 🪙 %s · друзей: %d" % [
				VCGame.fmt(social.avail), (social.friends.get("friends", []) as Array).size()], 10.5, MUTED, true))
		var ar := _row(6)
		var sy := _button("🔄 Синхронизировать", 12)
		sy.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sy.pressed.connect(_sync_now)
		var lo := _button("🚪 Выйти", 12, RED)
		lo.pressed.connect(_on_logout)
		ar.add_child(sy)
		ar.add_child(lo)
		acc_v.add_child(ar)
	else:
		acc_v.add_child(_label("Офлайн-режим (разработка)", 13, TEXT))
		acc_v.add_child(_label("Аккаунт не подключён: сохранение только в файле.", 11, MUTED, true))
	acc_card.add_child(acc_v)
	_content.add_child(acc_card)

	_content.add_child(_label("КРЕДИТ", 13, GOLD))
	var card := _card()
	var v := _vbox(8)
	v.add_child(_label("Один кредит до 1 трлн, срок 1–5 часов, +1%/час. Досрочно — проценты только за использованное время.", 11.5, MUTED, true))
	var row := _row(6)
	var amount := LineEdit.new()
	amount.text = "1000000"
	amount.mouse_filter = Control.MOUSE_FILTER_PASS
	amount.placeholder_text = "сумма"
	amount.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var hours := LineEdit.new()
	hours.text = "1"
	hours.mouse_filter = Control.MOUSE_FILTER_PASS
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
		av.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		av.add_child(_label(String(a["name"]), 12.5, GREEN if ok else TEXT, true))
		av.add_child(_label(String(a["desc"]), 10.5, MUTED, true))
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
	sysv.add_child(_label("Облако: %s" % ("подключено · rev %d" % _cloud_rev if net != null and net.authed else "не подключено"), 10.5, MUTED, true))
	var sb := _button("💾 Сохранить сейчас", 12)
	sb.pressed.connect(func() -> void:
		game.save()
		_toast("💾 Сохранено")
	)
	sysv.add_child(sb)
	sys.add_child(sysv)
	_content.add_child(sys)

# ── аккаунт и облако ─────────────────────────────────────────────────────────
func _build_gate() -> Control:
	var layer := ColorRect.new()
	layer.color = Color(0.015, 0.025, 0.05, 0.9)
	layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(center)
	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(390, 0)
	var sb := _sbox(CARD, Color(GOLD, 0.35), 1, 22, true)
	sb.set_content_margin_all(20)
	card.add_theme_stylebox_override("panel", sb)
	center.add_child(card)
	var v := _vbox(9)
	var title := _label("VitalyaClicker 69", 27, GOLD)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_glow_label(title, GOLD2, 3)
	v.add_child(title)
	var sub := _label("Аккаунт нужен, чтобы играть: прогресс хранится в облаке и не потеряется.", 11, MUTED, true)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(sub)

	v.add_child(_label("СЕРВЕР", 10, MUTED))
	_gate_server = LineEdit.new()
	_gate_server.text = "http://127.0.0.1:3000"
	_gate_server.placeholder_text = "http://127.0.0.1:3000"
	v.add_child(_gate_server)

	v.add_child(_label("ЛОГИН", 10, MUTED))
	_gate_name = LineEdit.new()
	_gate_name.placeholder_text = "имя в игре"
	_gate_name.text_submitted.connect(func(_s: String) -> void: _gate_pw.grab_focus())
	v.add_child(_gate_name)

	v.add_child(_label("ПАРОЛЬ", 10, MUTED))
	_gate_pw = LineEdit.new()
	_gate_pw.secret = true
	_gate_pw.placeholder_text = "пароль"
	_gate_pw.text_submitted.connect(func(_s: String) -> void: _on_gate(false))
	v.add_child(_gate_pw)

	_gate_status = _label("Войдите или создайте аккаунт.", 11.5, MUTED, true)
	_gate_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_gate_status)

	var row := _row(8)
	var b1 := _button("Войти", 14, Color("221704"))
	b1.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b1.custom_minimum_size = Vector2(0, 44)
	var gold := _sbox(GOLD, GOLD_SOFT, 1, 12, true)
	gold.shadow_color = Color(GOLD2, 0.28)
	gold.shadow_size = 12
	b1.add_theme_stylebox_override("normal", gold)
	b1.add_theme_stylebox_override("hover", gold)
	for c in ["font_color", "font_hover_color", "font_focus_color", "font_pressed_color"]:
		b1.add_theme_color_override(c, Color("221704"))
	b1.pressed.connect(func() -> void: _on_gate(false))
	var b2 := _button("Регистрация", 14)
	b2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b2.custom_minimum_size = Vector2(0, 44)
	b2.pressed.connect(func() -> void: _on_gate(true))
	row.add_child(b1)
	row.add_child(b2)
	v.add_child(row)
	var foot := _label("Сессия запоминается на 7 дней. Выйдете — прогресс останется в облаке.", 10, MUTED, true)
	foot.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(foot)
	card.add_child(v)
	return layer

func _gate_set(text: String, error := false) -> void:
	if _gate_status == null:
		return
	_gate_status.text = text
	_gate_status.add_theme_color_override("font_color", RED if error else MUTED)

func _start_session() -> void:
	_gate_server.text = net.base
	if net.session_valid():
		_gate_busy = true
		_gate_set("☁️ Подключаемся к серверу…")
		var ok := await net.ensure_link()
		if ok:
			await _after_login()
			return
		_gate_busy = false
		_gate_name.text = net.user_name
		_gate_set(net.last_error + "\nВведите пароль, чтобы войти снова.", true)
	else:
		_gate_set("Войдите или создайте аккаунт.")

func _on_gate(register: bool) -> void:
	if _gate_busy or net == null:
		return
	var n := _gate_name.text.strip_edges()
	var p := _gate_pw.text
	if n.length() < 2:
		_gate_set("Логин слишком короткий", true)
		return
	if p.length() < 4:
		_gate_set("Пароль слишком короткий", true)
		return
	_gate_busy = true
	_gate_set("⏳ Соединяемся…")
	var r: Dictionary
	if register:
		r = await net.register(n, p, _gate_server.text)
	else:
		r = await net.login(n, p, _gate_server.text)
	if not bool(r.get("ok", false)):
		_gate_busy = false
		_gate_set(String(r.get("err", "Ошибка")), true)
		return
	await _after_login()

func _after_login() -> void:
	_gate_set("☁️ Загружаем сохранение…")
	var info := await net.save_info()
	if not bool(info.get("ok", false)):
		_gate_busy = false
		_gate_set("Не удалось получить сохранение: " + String(info.get("err", "ошибка")), true)
		return
	var sv: Variant = info.get("save")
	var err := ""
	if sv == null:
		# облако пустое: если на устройстве остался прогресс — предлагаем его загрузить
		var local := VCGame.new()
		var has_local := local.load_game() and _has_progress(local)
		var pick := 2
		if has_local:
			pick = await _ask_local_cloud(int(local.s.get("clicks", 0)), local.total_money())
		if pick == 1:
			game.s = local.s
		else:
			game.new_game()
		_cloud_rev = 0
		var r := await _push_cloud(true)
		if not bool(r.get("ok", false)):
			err = "Не удалось создать облачное сохранение: " + String(r.get("err", "ошибка"))
	else:
		var g := await net.save_get()
		if not bool(g.get("ok", false)):
			err = "Не удалось скачать сохранение: " + String(g.get("err", "ошибка"))
		elif bool(g.get("empty", false)):
			game.new_game()
			var r2 := await _push_cloud(true)
			if not bool(r2.get("ok", false)):
				err = "Не удалось создать облачное сохранение"
		else:
			err = game.from_cloud(Marshalls.base64_to_raw(String(g.get("main", ""))))
			if err == "":
				_cloud_rev = int(g.get("rev", 0))
				_last_digest = game.cloud_digest()
	if err != "":
		_gate_busy = false
		_gate_set(err, true)
		return
	_begin_play()

func _begin_play() -> void:
	_gate_busy = false
	_playing = true
	if _root:
		_root.visible = true
	if _gate:
		_gate.visible = false
	var off := game.apply_offline()
	_shown_money = game.total_money()
	_update_header()
	if _content != null:
		_rebuild()
	if off > 60.0 and game.per_sec() > 0.0:
		_toast("⏳ Оффлайн: +%s монет за %d мин" % [VCGame.fmt(game.per_sec() * off), int(off / 60.0)])
	if net != null and net.authed:
		_toast("👤 " + net.user_name + " · облако подключено")
	if social != null and net != null and net.authed:
		social.on_login()

func _sync_check(delta: float) -> void:
	if net == null or not net.authed or _pushing or _conflict_open:
		return
	if social != null and social.wallet_busy:
		return
	_cloud_tick += delta
	if _cloud_tick < 10.0:
		return
	_cloud_tick = 0.0
	if game.cloud_digest() != _last_digest:
		_push_cloud(false)

func _push_cloud(force: bool, ack: Array = []) -> Dictionary:
	if _pushing:
		return { "ok": false, "err": "busy" }
	_pushing = true
	var ids := ack.duplicate()
	var r := await net.save_put(game.to_cloud(), _cloud_rev, force, ids)
	_pushing = false
	if bool(r.get("ok", false)):
		_cloud_rev = int(r.get("rev", _cloud_rev))
		_last_digest = game.cloud_digest()
		if social != null:
			social.on_saved(r)
			if not ids.is_empty():
				social.ack_done(ids)
		return r
	if String(r.get("err", "")) == "conflict":
		_show_conflict()
	return r

func _sync_now() -> void:
	if net == null or not net.authed:
		_toast("❌ Нет связи с сервером")
		return
	if _pushing:
		_toast("⏳ Синхронизация уже идёт")
		return
	var r := await _push_cloud(false)
	if bool(r.get("ok", false)):
		_toast("☁️ Сохранено в облако (rev %d)" % _cloud_rev)
		_rebuild()
	elif String(r.get("err", "")) != "conflict":
		_toast("❌ " + String(r.get("err", "Ошибка")))

func _show_conflict() -> void:
	if _conflict_open:
		return
	_conflict_open = true
	_modal("☁️ Сохранение изменилось", "В облаке более свежая версия (rev %d). Что делать?" % _cloud_rev, [
		{ "label": "Взять из облака", "color": GOLD, "cb": _take_cloud },
		{ "label": "Записать своё", "color": RED, "cb": _force_cloud },
	])

func _take_cloud() -> void:
	_conflict_open = false
	var g := await net.save_get()
	if not bool(g.get("ok", false)) or bool(g.get("empty", false)):
		_toast("❌ Не удалось скачать облако")
		return
	var err := game.from_cloud(Marshalls.base64_to_raw(String(g.get("main", ""))))
	if err != "":
		_toast("❌ " + err)
		return
	_cloud_rev = int(g.get("rev", 0))
	_last_digest = game.cloud_digest()
	game.save()
	_shown_money = game.total_money()
	_update_header()
	_rebuild()
	_toast("☁️ Взято из облака")

func _force_cloud() -> void:
	_conflict_open = false
	var r := await _push_cloud(true)
	if bool(r.get("ok", false)):
		_toast("☁️ Записано в облако")
	else:
		_toast("❌ " + String(r.get("err", "Ошибка")))

func _on_logout() -> void:
	if _pushing:
		_toast("⏳ Подождите, идёт сохранение")
		return
	var r := await _push_cloud(false)
	if not bool(r.get("ok", false)) and String(r.get("err", "")) != "conflict":
		_toast("❌ Нет связи — прогресс не сохранён. Выход отменён.")
		return
	if _conflict_open:
		_toast("Сначала решите, какое сохранение оставить")
		return
	net.forget()
	if social != null:
		social.on_logout()
	game.new_game()
	game.save()
	_playing = false
	_cloud_rev = 0
	_last_digest = ""
	_shown_money = 0.0
	_gate.visible = true
	_root.visible = false
	_gate_name.text = ""
	_gate_pw.text = ""
	_gate_server.text = net.base
	_gate_set("Вы вышли. Прогресс остался в облаке — войдите, чтобы продолжить.")
	_toast("🚪 Вы вышли из аккаунта")

func _modal(title: String, text: String, actions: Array) -> void:
	var layer := ColorRect.new()
	layer.color = Color(0, 0, 0, 0.68)
	layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(center)
	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(370, 0)
	var sb := _sbox(CARD, Color(GOLD, 0.4), 1, 20, true)
	sb.set_content_margin_all(18)
	card.add_theme_stylebox_override("panel", sb)
	center.add_child(card)
	var v := _vbox(10)
	v.add_child(_label(title, 17, GOLD))
	v.add_child(_label(text, 12, TEXT, true))
	var row := _row(8)
	for a in actions:
		var act: Dictionary = a
		var col: Color = act.get("color", TEXT)
		var b := _button(String(act.get("label", "OK")), 12, col)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size = Vector2(0, 42)
		b.pressed.connect(func() -> void:
			layer.queue_free()
			var cb: Callable = act.get("cb", Callable())
			if cb.is_valid():
				cb.call()
		)
		row.add_child(b)
	v.add_child(row)
	card.add_child(v)
	add_child(layer)

func _on_link_changed(ok: bool, text: String) -> void:
	if ok or not _playing:
		return
	var now := float(Time.get_ticks_msec())
	if now - _link_err_at > 30000.0:
		_link_err_at = now
		_toast("⚠️ " + text)

func _on_push(m: Dictionary) -> void:
	if social != null:
		social.on_push(m)

func _has_progress(g: VCGame) -> bool:
	return int(g.s.get("clicks", 0)) > 0 or g.total_money() > 0.0 or not (g.s["upgrades"] as Dictionary).is_empty()

## Выбор при пустом облаке: 1 — загрузить локальный прогресс, 2 — начать заново.
func _ask_local_cloud(clicks: int, money: float) -> int:
	var layer := ColorRect.new()
	layer.color = Color(0, 0, 0, 0.72)
	layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(center)
	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(380, 0)
	var sb := _sbox(CARD, Color(GOLD, 0.4), 1, 20, true)
	sb.set_content_margin_all(18)
	card.add_theme_stylebox_override("panel", sb)
	center.add_child(card)
	var v := _vbox(10)
	v.add_child(_label("☁️ В облаке пока пусто", 17, GOLD))
	v.add_child(_label("На этом устройстве есть прогресс: %d кликов и 🪙 %s.\n\nЗагрузить его в аккаунт? Если выбрать «Начать заново», локальный кэш заменится новой игрой." % [clicks, VCGame.fmt(money)], 12, TEXT, true))
	var row := _row(8)
	var pick := [-1]
	var b1 := _button("Загрузить прогресс", 12, GOLD)
	b1.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b1.custom_minimum_size = Vector2(0, 42)
	b1.pressed.connect(func() -> void:
		pick[0] = 1
		layer.queue_free()
	)
	var b2 := _button("Начать заново", 12, MUTED)
	b2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b2.custom_minimum_size = Vector2(0, 42)
	b2.pressed.connect(func() -> void:
		pick[0] = 2
		layer.queue_free()
	)
	row.add_child(b1)
	row.add_child(b2)
	v.add_child(row)
	card.add_child(v)
	add_child(layer)
	while pick[0] == -1 and is_instance_valid(layer):
		await get_tree().process_frame
	return int(pick[0])

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
