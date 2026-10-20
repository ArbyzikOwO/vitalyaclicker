extends SceneTree
## Читает настоящий data.bin (base64), снятый из облака веб-версии, и печатает
## разбор. Запуск: godot --headless --path godot --script res://tests/web_save_test.gd -- --file=C:\path\web_save.b64

func _initialize() -> void:
	var file := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--file="):
			file = a.substr(7)
	if file == "":
		print("нужен --file=путь.b64")
		quit(1)
		return
	var f := FileAccess.open(file, FileAccess.READ)
	if not f:
		print("не открыть ", file)
		quit(1)
		return
	var b64 := f.get_as_text().strip_edges()
	f.close()
	var bytes := Marshalls.base64_to_raw(b64)
	print("байт: ", bytes.size())
	var res := VCSaveBin.decode(bytes)
	if not bool(res["ok"]):
		print("ОШИБКА: ", String(res["err"]))
		quit(1)
		return
	var s: Dictionary = res["state"]
	print("деньги: ", JSON.stringify(s["money"]), "  всего=", _total(s["money"]))
	print("клики: ", s["clicks"])
	print("апгрейды: ", JSON.stringify(s["upgrades"]))
	print("скины: ", JSON.stringify(s["owned_skins"]), " выбран=", s["skin"])
	print("казино: ", JSON.stringify(s["casino"]))
	print("пропуск=", s["propusk"], " внв=", s["vnv_pass"], " лох=", s["got_lox"])
	for k in VCSaveBin.CRYPTO_KEYS:
		var c: Dictionary = s["crypto"][k]
		print("  крипта ", k, ": цена=", c["price"], " шт=", c["held"], " история=", (c["history"] as Array).size())
	print("видеокарт: ", (s["mining"]["gpus"] as Array).size(), " максимов=", s["mining"]["maxims"], " вкл=", s["mining"]["maxims_enabled"])
	for i in (s["mining"]["farms"] as Array).size():
		var fm: Dictionary = s["mining"]["farms"][i]
		print("  ферма ", i, ": ", fm["crypto"], " gpu=", (fm["gpus"] as Array).size(), " слотов=", fm["max_gpus"])
	print("кредитов: ", (s["loans"] as Array).size())
	print("достижений: ", (s["achievements"] as Dictionary).size(), " из ", VCSaveBin.ACH_IDS.size())
	print("новостей: ", (s["news"] as Array).size(), " история: ", (s["news_history"] as Array).size())
	print("last_seen: ", s["last_seen"])
	print("звук=", res["extra"]["sound_choice"], " старость=", res["extra"]["starost_on"],
		" автосброс=", res["extra"]["auto_reset_at"], " предупреждения=", res["extra"]["auto_click_warns"],
		" blocked=", res["extra"]["blocked"])
	# обратная сборка: байты должны совпасть с исходными
	var g := VCGame.new()
	var err := g.from_cloud(bytes)
	print("импорт: ", "ок" if err == "" else err)
	var again := g.to_cloud()
	print("пересборка: ", again.size(), " байт, совпадает: ", again == bytes)
	if again != bytes:
		var n: int = mini(again.size(), bytes.size())
		for i in n:
			if again[i] != bytes[i]:
				print("  первое отличие на байте ", i, ": ", bytes[i], " -> ", again[i])
				break
	print("")
	print("ГОТОВО")
	quit(0)

func _total(m: Dictionary) -> float:
	var t := 0.0
	for v in m.values():
		t += float(v)
	return t
