# create-video-engine — Ürün tanımı

*19 Kasım 2026, Kerem onayladı. Bu sayfa her şeyin üstündedir; yol haritası (`YOL-HARITASI.md`) ve her aşama buna göre kontrol edilir. Bir iş buradaki üç kişiden birine yaramıyorsa yapılmaz. Değişiklik yalnız Kerem'in onayıyla.*

## Nedir

İndirdiğin repo, ajanına "stüdyomu kur" dediğinde **sana özel bir video stüdyosu** kurar.

## Üç kişi — her aşama bu üçüyle test edilir

| Kişi | Ne yapıyor | Stüdyosunda olması gerekenler (örnek) |
|---|---|---|
| **Ayşe**, YouTuber / eğitimci | konuşma videoları + onlardan Reels kesitleri | yazıya dökme, boşluk/ıhh kesme, marka altyazısı, araya grafik kartları, kesit seçme |
| **Kerem**, uygulama geliştirici | tanıtım, güncelleme, "nasıl çalışır" videoları | ekran görüntüsü kırpma, ürün sahneleri, sahneler arası taşıma, anlatım/şema blokları |
| **Mert**, küçük marka (giyim, kafe) | fotoğraflarından sosyal medya videoları | fotoğraf sahneleri, ürün/koleksiyon geçişleri, fiyat/kampanya kartları |

Gerçek testler: Ayşe = Kerem'in kendi konuşma çekimi · Kerem = SweetSpot, Fiziyoo (yalnız örnek veri) · Mert = subitz.

## Sistem her biri için

1. **Seni tanır** — markanı ve zevkini öğrenir (renk, yazı, ritim, ses, imza).
2. **Ne yaptığını bilir** — hangi tür videolar yaptığını sorar; araştırılmış repolardan ve HyperFrames bloklarından **uygun parçaları seçip kurar**. Sonradan `add` ile parça eklenir.
3. **Videoyu senin tarzında yapar ve ölçer** — ölçülmemiş başarı yok.
4. **Seninle gelişir** — geri bildirim onaylı kurala döner.

## Bitti demek

Aynı repoyu üç kişi kurar → **üç farklı stüdyo** (farklı parçalar) → her biri kendi tarzında paylaşılabilir video üretir → ikinci video birinciden daha az düzeltme ister. Kalite her hatta o alanın en iyi aracından kötü değildir (isimsiz karşılaştırma).

## Ne değildir

- Şablon aracı değil; herkesin videosu birbirine benzemez.
- Tek bir video türünün aracı değil.
- Elle kurgu programı (CapCut) değil; kurguyu ajan yapar, kişi karar verir.
- Ücretli servise muhtaç değil.

## Ücretli servisler: isteğe bağlı

- Her parça kartında `paid_api` yazar. Varsayılan kurulum **yalnız ücretsiz** parçalarla çalışır.
- setup bir kez sorar: "Daha iyi sonuç için ücretli bir servis (ör. yapay ses, daha iyi yazıya dökme) kullanmak ister misin?" Hayır derse sorulmaz.
- Ücretli parçanın her zaman ücretsiz bir karşılığı vardır; anahtar yoksa sistem ücretsize döner ve bunu söyler.
- Anahtarlar yalnız kişinin ortam değişkeninde/`.env` dosyasında durur; repoya, loglara, videoya asla girmez. Ücretli servise gidecek veri (ses, yazı) önce kişiye söylenir.

## Haftalık kapsam kontrolü

Her aşama sonunda Kerem'e tek tablo: **"Ayşe / Kerem / Mert bugün sistemi kullanabilir mi?"** Biri "hayır" ise planın neresinde ona yaklaştığımız yazılır. Bu tablo `REQUIREMENTS.md` başında tutulur.

