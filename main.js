class AudioEngine {
  constructor() {
    this.audioContext = null;   // Web Audio API AudioContext
    this.analyser = null;       // AnalyserNode untuk analisa frekuensi
    this.source = null;         // MediaElementAudioSourceNode dari audioElement
    this.dataArray = null;      // Uint8Array penyimpan frequency data
    this.audioElement = null;   // HTMLAudioElement sumber suara
  }

  // Siapkan audioElement saja. AudioContext sengaja TIDAK dibuat di sini
  // agar mematuhi autoplay policy — dibuat lazily setelah user gesture.
  init() {
    this.audioElement = new Audio();
    this.audioElement.crossOrigin = 'anonymous';

    // Buffer kosong sebagai fallback sebelum analyser dibuat.
    this.dataArray = new Uint8Array(128);
  }

  // Buat AudioContext + graph audio sekali, dipanggil saat play() pertama
  // (sudah dalam konteks gesture user), memenuhi browser autoplay policy.
  ensureAudioGraph() {
    if (this.audioContext) return;

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;

    // Buffer sesuai jumlah frequency bin (fftSize / 2).
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    // Hubungkan source -> analyser -> destination (speaker).
    this.source = this.audioContext.createMediaElementSource(this.audioElement);
    this.source.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
  }

  // Muat audio dari File object hasil upload via object URL.
  loadFromFile(file) {
    const objectUrl = URL.createObjectURL(file);
    this.audioElement.src = objectUrl;
    this.audioElement.load();
  }

  // Muat audio dari string URL track default.
  loadFromUrl(url) {
    this.audioElement.src = url;
    this.audioElement.load();
  }

  // Buat graph (jika perlu), resume context bila suspended, lalu mainkan.
  play() {
    this.ensureAudioGraph();
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    return this.audioElement.play();
  }

  // Hentikan sementara pemutaran audio.
  pause() {
    this.audioElement.pause();
  }

  // Ambil rata-rata energi bass (bin 0–10), dinormalisasi ke 0.0–1.0.
  getBassLevel() {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.dataArray);

    let sum = 0;
    const start = 0;
    const end = 10;
    for (let i = start; i <= end; i++) {
      sum += this.dataArray[i];
    }

    const average = sum / (end - start + 1);
    return average / 255;
  }

  // Kembalikan seluruh frequency data terkini untuk visualizer.
  getFullSpectrum() {
    if (this.analyser) this.analyser.getByteFrequencyData(this.dataArray);
    return this.dataArray;
  }
}

class ChartEngine {
  constructor() {
    this.canvas = null;            // referensi canvas element
    this.ctx = null;               // context 2D
    this.currentPrice = 18000;     // harga simulasi saat ini
    this.basePrice = 18000;        // harga awal simulasi Rupiah
    this.smoothedData = null;      // data spektrum ter-smooth (diisi di draw)
    this.previousPrice = 18000;    // harga acuan (bergerak lambat) untuk warna
    this.colorChangeThreshold = 200; // selisih minimum agar warna berganti
    this.lastIsUp = true;          // arah warna terakhir (tahan saat delta kecil)

    // State untuk hover tooltip.
    this.mouseX = -1;              // posisi X mouse di canvas (-1 = di luar)
    this.mouseY = -1;
    this.lastPoints = [];          // koordinat titik frame terakhir [{x, y}, ...]
    this.lastPrices = [];          // harga per titik frame terakhir
    this.lastLineColor = '#34a853';
  }

  // Simpan canvas/ctx, set ukuran buffer, pasang mouse listener, dan observasi resize.
  init(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    const resize = () => {
      this.canvas.width = this.canvas.offsetWidth;
      this.canvas.height = this.canvas.offsetHeight;
    };
    resize();

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(resize);
      ro.observe(this.canvas);
    } else {
      window.addEventListener('resize', resize);
    }

