# Başlangıç

Kendi video stüdyonu kurman için gereken her şey bu sayfada. Gerisini stüdyo sana sorarak yapar.

## 1. Gerekenler (bir kez)

- Bir Mac.
- **Claude Code:** masaüstündeki Claude uygulamasının Code sekmesi ya da terminaldeki `claude`.
- **Node ve ffmpeg.** Terminal'i aç ve şunu yapıştır (Homebrew yoksa önce [brew.sh](https://brew.sh) sayfasındaki tek satırı çalıştır):

```bash
brew install node ffmpeg
```

## 2. Stüdyoyu oluştur

Terminal'de, stüdyonun duracağı yerde:

```bash
npx create-video-engine init studyom
```

Birkaç dakika sürebilir. Sonunda `Studio created` yazar.

## 3. Stüdyoyu kur

`studyom` klasörünü Claude Code'da aç ve kendi cümlenle şunu söyle: markanın ya da kanalının adı, ne yaptığın ve elindeki malzeme. Örnek:

> stüdyomu kuralım. Kafem için Reels yapacağım, fotoğraflar masaüstünde "kafe" klasöründe.

Malzeme ne varsa: site, uygulamanın kodu, App Store linki, fotoğraf klasörü, podcast linki ya da kaydı.

- Stüdyo önce malzemene bakar. Sonra ne tür videolar yaptığını sorar, ardından markan için **en fazla altı soru** daha. Her sorunun yanında kendi tahmini olur; doğruysa "evet" demen yeter.
- **Beğendiğin 2–3 video** (link ya da dosya, konusu fark etmez) ve neyini sevdiğini bir satırla yazarsan stüdyo seni çok daha hızlı tanır.
- Sonunda tek bir **örnek kare** gösterir. Beğenmezsen neyin olmadığını söyle.

## 4. Video yap

Örnek kare onaylanınca ne istediğini söyle: "yeni ürünü anlatan bir Reels yapalım" gibi.

- Önce **üç kısa hikâye** önerir, birini seçersin.
- Sonra bir **taslak** gösterir ve bir not ister. Değiştirmek istediğin tek şeyi söyle ya da "böyle iyi" de.
- Son videoyu verince **paylaşır mısın** diye sorar. Dürüst cevap ver: cevabın bir sonraki videoya not olarak geçer.
- **Müzik eklemez.** Video sabit bir tempoya kesilmiş gelir; sesi paylaşırken Instagram ya da TikTok'tan eklersin. Kendi parçan varsa ver, onu koyar.

## Ne beklemeli

- İlk kurulum ve ilk video yaklaşık **bir saat**. Aynı markanın sonraki videoları daha kısa sürer ve daha az düzeltme ister.
- Her söylediğin bir sonraki videoya not olarak geçer. Aynı şeyi iki kez söylemen gerekmemeli.
- Bir şey takılırsa ya da stüdyo bir aracın eksik olduğunu söylerse, söylediği komutu Terminal'e yapıştır.
