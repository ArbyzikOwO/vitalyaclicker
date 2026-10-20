class_name VCNet
extends Node
## Связь с сервером: аккаунт (HTTP) и облачное сохранение (WebSocket).
##
## Протокол тот же, что у веб-версии:
##   POST /api/register {name, password} -> {ok, token, name}
##   POST /api/login    {name, password} -> {ok, token, name}
##   WS   /ws  {id, t:'auth', token}      -> {me}
##        {id, t:'save.info'}             -> {save, rev}
##        {id, t:'save.get'}              -> {main, garden, rev} | {empty:true}
##        {id, t:'save.put', main, baseRev, force, device} -> {rev} | {err:'conflict'}
##
## Сессия помнится 7 дней (как в вебе): token, имя и адрес сервера лежат в
## user://session.json. После выхода из аккаунта токен стирается.

signal link_changed(ok: bool, text: String)

const SESSION_PATH := "user://session.json"
const SESSION_SEC := 7 * 24 * 3600
const DEFAULT_SERVER := "http://127.0.0.1:3000"

var base := DEFAULT_SERVER
var token := ""
var user_name := ""
var device := ""
var signed_at := 0.0

var ws: WebSocketPeer = null
var authed := false
var last_error := ""
var me: Dictionary = {}
## Сад веб-версии (JSON-строка) — не наша, но её нельзя затирать при записи.
var garden: Variant = null

var _inbox: Array = []
var _next_id := 1

func _ready() -> void:
	load_session()

func _process(_dt: float) -> void:
	poll()

# ── сессия ────────────────────────────────────────────────────────────────────
func load_session() -> void:
	if not FileAccess.file_exists(SESSION_PATH):
		device = _make_device()
		return
	var f := FileAccess.open(SESSION_PATH, FileAccess.READ)
	if not f:
		device = _make_device()
		return
	var txt := f.get_as_text()
	f.close()
	var parsed: Variant = JSON.parse_string(txt)
	if typeof(parsed) != TYPE_DICTIONARY:
		device = _make_device()
		return
	var d: Dictionary = parsed
	base = normalize_url(String(d.get("server", DEFAULT_SERVER)))
	token = String(d.get("token", ""))
	user_name = String(d.get("name", ""))
	signed_at = float(d.get("at", 0.0))
	device = String(d.get("device", ""))
	if device == "":
		device = _make_device()
	if not session_valid():
		token = ""
		user_name = ""
		signed_at = 0.0
		save_session()

func save_session() -> void:
	var d := {
		"server": base, "token": token, "name": user_name,
		"at": signed_at, "device": device,
	}
	var f := FileAccess.open(SESSION_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(d))
		f.close()

func session_valid() -> bool:
	if token == "":
		return false
	return Time.get_unix_time_from_system() - signed_at < SESSION_SEC

func forget() -> void:
	token = ""
	user_name = ""
	signed_at = 0.0
	authed = false
	me = {}
	garden = null
	disconnect_ws()
	save_session()

func _make_device() -> String:
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	return "godot-" + str(rng.randi()).sha256_text().substr(0, 12)

func normalize_url(u: String) -> String:
	var s := u.strip_edges().trim_suffix("/")
	if s == "":
		return DEFAULT_SERVER
	if not s.begins_with("http://") and not s.begins_with("https://"):
		s = "http://" + s
	return s

func set_server(u: String) -> void:
	base = normalize_url(u)
	save_session()

func ws_url() -> String:
	var s := base
	if s.begins_with("https://"):
		s = "wss://" + s.substr(8)
	else:
		s = "ws://" + s.trim_prefix("http://")
	return s + "/ws"

# ── HTTP: вход и регистрация ─────────────────────────────────────────────────
func http_post(path: String, body: Dictionary, timeout_ms := 15000) -> Dictionary:
	var h := HTTPRequest.new()
	h.timeout = timeout_ms / 1000.0
	add_child(h)
	var headers := PackedStringArray(["Content-Type: application/json"])
	var err := h.request(base + path, headers, HTTPClient.METHOD_POST, JSON.stringify(body))
	if err != OK:
		h.queue_free()
		return { "ok": false, "err": "Сервер недоступен. Проверьте адрес сервера." }
	var res: Array = await h.request_completed
	h.queue_free()
	if res[0] != HTTPRequest.RESULT_SUCCESS:
		return { "ok": false, "err": "Сервер недоступен. Проверьте адрес сервера." }
	var code := int(res[1])
	var txt := (res[3] as PackedByteArray).get_string_from_utf8()
	var parsed: Variant = JSON.parse_string(txt)
	if typeof(parsed) != TYPE_DICTIONARY:
		return { "ok": false, "err": "Сервер ответил некорректно" }
	var j: Dictionary = parsed
	if code >= 400 or not bool(j.get("ok", false)):
		return { "ok": false, "err": String(j.get("err", "Ошибка сервера")) }
	return j

