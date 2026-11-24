# Yol haritası (22 Kasım 2026, taslak)

*Üç araştırmanın birleşimi: (1) iyi sonuç veren ajan video sistemleri (HyperFrames skill'leri, brag-slim, video-motoru, Remotion skill'leri, motion-video-kit, onetake, 16 skill'lik bir karşılaştırma); (2) sesten/podcast'ten video ürünleri ve Türkçe yazıya dökme; (3) kendi repomuzun dürüst denetimi. Kerem onaylayınca bağlayıcı; `PRODUCT.md`'nin üç ayağı (seni tanır, ne yaptığını bilir, seninle büyür) aynen kalır.*

## Teşhis: yol doğru, yöntem yanlış

**Ölçülen doğruluk zevk değildir.** Bir karşılaştırmada 16 video skill'inin hepsi teknik kontrolleri geçti, hiç skill kullanmayan Claude da geçti; 16'nın 6'sı gözle bakınca skill'siz sonuçtan farksızdı. Bizim belirtimiz tam bu: kontroller "tamam" diyor, Kerem "yayınlamam" diyor.

Bizde olan:
- **Kural ağır, zevk hafif.** Ajan bir videodan önce ~540 satır kural okuyor (+ HyperFrames'in ~1.200 satırı). "Her sıfat sayı olur", boş alan yüzdesi, başlık katları, yasak yapılar: bunlar ajanı tasarlamaktan çok savunmaya itiyor; test raporları birbiriyle çelişen kurallar listeliyor. brag-slim ~120 satır, kontrol scripti yok, ajanı serbest bırakıyor; Kerem'in "kendi başına halletmişti" dediği bu.
- **Zevkin kaynağı yok.** Ajana onaylanmış iyi video, reddedilmiş kötü video ve nedeni, kişinin beğendiği bir videodan çıkarılmış "mekanizmalar" verilmiyor. Eleştirmen "videoya bakan yabancı" değil, kurallara göre not veren biri.
- **Döngü çok yavaş.** 46 sn video için 7–10 dk render, podcast denemesi 2 saat. Günde en fazla ~3 zevk turu; eleştirmenin bulduğu hatalar "yeniden render 30 dk" diye düzeltilmeden kaldı.
- **Platform erken büyüdü.** 2 günde 4 hat, ~24 parça, kart/hash/upgrade makinesi, 8 belge (~1.200 satır). Hiçbir hat Kerem'in gurur duyacağı bir şey üretmeden.
- **Müziği kodla besteliyoruz.** HyperFrames'in kendi rehberi açıkça "müziği kodla yazmaya uğraşma, kimse iyi mi diye duyamıyor" diyor. "Müzikler hep aynı" bunun sonucu.

Kanıtlanmış olan (korunacak): uzun video boru hattı (kayma 0 ms, normalize, sessizlik kesme, slice, SRT/bölüm), ses seviyesi ölçümü, Shorts yüz takibi, konuşma videosunda Kerem'in "gerçekten güzel" dediği sonuç, kanalın malzemesini okuma (show-reader) ve hafıza.

## Yayınlanabilir videoyu ayıran 7 şey (araştırmadan)

1. **Gerçek malzeme, uydurma değil:** kişinin gerçek ekranı, fotoğrafı, sesi, yazı tipi.
2. **Tek somut hikâye:** "hikâyesiz güzel hareket" zayıf videonun en sık sebebi.
3. **Dışarıdan zevk girdisi:** kişinin kendi markası, beğendiği bir videodan **adlandırılmış mekanizmalar** (zaman ve kareyle), büyüyen bir **yasak listesi** (modelin varsayılan klişeleri + kişinin sevmedikleri).
4. **Yapan değil, taze bir eleştirmen:** yalnız kareleri ve kişinin isteğini görür, "yabancı gözüyle bu ne anlatıyor?" diye bakar.
5. **Kişi döngüde, iki ucuz noktada:** başta üç hikâyeden birini seçer (yalnız yazı), ortada hızlı bir taslağa bakar; son render ondan sonra.
6. **Görsel söyleneni anlatır:** b-roll'un izlenmeye katkısı yalnız konuşulanı doğrudan gösterdiğinde ölçülmüş; genel görüntü katkı vermiyor.
7. **Ses bilinçli:** kişinin kendi parçası ya da kayıtlı bir katalogdan seçim, kullanılanlar listesiyle; bestelenmiş sentez değil.

## Yeni yöntem

- **İnce çekirdek, serbest ajan.** `make` ~120–150 satıra iner: amaç, birkaç kesin sınır (okunabilirlik, telif, kişisel veri, ses seviyesi), kalite çıtası ("her kare paylaşılabilir", "gerçek olanı göster") ve tasarım özgürlüğü. Bugünkü sayısal kurallar **talimat olmaktan çıkar, uyarıya döner** (verify söyler, ajan karar verir).
- **Kişinin defteri (zevk hafızası).** Marka, beğendiği videolardan mekanizmalar (kareyle), **onaylar da** (yalnız hatalar değil: "onay da derstir"), düzeltmeler, kişiye özel yasak listesi, yeniden kullanılabilir sahneler. Bugünkü STYLE.md + ledger + learn bunun içine toplanır.
- **Hızlı taslak döngüsü.** Önce düşük çözünürlüklü/sahne bazlı taslak (dakikalar, saniyeler), kişi bakar, sonra son render. Sahne değişince yalnız o sahne yeniden çizilir.
- **Taze eleştirmen.** Kareler + kişinin isteği + kişinin sevmedikleri; kurallara göre değil, yabancı gözle. Bulduğu P0'lar düzeltilmeden teslim yok.
- **Başarı ölçüsü tek:** Kerem "bunu yayınlarım" der. Her büyük değişiklik brag-slim ile **kör karşılaştırılır** (K1 gibi).

## Dondurulanlar (silinmez, büyütülmez)

- Yeni hat ve yeni parça yok (sesten video hariç, o da 3. aşamada).
- Katalog/kart/hash/upgrade makinesi olduğu gibi kalır.
- Belgeler: `PLAN`, `CONTRACTS`, `PARTS-FORMAT`, `HARVEST`, `REQUIREMENTS` güncellenmez; geçerli olanlar `PRODUCT.md` ve bu yol haritası.
- Müzik bestecisi (`music-scorer`) varsayılan olmaktan çıkar; kişi isterse kalır.
- Konuşmacı etiketleri yalnız kişi doğrularsa ekranda.

## Aşamalar

| # | Ne | Bitti demek |
|---|---|---|
| 0 | **Sadeleştirme** (yarım gün): dondurma, belgeleri iki belgeye indirme, bu haritanın onayı | Kerem onayladı |
| 1 | **Yeni çekirdek:** ince `make`, kişinin defteri, uyarıya dönen kurallar, hızlı taslak, taze eleştirmen | Temiz ajan bir videoyu yeni çekirdekle bitirir; taslaktan düzeltmeye geçiş dakikalar |
| 2 | **Kanıt:** aynı görevler üç yoldan (yeni çekirdek / brag-slim / eski sistem), Kerem kör puanlar. Görevler: Kerem'in bir uygulama tanıtımı, fotoğraftan bir Reels, kendi podcast'inden 30–60 sn'lik bir kesit | Yeni çekirdek en az ikisinde birinci; Kerem en az birine "yayınlarım" der |
| 3 | **Sesten video (çekirdeğin üstünde):** hafızadan sözlük → altyazı düzeltmesi (+ büyük/Türkçe ince ayarlı model, isteğe bağlı ücretli servis), her fikre özel görsel (çizim/grafik/gerçek malzeme), kişinin istediği şekilde sunucular; önce kısa kesit, sonra bölüm | Kerem kendi podcast kesitine "yayınlarım" der; altyazıda işaretli hata kalmaz |
| 4 | **Ses ve müzik:** kişinin parçası / açık lisanslı katalog + kullanılanlar listesi; isteğe bağlı yerel Türkçe sentetik ses (VoxCPM2, önce 8 GB'ta ölçülür) | "Müzikler aynı" şikâyeti biter |
| 5 | **Büyüme ve dış kullanıcı:** aynı kişide 3–5 video, düzeltme sayısı düşüyor mu; bir dış kullanıcı sıfırdan kurar | İkinci-üçüncü videoda düzeltme azalır; dış kullanıcı yardımsız video çıkarır |
| 6 | **Duyuru** | Kerem "artık işe yarıyor" der |

## Korunan kararlar (silinen belgelerden)

- **Eldeki malzeme nimettir** (Kerem, 22 Kasım): sistem önce kişinin zaten sahip olduğundan öğrenir (geçmiş bölümler, başlıklar, açıklamalar, site, kapak, eski videolar), sonra yalnız malzemenin cevaplamadığını sorar; kişinin talimatı her şeyin üstündedir. Parçalar hazır: `show-reader` (link/RSS/klasör → bölüm listesi, onaylı indirme), `memory` (toplu yazıya dökme, tekrar eden laf/isim dizini, kaynaklı CHANNEL.md).
- **Kimseye benzemez, kendine benzer:** beğenilen başka bir kanal yalnız ilke kaynağıdır; rengi, maskotu, düzeni kopyalanmaz.
- **Podcast için (3. aşama):** görseller hem ücretsiz (ajan kanalın tarzında çizer) hem isteğe bağlı ücretli (resim servisi) yoldan; sunucular kişinin istediği şekilde (Kerem: kapak tarzında karakter çizimi); altyazı büyük yerel model + hafızadan sözlük + kişinin kısa düzeltme turu; üçüncü kişi adları ekrana çıkmaz; konuşmacı etiketi yalnız kişi doğrularsa.
- **T1 dersi:** sabit sahne + ses dalgası + kutu blokları "yayınlanmaz" bulundu; o kod (podcast-scenes, assemble-long ses modu) silindi. `slice` ve uzun video birleştirme kaldı.
- **Türkçe sentetik ses adayı (4. aşama):** `alexturkey/voxcpm2-turkce-ses-tasarimi` (Apache-2.0, yerel, kelime zamanlarını kendisi verir; 8 GB Mac'te önce ölçülecek).

## Kerem'e sorular

1. Bu teşhise katılıyor musun: kuralları azaltıp ajanı serbest bırakmak, zevki senin malzemen + defter + taze eleştirmenden almak?
2. Müzik bestecisini varsayılandan çıkarmak (yerine senin parçan / açık lisanslı katalog) olur mu?
3. 2. aşamanın üç görevi uygun mu, değiştirmek istediğin var mı?

## 2. aşama bulguları (23 Kasım, puanlama sürüyor)

Kerem, podcast kesiti (yeni çekirdek): "hiç konuşmadığımız bir ajan çıkardıysa gerçekten bir ilerleme var". Eksikler:
- Görseller sesle tam senkron değil; sebep ölçülecek (kelime zamanları mı, sahne yerleşimi mi).
- Renkler siteden fazla birebir alınmış. Site rengi bir kaynak, birebir kopya değil: kurulum iki palet önermeli (birebir ve yorumlanmış), kişi seçmeli.

Ajanların ortak skill sorunları (düzeltilecek):
- `shots.json` ve `cues.json` biçimi yazılı değil; verify'ın üç kontrolü hep atlanıyor.
- 9:16 güvenli alan sayıları make, vertical.md ve verify arasında çelişiyor.
- Podcast hattı yok; captions "?" düşürüyor; yazıya dökme düzeltme akışının komutu yok; verify ses ölçümü ajanın kendi ölçümüyle tutmadı.
- Kişiye sorulamadığında "taslağı göster" adımının karşılığı yazılı değil; yeni stüdyoda hat listesi boş başlıyor.

## Sıradaki iş (23 Kasım, Kerem: "nasıl ilerlememiz lazımsa ayarla")

Çizim tek darboğaz değil; vizyonun her ayağı sırayla ilerler. Sıra:

1. **Podcast kesiti "yayınlarım"a kadar** (2. ve 3. aşama): fotoğraftan mürekkep çizim + kanalın çizim kütüphanesi (çizilen her şey saklanır, onaylanır, tekrar kullanılır), tek el kuralı (karakterler ve nesneler aynı çizgi ve detayda), güçlü kanca (ilk 2 saniye). Sonra aynı bölümden ikinci bir kesit: kütüphane gerçekten işe yarıyor mu.
   - **24 Kasım:** ilk kesit tamam. Kerem kendi stüdyosunda (testler/kerem-podcast) kendisi kullandı: "baya iyi ya. paylaşırım bunu." 12 mesaj, 1 gerçek düzeltme. Çıkan dersler sisteme işlendi (e3726e8). **Sıradaki:** aynı stüdyoda ikinci kesit; ölçülecek: düzeltme sayısı 1'den 0'a iniyor mu, kütüphane tekrar kullanılıyor mu, anı sistem seçebiliyor mu, yeni kurallar tutuyor mu.
   - **24 Kasım, ikinci kesit ("antikor"):** 0 düzeltme, 3 mesaj, 24 dakika; anı sistem seçti, Kerem değiştirmeden kabul etti ve paylaşır. Çizimler tek elden. Zayıf: ortası durağan (aynı iki çizim ~30 sn, değişimler küçük); kütüphane ve kalem kontrolü bu konuda hiç devreye girmedi (araba yoktu), yani henüz denenmedi; ara mesajlar yer yer İngilizce (kural eklendi). Adım 1 tamam sayılır; sıradaki adım 2.
2. **Tanıtım videosu yeniden** (2. ve 4. aşama): yeni müzik akışıyla; Kerem adaylardan seçer. brag'i geçmeden duyuru yok.
3. **Reels gerçek malzemeyle** (2. aşama): Kerem'den gerçek bir yerin/ürünün fotoğrafları istenir; anlamsız malzemeyle test yapılmaz.
4. **Uzun video** (seviye maddesi): podcast bölümünün tamamı; kesit akışının uzun hâli, hızlı taslak yolu.
5. **Üç farklı kişi** (seviye maddesi): üç farklı marka/kanal kurulur, videolar yan yana konur; birbirine benziyorsa sistem kurulumda yeterince öğrenmiyor demektir.
6. **Büyüme** (5. aşama): aynı kanalda 3–5 video, defter ve kütüphaneyle düzeltme sayısı düşüyor mu (ledger sayar).
7. **Dış kullanıcı** (5. aşama): biri sıfırdan, yardımsız kurar.
8. **Türkçe sentetik ses** (4. aşama, isteğe bağlı): VoxCPM2 8 GB'ta ölçülür.
9. **Duyuru** (6. aşama): yalnız Kerem "gerçekten işe yarıyor" deyince; repo tasarımı ve npm güncellemesi o zaman.

Her adım hangi ayağı ya da seviye maddesini ilerlettiğini söyler; söyleyemiyorsa yapılmaz.