| Tarih | Ayşe | Kerem | Mert |
|---|---|---|---|
| 19 Kasım | ❌ konuşma videosu hattı yok | ✅ tanıtım videosu (brag ayarında) · ❌ anlatım | ❌ fotoğraf hattı yok |
| 19 Kasım akşam | ⚠️ hat kuruluyor ve çalışıyor (temiz ajan: 50→41 sn ders + 17,5 sn kesit, verify geçti) — yalnız sentetik kayıtla; gerçek çekim bekleniyor | ✅ tanıtım hattı, temiz ajanla 2 markada (SweetSpot, Plainday) | ⚠️ tarif yazıldı, malzeme yok (subitz klasörü bulunamadı) |
| 19 Kasım gece | ⚠️ hat çalışıyor (sentetik kayıtla); gerçek çekim bekleniyor | ✅ tanıtım hattı, 2 markada | ⚠️ hat çalışıyor (temiz ajan, CC0 fotoğraflı test markası, verify geçti) ama kalite zayıf: düşük çözünürlüklü fotoğrafla iki panelli durgun düzen, küçük başlık |
| 19 Kasım gece (2) | ⚠️ aynı | ✅ aynı | ✅ düzeltme turundan sonra 2. temiz deneme: tek büyük fotoğraf kartı, bulanık marka zemini, büyük başlık, hareketli çekimler, farklı müzik tarzı (acoustic-strum); bütün kontroller uyarısız geçti |

## İlk sürüm (0.1) kararı — 20 Kasım

Kerem: "off yapalım artık … her şeyi hazırladık mı da test yapıp duruyoruz?" Kapsam sabitlendi: üç hat (tanıtım ✅, fotoğraf ✅, konuşma beta), add/remove/upgrade, verify, learn, müzik. Bilinen eksikler README'de açıkça yazılı (müzik tınısı, düzen benzerliği, konuşma hattı gerçek çekimsiz, yalnız Claude Code + macOS). 0.2: gerçek enstrüman örnekli müzik (D8), markaya özgü düzen (C16), ikinci ajan (A4), Ayşe gerçek çekim.

## Reklama (duyuruya) hazır demek — 21 Kasım

Kerem: "gerçekten işe yarar bi noktaya geldiğinde başlıcam reklama." Repo GitHub ve npm'de sessizce duruyor; duyuru şu şartların hepsi sağlanınca:

| # | Şart | Ölçü |
|---|---|---|
| R1 | Uzun konuşma videosu | 10 dk kayıt → birkaç dakikada YouTube videosu; altyazı kayması yok; bölüm başlıkları ve SRT — 22 Kasım: ⚠️ 6 dk deneme (gerçek klip ×6): kayma 0 ms (ölçüldü), toplam ~13 dk yüklü makinede (Chrome yoluyla ~1 saat), SRT + bölümler var; altyazı bu yolda animasyonsuz cümle satırı (Homebrew ffmpeg'de libass yok); gerçek 10 dk kayıtla denenecek |
| R2 | Shorts kalitesi | altyazı yüze binmiyor, yüz kadrajda kalıyor; Kerem "paylaşırım" diyor — 22 Kasım: ⚠️ yüz takibi geldi (Kerem'in klibinde yüz %100 kadrajda; sabit kırpmada kayboluyordu); yakın çekimde çene altında yer yoksa yazı üst banda; Kerem'in onayı bekleniyor |
| R3 | Müzik | gerçek enstrüman örnekleri; Kerem "hep aynı" demiyor (D8) |
| R4 | Markalar farklı görünür | 3 marka yan yana "aynı şablon" denmiyor (C16) |
| R5 | Bizi tanımayan biri kurar | en az 1 dış kullanıcı yardımsız kurup video çıkarır (K3) |
| R6 | Repo vitrini | brag ayarında tasarım, kaliteli demo (L5) |

## Neden bu sayfa var

İki kez aynı hata yapıldı: proje tek bir videoyla (ürün tanıtımı) ölçüldü ve asıl fikir — "herkes kendi sistemini kurar, sistem ihtiyaca göre parça seçer" — kenarda kaldı. Kolay ölçülen şeye doğru kayıldı. Bu sayfa ölçüyü üç kişiye bağlar.
