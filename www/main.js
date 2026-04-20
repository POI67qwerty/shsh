// ============================================================
// 状態
// ============================================================
let srcImage = null;
let srcFileName = 'image';   // 読み込んだ画像のベースファイル名（拡張子なし）
let currentMode = 'adaptive';
let invert = false;
let currentTab = 'lineart';
let fillHistory = [];          // UNDO用スタック（全塗りモード共通）
let fillRedo = [];          // REDO用スタック（Shift+Ctrl/Cmd+Z）
let dustHistoryResult = [];   // UNDO用（ゴミトリ: 結果線画）
let dustRedoResult = [];      // REDO用（ゴミトリ: 結果線画）
let paintColor = '#e8405a';   // 囲って塗る用
let bucketColor = '#e8405a';   // バケツ用
let autoPaletteColors = ['#e8405a', '#4a9eff', '#44cc77', '#ffcc00', '#cc77ff', '#ff8833', '#7cc8ff', '#ff99cc'];

// キャンバス
const canvasOrig = document.getElementById('canvasOrig');
const canvasResult = document.getElementById('canvasResult');
const canvasMerge = document.getElementById('canvasMerge');  // 塗り＋線画の合成表示用
const canvasFill = document.getElementById('canvasFill');
const canvasFillView = document.getElementById('canvasFillView');
const canvasLasso = document.getElementById('canvasLasso');
const canvasWrap = document.getElementById('canvasWrap');
const ctxOrig = canvasOrig.getContext('2d');
const ctxResult = canvasResult.getContext('2d');
const ctxMerge = canvasMerge.getContext('2d');
const ctxFill = canvasFill.getContext('2d');
const ctxFillView = canvasFillView.getContext('2d');
const ctxLasso = canvasLasso.getContext('2d');
const offscreen = document.createElement('canvas');
const ctxOff = offscreen.getContext('2d');

// UI
const statusEl = document.getElementById('status');
const fileInput = document.getElementById('fileInput');
const uploadZone = document.getElementById('uploadZone');
const btnDownload = document.getElementById('btnDownload');
const invertBtn = document.getElementById('invertBtn');
const sliderThreshold = document.getElementById('threshold');
const sliderBlur = document.getElementById('blur');
const sliderEdgeStr = document.getElementById('edgeStr');
const sliderAdaptBlock = document.getElementById('adaptBlock');
const sliderAdaptC = document.getElementById('adaptC');
const sliderThinNoise = document.getElementById('thinNoise');
const sliderLineWidth = document.getElementById('lineWidth');   // 拡縮値（1〜20px）
const sliderScanBg = document.getElementById('scanBg');
const sliderScanContrast = document.getElementById('scanContrast');
const sliderScanThin = document.getElementById('scanThin');
const sliderBlacks = document.getElementById('blacks');
const sliderShadows = document.getElementById('shadows');
const sliderHighlights = document.getElementById('highlights');

const sliderDustSize = document.getElementById('dustSize');
const sliderDustThin = document.getElementById('dustThin');
const btnDownloadMerge = document.getElementById('btnDownloadMerge');
const btnFillExpandToggle = document.getElementById('btnFillExpandToggle');
const sliderGapClose = document.getElementById('gapClose');
const sliderFillAlpha = document.getElementById('fillAlpha');
const sliderBucketGap = document.getElementById('bucketGap');
const sliderBucketAlpha = document.getElementById('bucketAlpha');
const sliderAutoGap = document.getElementById('autoGap');
const sliderAutoMin = document.getElementById('autoMin');
const sliderAutoAlpha = document.getElementById('autoAlpha');
const sliderFillHoles = document.getElementById('fillHoles');

// ============================================================
// 自動塗り分けパレットUI初期化
// ============================================================
function renderAutoPalette() {
  const el = document.getElementById('autoPalette');
  el.innerHTML = '';
  autoPaletteColors.forEach((c, idx) => {
    const sw = document.createElement('div');
    sw.className = 'auto-swatch';
    sw.style.background = c;
    sw.title = c;
    const del = document.createElement('div');
    del.className = 'del'; del.textContent = '×';
    del.addEventListener('click', e => { e.stopPropagation(); autoPaletteColors.splice(idx, 1); renderAutoPalette(); });
    sw.appendChild(del);
    el.appendChild(sw);
  });
}
renderAutoPalette();

document.getElementById('btnAutoAddColor').addEventListener('click', () => {
  const c = document.getElementById('autoAddColor').value;
  if (!autoPaletteColors.includes(c)) autoPaletteColors.push(c);
  renderAutoPalette();
});

// ============================================================
// タブ切替
// ============================================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    // ゴミトリ中にPANがONだとラッソできないため、タブ切替時は一旦OFFにする
    if (currentTab === 'dust' && _panMode) {
      _panMode = false;
      if (btnPanToggle) {
        btnPanToggle.style.borderColor = 'var(--border)';
        btnPanToggle.style.color = 'var(--text-dim)';
        btnPanToggle.textContent = '✋ PAN';
      }
    }
    const tabMap = { lineart: 'tabLineart', paint: 'tabPaint', bucket: 'tabBucket', auto: 'tabAuto', dust: 'tabDust' };
    document.getElementById(tabMap[currentTab]).classList.add('active');
    updateInteractMode();
  });
});

// タブに応じてcanvasLassoのカーソル・表示を切替
function updateInteractMode() {
  if (!srcImage) return;
  const showOverlay = (currentTab !== 'lineart');
  canvasFill.style.display = showOverlay ? 'block' : 'none';
  canvasLasso.style.display = showOverlay ? 'block' : 'none';
  if (canvasWrap) canvasWrap.style.overflow = 'hidden';
  const labels = { lineart: '変換結果', paint: '囲って塗る', bucket: 'バケツ塗り', auto: '自動塗り分け', dust: 'ゴミトリ' };
  document.getElementById('resultLabel').textContent = labels[currentTab] || '変換結果';
  updateCanvasCursor();
}

// ============================================================
// カラーパレット（囲って塗る / バケツ）
// ============================================================
function setupColorRow(rowId, customId, onPick) {
  document.getElementById(rowId).addEventListener('click', e => {
    const sw = e.target.closest('.color-swatch');
    if (!sw) return;
    document.querySelectorAll(`#${rowId} .color-swatch`).forEach(s => s.classList.remove('selected'));
    sw.classList.add('selected');
    onPick(sw.dataset.color);
    document.getElementById(customId).value = sw.dataset.color;
  });
  document.getElementById(customId).addEventListener('input', e => {
    onPick(e.target.value);
    document.querySelectorAll(`#${rowId} .color-swatch`).forEach(s => s.classList.remove('selected'));
  });
}
setupColorRow('colorRowPaint', 'colorCustomPaint', c => paintColor = c);
setupColorRow('colorRowBucket', 'colorCustomBucket', c => bucketColor = c);

// スライダーUI：[スライダー変数, 表示値ID, 変換関数or null, 変換後scheduleProcessするか]
[
  [sliderThreshold, 'valThreshold', null, true],
  [sliderBlur, 'valBlur', null, true],
  [sliderEdgeStr, 'valEdgeStr', null, true],
  [sliderAdaptBlock, 'valAdaptBlock', null, true],
  [sliderAdaptC, 'valAdaptC', null, true],
  [sliderThinNoise, 'valThinNoise', null, true],
  [sliderLineWidth, 'valLineWidth', v => parseInt(v), true],
  [sliderScanBg, 'valScanBg', null, true],
  [sliderScanContrast, 'valScanContrast', v => (parseInt(v) / 10).toFixed(1), true],
  [sliderScanThin, 'valScanThin', v => v === '1' ? 'ON' : 'OFF', true],
  [sliderBlacks, 'valBlacks', null, true],
  [sliderShadows, 'valShadows', null, true],
  [sliderHighlights, 'valHighlights', null, true],
  [sliderGapClose, 'valGapClose', null, false],
  [sliderFillAlpha, 'valFillAlpha', null, false],
  [sliderBucketGap, 'valBucketGap', null, false],
  [sliderBucketAlpha, 'valBucketAlpha', null, false],
  [sliderAutoGap, 'valAutoGap', null, false],
  [sliderAutoMin, 'valAutoMin', null, false],
  [sliderAutoAlpha, 'valAutoAlpha', null, false],
  [sliderFillHoles, 'valFillHoles', v => v === '1' ? 'ON' : 'OFF', false],
  [sliderDustSize, 'valDustSize', null, false],
  [sliderDustThin, 'valDustThin', null, false],
].forEach(([sl, valId, fmt, doProc]) => {
  sl.addEventListener('input', () => {
    document.getElementById(valId).textContent = fmt ? fmt(sl.value) : sl.value;
    if (doProc) scheduleProcess();
  });
});

// モードボタン
document.getElementById('modeRow').addEventListener('click', e => {
  const btn = e.target.closest('.mode-btn');
  if (!btn) return;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentMode = btn.dataset.mode;
  updateSliderVisibility();
  scheduleProcess();
});
function updateSliderVisibility() {
  // 各モードで有効なスライダーをハイライト
  const isEdge = currentMode === 'edge';
  const isThresh = currentMode === 'threshold' || currentMode === 'both';
  const isAdaptive = currentMode === 'adaptive';
  const isThinning = currentMode === 'thinning';
  const isScan = currentMode === 'scan';

  document.getElementById('rowThreshold').style.opacity = isThresh ? '1' : '0.3';
  document.getElementById('rowEdgeStr').style.opacity = (isEdge || currentMode === 'both') ? '1' : '0.3';
  document.getElementById('rowAdaptiveBlock').style.opacity = (isAdaptive || isThinning) ? '1' : '0.3';
  document.getElementById('rowAdaptC').style.opacity = (isAdaptive || isThinning) ? '1' : '0.3';
  document.getElementById('rowThinNoise').style.opacity = (isThinning || isAdaptive || isScan) ? '1' : '0.3';
  document.getElementById('rowScanBg').style.opacity = isScan ? '1' : '0.3';
  document.getElementById('rowScanContrast').style.opacity = isScan ? '1' : '0.3';
  document.getElementById('rowScanThin').style.opacity = isScan ? '1' : '0.3';
}
updateSliderVisibility();

// 線幅修正モードのセレクト変更でも再処理
document.getElementById('lineWidthMode').addEventListener('change', scheduleProcess);
invertBtn.addEventListener('click', () => {
  invert = !invert;
  invertBtn.textContent = invert ? 'ON' : 'OFF';
  invertBtn.style.borderColor = invert ? 'var(--accent)' : 'var(--accent2)';
  invertBtn.style.color = invert ? 'var(--accent)' : 'var(--accent2)';
  scheduleProcess();
});

// ============================================================
// ファイル読み込み
// ============================================================
uploadZone.addEventListener('click', e => {
  if (e.target === fileInput) return;
  e.preventDefault();
  fileInput.click();
});
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => { e.preventDefault(); uploadZone.classList.remove('drag-over'); loadFile(e.dataTransfer.files[0]); });
// change: files[0] が取れない場合もフォールバック
fileInput.addEventListener('change', function () {
  const f = this.files && this.files[0];
  if (f) loadFile(f);
});

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) { setStatus('画像ファイルを選んでにょ🐮', 'err'); return; }
  // 拡張子なしのファイル名を保存
  srcFileName = file.name.replace(/\.[^.]+$/, '') || 'image';
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      srcImage = img;
      canvasOrig.width = img.width; canvasOrig.height = img.height;
      ctxOrig.drawImage(img, 0, 0);
      document.getElementById('placeholderOrig').style.display = 'none';
      canvasOrig.style.display = 'block';
      // 塗りcanvas初期化
      canvasFill.width = img.width; canvasFill.height = img.height;
      canvasLasso.width = img.width; canvasLasso.height = img.height;
      ctxFill.clearRect(0, 0, img.width, img.height);
      fillHistory = []; fillRedo = [];
      setStatus(`読み込み完了: ${img.width}×${img.height}px にょ🐮✋`, 'ok');
      autoOptimizeSettings(img);   // 画像解析→スライダー自動最適化
      scheduleProcess();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ============================================================
