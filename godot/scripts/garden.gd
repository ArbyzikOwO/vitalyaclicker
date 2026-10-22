class_name VCGarden
extends RefCounted
## Сад в формате веб-версии (sad_data.bin, JSON).
##
## Данные читаются из net.garden и пишутся обратно без потери незнакомых полей:
## веб-вкладка «Сад» и Godot должны видеть одно и то же состояние. Деньги сада
## входят в общий баланс: main-игра тратит сначала свои корзины, затем сад,
## а покупки сада тратят сначала его кассу, затем main (как в вебе).

const SAVE_VERSION := 24
const GARDEN_BASE := 10
const GARDEN_MAX := 50
const SIZE_STEP := 5
const SIZE_UPGRADE_PRICE := 5e9
const NEW_GARDEN_PRICE := 100e12
const MAXIM_PRICE := 100e12
const WATER_COOLDOWN_MS := 6000.0
const DILL_FINE_PER_UNIT := 5e11
const POLICE_BASE_INTERVAL := 3600000.0
const POLICE_CRACKDOWN_INTERVAL := 1800000.0
const PANSY_BASE_SURVIVAL := 0.01
const PANSY_WATER_BONUS := 0.01

const LOCAL_PATH := "user://garden_v24.json"
const SIZE_LIST := [10, 15, 20, 25, 30, 35, 40, 45, 50]
const PLANT_KEYS := ["rose", "mandarin", "pansy", "lemon", "dill"]
const CROPS := {
	"rose": {
		"name": "Роза", "short": "Роза", "emoji": "🌹", "hue": 340.0,
		"pack_price": 150e6, "pack_seeds": 150, "grow_ms": 3600000.0,
		"sell": 1.5e6, "shelf_ms": 3.0 * 3600000.0, "price_key": "rose",
	},
	"mandarin": {
		"name": "Мандарин", "short": "Мандарин", "emoji": "🍊", "hue": 30.0,
		"pack_price": 1e9, "pack_seeds": 100, "grow_ms": 2.0 * 3600000.0,
		"sell": 100e6, "shelf_ms": 5.0 * 3600000.0, "price_key": "mandarin",
	},
	"pansy": {
		"name": "Анютины глазки", "short": "Анютины", "emoji": "🌼", "hue": 280.0,
		"pack_price": 500e9, "pack_seeds": 10, "grow_ms": 600000.0,
		"sell": 1e12, "shelf_ms": 3.0 * 3600000.0, "needs_water": true,
	},
	"lemon": {
		"name": "Лимон", "short": "Лимон", "emoji": "🍋", "hue": 55.0,
		"pack_price": 1e12, "pack_seeds": 1, "grow_ms": 24.0 * 3600000.0,
		"sell": 100e12, "shelf_ms": -1.0,
	},
	"dill": {
		"name": "Укроп", "short": "Укроп", "emoji": "🌿", "hue": 120.0,
		"pack_price": 100e9, "pack_seeds": 100, "grow_ms": 3600000.0,
		"sell": 1e12, "shelf_ms": -1.0, "is_drug": true,
	},
}

var data: Dictionary = {}
var rev := 0
## В тестах можно отключить запись локального кэша.
var persist_local := true
var _net: VCNet = null
var _notify := Callable()
var _spend_main := Callable()
var _main_total := Callable()
var _owner := ""

func _init() -> void:
	data = fresh_state()

func setup(link: VCNet, notify: Callable, spend_main: Callable, main_total: Callable) -> void:
	_net = link
	_notify = notify
	_spend_main = spend_main
	_main_total = main_total
	if _net != null:
		_owner = _net.user_name
	reload(true)

func set_wallet(spend_main: Callable, main_total: Callable) -> void:
	_spend_main = spend_main
	_main_total = main_total

## Записать текущее состояние в net.garden без локального сейва/notify.
## Нужно, когда игрок выбрал локальный прогресс при пустом облаке.
func sync_to_net() -> void:
	if _net != null:
		_net.garden = JSON.stringify(data)

