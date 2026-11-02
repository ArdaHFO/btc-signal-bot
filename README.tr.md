BTC Signal Bot, Bitcoin fiyatlarını izler ve kuralları olası bir alım veya satım sinyali bulduğunda Telegram mesajı gönderir.

<h1 align="center">BTC Signal Bot</h1>

<p align="center"><strong>Mumları takip et. Sinyalin nedenini anla.</strong></p>
<p align="center">Kapanan Binance BTC/USDT mumlarından gösterge tabanlı Telegram bildirimleri üreten bir Node.js denemesi.</p>

<p align="center">
  <a href="README.md">English</a> · <strong>Türkçe</strong><br />
  <a href="#yerel-çalıştırma"><strong>Yerel çalıştırma</strong></a> ·
  <a href="#sinyaller-nasıl-oluşur">Sinyal mantığı</a> ·
  <a href="https://github.com/ArdaHFO/btc-signal-bot/issues">Sorun bildir</a>
</p>

---

BTC Signal Bot tamamlanan bir dakikalık BTC/USDT mumlarını izler, EMA, RSI ve ATR koşullarını birleştirir ve yapılandırılmış Telegram sohbetlerine Türkçe alım, çıkış ve tut mesajları gönderir. Varsayılan betik ayrıca uzun pozisyon, komisyon ve sermaye için bellekte örnek bir hesap tutar.

**Bu proje eğitim amaçlı bir sinyal prototipidir.** Borsaya emir göndermez. Bakiye mesajları benzetim hesabıdır, borsa bakiyesi veya kârlı işlem kanıtı değildir. İngilizce ve Türkçe belgeler aynı uygulamayı açıklar.

## Yerel çalıştırma

| Gereksinim | Mevcut kaynak |
| --- | --- |
| Çalışma ortamı | Node.js 22.9+, kayıtlı bağımlılıkların sürüm aralığına uygun bir seçenektir |
| Paket yöneticisi | npm ve sağlanan `package-lock.json` |
| Piyasa bağlantısı | Binance'in herkese açık REST ve WebSocket piyasa verileri |
| Bildirimler | Sana ait Telegram bot token'ı ve bir veya daha fazla sohbet kimliği |
| Varsayılan akış | `BTCUSDT`, bir dakikalık mumlar |

Projenin kendisi bir Node.js sürüm aralığı tanımlamıyor. Kilitli `npm` bağımlılığı Node.js `^20.17.0 || >=22.9.0` istiyor. Bu nedenle önceki README'deki Node.js 14 gereksinimi mevcut bağımlılıklar için yeterli değil.

```bash
git clone https://github.com/ArdaHFO/btc-signal-bot.git
cd btc-signal-bot
npm ci
```

Repo kökünde kendi değerlerinle yerel bir `.env` dosyası oluştur. Bildirim modülü çoğul `TELEGRAM_CHAT_IDS` değişkenini kullanır.

```dotenv
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_IDS=your_chat_id,another_chat_id
```

Kontrol ettiğin bir botu ve sohbetleri kullan. `.env` Git tarafından dışlanır. İsteğe bağlı `chatid.js` aracı aynı `TELEGRAM_BOT_TOKEN` değişkenini okur. Özellikle çalıştırıldığında sohbet kimliklerini bulmak için Telegram güncellemelerini ister.

Yapılandırmayı tamamladıktan sonra botu başlat. Bu komut Binance'e bağlanır ve tanımlanan bütün sohbetlere hemen başlangıç mesajı, ardından sinyal ve dönemsel tut mesajları gönderebilir.

```bash
npm start
```

`Ctrl+C` ile durdurabilirsin. Uygulama yalnızca herkese açık piyasa verilerini okuduğu için Binance hesap anahtarı gerekmez.

## Botun içinde

- **Kapanmış mumlarla çalışma.** Göstergeler yalnızca kapanmış REST mumlarıyla başlatılır. WebSocket işleyicisi bozuk mesajları ve daha önce işlenen kapanış zamanlarını atlar, yalnızca Binance'in kapanmış olarak işaretlediği mumları işler.
- **Üç gösterge ailesi.** EMA 5/21 trend yönünü, RSI 14 momentum filtresini, ATR 7 ise fiyat hareketi ve EMA ayrışması eşiklerini sağlar.
- **Pozisyon durumuna bağlı bildirimler.** Varsayılan betik tek bir uzun pozisyonu benzetir ve çıkış koşulunun nedenini bildirir.
- **Birden fazla Telegram alıcısı.** `notify.js`, virgülle ayrılmış sohbet kimliklerini okuyarak aynı mesajı her alıcıya gönderir.
- **Tut mesajları.** Bir dakikalık zamanlayıcı, yakın zamanda sinyal gönderilmediyse açık pozisyonu veya yeni giriş bekleyişini bildirir.
- **Yeniden bağlantı.** WebSocket kapanırsa beş saniye sonra tekrar bağlanmayı dener.

