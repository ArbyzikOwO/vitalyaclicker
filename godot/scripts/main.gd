extends Control
## Прототип кликера VitalyaClicker 69 на Godot 4.
## Сделано как фундамент переноса: интерфейс строится кодом, поэтому сцену
## не нужно собирать в редакторе. Сохранение — user://save.json.

const SAVE_PATH := "user://save.json"
const SAVE_EVERY := 3.0

# ── состояние игры ────────────────────────────────────────────────────────────
var money: float = 0.0
var total_clicks: int = 0
var per_click: float = 1.0
var per_sec: float = 0.0
var levels: Dictionary = {"click": 0, "auto": 0, "mult": 0}
var last_seen: int = 0

# ── элементы интерфейса ───────────────────────────────────────────────────────
var _lbl_money: Label
var _lbl_sub: Label
var _lbl_click: Label
var _lbl_auto: Label
var _btn_click: Button
var _btns: Dictionary = {}
var _save_timer: float = 0.0
var _tick_accum: float = 0.0

const GOLD := Color(1.0, 0.788, 0.235)
const TEXT := Color(0.91, 0.93, 0.96)
const MUTED := Color(0.53, 0.57, 0.65)
const BG := Color(0.043, 0.055, 0.078)
const CARD := Color(0.106, 0.133, 0.184)
const LINE := Color(0.2, 0.25, 0.33)

func _ready() -> void:
	_build_ui()
	_load_game()
	_apply_offline()
	_refresh()

func _process(delta: float) -> void:
	# авто-доход
	if per_sec > 0.0:
		money += per_sec * delta
		_tick_accum += delta
		if _tick_accum >= 0.25:
			_tick_accum = 0.0
			_refresh()
	# автосохранение
	_save_timer += delta
	if _save_timer >= SAVE_EVERY:
		_save_timer = 0.0
		_save_game()

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_PREDELETE:
		_save_game()

# ── интерфейс ─────────────────────────────────────────────────────────────────
func _build_ui() -> void:
	var bg := ColorRect.new()
	bg.color = BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var root := VBoxContainer.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.offset_left = 18
	root.offset_right = -18
	root.offset_top = 18
	root.offset_bottom = -18
	root.add_theme_constant_override("separation", 12)
	add_child(root)

	var title := Label.new()
	title.text = "VITALYACLICKER 69"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 26)
	title.add_theme_color_override("font_color", GOLD)
	root.add_child(title)

	_lbl_money = Label.new()
	_lbl_money.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_lbl_money.add_theme_font_size_override("font_size", 34)
	_lbl_money.add_theme_color_override("font_color", TEXT)
	root.add_child(_lbl_money)

	_lbl_sub = Label.new()
	_lbl_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_lbl_sub.add_theme_font_size_override("font_size", 13)
	_lbl_sub.add_theme_color_override("font_color", MUTED)
	root.add_child(_lbl_sub)

	_btn_click = _make_button("🪙 КЛИК", GOLD)
	_btn_click.custom_minimum_size = Vector2(0, 120)
	_btn_click.add_theme_font_size_override("font_size", 26)
	_btn_click.pressed.connect(_on_click)
	root.add_child(_btn_click)

	_lbl_click = Label.new()
	_lbl_click.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_lbl_click.add_theme_color_override("font_color", MUTED)
	root.add_child(_lbl_click)

	_lbl_auto = Label.new()
	_lbl_auto.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_lbl_auto.add_theme_color_override("font_color", MUTED)
	root.add_child(_lbl_auto)

	var spacer := Control.new()
	spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	root.add_child(spacer)

	var head := Label.new()
	head.text = "УЛУЧШЕНИЯ"
	head.add_theme_font_size_override("font_size", 15)
	head.add_theme_color_override("font_color", GOLD)
	root.add_child(head)

	for key in ["click", "auto", "mult"]:
		var b := _make_button("", TEXT)
		b.custom_minimum_size = Vector2(0, 48)
		b.pressed.connect(_on_buy.bind(key))
		_btns[key] = b
		root.add_child(b)

