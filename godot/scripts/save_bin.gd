class_name VCSaveBin
extends RefCounted
## Облачное сохранение в формате веб-версии (data.bin, SAVE_VERSION 24).
##
## Формат один и тот же у браузера, сервера и сада: сервер проверяет MAGIC,
## версию, контрольную сумму денег и запрещает отрицательные суммы. Поэтому
## Godot-версия пишет ровно те же байты и в том же порядке.
##
## Всё, чего в Godot-версии пока нет (звук, античит-поля, достижения сада),
## переносится как есть: при чтении запоминается в `extra`, при записи
## возвращается обратно. Так игра не теряет прогресс веб-версии.

const MAGIC := 0x56434442  # "BDCV" в little-endian
const VERSION := 24

const BASKETS := ["click", "auto", "casino", "crypto", "mining"]
const UPGRADE_IDS := ["maxim", "orda", "china", "starost", "finger", "mouse", "gold"]
const CRYPTO_KEYS := ["operativka", "zimbabwe", "ronaldo"]
const GPU_KEYS := ["rtx5080", "rx580", "intel"]

## Порядок достижений веб-версии — он же порядок битов в data.bin.
## Достижения сада Godot пока не знает, но их биты сохраняются.
const ACH_IDS := [
	"click1", "click100", "click10k", "click1m", "click1b",
	"rich1", "rich2", "rich3", "rich4",
	"skin1", "skin10", "skinsAll", "special", "secret", "bandit10", "mafia",
	"upgradeMax", "china", "starost",
	"loh", "x50", "spins1k", "spins10k", "propusk", "vnv",
	"crypto1", "cryptoman",
	"mine1", "gpu10", "gpu100",
	"loan", "murino",
	"g_sprout", "g_greenThumb", "g_greenMaster", "g_harvest1", "g_gardener",
	"g_harvest10k", "g_roseMaster", "g_citrusKing", "g_pansyLucky", "g_lemonFarmer",
	"g_dillDealer", "g_raidSurvived", "g_raidVeteran", "g_raidBigFine", "g_upgrade1",
	"g_allSizes", "g_fullGarden", "g_full50", "g_secondGarden", "g_maxim",
	"g_waterer", "g_newsJunkie", "g_rich1", "g_rich2", "g_rich3",
]

# ── контрольная сумма денег (FNV-1a 32, как в вебе и на сервере) ──────────────
static func money_key(money: Dictionary) -> int:
	var keys: Array = money.keys()
	keys.sort()
	var parts := PackedStringArray()
	for k in keys:
		parts.append("%s:%d" % [String(k), int(floor(float(money[k])))])
	var text := "|".join(parts)
	var h := 0x811c9dc5
	for i in text.length():
		h = (h ^ text.unicode_at(i)) & 0xFFFFFFFF
		h = (h * 0x01000193) & 0xFFFFFFFF
	return h

