extends RefCounted
class_name VCGame
## Состояние игры и вся логика (экономика, казино, крипта, майнинг, кредиты,
## новости, достижения, сохранение). Интерфейс только читает это и вызывает
## методы — как в веб-версии, где все расчёты собраны в одном месте.

var save_path := "user://save_v24.json"

var s: Dictionary = {}
## Сад (sad_data.bin). Может быть null в тестах и до входа в аккаунт.
var garden: VCGarden = null

func _init() -> void:
	new_game()

# ── состояние ─────────────────────────────────────────────────────────────────
func new_game() -> void:
	var crypto := {}
	for k in VCData.CRYPTO["keys"]:
		var c: Dictionary = VCData.CRYPTO["coins"][k]
		crypto[k] = { "name": c["name"], "price0": c["price0"], "price": c["price0"], "held": 0.0, "history": [] }
	var farms := []
	for i in VCData.MINING["farm_count"]:
		farms.append({ "crypto": VCData.CRYPTO["keys"][i], "gpus": [], "max_gpus": 5 })
	s = {
		"version": VCData.SAVE_VERSION,
		"money": { "click": 0.0, "auto": 0.0, "casino": 0.0, "crypto": 0.0, "mining": 0.0 },
		"clicks": 0,
		"upgrades": {},
		"owned_skins": [0],
		"skin": 0,
		"casino": { "total_spins": 0, "multiplier": VCData.CASINO["mult_min"] },
		"vnv_pass": false,
		"propusk": false,
		"crypto": crypto,
		"mining": { "gpus": [], "maxims": 0, "maxims_enabled": false, "farms": farms },
		"loans": [],
		"achievements": {},
		"news": [],
		"news_history": [],
		"got_lox": false,
		"last_seen": 0.0,
		"cloud_extra": {},
	}

# ── деньги ────────────────────────────────────────────────────────────────────
func main_money() -> float:
	var t := 0.0
	for v in s["money"].values():
		t += float(v)
	return t

func total_money() -> float:
	var t := main_money()
	if garden != null:
		t += garden.money()
	return t

func add_money(amount: float, src: String = "auto") -> void:
	if not s["money"].has(src):
		src = "auto"
	s["money"][src] = float(s["money"][src]) + amount

## Траты основной игры: сначала корзины main, затем (если не хватило) сад.
## Это совпадает с веб-версией, где totalMoney включает сад.
func spend(amount: float) -> bool:
	if amount <= 0.0:
		return true
	var main := main_money()
	if main + 1e-9 >= amount:
		return _spend_main(amount)
	if garden == null:
		return false
	var need := amount - main
	if garden.money() + 1e-9 < need:
		return false
	if not _spend_main(main):
		return false
	return garden.spend_money_only(need)

## Для сада: потратить строго из main-корзин, не трогая кассу сада.
func spend_main_only(amount: float) -> bool:
	return _spend_main(amount)

func _spend_main(amount: float) -> bool:
	if amount <= 0.0:
		return true
	if main_money() + 1e-9 < amount:
		return false
	var rem := amount
	var keys: Array = s["money"].keys()
	keys.shuffle()
	for k in keys:
		if rem <= 0.0:
			break
		var take: float = min(float(s["money"][k]), rem)
		s["money"][k] = float(s["money"][k]) - take
		rem -= take
	if rem > 0.0:
		var sorted := keys.duplicate()
		sorted.sort_custom(func(a, b): return float(s["money"][a]) > float(s["money"][b]))
		for k in sorted:
			if rem <= 0.0:
				break
			var take: float = min(float(s["money"][k]), rem)
			s["money"][k] = float(s["money"][k]) - take
			rem -= take
	for k in keys:
		s["money"][k] = max(0.0, float(s["money"][k]))
	return rem <= 0.0

# ── доход ─────────────────────────────────────────────────────────────────────
func level(id: String) -> int:
	return int(s["upgrades"].get(id, 0))

func multiplier() -> float:
	var m := 1.0
	for u in VCData.IDLE + VCData.CLICK:
		if u.has("multiplier"):
			m *= pow(float(u["multiplier"]), level(u["id"]))
	var sk := skin_by_id(int(s["skin"]))
	if not sk.is_empty():
		m *= float(sk.get("mult", 1.0))
	return m

