# Terminal — TradingView uslubidagi forex terminal

> Bu — loyihaning to'liq o'zbekcha qo'llanmasi. Inglizcha umumiy tavsif: [../README.md](../README.md).

MetaTrader 5 terminalidan **real tick** narxlarni olib, brauzerda TradingView'ga o'xshash
interfeysda ko'rsatadigan lokal platforma. Real pulga tegmaydi: savdo to'liq **simulyatsiya**
(paper trading), alertlar brauzerda ishlaydi.

## Talablar

- Windows + **MetaTrader 5** terminali ochiq va broker hisobiga ulangan bo'lishi kerak
  (istalgan broker; terminal yo'li boshqacha bo'lsa `MT5_TERMINAL_PATH` env o'zgaruvchisini bering)
- Python 3.12 + `MetaTrader5`, `fastapi`, `uvicorn`
- Node.js 20+

## Ishga tushirish

```bat
start.bat
```

So'ng brauzerda <http://127.0.0.1:5173> ni oching. Ikkita yordamchi oyna ochiladi (API + UI),
ularni yopmaslik kerak. MT5 terminali ham ochiq turishi shart.

Qo'lda ishga tushirish:

```bash
# 1) backend (port 8787 — 8000 bu kompyuterda band)
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8787

# 2) frontend (port 5173)
cd frontend
npm install
npm run dev
```

> **Python haqida:** Windows'da `python` ba'zan Microsoft Store'ning bo'sh alias'i bo'ladi. Agar
> `python -c "import MetaTrader5"` ishlamasa, `py -3 -m uvicorn main:app ...` ishlatib ko'ring.
> `start.ps1` o'zi ishlaydigan interpretatorni topadi: `MT5_PYTHON` → `py -3` → `python` → `python3`.

## Arxitektura

```
MT5 terminal  --MetaTrader5 (python, lokal IPC ~0 ms)-->  backend/feed.py
                                                            |  tick poll 100 ms
                                                            |  M1..W1 shamlar, 3m/2h resample
                                                            v
                                                    backend/main.py (FastAPI /ws)
                                                            |  bar delta + 300 ms heartbeat
                                                            v
                                      frontend: React 19 + lightweight-charts v5
```

- Narx manbai: MT5 (API kaliti, obuna, to'lov kerak emas)
- Yangilanish: tick kelganda darhol + har 300 ms heartbeat (talab: 0.3 s)
- Instrumentlar: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, XAUUSD
- Timeframe: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1D, 1W (3m/2h — resample)

## API

| Endpoint | Tavsif |
|---|---|
| `GET /api/health` | feed holati, broker vaqti ofseti |
| `GET /api/symbols` | instrumentlar metasi (digits, point) |
| `GET /api/history?symbol=EURUSD&tf=1m&count=500` | shamlar (oxirgi `count`) |
| `GET /api/history?...&before=<unix>` | shu vaqtdan **eskiroq** shamlar (infinite scroll) |
| `WS /ws` | `sub`/`unsub`/`more`, `init`/`bar`/`bars`/`heartbeat` |

## Boshqaruv (chart)

| Harakat | Natija |
|---|---|
| Chapga/o'ngga tortish | vaqt bo'ylab siljish (istalgan sana) |
| **Tepaga/pastga tortish** | narx shkalasi "qulfdan chiqadi" — chartni vertikal siljitish (avto-scale o'chadi) |
| G'ildirak | zoom (vaqt o'qi) |
| O'ng narx o'qini tortish | narx shkalasini cho'zish/siqish |
| `auto` tugmasi yoki narx o'qini 2 marta bosish | avto-shkalaga qaytish |
| Yangi instrument/TF | avto-shkala avtomatik qaytadi |
| Chap chekkaga tortish | eski tarix avtomatik yuklanadi (~1500 shamdan) |
| Pastdagi `▶ LIVE` | real vaqtga qaytish |
| Pastdagi `1D/5D/1M/3M/6M/YTD/1Y/5Y/All` | shu davrni ko'rsatish (kerak bo'lsa tarix yuklanadi, `All` — yuklangan hammasi) |
| Pastdagi `‹ ›` | chartni yarim ekranga chapga/o'ngga surish |
| Pastdagi `↔` | real vaqtga qaytish |
| Chap relda `Kursor` | oddiy crosshair |
| Chap relda `Crosshair` | magnit crosshair (sham OHLC'ga yopishadi) |
| **Ctrl** (bosib turish) | magnit crosshair: gorizontal chiziq shamning eng yaqin **OHLC — high/low wick** qiymatiga yopishadi (narx tepasida bo'lsa high, pastda bo'lsa low); qo'yib yuborilsa erkin harakatga qaytadi |
| **Shift** (chizish paytida) | chiziq burchagini **gorizontal / 45° / vertikal** qulflaydi — trendline "tekis" chiqadi; tutqichni sudraganda ham ishlaydi |
| Chap relda `O'lchash` | **bos → yurgiz → yana bos** (tortish shart emas, chart surilmaydi): Δ narx, Δ pip, Δ %, shamlar soni, davomiylik, narx A → B |
| Chizma paneli (chart ustida suzadi, grip bilan ko'chiriladi) | 12 asbob: trend chizig'i, nur, gorizontal/vertikal chiziq, kanal, to'rtburchak, strelka, qalam, matn, long/short pozitsiya, ko'p nuqtali chiziq |
| Tanlangan chizma paneli (pastda) | nusxa, matnni tahrirlash, qalinlik (1–4px), rang palitrasi, uslub (tekis/shtrix/nuqtali) + to'ldirish, shu narxga alert, qulf, o'chirish, oldinga chiqarish |
| Chizmani tahrirlash (TradingView kabi) | chizmani bosib tanlang → dumaloq tutqichlar chiqadi. **Uchidan ushlab tortsangiz** faqat o'sha nuqta siljiydi (chiziq cho'ziladi/qisqaradi, burchak o'zgaradi); **o'rtasidan ushlab tortsangiz** butun chizma ko'chadi. Har bir asbobda ishlaydi: trend, nur, kanal, to'rtburchak, long/short (TP/SL), ko'p nuqtali, matn, h/v chiziq |
| Long / Short pozitsiya (TradingView kabi) | bitta bosish — kirish nuqtasi, **TP/SL avtomatik 1:1** (oxirgi volatillik bo'yicha) qo'yiladi. Keyin: TP/SL kvadrat tutqichlarini vertikal tortib R/R ni o'zgartirasiz, kirish chizig'ining o'rtasidan butun pozitsiyani ko'chirasiz, o'ngdagi dumaloq tutqich bilan quti kengligini (vaqtini) o'zgartirasiz. Yorliqlarda: Target/Stop narxi, pip, %, R/R, lot va potensial $ (paper hisob loti bo'yicha), Entry qatorida joriy **Open PnL**. Yorliqlar faqat pozitsiya **ustiga kursor kelganda yoki u tanlanganda** ko'rinadi (TradingView kabi — aks holda faqat yashil/qizil zonalar turadi) |
| Chizma: Esc / o'ng tugma | chizishni bekor qiladi (Esc + o'lchashdan ham chiqadi), Enter — ko'p nuqtali chizmani tugatadi |
| Delete / Ctrl+D | tanlangan chizmani o'chirish / nusxalash |
| Chap relda `+ / −` | vaqt o'qini yaqinlashtirish/uzoqlashtirish |
| Yuqorida `Chart turi` | Shamlar / Bar / Chiziq / Area |
| Yuqorida `Indikatorlar` | EMA 20, EMA 50, SMA 200, Bollinger (20, 2) |
| Yuqorida `Qo'ng'iroq` | narx alertlari paneli (badge — faol alertlar soni) |
| Yuqorida `Trade` yoki chartdagi SELL/BUY | paper trading ticket (balans $10 000) |
| Yuqorida `⚙` | grid / crosshair / sham taymeri sozlamalari |
| Yuqorida `⤢` / `📷` / `💾` | fullscreen / PNG snapshot / layoutni saqlash |
| `MT5` tugmasi | ulanish holati (feed, server vaqti, uptime, instrumentlar) |
| Pastdagi chap burchakdagi `History` ikonkasi | **Bar Replay** oynasi: sana tanlab o'tmishni bar-bar o'ynatish |
| Ctrl+K | instrument qidiruv |

## Klaviatura (TradingView uslubida)

| Tugma | Natija |
|---|---|
| **Ctrl** (bosib turish) | crosshair narxni eng yaqin OHLC (wick) qiymatiga "magnit" kabi tortadi |
| **Shift** (chizishda) | burchakni gorizontal / 45° / vertikal qulflaydi |
| `T` `R` `H` `V` `C` `B` `A` `D` `X` `L` `S` `P` | chizma asboblari (trend, nur, gorizontal, vertikal, kanal, to'rtburchak, strelka, qalam, matn, long, short, polyline) |
| `Delete` / `Backspace` | tanlangan chizmani o'chirish |
| `Enter` | ko'p nuqtali chiziq / qalamni tugatish |
| `Esc` | chizishni bekor qilish, o'lchashni tozalash, oynalarni yopish |
| **Ctrl+K** | instrument qidirish |

Xuddi shu ro'yxat ilova ichida ham bor: **⚙ Sozlamalar → Klaviatura**.

## Bar Replay (backtest)

Pastdagi chap burchakdagi history ikonkasi → sana tanlash oynasi. Narxlar **MT5'dan
avtomatik** yuklanadi — fayl import qilish shart emas.

| Boshqaruv | Natija |
|---|---|
| Tez tanlash: `1 kun / 3 kun / 1 hafta / 2 hafta / 1 oy / 3 oy` | sanani bir bosishda to'ldiradi |
| `Replayni boshlash` | kursor o'sha shamga qo'yiladi va o'ynatish boshlanadi |
| `⏮` / `▶` `⏸` / `⏭` | 1 sham orqaga / o'ynatish-to'xtatish / 1 sham oldinga |
| tezlik | 0.5x, 1x, 2x, 4x, 8x (bar/sekund) |
| sana | istalgan vaqtga sakrash (jumladan replay paytida ham) |
| `✕` | replaydan chiqish — chart jonli bozorga qaytadi |

Muhim: **timeframe yoki instrument almashsangiz ham replay boshidan boshlanmaydi** — kursor
vaqti saqlanadi, faqat yangi TF/instrument ma'lumoti yuklanadi (TradingView'dagi kabi).
Replay paytida chart faqat kursor vaqtigacha bo'lgan shammlarni ko'rsatadi, narx shkalasi va
last-price kursor narxiga bog'lanadi. Paper trading ham replay narxida ishlaydi: orderlar
kursor narxida ochiladi, SL/TP shu paytda chiqqan shamning high/low'i bo'yicha tekshiriladi,
replaydan chiqqanda replay pozitsiyalari oxirgi kursor narxida yopiladi.

## Holat

- [x] MT5 real tick oqimi, 8 instrument, 10 timeframe, 0.3 s heartbeat
- [x] TradingView uslubidagi qobiq: top bar, chap rels, price scale, last price + countdown
- [x] Symbol qidiruv (Ctrl+K), watchlist paneli, OHLC legend, crosshair
- [x] Infinite scroll: chap chekkaga tortilganda tarix bo'lak-bo'lak yuklanadi (1m: ~6000 sham,
      1h: ~1500 sham = 3 oy, 1D: 2021 yilgacha), `▶ LIVE` tugmasi real vaqtga qaytaradi
- [x] Vertikal narx panning: chartni tepaga/pastga tortish narx shkalasini qulfdan chiqaradi,
      `auto` / narx o'qini 2 marta bosish avto-rejimga qaytaradi
- [x] Davr tugmalari (1D..All), vaqt o'qini surish/zoom
- [x] O'lchash asbobi TradingView uslubida: ikki bosish (drag emas), to'liq info — Δ narx, pip, %,
      shamlar soni, davomiylik; chart bu paytda surilmaydi
- [x] Chizma asboblari: trendline, nur, gorizontal/vertikal chiziq, kanal, to'rtburchak, strelka,
      qalam, matn, long/short, polyline — tanlanganda sozlamalar paneli (rang, qalinlik, uslub,
      to'ldirish, qulf, nusxa, o'chirish, alert), har instrument uchun alohida, localStorage'da saqlanadi
- [x] Chizmani chizgandan keyin tahrirlash (TradingView kabi): tutqichdan ushlab uchlarini
      cho'zish/qisqartirish va burchakni o'zgartirish, o'rtasidan ushlab butun chizmani ko'chirish;
      barcha asboblar uchun, qulflangan chizmalar himoyalangan
- [x] Long/Short pozitsiya asbobi TradingView uslubida: 1 bosishda avtomatik 1:1 TP/SL, keyin
      tortib sozlash; pip, %, R/R, lot, potensial foyda/zarar va joriy Open PnL yorliqlari;
      TP/SL/kirish/kenglik tutqichlari alohida ishlaydi (long va short uchun bir xil)
- [x] Chizma vaqt bo'yicha bog'langan: timeframe almashganda joyida qoladi; symbol almashganda
      faqat o'sha instrument chizmalari ko'rinadi
- [x] Chart turlari (sham/bar/chiziq/area) va indikatorlar: EMA 20/50, SMA 200, Bollinger
- [x] Narx alertlari: har qanday instrument uchun, crossing semantikasi (joriy narxda qo'yilgan
      alert darhol ishlamaydi), brauzer bildirishnomasi + ovoz + toast, localStorage'da saqlanadi
- [x] Paper trading: market BUY/SELL (bid/ask), lot 0.01–100, SL/TP avtomatik yopiladi,
      live PnL, tarix, $10 000 boshlang'ich balans, localStorage'da saqlanadi
- [x] Layout saqlash (avto + `Save`), fullscreen, PNG snapshot, MT5 holat popoveri
- [x] O'ng reldagi ishlamaydigan tugmalar olib tashlandi
- [x] TradingView shortcutlari: **Ctrl** — magnit crosshair (OHLC wick), **Shift** — burchak qulfi
      (gorizontal/45°/vertikal), Delete/Esc/Enter va asbob tugmalari
- [x] Chizmalarni sudrash silliq: pointermove kadrga (rAF) birlashtirilgan, vaqt uzluksiz
      (avval long/short pozitsiya bar chegarasiga sakrab siljirdi)
- [ ] Chizmalar uchun undo/redo va object tree (Fib/XABCD rejaga kirmaydi — kerak emas)
- [x] Multi-timeframe Bar Replay: MT5 tarixidan avtomatik yuklash, play/pause/step/tezlik/sana,
      TF yoki instrument almashganda kursor saqlanadi (boshidan boshlanmaydi)
- [ ] RSI/MACD/VWAP panellari, ko'p chart

## Eslatmalar

- API 8787-portda (8000 ko'p kompyuterlarda band bo'lgani uchun). Portni o'zgartirsangiz
  `frontend/vite.config.ts` dagi proxy manzilini ham yangilang.
- `lightweight-charts` — TradingView'ning ochiq (Apache-2.0) kutubxonasi; TradingView nomi/
  logotipi brend sifatida ishlatilmaydi.
- `tools/shot.mjs` — CDP orqali headless screenshot (vizual tekshirish uchun).
