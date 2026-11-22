# Hat: sesten video (podcast) — şartlar

*22 Kasım 2026, taslak. Kerem'in podcast kanalı üzerinde test edilecek. Üst belge: `PRODUCT.md` (üç kişiye dördüncüsü eklenir: **Podcastçi** — ses kaydını YouTube'a, Shorts'a, Spotify videosuna çevirmek isteyen kişi). Kerem'in cevaplarıyla kesinleşir; ❓ işaretli yerler ona sorulacak.*

## Test kanalı (Kerem'in cevapları, 22 Kasım)

- Spotify'da yayında, **iki sunuculu**, **20–25 dakikalık**, **yalnız ses** kayıtlı, Türkçe bir sohbet podcast'i.
- Tonu: ciddiyet aramayanlar için mizahi, arkadaş sohbeti (mahalle, okul, gündelik dertler). Kurumsal grafiklerle değil, bu tonla görselleşmeli.
- Kerem: "Video sese göre hazırlanıyor; burada kullanıcıya göre özelleştirme önem kazanıyor." → Görsel dil sabit bir şablon değil, **kanalın kendi tonundan** çıkar (aşağıda P14).

## Ne yapar

Bir podcast bölümünün **ses kaydından** (varsa video kaydından) şunları üretir:

1. **Tam bölüm videosu** (YouTube, 16:9): konuşmaya eşlenmiş görseller. Konuşulan fikre göre sahne değişir: başlık, alıntı, rakam/grafik, liste, konuşmacı kartı, ses dalgası, kişinin kendi görselleri.
2. **Kesitler** (Shorts/Reels/TikTok, 9:16): 3–5 güçlü an, altyazılı ve görselli, ilk 2 saniyede kanca.
3. **Yan çıktılar**: YouTube bölüm başlıkları, SRT altyazı, bölüm açıklaması taslağı, kapak (thumbnail) önerisi, Spotify video için kare/dikey sürüm.

## Kullanıcı yolculuğu

| Adım | Olması gereken | Ters gidebilecek |
|---|---|---|
| 1. Kanalı tanıtır (bir kez) | Kanal adı, kapak görseli, renkler, konuşmacılar, müzik jingle'ı varsa o; görsel dil seçilir (sade ses dalgası ↔ zengin anlatım görselleri) | Kişinin elinde görsel yok → kapak + marka renkleriyle başlanır |
| 2. Bölümü verir | Ses (mp3/wav/m4a) veya video dosyası; çok kanallı kayıt varsa her konuşmacı ayrı | Telefonla düşük kalite, iki konuşmacı tek kanalda |
| 3. Temizlik | Ses seviyesi eşitlenir (−16 LUFS), boşluk/ıhh/yanlış başlangıç listesi çıkar, kişi onaylar | Doğal konuşma kesilir, müzik/jingle kesilir |
| 4. Metin ve konuşmacılar | Kelime zamanlı metin; kim ne zaman konuşuyor; emin olunmayan kelimeler kişiye sorulur | Türkçe tanıma hataları, iki sesin karışması |
| 5. Fikir parçaları | Bölüm konulara bölünür → bölüm başlıkları; her parça için görsel türü seçilir | Uydurma rakam/iddia; her şeye aynı görsel |
| 6. Üretim | Uzun bölüm hızlı yoldan birleşir; kesitler ayrı | 60 dk bölüm saatlerce render |
| 7. Kontrol | Ses/görüntü kayması yok, sessiz boşluk yok, uzun durgun görüntü yok, ekrandaki her rakam konuşmada geçiyor, kesitlerin kancası var | Görsel konuşmadan kopuk |
| 8. Teslim ve öğrenme | Dosyalar + bölüm başlıkları + açıklama; kişinin yorumu kurala döner | — |

## Şartlar