    // Track posisi mouse untuk tooltip.
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      // Redraw frame terakhir saat paused agar tooltip tetap muncul.
      if (!app.isPlaying) this.redrawStatic();
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.mouseX = -1;
      this.mouseY = -1;
      if (!app.isPlaying) this.redrawStatic();
    });
  }

  // Render langsung dari data analyser tiap frame (kurva Bezier, tanpa scrolling).
  draw(frequencyData, bassLevel) {
    const ctx = this.ctx;
    const canvas = this.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Smoothing: campur data baru dengan data sebelumnya agar tidak terlalu goyang.
    if (!this.smoothedData || this.smoothedData.length !== frequencyData.length) {
      this.smoothedData = new Float32Array(frequencyData.length);
    }
    for (let i = 0; i < frequencyData.length; i++) {
      this.smoothedData[i] = this.smoothedData[i] * 0.75 + frequencyData[i] * 0.25;
    }

    // Harga mencerminkan energi bass terkini (range 10.000–25.000).
    const bassAvg = Array.from(this.smoothedData.slice(0, 4))
      .reduce((a, b) => a + b) / 4;
    this.currentPrice = 10000 + (bassAvg / 255) * 15000;

    // Warna berganti hanya saat pergerakan harga cukup signifikan.
    const delta = this.currentPrice - this.previousPrice;
    let isUp;
    if (delta > this.colorChangeThreshold) {
      isUp = true;
    } else if (delta < -this.colorChangeThreshold) {
      isUp = false;
    } else {
      isUp = this.lastIsUp ?? true;
    }
    this.lastIsUp = isUp;

    // previousPrice bergerak lambat agar warna bisa bolak-balik hijau/merah.
    this.previousPrice = this.previousPrice * 0.95 + this.currentPrice * 0.05;

    const lineColor = isUp ? '#ea4335' : '#34a853';
    const gradientTop = isUp ? 'rgba(234,67,53,0.15)' : 'rgba(52,168,83,0.15)';
    this.lastLineColor = lineColor;

    // Hitung koordinat tiap titik dari smoothedData + harga per titik.
    const len = this.smoothedData.length;
    const sliceWidth = canvas.width / (len - 1);
    const points = [];
    const prices = [];
    for (let i = 0; i < len; i++) {
      points.push({
        x: i * sliceWidth,
        y: 12 + (canvas.height - 24) - (this.smoothedData[i] / 255) * (canvas.height - 24)
      });
      prices.push(10000 + (this.smoothedData[i] / 255) * 15000);
    }
    this.lastPoints = points;
    this.lastPrices = prices;

    // Area gradient di bawah garis.
    const gradient = ctx.createLinearGradient(0, 12, 0, canvas.height);
    gradient.addColorStop(0, gradientTop);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.lineTo(0, canvas.height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Garis utama (di atas gradient).
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dot di titik dengan nilai tertinggi (y terkecil).
    const maxPoint = points.reduce((a, b) => (a.y < b.y ? a : b));
    ctx.beginPath();
    ctx.arc(maxPoint.x, maxPoint.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();

    // === Hover tooltip ===
    this.drawTooltip(ctx, canvas, points, prices, lineColor);
  }

  // Gambar ulang frame terakhir dari data tersimpan (untuk tooltip saat paused).
  redrawStatic() {
    if (this.lastPoints.length === 0) return;
    const ctx = this.ctx;
    const canvas = this.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const points = this.lastPoints;
    const prices = this.lastPrices;
    const lineColor = this.lastLineColor;
    const isUp = lineColor === '#ea4335';
    const gradientTop = isUp ? 'rgba(234,67,53,0.15)' : 'rgba(52,168,83,0.15)';

    // Area gradient.
    const gradient = ctx.createLinearGradient(0, 12, 0, canvas.height);
    gradient.addColorStop(0, gradientTop);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.lineTo(0, canvas.height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Garis utama.
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dot tertinggi.
    const maxPoint = points.reduce((a, b) => (a.y < b.y ? a : b));
    ctx.beginPath();
    ctx.arc(maxPoint.x, maxPoint.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();

    // Tooltip.
    this.drawTooltip(ctx, canvas, points, prices, lineColor);
  }

  // Gambar crosshair + tooltip box saat mouse berada di atas canvas.
  drawTooltip(ctx, canvas, points, prices, lineColor) {
    if (this.mouseX < 0 || points.length === 0) return;

    // Cari titik terdekat berdasarkan posisi X mouse.
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].x - this.mouseX);
      if (d < minDist) {
        minDist = d;
        nearest = i;
      }
    }

    const pt = points[nearest];
    const price = prices[nearest];

    // --- Crosshair vertikal ---
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(pt.x, 0);
    ctx.lineTo(pt.x, canvas.height);
    ctx.strokeStyle = '#9aa0a6';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // --- Dot di posisi titik ---
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // --- Tooltip box ---
    const now = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
                     'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const dateStr = now.getDate() + ' ' + months[now.getMonth()] + ' ' + now.getFullYear();
    const timeStr = String(now.getHours()).padStart(2, '0') + ':' +
                    String(now.getMinutes()).padStart(2, '0') + ':' +
                    String(now.getSeconds()).padStart(2, '0');
    const priceStr = 'Rp ' + Math.round(price).toLocaleString('id-ID');
    const trend = price >= this.basePrice ? '▲ Naik' : '▼ Turun';
    const diffFromBase = price - this.basePrice;
    const diffStr = (diffFromBase >= 0 ? '+' : '') +
                    Math.round(diffFromBase).toLocaleString('id-ID');

    // Ukur teks untuk menentukan lebar tooltip.
    ctx.font = 'bold 13px Inter, sans-serif';
    const priceWidth = ctx.measureText(priceStr).width;
    ctx.font = '11px Inter, sans-serif';
    const dateWidth = ctx.measureText(dateStr + '  ' + timeStr).width;
    const trendWidth = ctx.measureText(trend + '  ' + diffStr).width;
    const boxWidth = Math.max(priceWidth, dateWidth, trendWidth) + 24;
    const boxHeight = 62;
    const boxPad = 10;

    // Posisi tooltip: hindari keluar canvas.
    let bx = pt.x + 12;
    if (bx + boxWidth > canvas.width) bx = pt.x - boxWidth - 12;
    let by = pt.y - boxHeight - 8;
    if (by < 0) by = pt.y + 12;

    // Background tooltip (dark rounded rect).
    ctx.fillStyle = 'rgba(32, 33, 36, 0.92)';
    ctx.beginPath();
    const r = 8;
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + boxWidth - r, by);
    ctx.quadraticCurveTo(bx + boxWidth, by, bx + boxWidth, by + r);
    ctx.lineTo(bx + boxWidth, by + boxHeight - r);
    ctx.quadraticCurveTo(bx + boxWidth, by + boxHeight, bx + boxWidth - r, by + boxHeight);
    ctx.lineTo(bx + r, by + boxHeight);
    ctx.quadraticCurveTo(bx, by + boxHeight, bx, by + boxHeight - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fill();

    // Border tipis.
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Teks harga (baris 1).
    ctx.fillStyle = lineColor;
    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.fillText(priceStr, bx + boxPad + 2, by + 20);

    // Teks tanggal & waktu (baris 2).
    ctx.fillStyle = '#9aa0a6';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText(dateStr + '  ' + timeStr, bx + boxPad + 2, by + 36);

    // Teks trend & selisih (baris 3).
    ctx.fillStyle = price >= this.basePrice ? '#ea4335' : '#34a853';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText(trend + '  ' + diffStr, bx + boxPad + 2, by + 52);

    ctx.restore();
  }

  // Kembalikan harga simulasi terkini.
  getCurrentPrice() {
    return this.currentPrice;
  }
}

