# create-video-engine — Başarı Şartları (A'dan Z'ye)

*19 Kasım 2026. Bu belge işin "bitti" tanımıdır. Her iş bir şarta bağlanır; şartı olmayan iş yapılmaz. Durum işaretleri: ✅ var ve denendi · ⚠️ kısmen / denenmedi · ❌ yok.*

**Üstünde:** [`PRODUCT.md`](PRODUCT.md) — üç kişi (Ayşe/Kerem/Mert) ve kapsam kontrolü. Bu belge ondan türetilir; çelişkide PRODUCT.md geçerlidir.

---

## 0. Hedef ve "başardık" tanımı

**Hedef:** İnsanlar repoyu indirir, ajanına "stüdyomu kur" der. Sistem **üç şeyi** yapar:
1. **Seni tanır** — markanı, zevkini (STYLE.md).
2. **Ne yaptığını bilir** — hangi tür videolar yaptığını sorar (YouTube konuşma, Reels, ürün tanıtımı, anlatım…) ve araştırılmış repolardan/HyperFrames bloklarından **o ihtiyaca uyan parçaları seçip stüdyoya kurar**. Herkesin stüdyosu farklı parçalardan oluşur. Sonradan `add` ile parça eklenir.
3. **Seninle gelişir** — her geri bildirim kurala döner.

Bir marka zevki, bütün video türlerinde (hatlarda) ortak çalışır. "16 repodan şunu bundan bunu al" işini kişi değil sistem yapar.

*Düzeltme (19 Kasım): ilk sürümde başarı "brag'den kötü olmasın" diye tek bir tanıtım videosu üzerinden tanımlanmıştı; bu, işi brag'in alanına (ürün tanıtımı) daralttı ve parça seçimini kenara itti. Kerem fark etti. Aşağıdaki tanım bunu düzeltir.*

**Başardık demek için üç kanıt gerekir** (ölçülebilir, sırayla):

| # | Kanıt | Nasıl ölçülür |
|---|---|---|
| K1 | **Kalite, her hatta:** her hattın videosu o alandaki en iyi araçtan kötü değil | Hat başına isimsiz karşılaştırma (Kerem + en az 2 kişi). Ürün tanıtımı: brag ile ✅ Kerem berabere dedi (2 kişi bekleniyor). Diğer hatlar: o hattın en iyi reposuyla |
| K0 | **İhtiyaca göre parça:** farklı ihtiyaç söyleyen iki kişi farklı parça setli stüdyo alır | 2 temiz kurulum: "YouTube konuşma videoları" vs "uygulama tanıtımı" → kurulan parçalar ve skill'ler farklı, ikisi de video üretir |
| K2 | **Kişisellik:** üç farklı marka üç farklı video, ikinci video birinciden iyi | 3 markanın videoları yan yana birbirine benzemez; her markada 2. videonun düzeltme sayısı 1.'den az |
| K3 | **Bağımsızlık:** sistem bizsiz çalışır | Bu konuşmayı hiç görmemiş bir ajan, yalnız repo + README ile kurulumdan teslime kadar gider; en az 2 farklı ajanda (Claude Code + bir başkası) ve en az 1 dış kullanıcıda |

K1–K3 sağlanmadan yayın yapılmaz. Yıldız sayısı hedef değil, sonuçtur.

---

## 1. Kullanıcı yolculuğu (A → Z)

Her adımda ne olmalı, ne ters gidebilir, hangi şart onu korur.