| ID | Şart | Ölçü | Durum |
|---|---|---|---|
| P1 | Girdi: ses (mp3/wav/m4a/flac) ya da video; çok kanallı kayıt desteklenir | 3 biçimde uçtan uca | ⚠️ yazıya dökme sesi okuyor, akış videoya göre yazılı |
| P2 | Ses temizliği: seviye −16 LUFS, tepe ≤ −1 dBTP; jingle/müzik korunur | verify loudness | ⚠️ var, podcast için ayarlanmalı |
| P3 | Konuşmacı ayırma (kim ne zaman), ücretsiz ve yerel (hesap/token istemeyen bir model, ör. sherpa-onnx; pyannote hesap istediği için yalnız isteğe bağlı); çok kanallı kayıtta kanaldan. **Test kanalı tek dosyada 2 ses → zorunlu** | 2 konuşmacılı bölümde %90+ doğru | ❌ |
| P4 | Kesim listesi: boşluk, ıhh, yanlış başlangıç; kişi onaylar; doğallık modu | EDL | ✅ (silence-cut) |
| P5 | Konu bölme → bölüm başlıkları (YouTube kuralı: ilki 0:00, ≥3, ≥10 sn arayla) | chapters.txt | ✅ biçim var, ❌ bölmeyi yapan tarif |
| P6 | Görsel plan: her fikir parçasına görsel türü; görsel en geç 4–8 sn'de bir değişir; ekrandaki her rakam/alıntı konuşmada geçer | `numbers` metne karşı, `stillness` | ❌ tarif yok |
| P7 | Görsel kütüphanesi: başlık kartı, alıntı, rakam/grafik, liste/adımlar, konuşmacı kartı, ses dalgası, kapak zemini, kişinin görselleri | her tür en az 1 blok, marka renklerinde | ⚠️ kartlar var; ses dalgası, grafik, liste yok (HyperFrames bloklarından alınacak) |
| P8 | Hız: 60 dk bölüm, 8 GB Mac'te ≤ 30–40 dk | ölçüm | ⚠️ 6 dk ≈ 13 dk ölçüldü; 60 dk denenmedi |
| P9 | Kesitler: 3–5 an, kanca puanı, 9:16, altyazı + görsel; konuşmacı videosu varsa yüz takibi | Kerem "paylaşırım" der | ⚠️ seçici + yüz takibi var |
| P10 | Yan çıktılar: SRT, bölüm başlıkları, açıklama taslağı, kapak önerisi, Spotify için 1:1/9:16 | dosyalar | ⚠️ SRT ve bölüm var |
| P11 | Kontroller sesli kayda uyarlanır: konuşma–görsel uyumu, sessiz boşluk, kayma 0, rakam metinde var | verify | ⚠️ çoğu var, rakam kontrolü metne bağlanmalı |
| P12 | Kanalın görsel dili zevk dosyasında; her bölüm aynı kanala ait görünür ama aynı şablon olmaz | 3 bölüm yan yana | ❌ |
| P14 | **Görsel dil kanalın tonundan:** setup kanalın açıklamasını, kapağını, birkaç bölümün metnini okur ve görsel dili oradan seçer. Mizahi sohbet → büyük, oyuncu hareketli yazı, espri anlarında vurgu (punchline), kim konuşuyorsa onun kartı/avatarı, tepki işaretleri; bilgi/anlatım → başlık, rakam, şema, liste. Hiçbir zaman başka birinin tarzı kopyalanmaz; telifli meme/görsel kullanılmaz, her şey kanalın kendi renkleri ve şekilleriyle çizilir | 2 farklı tonda kanalın videoları yan yana farklı görünür | ❌ |
| P15 | **Komik/güçlü anları bulma:** kahkaha ve ses yükselmesi (sesten), espri yapısı ve tepki sözcükleri (metinden) ile kesit adayları; kişi seçer | T1'de seçilen anların çoğunu Kerem "evet" der | ❌ |
| P13 | Müzik: kanalın kendi jingle'ı varsa o; yoksa konuşmanın altında yok ya da çok hafif | — | ✅ besteleyici + kısma kuralı |

## Kalite çıtası

Kerem bölümü ve kesitleri **kendi kanalında olduğu gibi yayınlar**. Kesitlerde ilk 2 saniye kaydırmayı durdurur. Görseller konuşmayı tekrar etmez, anlatır.

## Testler (Kerem'in podcast'i)

| # | Test | Geçti demek |
|---|---|---|
| T1 | Bir bölümden 10 dakikalık parça → tam video + 2 kesit | verify geçer; Kerem "yayınlarım" der |
| T2 | Tam bölüm (❓ uzunluk) → tam video, bölüm başlıkları, SRT | süre P8'de; kayma yok |
| T3 | Aynı kanalın 2. bölümü, öğrenmeden sonra | düzeltme sayısı azalır |

## Kerem'e sorular — cevaplandı (22 Kasım), kalan

1–4 cevaplandı (yukarıda). 5: görsel his kanaldan çıkarılır (P14).
- ❓ Bir bölümün ses dosyası (tercihen düzenlenmemiş kayıt) ve kanal kapağı nerede?
- ❓ Konuşmacılar videoda isimle mi görünsün, takma adla mı, hiç mi? (İkinci sunucunun rızası Kerem'in işi.)