func per_click() -> float:
	var base := VCData.CLICK_BASE
	for u in VCData.CLICK:
		if u.has("per_click"):
			base += float(u["per_click"]) * level(u["id"])
	return base * multiplier()

func per_sec() -> float:
	var base := 0.0
	for u in VCData.IDLE:
		if u.has("per_sec"):
			base += float(u["per_sec"]) * level(u["id"])
	return base * multiplier()

func upgrade_cost(u: Dictionary) -> float:
	return floor(float(u["base"]) * pow(float(u["growth"]), level(u["id"])))

func buy_upgrade(id: String) -> bool:
	var u := {}
	for x in VCData.IDLE + VCData.CLICK:
		if x["id"] == id:
			u = x
			break
	if u.is_empty():
		return false
	if id == "starost" and level(id) > 0:
		return false
	var cost := upgrade_cost(u)
	if not spend(cost):
		return false
	s["upgrades"][id] = level(id) + 1
	unlock("starost" if id == "starost" else "")
	check_achievements()
	return true

func click() -> void:
	s["clicks"] = int(s["clicks"]) + 1
	add_money(per_click(), "click")
	check_achievements()

# ── скины ─────────────────────────────────────────────────────────────────────
func skin_by_id(id: int) -> Dictionary:
	for sk in VCData.SKINS:
		if int(sk["id"]) == id:
			return sk
	return {}

func owns_skin(id: int) -> bool:
	return id in s["owned_skins"]

func buy_skin(id: int) -> String:
	var sk := skin_by_id(id)
	if sk.is_empty():
		return "Нет такого скина"
	if owns_skin(id) and not bool(sk.get("consumable", false)):
		return "Уже куплено"
	var price := float(sk.get("price", -1.0))
	if price < 0.0:
		return "Этот скин не продаётся — только крафт или событие"
	if not spend(price):
		return "Не хватает монет"
	s["owned_skins"].append(id)
	if id == 107:
		pass # флаг мафии нужен только саду (веб-версия)
	unlock("mafia" if id == 107 else ("secret" if id == 9 else ""))
	check_achievements()
	return ""

func select_skin(id: int) -> bool:
	if not owns_skin(id):
		return false
	s["skin"] = id
	return true

func luck() -> float:
	var l := 0.0
	var seen := {}
	for id in s["owned_skins"]:
		if seen.has(id):
			continue
		seen[id] = true
		var sk := skin_by_id(int(id))
		if not sk.is_empty():
			l += float(sk.get("luck", 0.0))
	return l

func has_baf(name: String) -> bool:
	for id in s["owned_skins"]:
		var sk := skin_by_id(int(id))
		if not sk.is_empty() and String(sk.get("baf", "")) == name:
			return true
	return false

func can_craft(r: Dictionary) -> int:
	var owned := 0
	for id in s["owned_skins"]:
		if int(id) == int(r["need"]):
			owned += 1
	return owned / int(r["count"])

func craft(r: Dictionary, times: int) -> bool:
	times = max(1, times)
	if can_craft(r) < times:
		return false
	for i in times * int(r["count"]):
		var idx: int = s["owned_skins"].find(int(r["need"]))
		if idx < 0:
			return false
		s["owned_skins"].remove_at(idx)
	for i in times:
		s["owned_skins"].append(int(r["give"]))
	check_achievements()
	return true

# ── казино ────────────────────────────────────────────────────────────────────
func win_chance(m: float) -> float:
	var c: Dictionary = VCData.CASINO
	var base: float = clampf(float(c["rtp"]) / maxf(m, 0.01), float(c["min_chance"]), float(c["max_chance"]))
	var spins := int(s["casino"]["total_spins"])
	var decay: float = 1.0 - float(c["decay_rate"]) * (float(spins % int(c["decay_spins"])) / float(c["decay_spins"]))
	var chance := base * decay * (1.0 + luck())
	if has_baf("football"):
		chance = minf(1.0, chance * (1.0 + float(VCData.BUFFS["football_casino"])))
	return clampf(chance, 0.0, 1.0)