// Samakan resolusi buffer canvas dengan ukuran tampilannya (panggil saat resize).
function resizeCanvas(canvas) {
  if (!canvas) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

// Gambar spectrum frekuensi sebagai bar chart vertikal ber-gradient + glow.
function drawSpectrum(canvasId, spectrumData) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');

  const width = canvas.width;
  const height = canvas.height;

  // Bersihkan frame sebelumnya.
  ctx.clearRect(0, 0, width, height);

  // Gradient vertikal: merah neon di bawah, hijau neon di atas.
  const gradient = ctx.createLinearGradient(0, height, 0, 0);
  gradient.addColorStop(0, '#ff003c');
  gradient.addColorStop(1, '#00ff88');
  ctx.fillStyle = gradient;

  // Efek glow.
  ctx.shadowBlur = 12;
  ctx.shadowColor = '#00ff88';

  // Lebar bar menyesuaikan lebar canvas dibagi jumlah data.
  const barWidth = width / spectrumData.length;

  for (let i = 0; i < spectrumData.length; i++) {
    // Skala nilai 0–255 ke tinggi canvas.
    const barHeight = (spectrumData[i] / 255) * height;
    const x = i * barWidth;
    const y = height - barHeight;
    ctx.fillRect(x, y, barWidth - 1, barHeight);
  }

  // Reset shadow agar tidak mempengaruhi gambar berikutnya.
  ctx.shadowBlur = 0;
}

