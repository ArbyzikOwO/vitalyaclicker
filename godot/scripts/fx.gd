class_name VCFX
extends Control
## Живой фон: мягкие цветные пятна-свечения и медленно всплывающие монетки.
## Рисуется кодом, поэтому не тянет за собой картинок и работает на любом
## размере окна.

var _t := 0.0
var _coins: Array = []

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for i in 18:
		_coins.append({
			"x": randf(),
			"y": randf(),
			"s": randf_range(1.4, 3.4),
			"v": randf_range(0.010, 0.035),
			"ph": randf() * TAU,
			"a": randf_range(0.08, 0.26),
		})

func _process(delta: float) -> void:
	_t += delta
	for c in _coins:
		c["y"] = float(c["y"]) - float(c["v"]) * delta
		if float(c["y"]) < -0.05:
			c["y"] = 1.05
			c["x"] = randf()
	queue_redraw()

func _draw() -> void:
	var w := size.x
	var h := size.y
	if w <= 1.0 or h <= 1.0:
		return
	# большие мягкие пятна — «свет» из глубины
	_glow(Vector2(w * 0.86, h * 0.06), minf(w, h) * 0.62, Color(1.0, 0.72, 0.20, 0.10))
	_glow(Vector2(w * 0.06, h * 0.62), minf(w, h) * 0.78, Color(0.42, 0.30, 1.0, 0.10))
	_glow(Vector2(w * 0.55, h * 0.98), minf(w, h) * 0.55, Color(0.15, 0.62, 1.0, 0.07))
	# всплывающие монетки
	for c in _coins:
		var x: float = float(c["x"]) * w + sin(_t * 0.7 + float(c["ph"])) * 14.0
		var y: float = float(c["y"]) * h
		var r: float = float(c["s"])
		var a: float = float(c["a"])
		# у краёв растворяются
		a *= clampf(minf(y / (h * 0.18), (h - y) / (h * 0.18)), 0.0, 1.0)
		if a <= 0.01:
			continue
		draw_circle(Vector2(x, y), r, Color(1.0, 0.80, 0.30, a))
		draw_circle(Vector2(x - r * 0.25, y - r * 0.25), r * 0.45, Color(1.0, 0.95, 0.75, a * 0.9))

func _glow(center: Vector2, radius: float, color: Color) -> void:
	var layers := 5
	for i in range(layers, 0, -1):
		var k := float(i) / float(layers)
		draw_circle(center, radius * k, Color(color.r, color.g, color.b, color.a / float(layers)))