func spin(bet: float) -> Dictionary:
	if not bool(s["propusk"]):
		return { "ok": false, "err": "Нужен пропуск в Бурмалду" }
	bet = floor(bet)
	if bet <= 0.0:
		return { "ok": false, "err": "Введи ставку" }
	if not spend(bet):
		return { "ok": false, "err": "Не хватает монет" }
	var m := float(s["casino"]["multiplier"])
	var win := randf() < win_chance(m)
	if win:
		add_money(bet * m, "casino")
		if m >= float(VCData.CASINO["mult_max"]):
			s["casino"]["total_spins"] = 0
			s["casino"]["multiplier"] = VCData.CASINO["mult_min"]
			unlock("x50")
		else:
			s["casino"]["total_spins"] = int(s["casino"]["total_spins"]) + 1
	else:
		s["casino"]["total_spins"] = int(s["casino"]["total_spins"]) + 1
		if total_money() <= 0.0:
			unlock("loh")
	if int(s["casino"]["total_spins"]) >= int(VCData.CASINO["decay_spins"]):
		s["casino"]["total_spins"] = 0
	check_achievements()
	return { "ok": true, "win": win, "mult": m, "bet": bet, "amount": bet * m }

func set_multiplier(m: float) -> void:
	s["casino"]["multiplier"] = clampf(snappedf(m, 0.1), float(VCData.CASINO["mult_min"]), float(VCData.CASINO["mult_max"]))

func buy_pass() -> String:
	var price := float(VCData.CASINO["pass_price"])
	if bool(s["propusk"]):
		return "Уже куплено"
	if not spend(price):
		return "Не хватает монет"
	s["propusk"] = true
	unlock("propusk")
	return ""

func buy_vip() -> String:
	var price := float(VCData.CASINO["vip_price"])
	if bool(s["vnv_pass"]):
		return "Уже куплено"
	if not spend(price):
		return "Не хватает монет"
	s["vnv_pass"] = true
	s["casino"]["total_spins"] = 0
	s["casino"]["multiplier"] = VCData.CASINO["mult_min"]
	unlock("vnv")
	return ""

# ── крипта ────────────────────────────────────────────────────────────────────
func crypto_discount() -> float:
	return float(VCData.BUFFS["news5g_crypto_discount"]) if has_baf("news5g") else 0.0

func crypto_buy(key: String, qty: int, discount := true) -> String:
	if not s["crypto"].has(key):
		return "Нет такой валюты"
	qty = max(1, qty)
	var c: Dictionary = s["crypto"][key]
	var price := float(c["price"]) * qty * (1.0 - (crypto_discount() if discount else 0.0))
	if not spend(price):
		return "Не хватает монет"
	c["held"] = float(c["held"]) + qty
	check_achievements()
	return ""

func crypto_sell(key: String) -> String:
	if not s["crypto"].has(key):
		return "Нет такой валюты"
	var c: Dictionary = s["crypto"][key]
	if float(c["held"]) <= 0.0:
		return "Нечего продавать"
	var gained := float(c["held"]) * float(c["price"])
	c["held"] = 0.0
	add_money(gained, "crypto")
	if gained >= float(VCData.THRESHOLDS["crypto_pro"]):
		unlock("cryptoman")
	return ""

func crypto_price(key: String) -> float:
	return float(s["crypto"][key]["price"]) if s["crypto"].has(key) else 0.0

func push_price(key: String, price: float) -> void:
	if not s["crypto"].has(key):
		return
	var c: Dictionary = s["crypto"][key]
	c["price"] = maxf(1.0, price)
	var hist: Array = c["history"]
	hist.append(float(c["price"]))
	if hist.size() > 100:
		hist.pop_front()

# ── майнинг ───────────────────────────────────────────────────────────────────
func mining_mult() -> float:
	var m := 1.0
	if owns_skin(106) and owns_skin(3):
		m *= maxf(1.0, float(s["casino"]["total_spins"]))
	if has_baf("news5g"):
		m *= float(VCData.BUFFS["news5g_mining"])
	return m

func gpus_total() -> int:
	var n: int = s["mining"]["gpus"].size()
	for f in s["mining"]["farms"]:
		n += f["gpus"].size()
	return n

func gpu_buy(t: String) -> String:
	if not VCData.GPU_TYPES.has(t):
		return "Нет такой видеокарты"
	var info: Dictionary = VCData.GPU_TYPES[t]
	if not spend(float(info["price"])):
		return "Не хватает монет"
	s["mining"]["gpus"].append({ "type": t, "speed": float(info["speed"]), "broken": false, "installed_at": Time.get_unix_time_from_system() })
	check_achievements()
	return ""

func gpu_install_cost(key: String) -> float:
	return floor(crypto_price(key) / float(VCData.MINING["install_divisor"]))