# ── загрузка/сохранение ───────────────────────────────────────────────────────
## use_local=false — при входе в аккаунт: облако важнее локального кэша.
func reload(use_local := true) -> void:
	if _net != null:
		_owner = _net.user_name
	var raw: Variant = null
	if _net != null:
		raw = _net.garden
	if typeof(raw) == TYPE_STRING and String(raw).strip_edges() != "":
		var parsed: Variant = JSON.parse_string(String(raw))
		if typeof(parsed) == TYPE_DICTIONARY:
			data = parsed
			normalize()
			rev += 1
			return
	elif typeof(raw) == TYPE_DICTIONARY:
		data = raw
		normalize()
		rev += 1
		return
	if use_local:
		var local: Variant = _read_local()
		if local != null:
			data = local
			normalize()
			rev += 1
			return
	data = fresh_state()
	normalize()
	rev += 1

func save() -> void:
	normalize()
	data["lastSave"] = now_ms()
	if _net != null:
		_net.garden = JSON.stringify(data)
	save_local()
	rev += 1
	if _notify.is_valid():
		_notify.call()

func save_local() -> void:
	if not persist_local:
		return
	var payload := { "owner": _owner, "data": data }
	var f := FileAccess.open(LOCAL_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(payload))
		f.close()

func clear_local() -> void:
	var d := DirAccess.open("user://")
	if d and d.file_exists("garden_v24.json"):
		d.remove("garden_v24.json")

func reset_after_logout() -> void:
	clear_local()
	data = fresh_state()
	rev += 1
	_owner = ""

func _read_local() -> Variant:
	if not FileAccess.file_exists(LOCAL_PATH):
		return null
	var f := FileAccess.open(LOCAL_PATH, FileAccess.READ)
	if not f:
		return null
	var txt := f.get_as_text()
	f.close()
	var parsed: Variant = JSON.parse_string(txt)
	if typeof(parsed) != TYPE_DICTIONARY:
		return null
	var wrapper: Dictionary = parsed
	var own := String(wrapper.get("owner", ""))
	if own != "" and _owner != "" and own != _owner:
		return null
	var g: Variant = wrapper.get("data")
	if typeof(g) == TYPE_DICTIONARY:
		return g
	return null

# ── нормализация и стартовые данные ───────────────────────────────────────────
func fresh_state() -> Dictionary:
	return {
		"version": SAVE_VERSION,
		"money": 0.0,
		"activeGarden": 0,
		"gardens": [fresh_garden()],
		"seeds": { "rose": 0, "mandarin": 0, "pansy": 0, "lemon": 0, "dill": 0 },
		"harvested": { "rose": 0, "mandarin": 0, "pansy": 0, "lemon": 0, "dill": 0 },
		"fertilizers": 0,
		"crackdown": false,
		"priceMult": { "rose": 1.0, "mandarin": 1.0 },
		"scheduled": [],
		"nextRandomNewsAt": 0.0,
		"newsHistory": [],
		"selectedPlant": "rose",
		"lastWaterAt": 0.0,
		"lastTick": now_ms(),
		"lastSave": now_ms(),
		"achievements": {},
		"stats": fresh_stats(),
		"autoClickWarns": 0,
	}

func fresh_garden() -> Dictionary:
	return {
		"size": GARDEN_BASE, "cells": {}, "maximBought": false,
		"maximEnabled": true, "lastRaid": now_ms(),
	}

func fresh_stats() -> Dictionary:
	return {
		"planted": 0, "harvested": 0,
		"harvestedByType": { "rose": 0, "mandarin": 0, "pansy": 0, "lemon": 0, "dill": 0 },
		"raids": 0, "maxFine": 0.0, "watered": 0, "newsSeen": 0,
	}

