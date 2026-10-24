# Değişiklik günlüğü

Tüm önemli değişiklikler bu dosyada. Sürümler GitHub'da ön sürüm (pre-release) olarak yayınlanır.

## v0.3.0 — 2026-10-24

İlk yayınlanan sürüm. v0.2.0 ayrı olarak yayınlanmadı; değişiklikleri (aşağıda) bu sürümün içinde.

### Yazı katmanları
- Metin paneli: 12 hazır stil (başlık, alt yazı, neon, kutu, el yazısı…), yazı tipi, boyut, renk, kontur, gölge, arka plan kutusu, hizalama.
- Metin animasyonları: giriş (solma, yükselme, düşme, kayma, pop, zoom, daktilo, kelime kelime) ve çıkış (solma, yükselme, batma, kayma, pop, zoom).
- Yazı önizlemede sürüklenerek konumlanır; zaman çizelgesinde ayrı metin izleri. Dışa aktarmada önizlemedeki ile aynı çizici kullanılır.
- Uygulamaya gömülü OFL yazı tipleri: Inter, Montserrat, Anton, Bangers, Bebas Neue, Caveat, Oswald, Playfair Display.

### Altyazılar (cihaz üzerinde)
- Altyazılar paneli: Whisper (tiny/base/small) cihazda çalışır, internet yalnızca modelin ilk indirilmesi için gerekir. Dil seçimi veya otomatik algılama.
- Altyazılar konuşmaya hizalanır, cümle yapısına göre satırlara bölünür; satır düzenleme, kaydırma, stiller.
- SRT/VTT/LRC içe ve dışa aktarma. Ana sayfada hızlı "Altyazı" aracı.

### Şarkı sözleri
- Şarkı sözü paneli: LRC/SRT içe aktarma veya düz metin yapıştırma, çalarken dokunarak senkronlama, şarkıya yayma, toplu kaydırma.
- 4 karaoke stili (satır söylendikçe dolan yazı) ve LRC olarak dışa aktarma.

### Efektler ve hazır düzenlemeler
- Klip efektleri: parlaklık/kontrast/doygunluk/sıcaklık, siyah-beyaz, sepya, keskinlik, RGB kayması, bulanıklık, vinyet, gren, çevirme, yakınlaştırma, sarsıntı. Önizleme dışa aktarmayla eşleşir.
- 12 tek tıkla hazır düzenleme (look), örnek kareli; tüm kliplere uygulanabilir.
- Vuruş efektleri: flaş, zoom vuruşu, vuruş sarsıntısı.

### Ritim / AMV modülü
- Şarkının temposu ve vuruşları cihazda bulunur (BPM, ölçü başı). Vuruşlar zaman çizelgesinin cetvelinde turuncu işaretler olarak görünür ve kliplerin yapıştığı noktalar olur.
- "Vuruşlarda kes": ana video izi her 1, 2, 4 (ölçü) veya 8 vuruşta bölünür.
- "Vuruş montajı": ana izdeki klipler sırayla, şarkının vuruşlarına oturan kısa çekimlerle şarkı boyunca dizilir; istenirse klip sesleri kapatılır.
- Vuruş efektleri kesim noktalarına tek tıkla eklenir/temizlenir.

### Değiştirilebilir yerleşim
- Alt çubuktaki yerleşim düğmesi artık bir menü: Referans (varsayılan), Panel solda, Geniş zaman çizelgesi, Odak (yalnızca önizleme); zaman çizelgesini gizle/göster.
- Zaman çizelgesinin üst kenarı ve panelin iç kenarı sürüklenerek boyutlandırılır; çift tık sıfırlar. Seçimler ayarlarda saklanır. Telefon/kısa pencere düzeni değişmedi.

### Diğer
- AppImage GStreamer'ı içinde taşıyor; önizleme AppImage'da da oynuyor.
- Ayarlar › Hakkında: kullanılan açık kaynak projelerin listesi ve lisansları (THIRD_PARTY_NOTICES.md).
- Lisans notu: yeni modüller yalnızca izin verici lisanslı (MIT/Apache/ISC/OFL) bileşenlerle yazıldı. FFmpeg (GPL) önceden olduğu gibi ayrı, değiştirilmemiş bir program olarak gelir ve alt süreç olarak çalıştırılır.

## v0.2.0 — 2026-10-24 (yayınlanmadı, v0.3.0 içinde)

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
