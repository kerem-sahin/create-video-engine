# Sesten video — sistem tasarımı

*22 Kasım 2026, taslak, Kerem onaylayınca bağlayıcı. Üst belge `PRODUCT.md`. Şartlar ve test notları `docs/lanes/PODCAST.md`. Bu belge **sistemi** anlatır; herhangi bir kanalın ayarı değildir.*

## Ne

Kim kurarsa kursun: elindeki bir ses kaydı (podcast bölümü, anlatım, ders, sesli not) → konuşulanı **anlatan**, kişinin **kendi kanalına benzeyen** bir video (+ kesitler, altyazı, bölüm başlıkları, açıklama).

Üç ilke:
1. **Eldeki malzeme nimettir.** Sistem önce kişinin zaten sahip olduğundan öğrenir (geçmiş bölümler, başlıklar, açıklamalar, site, kapak, eski videolar), sonra yalnız malzemenin cevaplamadığını sorar. Kişinin talimatı her şeyin üstündedir.
2. **Görsel, konuşulanı anlatır.** Her fikrin kendi görseli olur; sabit sahne, ortada ses dalgası, hep aynı kutu yok.
3. **Kimseye benzemez, kendine benzer.** Görsel dil kişinin malzemesinden çıkar. Beğenilen bir başka kanal yalnız ilke kaynağıdır; rengi, maskotu, düzeni kopyalanmaz.

## Bugünkü durum ve fark

T1 (22 Kasım) uçtan uca çalıştı ama yayınlanmaz bulundu: altyazı hatalı; görsel hikâyeyi anlatmıyor; hep aynı görüntü; amatör; "biz yokuz". Sebep: sistem kanalı yalnız kapak ve siteden tanıdı; görsel plan 6 sabit kutudan seçim yaptı; çizim/grafik/gerçek malzeme üreten bir parça yok. Bu tasarım o eksikleri kapatır.

## Sistemin parçaları

Akış: **Kaynaklar → Kanal hafızası → Kimlik → (her kayıt için) Metin → Anlama → Görsel plan → Görsel üretimi → Sahneler → Birleştirme → Kontrol → Öğrenme.**

### 1. Kaynak toplama (kurulumda bir kez, sonra yeni bölümlerle)

Kişiden **ne varsa** istenir; hiçbiri zorunlu değil:
- Kanal sayfası linki (Spotify, Apple, YouTube) ve varsa **RSS beslemesi**: bölüm listesi, başlıklar, tarihler, açıklamalar, süreler. RSS çoğu podcast'te bölümlerin ses dosyalarını da verir (indirme yalnız kişinin onayıyla).
- Kendi bilgisayarındaki kayıtlar (klasör).
- Site, kapak, sosyal hesaplar, daha önce yayınladığı videolar.

Yeni parça **`show-reader`** (tool): link/RSS/klasör → `brands/<slug>/sources/show.json` (bölüm başına başlık, tarih, açıklama, süre, ses kaynağı). Sayfa okunamazsa (giriş, engel) bunu söyler, uydurmaz.

### 2. Kanal hafızası (`brands/<slug>/memory/`)

Kaynaklardan çıkan, her bölümle büyüyen bilgi:
- `episodes/<n>.md`: her bölümün başlığı, açıklaması, (ses varsa) metni ve kısa özeti, konuları, öne çıkan anları.
- `CHANNEL.md`: **kanalın kendisi**:
  - Sunucular: lakap, ses/konuşma tarzı, rolü (soran, anlatan, laf sokan).
  - Tekrar eden konular, iç espriler, kalıp laflar, hangi bölümden beri döndükleri.
  - Sık geçen yerler ve kişiler. Üçüncü kişiler ekrana çıkmaz, yalnız hafızada "kimse adı yazılmaz" notuyla.
  - Bölüm yapısı: giriş/kapanış kalıbı, jingle, tipik süre.
  - Dil: argo, ciddiyet, mizah türü.
  - Başlık ve açıklama dili: kanalın kendini anlatma biçimi.