func normalize() -> void:
	if typeof(data) != TYPE_DICTIONARY:
		data = fresh_state()
	data["version"] = SAVE_VERSION
	data["money"] = maxf(0.0, float(data.get("money", 0.0)))
	var gardens: Array = []
	var src: Variant = data.get("gardens", [])
	if typeof(src) == TYPE_ARRAY:
		for item in src:
			if typeof(item) != TYPE_DICTIONARY:
				continue
			var g: Dictionary = item
			var sz := int(g.get("size", GARDEN_BASE))
			if not SIZE_LIST.has(sz):
				sz = GARDEN_BASE
			g["size"] = sz
			var cells_v: Variant = g.get("cells", {})
			if typeof(cells_v) != TYPE_DICTIONARY:
				g["cells"] = {}
				cells_v = g["cells"]
			var cells: Dictionary = cells_v
			for key in cells.keys():
				var c: Variant = cells[key]
				if typeof(c) != TYPE_DICTIONARY:
					cells.erase(key)
			g["maximBought"] = bool(g.get("maximBought", false))
			g["maximEnabled"] = bool(g.get("maximEnabled", true))
			g["lastRaid"] = float(g.get("lastRaid", now_ms()))
			gardens.append(g)
	if gardens.is_empty():
		gardens.append(fresh_garden())
	data["gardens"] = gardens
	data["activeGarden"] = clampi(int(data.get("activeGarden", 0)), 0, gardens.size() - 1)

	var seeds: Dictionary = data.get("seeds", {}) if typeof(data.get("seeds", {})) == TYPE_DICTIONARY else {}
	for k in PLANT_KEYS:
		seeds[k] = maxi(0, int(float(seeds.get(k, 0))))
	data["seeds"] = seeds

	var harv: Dictionary = data.get("harvested", {}) if typeof(data.get("harvested", {})) == TYPE_DICTIONARY else {}
	for k in PLANT_KEYS:
		harv[k] = maxi(0, int(float(harv.get(k, 0))))
	data["harvested"] = harv

	var pm: Dictionary = data.get("priceMult", {}) if typeof(data.get("priceMult", {})) == TYPE_DICTIONARY else {}
	pm["rose"] = maxf(0.0001, float(pm.get("rose", 1.0)))
	pm["mandarin"] = maxf(0.0001, float(pm.get("mandarin", 1.0)))
	data["priceMult"] = pm

	var stats: Dictionary = data.get("stats", {}) if typeof(data.get("stats", {})) == TYPE_DICTIONARY else {}
	stats["planted"] = maxi(0, int(stats.get("planted", 0)))
	stats["harvested"] = maxi(0, int(stats.get("harvested", 0)))
	stats["raids"] = maxi(0, int(stats.get("raids", 0)))
	stats["maxFine"] = maxf(0.0, float(stats.get("maxFine", 0.0)))
	stats["watered"] = maxi(0, int(stats.get("watered", 0)))
	stats["newsSeen"] = maxi(0, int(stats.get("newsSeen", 0)))
	var hbt: Dictionary = stats.get("harvestedByType", {}) if typeof(stats.get("harvestedByType", {})) == TYPE_DICTIONARY else {}
	for k in PLANT_KEYS:
		hbt[k] = maxi(0, int(hbt.get(k, 0)))
	stats["harvestedByType"] = hbt
	data["stats"] = stats

	if not PLANT_KEYS.has(String(data.get("selectedPlant", "rose"))):
		data["selectedPlant"] = "rose"
	if typeof(data.get("achievements", {})) != TYPE_DICTIONARY:
		data["achievements"] = {}
	if typeof(data.get("newsHistory", [])) != TYPE_ARRAY:
		data["newsHistory"] = []
	if typeof(data.get("scheduled", [])) != TYPE_ARRAY:
		data["scheduled"] = []
	data["crackdown"] = bool(data.get("crackdown", false))
	data["fertilizers"] = maxi(0, int(data.get("fertilizers", 0)))
	data["autoClickWarns"] = maxi(0, int(data.get("autoClickWarns", 0)))
	data["lastWaterAt"] = float(data.get("lastWaterAt", 0.0))
	data["lastTick"] = float(data.get("lastTick", now_ms()))
	data["nextRandomNewsAt"] = float(data.get("nextRandomNewsAt", 0.0))

# ── простое чтение ───────────────────────────────────────────────────────────
func now_ms() -> float:
	return Time.get_unix_time_from_system() * 1000.0

func money() -> float:
	return float(data.get("money", 0.0))

func active_index() -> int:
	return int(data.get("activeGarden", 0))

func garden_count() -> int:
	var arr: Array = data.get("gardens", [])
	return arr.size()

func active_garden() -> Dictionary:
	var arr: Array = data.get("gardens", [])
	if arr.is_empty():
		arr.append(fresh_garden())
		data["gardens"] = arr
	var i := clampi(active_index(), 0, arr.size() - 1)
	var g: Variant = arr[i]
	if typeof(g) != TYPE_DICTIONARY:
		g = fresh_garden()
		arr[i] = g
	return g