// 画像解析→スライダー自動最適化
// 読み込み時に1回だけ実行してスライダーを「いい感じ」に設定
// ============================================================
function autoOptimizeSettings(img) {
  // 解析用に縮小コピーを作る（速度優先）
  const MAX = 400;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tc = tmp.getContext('2d');
  tc.drawImage(img, 0, 0, w, h);
  const d = tc.getImageData(0, 0, w, h).data;

  // グレー値ヒストグラムを作る
  const hist = new Uint32Array(256);
  for (let i = 0; i < w * h; i++) {
    const g = Math.round(d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114);
    hist[g]++;
  }
  const total = w * h;

  // ---- 解析1: 平均輝度・コントラスト（標準偏差）----
  let sum = 0, sum2 = 0;
  for (let v = 0; v < 256; v++) { sum += v * hist[v]; sum2 += v * v * hist[v]; }
  const mean = sum / total;
  const variance = sum2 / total - mean * mean;
  const std = Math.sqrt(Math.max(0, variance));

  // ---- 解析2: 暗い画素の割合（黒線の密度推定）----
  let darkCount = 0;
  for (let v = 0; v < 100; v++) darkCount += hist[v];
  const darkRatio = darkCount / total;  // 0〜1（大きいほど線が多い）

  // ---- 解析3: 画像サイズ（大きい画像は大きいブロックサイズが必要）----
  const longSide = Math.max(img.width, img.height);

  // ============================================================
  // スライダー自動設定
  // ============================================================

  // 適応ブロックサイズ: 画像サイズに比例（小画像=小さいブロック、大画像=大きいブロック）
  // 基準: 500px→9, 1000px→15, 2000px→25, 4000px→41 (奇数)
  let blockSize = Math.round(longSide / 70);
  if (blockSize < 3) blockSize = 3;
  if (blockSize > 51) blockSize = 51;
  if (blockSize % 2 === 0) blockSize++;  // 奇数に
  sliderAdaptBlock.value = blockSize;
  document.getElementById('valAdaptBlock').textContent = blockSize;

  // 適応バイアス(C): コントラストが低い→Cを下げる、高い→Cを上げる
  // std小(ぼやけた画像)→C=4, std大(くっきり)→C=12
  let adaptC = Math.round(4 + (std / 80) * 8);
  adaptC = Math.max(-5, Math.min(25, adaptC));
  sliderAdaptC.value = adaptC;
  document.getElementById('valAdaptC').textContent = adaptC;

  // ノイズ除去: 線が細くて密な画像（darkRatio小）→ノイズ少=0, 荒い→1〜2
  let noiseRemove = darkRatio < 0.02 ? 1 : darkRatio < 0.05 ? 0 : 0;
  sliderThinNoise.value = noiseRemove;
  document.getElementById('valThinNoise').textContent = noiseRemove;

  // しきい値: 平均輝度に基づいて設定（暗い画像→低め、明るい画像→高め）
  let thr = Math.round(mean * 0.85 + 20);
  thr = Math.max(60, Math.min(200, thr));
  sliderThreshold.value = thr;
  document.getElementById('valThreshold').textContent = thr;

  // ぼかし: コントラストが低い→1, 高い→0（既にくっきりならぼかし不要）
  const blur = std < 30 ? 1 : 0;
  sliderBlur.value = blur;
  document.getElementById('valBlur').textContent = blur;

  // ライン幅: デフォルト1.0px（10）のまま
  sliderLineWidth.value = 1;
  document.getElementById('valLineWidth').textContent = '1';
  document.getElementById('lineWidthMode').value = 'none';

  setStatus(`読み込み完了: ${img.width}×${img.height}px　自動最適化済み にょ🐮✋`, 'ok');
}

// ============================================================
// 線画変換（デバウンス付きリアルタイム）
// ============================================================
let processTimer = null;
function scheduleProcess() {
  if (!srcImage) return;
  clearTimeout(processTimer);
  setStatus('処理中…', '');
  processTimer = setTimeout(() => {
    requestAnimationFrame(() => {
      try {
        processImage();
        setStatus('リアルタイム変換 にょ🐮✋', 'ok');
        btnDownload.disabled = false; btnDownloadMerge.disabled = false;
        document.getElementById('btnCopyLine').disabled = false;
        document.getElementById('btnCopyMerge').disabled = false;
        document.getElementById('btnDownloadLineAlpha').disabled = false;
        document.getElementById('btnDownloadFillAlpha').disabled = false;
        document.getElementById('btnCopyLineAlpha').disabled = false;
        document.getElementById('btnCopyFillAlpha').disabled = false;
        updateInteractMode();
      } catch (e) { setStatus('エラー: ' + e.message, 'err'); }
    });
  }, 150);
}

function processImage() {
  const W = srcImage.width, H = srcImage.height;
  // ゴミトリ履歴は再生成でリセット
  dustHistoryResult = [];
  dustRedoResult = [];

  offscreen.width = W; offscreen.height = H;
  ctxOff.drawImage(srcImage, 0, 0);
  const data = ctxOff.getImageData(0, 0, W, H).data;

  // ブラックポイント・シャドウ・ハイライトのLUT
  const blacks = parseFloat(sliderBlacks.value);
  const shadows = parseFloat(sliderShadows.value);
  const highlights = parseFloat(sliderHighlights.value);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let val = v;
    // ブラックポイント：暗部の底を持ち上げる
    val = val * (255 - blacks) / 255 + blacks;
    // シャドウ：暗部（〜128）を補正、明部ほど影響小
    if (shadows !== 0) { const t = 1 - Math.min(val / 128, 1); val += shadows * t; }
    // ハイライト：明部（128〜）を補正、暗部ほど影響小
    if (highlights !== 0) { const t = Math.max((val - 128) / 128, 0); val += highlights * t; }
    lut[v] = Math.max(0, Math.min(255, Math.round(val)));
  }
  const applyLUT = (blacks !== 0 || shadows !== 0 || highlights !== 0);

  // グレースケール化
  const gray = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = applyLUT ? lut[data[i * 4]] : data[i * 4];
    const g = applyLUT ? lut[data[i * 4 + 1]] : data[i * 4 + 1];
    const b = applyLUT ? lut[data[i * 4 + 2]] : data[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  const blurR = parseInt(sliderBlur.value);
  const grayB = blurR > 0 ? boxBlur(gray, W, H, blurR) : gray;
  const out = new Uint8ClampedArray(W * H);

  if (currentMode === 'threshold') {
    applyThreshold(grayB, out, W, H);
  } else if (currentMode === 'edge') {
    applyEdge(grayB, out, W, H);
  } else if (currentMode === 'both') {
    const t = new Uint8ClampedArray(W * H), e = new Uint8ClampedArray(W * H);
    applyThreshold(grayB, t, W, H); applyEdge(grayB, e, W, H);
    for (let i = 0; i < W * H; i++) out[i] = e[i] === 0 ? 0 : t[i];
  } else if (currentMode === 'adaptive') {
    applyAdaptiveThreshold(grayB, out, W, H);
    applyLineWidthDilation(out, W, H);
    applyLineThin(out, W, H);
    const nr = parseInt(sliderThinNoise.value);
    if (nr > 0) applyNoiseRemove(out, W, H, nr);
  } else if (currentMode === 'thinning') {
    applyAdaptiveThreshold(grayB, out, W, H);
    zhangSuenThinning(out, W, H);
    applyLineWidthDilation(out, W, H);
    applyLineThin(out, W, H);
    const nr = parseInt(sliderThinNoise.value);
    if (nr > 0) applyNoiseRemove(out, W, H, nr);
  } else if (currentMode === 'scan') {
    applyScanPipeline(gray, out, W, H);
    applyLineWidthDilation(out, W, H);
    applyLineThin(out, W, H);
    const nr = parseInt(sliderThinNoise.value);
    if (nr > 0) applyNoiseRemove(out, W, H, nr);
  }

  if (invert) for (let i = 0; i < W * H; i++) out[i] = 255 - out[i];

  canvasResult.width = W; canvasResult.height = H;
  const od = ctxResult.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { od.data[i * 4] = od.data[i * 4 + 1] = od.data[i * 4 + 2] = out[i]; od.data[i * 4 + 3] = 255; }
  ctxResult.putImageData(od, 0, 0);
  document.getElementById('placeholderResult').style.display = 'none';
  canvasMerge.style.display = 'block';
  canvasMerge.width = W; canvasMerge.height = H;
  // Fill/LassoキャンバスのピクセルサイズをResultと揃える（ズレ防止）
  canvasFill.width = W; canvasFill.height = H;
  canvasFillView.width = W; canvasFillView.height = H;
  canvasLasso.width = W; canvasLasso.height = H;
  // 比較ボタン表示
  document.getElementById('btnCompare').style.display = 'block';
  renderMerge();
}

function applyThreshold(gray, out, W, H) { const thr = parseInt(sliderThreshold.value); for (let i = 0; i < W * H; i++)out[i] = gray[i] >= thr ? 255 : 0; }
function applyEdge(gray, out, W, H) {
  const str = parseInt(sliderEdgeStr.value);
  const thr = 80 * 100 / str;
  for (let y = 1; y < H - 1; y++) {
    const rowU = (y - 1) * W, row = y * W, rowD = (y + 1) * W;
    for (let x = 1; x < W - 1; x++) {
      const gx = -gray[rowU + x - 1] - 2 * gray[row + x - 1] - gray[rowD + x - 1]
        + gray[rowU + x + 1] + 2 * gray[row + x + 1] + gray[rowD + x + 1];
      const gy = -gray[rowU + x - 1] - 2 * gray[rowU + x] - gray[rowU + x + 1]
        + gray[rowD + x - 1] + 2 * gray[rowD + x] + gray[rowD + x + 1];
      // Math.sqrt → |gx|+|gy| で近似（2倍速い）
      out[row + x] = (Math.abs(gx) + Math.abs(gy)) > thr ? 0 : 255;
    }
  }
  for (let x = 0; x < W; x++) { out[x] = 255; out[(H - 1) * W + x] = 255; }
  for (let y = 0; y < H; y++) { out[y * W] = 255; out[y * W + W - 1] = 255; }
  applyLineWidthDilation(out, W, H);
}

// ============================================================
// クリスタ「線幅修正」と同仕様の実装
// mode: 'thicken'=指定幅で太らせる、'thin'=指定幅で細らせる、'none'=変更なし
// r: 拡縮値（1〜20px整数）
// 太らせる → 円形モルフォロジー膨張（黒ピクセルを半径rの円形に拡大）
// 細らせる → 円形モルフォロジー収縮（黒ピクセルの外縁をr回削る）
// ============================================================
function applyLineWidthDilation(out, W, H) {
  const mode = document.getElementById('lineWidthMode').value;
  if (mode !== 'thicken') return;
  const r = parseInt(sliderLineWidth.value); // 1〜20px
  const r2 = r * r;
  const src = out.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (src[y * W + x] === 0) continue; // 既に黒はスキップ
      // 半径r円内に黒ピクセルがあれば黒にする
      let found = false;
      const yMin = Math.max(0, y - r), yMax = Math.min(H - 1, y + r);
      const xMin = Math.max(0, x - r), xMax = Math.min(W - 1, x + r);
      for (let ny = yMin; ny <= yMax && !found; ny++) {
        const dy = ny - y;
        for (let nx = xMin; nx <= xMax && !found; nx++) {
          const dx = nx - x;
          if (dx * dx + dy * dy <= r2 && src[ny * W + nx] === 0) found = true;
        }
      }
      if (found) out[y * W + x] = 0;
    }
  }
}