| Adım | Olması gereken | Ters gidebilecek | Şartlar |
|---|---|---|---|
| A. Repoyu bulur | README 10 saniyede ne olduğunu ve farkını anlatır; demo videoları en üstte | "Bir video reposu daha" sanılır | L1–L4 |
| B. Kurar | Tek komut; eksik araç varsa nasıl kurulacağı söylenir; ilk videonun tahmini maliyeti söylenir | Node/ffmpeg/Chrome eksik, Windows, kredi korkusu | A1–A6 |
| C. Markayı tanıtır | Ajan önce malzemeyi okur, sonra kişinin dilinde en fazla 6 soru sorar; ürünün kendi davranışını ve sesini bulur | Kişi teknik değil; malzeme az; sistem fontu | B1–B8 |
| D. Zevki onaylar | Kısa özet + tek bir stil karesi; kişi "evet/şunu değiştir" der | Kişi dosya okumak zorunda kalır | B9–B10 |
| E. Video ister | Brief tek mesaj; 3 hikâye; kişi seçer | Uzun soru listesi | C1–C3 |
| F. Video üretilir | Gerçek arayüz; ritim önce; müzik kurguyla bestelenir; marka imzası; okunur yazı | Şablon görünümü, slayt gösterisi, sessizlikte tek efekt | C4–C14, D1–D7 |
| G. Kontrol edilir | Ölçülemeyen başarı yok; taze göz eleştirmen; ses listesi; insana 5 soru | Bozuk video "başarılı" diye gelir | E1–E10 |
| H. Teslim | Dosya, ne kontrol edildiği, atıf satırı, paylaşım metni | Atıf unutulur | E11, J2 |
| I. Geri bildirim | Kişi düz cümle söyler; sistem kurala çevirir, onaylatır | "Meh" gibi belirsiz yorum | F1–F5 |
| J. Sonraki video | Öğrenilenle başlar; tekrar etmez; daha ucuz | Aynı video tekrar, maliyet patlar | F6, G1–G4, H1–H3 |
| K. Güncelleme | `upgrade` ile yeni sürüm; zevk dosyaları korunur | Skill'ler eskir, HyperFrames kırılır | K1–K4 |

---

## 2. Şartlar