// Format harga ke "Rp XX.XXX", perbarui #ticker & equals-label, beri kilatan naik/turun.
// ratePerUsd = harga per 1 USD, usdAmount = jumlah USD dari input user.
function updateTicker(ratePerUsd, usdAmount) {
  const ticker = document.getElementById('ticker');
  const equalsLabel = document.querySelector('.equals-label');

  // Harga total = rate × jumlah USD yang dimasukkan user.
  const totalPrice = ratePerUsd * usdAmount;

  // Format ribuan dengan pemisah titik ala Rupiah.
  const formatted = 'Rp ' + Math.round(totalPrice).toLocaleString('id-ID');
  ticker.innerHTML = formatted;

  // Update label "X United States Dollar equals".
  if (equalsLabel) {
    const label = usdAmount === 1
      ? '1 United States Dollar equals'
      : usdAmount + ' United States Dollar equals';
    equalsLabel.textContent = label;
  }

  // Bandingkan dengan harga terakhir (disimpan pada properti fungsi).
  const previous = updateTicker.lastPrice;
  if (previous !== undefined && totalPrice !== previous) {
    const flashClass = totalPrice > previous ? 'flash-up' : 'flash-down';
    ticker.classList.add(flashClass);

    // Hapus kelas kilatan setelah 300ms.
    setTimeout(() => ticker.classList.remove(flashClass), 300);
  }

  updateTicker.lastPrice = totalPrice;
}