Yeni parça **`memory`** (tool): toplu yazıya dökme (yerel model, gece boyu çalışabilir), tekrar eden ifadeleri sayan ve bölümlere bağlayan dizin. Özetleri ve `CHANNEL.md`'yi ajan yazar; her iddia bir bölüme dayanır (`[b4 12:30]`).

Ses yoksa (yalnız Spotify) başlık + açıklama + site ile başlanır, eksik olduğu açıkça söylenir. Her yeni bölüm hafızayı büyütür.

### 3. Kimlik (`STYLE.md` → `voice:` bloğu)

Malzemeden çıkarılır, eksik kalan sorulur. Herkese aynı sorular, ama önceden doldurulmuş olarak:
- **Görünüm:** renkler, yazılar, çizim tarzı (kapak ve siteden).
- **Konuşanlar nasıl görünsün:** karakter çizimi (fotoğraftan ya da tarif) / lakap ve simge / gerçek fotoğraf / hiç. Konuşan hareketlenir.
- **Görseller nereden:** kendi malzemesi · bahsedilen şeyin gerçek ekranı · kanalın tarzında çizim · söylenen rakamdan grafik · (isteğe bağlı, ücretli) resim servisi. Birden çok seçilebilir; ücretli olanın ücretsiz yedeği hep vardır.
- **Tekrar eden ögeler:** maskot, jingle, açılış lafı, iç espriler (hafızadan önerilir, kişi onaylar).
- **Asla:** ekranda gösterilmeyecekler (isimler, konular, görsel türleri).

### 4. Metin (her kayıt)

- Yerel yazıya dökme; model boyutu kayda göre (Türkçe sohbet için büyük model önerilir, indirme onayla).
- **Hafıza destekli düzeltme:** lakaplar, sık geçen yerler ve kalıp laflar `CHANNEL.md`'den bilinir; ajan bunlara uyan yanlış duyulmuş kelimeleri düzeltir, emin olmadıklarını işaretler.
- **Kişinin düzeltme turu:** yalnız işaretli kelimeler, kısa bir liste (2–3 dk). Emin olunmayan kelime ekrana çıkmaz.
- Noktalama ve büyük harf (zamanlama değişmeden), konuşmacı ayırma, kişinin kulak kontrolü.

### 5. Anlama

Metin **parçalara** bölünür; her parçanın türü: hikâye (olay, yer, kişiler, olay sırası) · fikir/görüş · espri (kurulum + patlama + kahkaha) · rakam/gerçek · bahsedilen şey (ürün, yer, haber, kişi) · geri dönüş (hafızadaki bir espriye/olaya gönderme) · sohbet geçişi. Her parça hafızaya bağlanır ("bu, 4. bölümdeki X'e gönderme").

### 6. Görsel plan (`<dir>/visual-plan.md`, kişi kısaca onaylar)

Her parça için **o parçaya özel** bir görsel fikri; şablondan seçim değil. Türü parçanın içeriğinden gelir:
- Hikâye → olayın çizimi, sahne sahne (yer, kişiler, hareket), anlatı ilerledikçe değişir.
- Rakam → rakamdan çizilmiş grafik/karşılaştırma.
- Bahsedilen şey → gerçek görüntüsü (kişinin malzemesi ya da sayfanın ekranı), yoksa çizimi.
- Espri → patlama anında büyük tipografi + karakterin tepkisi.
- Görüş → konuşanın karakteri + fikrin kısa yazısı ya da benzetme görseli.
- Geri dönüş → hafızadaki bölüme gönderme ("4. bölümden beri…").

Kurallar: her 4–8 sn'de anlamlı bir değişim; aynı düzen arka arkaya iki kez yok; ekrandaki her söz ve rakam konuşmada geçer; kimsenin adı/özel bilgisi yok. Plan önce yazılır ve kişiye 1 dakikalık okumayla gösterilir (render'dan önce, ucuz).

### 7. Görsel üretimi

