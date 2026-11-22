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

## Kerem'e sorular

1. Bu teşhise katılıyor musun: kuralları azaltıp ajanı serbest bırakmak, zevki senin malzemen + defter + taze eleştirmenden almak?
2. Müzik bestecisini varsayılandan çıkarmak (yerine senin parçan / açık lisanslı katalog) olur mu?
3. 2. aşamanın üç görevi uygun mu, değiştirmek istediğin var mı?