func _make_button(text: String, color: Color) -> Button:
	var b := Button.new()
	b.text = text
	b.add_theme_font_size_override("font_size", 16)
	b.add_theme_color_override("font_color", color)
	var normal := StyleBoxFlat.new()
	normal.bg_color = CARD
	normal.border_color = LINE
	normal.set_border_width_all(1)
	normal.set_corner_radius_all(14)
	var hover := normal.duplicate() as StyleBoxFlat
	hover.bg_color = CARD.lightened(0.06)
	hover.border_color = GOLD
	var pressed := normal.duplicate() as StyleBoxFlat
	pressed.bg_color = CARD.darkened(0.15)
	b.add_theme_stylebox_override("normal", normal)
	b.add_theme_stylebox_override("hover", hover)
	b.add_theme_stylebox_override("pressed", pressed)
	b.add_theme_stylebox_override("focus", hover)
	return b

func _refresh() -> void:
	_lbl_money.text = "🪙 " + _fmt(money)
	_lbl_sub.text = "В секунду: " + _fmt(per_sec) + "   ·   За клик: " + _fmt(per_click)
	_lbl_click.text = "Кликов: " + str(total_clicks)
	_lbl_auto.text = "Уровни: клик " + str(levels["click"]) + " · авто " + str(levels["auto"]) + " · множитель " + str(levels["mult"])
	_btns["click"].text = "👆 Клик +1   ·   🪙 " + _fmt(_cost("click"))
	_btns["auto"].text = "⚙️ Авто +1/с   ·   🪙 " + _fmt(_cost("auto"))
	_btns["mult"].text = "✖️ Множитель ×2   ·   🪙 " + _fmt(_cost("mult"))
	for key in _btns:
		_btns[key].disabled = money < _cost(key)

# ── экономика (те же множители, что в веб-версии: 1.15 за уровень) ─────────────
func _cost(key: String) -> float:
	var base := {"click": 15.0, "auto": 100.0, "mult": 500.0}
	var b: float = base[key]
	return floor(b * pow(1.15, float(levels[key])))

func _on_click() -> void:
	money += per_click
	total_clicks += 1
	_refresh()

func _on_buy(key: String) -> void:
	var price := _cost(key)
	if money < price:
		return
	money -= price
	levels[key] = int(levels[key]) + 1
	match key:
		"click":
			per_click += 1.0
		"auto":
			per_sec += 1.0
		"mult":
			per_click *= 2.0
			per_sec *= 2.0
	_refresh()

# ── сохранение ────────────────────────────────────────────────────────────────
func _save_game() -> void:
	var data := {
		"version": 1,
		"money": money,
		"total_clicks": total_clicks,
		"per_click": per_click,
		"per_sec": per_sec,
		"levels": levels,
		"last_seen": int(Time.get_unix_time_from_system()),
	}
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data))
		f.close()

func _load_game() -> void:
	if not FileAccess.file_exists(SAVE_PATH):
		return
	var f := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if not f:
		return
	var txt := f.get_as_text()
	f.close()
	var parsed: Variant = JSON.parse_string(txt)
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	var d: Dictionary = parsed
	money = float(d.get("money", 0.0))
	total_clicks = int(d.get("total_clicks", 0))
	per_click = float(d.get("per_click", 1.0))
	per_sec = float(d.get("per_sec", 0.0))
	last_seen = int(d.get("last_seen", 0))
	var lv: Variant = d.get("levels", {})
	if typeof(lv) == TYPE_DICTIONARY:
		for k in ["click", "auto", "mult"]:
			levels[k] = int((lv as Dictionary).get(k, 0))

## Оффлайн-доход: не больше 8 часов, как в веб-версии.
func _apply_offline() -> void:
	if last_seen <= 0 or per_sec <= 0.0:
		return
	var now := int(Time.get_unix_time_from_system())
	var seconds := clampf(float(now - last_seen), 0.0, 8.0 * 3600.0)
	if seconds > 5.0:
		money += per_sec * seconds

# ── форматирование чисел (1.00K / 1.00M / 1.00B) ──────────────────────────────
func _fmt(v: float) -> String:
	var names := ["", "K", "M", "B", "T", "Qa", "Qi"]
	var i := 0
	var x := v
	while x >= 1000.0 and i < names.size() - 1:
		x /= 1000.0
		i += 1
	if i == 0:
		return str(int(x))
	return "%.2f%s" % [x, names[i]]