func gpu_install(farm_i: int, gpu_i: int) -> String:
	var farms: Array = s["mining"]["farms"]
	if farm_i < 0 or farm_i >= farms.size():
		return "Нет такой фермы"
	var f: Dictionary = farms[farm_i]
	if f["gpus"].size() >= int(f["max_gpus"]):
		return "Ферма полна"
	var free: Array = s["mining"]["gpus"]
	if gpu_i < 0 or gpu_i >= free.size():
		return "GPU не найден"
	var g: Dictionary = free[gpu_i]
	if bool(g["broken"]):
		return "Видеокарта сломана"
	var cost := gpu_install_cost(String(f["crypto"]))
	if not spend(cost):
		return "Установка стоит слишком дорого"
	free.remove_at(gpu_i)
	g["installed_at"] = Time.get_unix_time_from_system()
	f["gpus"].append(g)
	return ""

func gpu_remove(farm_i: int, idx: int) -> void:
	var farms: Array = s["mining"]["farms"]
	if farm_i < 0 or farm_i >= farms.size():
		return
	var f: Dictionary = farms[farm_i]
	if idx < 0 or idx >= f["gpus"].size():
		return
	var g: Dictionary = f["gpus"][idx]
	f["gpus"].remove_at(idx)
	s["mining"]["gpus"].append(g)

func maxim_buy() -> String:
	if not spend(float(VCData.MINING["maxim_price"])):
		return "Не хватает монет"
	s["mining"]["maxims"] = int(s["mining"]["maxims"]) + 1
	return ""

func maxim_toggle() -> String:
	var need := int(ceil(float(gpus_total() - int(s["mining"]["gpus"].size())) / float(VCData.MINING["gpus_per_maxim"])))
	if not bool(s["mining"]["maxims_enabled"]) and int(s["mining"]["maxims"]) < need:
		return "Нужно минимум %d Максимов" % need
	s["mining"]["maxims_enabled"] = not bool(s["mining"]["maxims_enabled"])
	return ""

func farm_slot_up(i: int) -> String:
	var farms: Array = s["mining"]["farms"]
	if i < 0 or i >= farms.size():
		return "Нет такой фермы"
	if not spend(float(VCData.MINING["farm_slot_price"])):
		return "Не хватает монет"
	farms[i]["max_gpus"] = int(farms[i]["max_gpus"]) + 1
	return ""

func _try_auto_replace(f: Dictionary) -> void:
	if not bool(s["mining"]["maxims_enabled"]):
		return
	if int(s["mining"]["maxims"]) <= 0:
		return
	for i in f["gpus"].size():
		if bool(f["gpus"][i]["broken"]):
			var t := String(f["gpus"][i]["type"])
			f["gpus"][i] = { "type": t, "speed": float(VCData.GPU_TYPES[t]["speed"]), "broken": false, "installed_at": Time.get_unix_time_from_system() }
			s["mining"]["maxims"] = int(s["mining"]["maxims"]) - 1
			return

# ── кредиты ───────────────────────────────────────────────────────────────────
func loan_owed(l: Dictionary) -> float:
	return float(l["amount"]) * (1.0 + float(VCData.LOANS["rate_per_hour"]) * _hours_since(float(l["start"])))

func _hours_since(t: float) -> float:
	return (Time.get_unix_time_from_system() - t) / 3600.0

func loan_take(amount: float, hours: int) -> String:
	if not s["loans"].is_empty():
		return "Уже есть активный кредит"
	amount = floor(amount)
	if amount < float(VCData.LOANS["min"]) or amount > float(VCData.LOANS["max"]):
		return "Сумма вне диапазона"
	hours = clampi(hours, int(VCData.LOANS["hours_min"]), int(VCData.LOANS["hours_max"]))
	s["loans"].append({ "amount": amount, "hours": hours, "start": Time.get_unix_time_from_system(), "paid": false })
	add_money(amount, "auto")
	unlock("loan")
	return ""

func loan_pay_early(i: int) -> String:
	if i < 0 or i >= s["loans"].size():
		return "Нет кредита"
	var l: Dictionary = s["loans"][i]
	var owed: float = floor(loan_owed(l))
	if not spend(owed):
		return "Не хватает монет"
	s["loans"].remove_at(i)
	return ""