# ── запись ────────────────────────────────────────────────────────────────────
static func encode(g: VCGame) -> PackedByteArray:
	var sp := StreamPeerBuffer.new()
	var st: Dictionary = g.s
	var money: Dictionary = st["money"]
	var extra: Dictionary = st.get("cloud_extra", {})

	sp.put_u32(MAGIC)
	sp.put_u32(VERSION)
	sp.put_u32(money_key(money))
	for k in BASKETS:
		sp.put_double(maxf(0.0, float(money.get(k, 0.0))))
	sp.put_double(float(st["clicks"]))

	sp.put_u32(UPGRADE_IDS.size())
	for id in UPGRADE_IDS:
		sp.put_u32(int(st["upgrades"].get(id, 0)))

	var owned: Array = st["owned_skins"]
	sp.put_u32(owned.size())
	for id in owned:
		sp.put_u32(int(id))
	sp.put_u32(int(st["skin"]))

	var cas: Dictionary = st["casino"]
	sp.put_u32(int(cas["total_spins"]))
	sp.put_double(float(cas["multiplier"]))

	sp.put_8(int(extra.get("sound_choice", -1)))
	sp.put_double(float(st.get("last_seen", 0.0)))
	var starost_on := bool(extra.get("starost_on", false)) or int(st["upgrades"].get("starost", 0)) > 0
	sp.put_8(1 if starost_on else 0)
	sp.put_8(1 if bool(st.get("vnv_pass", false)) else 0)
	sp.put_8(1 if bool(st.get("propusk", false)) else 0)

	for k in CRYPTO_KEYS:
		var c: Dictionary = st["crypto"][k]
		sp.put_double(float(c["price"]))
		sp.put_double(float(c["held"]))
		var hist: Array = c["history"]
		sp.put_u32(hist.size())
		for h in hist:
			sp.put_double(float(h))

	var mining: Dictionary = st["mining"]
	var free: Array = mining["gpus"]
	sp.put_u32(free.size())
	for gp in free:
		sp.put_u8(_gpu_index(String(gp["type"])))
		sp.put_8(1 if bool(gp["broken"]) else 0)
	sp.put_u32(int(mining["maxims"]))
	sp.put_8(1 if bool(mining["maxims_enabled"]) else 0)

	var now := Time.get_unix_time_from_system()
	for f in mining["farms"]:
		sp.put_u32(int(f["max_gpus"]))
		var fg: Array = f["gpus"]
		sp.put_u32(fg.size())
		for gp in fg:
			sp.put_u8(_gpu_index(String(gp["type"])))
			sp.put_8(1 if bool(gp["broken"]) else 0)
			sp.put_double(float(gp.get("installed_at", now)))

	var loans: Array = st["loans"]
	sp.put_u32(loans.size())
	for l in loans:
		sp.put_double(float(l["amount"]))
		sp.put_double(float(l["hours"]))
		sp.put_double(float(l["start"]))
		sp.put_double(float(l.get("owed", g.loan_owed(l))))
		sp.put_8(1 if bool(l.get("paid", false)) else 0)

	# достижения: сначала сохранённые «чужие» биты, затем известные игре
	var raw: PackedByteArray = extra.get("ach_raw", PackedByteArray())
	var known: Dictionary = st["achievements"]
	for i in ACH_IDS.size():
		var on := false
		if i < raw.size() and raw[i] != 0:
			on = true
		if bool(known.get(String(ACH_IDS[i]), false)):
			on = true
		sp.put_8(1 if on else 0)

	var news: Array = st["news"]
	sp.put_u32(news.size())
	for n in news:
		sp.put_u8(int(n.get("id", 0)) & 0xFF)
		sp.put_double(float(n["time"]))
		sp.put_8(1 if bool(n["done"]) else 0)
		sp.put_8(int(n.get("dir", 0)))

	var hist2: Array = st["news_history"]
	sp.put_u32(hist2.size())
	for n in hist2:
		sp.put_u8(int(n.get("id", 0)) & 0xFF)
		sp.put_double(float(n.get("time", 0.0)))
		sp.put_8(int(n.get("dir", 0)))

	sp.put_8(1 if bool(st.get("got_lox", false)) else 0)
	sp.put_double(float(extra.get("auto_reset_at", 0.0)))
	sp.put_double(float(extra.get("auto_click_warns", 0.0)))
	sp.put_double(float(extra.get("auto_click_warns_reset_at", 0.0)))
	sp.put_8(1 if bool(extra.get("blocked", false)) else 0)
	return sp.data_array

static func _gpu_index(t: String) -> int:
	var i := GPU_KEYS.find(t)
	return maxi(0, i)