const app = {
  audioEngine: null,        // instance AudioEngine
  chartEngine: null,        // instance ChartEngine
  isPlaying: false,         // status pemutaran
  animationId: null,        // handle requestAnimationFrame
  isLoading: false,         // status buffering audio
  sensitivityEl: null,      // referensi <input id="sensitivity">
  btnPlay: null,            // referensi tombol play/pause

  // Daftar track default (file lokal).
  defaultTracks: [
    { name: 'Musik', url: 'music1.mp3' },
    { name: 'Musik', url: 'music2.mp3' }
  ],

  // Inisialisasi engine, isi dropdown, dan pasang semua event listener.
  init() {
    this.audioEngine = new AudioEngine();
    this.audioEngine.init();

    this.chartEngine = new ChartEngine();
    this.chartEngine.init('rupiah-chart');

    this.sensitivityEl = document.getElementById('sensitivity');

    // Ukur canvas spectrum awal + observasi perubahan ukuran container.
    const spectrumCanvas = document.getElementById('spectrum');
    resizeCanvas(spectrumCanvas);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => resizeCanvas(spectrumCanvas));
      ro.observe(spectrumCanvas);
    } else {
      // Fallback untuk browser tanpa ResizeObserver.
      window.addEventListener('resize', () => resizeCanvas(spectrumCanvas));
    }

    // Isi dropdown #track-selector dengan track default.
    const selector = document.getElementById('track-selector');
    this.defaultTracks.forEach((track) => {
      const option = document.createElement('option');
      option.value = track.url;
      option.textContent = track.name;
      selector.appendChild(option);
    });

    // Muat track default pertama secara otomatis.
    if (this.defaultTracks.length > 0) {
      const firstTrack = this.defaultTracks[0];
      selector.value = firstTrack.url;
      this.audioEngine.loadFromUrl(firstTrack.url);
    }

    // Tombol Play/Pause: toggle status + perbarui label tombol.
    const btnPlay = document.getElementById('btn-play');
    this.btnPlay = btnPlay;
    btnPlay.addEventListener('click', () => {
      if (this.isPlaying) {
        this.stop();
        this.isPlaying = false;
        this.updatePlayLabel();
      } else {
        this.start();
        this.isPlaying = true;
        this.updatePlayLabel();
      }
    });

    // === Progress bar & durasi ===
    const audio = this.audioEngine.audioElement;
    const progressSlider = document.getElementById('progress');
    const durationLabel = document.querySelector('.duration');

    // Format detik ke m:ss.
    const formatTime = (sec) => {
      if (!isFinite(sec)) return '0:00';
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return m + ':' + String(s).padStart(2, '0');
    };

    // Update progress slider & label durasi tiap detik.
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration) return;
      const pct = (audio.currentTime / audio.duration) * 100;
      progressSlider.value = pct;
      durationLabel.textContent =
        formatTime(audio.currentTime) + ' / ' + formatTime(audio.duration);
    });

    // Seek audio saat user menggeser progress slider.
    progressSlider.addEventListener('input', () => {
      if (!audio.duration) return;
      audio.currentTime = (progressSlider.value / 100) * audio.duration;
    });

    // Tampilkan durasi total begitu metadata tersedia.
    audio.addEventListener('loadedmetadata', () => {
      durationLabel.textContent = '0:00 / ' + formatTime(audio.duration);
    });

    // Reset saat track habis.
    audio.addEventListener('ended', () => {
      this.isPlaying = false;
      this.updatePlayLabel();
      cancelAnimationFrame(this.animationId);
      progressSlider.value = 0;
    });

    // Loading state: tampilkan "⏳" saat audio sedang buffering.
    const setLoading = (state) => {
      this.isLoading = state;
      this.updatePlayLabel();
    };
    audio.addEventListener('waiting', () => setLoading(true));
    audio.addEventListener('canplay', () => setLoading(false));
    audio.addEventListener('playing', () => setLoading(false));
    audio.addEventListener('error', () => setLoading(false));

    // Pilih track default dari dropdown.
    selector.addEventListener('change', (e) => {
      if (e.target.value) {
        this.audioEngine.loadFromUrl(e.target.value);
        // Reset progress & stop jika sedang bermain.
        if (this.isPlaying) {
          this.stop();
          this.isPlaying = false;
          this.updatePlayLabel();
        }
        progressSlider.value = 0;
        durationLabel.textContent = '0:00';
      }
    });

    // Tombol upload memicu input file tersembunyi.
    const btnUpload = document.getElementById('btn-upload');
    const audioUpload = document.getElementById('audio-upload');
    btnUpload.addEventListener('click', () => audioUpload.click());

    // Muat file audio hasil upload.
    audioUpload.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.audioEngine.loadFromFile(file);
        if (this.isPlaying) {
          this.stop();
          this.isPlaying = false;
          this.updatePlayLabel();
        }
        progressSlider.value = 0;
        durationLabel.textContent = '0:00';
      }
    });
  },

  // Perbarui label tombol play sesuai status loading/playing.
  updatePlayLabel() {
    if (this.isLoading) {
      this.btnPlay.textContent = '⏳';
    } else {
      this.btnPlay.textContent = this.isPlaying ? '⏸' : '▶';
    }
  },

  // Loop animasi: audio -> chart -> spectrum -> ticker.
  loop() {
    // Terapkan sensitivity slider sebagai multiplier pada level bass.
    const sensitivity = parseFloat(this.sensitivityEl.value) || 1;
    const bassLevel = this.audioEngine.getBassLevel() * sensitivity;

    const spectrumData = this.audioEngine.getFullSpectrum();
    this.chartEngine.draw(spectrumData, bassLevel);
    drawSpectrum('spectrum', spectrumData);

    // Ambil jumlah USD dari input user untuk mengalikan harga di ticker.
    const usdInput = document.getElementById('input-usd');
    const usdAmount = parseFloat(usdInput?.value) || 1;
    updateTicker(this.chartEngine.getCurrentPrice(), usdAmount);

    this.animationId = requestAnimationFrame(() => this.loop());
  },

  // Mulai pemutaran audio dan render loop.
  start() {
    this.audioEngine.play();
    this.loop();
  },

  // Hentikan audio dan batalkan render loop.
  stop() {
    this.audioEngine.pause();
    cancelAnimationFrame(this.animationId);
  }
};