func garden_size() -> int:
	return int(active_garden().get("size", GARDEN_BASE))

func cell_key(x: int, y: int) -> String:
	return "%d,%d" % [x, y]

func _cell_in(g: Dictionary, x: int, y: int) -> Dictionary:
	var cells: Dictionary = g.get("cells", {})
	var key := cell_key(x, y)
	if not cells.has(key):
		return {}
	var c: Variant = cells[key]
	if typeof(c) != TYPE_DICTIONARY:
		return {}
	return c

func cell_at(x: int, y: int) -> Dictionary:
	return _cell_in(active_garden(), x, y)

func size_valid(sz: int) -> bool:
	return SIZE_LIST.has(sz)

func next_size() -> int:
	var sz := garden_size()
	var i := SIZE_LIST.find(sz)
	if i < 0 or i >= SIZE_LIST.size() - 1:
		return 0
	return int(SIZE_LIST[i + 1])

func next_size_price() -> float:
	return SIZE_UPGRADE_PRICE

func seed_count(k: String) -> int:
	var seeds: Dictionary = data.get("seeds", {})
	return int(float(seeds.get(k, 0)))

func harvested_count(k: String) -> int:
	var harv: Dictionary = data.get("harvested", {})
	return int(float(harv.get(k, 0)))

func selected_plant() -> String:
	return String(data.get("selectedPlant", "rose"))

func crop(k: String) -> Dictionary:
	var v: Variant = CROPS.get(k, {})
	if typeof(v) != TYPE_DICTIONARY:
		return {}
	return v

func crop_color(k: String) -> Color:
	var def := crop(k)
	var hue := float(def.get("hue", 120.0)) / 360.0
	return Color.from_hsv(hue, 0.66, 0.92)

func pack_price(k: String) -> float:
	var def := crop(k)
	var mult := 1.0
	var pm: Dictionary = data.get("priceMult", {})
	var pk := String(def.get("price_key", ""))
	if pk != "" and pm.has(pk):
		mult = float(pm[pk])
	return float(def.get("pack_price", 0.0)) * mult

func sell_price(k: String) -> float:
	var def := crop(k)
	var mult := 1.0
	var pm: Dictionary = data.get("priceMult", {})
	var pk := String(def.get("price_key", ""))
	if pk != "" and pm.has(pk):
		mult = float(pm[pk])
	return float(def.get("sell", 0.0)) * mult

func stage(cell: Dictionary, now := -1.0) -> Dictionary:
	if now < 0.0:
		now = now_ms()
	var k := String(cell.get("plant", ""))
	if not CROPS.has(k):
		return { "stage": "unknown", "progress": 1.0 }
	if bool(cell.get("dead", false)):
		return { "stage": "dead", "progress": 1.0 }
	var def := crop(k)
	var planted := float(cell.get("plantedAt", now))
	var elapsed := maxf(0.0, now - planted)
	var grow := maxf(1.0, float(def.get("grow_ms", 1.0)))
	if elapsed < grow:
		return { "stage": "growing", "progress": clampf(elapsed / grow, 0.0, 1.0) }
	var shelf := float(def.get("shelf_ms", -1.0))
	if shelf >= 0.0 and elapsed > grow + shelf:
		return { "stage": "rotten", "progress": 1.0 }
	return { "stage": "mature", "progress": 1.0 }

func plant_count() -> int:
	var n := 0
	var arr: Array = data.get("gardens", [])
	for item in arr:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var cells: Dictionary = (item as Dictionary).get("cells", {})
		n += cells.size()
	return n

func mature_count() -> int:
	var now := now_ms()
	var n := 0
	var arr: Array = data.get("gardens", [])
	for item in arr:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var cells: Dictionary = (item as Dictionary).get("cells", {})
		for key in cells.keys():
			var c: Variant = cells[key]
			if typeof(c) == TYPE_DICTIONARY and String(stage(c as Dictionary, now).get("stage", "")) == "mature":
				n += 1
	return n

func harvest_value() -> float:
	var total := 0.0
	for k in PLANT_KEYS:
		total += sell_price(k) * float(harvested_count(k))
	return total

func water_left() -> float:
	var left := WATER_COOLDOWN_MS - (now_ms() - float(data.get("lastWaterAt", 0.0)))
	return maxf(0.0, left) / 1000.0

