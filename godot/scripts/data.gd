class_name VCData
extends RefCounted
## Все числа и каталоги игры — один источник, как ECON в веб-версии.
## Ничего не считается «магическими числами» в других скриптах.

const SAVE_VERSION := 24
const NEWS_INTERVAL := 120.0          # секунд между новостями
const CLICK_BASE := 1.0

# ── пассивный доход и клик (порядок = порядок в интерфейсе) ───────────────────
const IDLE := [
	{ "id": "maxim",   "name": "Купить Максима",                  "desc": "+1 монета/сек",                 "icon": "🧑", "base": 50.0,   "growth": 1.15, "per_sec": 1.0 },
	{ "id": "orda",    "name": "Купить орду Максимов (+45)",      "desc": "+45 монет/сек",                 "icon": "👥", "base": 2500.0, "growth": 1.16, "per_sec": 45.0 },
	{ "id": "china",   "name": "Купить фабрику Максимов (+1000)", "desc": "+1000 монет/сек",               "icon": "🏭", "base": 1e7,    "growth": 1.18, "per_sec": 1000.0 },
	{ "id": "starost", "name": "Старость",                        "desc": "Авто-покупка фабрик Максимов",  "icon": "👴", "base": 5e7,    "growth": 1.0,  "auto_china": true },
]

const CLICK := [
	{ "id": "finger", "name": "Тренировка пальца", "desc": "+1 монета за клик",    "icon": "👆", "base": 50.0,   "growth": 1.15, "per_click": 1.0 },
	{ "id": "mouse",  "name": "Игровая мышь",      "desc": "+8 монет за клик",      "icon": "🖱️", "base": 1500.0, "growth": 1.18, "per_click": 8.0 },
	{ "id": "gold",   "name": "Золотой палец",     "desc": "×1.5 ко всему доходу",  "icon": "✨", "base": 5e6,    "growth": 1.6,  "multiplier": 1.5 },
]

const CASINO := {
	"pass_price": 45e6,
	"vip_price": 500e6,
	"mult_min": 1.5,
	"mult_max": 50.0,
	"step": 0.1,
	"rtp": 0.95,
	"max_chance": 0.65,
	"min_chance": 0.000001,
	"decay_spins": 10000,
	"decay_rate": 0.5,
}

const CRYPTO := {
	"keys": ["operativka", "zimbabwe", "ronaldo"],
	"coins": {
		"operativka": { "name": "Оперативка", "price0": 1e8 },
		"zimbabwe": { "name": "Зимбабвийский доллар", "price0": 1e6 },
		"ronaldo": { "name": "RonaldoCoin", "price0": 1e9 },
	},
}

const MINING := {
	"yield_per_speed_sec": 0.001,
	"maxim_price": 10e9,
	"gpus_per_maxim": 5,
	"farm_slot_price": 1e9,
	"install_divisor": 2.0,
	"farm_count": 3,
}

const GPU_TYPES := {
	"rtx5080": { "name": "rtx5080", "price": 10e9, "speed": 5.0, "hours_to_break": 8.0 },
	"rx580":   { "name": "rx580",   "price": 1e9,  "speed": 3.0, "hours_to_break": 3.0 },
	"intel":   { "name": "intel",   "price": 25e6, "speed": 1.0, "hours_to_break": 1.0 },
}
const GPU_PRIORITY := ["rtx5080", "rx580", "intel"]

const LOANS := { "min": 1e3, "max": 1e12, "hours_min": 1, "hours_max": 5, "rate_per_hour": 0.01 }
const UNLOCK := { "casino": 45e6, "crypto": 50e6 }
const THRESHOLDS := { "crypto_pro": 1e12 }
const OFFLINE := { "cap_sec": 24.0 * 3600.0 }
const BUFFS := { "football_casino": 0.10, "news5g_mining": 5.0, "news5g_crypto_discount": 0.12 }