// 指定幅で細らせる：円形モルフォロジー収縮（クリスタ同仕様）
function applyLineThin(out, W, H) {
  const mode = document.getElementById('lineWidthMode').value;
  if (mode !== 'thin') return;
  const r = parseInt(sliderLineWidth.value); // 1〜20px
  // r回の外縁削除（各イテレーションで4近傍に白があれば白にする）
  for (let t = 0; t < r; t++) {
    const src = out.slice();
    for (let y = 1; y < H - 1; y++) {
      const row = y * W;
      for (let x = 1; x < W - 1; x++) {
        if (src[row + x] !== 0) continue;
        if (src[row + x - W] === 255 || src[row + x + W] === 255 ||
          src[row + x - 1] === 255 || src[row + x + 1] === 255) {
          out[row + x] = 255;
        }
      }
    }
  }
}
// boxBlur：積分テーブル（Summed Area Table）でO(W×H)に高速化
function boxBlur(gray, W, H, r) {
  if (r <= 0) return new Uint8ClampedArray(gray);
  // 横方向：行ごとに積分して移動平均
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    let sum = 0;
    // 最初のr+1個を積み上げ
    for (let x = 0; x <= Math.min(r, W - 1); x++) sum += gray[y * W + x];
    for (let x = 0; x < W; x++) {
      const xr = x + r + 1, xl = x - r;
      if (xr < W) sum += gray[y * W + xr];
      if (xl > 0) sum -= gray[y * W + xl - 1];
      const cnt = Math.min(x + r, W - 1) - Math.max(x - r, 0) + 1;
      tmp[y * W + x] = sum / cnt;
    }
  }
  // 縦方向：列ごとに積分して移動平均
  const out = new Uint8ClampedArray(W * H);
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(r, H - 1); y++) sum += tmp[y * W + x];
    for (let y = 0; y < H; y++) {
      const yr = y + r + 1, yl = y - r;
      if (yr < H) sum += tmp[yr * W + x];
      if (yl > 0) sum -= tmp[(yl - 1) * W + x];
      const cnt = Math.min(y + r, H - 1) - Math.max(y - r, 0) + 1;
      out[y * W + x] = sum / cnt;
    }
  }
  return out;
}

// ============================================================
// 適応的2値化（Adaptive Threshold）
// 局所ブロックの平均輝度 - C をしきい値として2値化
// アニメ・イラストのカスレ改善に効果的
// ============================================================
function applyAdaptiveThreshold(gray, out, W, H) {
  // ブロックサイズは奇数限定
  let blk = parseInt(sliderAdaptBlock.value) | 1; if (blk < 3) blk = 3;
  const C = parseInt(sliderAdaptC.value);
  // インテグラルイメージ（累積和）を使って高速に局所平均を計算
  const intg = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      intg[(y + 1) * (W + 1) + (x + 1)] = gray[y * W + x]
        + intg[y * (W + 1) + (x + 1)]
        + intg[(y + 1) * (W + 1) + x]
        - intg[y * (W + 1) + x];
    }
  }
  const half = blk >> 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 局所ウィンドウの範囲（画像端でクリップ）
      const x0 = Math.max(0, x - half), y0 = Math.max(0, y - half);
      const x1 = Math.min(W - 1, x + half), y1 = Math.min(H - 1, y + half);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = intg[(y1 + 1) * (W + 1) + (x1 + 1)]
        - intg[y0 * (W + 1) + (x1 + 1)]
        - intg[(y1 + 1) * (W + 1) + x0]
        + intg[y0 * (W + 1) + x0];
      const mean = sum / area;
      // 局所平均より C だけ暗ければ線（黒）と判定
      out[y * W + x] = gray[y * W + x] < mean - C ? 0 : 255;
    }
  }
}

// ============================================================
// Zhang-Suen 細線化アルゴリズム
// 2値化後の太い線を1px幅に削る
// out: 0=黒(線), 255=白(背景) で入力→同形式で出力
// ============================================================
// Zhang-Suen 細線化：候補ピクセルのみ処理して高速化
function zhangSuenThinning(out, W, H) {
  const N = W * H;
  const bin = new Uint8Array(N);
  for (let i = 0; i < N; i++) bin[i] = out[i] === 0 ? 1 : 0;

  // 処理候補を Set で管理（黒ピクセルのみ）
  let candidates = new Set();
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++)
      if (bin[y * W + x]) candidates.add(y * W + x);

  const maxIter = 200;
  for (let iter = 0; iter < maxIter && candidates.size > 0; iter++) {
    const del1 = [], del2 = [];

    // ステップ1
    for (const i of candidates) {
      const x = i % W, y = (i / W) | 0;
      if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) continue;
      const p2 = bin[i - W], p3 = bin[i - W + 1], p4 = bin[i + 1],
        p5 = bin[i + W + 1], p6 = bin[i + W], p7 = bin[i + W - 1],
        p8 = bin[i - 1], p9 = bin[i - W - 1];
      const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
      if (B < 2 || B > 6) continue;
      const A = (p2 === 0 && p3 === 1 ? 1 : 0) + (p3 === 0 && p4 === 1 ? 1 : 0) +
        (p4 === 0 && p5 === 1 ? 1 : 0) + (p5 === 0 && p6 === 1 ? 1 : 0) +
        (p6 === 0 && p7 === 1 ? 1 : 0) + (p7 === 0 && p8 === 1 ? 1 : 0) +
        (p8 === 0 && p9 === 1 ? 1 : 0) + (p9 === 0 && p2 === 1 ? 1 : 0);
      if (A !== 1) continue;
      if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
      del1.push(i);
    }
    for (const i of del1) bin[i] = 0;

    // ステップ2
    for (const i of candidates) {
      const x = i % W, y = (i / W) | 0;
      if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) continue;
      if (!bin[i]) continue;
      const p2 = bin[i - W], p3 = bin[i - W + 1], p4 = bin[i + 1],
        p5 = bin[i + W + 1], p6 = bin[i + W], p7 = bin[i + W - 1],
        p8 = bin[i - 1], p9 = bin[i - W - 1];
      const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
      if (B < 2 || B > 6) continue;
      const A = (p2 === 0 && p3 === 1 ? 1 : 0) + (p3 === 0 && p4 === 1 ? 1 : 0) +
        (p4 === 0 && p5 === 1 ? 1 : 0) + (p5 === 0 && p6 === 1 ? 1 : 0) +
        (p6 === 0 && p7 === 1 ? 1 : 0) + (p7 === 0 && p8 === 1 ? 1 : 0) +
        (p8 === 0 && p9 === 1 ? 1 : 0) + (p9 === 0 && p2 === 1 ? 1 : 0);
      if (A !== 1) continue;
      if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
      del2.push(i);
    }
    for (const i of del2) bin[i] = 0;

    if (del1.length === 0 && del2.length === 0) break;

    // 削除したピクセルは候補から除去
    for (const i of del1) candidates.delete(i);
    for (const i of del2) candidates.delete(i);
  }

  for (let i = 0; i < N; i++) out[i] = bin[i] ? 0 : 255;
}

// ============================================================
// ノイズ除去（後処理）
// 孤立した小さい黒点（近傍に黒ピクセルが少ない点）を白に変える
// ============================================================
function applyNoiseRemove(out, W, H, minNeighbors) {
  const tmp = out.slice();
  for (let y = 1; y < H - 1; y++) {
    const row = y * W, rowU = row - W, rowD = row + W;
    for (let x = 1; x < W - 1; x++) {
      if (tmp[row + x] !== 0) continue;
      const cnt =
        (tmp[rowU + x - 1] === 0 ? 1 : 0) + (tmp[rowU + x] === 0 ? 1 : 0) + (tmp[rowU + x + 1] === 0 ? 1 : 0) +
        (tmp[row + x - 1] === 0 ? 1 : 0) + (tmp[row + x + 1] === 0 ? 1 : 0) +
        (tmp[rowD + x - 1] === 0 ? 1 : 0) + (tmp[rowD + x] === 0 ? 1 : 0) + (tmp[rowD + x + 1] === 0 ? 1 : 0);
      if (cnt < minNeighbors) out[row + x] = 255;
    }
  }
}

// ============================================================
// 丸網点トーン変換（独立タブ用）
// グレーの濃さ → 丸点の大きさに変換（クリスタ方式）
// ============================================================

// ============================================================
// 手描きスキャン専用パイプライン
// 1. 大きなぼかしで「背景推定」を作る
// 2. 元グレー÷背景推定で色むら・黄ばみを正規化
// 3. コントラスト強調（線を際立たせる）
// 4. 適応的2値化
// 5. オプション：Zhang-Suen細線化
// ============================================================
function applyScanPipeline(gray, out, W, H) {
  const bgRadius = parseInt(sliderScanBg.value);    // 背景推定ぼかし半径
  const contrastX = parseInt(sliderScanContrast.value) / 10; // コントラスト倍率
  const doThin = sliderScanThin.value === '1';

  // ① 大きなぼかしで背景の明るさムラを推定
  const bg = boxBlur(gray, W, H, bgRadius);

  // ② 正規化：各ピクセルを「ピクセル輝度 / 背景輝度」で割り算
  //    背景=明るい→除算で1.0、線=暗い→除算で小さい値
  const normalized = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) {
    const bgVal = Math.max(bg[i], 1); // 0除算防止
    // 除算後に255スケールに変換（背景=255、線=暗い）
    const val = Math.min(255, Math.round((gray[i] / bgVal) * 255));
    normalized[i] = val;
  }

  // ③ コントラスト強調（ストレッチ）
  //    正規化後の最小・最大を求めてフルレンジに引き伸ばす
  let minV = 255, maxV = 0;
  for (let i = 0; i < W * H; i++) {
    if (normalized[i] < minV) minV = normalized[i];
    if (normalized[i] > maxV) maxV = normalized[i];
  }
  const range = Math.max(1, maxV - minV);
  const stretched = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i++) {
    // ストレッチ後にコントラスト倍率を中間値(128)中心でかける
    let v = ((normalized[i] - minV) / range) * 255;
    v = Math.round(128 + (v - 128) * contrastX);
    stretched[i] = Math.max(0, Math.min(255, v));
  }

  // ④ 軽くぼかして適応的2値化（スライダーの adaptBlock/adaptC を流用）
  const blurR = parseInt(sliderBlur.value);
  const preBlur = blurR > 0 ? boxBlur(stretched, W, H, blurR) : stretched;
  applyAdaptiveThreshold(preBlur, out, W, H);

  // ⑤ オプション細線化
  if (doThin) zhangSuenThinning(out, W, H);
}

// ============================================================
// 共通: 線マップ・膨張・塗り適用
// ============================================================
function buildLineMap(srcCtx, W, H) {
  const d = srcCtx.getImageData(0, 0, W, H).data;
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = ((d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3 < 128) ? 1 : 0;
  return m;
}
// dilateBinary：行列分離でO(W×H)化
function dilateBinary(map, W, H, r) {
  const tmp = new Uint8Array(W * H);
  // 横方向
  for (let y = 0; y < H; y++) {
    let sum = 0;
    for (let x = 0; x < Math.min(r, W); x++) sum += map[y * W + x];
    for (let x = 0; x < W; x++) {
      if (x + r < W) sum += map[y * W + x + r];
      if (x - r - 1 >= 0) sum -= map[y * W + x - r - 1];
      if (sum > 0) tmp[y * W + x] = 1;
    }
  }
  const out = new Uint8Array(W * H);
  // 縦方向
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = 0; y < Math.min(r, H); y++) sum += tmp[y * W + x];
    for (let y = 0; y < H; y++) {
      if (y + r < H) sum += tmp[(y + r) * W + x];
      if (y - r - 1 >= 0) sum -= tmp[(y - r - 1) * W + x];
      if (sum > 0) out[y * W + x] = 1;
    }
  }
  return out;
}
function applyColorToFill(bfsMask, W, H, col, alpha) {
  fillHistory.push(ctxFill.getImageData(0, 0, W, H));
  if (fillHistory.length > 30) fillHistory.shift();
  fillRedo = [];  // 新しい操作をしたらREDOは消える
  const fd_data = ctxFill.getImageData(0, 0, W, H), fd = fd_data.data;
  for (let i = 0; i < W * H; i++) {
    if (!bfsMask[i]) continue;
    const a0 = fd[i * 4 + 3] / 255, a1 = alpha, ao = a1 + a0 * (1 - a1);
    if (ao < 0.001) { fd[i * 4 + 3] = 0; continue; }
    fd[i * 4] = Math.round((col.r * a1 + fd[i * 4] * a0 * (1 - a1)) / ao);
    fd[i * 4 + 1] = Math.round((col.g * a1 + fd[i * 4 + 1] * a0 * (1 - a1)) / ao);
    fd[i * 4 + 2] = Math.round((col.b * a1 + fd[i * 4 + 2] * a0 * (1 - a1)) / ao);
    fd[i * 4 + 3] = Math.round(ao * 255);
  }
  ctxFill.putImageData(fd_data, 0, 0);
  renderMerge();
}