# ── действия ─────────────────────────────────────────────────────────────────
func set_active(i: int) -> void:
	var arr: Array = data.get("gardens", [])
	if arr.is_empty():
		return
	data["activeGarden"] = clampi(i, 0, arr.size() - 1)
	save()

func select_plant(k: String) -> void:
	if not CROPS.has(k):
		return
	data["selectedPlant"] = k
	save()

func _plant_raw(g: Dictionary, x: int, y: int, k: String) -> bool:
	if not CROPS.has(k):
		return false
	var sz := int(g.get("size", GARDEN_BASE))
	if x < 0 or y < 0 or x >= sz or y >= sz:
		return false
	var cells: Dictionary = g.get("cells", {})
	var key := cell_key(x, y)
	if cells.has(key):
		return false
	var seeds: Dictionary = data.get("seeds", {})
	if int(float(seeds.get(k, 0))) <= 0:
		return false
	var def := crop(k)
	seeds[k] = int(float(seeds[k])) - 1
	var cell := { "plant": k, "plantedAt": now_ms() }
	if bool(def.get("needs_water", false)):
		cell["watered"] = 0
		cell["resolved"] = false
		cell["dead"] = false
	cells[key] = cell
	g["cells"] = cells
	data["seeds"] = seeds
	var stats: Dictionary = data.get("stats", {})
	stats["planted"] = int(stats.get("planted", 0)) + 1
	data["stats"] = stats
	return true

func plant_at(x: int, y: int) -> bool:
	var ok := _plant_raw(active_garden(), x, y, selected_plant())
	if ok:
		save()
	return ok

func _harvest_raw(g: Dictionary, key: String, c: Dictionary, now: float) -> bool:
	var st := stage(c, now)
	var cells: Dictionary = g.get("cells", {})
	if String(st.get("stage", "")) == "mature":
		var k := String(c.get("plant", ""))
		var harv: Dictionary = data.get("harvested", {})
		harv[k] = int(float(harv.get(k, 0))) + 1
		data["harvested"] = harv
		var stats: Dictionary = data.get("stats", {})
		stats["harvested"] = int(stats.get("harvested", 0)) + 1
		var hbt: Dictionary = stats.get("harvestedByType", {})
		hbt[k] = int(float(hbt.get(k, 0))) + 1
		stats["harvestedByType"] = hbt
		data["stats"] = stats
		cells.erase(key)
		g["cells"] = cells
		return true
	if String(st.get("stage", "")) == "dead" or String(st.get("stage", "")) == "rotten":
		cells.erase(key)
		g["cells"] = cells
	return false

func harvest_at(x: int, y: int) -> bool:
	var g := active_garden()
	var c := _cell_in(g, x, y)
	if c.is_empty():
		return false
	var ok := _harvest_raw(g, cell_key(x, y), c, now_ms())
	save()
	return ok

func click_cell(x: int, y: int) -> String:
	var g := active_garden()
	var c := _cell_in(g, x, y)
	var now := now_ms()
	if c.is_empty():
		if plant_at(x, y):
			return "🌱 Посажено: " + String(crop(selected_plant()).get("name", "растение"))
		var k := selected_plant()
		return "Нет семян: " + String(crop(k).get("name", k))
	var st := stage(c, now)
	var state_name := String(st.get("stage", ""))
	if state_name == "mature":
		_harvest_raw(g, cell_key(x, y), c, now)
		save()
		return "🧺 Собрано: " + String(crop(String(c.get("plant", ""))).get("name", ""))
	if state_name == "dead" or state_name == "rotten":
		_harvest_raw(g, cell_key(x, y), c, now)
		save()
		return "🧹 Убрано погибшее растение"
	if state_name == "unknown":
		return "❓ Неизвестное растение — не трогаем"
	return "⏳ Растёт: %d%%" % int(round(float(st.get("progress", 0.0)) * 100.0))

func plant_all() -> String:
	var g := active_garden()
	var k := selected_plant()
	var available := seed_count(k)
	if available <= 0:
		return "❌ Нет семян: " + String(crop(k).get("name", k))
	var sz := int(g.get("size", GARDEN_BASE))
	var planted := 0
	var stop := false
	for y in sz:
		if stop:
			break
		for x in sz:
			if planted >= available:
				stop = true
				break
			if _plant_raw(g, x, y, k):
				planted += 1
	if planted > 0:
		save()
		return "🌱 Посажено: %d" % planted
	return "❌ Нет свободных мест"