// Inisialisasi aplikasi setelah DOM siap.
document.addEventListener('DOMContentLoaded', () => app.init());

// ===== Konversi mata uang IDR <-> USD =====
let lastEdited = 'usd';        // field terakhir diedit user
let lastSyncedRate = null;     // rate terakhir yang sudah disinkronkan ke input

// Hitung ulang nilai konversi berdasarkan currentPrice (Rp per 1 USD).
function updateConversion(changedField) {
  const inputIdr = document.getElementById('input-idr');
  const inputUsd = document.getElementById('input-usd');
  if (!inputIdr || !inputUsd || !app.chartEngine) return;

  const currentRate = app.chartEngine.getCurrentPrice(); // Rp per 1 USD

  if (changedField === 'idr') {
    // Hapus karakter non-angka (mis. titik ribuan) sebelum parse.
    const idrValue = parseInt(inputIdr.value.replace(/[^\d]/g, ''), 10) || 0;
    const usdValue = idrValue / currentRate;
    inputUsd.value = usdValue.toFixed(6);
  } else if (changedField === 'usd') {
    const usdValue = parseFloat(inputUsd.value) || 0;
    const idrValue = usdValue * currentRate;
    inputIdr.value = Math.round(idrValue).toLocaleString('id-ID');
  }
}

// Refresh nilai konversi tiap kali harga grafik berubah.
function syncConversionToChart() {
  if (!app.chartEngine) return;
  const rate = app.chartEngine.getCurrentPrice();
  if (rate === lastSyncedRate) return; // hanya bertindak saat harga berubah
  lastSyncedRate = rate;
  updateConversion(lastEdited);        // refresh field selain yang terakhir diedit
}

// Tukar posisi visual row-idr dan row-usd (label ikut row masing-masing).
function swapConversionRows() {
  const converter = document.getElementById('converter');
  const rowIdr = document.getElementById('row-idr');
  const rowUsd = document.getElementById('row-usd');
  const btnSwap = document.getElementById('btn-swap');

  // Tentukan apakah IDR saat ini berada di atas USD.
  const idrAboveUsd =
    rowIdr.compareDocumentPosition(rowUsd) & Node.DOCUMENT_POSITION_FOLLOWING;

  if (idrAboveUsd) {
    converter.insertBefore(rowUsd, btnSwap); // USD ke atas
    converter.appendChild(rowIdr);           // IDR ke bawah
  } else {
    converter.insertBefore(rowIdr, btnSwap); // IDR ke atas
    converter.appendChild(rowUsd);           // USD ke bawah
  }
}

// Pasang listener konversi & nilai default setelah DOM siap (app sudah init).
document.addEventListener('DOMContentLoaded', () => {
  const inputIdr = document.getElementById('input-idr');
  const inputUsd = document.getElementById('input-usd');
  const btnSwap = document.getElementById('btn-swap');

  inputIdr.addEventListener('input', () => {
    lastEdited = 'idr';
    updateConversion('idr');
  });
  inputUsd.addEventListener('input', () => {
    lastEdited = 'usd';
    updateConversion('usd');
  });
  btnSwap.addEventListener('click', swapConversionRows);

  // Nilai default: 1 USD, isi input IDR otomatis.
  inputUsd.value = '1';
  lastEdited = 'usd';
  updateConversion('usd');

  // Polling ringan: angka konversi ikut bergerak seiring grafik.
  setInterval(syncConversionToChart, 200);
});