# ── чтение ────────────────────────────────────────────────────────────────────
## Возвращает {ok, err, state, extra}. state — готовое состояние для VCGame.s.
static func decode(bytes: PackedByteArray) -> Dictionary:
	var sp := StreamPeerBuffer.new()
	sp.data_array = bytes

	if bytes.size() < 70:
		return _err("Сохранение слишком короткое")
	if sp.get_u32() != MAGIC:
		return _err("Неверный формат data.bin")
	var ver := sp.get_u32()
	if ver != VERSION:
		return _err("Версия сохранения %d, нужна %d" % [ver, VERSION])
	var key := sp.get_u32()

	var st := {}
	var money := {}
	for k in BASKETS:
		money[k] = sp.get_double()
	for k in BASKETS:
		var v := float(money[k])
		if v < 0.0 or is_nan(v) or is_inf(v):
			return _err("Некорректные деньги в сохранении")
	if money_key(money) != key:
		return _err("Контрольная сумма сохранения не совпала")
	st["money"] = money
	st["clicks"] = sp.get_double()

	var n_up := sp.get_u32()
	if n_up > 10000:
		return _err("Испорченный список апгрейдов")
	var ups := {}
	for i in n_up:
		var lvl := sp.get_u32()
		if i < UPGRADE_IDS.size() and lvl > 0:
			ups[UPGRADE_IDS[i]] = lvl
	st["upgrades"] = ups

	var n_sk := sp.get_u32()
	if n_sk > 100000:
		return _err("Испорченный список скинов")
	var owned := []
	for i in n_sk:
		owned.append(sp.get_u32())
	if owned.is_empty():
		owned.append(0)
	st["owned_skins"] = owned
	st["skin"] = sp.get_u32()

	st["casino"] = {
		"total_spins": sp.get_u32(),
		"multiplier": clampf(sp.get_double(), float(VCData.CASINO["mult_min"]), float(VCData.CASINO["mult_max"])),
	}
	var extra := {}
	extra["sound_choice"] = sp.get_8()
	st["last_seen"] = sp.get_double()
	extra["starost_on"] = sp.get_8() == 1
	st["vnv_pass"] = sp.get_8() == 1
	st["propusk"] = sp.get_8() == 1

	var crypto := {}
	for k in CRYPTO_KEYS:
		var price := sp.get_double()
		var held := sp.get_double()
		var hlen := sp.get_u32()
		if hlen > 100000:
			return _err("Испорченная история цен")
		var hist := []
		for i in hlen:
			hist.append(sp.get_double())
		var meta: Dictionary = VCData.CRYPTO["coins"][k]
		crypto[k] = {
			"name": meta["name"], "price0": meta["price0"],
			"price": maxf(1.0, price), "held": held, "history": hist,
		}
	st["crypto"] = crypto

	var mining := { "gpus": [], "maxims": 0, "maxims_enabled": false, "farms": [] }
	var n_free := sp.get_u32()
	if n_free > 100000:
		return _err("Испорченный список видеокарт")
	for i in n_free:
		var t := _gpu_name(sp.get_u8())
		mining["gpus"].append({ "type": t, "speed": float(VCData.GPU_TYPES[t]["speed"]), "broken": sp.get_8() == 1 })
	mining["maxims"] = sp.get_u32()
	mining["maxims_enabled"] = sp.get_8() == 1
	for i in 3:
		var max_gpus := sp.get_u32()
		var n_g := sp.get_u32()
		if n_g > 100000:
			return _err("Испорченная ферма")
		var gpus := []
		for j in n_g:
			var t := _gpu_name(sp.get_u8())
			var broken := sp.get_8() == 1
			var installed := sp.get_double()
			gpus.append({ "type": t, "speed": float(VCData.GPU_TYPES[t]["speed"]), "broken": broken, "installed_at": installed })
		mining["farms"].append({ "crypto": CRYPTO_KEYS[i], "gpus": gpus, "max_gpus": maxi(1, max_gpus) })
	st["mining"] = mining

	var n_loans := sp.get_u32()
	if n_loans > 10000:
		return _err("Испорченные кредиты")
	var loans := []
	for i in n_loans:
		var amount := sp.get_double()
		var hours := sp.get_double()
		var start := sp.get_double()
		var owed := sp.get_double()
		var paid := sp.get_8() == 1
		loans.append({ "amount": amount, "hours": hours, "start": start, "paid": paid, "owed_hint": owed })
	st["loans"] = loans

	var ach_raw := PackedByteArray()
	var ach := {}
	for i in ACH_IDS.size():
		var b := sp.get_8()
		ach_raw.append(1 if b != 0 else 0)
		if b != 0:
			ach[String(ACH_IDS[i])] = true
	st["achievements"] = ach
	extra["ach_raw"] = ach_raw

	var n_news := sp.get_u32()
	if n_news > 10000:
		return _err("Испорченные новости")
	var news := []
	for i in n_news:
		var tid := sp.get_u8()
		var t := sp.get_double()
		var done := sp.get_8() == 1
		var dir := sp.get_8()
		var tpl := _news_template(tid)
		if tpl.is_empty():
			continue
		tpl["time"] = t
		tpl["done"] = done
		tpl["dir"] = dir
		news.append(tpl)
	st["news"] = news

	var n_hist := sp.get_u32()
	if n_hist > 10000:
		return _err("Испорченная история новостей")
	var news_hist := []
	for i in n_hist:
		var tid := sp.get_u8()
		var t := sp.get_double()
		var dir := sp.get_8()
		var tpl := _news_template(tid)
		news_hist.append({ "id": tid, "text": String(tpl.get("text", "")), "time": t, "dir": dir })
	st["news_history"] = news_hist

	st["got_lox"] = sp.get_8() == 1
	extra["auto_reset_at"] = sp.get_double()
	extra["auto_click_warns"] = sp.get_double()
	extra["auto_click_warns_reset_at"] = sp.get_double()
	extra["blocked"] = sp.get_8() == 1
	if sp.get_available_bytes() != 0:
		return _err("Лишние байты в сохранении (%d)" % sp.get_available_bytes())
	st["cloud_extra"] = extra
	st["version"] = VERSION
	return { "ok": true, "err": "", "state": st, "extra": extra }

static func _err(msg: String) -> Dictionary:
	return { "ok": false, "err": msg, "state": {}, "extra": {} }

static func _gpu_name(idx: int) -> String:
	return GPU_KEYS[idx] if idx >= 0 and idx < GPU_KEYS.size() else "intel"

static func _news_template(id: int) -> Dictionary:
	for t in VCData.NEWS:
		if int(t["id"]) == id:
			return t.duplicate(true)
	return {}