func harvest_all() -> String:
	var now := now_ms()
	var n := 0
	var removed := 0
	var arr: Array = data.get("gardens", [])
	for item in arr:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var g: Dictionary = item
		var cells: Dictionary = g.get("cells", {})
		for key in cells.keys():
			var c: Variant = cells[key]
			if typeof(c) != TYPE_DICTIONARY:
				continue
			var st := stage(c as Dictionary, now)
			var sn := String(st.get("stage", ""))
			if sn == "mature":
				if _harvest_raw(g, String(key), c as Dictionary, now):
					n += 1
			elif sn == "dead" or sn == "rotten":
				if _harvest_raw(g, String(key), c as Dictionary, now):
					pass
				removed += 1
	if n > 0 or removed > 0:
		save()
	if n > 0:
		return "🧺 Собрано: %d" % n
	if removed > 0:
		return "🧹 Убрано погибших: %d" % removed
	return "Нечего собирать"

func sell_all() -> float:
	var total := 0.0
	var harv: Dictionary = data.get("harvested", {})
	for k in PLANT_KEYS:
		var c := int(float(harv.get(k, 0)))
		if c <= 0:
			continue
		total += sell_price(k) * float(c)
		harv[k] = 0
	if total > 0.0:
		data["harvested"] = harv
		data["money"] = money() + total
		save()
	return total

func water_all() -> String:
	var left := water_left()
	if left > 0.0:
		return "⏳ Подожди %.1f с" % left
	var now := now_ms()
	var n := 0
	var arr: Array = data.get("gardens", [])
	for item in arr:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var cells: Dictionary = (item as Dictionary).get("cells", {})
		for key in cells.keys():
			var c: Variant = cells[key]
			if typeof(c) != TYPE_DICTIONARY:
				continue
			var cd: Dictionary = c
			if String(cd.get("plant", "")) == "pansy" and not bool(cd.get("resolved", false)) and not bool(cd.get("dead", false)):
				cd["watered"] = int(cd.get("watered", 0)) + 1
				cells[key] = cd
				n += 1
	if n == 0:
		return "Нет растущих Анютиных глазок"
	data["lastWaterAt"] = now
	var stats: Dictionary = data.get("stats", {})
	stats["watered"] = int(stats.get("watered", 0)) + 1
	data["stats"] = stats
	save()
	return "💧 Полито: %d" % n

func can_afford(amount: float) -> bool:
	var main := 0.0
	if _main_total.is_valid():
		main = float(_main_total.call())
	return money() + main + 1e-9 >= amount

## Покупка сада: сначала касса сада, затем main (как в вебе).
func spend_total(amount: float) -> bool:
	if amount <= 0.0:
		return true
	if money() + 1e-9 >= amount:
		data["money"] = money() - amount
		save()
		return true
	var rem := amount - money()
	if not _spend_main.is_valid() or not bool(_spend_main.call(rem)):
		return false
	data["money"] = 0.0
	save()
	return true

## Списание из кассы сада для main-игры (после того как main-корзины пусты).
func spend_money_only(amount: float) -> bool:
	if amount <= 0.0:
		return true
	if money() + 1e-9 < amount:
		return false
	data["money"] = money() - amount
	save()
	return true

func buy_pack(k: String) -> String:
	if not CROPS.has(k):
		return "Неизвестное растение"
	var price := pack_price(k)
	if not can_afford(price):
		return "❌ Не хватает монет"
	if not spend_total(price):
		return "❌ Не удалось списать монеты"
	var def := crop(k)
	var seeds: Dictionary = data.get("seeds", {})
	seeds[k] = int(float(seeds.get(k, 0))) + int(def.get("pack_seeds", 0))
	data["seeds"] = seeds
	save()
	return "📦 Куплено %d семян %s" % [int(def.get("pack_seeds", 0)), String(def.get("name", k))]