func process_loans() -> void:
	var keep := []
	for l in s["loans"]:
		if _hours_since(float(l["start"])) >= float(l["hours"]):
			var need: float = max(0.0, floor(loan_owed(l)))
			var have := total_money()
			if have >= need:
				spend(need)
				continue
			if have > 0.0:
				spend(have)
			var left: float = max(1.0, floor(need - have))
			l["amount"] = left
			l["start"] = Time.get_unix_time_from_system()
			l["hours"] = 1
		keep.append(l)
	s["loans"] = keep

# ── новости ───────────────────────────────────────────────────────────────────
func ensure_news() -> void:
	var pending := []
	for n in s["news"]:
		if not bool(n["done"]):
			pending.append(n)
	if pending.size() >= 20:
		return
	var now := Time.get_unix_time_from_system()
	var last := now
	for n in pending:
		last = maxf(last, float(n["time"]))
	for i in range(1, 61):
		var tpl: Dictionary = VCData.NEWS[randi() % VCData.NEWS.size()]
		var n := tpl.duplicate()
		n["time"] = last + i * VCData.NEWS_INTERVAL
		n["done"] = false
		s["news"].append(n)

func apply_news(effect: String) -> void:
	var c: Dictionary = s["crypto"]
	match effect:
		"op+10":   push_price("operativka", float(c["operativka"]["price"]) * 1.10)
		"op+50":   push_price("operativka", float(c["operativka"]["price"]) * 1.50)
		"op-100":  push_price("operativka", maxf(1.0, float(c["operativka"]["price"]) * 0.5))
		"op+300":  push_price("operativka", float(c["operativka"]["price"]) * 4.0)
		"op-300":  push_price("operativka", maxf(1.0, float(c["operativka"]["price"]) / 4.0))
		"op+100":  push_price("operativka", float(c["operativka"]["price"]) * 2.0)
		"ron+70":  push_price("ronaldo", float(c["ronaldo"]["price"]) * 1.70)
		"ron-70":  push_price("ronaldo", maxf(1.0, float(c["ronaldo"]["price"]) * 0.30))
		"zBuy":    push_price("zimbabwe", float(c["zimbabwe"]["price"]) * 1.05)
		"zSell":   push_price("zimbabwe", maxf(1.0, float(c["zimbabwe"]["price"]) * 0.95))

## Возвращает массив текстов сработавших новостей (для тоста).
func news_tick() -> Array:
	ensure_news()
	var now := Time.get_unix_time_from_system()
	var fired := []
	var rest := []
	for n in s["news"]:
		if not bool(n["done"]) and float(n["time"]) <= now:
			apply_news(String(n["effect"]))
			s["news_history"].push_front({ "id": int(n.get("id", 0)), "text": n["text"], "time": n["time"], "dir": n.get("dir", 0) })
			fired.append(String(n["text"]))
		else:
			rest.append(n)
	if s["news_history"].size() > 20:
		s["news_history"].resize(20)
	s["news"] = rest
	return fired

# ── достижения ────────────────────────────────────────────────────────────────
func unlock(id: String) -> void:
	if id == "":
		return
	s["achievements"][id] = true

func ach_done(id: String) -> bool:
	return bool(s["achievements"].get(id, false))

func _ach_ok(id: String) -> bool:
	var cl := int(s["clicks"])
	var money := total_money()
	var ups: Dictionary = s["upgrades"]
	match id:
		"click1": return cl >= 1
		"click100": return cl >= 100
		"click10k": return cl >= 10000
		"click1m": return cl >= 1000000
		"click1b": return cl >= 1000000000
		"rich1": return money >= 1e6
		"rich2": return money >= 1e9
		"rich3": return money >= 1e12
		"rich4": return money >= 1e15
		"skin1": return s["owned_skins"].size() > 1
		"skin10": return _unique_skins() >= 10
		"skinsAll":
			for i in [1, 2, 3, 4, 5, 6, 7, 8, 9]:
				if not owns_skin(i):
					return false
			return true
		"special":
			for i in [100, 101, 103, 104, 105, 106, 107]:
				if owns_skin(i):
					return true
			return false
		"secret": return owns_skin(9)
		"bandit10": return s["owned_skins"].count(102) >= 10
		"mafia": return owns_skin(107)
		"upgradeMax":
			for v in ups.values():
				if int(v) >= 10:
					return true
			return false
		"china": return int(ups.get("china", 0)) > 0
		"starost": return int(ups.get("starost", 0)) > 0
		"spins1k": return int(s["casino"]["total_spins"]) >= 1000
		"spins10k": return int(s["casino"]["total_spins"]) >= 10000
		"propusk": return bool(s["propusk"])
		"vnv": return bool(s["vnv_pass"])
		"crypto1":
			for c in s["crypto"].values():
				if float(c["held"]) > 0.0:
					return true
			return false
		"mine1": return gpus_total() > 0
		"gpu10": return gpus_total() >= 10
		"gpu100": return gpus_total() >= 100
	return false

