class_name VCGardenGrid
extends Control
## Рисует грядку без сотен Button-узлов: до 50×50 клеток остаются лёгкими.
## Пустая клетка — посадить выбранное семя, спелая — собрать, погибшая — убрать.

signal acted(text: String)

var garden: VCGarden = null
var cell_px := 36.0
var _hover := Vector2i(-1, -1)
var _t := 0.0

func setup(g: VCGarden, px := 36.0) -> void:
	garden = g
	cell_px = px
	focus_mode = Control.FOCUS_NONE
	mouse_filter = Control.MOUSE_FILTER_STOP
	size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	_sync_size()

func refresh() -> void:
	_sync_size()

func _sync_size() -> void:
	if garden == null:
		return
	var n := garden.garden_size()
	custom_minimum_size = Vector2(float(n) * cell_px, float(n) * cell_px)
	size = custom_minimum_size
	queue_redraw()

func _process(delta: float) -> void:
	_t += delta
	if _t >= 0.5:
		_t = 0.0
		queue_redraw()

func _cell_at(pos: Vector2) -> Vector2i:
	if garden == null or cell_px <= 0.0:
		return Vector2i(-1, -1)
	var x := int(floor(pos.x / cell_px))
	var y := int(floor(pos.y / cell_px))
	var n := garden.garden_size()
	if x < 0 or y < 0 or x >= n or y >= n:
		return Vector2i(-1, -1)
	return Vector2i(x, y)

func _gui_input(event: InputEvent) -> void:
	if garden == null:
		return
	if event is InputEventMouseMotion:
		var m := event as InputEventMouseMotion
		var h := _cell_at(m.position)
		if h != _hover:
			_hover = h
			queue_redraw()
	elif event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT and mb.pressed:
			var c := _cell_at(mb.position)
			if c.x >= 0:
				var txt := garden.click_cell(c.x, c.y)
				if txt != "":
					acted.emit(txt)
				queue_redraw()
			accept_event()

func _notification(what: int) -> void:
	if what == NOTIFICATION_MOUSE_EXIT:
		_hover = Vector2i(-1, -1)
		queue_redraw()

func _draw() -> void:
	if garden == null or cell_px <= 0.0:
		return
	var n := garden.garden_size()
	var now := garden.now_ms()
	var gap := 2.0
	var cell := Vector2(cell_px - gap, cell_px - gap)
	for y in n:
		for x in n:
			var pos := Vector2(float(x) * cell_px, float(y) * cell_px)
			var r := Rect2(pos + Vector2(gap * 0.5, gap * 0.5), cell)
			var base := Color("101827")
			if (x + y) % 2 == 0:
				base = Color("0d1522")
			draw_rect(r, base, true)
			draw_rect(r, Color(1, 1, 1, 0.055), false, 1.0)
			if _hover == Vector2i(x, y):
				draw_rect(r, Color(1.0, 0.79, 0.24, 0.20), true)
				draw_rect(r, Color(1.0, 0.79, 0.24, 0.85), false, 1.5)
			var c := garden.cell_at(x, y)
			if c.is_empty():
				continue
			var k := String(c.get("plant", ""))
			var col := garden.crop_color(k)
			var st := garden.stage(c, now)
			var state_name := String(st.get("stage", ""))
			var center := r.get_center()
			var radius := cell.x * 0.27
			if state_name == "dead" or state_name == "rotten":
				col = Color("596170")
			elif state_name == "mature":
				col = col.lightened(0.12)
			draw_line(center + Vector2(0, radius * 0.5), center + Vector2(0, radius * 1.5), Color("3c8d4a"), 1.2)
			if state_name == "dead" or state_name == "rotten":
				draw_circle(center, radius, Color(col, 0.75))
			elif k == "rose" or k == "pansy":
				for i in 5:
					var a := TAU * float(i) / 5.0 - PI * 0.5
					draw_circle(center + Vector2(cos(a), sin(a)) * radius * 0.55, radius * 0.48, Color(col, 0.92))
				draw_circle(center, radius * 0.34, Color("ffd34d") if k == "pansy" else Color(col.lightened(0.35), 0.95))
			elif k == "mandarin":
				draw_circle(center, radius * 1.02, Color(col, 0.95))
				draw_line(center + Vector2(-radius * 0.2, -radius * 0.9), center + Vector2(radius * 0.6, -radius * 1.3), Color("5fbf66"), 2.0)
			elif k == "lemon":
				draw_circle(center + Vector2(-radius * 0.15, 0), radius * 0.82, Color(col, 0.95))
				draw_circle(center + Vector2(radius * 0.55, 0), radius * 0.52, Color(col, 0.95))
				draw_line(center + Vector2(radius * 0.6, -radius * 0.5), center + Vector2(radius * 1.1, -radius * 0.9), Color("5fbf66"), 1.5)
			elif k == "dill":
				for i in 3:
					var a2 := -PI * 0.5 + (float(i) - 1.0) * 0.55
					draw_line(center, center + Vector2(cos(a2), sin(a2)) * radius * 1.35, Color(col, 0.92), 1.8)
					draw_circle(center + Vector2(cos(a2), sin(a2)) * radius * 1.25, 1.8, Color(col.lightened(0.2), 0.95))
			else:
				draw_circle(center, radius, Color(col, 0.92))
			if state_name == "mature":
				draw_arc(center, radius + 3.0, 0.0, TAU, 24, Color("ffe27a"), 1.6)
			elif state_name == "growing":
				var pg := Rect2(r.position + Vector2(4, r.size.y - 6), Vector2(r.size.x - 8, 3))
				draw_rect(pg, Color(1, 1, 1, 0.10), true)
				draw_rect(Rect2(pg.position, Vector2(pg.size.x * float(st.get("progress", 0.0)), 3)), Color(col, 0.9), true)
			elif state_name == "dead" or state_name == "rotten":
				draw_line(center + Vector2(-3, -3), center + Vector2(3, 3), Color("ff8a8a"), 1.5)
				draw_line(center + Vector2(3, -3), center + Vector2(-3, 3), Color("ff8a8a"), 1.5)
			if k == "pansy" and not bool(c.get("resolved", false)):
				draw_circle(r.position + Vector2(r.size.x - 6, r.size.y - 8), 2.4, Color("5ad1ff"))