func buy_size() -> String:
	var nxt := next_size()
	if nxt <= 0:
		return "Максимальный размер"
	if not can_afford(SIZE_UPGRADE_PRICE):
		return "❌ Не хватает монет"
	if not spend_total(SIZE_UPGRADE_PRICE):
		return "❌ Не удалось списать"
	var g := active_garden()
	g["size"] = nxt
	save()
	return "🌾 Сад расширен до %d×%d" % [nxt, nxt]

func buy_new_garden() -> String:
	var g := active_garden()
	if int(g.get("size", GARDEN_BASE)) < GARDEN_MAX:
		return "Сначала расширь сад до %d" % GARDEN_MAX
	if not can_afford(NEW_GARDEN_PRICE):
		return "❌ Не хватает монет"
	if not spend_total(NEW_GARDEN_PRICE):
		return "❌ Не удалось списать"
	var arr: Array = data.get("gardens", [])
	arr.append(fresh_garden())
	data["gardens"] = arr
	data["activeGarden"] = arr.size() - 1
	save()
	return "🌱 Куплен новый сад #%d" % arr.size()

func buy_maxim() -> String:
	var g := active_garden()
	if bool(g.get("maximBought", false)):
		return "Максим уже есть"
	if not can_afford(MAXIM_PRICE):
		return "❌ Не хватает монет"
	if not spend_total(MAXIM_PRICE):
		return "❌ Не удалось списать"
	g["maximBought"] = true
	g["maximEnabled"] = true
	save()
	return "🧑‍🌾 Максим-садовник нанят"

func toggle_maxim() -> String:
	var g := active_garden()
	if not bool(g.get("maximBought", false)):
		return ""
	g["maximEnabled"] = not bool(g.get("maximEnabled", true))
	save()
	return "🧑‍🌾 Максим работает" if bool(g["maximEnabled"]) else "💤 Максим отдыхает"

# ── тик: анютины глазки, Максим ──────────────────────────────────────────────
func tick() -> bool:
	var changed := false
	if _resolve_pansies():
		changed = true
	if _maxim_work():
		changed = true
	if changed:
		save()
	return changed

func _resolve_pansies() -> bool:
	var now := now_ms()
	var changed := false
	var arr: Array = data.get("gardens", [])
	for item in arr:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var cells: Dictionary = (item as Dictionary).get("cells", {})
		for key in cells.keys():
			var c: Variant = cells[key]
			if typeof(c) != TYPE_DICTIONARY:
				continue
			var cd: Dictionary = c
			if String(cd.get("plant", "")) != "pansy" or bool(cd.get("resolved", false)) or bool(cd.get("dead", false)):
				continue
			if now - float(cd.get("plantedAt", now)) >= 600000.0:
				cd["resolved"] = true
				var chance := minf(1.0, PANSY_BASE_SURVIVAL + float(cd.get("watered", 0)) * PANSY_WATER_BONUS)
				cd["dead"] = randf() >= chance
				cells[key] = cd
				changed = true
	return changed

func _maxim_work() -> bool:
	var changed := false
	var arr: Array = data.get("gardens", [])
	for item in arr:
		if typeof(item) != TYPE_DICTIONARY:
			continue
		var g: Dictionary = item
		if not bool(g.get("maximBought", false)) or not bool(g.get("maximEnabled", true)):
			continue
		var cells: Dictionary = g.get("cells", {})
		for key in cells.keys():
			var c: Variant = cells[key]
			if typeof(c) != TYPE_DICTIONARY:
				continue
			var cd: Dictionary = c
			if String(cd.get("plant", "")) == "pansy" and not bool(cd.get("resolved", false)) and not bool(cd.get("dead", false)):
				cd["watered"] = int(cd.get("watered", 0)) + 1
				cells[key] = cd
				changed = true
		var harvested := 0
		for key in cells.keys():
			if harvested >= 50:
				break
			var c: Variant = cells[key]
			if typeof(c) == TYPE_DICTIONARY and _harvest_raw(g, String(key), c as Dictionary, now_ms()):
				harvested += 1
				changed = true
		var k := selected_plant()
		var planted := 0
		var sz := int(g.get("size", GARDEN_BASE))
		var stop := false
		for y in sz:
			if stop:
				break
			for x in sz:
				if planted >= 50 or seed_count(k) <= 0:
					stop = true
					break
				if _plant_raw(g, x, y, k):
					planted += 1
					changed = true
	return changed