func login(name: String, pw: String, server := "") -> Dictionary:
	if server != "":
		set_server(server)
	else:
		save_session()
	var r := await http_post("/api/login", { "name": name, "password": pw })
	if bool(r.get("ok", false)):
		_after_login(r)
	return r

func register(name: String, pw: String, server := "") -> Dictionary:
	if server != "":
		set_server(server)
	else:
		save_session()
	var r := await http_post("/api/register", { "name": name, "password": pw })
	if bool(r.get("ok", false)):
		_after_login(r)
	return r

func _after_login(r: Dictionary) -> void:
	disconnect_ws()
	garden = null
	token = String(r.get("token", ""))
	user_name = String(r.get("name", user_name))
	signed_at = Time.get_unix_time_from_system()
	save_session()

func ping() -> Dictionary:
	return await http_post("/api/ping", {})

# ── WebSocket ────────────────────────────────────────────────────────────────
func poll() -> void:
	if ws == null:
		return
	ws.poll()
	if ws.get_ready_state() == WebSocketPeer.STATE_CLOSED:
		ws = null
		authed = false
		link_changed.emit(false, "Соединение закрыто")
		return
	while ws.get_available_packet_count() > 0:
		var pkt := ws.get_packet()
		var parsed: Variant = JSON.parse_string(pkt.get_string_from_utf8())
		if typeof(parsed) == TYPE_DICTIONARY:
			_inbox.append(parsed)

func connect_ws(timeout_ms := 8000) -> bool:
	if ws != null:
		disconnect_ws()
	ws = WebSocketPeer.new()
	var err := ws.connect_to_url(ws_url())
	if err != OK:
		ws = null
		last_error = "Не удалось подключиться к серверу"
		return false
	var deadline := Time.get_ticks_msec() + timeout_ms
	while Time.get_ticks_msec() < deadline:
		ws.poll()
		var st := ws.get_ready_state()
		if st == WebSocketPeer.STATE_OPEN:
			return true
		if st == WebSocketPeer.STATE_CLOSED:
			ws = null
			last_error = "Сервер недоступен. Проверьте адрес сервера."
			return false
		await get_tree().process_frame
	ws = null
	last_error = "Сервер не отвечает"
	return false

func disconnect_ws() -> void:
	if ws != null:
		ws.close()
	ws = null
	authed = false
	_inbox.clear()

func ensure_link() -> bool:
	if ws != null and ws.get_ready_state() == WebSocketPeer.STATE_OPEN and authed:
		return true
	if token == "":
		last_error = "Нужно войти в аккаунт"
		return false
	if ws == null or ws.get_ready_state() != WebSocketPeer.STATE_OPEN:
		if not await connect_ws():
			link_changed.emit(false, last_error)
			return false
	authed = false
	var r := await _send_wait("auth", { "token": token }, 15000)
	if bool(r.get("ok", false)):
		authed = true
		me = r.get("me", {})
		signed_at = Time.get_unix_time_from_system()
		save_session()
		link_changed.emit(true, "Онлайн: " + user_name)
		return true
	var e := String(r.get("err", "auth"))
	last_error = "Не удалось войти в аккаунт" if e == "auth" else e
	if e == "auth":
		token = ""
		user_name = ""
		signed_at = 0.0
		save_session()
	link_changed.emit(false, last_error)
	return false

func _send_wait(t: String, data: Dictionary, timeout_ms: int) -> Dictionary:
	if ws == null:
		return { "ok": false, "err": "Нет соединения с сервером" }
	var id := _next_id
	_next_id += 1
	var msg := data.duplicate()
	msg["id"] = id
	msg["t"] = t
	ws.send_text(JSON.stringify(msg))
	var deadline := Time.get_ticks_msec() + timeout_ms
	while Time.get_ticks_msec() < deadline:
		await get_tree().process_frame
		if ws == null:
			return { "ok": false, "err": "Соединение с сервером потеряно" }
		for i in _inbox.size():
			var m: Dictionary = _inbox[i]
			if int(m.get("re", -1)) == id:
				_inbox.remove_at(i)
				return m
	return { "ok": false, "err": "Сервер не отвечает" }

## Запрос с автоподключением и авторизацией.
func request(t: String, data := {}, timeout_ms := 20000) -> Dictionary:
	if not await ensure_link():
		return { "ok": false, "err": last_error }
	return await _send_wait(t, data, timeout_ms)

# ── облачное сохранение ──────────────────────────────────────────────────────
func save_info() -> Dictionary:
	return await request("save.info")

func save_get() -> Dictionary:
	var r := await request("save.get")
	if bool(r.get("ok", true)) and r.has("garden"):
		garden = r["garden"]
	return r

func save_put(bytes: PackedByteArray, base_rev: int, force := false) -> Dictionary:
	return await request("save.put", {
		"main": Marshalls.raw_to_base64(bytes),
		"garden": garden,
		"baseRev": base_rev,
		"force": force,
		"device": device,
	})