function applyEraseToFill(bfsMask, W, H) {
  fillHistory.push(ctxFill.getImageData(0, 0, W, H));
  if (fillHistory.length > 30) fillHistory.shift();
  fillRedo = [];  // 新しい操作をしたらREDOは消える
  const fd_data = ctxFill.getImageData(0, 0, W, H), fd = fd_data.data;
  for (let i = 0; i < W * H; i++) {
    if (!bfsMask[i]) continue;
    fd[i * 4 + 3] = 0;
  }
  ctxFill.putImageData(fd_data, 0, 0);
  renderMerge();
}

function hexToRgb(hex) { return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }; }

// BFS塗りつぶし（シード配列から）
// barrier: 超えられない壁（線マップそのもの）
// bfsFill：Uint32Array固定長キューで高速化
function bfsFill(seeds, barrier, W, H) {
  const mask = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0, tail = 0;
  for (const i of seeds) {
    if (!barrier[i] && !mask[i]) { mask[i] = 1; queue[tail++] = i; }
  }
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % W, y = (idx / W) | 0;
    if (y > 0) { const ni = idx - W; if (!mask[ni] && !barrier[ni]) { mask[ni] = 1; queue[tail++] = ni; } }
    if (y < H - 1) { const ni = idx + W; if (!mask[ni] && !barrier[ni]) { mask[ni] = 1; queue[tail++] = ni; } }
    if (x > 0) { const ni = idx - 1; if (!mask[ni] && !barrier[ni]) { mask[ni] = 1; queue[tail++] = ni; } }
    if (x < W - 1) { const ni = idx + 1; if (!mask[ni] && !barrier[ni]) { mask[ni] = 1; queue[tail++] = ni; } }
  }
  return mask;
}

// ============================================================
// 塗り領域膨張（クリスタ方式の隙間とじ）
// BFSで得た塗り領域を外側にr px膨張 → 線の下に潜り込む
// これにより白い線が残らなくなる
// ============================================================
function dilateFillMask(mask, W, H, r) {
  if (r <= 0) return mask;
  // 横方向膨張
  const tmp = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
    for (let nx = x0; nx <= x1; nx++) tmp[y * W + nx] = 1;
  }
  // 縦方向膨張
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!tmp[y * W + x]) continue;
    const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for (let ny = y0; ny <= y1; ny++) out[ny * W + x] = 1;
  }
  return out;
}

// ============================================================
// 囲って塗る（ラッソ）
// ============================================================
let lassoPoints = [], isDrawing = false;

// ============================================================
// ズーム・スクロール（スクロールバー方式）
// ============================================================
let zoomScale = 1;
let _pinchDist0 = 0, _pinchScale0 = 1, _pinchMidX = 0, _pinchMidY = 0, _pinchScrollX = 0, _pinchScrollY = 0;
let _lastTap = 0;
// PCドラッグパン用
let _mousePan = false, _panStartX = 0, _panStartY = 0, _panScrollX = 0, _panScrollY = 0;
let _panMode = false;
let _fillExpandEnabled = false;

const resultBox = document.getElementById('resultBox');

function applyZoom() {
  // canvasWrapをscaleのみで拡大（transformOrigin=左上）
  canvasWrap.style.transformOrigin = '0 0';
  canvasWrap.style.transform = zoomScale === 1 ? '' : `scale(${zoomScale})`;
  // wrapの実サイズをscaleに合わせてスペーサーで確保
  const W = canvasResult.width * zoomScale;
  const H = canvasResult.height * zoomScale;
  spacer.style.width = W + 'px';
  spacer.style.height = H + 'px';
  // ズームリセットボタン表示
  const btn = document.getElementById('btnZoomReset');
  if (btn) btn.style.display = zoomScale !== 1 ? 'block' : 'none';
  updateCanvasCursor();
}

function resetZoom() {
  zoomScale = 1; applyZoom();
  resultBox.scrollLeft = 0; resultBox.scrollTop = 0;
}

// resultBoxの中にスクロール領域用スペーサーdivを作る
const zoomContainer = document.createElement('div');
zoomContainer.style.cssText = 'position:relative;';
// canvasWrapをzoomContainerに移動
resultBox.appendChild(zoomContainer);
zoomContainer.appendChild(canvasWrap);
// スペーサー（canvasWrapのscale分の仮想サイズを確保）
const spacer = document.createElement('div');
spacer.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
zoomContainer.appendChild(spacer);

// ホイールズーム（PC）：マウス位置を中心にズーム
resultBox.addEventListener('wheel', e => {
  if (!srcImage) return;
  e.preventDefault();
  const rb = resultBox.getBoundingClientRect();
  // スクロール込みのポインタ位置（元画像ピクセル基準）
  const px = (e.clientX - rb.left + resultBox.scrollLeft) / zoomScale;
  const py = (e.clientY - rb.top + resultBox.scrollTop) / zoomScale;
  const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  zoomScale = Math.max(0.5, Math.min(16, zoomScale * delta));
  applyZoom();
  // ズーム後にスクロール位置を調整してマウス位置が固定されるようにする
  resultBox.scrollLeft = px * zoomScale - (e.clientX - rb.left);
  resultBox.scrollTop = py * zoomScale - (e.clientY - rb.top);
}, { passive: false });

// タッチ：ピンチズーム（2本指）＋ダブルタップリセット
resultBox.addEventListener('touchstart', e => {
  if (!srcImage) return;
  if (e.touches.length === 2) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    _pinchDist0 = Math.hypot(dx, dy);
    _pinchScale0 = zoomScale;
    const rb = resultBox.getBoundingClientRect();
    _pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rb.left;
    _pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rb.top;
    _pinchScrollX = resultBox.scrollLeft;
    _pinchScrollY = resultBox.scrollTop;
  } else if (e.touches.length === 1) {
    const now = Date.now();
    if (now - _lastTap < 280) { resetZoom(); _lastTap = 0; return; }
    _lastTap = now;
  }
}, { passive: false });

resultBox.addEventListener('touchmove', e => {
  if (!srcImage || e.touches.length !== 2) return;
  e.preventDefault();
  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  const dist = Math.hypot(dx, dy);
  const newScale = Math.max(0.5, Math.min(16, _pinchScale0 * (dist / _pinchDist0)));
  const ratio = newScale / _pinchScale0;
  // ピンチ中心位置がズーム後も同じ場所になるようスクロール調整
  const pivotX = (_pinchScrollX + _pinchMidX) / _pinchScale0;
  const pivotY = (_pinchScrollY + _pinchMidY) / _pinchScale0;
  zoomScale = newScale;
  applyZoom();
  resultBox.scrollLeft = pivotX * zoomScale - _pinchMidX;
  resultBox.scrollTop = pivotY * zoomScale - _pinchMidY;
}, { passive: false });

// ============================================================
// 座標変換（スクロール＋ズーム考慮）
// ============================================================
function getPos(canvas, e) {
  // canvasLassoのBoundingClientRectはズーム後CSS座標
  // canvas.width/rect.widthの比でキャンバスピクセルに変換
  const rect = canvas.getBoundingClientRect();
  const sx = canvasResult.width / rect.width;
  const sy = canvasResult.height / rect.height;
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
}

// ============================================================
// 描画イベント（マウス＋タッチ）
// 描画タブ（paint/dust/bucket）: 左ドラッグ=描画、Shift+左ドラッグ=パン
// 非描画タブ（lineart/auto）:    左ドラッグ=パン
// ============================================================
let _spaceDown = false;
let _shiftDown = false;
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.repeat) { _spaceDown = true; updateCanvasCursor(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { _shiftDown = true; updateCanvasCursor(); }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space') { _spaceDown = false; _mousePan = false; updateCanvasCursor(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { _shiftDown = false; _mousePan = false; updateCanvasCursor(); }
});

function isDrawTab() { return currentTab === 'paint' || currentTab === 'dust' || currentTab === 'bucket'; }
function updateCanvasCursor() {
  if (_mousePan) { canvasLasso.style.cursor = 'grabbing'; return; }
  if (isDrawTab()) {
    if (_panMode || _spaceDown || _shiftDown) canvasLasso.style.cursor = 'grab';
    else canvasLasso.style.cursor = 'crosshair';
  } else {
    canvasLasso.style.cursor = 'grab';
  }
}

canvasLasso.addEventListener('mousedown', e => {
  const isZoomed = zoomScale !== 1;
  const isDraw = isDrawTab();
  const doPan = e.button === 1 || (e.button === 0 && ((isDraw ? (_panMode || _shiftDown || _spaceDown) : true)));
  if (doPan) {
    e.preventDefault();
    _mousePan = true;
    _panStartX = e.clientX; _panStartY = e.clientY;
    _panScrollX = resultBox.scrollLeft; _panScrollY = resultBox.scrollTop;
    updateCanvasCursor(); return;
  }
  if (e.button === 0) onDown(e);
});
canvasLasso.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) return;
  e.preventDefault();
  if (_panMode) {
    _mousePan = true;
    _panStartX = e.touches[0].clientX; _panStartY = e.touches[0].clientY;
    _panScrollX = resultBox.scrollLeft; _panScrollY = resultBox.scrollTop;
    updateCanvasCursor();
    return;
  }
  onDown(e);
}, { passive: false });

canvasLasso.addEventListener('mousemove', e => {
  if (_mousePan) {
    resultBox.scrollLeft = _panScrollX - (e.clientX - _panStartX);
    resultBox.scrollTop = _panScrollY - (e.clientY - _panStartY);
    return;
  }
  onMove(e);
});
canvasLasso.addEventListener('touchmove', e => {
  if (e.touches.length !== 1) return;
  if (_mousePan) {
    e.preventDefault();
    resultBox.scrollLeft = _panScrollX - (e.touches[0].clientX - _panStartX);
    resultBox.scrollTop = _panScrollY - (e.touches[0].clientY - _panStartY);
    return;
  }
  e.preventDefault(); onMove(e);
}, { passive: false });

canvasLasso.addEventListener('mouseup', e => {
  if (_mousePan) { _mousePan = false; updateCanvasCursor(); return; }
  onUp(e);
});
canvasLasso.addEventListener('mouseleave', e => {
  if (_mousePan) { _mousePan = false; updateCanvasCursor(); return; }
  onUp(e);
});
canvasLasso.addEventListener('touchend', e => {
  if (_mousePan) { _mousePan = false; updateCanvasCursor(); return; }
  onUp(e);
});

// PC: resultBox 上をドラッグしても画像をパンできるようにする（ズーム中）
resultBox.addEventListener('mousedown', e => {
  // ズームリセットボタンを操作しているときはパンしない
  if (e.target.closest && e.target.closest('.zoom-reset-btn')) return;
  if (e.button !== 0) return;
  // Shift または PANモードでパン（ズーム中に限定しない）
  const doPan = _panMode || e.shiftKey;
  if (!doPan) return;
  e.preventDefault();
  _mousePan = true;
  _panStartX = e.clientX; _panStartY = e.clientY;
  _panScrollX = resultBox.scrollLeft; _panScrollY = resultBox.scrollTop;
  updateCanvasCursor();
});
resultBox.addEventListener('mousemove', e => {
  if (!_mousePan) return;
  resultBox.scrollLeft = _panScrollX - (e.clientX - _panStartX);
  resultBox.scrollTop = _panScrollY - (e.clientY - _panStartY);
});
resultBox.addEventListener('mouseup', e => {
  if (!_mousePan) return;
  _mousePan = false; updateCanvasCursor();
});
resultBox.addEventListener('mouseleave', e => {
  if (!_mousePan) return;
  _mousePan = false; updateCanvasCursor();
});