# ── скины ─────────────────────────────────────────────────────────────────────
# price < 0 — нельзя купить (только крафт/событие). src — файл в assets/skins.
const SKINS := [
	{ "id": 0,   "name": "Виталя 69",  "price": 0.0,     "mult": 1.0,  "src": "" },
	{ "id": 1,   "name": "Арбуз",      "price": 500.0,   "mult": 1.2,  "src": "1.jpg" },
	{ "id": 2,   "name": "Бананы",     "price": 5000.0,  "mult": 1.5,  "src": "2.jpg" },
	{ "id": 3,   "name": "Шахид",      "price": 50000.0, "mult": 1.9,  "src": "3.jpg" },
	{ "id": 4,   "name": "Эпштейн",    "price": 500000.0, "mult": 2.4, "src": "4.jpg" },
	{ "id": 5,   "name": "Эпштейн нарисованный", "price": 5000000.0, "mult": 3.2, "src": "5.png" },
	{ "id": 6,   "name": "Нарисованный шахид",   "price": 50000000.0, "mult": 4.2, "src": "6.png" },
	{ "id": 7,   "name": "Нарисованный банан",   "price": 500000000.0, "mult": 5.5, "src": "7.png" },
	{ "id": 8,   "name": "Арбузик",    "price": 5e9,       "mult": 7.5,  "src": "8.jpg" },
	{ "id": 9,   "name": "Старшеклассник", "price": 50e9,  "mult": 12.0, "src": "9.jpg" },
	{ "id": 100, "name": "Футболист",  "price": -1.0, "mult": 17.0, "src": "100.jpg", "baf": "football", "note": "×17 доход, казино +10%" },
	{ "id": 101, "name": "5g парень",  "price": -1.0, "mult": 1.0,  "src": "101.jpg", "baf": "news5g", "note": "майнинг ×5, крипта −12%" },
	{ "id": 102, "name": "Бандит",     "price": 10e6, "mult": 1.0,  "src": "102.jpg", "consumable": true, "note": "материал для крафта" },
	{ "id": 103, "name": "Ахуенный скин", "price": -1.0, "mult": 6.0, "src": "103.jpg", "baf": "cool", "note": "×6 доход" },
	{ "id": 104, "name": "Арбузик младший", "price": 7.5e9, "mult": 6.5, "src": "104.jpg", "luck": 0.08, "note": "+8% удача" },
	{ "id": 105, "name": "Лох",        "price": -1.0, "mult": 1.0,  "src": "105.jpg", "luck": 0.01, "note": "+1% удача" },
	{ "id": 106, "name": "ВАЗ",        "price": -1.0, "mult": 1.0,  "src": "106.jpg", "is_vaz": true, "note": "майнинг × прокруты (со Шахидом)" },
	{ "id": 107, "name": "Глава китайской мафии", "price": 100e12, "mult": 1.0, "src": "107.jpg", "is_mafia": true, "note": "отгоняет полицию в саду" },
	{ "id": 108, "name": "Телифон",     "price": 25e9, "mult": 1.2,  "src": "108.jpg", "phone": true, "luck": 0.05, "note": "звонит и кусается · +5% удача" },
]

const RECIPES := [
	{ "need": 102, "count": 10,  "give": 103, "name": "Ахуенный" },
	{ "need": 103, "count": 10,  "give": 106, "name": "ВАЗ" },
	{ "need": 103, "count": 100, "give": 101, "name": "5g парень" },
	{ "need": 106, "count": 100, "give": 100, "name": "Футболист" },
]

# ── новости ───────────────────────────────────────────────────────────────────
const NEWS := [
	{ "id": 1,  "text": "Китайцы начали разработку архитектуры ОЗУ", "effect": "opStart", "dir": 0 },
	{ "id": 2,  "text": "Китайцы разработали архитектуру ОЗУ", "effect": "op+10", "dir": 1 },
	{ "id": 3,  "text": "Китайцы скупают ОЗУ для ИИ", "effect": "op+50", "dir": 1 },
	{ "id": 4,  "text": "Китайская компания обанкротилась, ОЗУ дёшево", "effect": "op-100", "dir": -1 },
	{ "id": 5,  "text": "Рональдо проиграл матч", "effect": "ron-70", "dir": -1 },
	{ "id": 6,  "text": "Рональдо выиграл матч", "effect": "ron+70", "dir": 1 },
	{ "id": 7,  "text": "ООО «тмыв денег» инвестирует в зимбабвийский доллар", "effect": "zStart", "dir": 0 },
	{ "id": 8,  "text": "ООО «тмыв денег» скупила зимбабвийские доллары", "effect": "zBuy", "dir": 1 },
	{ "id": 9,  "text": "ООО «тмыв денег» продаёт зимбабвийские доллары", "effect": "zSell", "dir": -1 },
	{ "id": 10, "text": "Samsung прекратила производство ОЗУ", "effect": "op+300", "dir": 1 },
	{ "id": 11, "text": "Samsung возобновила производство ОЗУ", "effect": "op-300", "dir": -1 },
	{ "id": 12, "text": "ООО «тмыв денег» производит ОЗУ", "effect": "op-100", "dir": -1 },
	{ "id": 13, "text": "ООО «тмыв денег» остановило производство ОЗУ", "effect": "op+100", "dir": 1 },
]