func _unique_skins() -> int:
	var seen := {}
	for id in s["owned_skins"]:
		seen[id] = true
	return seen.size()

func check_achievements() -> Array:
	var newly := []
	for a in VCData.ACH:
		var id := String(a["id"])
		if ach_done(id):
			continue
		if _ach_ok(id):
			s["achievements"][id] = true
			newly.append(a)
	return newly

# ── тик игры ──────────────────────────────────────────────────────────────────
func tick(dt: float) -> void:
	add_money(per_sec() * dt, "auto")
	var mm := mining_mult()
	for f in s["mining"]["farms"]:
		var speed := 0.0
		for g in f["gpus"]:
			if not bool(g["broken"]):
				speed += float(g["speed"])
		if speed > 0.0:
			var key := String(f["crypto"])
			s["crypto"][key]["held"] = float(s["crypto"][key]["held"]) + speed * mm * dt * float(VCData.MINING["yield_per_speed_sec"])
		for g in f["gpus"]:
			if bool(g["broken"]):
				continue
			var info: Dictionary = VCData.GPU_TYPES.get(String(g["type"]), {})
			if info.is_empty():
				continue
			var p: float = dt / (float(info["hours_to_break"]) * 3600.0)
			if randf() < p:
				g["broken"] = true
				_try_auto_replace(f)
	# «Старость»: авто-покупка фабрик, пока хватает денег (как в вебе)
	if level("starost") > 0:
		var china: Dictionary = {}
		for u in VCData.IDLE:
			if u["id"] == "china":
				china = u
				break
		if not china.is_empty():
			var guard := 0
			while guard < 200:
				guard += 1
				var cost := upgrade_cost(china)
				if not spend(cost):
					break
				s["upgrades"]["china"] = level("china") + 1
	process_loans()
	check_achievements()

# ── сохранение ────────────────────────────────────────────────────────────────
func save() -> void:
	s["last_seen"] = Time.get_unix_time_from_system()
	var f := FileAccess.open(save_path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(s))
		f.close()

func has_save() -> bool:
	return FileAccess.file_exists(save_path)

func load_game() -> bool:
	if not FileAccess.file_exists(save_path):
		return false
	var f := FileAccess.open(save_path, FileAccess.READ)
	if not f:
		return false
	var txt := f.get_as_text()
	f.close()
	var parsed: Variant = JSON.parse_string(txt)
	if typeof(parsed) != TYPE_DICTIONARY:
		return false
	var d: Dictionary = parsed
	if typeof(d.get("money")) != TYPE_DICTIONARY:
		return false
	# мягкое слияние: чего нет в файле — берём из новой игры
	var base := s
	new_game()
	for k in s.keys():
		if d.has(k):
			s[k] = d[k]
	# нормализация словарей после JSON
	var money: Dictionary = s["money"]
	for k in ["click", "auto", "casino", "crypto", "mining"]:
		money[k] = float(money.get(k, 0.0))
	var cr: Dictionary = s["crypto"]
	for k in VCData.CRYPTO["keys"]:
		if not cr.has(k):
			cr[k] = base["crypto"][k]
		cr[k]["price"] = float(cr[k].get("price", cr[k]["price0"]))
		cr[k]["held"] = float(cr[k].get("held", 0.0))
		cr[k]["history"] = cr[k].get("history", [])
	var mn: Dictionary = s["mining"]
	mn["maxims"] = int(mn.get("maxims", 0))
	mn["maxims_enabled"] = bool(mn.get("maxims_enabled", false))
	mn["gpus"] = mn.get("gpus", [])
	mn["farms"] = mn.get("farms", base["mining"]["farms"])
	for f2 in mn["farms"]:
		f2["max_gpus"] = int(f2.get("max_gpus", 5))
		f2["gpus"] = f2.get("gpus", [])
		for g in f2["gpus"]:
			g["broken"] = bool(g.get("broken", false))
			g["speed"] = float(g.get("speed", 1.0))
	s["clicks"] = int(s["clicks"])
	s["skin"] = int(s["skin"])
	s["owned_skins"] = s["owned_skins"].map(func(x): return int(x))
	s["upgrades"] = s["upgrades"] if typeof(s["upgrades"]) == TYPE_DICTIONARY else {}
	s["casino"]["multiplier"] = float(s["casino"].get("multiplier", VCData.CASINO["mult_min"]))
	s["casino"]["total_spins"] = int(s["casino"].get("total_spins", 0))
	s["loans"] = s["loans"] if typeof(s["loans"]) == TYPE_ARRAY else []
	s["achievements"] = s["achievements"] if typeof(s["achievements"]) == TYPE_DICTIONARY else {}
	s["news"] = s["news"] if typeof(s["news"]) == TYPE_ARRAY else []
	s["news_history"] = s["news_history"] if typeof(s["news_history"]) == TYPE_ARRAY else []
	s["cloud_extra"] = s["cloud_extra"] if typeof(s["cloud_extra"]) == TYPE_DICTIONARY else {}
	return true