function onDown(e) {
  if (currentTab === 'paint' || currentTab === 'dust') {
    isDrawing = true; lassoPoints = [getPos(canvasLasso, e)];
  } else if (currentTab === 'bucket') {
    executeBucket(getPos(canvasLasso, e));
  }
}
function onMove(e) {
  if ((currentTab !== 'paint' && currentTab !== 'dust') || !isDrawing) return;
  lassoPoints.push(getPos(canvasLasso, e));
  ctxLasso.clearRect(0, 0, canvasLasso.width, canvasLasso.height);
  ctxLasso.beginPath();
  ctxLasso.moveTo(lassoPoints[0].x, lassoPoints[0].y);
  for (let i = 1; i < lassoPoints.length; i++)ctxLasso.lineTo(lassoPoints[i].x, lassoPoints[i].y);
  // ラッソ線をズームに合わせて太さ調整
  ctxLasso.strokeStyle = '#ff7cf5';
  ctxLasso.lineWidth = Math.max(1, 2 / zoomScale);
  ctxLasso.setLineDash([Math.max(2, 6 / zoomScale), Math.max(1, 3 / zoomScale)]);
  ctxLasso.stroke();
  ctxLasso.setLineDash([]);
}
function onUp(e) {
  if ((currentTab !== 'paint' && currentTab !== 'dust') || !isDrawing) return;
  isDrawing = false;
  ctxLasso.clearRect(0, 0, canvasLasso.width, canvasLasso.height);
  if (lassoPoints.length < 5) { lassoPoints = []; return; }
  if (currentTab === 'paint') executeLasso();
  else if (currentTab === 'dust') executeDustLasso();
  lassoPoints = [];
}

function executeLasso() {
  const useOrig = document.querySelector('input[name="paintTarget"]:checked').value === 'orig';
  const modeEl = document.querySelector('input[name="paintMode"]:checked');
  const mode = modeEl ? modeEl.value : 'fill';
  const sc = useOrig ? canvasOrig : canvasResult, sc2 = useOrig ? ctxOrig : ctxResult;
  const W = sc.width, H = sc.height;
  const lineMap = buildLineMap(sc2, W, H);
  const gapR = parseInt(sliderGapClose.value);

  // ① 線をgapR膨張して隙間を埋めたバリアでBFS（従来の隙間とじ）
  const barrier = gapR > 0 ? dilateBinary(lineMap, W, H, gapR) : lineMap;

  // ② ラッソ内部マスクからシードを収集
  const lassoMask = buildLassoMask(lassoPoints, W, H);
  const seeds = [];
  for (let i = 0; i < W * H; i++) { if (lassoMask[i] && !barrier[i]) seeds.push(i); }

  // ③ BFSで塗り領域を検出（バリアで止まる）
  let mask = bfsFill(seeds, barrier, W, H);

  // ④ 【クリスタ方式】塗り領域をgapR分膨張 → 線の下に潜り込ませる
  //    これにより線ピクセルも塗られ、白い線が残らなくなる
  if (gapR > 0) mask = dilateFillMask(mask, W, H, gapR);

  if (mode === 'erase') {
    applyEraseToFill(mask, W, H);
    setStatus(`囲って消しゴム完了！（隙間とじ${gapR}px）にょ🐮✋`, 'ok2');
  } else {
    const alpha = parseInt(sliderFillAlpha.value) / 100;
    applyColorToFill(mask, W, H, hexToRgb(paintColor), alpha);
    setStatus(`囲って塗り完了！（隙間とじ${gapR}px）にょ🐮✋`, 'ok2');
  }
}

function buildLassoMask(pts, W, H) {
  const mask = new Uint8Array(W * H); if (pts.length < 3) return mask; const n = pts.length;
  for (let y = 0; y < H; y++) {
    const xs = [];
    for (let i = 0; i < n; i++) { const p1 = pts[i], p2 = pts[(i + 1) % n]; if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) xs.push(p1.x + (y - p1.y) / (p2.y - p1.y) * (p2.x - p1.x)); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k < xs.length - 1; k += 2) { const x0 = Math.max(0, Math.ceil(xs[k])), x1 = Math.min(W - 1, Math.floor(xs[k + 1])); for (let x = x0; x <= x1; x++)mask[y * W + x] = 1; }
  }
  return mask;
}

// ============================================================
// バケツ塗り
// ============================================================
function executeBucket(pos) {
  const useOrig = document.querySelector('input[name="bucketTarget"]:checked').value === 'orig';
  const modeEl = document.querySelector('input[name="bucketMode"]:checked');
  const mode = modeEl ? modeEl.value : 'fill';
  const sc = useOrig ? canvasOrig : canvasResult, sc2 = useOrig ? ctxOrig : ctxResult;
  const W = sc.width, H = sc.height;
  const sx = Math.round(pos.x), sy = Math.round(pos.y);
  if (sx < 0 || sx >= W || sy < 0 || sy >= H) return;
  const lineMap = buildLineMap(sc2, W, H);
  const gapR = parseInt(sliderBucketGap.value);

  // ① 線をgapR膨張して隙間とじバリアを作る
  const barrier = gapR > 0 ? dilateBinary(lineMap, W, H, gapR) : lineMap;

  // ② シード設定（クリックした点がバリア上なら近傍で探す）
  const seedIdx = sy * W + sx;
  const seeds = barrier[seedIdx] ? [] : [seedIdx];
  if (barrier[seedIdx]) {
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const nx = sx + dx, ny = sy + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && !barrier[ny * W + nx]) seeds.push(ny * W + nx);
    }
  }
  if (!seeds.length) { setStatus('線の上はクリックしてもうまく塗れないにょ🐮', 'err'); return; }

  // ③ BFS
  let mask = bfsFill(seeds, barrier, W, H);

  // ④ 【クリスタ方式】塗り領域膨張で線の下に潜り込む
  if (gapR > 0) mask = dilateFillMask(mask, W, H, gapR);

  if (mode === 'erase') {
    applyEraseToFill(mask, W, H);
    setStatus(`バケツ消しゴム完了！にょ🐮✋`, 'ok3');
  } else {
    const alpha = parseInt(sliderBucketAlpha.value) / 100;
    applyColorToFill(mask, W, H, hexToRgb(bucketColor), alpha);
    setStatus(`バケツ塗り完了！にょ🐮✋`, 'ok3');
  }
}

// ============================================================
// 自動塗り分け
// ============================================================
document.getElementById('btnAutoRun').addEventListener('click', () => {
  if (!srcImage) { setStatus('まず画像を選んでにょ🐮', 'err'); return; }
  runAutoFill();
});

async function runAutoFill() {
  const useOrig = document.querySelector('input[name="autoTarget"]:checked').value === 'orig';
  const sc = useOrig ? canvasOrig : canvasResult, sc2 = useOrig ? ctxOrig : ctxResult;
  const W = sc.width, H = sc.height;
  const gapR = parseInt(sliderAutoGap.value);
  const minSize = parseInt(sliderAutoMin.value);
  const alpha = parseInt(sliderAutoAlpha.value) / 100;
  const colors = autoPaletteColors.map(hexToRgb);
  if (!colors.length) { setStatus('色パレットが空にょ🐮', 'err'); return; }

  setStatus('自動塗り分け処理中…', '');
  const pb = document.getElementById('progressBar');
  const pf = document.getElementById('progressFill');
  pb.classList.add('show'); pf.style.width = '0%';

  // 少し遅延してUIを更新
  await new Promise(r => setTimeout(r, 20));

  const lineMap = buildLineMap(sc2, W, H);
  // ① 線を膨張してバリア（隙間とじ）を作る
  const barrier = gapR > 0 ? dilateBinary(lineMap, W, H, gapR) : lineMap;

  // ラベリング（BFSで全連結領域を検出）- バリアを壁として使う
  const label = new Int32Array(W * H).fill(-1);
  let numLabels = 0;
  const regionSizes = [];

  for (let i = 0; i < W * H; i++) {
    if (label[i] !== -1 || barrier[i]) continue;
    // 新しい領域BFS
    const lbl = numLabels++;
    label[i] = lbl;
    const q = [i]; let qi = 0, size = 0;
    while (qi < q.length) {
      const idx = q[qi++]; size++;
      const x = idx % W, y = (idx / W) | 0;
      const nb = [y > 0 ? idx - W : -1, y < H - 1 ? idx + W : -1, x > 0 ? idx - 1 : -1, x < W - 1 ? idx + 1 : -1];
      for (const ni of nb) { if (ni < 0 || label[ni] !== -1 || barrier[ni]) continue; label[ni] = lbl; q.push(ni); }
    }
    regionSizes.push(size);

    // 進捗更新（1000ラベルごと）
    if (numLabels % 1000 === 0) {
      pf.style.width = Math.min(80, Math.round(i / W / H * 80)) + '%';
      await new Promise(r => setTimeout(r, 0));
    }
  }

  pf.style.width = '85%';
  await new Promise(r => setTimeout(r, 10));

  // UNDO用に保存（新操作なのでREDOをクリア）
  fillHistory.push(ctxFill.getImageData(0, 0, W, H));
  if (fillHistory.length > 30) fillHistory.shift();
  fillRedo = [];

  // 各領域に色を塗る
  const fd_data = ctxFill.getImageData(0, 0, W, H);
  const fd = fd_data.data;
  const colAssign = new Array(numLabels).fill(null);

  for (let lbl = 0; lbl < numLabels; lbl++) {
    if (regionSizes[lbl] < minSize) continue; // 大きい領域のみ色割り当て
    colAssign[lbl] = colors[lbl % colors.length];
  }

  // ---- 穴埋め処理: 小領域を近傍の大領域の色で塗る ----
  // ON/OFFはfillHolesスライダーで制御
  const doFillHoles = sliderFillHoles.value === '1';
  if (doFillHoles) {
    // 未割り当て領域を近傍ラベルBFSで探して色を伝播
    // 複数パスを繰り返して孤立小領域を全部埋める
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (let i = 0; i < W * H; i++) {
        const lbl = label[i];
        if (lbl < 0 || colAssign[lbl]) continue; // 線 or 割り当て済みはスキップ
        // 4近傍に割り当て済み領域があれば色を借りる
        const x = i % W, y = (i / W) | 0;
        const nb = [y > 0 ? i - W : -1, y < H - 1 ? i + W : -1, x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1];
        for (const ni of nb) {
          if (ni < 0) continue;
          const nlbl = label[ni];
          if (nlbl >= 0 && colAssign[nlbl]) {
            // 同じラベルグループに色を割り当て
            colAssign[lbl] = colAssign[nlbl];
            changed = true;
            break;
          }
        }
      }
      if (!changed) break;
    }
  }

  // ---- 全領域を塗りキャンバスに描画（クリスタ方式：領域膨張で線の下へ）----
  // ラベルごとに塗るピクセルセットを収集し、gapR膨張してから塗る
  // メモリ節約のためラベルごとのマスクは使わずピクセルを直接処理
  // まず各ピクセルの割り当て色を決定（膨張前）
  const pixelCol = new Array(W * H).fill(null);
  for (let i = 0; i < W * H; i++) {
    const lbl = label[i];
    if (lbl >= 0 && colAssign[lbl]) pixelCol[i] = colAssign[lbl];
  }

  // 【クリスタ方式】gapR分膨張：色が決まっている領域を外に広げる
  // これで線ピクセルにも色が入り白い線が消える
  if (gapR > 0) {
    // 横方向膨張
    const tmpH = new Array(W * H).fill(null);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!pixelCol[y * W + x]) continue;
      const x0 = Math.max(0, x - gapR), x1 = Math.min(W - 1, x + gapR);
      for (let nx = x0; nx <= x1; nx++) if (!tmpH[y * W + nx]) tmpH[y * W + nx] = pixelCol[y * W + x];
    }
    // 縦方向膨張
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!tmpH[y * W + x]) continue;
      const y0 = Math.max(0, y - gapR), y1 = Math.min(H - 1, y + gapR);
      for (let ny = y0; ny <= y1; ny++) if (!pixelCol[ny * W + x]) pixelCol[ny * W + x] = tmpH[y * W + x];
    }
  }

  for (let i = 0; i < W * H; i++) {
    const col = pixelCol[i];
    if (!col) continue;
    const a0 = fd[i * 4 + 3] / 255, a1 = alpha, ao = a1 + a0 * (1 - a1);
    if (ao < 0.001) { fd[i * 4 + 3] = 0; continue; }
    fd[i * 4] = Math.round((col.r * a1 + fd[i * 4] * a0 * (1 - a1)) / ao);
    fd[i * 4 + 1] = Math.round((col.g * a1 + fd[i * 4 + 1] * a0 * (1 - a1)) / ao);
    fd[i * 4 + 2] = Math.round((col.b * a1 + fd[i * 4 + 2] * a0 * (1 - a1)) / ao);
    fd[i * 4 + 3] = Math.round(ao * 255);
  }
  ctxFill.putImageData(fd_data, 0, 0);
  renderMerge();

  pf.style.width = '100%';
  await new Promise(r => setTimeout(r, 200));
  pb.classList.remove('show');

  const filled = colAssign.filter(Boolean).length;
  setStatus(`自動塗り分け完了！${filled}領域（穴埋め${doFillHoles ? 'ON' : 'OFF'}）にょ🐮✋`, 'ok4');
}