## Sinyaller nasıl oluşur

`npm start` komutunun seçtiği varsayılan giriş noktası [`index.js`](index.js) dosyasıdır. Strateji ayarları `.env` seçenekleri yerine bu dosyanın başındaki sabitlerde bulunur.

| Ayar | Varsayılan davranış |
| --- | --- |
| Giriş | Benzetilen pozisyon yokken hızlı EMA'nın yavaş EMA üzerinde olması, RSI aralığı ve ATR tabanlı fiyat/ayrışma filtreleri |
| Bekleme süresi | Uygun giriş sinyalleri arasında 10 saniye |
| Çıkış | Benzetilen zarar kes, düşüş yönlü EMA ilişkisi, uygun momentum dönüşü veya kâr hedefi |
| Komisyon varsayımı | Örnek sermaye hesabında her yönde %0,1 |
| Zarar kes eşiği | Benzetilen net getiri hesabında %0,7 |
| Kâr hedefi | Benzetilen net getiri hesabında %0,2 |

Kod mevcut EMA değerlerini karşılaştırır. Ardışık iki mum arasında yeni bir kesişim gerçekleşmesini şart koşmaz. Başlangıç sermayesi örnek olarak 20.000 USDT seçilmiştir. Mesajlar akışın karşıt para birimini kullanır. Alım komisyonu maliyet tabanına dahildir ve benzetilen pozisyon kapanırken net kâr/zarardan bir kez düşülür.

[`BEST.js`](BEST.js), farklı pozisyon ve durum davranışına sahip alternatif bir strateji betiğidir. Varsayılan başlangıç dosyası değildir ve kullanılmadan önce ayrı incelenmelidir.

## Geliştirme ve doğrulama

Kaynak, küçük bir CommonJS uygulamasıdır. `ws` veri akışını, `axios` HTTP işlemlerini, `technicalindicators` göstergeleri, `dotenv` ise yerel bildirim yapılandırmasını sağlar.

Sözdizimi kontrolleri piyasa bağlantısı başlatmadan veya Telegram mesajı göndermeden dosyaları inceleyebilir.

```bash
node --check index.js
node --check BEST.js
node --check notify.js
```

Uygulama kaynağında otomatik test paketi, geçmiş veri üzerinde strateji değerlendirme motoru veya CI iş akışı bulunmuyor. Mevcut düzeltmeler statik olarak incelendi. Bot, sözdizimi kontrolleri, testler ve performans deneyleri çalıştırılmadı. Telegram'a bağlanılmadı ve strateji performansı doğrulanmadı.

Mevcut sınırlar arasında yeniden başlatmada sıfırlanan bellek durumu, bağlantı kesintisinde kaçırılan mumların tamamlanmaması ve kalıcı işlem defterinin bulunmaması var. Benzetilen sermaye hesabı bağımsız olarak uzlaştırılmış değil. Bildirimleri ve gösterilen performans yüzdesini değerlendirirken bunları dikkate al.

## Repo haritası

| Yol | Amaç |
| --- | --- |
| [`index.js`](index.js) | Varsayılan mum işleme, strateji ve benzetilen bakiye |
| [`notify.js`](notify.js) | Ortam değişkenleriyle yapılandırılan Telegram gönderimi |
| [`BEST.js`](BEST.js) | Alternatif strateji uygulaması |
| [`chatid.js`](chatid.js) | Ortam değişkeni kullanan bağımsız sohbet bulma aracı |
| [`package.json`](package.json) | Başlangıç komutu ve bağımlılıklar |
| [`package-lock.json`](package-lock.json) | Kilitli bağımlılık ağacı |

Repoda izlenen bir `node_modules` ağacı da bulunur. Bunu taşınabilir ortam saymak yerine yerel kurulum için manifestleri ve `npm ci` komutunu kullan.

## Katkıda bulunma

Sorun bildirirken Node.js sürümünü, ilgili betiği, beklenen davranışı ve hassas bilgilerden arındırılmış tekrar adımlarını ekle. Sinyal değişiklikleri için kapanmış mum örneklerini ve beklenen durum geçişini belirt. Token ve sohbet kimliklerini raporlara veya commit'lere koyma. Çoklu parite, tekrarlanabilir geçmiş veri değerlendirmesi veya panel önerilerinde kapsamı ve doğrulama yaklaşımını açıkla.

## Lisans ve katkılar

Proje düzeyinde lisans dosyası bulunmuyor. Bu dokümantasyon yeni bir lisans atamaz. Bağımlılıklar kendi lisanslarına tabidir. Herkese açık piyasa verilerini Binance, bildirim iletimini Telegram, gösterge hesaplarını `technicalindicators` sağlar. Resmî bağlantı veya destek iddia edilmez.
