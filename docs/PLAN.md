# create-video-engine — Ana Plan

*18 Kasım 2026. Faz 0 araştırmasının sonuçlarıyla yazıldı. Kaynaklar en altta.*

---

## 1. Tek cümlede ürün

**Seni tanıyan, kendi video stüdyonu kuran ve her videodan sonra zevkini öğrenen bir HyperFrames katmanı.**

İlk sürümün hedefi: kendi projesine/ürününe tanıtım (launch/demo) videosu yapan geliştiriciler ve küçük ekipler.

## 2. Araştırma neyi değiştirdi (dürüst özet)

| Varsaydığımız | Gerçek |
|---|---|
| Motoru, marka çıkarıcıyı, kalite kontrolünü biz yazacağız | **HyperFrames zaten yapıyor.** `capture <url>` siteden renk/font/ekran çekiyor; `check` videoyu Chrome'da açıp taşan yazı, kontrast, boş ilk kare, küçük yazı, 3 sn+ ölü anı yakalıyor; `FRAME.md` hazır bir stil formatı; 210 blok + 239 bileşenlik kayıt sistemi var. Antigravity'nin 7.400 satırının çoğu bunların zayıf kopyası. |
| "Herkesin videosu aynı" en büyük dert | Bunu kullanıcılar değil araç yapanlar söylüyor. Kullanıcıların kanıtlı dertleri: **başka ajanlarda da çalışsın** (Codex, Cursor, Antigravity), **token maliyetini önceden göster** (brag'de 20-25 sn video ≈ 100 bin token), **kurulum/render kırılıyor**, **kalite kontrolü bozuk videoyu geçiriyor**. |
| "Kendi stilini kur" yeni fikir | lemo-opuscar (18 bin ★) stili değiştirip saklamaya izin veriyor; saas-motion-kit son 5 videonun temasını tekrar etmiyor. **Hiçbiri geri bildirimden öğrenmiyor.** Açık boşluk bu — ama talebi kanıtlı değil, kullanıcıyla doğrulanmalı. |
| Repolardan kod toplayacağız | onetake ticari kullanıma kapalı (PolyForm Noncommercial), lemo-opuscar'ın stil metinleri CC BY-NC. Bunlardan **kod/metin almıyoruz**, sadece bağlantı veriyoruz. MIT/Apache olanlardan da çoğunlukla fikri alıp kendimiz yazıyoruz. |

**Sonuç:** Motor yazmıyoruz. HyperFrames'in üstüne dört ince ama zor parça koyuyoruz: **tanıma, stil üretme, gerçek kontrol, zevk öğrenme.** Yıldızı getirecek olan "kişisel stil" vaadi değil, **güvenilirlik + kanıt demosu**.

## 3. Ne yapıyoruz / ne yapmıyoruz

**Yapıyoruz**
- Tek komut kurulum, ortam kontrolü, kullanılan HyperFrames sürümünü sabitleme
- Kullanıcıyı tanıyan kısa röportaj → kullanıcının kendi `STYLE.md`'si (FRAME.md uyumlu)
- Video çekimden sonra: HyperFrames `check` + render edilmiş MP4 üzerinde piksel kontrolleri + taze gözle eleştirmen ajan + insana 5 soruluk kontrol listesi
- Geri bildirimi `STYLE.md`'ye işleyen, değişikliği kullanıcıya onaylatan zevk hafızası
- Her ajanda çalışma (Claude Code, Codex, Cursor, Antigravity, Gemini CLI)
- İlk videodan önce tahmini token/süre

**Yapmıyoruz**
- Kendi render motoru, kendi marka çıkarıcı, kendi lint (HyperFrames'te var)
- Hazır şablon galerisi, prosedürel müzik sentezi
- Lisansı kapalı repolardan kod/metin
- "AI ile tek tıkla viral video", "herkesinki aynı, bizimki farklı" gibi kanıtsız iddialar
- İlk sürümde: konuşan kafa editleme, sessizlik kesme, Windows desteği (Faz 2)

## 4. Mimari

```
Kullanıcının projesi / sitesi / ekran görüntüleri
        │
   [1] setup  ── röportaj + hyperframes capture + referans analizi
        │
        ▼
   studio/                       ← kullanıcının, bize bağımlı değil
   ├── taste/STYLE.md            ← FRAME.md uyumlu: renk, tipografi, hareket kuralları, yasak listesi
   ├── taste/CHANGES.md          ← her öğrenmenin kaydı (neden, hangi videodan)
   ├── taste/examples/           ← onaylanan / reddedilen kareler
   ├── taste/ledger.json         ← son videolarda kullanılan geçiş/sahne/renk (tekrar önleme)
   ├── brand/                    ← capture çıktısı
   └── videos/<ad>/              ← her video bir HyperFrames projesi
        │
   [2] make   ── brief → 3 hikâye önerisi → SPEC → sahneler → check → render
        │
   [3] verify ── check --json + MP4 piksel kontrolleri + eleştirmen ajan + insan listesi
        │
   [4] learn  ── geri bildirim → STYLE.md değişiklik önerisi → kullanıcı onayı → CHANGES.md
```

### 4.1 Paket yapısı (repo)
```
create-video-engine/
├── bin/cli.mjs               ← npx create-video-engine (init, doctor, estimate)
├── skills/                   ← ajandan bağımsız SKILL.md'ler
│   ├── setup/  make/  verify/  learn/
├── checks/                   ← render edilmiş MP4 üzerinde çalışan ölçümler
├── catalog/                  ← parça kartları (part.json) — bkz. 4.4
├── adapters/                 ← her ajan için kurulum (Claude Code plugin, AGENTS.md, .cursor/rules, …)
├── docs/
└── examples/                 ← kanıt demosu (bkz. 6)
```

### 4.2 setup — tanıma
1. **Önce envanter, sonra soru** (herk-edit-kit fikri): repo/site/ekran görüntüsü varsa önce oku, bildiğini sorma.
2. `hyperframes capture <url>` → `brand/`. Ekran görüntüsünden UI renk örneklemesi (claude-motion-design fikri).
3. En fazla 6 soru: ne anlatıyorsun, kime, platform/oran, 3 ton kelimesi, **sevdiğin 2-3 video**, **sevmediğin 1 video**.
4. Referans videolar → kare örnekleme + kesim tespiti → ritim, kesim uzunluğu, palet, tipografi notları. (rea-video / HyperFrames `reverse-any-video` mantığı, kendi uygulamamız.)
5. Çıktı: `STYLE.md`. Bir tema adı değil, **kurallar**: renk mantığı, tipografi, hareket (ease, süre aralıkları), kesim ritmi, yasaklar, "imza" öğesi. Claude'un varsayılan fontu/düzeni yasak listesine baştan girer ("fight the fingerprint").

### 4.3 make — üretim
HyperFrames'in kendi `launch.md` kurallarını temel alır (kanca → gerilim → açılış → kanıt → kapanış, 20-45 sn, gerçek ürün arayüzü). Üstüne:
- 3 hikâye önerisi, kullanıcı seçer
- SPEC'te her sıfat sayıya çevrilir ("hızlı" = 0,4 sn)
- `ledger.json`'a bakıp son videolarla aynı geçiş/kurgu sırasını kullanmaz (saas-motion-kit fikri)
- Sahneler önce HyperFrames kayıt sistemindeki bloklardan, gerekirse kullanıcıya özel yeni bileşen

### 4.4 Katalog
Her parça bir `part.json`: ne işe yarar, girdi/çıktı, kaynak repo, lisans, hangi HyperFrames sürümünde doğrulandı, örnek çıktı. Türler:
- **checks**: ölçüm betikleri
- **blocks**: HyperFrames kayıt formatında sahneler (`hyperframes add` ile kurulabilsin)
- **style-seeds**: kendi yazdığımız başlangıç stilleri (kopya değil, 5-6 tane, sadece röportajda "buna yakın mı?" diye sormak için)
- **links**: lisansı kapalı ama faydalı repolar, sadece bağlantı + lisans uyarısı

Dışarıdan katkı bu kart formatıyla gelir, CI kartı ve lisansı doğrular.

### 4.5 verify — gerçek kontrol
Kural: **atlanan kontrol "geçti" sayılmaz, "atlandı" yazılır. Bozuk video asla başarılı diye teslim edilmez.**

| Katman | Ne | Nereden |
|---|---|---|
| 1 | `hyperframes check --json` (yerleşim, kontrast, boş ilk kare, küçük yazı, ölü an, ses) | HyperFrames |
| 2 | MP4 üzerinde: siyah/boş/donmuş kare, ilk kare dolu mu, yazı okunma süresi (karakter/15 + 1,5 sn), ses yüksekliği (LUFS), süre = kare sayısı | open-edit, motion-video-kit, lemo-opuscar fikirleri; kendi kodumuz |
| 3 | Taze gözle eleştirmen: sadece kareler + brief + STYLE.md'yi görür, kodu görmez, sıralı kusur listesi verir | motion-video-kit "Gauntlet" fikri |
| 4 | İnsana 5 soru: ilk 2 saniye durdurur mu? ritim? ses? marka gibi mi? paylaşır mısın? | — |

HyperFrames `check`'in bilinen açıkları (açık issue'lar: anlatımlı videoda boş ekranı geçirmesi #7861, gürültülü uyarılar #7710-7712) 2. katmanla kapatılır.

### 4.6 learn — zevk hafızası (asıl fark)
1. Video sonrası kullanıcı serbest metin + hızlı seçim: "geçişler çok hızlı", "bu renk değil", "bu sahne çok iyi".
2. Ajan bunu **somut kural değişikliğine** çevirir: `ease süresi 0.4 → 0.6`, yasaklara "zoom-blur geçiş" ekle, onaylanan kareyi `examples/`'a koy.
3. Değişiklik farkı kullanıcıya gösterilir, **onaysız yazılmaz**.
4. `CHANGES.md`'ye neden ve hangi videodan geldiği yazılır; istenirse geri alınır.

Ölçülebilir hedef: aynı kullanıcı için 2. video, 1. videoya göre daha az düzeltme notu almalı.

### 4.7 Ajan uyumluluğu
Skill'ler düz Markdown + düz Node betikleri; ajana özel tek şey kurulum adaptörü. Claude Code (plugin/skills), Codex ve Antigravity (`AGENTS.md`), Cursor (`.cursor/rules`), Gemini CLI. Her biri gerçekten denenmeden README'de "destekleniyor" yazılmaz.

### 4.8 Bilinen teknik riskler ve önlemler
- **HyperFrames hızlı değişiyor** (0.9.x, skill'ler araçla çelişebiliyor) → sürüm sabit, haftalık güncelleme testi.
- **Ajan sandbox'ında Chrome çöküyor**, macOS'ta render takılmaları (#1231) → `doctor` bunu tespit edip net talimat verir.
- **Ücretli HeyGen özellikleri** (bulut render, bazı stiller, seslendirme) → sadece yerel olanları kullanırız (Kokoro TTS, Whisper), HeyGen'e yönlendirme yok.
- **Telemetri**: HyperFrames skill'leri kullanım bildirimi gönderiyor → kendi paketimizde telemetri yok, HyperFrames'inkini kapatmayı belgeleriz.
- **Fontlar**: Latin dışı/özel fontlar woff2 olarak gömülmeli (Türkçe karakterler test edilecek).

## 5. Fazlar

Her fazın **çıkış koşulu** var; koşul sağlanmadan sonraki faza geçilmez.

### Faz 0 — Araştırma ✅ (18 Kasım)
3 ajan raporu + yorum analizi. Bu belge.

### Faz 0.5 — Motor denemesi ✅ (18 Kasım)
Makine: M1, 8 GB RAM (boşta ~1 GB), Node 24, ffmpeg 9.0.2, sistem Chrome. HyperFrames 0.9.67 yerel kurulum 8 sn.
| Deneme | Sonuç |
|---|---|
| `doctor` | Geçti; uyarılar: düşük bellek, ffmpeg 9 (ses ölçüleri yalnız 8.0.1'de karşılaştırılabilir), Docker yok, whisper/Kokoro/MusicGen kurulu değil (isteğe bağlı) |
| 16:9 render (resmî `product-promo`, 20 sn) | 52 sn, 1920×1080 30 fps, en çok ~510 MB bellek |
| 9:16 render (`kinetic-type`, 15 sn) | 52 sn, 1080×1920 |
| `check` | 10 sn. **Resmî örnek kendi kontrolünden kaldı** (7 kontrast hatası: beyaz zemine beyaz altyazı) — kareye bakınca gerçekten okunmuyor. Yani `check` gerçek hatayı yakalıyor ama **exit kodu 1 olsa bile `--json` çıktısında ok:false'u okumak şart**. |
| `capture https://kerem-sahin.github.io` | 64 sn; 14 ekran görüntüsü, 22 varlık, 8 font, CSS renk değişkenleri (`--paper`, `--ink` …), sayfa metni |

**Çıkarımlar:** (1) Motor bu makinede çalışıyor, 8 GB'lık bir Mac'te 20 sn video ~1 dakika. (2) HyperFrames'in hazır örnekleri bile kontrolden geçmiyor — "örnekten başla" yolu kalite garantisi vermiyor; bizim verify katmanımız şart. (3) Kişisel portföy gibi çok markalı sitelerde capture 8 font döndürüyor; setup'ın "hangisi senin markan?" diye seçtirmesi gerekiyor. (4) Kullanılan sürümü sabitlemek kolay (`hyperframes@0.9.67` yerel).

### Faz 1 — MVP: tek ajan, tek hat (2-3 hafta)
Claude Code + macOS, tanıtım videosu. setup → make → verify → learn baştan sona.
- Hafta 1 ✅ (18 Kasım): `doctor`, `init`, `verify` (1-2. katman), `refs`, setup ve verify skill'leri, STYLE.md şablonu, sözleşmeler (`docs/CONTRACTS.md`). 36 test. Bağımsız denetçi 10 bulgu verdi, hepsi düzeltildi. Gerçek bulgu: HyperFrames'in resmî `kinetic-type` örneğinin ilk karesi boş; HyperFrames `check` geçirdi, bizim `first-frame` yakaladı.
- Hafta 2: make akışı, ledger, eleştirmen ajan, learn döngüsü — make/learn skill'leri yazıldı (18 Kasım). İlk gerçek deneme: `~/Desktop/video-sistemi/benim-studyom`, marka PlainParse, video `launch-v1` (24,2 sn, 16:9, sessiz). setup → make → verify → eleştirmen → düzeltme → verify döngüsü uçtan uca çalıştı. Eleştirmen 5 bulgu verdi, 3'ü gerçekti (telefonda küçük yazı, geçişlerde boş kareler, yavaş açılış), düzeltildi. Röportaj cevapları ajan tarafından tahmin edildi; Kerem'in onayı ve geri bildirimi (learn) bekleniyor.
  - İlk öğrenme döngüsü (18 Kasım): Kerem'in geri bildirimi → 3 kural (anında alt çizgi, yalnız efekt sesi, ritim onayı) → onay → `launch-v2`. Düzeltme sayısı v1: 2 (ses, vurgu). v2: Kerem "kesinlikle daha iyi", düzeltme 0. **Öğrenme döngüsünün ilk kanıtı.**
  - Öğrenilen: `loudness` kuralı (−16…−12 LUFS) müzik yatağı için; yalnız efektli seyrek seste integrated −35 LUFS çıkıyor ve yanıltıcı. Seyrek ses için tepe seviyesi (≈ −6…−1 dBTP) ve efekt başına seviye ölçülmeli. İlk ses ayarında efektler −12,7 dBFS ile çok kısıktı; ölçünce fark edildi.
  - Eksik: stüdyodaki skill'leri yeni sürüme taşıyan `create-video-engine upgrade` komutu yok (şimdilik elle kopyalandı).
  - Temiz ajan testi 1 (SweetSpot, sonnet, yalnız AGENTS.md + skill'ler): envanter ve röportaj adımı çalıştı; ürünün kendi davranışından imza buldu ("YAYINDA" damgası, `SpotPublishedOverlay.swift`). Bulduğu skill açıkları: sistem fontları (SF/New York) videoya konamaz → yerine geçecek açık lisanslı font kuralı eklendi; röportaj kişinin dilinde olmalı → eklendi; kaynaklar verildiyse 1. adım atlanır → eklendi.
  - **Karar (Kerem, 18 Kasım): müzik kullanıcıdan istenmez, sistem kendisi bulur.** Plan: Openverse'ten (Jamendo / Freesound / Wikimedia, yalnız CC0 ve CC BY; HyperFrames `media-use`'un `openverse.mjs` aynı filtreyi kullanıyor) ruh haline göre müzik arama, atıf satırını `CREDITS.md`'ye ve teslim notuna yazma; internet yoksa ya da eşleşme yoksa sahne ipuçlarına kilitli, tamamen kodla üretilen sade bir müzik yatağı (lisans sorunu yok). MusicGen yok (CC-BY-NC). Faz 1 hafta 3.
  - Ölçülmedi: bir videonun token maliyeti. Temiz ajan testinde araç çağrısı sayısıyla ölçülecek.
  - **Temiz ajan testi 2 (SweetSpot, sonnet): setup + make + verify yalnız skill'lerle bitti.** 9:16, 24,2 sn, PlainParse'tan tamamen farklı bir görünüm (espresso zemin, bal rengi vurgu, serif başlık, "YAYINDA" damgası). Maliyet: ~170 bin token (Sonnet), 33 araç çağrısı, ~9 dk. Ajanın bulduğu açıklar: HyperFrames skill metniyle AGENTS.md çelişkileri (beacon, skills update) → AGENTS.md düzeltildi; mağaza ekran görüntülerinden UI kırpma → setup'a eklendi; taze göz eleştirmen alt ajan açmadı → verify'da zorunlu yapıldı; fontlar internetten iniyor → yazıldı. Kod işi kalanlar: (1) seyrek seste kısa süreli ses tavanı (integrated −5,9 LUFS çok yüksek, true peak kuralı geçirdi), (2) eleştirmen için okunur kareler (contact sheet 8×4 küçük), (3) `upgrade` komutu, (4) müzik.
  - Öğrenilen: `blank-stretch` 0,5 sn altındaki "neredeyse boş" geçiş karelerini yakalamıyor (eleştirmen yakaladı) → verify'a "içerik kapsamı" ölçümü eklenecek. Telefon akışı için asgari yazı boyutu kuralı STYLE şablonuna eklenecek (16:9'da ≥ 48 px).
- Hafta 3: Kerem'in 3 ürünüyle deneme, her ürün için 2'şer video (bkz. aşağı)

**Test yaklaşımı (değişti):** Dışarıdan test kullanıcısı bulmak zor. Gerçek kullanım şekli zaten "bir kişi, birden çok marka": her ürünün kendi stüdyosu ve zevki olur. Faz 1 testi Kerem'in birbirinden çok farklı üç ürünüyle yapılır:
- **Plainday**: sakin gün planlayıcı (App Store'da)
- **SweetSpot**: fotoğraflı gizli yerler haritası (App Store'da)
- **plainparse**: açık kaynak Swift kütüphanesi (GitHub kitlesinin yapacağı tür video)
Kerem her ürün için röportajı o markanın sahibi gibi cevaplar, videoları izleyip geri bildirim verir. Yapay "persona" ajanlarıyla sahte kullanıcı üretilmez; kanıt olarak kullanılamaz. Fiziyoo kullanılırsa yalnız örnek veri (`isSample`) ekranları, gerçek hasta verisi asla.
Dışarıdan kullanıcı ihtiyacı Faz 2'ye kayar: açık beta çağrısıyla (X, Reddit) 5-10 yabancı kişi yalnızca **kurulum ve ilk video** testini yapar.

**Çıkış:**
1. Üç ürünün videoları birbirinden ve HyperFrames'in hazır örneklerinden açıkça farklı; Kerem her birini "bu o marka" diye onaylıyor.
2. 2. videolar 1.'lerden daha az düzeltme notu alıyor.
3. 10 render'da "başarılı" deyip bozuk çıkan video sayısı 0.
4. Bir videonun token maliyeti ölçüldü ve belgelendi.

### Fikir: markanın kendi şablonları (maliyet düşürme) — 18 Kasım
Bütün bu araçlar (brag, lemo-opuscar, bizimki) her videoyu yapay zekâya sıfırdan yazdırıyor: özgün ama pahalı (brag ~100 bin token / 20 sn; bizim SweetSpot kurulum+video ~170 bin). Şablon araçları (Canva, CapCut, HeyGen şablonları, HyperFrames `--variables`) kredisiz ama herkeste aynı. Ortası yok.
Bizim stüdyo her markada onaylanmış sahneler biriktiriyor. Onaylanan bir sahne, değişkenli bir HyperFrames bloğu olarak `brands/<b>/library/` altına alınır (metin, ekran görüntüsü, renk değişken; hareket ve zamanlama markanınki). Sonraki videoda make önce kütüphaneden kurar, yapay zekâ yalnız yeni sahneyi yazar. Hedef: 3. videodan itibaren token maliyetini yarıdan aşağı indirmek. Ölçülmeden iddia edilmez. Faz 2.

### Faz 2 — Genişleme (3-4 hafta)
- Codex, Cursor, Antigravity, Gemini CLI adaptörleri (her biri gerçekten test edilerek)
- `estimate`: ilk videodan önce token/süre tahmini
- Katalog kart formatı + katkı rehberi + kart doğrulayan CI
- İkinci hat: konuşan kafa + hareketli ara görüntüler (YouTube/Reels)
- Windows ve Linux kontrolü
**Çıkış:** 4 ajanda aynı demo çalışıyor; dışarıdan biri rehberle bir katalog kartı ekleyebildi.

### Faz 3 — Lansman (1-2 hafta)
- README (İngilizce, Türkçe ikinci): en üstte **"Aynı ürün, 3 kişi, 3 video"** + **"1. video → geri bildirim → 2. video"** demosu. Tanıtım videosu aracın kendisiyle yapılır.
- Kurulum tek satır, ilk video 15 dakikanın altında.
- Paylaşım: X, Reddit (r/ClaudeAI, r/ClaudeCode), Hacker News (Show HN), Türkçe YouTube videosu.
**Çıkış:** Dışarıdan ilk 10 kişi kurulumu yardım almadan bitiriyor.

### Faz 4 — Bakım (sürekli)
- Haftalık otomatik iş: HyperFrames'in yeni sürümüyle demo render + `check`; kırılırsa uyarı
- Katalog kartlarının "doğrulandı" sürümleri güncel tutulur
- Issue'lara en geç 48 saatte dönüş (ilk ay)

## 6. Kanıt demosu (yıldızı getirecek şey)
1. **Bir kişi, üç marka, üç stüdyo:** Plainday, SweetSpot ve plainparse'ın videoları yan yana; her birinin STYLE.md'si yanında. (Faz 2 beta kullanıcılarından izin alınırsa onların videoları da eklenir.)
2. **Öğrenme:** aynı kişinin 1. videosu, yazdığı 2 cümlelik geri bildirim, STYLE.md farkı, 2. video.
3. **Güvenilirlik:** bozuk bir videonun (taşan yazı, boş kare) yakalandığı kısa kayıt.
Bu üçü gerçek değilse lansman yapılmaz.

## 7. Başarı ölçütleri
- Kurulumdan ilk videoya < 15 dk (macOS, Claude Code)
- Bozuk video teslim oranı: 0
- 2. videoda düzeltme notu sayısı < 1. videodaki
- Lansmandan 30 gün sonra: issue'lardan gelen gerçek kullanım; yıldız sayısı hedef değil sonuçtur

## 8. Riskler (dürüst)
1. **Başka bir içerik üreticisi kendi sistemini yayınlar.** Muhtemel. Farkımız: o kendi zevkini veriyor, biz kişinin zevkini kuruyoruz. Belki rakip değil ortak.
2. **brag / lemo-opuscar "öğrenme" ekler.** Hızlı hareket etmeliyiz; asıl savunma güvenilirlik ve ajan bağımsızlığı.
3. **Öğrenme vaadi tutmazsa** (2. video daha iyi değilse) ürünün ana iddiası çöker. Faz 1 çıkış koşulu bunu erken yakalamak için var.
4. **Model video zevkini insan gibi yargılayamaz.** Ben (Claude) hataları yakalarım, "güzel mi" kararını veremem. Bu yüzden insan kontrol listesi kaldırılmaz.
5. **Maliyet.** Bir video ~100 bin token olabilir; Pro plan kullanıcıları için ağır. `estimate` ve "taslak kalite" modu şart.
6. **Bakım yükü.** HyperFrames haftada birkaç sürüm çıkarıyor. Faz 4 ihmal edilirse repo 2 ayda kırılır.

## 9. Mevcut Antigravity kodu
Silinmedi: `antigravity-draft` dalında (2983384). `main` sıfırdan başladı. Faydalı olabilecekler: `harvest-repo` (Swift `Theme.swift` ve Tailwind'den renk çekme — HyperFrames `capture` bunu yapmıyor), render betiğinin ffmpeg ayarları. Gerisi HyperFrames karşılığıyla değiştirilecek.

## 10. Kerem'den beklenenler
1. ~~HyperFrames kurulum izni~~ ✅ · ~~Antigravity kodunu ayrı dala almak~~ ✅ (`antigravity-draft` dalı)
2. Faz 1'de üç ürün için röportaj cevapları ve her videoya geri bildirim
3. Videolar ve ses hakkında zevk kararları — bunlar senin

---

### Kaynaklar (Faz 0)
- İlham veren YouTube incelemesi ve açıklaması (16 repo), 20 yorum (ana istekler: "kendi repomuzu nasıl kurarız", "skill'leri birleştirmeyi denedim saçmaladı", "Antigravity'de de çalışsın", "telif?")
- GitHub verileri (18 Kasım): HyperFrames 86k★ Apache-2.0; brag 21,9k MIT; lemo-opuscar 18,3k MIT kod + CC BY-NC metin; rea-video 10,6k Apache; ffmpeg-skill 7,9k MIT; onetake 4,2k PolyForm Noncommercial
- Issue kanıtları: brag #1 #4 #14 #33 #38 (başka ajan), #35 (token), #64 (skill/araç çelişkisi); HyperFrames #1231 (macOS render takılması), #7406 (yazısız video exit 0), #7861 (check boş ekranı geçiriyor); onetake #6 (süreklilik kontrolü slayt gösterisini geçiriyor)
- Repo incelemesi (11 repo, kodları çalıştırılmadan okundu) ve HyperFrames 0.9.67 kaynak kodu incelemesi
