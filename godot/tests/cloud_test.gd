extends SceneTree
## Живой тест облака: локальный сервер, временный аккаунт, data.bin туда-обратно.
##
## Запуск (сервер должен работать):
##   godot --headless --path godot --script res://tests/cloud_test.gd
##   ... -- --server=http://127.0.0.1:3000
##
## ВАЖНО: тест пишет session.json в каталог проекта. Запускайте его на копии
## проекта (например, во временной папке), чтобы не сбить свою сессию.

var fails := 0
var passes := 0
var net: VCNet

func ok(name: String, cond: bool, detail := "") -> void:
	if cond:
		passes += 1
		print("  ok   ", name)
	else:
		fails += 1
		print("  FAIL ", name, ("  — " + detail) if detail != "" else "")

func close(a: float, b: float, eps := 0.01) -> bool:
	return absf(a - b) <= eps * maxf(1.0, absf(b))

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	print("── ОБЛАКО ВЖИВУЮ ──")
	var server := "http://127.0.0.1:3000"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--server="):
			server = a.substr(9)
	net = VCNet.new()
	root.add_child(net)
	net.set_server(server)
	await process_frame

	var ping := await net.http_post("/api/ping", {})
	if not bool(ping.get("ok", false)):
		print("  FAIL сервер недоступен: ", server, " — ", String(ping.get("err", "")))
		fails += 1
		_quit()
		return
	ok("сервер отвечает", true, String(ping.get("version", "")))

	# временный аккаунт: регистрируем, а если уже есть — входим
	var r := await net.register("GodotQA", "godot1234")
	if not bool(r.get("ok", false)):
		r = await net.login("GodotQA", "godot1234")
	ok("вход в аккаунт", bool(r.get("ok", false)), String(r.get("err", "")))
	if not bool(r.get("ok", false)):
		_quit()
		return
	ok("сессия запомнена", net.session_valid() and net.token != "")

	# состояние с разными полями
	var g := VCGame.new()
	g.s["money"] = { "click": 777.0, "auto": 250000.0, "casino": 13.0, "crypto": 900.0, "mining": 5.0 }
	g.s["clicks"] = 1234
	g.s["upgrades"]["maxim"] = 4
	g.s["upgrades"]["finger"] = 3
	g.s["owned_skins"] = [0, 5, 5, 9]
	g.s["skin"] = 5
	g.s["casino"]["total_spins"] = 17
	g.s["casino"]["multiplier"] = 1.5
	g.s["propusk"] = true
	g.s["crypto"]["zimbabwe"]["price"] = 42.0
	g.s["crypto"]["zimbabwe"]["held"] = 1000.0
	g.s["mining"]["gpus"].append({ "type": "intel", "speed": 10.0, "broken": false })
	g.s["mining"]["farms"][1]["gpus"].append({ "type": "rx580", "speed": 20.0, "broken": false, "installed_at": 12345.0 })
	g.s["achievements"]["click1"] = true
	g.s["news_history"].append({ "id": 3, "text": "x", "time": 1000.0, "dir": 1 })
	g.s["last_seen"] = 1700000000.0
	var bytes := g.to_cloud()
	ok("сборка data.bin", bytes.size() > 100, str(bytes.size()))

	var put := await net.save_put(bytes, 0, true)
	ok("запись в облако", bool(put.get("ok", false)), String(put.get("err", "")))
	var rev := int(put.get("rev", 0))
	ok("сервер выдал rev", rev > 0, str(rev))

	var info := await net.save_info()
	var sv: Variant = info.get("save")
	ok("save.info видит сохранение", sv != null)
	if typeof(sv) == TYPE_DICTIONARY:
		var svi: Dictionary = sv
		ok("сервер посчитал деньги", close(float(svi.get("money", 0)), g.total_money(), 0.001), "%s vs %.2f" % [str(svi.get("money", 0)), g.total_money()])
		ok("сервер посчитал клики", int(svi.get("clicks", 0)) == 1234)

	var got := await net.save_get()
	ok("save.get отвечает", bool(got.get("ok", false)) and not bool(got.get("empty", false)), String(got.get("err", "")))
	var b64 := String(got.get("main", ""))
	ok("в облаке base64", b64.length() > 100)
	var g2 := VCGame.new()
	var err := g2.from_cloud(Marshalls.base64_to_raw(b64))
	ok("импорт без ошибок", err == "", err)
	ok("деньги совпали", close(g2.total_money(), g.total_money(), 1e-6), "%.2f vs %.2f" % [g2.total_money(), g.total_money()])
	ok("клики совпали", int(g2.s["clicks"]) == 1234)
	ok("апгрейды совпали", g2.level("maxim") == 4 and g2.level("finger") == 3)
	ok("скины совпали", (g2.s["owned_skins"] as Array).size() == 4 and int(g2.s["skin"]) == 5)
	ok("казино совпало", close(float(g2.s["casino"]["multiplier"]), 1.5) and int(g2.s["casino"]["total_spins"]) == 17)
	ok("крипта совпала", close(float(g2.s["crypto"]["zimbabwe"]["held"]), 1000.0))
	ok("видеокарты совпали", (g2.s["mining"]["gpus"] as Array).size() == 1 and (g2.s["mining"]["farms"][1]["gpus"] as Array).size() == 1)
	ok("достижение совпало", bool(g2.s["achievements"].get("click1", false)))
	ok("пропуск совпал", bool(g2.s["propusk"]))

	# обычная запись поверх: baseRev = текущая
	g2.add_money(5000.0, "auto")
	var put2 := await net.save_put(g2.to_cloud(), int(got.get("rev", 0)))
	ok("перезапись без конфликта", bool(put2.get("ok", false)), String(put2.get("err", "")))
	ok("rev вырос", int(put2.get("rev", 0)) > rev)
	var rev2 := int(put2.get("rev", 0))

	# другой девайс со старым baseRev -> конфликт
	var old_device := net.device
	net.device = "other-device"
	var put3 := await net.save_put(g2.to_cloud(), rev)
	ok("конфликт обнаружен", String(put3.get("err", "")) == "conflict", String(put3.get("err", "")))
	ok("конфликт отдаёт rev", int(put3.get("rev", 0)) == rev2)
	net.device = old_device

	# force перекрывает
	var put4 := await net.save_put(g2.to_cloud(), rev, true)
	ok("force перекрывает", bool(put4.get("ok", false)), String(put4.get("err", "")))

	# сад веб-версии (чужая часть сохранения) не затирается
	var gp := await net.request("save.put", {
		"main": Marshalls.raw_to_base64(g2.to_cloud()), "garden": "{\"stage\":1}",
		"baseRev": 0, "force": true, "device": old_device,
	})
	ok("сад записан в облако", bool(gp.get("ok", false)), String(gp.get("err", "")))
	await net.save_get()
	ok("сад получен", String(net.garden) == "{\"stage\":1}", str(net.garden))
	var put5 := await net.save_put(g2.to_cloud(), int(gp.get("rev", 0)))
	ok("запись с садом", bool(put5.get("ok", false)), String(put5.get("err", "")))
	var got5 := await net.save_get()
	ok("сад не затёрт", String(got5.get("garden", "")) == "{\"stage\":1}", str(got5.get("garden", "")))

	# сервер не принимает испорченный ключ
	var bad := g2.to_cloud()
	bad.encode_u32(8, 12345)
	var raw := await net.request("save.put", {
		"main": Marshalls.raw_to_base64(bad), "garden": null,
		"baseRev": 0, "force": true, "device": old_device,
	})
	ok("сервер отверг плохой ключ", not bool(raw.get("ok", false)) and String(raw.get("err", "")) != "", String(raw.get("err", "")))

	# и заблокированное сохранение
	var blocked := VCGame.new()
	blocked.s["money"]["click"] = 1.0
	blocked.s["cloud_extra"]["blocked"] = true
	var rb := await net.save_put(blocked.to_cloud(), 0, true)
	ok("сервер отверг blocked", not bool(rb.get("ok", false)) and String(rb.get("err", "")).contains("Заблок"), String(rb.get("err", "")))

	# после всех отказов рабочее облако не испорчено
	var fin := await net.save_get()
	var g3 := VCGame.new()
	var e3 := g3.from_cloud(Marshalls.base64_to_raw(String(fin.get("main", ""))))
	ok("облако читается после отказов", e3 == "", e3)
	ok("деньги целы", close(g3.total_money(), g2.total_money(), 1e-6), "%.2f vs %.2f" % [g3.total_money(), g2.total_money()])

	_quit()

func _quit() -> void:
	print("")
	if fails == 0:
		print("ИТОГ: %d ok, 0 fails" % passes)
	else:
		print("ИТОГ: %d ok, %d fails" % [passes, fails])
	quit(1 if fails > 0 else 0)
