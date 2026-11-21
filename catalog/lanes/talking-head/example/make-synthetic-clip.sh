#!/bin/sh
# Synthetic Turkish "talking" clip for testing the talking-head lane without real footage:
# macOS `say -v Yelda` speech with deliberate pauses ([[slnc ms]]) and two fillers ("Eee", "Şey"), muxed with a moving test picture.
# usage: make-synthetic-clip.sh <out-dir>   -> <out-dir>/talk.mp4 (1920x1080, 30 fps, ~50 s)
set -e
OUT=${1:?out dir}
mkdir -p "$OUT"
cat > "$OUT/say.txt" <<'T'
Merhaba arkadaşlar, bugün size videoları nasıl daha hızlı kurgulayabileceğinizi anlatacağım. [[slnc 1600]] Eee, birinci adım konuşmayı yazıya dökmek. Bunu bilgisayarınızda ücretsiz yapabilirsiniz. [[slnc 1800]] İkinci adım, duraklamaları ve gereksiz sesleri kesmek. Şey, bu adım videonuzu çok daha akıcı yapar. [[slnc 1500]] Üçüncü adım altyazı eklemek, çünkü insanların çoğu videoyu sessiz izliyor. Altyazı hem erişilebilirliği artırır hem de izlenme süresini uzatır. [[slnc 1700]] Son olarak videonuzdan kısa kesitler çıkarın. En iyi cümleleriniz dikey videoya dönüşsün. Hepsi bu kadar, bir sonraki videoda görüşmek üzere. [[slnc 1000]]
T
say -v Yelda -f "$OUT/say.txt" -o "$OUT/speech.aiff"
ffmpeg -v error -y -f lavfi -i "testsrc2=size=1920x1080:rate=30" -i "$OUT/speech.aiff" -shortest \
  -c:v libx264 -pix_fmt yuv420p -preset veryfast -g 30 -c:a aac -ar 48000 -ac 1 "$OUT/talk.mp4"
echo "wrote $OUT/talk.mp4"