# ── облако (data.bin веб-версии) ──────────────────────────────────────────────
## Собрать двоичное сохранение для сервера.
func to_cloud() -> PackedByteArray:
	return VCSaveBin.encode(self)

## Принять облачное сохранение. Возвращает "" или текст ошибки.
func from_cloud(bytes: PackedByteArray) -> String:
	var res := VCSaveBin.decode(bytes)
	if not bool(res["ok"]):
		return String(res["err"])
	var st: Dictionary = res["state"]
	for k in s.keys():
		if st.has(k):
			s[k] = st[k]
	# деньги и мелочи приводим к числам: JSON/облако могут дать int
	var money: Dictionary = s["money"]
	for k in ["click", "auto", "casino", "crypto", "mining"]:
		money[k] = float(money.get(k, 0.0))
	s["clicks"] = int(float(s["clicks"]))
	s["skin"] = int(s["skin"])
	s["owned_skins"] = s["owned_skins"].map(func(x): return int(x))
	if s["owned_skins"].is_empty():
		s["owned_skins"] = [0]
	if not s["owned_skins"].has(s["skin"]):
		s["skin"] = int(s["owned_skins"][0])
	var cas: Dictionary = s["casino"]
	cas["total_spins"] = int(cas.get("total_spins", 0))
	cas["multiplier"] = float(cas.get("multiplier", VCData.CASINO["mult_min"]))
	return ""

## Изменилось ли состояние с момента последней отправки (для автосинка).
func cloud_digest() -> String:
	return str(hash(to_cloud()))

## Оффлайн-доход: пассив + майнинг, максимум 24 часа.
func apply_offline() -> float:
	var last := float(s.get("last_seen", 0.0))
	if last <= 0.0:
		return 0.0
	var now := Time.get_unix_time_from_system()
	var sec: float = clampf(now - last, 0.0, float(VCData.OFFLINE["cap_sec"]))
	if sec < 5.0:
		return 0.0
	var gained := per_sec() * sec
	if gained > 0.0:
		add_money(gained, "auto")
	var mm := mining_mult()
	for f in s["mining"]["farms"]:
		var speed := 0.0
		for g in f["gpus"]:
			if not bool(g["broken"]):
				speed += float(g["speed"])
		if speed > 0.0:
			var key := String(f["crypto"])
			s["crypto"][key]["held"] = float(s["crypto"][key]["held"]) + speed * mm * sec * float(VCData.MINING["yield_per_speed_sec"])
	process_loans()
	ensure_news()
	return sec

# ── форматирование ────────────────────────────────────────────────────────────
static func fmt(v: float) -> String:
	var names := ["", "K", "M", "B", "T", "Qa", "Qi", "Sx"]
	var i := 0
	var x := v
	while x >= 1000.0 and i < names.size() - 1:
		x /= 1000.0
		i += 1
	if i == 0:
		return str(int(round(x)))
	return "%.2f%s" % [x, names[i]]

static func fmt_mult(m: float) -> String:
	if is_equal_approx(m, round(m)):
		return str(int(round(m)))
	return "%.1f" % m

static func fmt_chance(c: float) -> String:
	var p := c * 100.0
	if p > 0.0 and p < 0.01:
		return "<0.01%"
	return "%.2f%%" % p