// ============================================================
// UNDO / リセット
// ============================================================
function undoFill() {
  if (!fillHistory.length) { setStatus('これ以上戻せないにょ🐮', 'err'); return; }
  // 現在の状態をREDOに積んでからUNDO
  fillRedo.push(ctxFill.getImageData(0, 0, canvasFill.width, canvasFill.height));
  if (fillRedo.length > 30) fillRedo.shift();
  ctxFill.putImageData(fillHistory.pop(), 0, 0);
  renderMerge();
  setStatus('↩ 戻したにょ🐮✋', 'ok2');
}
function redoFill() {
  if (!fillRedo.length) { setStatus('これ以上やり直せないにょ🐮', 'err'); return; }
  // 現在の状態をUNDOに積んでからREDO
  fillHistory.push(ctxFill.getImageData(0, 0, canvasFill.width, canvasFill.height));
  if (fillHistory.length > 30) fillHistory.shift();
  ctxFill.putImageData(fillRedo.pop(), 0, 0);
  renderMerge();
  setStatus('↪ やり直したにょ🐮✋', 'ok2');
}
function clearFill() {
  if (!srcImage) return;
  fillHistory.push(ctxFill.getImageData(0, 0, canvasFill.width, canvasFill.height));
  if (fillHistory.length > 30) fillHistory.shift();
  fillRedo = [];
  ctxFill.clearRect(0, 0, canvasFill.width, canvasFill.height);
  renderMerge();
  setStatus('塗りをリセットしたにょ🐮✋', 'ok2');
}

function undoDust() {
  if (!dustHistoryResult.length) { setStatus('これ以上戻せないにょ🐮', 'err'); return; }
  dustRedoResult.push(ctxResult.getImageData(0, 0, canvasResult.width, canvasResult.height));
  if (dustRedoResult.length > 30) dustRedoResult.shift();
  ctxResult.putImageData(dustHistoryResult.pop(), 0, 0);
  renderMerge();
  setStatus('↩ 戻したにょ🐮✋', 'ok2');
}
function redoDust() {
  if (!dustRedoResult.length) { setStatus('これ以上やり直せないにょ🐮', 'err'); return; }
  dustHistoryResult.push(ctxResult.getImageData(0, 0, canvasResult.width, canvasResult.height));
  if (dustHistoryResult.length > 30) dustHistoryResult.shift();
  ctxResult.putImageData(dustRedoResult.pop(), 0, 0);
  renderMerge();
  setStatus('↪ やり直したにょ🐮✋', 'ok2');
}
function resetDust() {
  if (!srcImage) return;
  processImage();
  setStatus('ゴミ取りをリセットしたにょ🐮✋', 'ok2');
}

document.getElementById('btnUndoFill').addEventListener('click', undoFill);
document.getElementById('btnClearFill').addEventListener('click', clearFill);
document.getElementById('btnUndoBucket').addEventListener('click', undoFill);
document.getElementById('btnClearBucket').addEventListener('click', clearFill);
document.getElementById('btnUndoAuto').addEventListener('click', undoFill);
document.getElementById('btnClearAuto').addEventListener('click', clearFill);
document.getElementById('btnDustUndo').addEventListener('click', undoDust);
document.getElementById('btnDustReset').addEventListener('click', resetDust);
document.getElementById('btnDustAll').addEventListener('click', applyDustAll);

// Cmd/Ctrl+Z → UNDO  /  Shift+Cmd/Ctrl+Z → REDO
function handleUndoShortcut() {
  if (currentTab === 'dust') undoDust();
  else undoFill();
}
function handleRedoShortcut() {
  if (currentTab === 'dust') redoDust();
  else redoFill();
}
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault(); handleRedoShortcut();
    return;
  }
  if (e.key === 'z' || e.key === 'Z') {
    e.preventDefault(); handleUndoShortcut();
  }
});

// ============================================================
// ゴミトリ
// ============================================================
// ゴミトリ：ラッソで囲んだ範囲内のゴミを除去
// ============================================================
function executeDustLasso() {
  const target = document.querySelector('input[name="dustTarget"]:checked').value;
  const modeEl = document.querySelector('input[name="dustMode"]:checked');
  const mode = modeEl ? modeEl.value : 'erase'; // 'erase' or 'fill'
  const dustSize = parseInt(sliderDustSize.value);
  const dustThin = parseInt(sliderDustThin.value);
  const W = canvasResult.width, H = canvasResult.height;

  // ラッソ内部マスクを生成
  const lassoMask = buildLassoMask(lassoPoints, W, H);

  if (target === 'result') {
    // 線画キャンバスへの操作
    dustHistoryResult.push(ctxResult.getImageData(0, 0, W, H));
    if (dustHistoryResult.length > 30) dustHistoryResult.shift();
    dustRedoResult = [];

    const imgData = ctxResult.getImageData(0, 0, W, H);
    const d = imgData.data;

    if (mode === 'fill') {
      // ── 黒塗りモード：ラッソ内で黒線に囲まれた白い領域を黒にする ──
      // アプローチ：ラッソ内の白ピクセルを連結成分でラベリング
      // → ラッソ境界に接触していない成分 = 黒線に囲まれた孤立白領域 → 黒で塗る
      // dustSizeより大きい成分はスキップ（大きすぎる白領域は塗らない）

      const bin = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) bin[i] = (d[i * 4] >= 128 && lassoMask[i]) ? 1 : 0;

      // BFSラベリング
      const label = new Int32Array(W * H).fill(-1);
      const comps = []; // {pixels, touchesBorder}
      for (let i = 0; i < W * H; i++) {
        if (!bin[i] || label[i] >= 0) continue;
        const lbl = comps.length;
        const pixels = [];
        let touchesBorder = false;
        const q = [i]; label[i] = lbl;
        let qi = 0;
        while (qi < q.length) {
          const idx = q[qi++];
          pixels.push(idx);
          const x = idx % W, y = (idx / W) | 0;
          // ラッソ境界に接しているか（ラッソマスクの端 = ラッソ外との境界）
          if (x === 0 || x === W - 1 || y === 0 || y === H - 1) touchesBorder = true;
          const nb = [y > 0 ? idx - W : -1, y < H - 1 ? idx + W : -1, x > 0 ? idx - 1 : -1, x < W - 1 ? idx + 1 : -1];
          for (const ni of nb) {
            if (ni < 0 || label[ni] >= 0) continue;
            if (bin[ni]) { label[ni] = lbl; q.push(ni); }
            else if (!lassoMask[ni]) touchesBorder = true; // ラッソ外の黒に隣接
          }
        }
        comps.push({ pixels, touchesBorder, size: pixels.length });
      }

      // ラッソ境界に接触せず、かつdestSize以下の成分を黒で塗る
      let filled = 0;
      for (const comp of comps) {
        if (comp.touchesBorder) continue;        // 外と繋がってる→スキップ
        if (dustSize > 0 && comp.size > dustSize) continue; // 大きすぎ→スキップ
        for (const idx of comp.pixels) {
          d[idx * 4] = 0; d[idx * 4 + 1] = 0; d[idx * 4 + 2] = 0; d[idx * 4 + 3] = 255;
          filled++;
        }
      }
      ctxResult.putImageData(imgData, 0, 0);
      renderMerge();
      setStatus(`白ぷつぷつ黒塗り完了！${filled}px にょ🐮✋`, 'ok');

    } else {
      // ── 消去モード：ラッソ内の小ゴミ（黒点）を白に ──
      const bin = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) bin[i] = (d[i * 4] < 200) ? 1 : 0;

      const binInLasso = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) binInLasso[i] = (bin[i] && lassoMask[i]) ? 1 : 0;

      const toRemove = findSmallComponents(binInLasso, W, H, dustSize, dustThin);

      let removed = 0;
      for (let i = 0; i < W * H; i++) {
        if (toRemove[i]) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = 255; removed++; }
      }
      ctxResult.putImageData(imgData, 0, 0);
      renderMerge();
      setStatus(`ゴミトリ完了！${removed}px除去 にょ🐮✋`, 'ok');
    }

  } else {
    // 塗りレイヤーのゴミトリ（消去のみ）
    fillHistory.push(ctxFill.getImageData(0, 0, W, H));
    if (fillHistory.length > 30) fillHistory.shift();
    fillRedo = [];

    const imgData = ctxFill.getImageData(0, 0, W, H);
    const d = imgData.data;

    const bin = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) bin[i] = (d[i * 4 + 3] > 10 && lassoMask[i]) ? 1 : 0;

    const toRemove = findSmallComponents(bin, W, H, dustSize, dustThin);

    let removed = 0;
    for (let i = 0; i < W * H; i++) {
      if (toRemove[i]) { d[i * 4 + 3] = 0; removed++; }
    }
    ctxFill.putImageData(imgData, 0, 0);
    renderMerge();
    setStatus(`塗りゴミトリ完了！${removed}px除去 にょ🐮✋`, 'ok');
  }
}