# ── достижения (условия — в game.gd, здесь только тексты) ─────────────────────
const ACH := [
	{ "id": "click1",    "name": "Первый клик",        "desc": "Сделать 1 клик",                 "emoji": "👆" },
	{ "id": "click100",  "name": "Размялся",           "desc": "100 кликов",                     "emoji": "👆" },
	{ "id": "click10k",  "name": "Ебать ты кликер",    "desc": "10 000 кликов",                  "emoji": "💪" },
	{ "id": "click1m",   "name": "Ебать ты кликер II", "desc": "1М кликов",                      "emoji": "🏋️" },
	{ "id": "click1b",   "name": "Легенда кликов",     "desc": "1B кликов",                      "emoji": "🏅" },
	{ "id": "rich1",     "name": "Первый миллион",     "desc": "Заработать 1M монет",            "emoji": "💰" },
	{ "id": "rich2",     "name": "Миллиардер",         "desc": "Заработать 1B монет",            "emoji": "💵" },
	{ "id": "rich3",     "name": "Триллионер",         "desc": "Заработать 1T монет",            "emoji": "💎" },
	{ "id": "rich4",     "name": "Квадриллионер",      "desc": "Заработать 1Qa монет",           "emoji": "👑" },
	{ "id": "skin1",     "name": "Первый скин",        "desc": "Купить любой скин",              "emoji": "🎭" },
	{ "id": "skin10",    "name": "Коллекционер",       "desc": "10 разных скинов",               "emoji": "🎭" },
	{ "id": "skinsAll",  "name": "Все обычные скины",  "desc": "Собрать все 9 обычных скинов",   "emoji": "🏆" },
	{ "id": "special",   "name": "Особенный",          "desc": "Получить любой специальный скин", "emoji": "✨" },
	{ "id": "secret",    "name": "Секрет раскрыт",     "desc": "Купить Старшеклассника",         "emoji": "🔒" },
	{ "id": "bandit10",  "name": "Бригада",            "desc": "Купить 10 бандитов",             "emoji": "🕴️" },
	{ "id": "mafia",     "name": "Глава китайской мафии", "desc": "Купить скин «Глава китайской мафии»", "emoji": "🕴️" },
	{ "id": "upgradeMax", "name": "Максимальный апгрейд", "desc": "Любой апгрейд 10 уровня",     "emoji": "⚡" },
	{ "id": "china",     "name": "Фабрика",            "desc": "Купить первую фабрику Максимов", "emoji": "🏭" },
	{ "id": "starost",   "name": "Дедушка",            "desc": "Купить Старость",                "emoji": "👴" },
	{ "id": "loh",       "name": "Ебать ты лох",       "desc": "Слить ВСЁ в казино",             "emoji": "💀" },
	{ "id": "x50",       "name": "x50!",               "desc": "Победить с множителем x50",      "emoji": "🎰" },
	{ "id": "spins1k",   "name": "Азартный",           "desc": "1000 прокруток",                 "emoji": "🎲" },
	{ "id": "spins10k",  "name": "Азартный II",        "desc": "10 000 прокруток",               "emoji": "🎲" },
	{ "id": "propusk",   "name": "Пропуск в Бурмалду", "desc": "Купить пропуск в Бурмалду",      "emoji": "🎫" },
	{ "id": "vnv",       "name": "Верхний Новгород",   "desc": "Купить пропуск в Верхний Новгород", "emoji": "🎫" },
	{ "id": "crypto1",   "name": "Первая крипта",      "desc": "Купить любую криптовалюту",      "emoji": "💎" },
	{ "id": "cryptoman", "name": "Ахуеть ты криптоман", "desc": "Поднять >1T с продажи крипты",  "emoji": "💎" },
	{ "id": "mine1",     "name": "Майнер",             "desc": "Купить первую видеокарту",       "emoji": "⛏️" },
	{ "id": "gpu10",     "name": "Фермер",             "desc": "10 видеокарт всего",             "emoji": "⛏️" },
	{ "id": "gpu100",    "name": "Дата-центр",         "desc": "100 видеокарт всего",            "emoji": "🏭" },
	{ "id": "loan",      "name": "Должник",            "desc": "Взять кредит",                   "emoji": "🏦" },
]
