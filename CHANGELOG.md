# Değişiklik günlüğü

Tüm önemli değişiklikler bu dosyada. Sürümler GitHub'da ön sürüm (pre-release) olarak yayınlanır.

## v0.2.0 — 2026-10-24

### Performans (Linux'ta akıcı oynatma)
- **Kasmanın sebebi bulundu:** WebKitGTK, video her kare değiştiğinde önizlemenin etrafındaki alanı yeniden boyuyor. Editörün arka planındaki üç CSS gradyanı, büyütülmüş poster görseli ve önizlemenin 50px bulanık gölgesi her karede yeniden hesaplanıyordu. React değil: oynatma sırasında saniyede ~0 render.
- Arka plan (sıcak gradyan, poster, vinyet) ve önizleme gölgesi artık bir kez bir canvas'a çiziliyor. Görünüm aynı, kare başına maliyet neredeyse sıfır.
- **Performans modu** (Ayarlar › Performans, Linux'ta varsayılan açık): cam/bulanıklık ve gölge yok, renk efekti önizlemede canlı uygulanmıyor (dışa aktarmada uygulanır), animasyonlar azaltıldı, oynatma sırasında zaman çizelgesi saniyede ~12 kez güncelleniyor.
- **Hafif önizleme (540p)**: videolar içe aktarıldıktan hemen sonra arka planda FFmpeg ile 540p kopyası hazırlanır ve önizleme bu kopyadan oynar. Dışa aktarma her zaman orijinali kullanır. Linux'ta varsayılan açık.
- Ölçümler (Enes'in makinesi: CachyOS/KDE Wayland, RTX 3050, WebKitGTK 2.54; 1080p60 test videosu, 8 sn oynatma):

  | Durum | Önce | Sonra |
  |---|---|---|
  | Normal mod | 12,9 fps | 31,7 fps |
  | Performans modu | 13,3 fps | 44,9 fps |
  | Performans modu + 540p önizleme | — | 60 fps (480/480 kare, 0 düşen) |

  WebKit DMABUF/compositing ayarları ve GStreamer donanım çözücüsü (nvh264dec ↔ avdec) ölçüldü; fark yok, bu yüzden varsayılanlara dokunulmadı.

### Çok sayfalı uygulama
- Ana sayfa, Editör, Müzik değiştirme ve Ayarlar sayfaları; projeler kaydedilir/açılır, otomatik kayıt.

### Oynatma düzeltmesi
- Linux'ta video görünmüyor ve ses gelmiyordu. Medya artık Range destekli yerel bir sunucudan oynatılıyor; hata olursa önizlemede açık bir mesaj ve uygulama günlüğü var.

### Yeniden tasarım
- Editör referans tasarıma geri döndü: tam genişlikte önizleme, cam sol ray ve başlık, yüzen medya paneli, önizlemenin üzerine oturan zaman çizelgesi ve hap şeklinde klipler, alt çip çubuğu, renk efektleri.
- Ana sayfa, müzik ve ayarlar sayfaları aynı dile getirildi; telefon düzenleri eklendi.

### Android
- Android (arm64) desteği: içe aktarma (content://), uygulamaya gömülü FFmpeg, dışa aktarımlar Filmler/XenoCut klasörüne.
- APK şu an hata ayıklama imzalı (debug); yüklemek için "bilinmeyen kaynaklar" izni gerekir.

### Hakkında
- Ayarlar › Hakkında: "XenoCut, SXMWARE tarafından hazırlandı", sürüm, diğer projeler (sxmusic.lol, sxmtools.cc, sxreaper.xyz) ve PayPal / Ko-fi bağış düğmeleri. Bağlantılar sistem tarayıcısında açılır.