// ============================================================
// ゴミトリ：画像全体に一括適用
// ============================================================
function applyDustAll() {
  if (!srcImage) { setStatus('まず画像を読み込んでにょ🐮', 'err'); return; }
  const target = document.querySelector('input[name="dustTarget"]:checked').value;
  const modeEl = document.querySelector('input[name="dustMode"]:checked');
  const mode = modeEl ? modeEl.value : 'erase';
  const dustSize = parseInt(sliderDustSize.value);
  const dustThin = parseInt(sliderDustThin.value);
  const W = canvasResult.width, H = canvasResult.height;

  if (target === 'result') {
    dustHistoryResult.push(ctxResult.getImageData(0, 0, W, H));
    if (dustHistoryResult.length > 30) dustHistoryResult.shift();
    dustRedoResult = [];
    const imgData = ctxResult.getImageData(0, 0, W, H);
    const d = imgData.data;

    if (mode === 'fill') {
      // 全体：白領域BFSで孤立白を黒にする
      const bin = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) bin[i] = (d[i * 4] >= 128) ? 1 : 0;
      const label = new Int32Array(W * H).fill(-1);
      const comps = [];
      for (let i = 0; i < W * H; i++) {
        if (!bin[i] || label[i] >= 0) continue;
        const lbl = comps.length;
        const pixels = []; let touchesBorder = false;
        const q = [i]; label[i] = lbl; let qi = 0;
        while (qi < q.length) {
          const idx = q[qi++]; pixels.push(idx);
          const x = idx % W, y = (idx / W) | 0;
          if (x === 0 || x === W - 1 || y === 0 || y === H - 1) touchesBorder = true;
          const nb = [y > 0 ? idx - W : -1, y < H - 1 ? idx + W : -1, x > 0 ? idx - 1 : -1, x < W - 1 ? idx + 1 : -1];
          for (const ni of nb) { if (ni < 0 || label[ni] >= 0) continue; if (bin[ni]) { label[ni] = lbl; q.push(ni); } }
        }
        comps.push({ pixels, touchesBorder });
      }
      let filled = 0;
      for (const comp of comps) {
        if (comp.touchesBorder) continue;
        if (dustSize > 0 && comp.pixels.length > dustSize) continue;
        for (const idx of comp.pixels) { d[idx * 4] = 0; d[idx * 4 + 1] = 0; d[idx * 4 + 2] = 0; d[idx * 4 + 3] = 255; filled++; }
      }
      ctxResult.putImageData(imgData, 0, 0);
      renderMerge();
      setStatus(`全体黒塗り完了！${filled}px にょ🐮✋`, 'ok');
    } else {
      // 全体：黒連結成分で小さいものを白に
      const bin = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) bin[i] = (d[i * 4] < 200) ? 1 : 0;
      const toRemove = findSmallComponents(bin, W, H, dustSize, dustThin);
      let removed = 0;
      for (let i = 0; i < W * H; i++) {
        if (toRemove[i]) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = 255; removed++; }
      }
      ctxResult.putImageData(imgData, 0, 0);
      renderMerge();
      setStatus(`全体ゴミトリ完了！${removed}px除去 にょ🐮✋`, 'ok');
    }
  } else {
    // 塗りレイヤー全体
    fillHistory.push(ctxFill.getImageData(0, 0, W, H));
    if (fillHistory.length > 30) fillHistory.shift();
    fillRedo = [];
    const imgData = ctxFill.getImageData(0, 0, W, H);
    const d = imgData.data;
    const bin = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) bin[i] = (d[i * 4 + 3] > 10) ? 1 : 0;
    const toRemove = findSmallComponents(bin, W, H, dustSize, dustThin);
    let removed = 0;
    for (let i = 0; i < W * H; i++) { if (toRemove[i]) { d[i * 4 + 3] = 0; removed++; } }
    ctxFill.putImageData(imgData, 0, 0);
    renderMerge();
    setStatus(`塗り全体ゴミトリ完了！${removed}px除去 にょ🐮✋`, 'ok');
  }
}

// ラッソ範囲内の小成分ピクセルを検出して除去フラグを返す
function findSmallComponents(bin, W, H, maxArea, maxThin) {
  const label = new Int32Array(W * H).fill(-1);
  const sizes = [];
  const bboxes = [];
  for (let i = 0; i < W * H; i++) {
    if (!bin[i] || label[i] >= 0) continue;
    const lbl = sizes.length;
    label[i] = lbl;
    const q = [i]; let qi = 0, sz = 0;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    while (qi < q.length) {
      const idx = q[qi++]; sz++;
      const x = idx % W, y = (idx / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [y > 0 ? idx - W : -1, y < H - 1 ? idx + W : -1, x > 0 ? idx - 1 : -1, x < W - 1 ? idx + 1 : -1];
      for (const ni of nb) { if (ni < 0 || !bin[ni] || label[ni] >= 0) continue; label[ni] = lbl; q.push(ni); }
    }
    sizes.push(sz); bboxes.push([x0, y0, x1, y1]);
  }
  const remove = new Uint8Array(sizes.length);
  for (let lbl = 0; lbl < sizes.length; lbl++) {
    const [x0, y0, x1, y1] = bboxes[lbl];
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (sizes[lbl] <= maxArea) { remove[lbl] = 1; continue; }
    if (maxThin > 0 && Math.min(bw, bh) <= maxThin) remove[lbl] = 1;
  }
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (bin[i] && label[i] >= 0 && remove[label[i]]) out[i] = 1;
  }
  return out;
}

// ============================================================
// 連結成分ラベリングで小さい成分を除去する
// bin: 0/1の配列、maxArea: この面積以下を除去
// maxThin: 細長い成分（幅がこれ以下）も除去
// ============================================================
function removeSmallComponents(bin, W, H, maxArea, maxThin) {
  const label = new Int32Array(W * H).fill(-1);
  const sizes = [];
  const bboxes = []; // [minX,minY,maxX,maxY]

  // BFSラベリング
  for (let i = 0; i < W * H; i++) {
    if (!bin[i] || label[i] >= 0) continue;
    const lbl = sizes.length;
    label[i] = lbl;
    const q = [i]; let qi = 0, sz = 0;
    let minX = W, minY = H, maxX = 0, maxY = 0;
    while (qi < q.length) {
      const idx = q[qi++]; sz++;
      const x = idx % W, y = (idx / W) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const nb = [y > 0 ? idx - W : -1, y < H - 1 ? idx + W : -1, x > 0 ? idx - 1 : -1, x < W - 1 ? idx + 1 : -1];
      for (const ni of nb) {
        if (ni < 0 || !bin[ni] || label[ni] >= 0) continue;
        label[ni] = lbl; q.push(ni);
      }
    }
    sizes.push(sz);
    bboxes.push([minX, minY, maxX, maxY]);
  }

  // 除去判定：面積が小さい or バウンディングボックスが細い
  const remove = new Uint8Array(sizes.length);
  for (let lbl = 0; lbl < sizes.length; lbl++) {
    const sz = sizes[lbl];
    const [x0, y0, x1, y1] = bboxes[lbl];
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // 面積が maxArea 以下なら除去
    if (sz <= maxArea) { remove[lbl] = 1; continue; }
    // バウンディングボックスの短辺が maxThin 以下なら除去（細線ノイズ）
    if (maxThin > 0 && Math.min(bw, bh) <= maxThin) { remove[lbl] = 1; }
  }

  // 除去後の2値マップを返す
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (bin[i] && label[i] >= 0 && !remove[label[i]]) out[i] = 1;
  }
  return out;
}

// ============================================================
// ダウンロード
// ============================================================
// 保存共通関数
// PC/Android: a.download で直接ダウンロード
// iPhone Safari: dataURLをモーダルに表示→長押し保存案内
// ============================================================
// 保存共通関数
// PC/Android: a.download で直接ダウンロード
// iPhone Safari: 新しいタブで画像を開く → 長押し保存
// ============================================================
function saveCanvasAsPng(canvas, filename) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  try {
    canvas.toBlob(async blob => {
      if (!blob) { setStatus('保存エラー: Blob生成失敗にょ🐮', 'err'); return; }
      const useNativeSave = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.saveImage);
      if (useNativeSave) {
        const reader = new FileReader();
        reader.onload = ev => {
          const dataURL = ev.target.result;
          window.webkit.messageHandlers.saveImage.postMessage({ filename, dataURL });
        };
        reader.readAsDataURL(blob);
        return;
      }
      if (isIOS) {
        const shareFile = new File([blob], filename, { type: 'image/png' });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [shareFile] })) {
          try {
            await navigator.share({ files: [shareFile], title: filename });
            setStatus('共有シートを開いたにょ🐮 「ファイルに保存」を選んでね', 'ok');
            return;
          } catch (err) {
            if (err && err.name === 'AbortError') {
              setStatus('保存をキャンセルしたにょ🐮', 'warn');
              return;
            }
          }
        }
        const reader = new FileReader();
        reader.onload = ev => {
          const dataURL = ev.target.result;
          const w = window.open('', '_blank');
          if (w) {
            w.document.write(
              '<!DOCTYPE html><html><head>' +
              '<meta charset="UTF-8">' +
              '<meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<title>' + filename + '</title>' +
              '<style>*{margin:0;padding:0;box-sizing:border-box}' +
              'body{background:#111;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:16px;font-family:sans-serif}' +
              'img{max-width:100%;max-height:80vh;border-radius:8px;display:block}' +
              'p{color:#fff;font-size:15px;text-align:center;line-height:1.6}' +
              'p b{color:#7cffb2}</style></head>' +
              '<body><img src="' + dataURL + '"><p>共有シートが使えない環境です。画像を<b>長押し</b>して保存してください。</p></body></html>'
            );
            w.document.close();
          } else {
            document.open();
            document.write(
              '<!DOCTYPE html><html><head>' +
              '<meta charset="UTF-8">' +
              '<meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<style>*{margin:0;padding:0}body{background:#111;display:flex;flex-direction:column;align-items:center;padding:16px;gap:16px;font-family:sans-serif}' +
              'img{max-width:100%}p{color:#fff;font-size:15px;text-align:center}a{color:#7cffb2;display:block;margin-top:8px}</style></head>' +
              '<body><img src="' + dataURL + '">' +
              '<p>共有シートが使えない環境です。画像を長押しして保存してください。<br><a href="javascript:history.back()">← 戻る</a></p></body></html>'
            );
            document.close();
          }
        };
        reader.readAsDataURL(blob);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
      }
    }, 'image/png');
  } catch (e) {
    setStatus('保存エラー: ' + e.message + ' にょ🐮', 'err');
  }
}

// ズームリセットボタン
const btnZoomReset = document.getElementById('btnZoomReset');
if (btnZoomReset) btnZoomReset.addEventListener('click', resetZoom);
const btnPanToggle = document.getElementById('btnPanToggle');
if (btnPanToggle) btnPanToggle.addEventListener('click', () => {
  _panMode = !_panMode;
  btnPanToggle.style.borderColor = _panMode ? 'var(--accent)' : 'var(--border)';
  btnPanToggle.style.color = _panMode ? 'var(--accent)' : 'var(--text-dim)';
  btnPanToggle.textContent = _panMode ? '✋ PAN ON' : '✋ PAN';
  updateCanvasCursor();
});
if (btnFillExpandToggle) btnFillExpandToggle.addEventListener('click', () => {
  _fillExpandEnabled = !_fillExpandEnabled;
  btnFillExpandToggle.textContent = _fillExpandEnabled ? '線画埋め: ON' : '線画埋め: OFF';
  btnFillExpandToggle.style.borderColor = _fillExpandEnabled ? 'var(--accent)' : 'var(--border)';
  btnFillExpandToggle.style.color = _fillExpandEnabled ? 'var(--accent)' : '';
  renderMerge();
});

btnDownload.addEventListener('click', () => {
  if (!srcImage) { setStatus('まず画像を読み込んでにょ🐮', 'err'); return; }
  saveCanvasAsPng(canvasResult, srcFileName + '_line.png');
  setStatus('線画PNG保存したにょ🐮✋', 'ok');
});
btnDownloadMerge.addEventListener('click', () => {
  if (!srcImage) return;

  // 現在のタブに応じて「塗る対象」ラジオを正しく参照
  const tabTargetMap = {
    paint: 'input[name="paintTarget"]:checked',
    bucket: 'input[name="bucketTarget"]:checked',
    auto: 'input[name="autoTarget"]:checked',
  };
  const selector = tabTargetMap[currentTab] || tabTargetMap.paint;
  const targetEl = document.querySelector(selector);
  const useOrig = targetEl ? targetEl.value === 'orig' : false;
  const base = useOrig ? canvasOrig : canvasResult;

  const W = base.width, H = base.height;
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const tc = tmp.getContext('2d');

  // ① 白背景で初期化（透明部分が白になるのを防ぐ）
  tc.fillStyle = '#ffffff';
  tc.fillRect(0, 0, W, H);

  // ② ベース画像（線画 or 元画像）を描画
  tc.drawImage(base, 0, 0);

  // ③ 塗りレイヤーを重ねる
  tc.drawImage(canvasFill, 0, 0);

  // ④ 線画を一番上に重ねて線を際立たせる（元画像ベースのときは不要）
  if (!useOrig) {
    // 線画の黒ピクセルだけを上から乗せる（白=透明として合成）
    // canvasResultはグレースケールなので multiply ブレンドで線を通す
    tc.globalCompositeOperation = 'multiply';
    tc.drawImage(canvasResult, 0, 0);
    tc.globalCompositeOperation = 'source-over';
  }

  saveCanvasAsPng(tmp, srcFileName + '_filled.png');
  setStatus('塗り込みPNG保存したにょ🐮✋', 'ok');
});