### A. Kurulum ve ortam
| ID | Şart | Test | Durum |
|---|---|---|---|
| A1 | Tek komutla stüdyo: `npx create-video-engine init <klasör>` | Temiz bir klasörde 2 dk altında biter | ✅ (yerel checkout ile; npm'de yayınlanmadı) |
| A2 | `doctor` eksikleri ve çözümlerini söyler | Node/ffmpeg kaldırılınca net talimat | ✅ |
| A3 | HyperFrames sürümü sabit | studio package.json tam sürüm | ✅ |
| A4 | Claude Code dışında en az bir ajan | Codex veya Antigravity'de setup→verify | ❌ |
| A5 | İlk videodan önce tahmini maliyet | `estimate` token ve süre aralığı verir | ❌ (ölçüm var: kurulum+video ≈170k token Sonnet) |
| A6 | macOS ve Linux; Windows için dürüst not | Linux'ta CI testi | ⚠️ yalnız macOS denendi |

### B. Tanışma ve kişiselleştirme (setup)
| ID | Şart | Test | Durum |
|---|---|---|---|
| B1 | Önce envanter, sonra soru | Kaynak verilince bilineni sormaz | ✅ (temiz ajan testi) |
| B2 | Kişinin dilinde konuşur | Türkçe yazana Türkçe | ✅ kural var, ⚠️ yeniden denenmedi |
| B3 | Renk/font koddan birebir | Theme.swift/CSS'ten hex | ✅ |
| B4 | Ürünün kendi davranışından imza | SweetSpot "YAYINDA", Plainday alt çizgi | ✅ |
| B5 | Ürünün kendi sesini koddan bulur, tahmin etmez | SweetSpot zil | ✅ kural var (bir kez kaçırıldı, düzeltildi) |
| B6 | Sistem fontlarına açık lisanslı karşılık + Türkçe glif | SF → Roboto vb. | ✅ |
| B7 | Mağaza görsellerinden arayüz kırpma | çerçeve/başlık temiz kırpılır | ✅ `crop --auto` (6 gerçek mağaza görselinde doğru; tam ekran görselde dokunmaz) |
| B8 | Referans videodan dilbilgisi (ritim, kesim) | `refs` | ✅ |
| B9 | Kişiye dosya değil özet gösterilir | renk/font/ritim/yasak/imza özeti | ✅ |
| B10 | Stil karesi onayı | tek kare, en fazla 2 tur | ✅ kural, ⚠️ kişiyle denenmedi |
| B11 | **Parça seçimi:** ihtiyaca göre katalogdan sahne/kontrol/ses parçası seçer | farklı ihtiyaç → farklı parça seti | ❌ (katalog yok) |

### C. Görüntü kalitesi (make)
| ID | Şart | Test | Durum |
|---|---|---|---|
| C1 | Brief tek mesaj, tahminli | | ✅ |
| C2 | 3 farklı yapıda hikâye, kişi seçer | | ✅ |
| C3 | Sayısal SPEC (her sıfat sayı) | | ✅ |
| C4 | Gerçek ürün arayüzü, uydurma yok | | ✅ |
| C5 | Telefonda okunur yazı (16:9 ≥48 px, 9:16 ≥40 px) | ölçülür | ⚠️ kural var, ölçülmüyor |
| C6 | Boş geçiş karesi yok | `near-empty` | ✅ |
| C7 | **Ritim önce:** geçişler vuruşta | sahne başları vuruş katı | ✅ kural + `on-beat` ölçümü, ⚠️ yeni yöntemle video üretilmedi |
| C8 | **Geçiş çeşitliliği:** aynı geçiş art arda yok, son videoları tekrar etmez | ledger + ölçüm | ✅ `shots.json` + `variety` ölçümü |
| C9 | **Doğal hareket:** yay (spring) ve oturma; robotik lineer yok | hareket kütüphanesi | ✅ `parts/cve-motion/cve-motion.js, installed with `add cve-motion`` (deterministik, testli) |
| C10 | **Süreklilik:** sahneler kopuk slayt gibi değil, bir öğe bir sonrakine taşınır | süreklilik ölçümü | ✅ `CVE.carry` + make kuralı; ⚠️ ölçümü yok, alt-kompozisyonlar arasında çalışmaz |
| C11 | Durgun uzun tutuş yok (5 sn hiç kıpırdamayan harita) | hareket enerjisi ölçümü | ✅ `stillness` (SweetSpot v2'deki kayan haritayı yakaladı) |
| C12 | Kapak karesi 0. kareye gömülü | platform küçük resmi doğru | ✅ `poster` ölçümü + make kuralı |
| C13 | Ekrandaki her rakam brief'te var | rakam listesi karşılaştırılır | ✅ `numbers` (ekran metni ↔ BRIEF.md) |
| C14 | Dikey/yatay/kare formatlar | 9:16 ve 16:9 denendi | ✅ |
| C15 | **Canlı:** ürün kullanılırken gösterilir (dokunma, kaydırma, yazma, durum değişimi); yalnız kayan ekran görüntüsü en fazla 1 | kritik + insan | ✅ kural (brag'den), ⚠️ ölçümü yok |
| C16 | **Düzen markadan gelir:** başlık yeri/boyutu, görüntü yerleşimi (tam ekran, kart, bölünmüş, kolaj, dergi) markanın `STYLE.md` `layout` bloğundan; çekirdek kurallar ortak şablona dönüşmez | 3 marka yan yana "aynı şablon" denmez; düzen parmak izi ölçülür | ❌ 20 Kasım bulgusu: SweetSpot/Plainday/Mert aynı dilde (sol üst iki satır başlık + vurgulu kelime + altta tek büyük görüntü) |

### D. Ses
| ID | Şart | Test | Durum |
|---|---|---|---|
| D1 | Müzik kullanıcıdan istenmez | | ✅ |
| D2 | Müzik kurguyla bestelenir (tempo, akor, ton) | `music --score` | ✅ araç, ⚠️ Kerem'in kulak testi bekleniyor |
| D3 | Efektler müziğin içinde, aynı tonda, aynı odada | score cue'ları | ✅ araç |
| D4 | Marka enstrümanı; iki marka aynı sesi paylaşmaz | palette | ✅ araç |
| D5 | Fragman sesleri yasak (bas darbesi, whoosh) | | ✅ |
| D6 | Seviye: müzikli −17…−12 LUFS (hedef −16), tepe ≤ −1 dBTP; seyrek seste kısa süreli tavan | verify | ✅ kısa süreli tavan −9 LUFS (SweetSpot v1'in −5,9'unu yakaladı) |
| D7 | Kalite çıtası: brag'in müziğine kulakta yetişir | Kerem dinler | ⚠️ SweetSpot'ta berabere |
| D8 | **Müzik çeşitliliği:** videolar aynı şarkının başka enstrümanla çalınmışı gibi duyulmaz (Kerem 19 Kasım: "müzikler hep aynı gibi"). Farklı akor dizileri, ritim kalıpları, tarzlar (akustik tıngırtı, lo-fi vuruş, ambient, pop pluck…); marka + video için tohumlu seçim; ledger müzik parametrelerini kaydeder ve `variety` aynı müziği tekrar edince uyarır | Aynı marka 3 video + 3 marka: kör dinlemede "aynı şarkı" denmez | ❌ 20 Kasım: 7 tarz eklendi ama Kerem mert-2'de "yine aynı ton" dedi. Teşhis: tarz değişse de bütün sesler aynı birkaç sentetik osilatörden (sinüs, Karplus-Strong), aynı reverb ve mix ile çıkıyor; tını aynı kalıyor. Yol (sonraki müzik turu, Kerem: "sonra dönelim"): gerçek enstrüman örnekleri (CC0 VSCO2 CE, CC BY Salamander piyano, CC0 davul setleri) ile aynı kurguya bağlı besteleme; isteğe bağlı ücretli yapay zekâ müziği parçası (ücretsiz karşılığı bizim besteleyici); Apache lisanslı yerel müzik modelleri (ACE-Step, YuE) M1 8 GB'ta denenir |

### E. Kontrol (verify) — "ölçülmemiş başarı yok"
| ID | Şart | Durum |
|---|---|---|
| E1 | HyperFrames check (JSON'a güvenir) | ✅ |
| E2 | Süre/kare, ilk kare, boş/donmuş/neredeyse boş kare | ✅ |
| E3 | Ses var mı, seviye | ✅ |
| E4 | Atlanan kontrol "geçti" sayılmaz | ✅ (denetçi açığı kapatıldı) |
| E5 | Ses listesi (eleştirmen duyamaz, okur) | ✅ |
| E6 | Taze göz eleştirmen alt ajan, okunur kareler | ✅ sahne başına 960 px kare |
| E7 | Hareket enerjisi (durgunluk) | ✅ (C11) |
| E8 | Yazı boyutu ve okuma süresi | ⚠️ HyperFrames kısmen |
| E9 | Rakam kontrolü | ✅ (C13) |
| E10 | İnsana "şu 5 anı dinle/izle" listesi | ✅ `MOMENTS` |
| E11 | Teslim notu: dosya, kontroller, atıf, paylaşım metni | ⚠️ kısmen |

### F. Öğrenme (learn)
| ID | Şart | Durum |
|---|---|---|
| F1 | Düz cümle → somut kural (sayı) | ✅ |
| F2 | Belirsizse 2 yorum sunar, kişi seçer | ✅ |
| F3 | Onaysız değişiklik yok, kayıt (CHANGES) | ✅ |
| F4 | Yeniden üretim ve düzeltme sayısı ölçümü | ✅ (PlainParse 2→0, SweetSpot 1→0) |
| F5 | Ses/müzik geri bildirimi kurala dönüşür | ✅ |
| F6 | Ledger ile tekrar önleme (kodla) | ✅ (C8) |

### G. Katalog (parçalar) — "kendi sistemini kurmak" burada
| ID | Şart | Durum |
|---|---|---|
| G1 | Parça kartı formatı: ne işe yarar, kaynak, lisans, doğrulandığı sürüm, örnek | ✅ `catalog/` + `catalog check` (8 kart) |
| G2 | Parça türleri: sahne blokları (HyperFrames kayıt formatı), hareket, kontrol, ses paleti | ❌ |
| G3 | setup ihtiyaca göre parça seçer ve stüdyoya kurar (K0) | ✅ K0 geçti: 2 temiz kurulum (talking-head / product-launch) farklı parçalar kurdu, ikisi de verify'dan geçen video üretti |
| G7 | **Gerçek toplama:** araştırılan 22 repo + HyperFrames blokları tek tek: kurulabilir parça / yalnız fikir / alınamaz; her biri kartlı | ✅ 106 taslak kart (`catalog-drafts/`); 16 parça kataloğa girdi |
| G8 | `add <parça>` / `remove`: sonradan parça ekleme, kartı ve atfı ile | ✅ (denetçi bulguları düzeltildi) |
| G4 | Lisansı kapalı repolar yalnız bağlantı + uyarı | ✅ doğrulayıcı NC lisansta dosyaya izin vermez |
| G5 | Dışarıdan katkı rehberi + kartı doğrulayan CI | ❌ |
| G6 | **Toplama listesi:** araştırılan her fikrin durumu takip edilir (`docs/HARVEST.md`) | ✅ 27 fikir |

### H. Maliyet
| ID | Şart | Durum |
|---|---|---|
| H1 | Bir videonun token maliyeti ölçülür ve README'de dürüstçe yazar | ⚠️ bir ölçüm var |
| H2 | Markanın kendi şablonları: onaylı sahneler değişkenli bloğa döner | ❌ (fikir, Faz 2) |
| H3 | Taslak render ve az tur: gereksiz render yok | ⚠️ |

### I. Hatlar (her hat = bir parça seti + kendi tarifi + kendi kontrolleri + bir gerçek test)
| ID | Hat | Test | İlk yayında | Durum |
|---|---|---|---|---|
| I1 | Ürün tanıtımı (uygulama, site, repo) | SweetSpot | evet | ✅ |
| I2 | Konuşan kafa (YouTube/Reels): yazıya dökme, boşluk kesme, marka altyazısı, araya grafik | Kerem'in gerçek 64 sn çekimi (21 Kasım) | evet | ⚠️ uçtan uca çalıştı: 64→46,5 sn (22 kesim), altyazı, isim ve ana fikir kartı, 17,5 sn Shorts; verify geçti. Eksikler: Shorts'ta altyazı yüze/ağza biniyor ve sabit kırpma hareket eden yüzü kesiyor (yüz takibi yok); whisper small Türkçe hataları işaretlenmiyor, yanlış kelimeler altyazıya giriyor (kişiye transkript onayı adımı lazım); değişken kare hızlı telefon videosunda kesim sonrası ~0,2 sn kayma (önce sabit kare hızına çevirmeli); sıfır süreli kelimeler kayboluyor; kartlar t=0'da görünür başlatılamıyor; build-card frame.md yolunu projeden bulmuyor; add 'hyperframes yok' uyarısı hâlâ çıkıyor; ajan eleştirmenin gerçek bulgularını süre yüzünden düzeltmeden teslim etti |
| I3 | Anlatım / motion grafik (ürün ekranı yok: şema, rakam, hareketli yazı) | Fiziyoo, yalnız örnek veri | evet | ❌ |
| I4 | Marka / sosyal gönderi (fiziksel ürün, fotoğraf) — Mert | CC0 test markası "Mert Kahve" (subitz malzemesi yok) | evet (19 Kasım kararı) | ✅ 2. denemede kalite düzeldi (kart sahneleri, büyük başlık, hareket). Kalan küçükler: bitiş kartı satırı küçük, setup 2× / tarif 3× başlık çelişkisi, `render --quality` adları. İlk denemenin eksikleri: Eksikler: küçük/düşük çözünürlüklü fotoğraf için sahne tipleri (kolaj, kesip zemine oturtma, kart), sosyal hatta başlık ≥ 3× min_text_px, her çekimde hareket (push-in/pan), test için stok fotoğraf istisnası, müzik paletleri skill'de listelenmeli, stil karesi klasörü init sırası, GSAP'ın CDN yerine yerelden yüklenmesi, Türkçe glif kontrol aracı |
| I5 | Nasıl yapılır (ekran kaydı) | Plainday | sonra | ❌ |
| I6 | `make` skill'i hat-bağımsız çekirdek + hat tarifi olarak bölünür (bugünkü make = I1 tarifi) | 3 hatta aynı çekirdek | evet | ✅ |
| I7 | **Sesten video (podcast/anlatım):** yalnız ses kaydı → konuşmaya eşlenmiş görseller (hareketli yazı, alıntı kartları, rakam/şema, ekran görüntüsü/ürün, konuşmacı kartı, dalga formu), ritim konuşmadan; uzun kayıtta hızlı birleştirme | Kerem'in podcast kaydı (22 Kasım isteği) | evet (öneri) | ❌ parçaların çoğu var (yazıya dökme, kesim, altyazı, kartlar, uzun birleştirme, kayıttan bölüm), eksik: konuşmayı fikir parçalarına bölüp her parçaya görsel seçen tarif, sahne blokları (HyperFrames kayıt bloklarından: kinetic type, chart, flowchart…), sesli kayıt için verify |

### J. Hukuk ve güvenlik
| ID | Şart | Durum |
|---|---|---|
| J1 | Lisansı kapalı koddan kopya yok | ✅ |
| J2 | CC BY atıfı teslim notuna ve paylaşım metnine girer | ⚠️ (müzik yolunda var, teslim notunda zorunlu değil) |
| J3 | Telemetri yok; HyperFrames beacon kapalı | ✅ |
| J4 | Kişisel veri/başkasının fotoğrafı kullanılmaz kuralı | ✅ setup + make skill'lerinde |
| J5 | İndirilen dosyalar güvenilmez veri olarak işlenir | ✅ |

### K. Bakım
| ID | Şart | Durum |
|---|---|---|
| K1 | `upgrade`: stüdyonun skill'leri yenilenir, zevk dosyaları korunur | ✅ `upgrade` (testli) |
| K2 | Haftalık otomatik test: HyperFrames'in yeni sürümüyle örnek render | ❌ |
| K3 | Sürüm notları | ❌ |
| K4 | Testler (şu an 108) her değişiklikte geçer | ✅ |

### L. Yayın ve dağıtım
| ID | Şart | Durum |
|---|---|---|
| L1 | İngilizce README (Türkçe ikinci): fark, kurulum, demo, dürüst maliyet | ❌ (eski taslak var) |
| L2 | Demo: "bir kişi, üç marka" + "1. video → geri bildirim → 2. video" | ⚠️ 2 marka hazır, müzikli sürümler yok |
| L3 | GitHub'a yayın, npm paketi | ❌ (Kerem onayıyla) |
| L4 | Duyuru planı: X, Reddit, HN, Türkçe video | ❌ |
| L5 | **Repo tasarımı:** README görselleri kötü (Kerem, 21 Kasım). brag reposundaki gibi özenli bir kimlik: logo/başlık görseli, düzgün demo (seçilmiş anlar, yüksek kalite, ses için video bağlantısı), hatları ve akışı anlatan görseller; büyük duyurudan önce | ❌ |
| L6 | npm yayını: bu ağdan registry.npmjs.org'a erişilemiyor (21 Kasım); Kerem evden deneyecek, sonra `npm login` + publish | ❌ |

---

## 2.5 Aşama 2'ye girmeden önce (hazırlık denetimi, 19 Kasım)

Kerem'in uyarısı: "çok eksiği varken test yapma hatasını yapmayalım." Test ancak bunlar tamamsa başlar:

| # | Ön şart | Durum |
|---|---|---|
| H1 | Kontroller beğenilen bir videoyu haksız yere kırmamalı (brag'in SweetSpot videosuyla kalibrasyon) | ✅ 2 hata bulundu, düzeltildi (bitiş anı, ses alt sınırı) |
| H2 | brag'in skill'indeki her kuralın karşılığı bizde var mı (satır satır karşılaştırma) | ✅ 5 eksik kural eklendi (HARVEST 28–32) |
| H3 | Müzik besteleyicinin sesi Kerem'in kulağından geçti (D7) | ✅ 19 Kasım: piyano (felt) daha iyi, iki enstrüman arası fark küçük; brag'e göre son söz isimsiz karşılaştırmada |
| H4 | Ben önce kendi kuru denememi yaparım; Kerem'e yalnız verify'dan geçmiş, eleştirmen bulguları çözülmüş video gider | ✅ deneme 1 elendi (ürün küçük, alt %30 boş; verify geçirmişti → `empty-area`, `subject-scale`, kareyi doldur kuralı); deneme 2 isimsiz karşılaştırmaya gitti (`output/k1/karsilastirma/`) |

**K1 sonucu (19 Kasım, Kerem):** "ikisi de gayet güzel", yani berabere. Videoyu daha önce görmemiş 2 kişinin oyu bekleniyor.

Deneme 2'den kalan sistem eksikleri (sonraki tur): `crop --auto` çerçeve kırıntısı bırakıyor; HyperFrames `sound.md` "kodla müzik yazma" ile bizim besteleyici çelişiyor (AGENTS'te açıkça geçersiz kılınmalı); `STYLE.md` `sound.cues`'ta damga/zil gibi ürün sesini eşleyecek anahtar yok; Reels güvenli bölge sayıları HyperFrames içinde tutarsız; maliyet: ≈225k Sonnet token, 65 araç çağrısı, 15 dk, 5 render.

## 3. Kalite çıtası: "paylaşılabilir" ne demek

Bir video ancak şunların hepsi sağlanınca teslim edilir:
1. verify çıkış kodu 0 (ölçülemeyen başarı yok).
2. Eleştirmenin ilk 3 bulgusu çözülmüş ya da kişiye sorulmuş.
3. Müzik kurguyla bestelenmiş; geçişler vuruşta.
4. İlk 2 saniyede ürünün kendisi ekranda, boş açılış yok.
5. Hiçbir sahne 3 saniyeden uzun durgun değil (bitiş kartı hariç).
6. K1 karşılaştırmasında brag'den kötü değil.

---

## 4. Yol haritası (kapılı) — 19 Kasım'da yeniden yazıldı

Tamamlanan: 1. Toplama (fikirler) ✅ · 2. Ürün tanıtımı kalitesi (K1-I1) ✅ Kerem: berabere; 2 dış oy bekleniyor.

| Aşama | İş (şartlar) | Kapı |
|---|---|---|
| **A. Gerçek parça toplama** | 22 repo + HyperFrames blokları incelenir, kart taslakları (G7) | Her repo için karar ve kart; lisans dosyasından doğrulanmış |
| **B. Parça seçimi** | setup ihtiyaç sorar, parça seçer (G3, B11); `add`/`remove` (G8); make çekirdek + hat tarifi (I6) | K0: iki farklı ihtiyaç → iki farklı stüdyo, ikisi de çalışır |
| **C. Anlatım hattı** | I3 parçaları + tarif + kontroller | Fiziyoo anlatım videosu, o alanın en iyi reposuyla isimsiz karşılaştırma |
| **D. Konuşan kafa hattı** | I2 | Kerem'in çekiminden paylaşılabilir video |
| **E. Kişisellik (K2)** | 3. marka, 2. videoda düzeltme azalır | 3 marka × farklı hatlar yan yana benzemez |
| **F. Bağımsızlık (K3)** | ikinci ajan, maliyet tahmini, `upgrade`, Linux CI | Codex/Antigravity'de uçtan uca; 1 dış kullanıcı |
| **G. Yayın** | README, demo ("bir kişi, üç marka, üç hat"), npm, duyuru | Kerem'in "yayınla" onayı |

Süre tahmini (belirsiz): A 1–2 gün, B 2–3 gün, C 2–3 gün, D 3–5 gün, E 1 gün, F 2–3 gün, G 1–2 gün → yaklaşık **3 hafta**.

## 5. Çalışma kuralları (bundan sonra)

1. Her iş bu belgedeki bir şart ID'sine bağlanır. Şartı olmayan yeni iş önce buraya yazılır.
2. Bir sorun bulununca önce "hangi şart eksikti" sorulur; video değil sistem düzeltilir.
3. Kerem'e teknik ayrıntı değil, kapı sonuçları ve tek soruluk kararlar gider.
4. Her aşama sonunda bu belgenin durum sütunları güncellenir.
5. Araştırmadan çıkan her fikir `HARVEST.md`'ye girer; "aldık mı?" sorusunun cevabı her zaman orada.
6. Ben (Claude) video zevkine karar vermem; ölçerim, insan karar verir.