Kimlikte seçilen kaynaklara göre, her görsel `brands/<slug>/library/`'ye etiketlenip konur ve yeniden kullanılır:
- **Kendi malzemesi:** kişinin klasörü.
- **Gerçek ekran:** bahsedilen sayfanın ekran görüntüsü (kaynağı kaydedilir).
- **Çizim (ücretsiz):** yeni parça **`drawing-kit`**: kanalın çizgi tarzından (kalınlık, doku, renk, gölge) çıkan kurallar + SVG çizim yönergeleri + **karakter iskeleti** (konuşanların çizimi; ağız, göz, birkaç poz; konuşurken hareket). Ajan her görseli bu kurallarla çizer; çizimler kapakla yan yana kontrol edilir.
- **Grafik:** söylenen rakamlardan çizilen grafikler (kanalın kimliğinde).
- **Resim servisi (ücretli, isteğe bağlı):** kanalın kapağı stil referansı olarak verilir; anahtar kişinin ortamında; ücretsiz yedeği çizim.

### 8. Sahneler

Her plan satırı bir HyperFrames sahnesi olur. Sahneler sabit kutu değildir: ajan her parça için kompozisyonu yazar; ortak olan yalnız kanalın kimliği (renk, yazı, çizgi, karakter) ve hareket kuralları. Bir **kompozisyon dağarcığı** (tam ekran çizim, ikili bölme, yakın plan, karakter + yazı, grafik, alıntı, sohbet balonu…) önerilir; plan çeşitliliği ölçülür.

### 9. Birleştirme

`assemble-long` ses modu genişler: sahneler tüm zamanı kaplar (boş sahne yok), uzun bölüm hızlı kalır (60 dk ≤ 30–40 dk hedefi), kesitler `slice` ile çıkar, dikey kesitin kendi planı olur.

### 10. Kontrol

Var olanlara ek:
- **Görsel–söz uyumu:** videoyu görmemiş bir kontrolcü her kareye o anki cümleyle bakar: "görsel bunu anlatıyor mu?"
- **Kapsama ve çeşitlilik:** 8 sn'den uzun değişmeyen yer yok; aynı düzen tekrar oranı.
- **Altyazı:** işaretli kelime ekranda yok; kişi düzeltmesi yapıldı mı.
- **Gizlilik:** üçüncü kişi adı ekranda yok.
- **Benzemezlik:** iki farklı kanalın videoları yan yana farklı görünür (sistem testi).

### 11. Öğrenme

Kişinin her yorumu kurala döner (`learn`); hafıza her bölümle büyür; beğenilen görseller kütüphanede yeniden kullanılır.

## Hatlar ve parçalar

- `podcast` hattı **`voice`** (sesten video) olur; podcast, anlatım ve ders onun kullanımlarıdır. Hattın kurulum soruları yukarıdaki 1 ve 3'tür.
- Yeni parçalar: `show-reader`, `memory`, `drawing-kit`; genişleyen: `transcribe-local` (hafıza destekli düzeltme), `podcast-scenes` → sahne dağarcığı + karakter, `assemble-long`, `mp4-checks` (yeni kontroller).

## Yapım sırası

1. Kaynak toplama + kanal hafızası (her şey buna dayanıyor).
2. Kimlik soruları ve `voice:` bloğu.
3. Metin: büyük model + hafıza destekli düzeltme + düzeltme turu.
4. Anlama + görsel plan.
5. Çizim kiti ve karakter.
6. Sahne dağarcığı, birleştirme.
7. Kontroller.
8. **Ancak sonra deneme:** iki farklı kaynakla (Kerem'in podcast'i + tamamen farklı bir anlatım); ikisi yan yana farklı görünmeli.

## Açık

- Spotify'daki bölümler için RSS bulunup bulunamayacağı (bulunursa ses de gelir) ilk adımda denenecek.
- Çizim kalitesi ücretsiz yolda sınırlı olabilir; 5. adımda kapakla yan yana dürüstçe değerlendirilir.