// ============================================================
// ============================================================
// renderMerge：塗り＋線画をcanvasMergeに合成描画
// rAFバッチングで連続呼び出し時の無駄な再描画を防止
// ============================================================
let _mergePending = false;
function renderMerge() {
  if (_mergePending) return;
  _mergePending = true;
  requestAnimationFrame(() => {
    _mergePending = false;
    const W = canvasResult.width, H = canvasResult.height;
    if (!W || !H) return;
    // サイズ変更時のみwidthを再設定（設定するとクリアされるため）
    if (canvasMerge.width !== W || canvasMerge.height !== H) {
      canvasMerge.width = W; canvasMerge.height = H;
    }
    // ① 白背景
    ctxMerge.fillStyle = '#ffffff';
    ctxMerge.fillRect(0, 0, W, H);
    // ② 塗りレイヤー
    ctxMerge.drawImage(canvasFill, 0, 0);
    // ③ 線画をmultiplyで重ねる
    ctxMerge.globalCompositeOperation = 'multiply';
    ctxMerge.drawImage(canvasResult, 0, 0);
    ctxMerge.globalCompositeOperation = 'source-over';
    // 比較モードのclip更新
    updateCompareClip();
  });
}

// ============================================================
// 比較スライダー
// ============================================================
let compareMode = false;
let compareX = 0.5; // 0〜1

const compareSlider = document.getElementById('compareSlider');
const btnCompare = document.getElementById('btnCompare');

function updateCompareClip() {
  if (!compareMode) {
    // 通常：canvasMergeをフル表示、塗りのみは非表示
    canvasMerge.style.clipPath = '';
    canvasFillView.style.display = 'none';
    canvasResult.style.display = 'none';
    compareSlider.style.display = 'none';
    canvasWrap.classList.remove('checker-bg');
    return;
  }
  // 比較モード：左=canvasMerge（線画＋塗り）、右=canvasFillView（塗りのみ）
  const pct = (compareX * 100).toFixed(1) + '%';
  canvasMerge.style.clipPath = `inset(0 ${(100 - compareX * 100).toFixed(1)}% 0 0)`;
  canvasFillView.style.display = 'block';
  canvasFillView.style.clipPath = `inset(0 0 0 ${pct})`;
  compareSlider.style.left = pct;
  compareSlider.style.display = 'block';
  canvasWrap.classList.add('checker-bg');
}

btnCompare.addEventListener('click', () => {
  compareMode = !compareMode;
  compareX = 0.5;
  btnCompare.textContent = compareMode ? '比較終了' : '比較';
  btnCompare.style.color = compareMode ? 'var(--accent)' : '';
  btnCompare.style.borderColor = compareMode ? 'var(--accent)' : '';
  updateCompareClip();
});

// スライダードラッグ（マウス）
compareSlider.addEventListener('mousedown', e => {
  e.preventDefault();
  e.stopPropagation();
  const onMove = e => {
    const rect = canvasWrap.getBoundingClientRect();
    compareX = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
    updateCompareClip();
  };
  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// スライダードラッグ（タッチ）
compareSlider.addEventListener('touchstart', e => {
  e.preventDefault();
  e.stopPropagation();
  const onMove = e => {
    const rect = canvasWrap.getBoundingClientRect();
    compareX = Math.max(0.02, Math.min(0.98, (e.touches[0].clientX - rect.left) / rect.width));
    updateCompareClip();
  };
  const onEnd = () => { document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onEnd); };
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
}, { passive: false });

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ' ' + type : '');
}

// ============================================================
// クリップボードコピー
// ネイティブアプリ(WKWebView) → webkit.messageHandlers.copyImage
// ブラウザ → Clipboard API
// iOS Safari → 長押しモーダル
// ============================================================
function copyCanvasToClipboard(canvas, label) {
  canvas.toBlob(blob => {
    if (!blob) { setStatus('コピー失敗にょ🐮', 'err'); return; }

    // WKWebViewネイティブブリッジ（iOS/macOSアプリ）
    const useNative = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.copyImage);
    if (useNative) {
      const reader = new FileReader();
      reader.onload = ev => {
        window.webkit.messageHandlers.copyImage.postMessage({ dataURL: ev.target.result });
        setStatus(label + ' をクリップボードにコピーしたにょ🐮✋', 'ok');
      };
      reader.readAsDataURL(blob);
      return;
    }

    // ブラウザ Clipboard API（macOS Chrome/Safari）
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(() => setStatus(label + ' をクリップボードにコピーしたにょ🐮✋', 'ok'))
        .catch(() => showCopyModal(canvas, label));
      return;
    }

    // iOS Safariフォールバック → 長押しモーダル
    showCopyModal(canvas, label);
  }, 'image/png');
}

function showCopyModal(canvas, label) {
  const old = document.getElementById('copyModal');
  if (old) old.remove();
  const dataURL = canvas.toDataURL('image/png');
  const modal = document.createElement('div');
  modal.id = 'copyModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px;box-sizing:border-box;';
  modal.innerHTML = `
    <div style="color:#7cffb2;font-family:'Courier New',monospace;font-size:13px;text-align:center;letter-spacing:.08em;">
      📋 ${label}<br>画像を長押し → 「コピー」
    </div>
    <img src="${dataURL}" style="max-width:88vw;max-height:60vh;image-rendering:pixelated;border:2px solid #7cffb2;border-radius:6px;-webkit-touch-callout:default;">
    <button onclick="document.getElementById('copyModal').remove()"
      style="padding:10px 28px;background:transparent;color:#7a7a90;border:1px solid #2e2e3a;border-radius:6px;cursor:pointer;font-family:'Courier New',monospace;font-size:13px;">
      ✕ 閉じる
    </button>
  `;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

// 塗り込みcanvasを合成して返す
function buildMergedCanvas() {
  if (!srcImage) return null;
  const tabTargetMap = {
    paint: 'input[name="paintTarget"]:checked',
    bucket: 'input[name="bucketTarget"]:checked',
    auto: 'input[name="autoTarget"]:checked',
  };
  const selector = tabTargetMap[currentTab] || tabTargetMap.paint;
  const targetEl = document.querySelector(selector);
  const useOrig = targetEl ? targetEl.value === 'orig' : false;
  const base = useOrig ? canvasOrig : canvasResult;
  const tmp = document.createElement('canvas');
  tmp.width = base.width; tmp.height = base.height;
  const tc = tmp.getContext('2d');
  tc.fillStyle = '#ffffff';
  tc.fillRect(0, 0, tmp.width, tmp.height);
  tc.drawImage(base, 0, 0);
  tc.drawImage(canvasFill, 0, 0);
  if (!useOrig) {
    tc.globalCompositeOperation = 'multiply';
    tc.drawImage(canvasResult, 0, 0);
    tc.globalCompositeOperation = 'source-over';
  }
  return tmp;
}

// コピーボタンのイベント登録
document.getElementById('btnCopyLine').addEventListener('click', () => {
  if (!srcImage) { setStatus('まず画像を読み込んでにょ🐮', 'err'); return; }
  copyCanvasToClipboard(canvasResult, '線画');
});

document.getElementById('btnCopyMerge').addEventListener('click', () => {
  if (!srcImage) { setStatus('まず画像を読み込んでにょ🐮', 'err'); return; }
  const merged = buildMergedCanvas();
  if (merged) copyCanvasToClipboard(merged, '塗り込み');
});

// ============================================================
// 線画（白を透明化）canvas生成
// 白=255付近のピクセルをalphaゼロにする
// ============================================================
function buildLineAlphaCanvas() {
  const W = canvasResult.width, H = canvasResult.height;
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const tc = tmp.getContext('2d');
  tc.drawImage(canvasResult, 0, 0);
  const id = tc.getImageData(0, 0, W, H);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    // 輝度が高い（白に近い）ほど透明に
    const lum = d[i]; // グレースケールなのでRGB同値
    d[i + 3] = 255 - lum; // 白(255)→alpha0、黒(0)→alpha255
  }
  tc.putImageData(id, 0, 0);
  return tmp;
}

// ============================================================
// 塗りの下地を線画の内側まで広げたキャンバスを作る
// 線画ピクセル（黒）に隣接する塗り色をにじませて埋める
// ============================================================
function buildFillExpandedCanvas(expandR = 3) {
  const W = canvasFill.width, H = canvasFill.height;
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const tc = tmp.getContext('2d');
  tc.drawImage(canvasFill, 0, 0);
  const id = tc.getImageData(0, 0, W, H);
  const d = id.data;
  const lineMap = buildLineMap(ctxResult, W, H);

  for (let pass = 0; pass < expandR; pass++) {
    const src = new Uint8ClampedArray(d);
    for (let i = 0; i < W * H; i++) {
      if (!lineMap[i]) continue;
      const a = src[i * 4 + 3];
      if (a > 0) continue;
      const x = i % W, y = (i / W) | 0;
      let found = -1;
      for (let dy = -2; dy <= 2 && found < 0; dy++) for (let dx = -2; dx <= 2 && found < 0; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = ny * W + nx;
        if (src[ni * 4 + 3] > 0) found = ni;
      }
      if (found >= 0) {
        d[i * 4] = src[found * 4];
        d[i * 4 + 1] = src[found * 4 + 1];
        d[i * 4 + 2] = src[found * 4 + 2];
        d[i * 4 + 3] = src[found * 4 + 3];
      }
    }
  }
  tc.putImageData(id, 0, 0);
  return tmp;
}

function renderFillOnlyView() {
  const W = canvasFill.width, H = canvasFill.height;
  if (!W || !H) return;
  canvasFillView.width = W; canvasFillView.height = H;
  ctxFillView.clearRect(0, 0, W, H);
  const src = _fillExpandEnabled ? buildFillExpandedCanvas() : buildFillAlphaCanvasRaw();
  ctxFillView.drawImage(src, 0, 0);
}

// ============================================================
// 塗り（塗り以外を透明化）canvas生成
// canvasFillのアルファが0のピクセルは完全透明のまま
// ============================================================
function buildFillAlphaCanvas() {
  // 線画埋めをONのときだけ拡張する
  return _fillExpandEnabled ? buildFillExpandedCanvas() : buildFillAlphaCanvasRaw();
}

function buildFillAlphaCanvasRaw() {
  const W = canvasFill.width, H = canvasFill.height;
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const tc = tmp.getContext('2d');
  tc.drawImage(canvasFill, 0, 0);
  return tmp;
}

// 線画（白を透明）保存
document.getElementById('btnDownloadLineAlpha').addEventListener('click', () => {
  if (!srcImage) { setStatus('まず画像を読み込んでにょ🐮', 'err'); return; }
  saveCanvasAsPng(buildLineAlphaCanvas(), srcFileName + '_line_alpha.png');
  setStatus('線画（透明）保存したにょ🐮✋', 'ok');
});

// 塗りのみ保存
document.getElementById('btnDownloadFillAlpha').addEventListener('click', () => {
  if (!srcImage) { setStatus('まず画像を読み込んでにょ🐮', 'err'); return; }
  saveCanvasAsPng(buildFillAlphaCanvas(), srcFileName + '_fill.png');
  setStatus('塗りレイヤー保存したにょ🐮✋', 'ok');
});

// 線画（白を透明）コピー
document.getElementById('btnCopyLineAlpha').addEventListener('click', () => {
  if (!srcImage) { setStatus('まず画像を読み込んでにょ🐮', 'err'); return; }
  copyCanvasToClipboard(buildLineAlphaCanvas(), '線画（透明）');
});

// 塗りのみコピー
document.getElementById('btnCopyFillAlpha').addEventListener('click', () => {
  if (!srcImage) { setStatus('まず画像を読み込んでにょ🐮', 'err'); return; }
  copyCanvasToClipboard(buildFillAlphaCanvas(), '塗りレイヤー');
});
