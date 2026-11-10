/**
 * js/app.js
 * ---------
 * QM2025 OMR - iOS Safari PWA Client Controller
 * Tích hợp:
 * 1. QM2025ScannerEngine (OpenCV.js Warp & Auto-trigger)
 * 2. QM2025Grader (Relative Density OMR & Thang điểm GDPT 2018)
 * 3. QM2025UIOverlayAndData (Vẽ bút đỏ QM2025, SheetJS Excel & IndexedDB, Live Calibration)
 */

const STATE = {
  activeTemplate: 'QM_12_04_06',
  templatesConfig: null,
  essayScore: 0.0,
  isCameraRunning: false,
  stream: null,
  animFrameId: null,
  scannerEngine: null,
  grader: null,
  overlayManager: null,
  currentGradeResult: null,
  isProcessingFrame: false,
  opencvReady: false,
  
  // Bảng đáp án mặc định
  answerKeys: {
    '101': {
      part1: {
        '1': 'A', '2': 'B', '3': 'C', '4': 'D',
        '5': 'A', '6': 'B', '7': 'C', '8': 'D',
        '9': 'A', '10': 'B', '11': 'C', '12': 'D'
      },
      part2: {
        '1': { a: 'D', b: 'S', c: 'D', d: 'S' },
        '2': { a: 'S', b: 'D', c: 'S', d: 'D' },
        '3': { a: 'D', b: 'D', c: 'S', d: 'S' },
        '4': { a: 'S', b: 'S', c: 'D', d: 'D' }
      },
      part3: {
        '1': '1.5',
        '2': '-2.25',
        '3': '0.75',
        '4': '10',
        '5': '-3',
        '6': '4.5'
      }
    }
  }
};

// Khởi chạy ứng dụng
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[PWA] Ứng dụng QM2025 OMR khởi tạo.');
  registerServiceWorker();
  await loadTemplatesConfig();
  initEngines();
  await syncAnswerKeysFromDB();
  setupUIEventListeners();
  updateTemplateUI();
  loadDefaultTemplatePreview();
});

// Lắng nghe sự kiện OpenCV sẵn sàng
window.addEventListener('opencv-ready', () => {
  STATE.opencvReady = true;
  const badge = document.querySelector('.status-badge');
  if (badge) {
    badge.innerHTML = '<span class="status-dot"></span><span>OpenCV Sẵn Sàng</span>';
  }
  initEngines();
});

// 1. Đăng ký Service Worker
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => console.log('[SW] Registered successfully:', reg.scope))
        .catch((err) => console.warn('[SW] Registration failed:', err));
    });
  }
}

// 2. Load file cấu hình tọa độ templates_coords.json
async function loadTemplatesConfig() {
  try {
    const res = await fetch('./config/templates_coords.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    STATE.templatesConfig = await res.json();
    console.log('[Config] Đã tải thành công tọa độ templates:', Object.keys(STATE.templatesConfig));
  } catch (err) {
    console.error('[Config] Không thể tải config/templates_coords.json:', err);
  }
}

// 3. Khởi tạo Scanner Engine, Grader & Overlay Manager
function initEngines() {
  if (typeof QM2025ScannerEngine !== 'undefined' && !STATE.scannerEngine) {
    STATE.scannerEngine = new QM2025ScannerEngine({
      targetWidth: 1200,
      targetHeight: 1700,
      stabilityThreshold: 8.0,
      requiredStableFrames: 4,
      onStableLock: (corners) => {
        handleAutoTriggerCapture(corners);
      }
    });
    console.log('[ScannerEngine] Đã khởi tạo bộ xử lý OMR.');
  }

  if (typeof QM2025Grader !== 'undefined' && !STATE.grader) {
    STATE.grader = new QM2025Grader();
    console.log('[Grader] Đã khởi tạo bộ chấm điểm OMR.');
  }

  if (typeof QM2025UIOverlayAndData !== 'undefined' && !STATE.overlayManager) {
    STATE.overlayManager = new QM2025UIOverlayAndData();
    console.log('[OverlayAndData] Đã khởi tạo bộ quản lý dữ liệu & trực quan.');
  }
}

// Đồng bộ đáp án từ IndexedDB
async function syncAnswerKeysFromDB() {
  if (STATE.overlayManager) {
    try {
      const keys = await STATE.overlayManager.getAllAnswerKeysFromDB();
      if (keys && Object.keys(keys).length > 0) {
        Object.assign(STATE.answerKeys, keys);
        console.log('[IndexedDB] Đã tải các mã đề từ cơ sở dữ liệu:', Object.keys(keys));
      }
    } catch (e) {
      console.warn('[IndexedDB] Chưa thể tải đáp án lưu trước:', e);
    }
  }
}

// 4. Cài đặt các Event Listeners
function setupUIEventListeners() {
  // Segmented Control
  const segmentItems = document.querySelectorAll('.segmented-item');
  segmentItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      segmentItems.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tmplKey = btn.getAttribute('data-template');
      selectTemplate(tmplKey);
    });
  });

  // Tăng / Giảm điểm Tự luận Phần IV (+/- 0.25)
  const essayInput = document.getElementById('essayScoreInput');
  const btnDec = document.getElementById('btnDecEssay');
  const btnInc = document.getElementById('btnIncEssay');

  if (btnDec && essayInput) {
    btnDec.addEventListener('click', () => {
      let val = parseFloat(essayInput.value) || 0.0;
      val = Math.max(0.0, Math.round((val - 0.25) * 100) / 100);
      essayInput.value = val.toFixed(2);
      STATE.essayScore = val;
      recalculateTotalScore();
    });
  }

  if (btnInc && essayInput) {
    btnInc.addEventListener('click', () => {
      let val = parseFloat(essayInput.value) || 0.0;
      val = Math.min(10.0, Math.round((val + 0.25) * 100) / 100);
      essayInput.value = val.toFixed(2);
      STATE.essayScore = val;
      recalculateTotalScore();
    });
  }

  if (essayInput) {
    essayInput.addEventListener('input', () => {
      let val = parseFloat(essayInput.value);
      if (isNaN(val)) val = 0.0;
      val = Math.max(0.0, Math.min(10.0, val));
      STATE.essayScore = val;
      recalculateTotalScore();
    });
  }

  // Bàn phím số nhanh cho điểm Tự luận (.btn-numpad)
  const numpadBtns = document.querySelectorAll('.btn-numpad');
  numpadBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = parseFloat(btn.getAttribute('data-val')) || 0.0;
      if (essayInput) {
        essayInput.value = val.toFixed(2);
      }
      STATE.essayScore = val;
      recalculateTotalScore();
    });
  });

  // Nút Camera & Chọn file ảnh
  const btnCamera = document.getElementById('btnCameraScan');
  if (btnCamera) btnCamera.addEventListener('click', toggleCamera);

  const btnUpload = document.getElementById('btnUploadPhoto');
  const fileInput = document.getElementById('fileUploadInput');
  if (btnUpload && fileInput) {
    btnUpload.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelected);
  }

  // Nút Debug Lưới Tọa Độ
  const btnToggleDebug = document.getElementById('btnToggleDebug');
  if (btnToggleDebug) btnToggleDebug.addEventListener('click', toggleDebugOverlay);

  // Nút Cân chỉnh lề in
  const btnOpenCalib = document.getElementById('btnOpenCalib');
  if (btnOpenCalib) {
    btnOpenCalib.addEventListener('click', () => {
      if (STATE.overlayManager) {
        STATE.overlayManager.createCalibrationModal((offsets) => {
          console.log('[Calibration] Đang áp dụng offsets mới:', offsets);
          loadDefaultTemplatePreview();
        });
      }
    });
  }

  // Nút Nạp Đáp Án Excel
  const btnImportKeyExcel = document.getElementById('btnImportKeyExcel');
  const fileKeyExcelInput = document.getElementById('fileKeyExcelInput');
  if (btnImportKeyExcel && fileKeyExcelInput) {
    btnImportKeyExcel.addEventListener('click', () => fileKeyExcelInput.click());
    fileKeyExcelInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || !STATE.overlayManager) return;
      try {
        const imported = await STATE.overlayManager.importAnswerKeysFromExcel(file);
        Object.assign(STATE.answerKeys, imported);
        alert(`Đã nạp thành công đáp án của ${Object.keys(imported).length} mã đề từ file Excel!`);
      } catch (err) {
        alert('Lỗi nạp file Excel: ' + err.message);
      }
    });
  }

  // Nút Lưu Bài Chấm vào IndexedDB
  const btnSaveRecord = document.getElementById('btnSaveRecord');
  if (btnSaveRecord) {
    btnSaveRecord.addEventListener('click', async () => {
      if (!STATE.currentGradeResult || !STATE.overlayManager) {
        alert('Chưa có bài thi nào được chấm.');
        return;
      }
      const canvas = document.getElementById('previewCanvas');
      const selectClass = document.getElementById('selectClassId');
      const classId = selectClass ? selectClass.value : '12B2';

      try {
        await STATE.overlayManager.saveExamResult({
          ...STATE.currentGradeResult,
          classId
        }, canvas);
        alert(`Đã lưu bài thi SBD ${STATE.currentGradeResult.sbd} của lớp ${classId} vào bộ nhớ máy.`);
      } catch (err) {
        alert('Lỗi lưu bài: ' + err.message);
      }
    });
  }

  // Nút Xuất Bảng Điểm Excel (.xlsx)
  const btnExportExcel = document.getElementById('btnExportExcel');
  if (btnExportExcel) {
    btnExportExcel.addEventListener('click', () => {
      if (!STATE.overlayManager) return;
      const selectClass = document.getElementById('selectClassId');
      const classId = selectClass ? selectClass.value : '12B2';
      STATE.overlayManager.exportClassResultsToExcel(classId);
    });
  }
}

function selectTemplate(tmplKey) {
  STATE.activeTemplate = tmplKey;
  updateTemplateUI();
  loadDefaultTemplatePreview();
}

function updateTemplateUI() {
  const tmplKey = STATE.activeTemplate;
  const essaySection = document.getElementById('essayScoreSection');
  const descEl = document.getElementById('templateDesc');
  const p4Row = document.getElementById('p4ScoreRow');
  const p1Count = document.getElementById('p1Count');
  const p2Count = document.getElementById('p2Count');
  const p3Count = document.getElementById('p3Count');

  if (tmplKey === 'QM_12_02_04') {
    if (essaySection) essaySection.classList.add('visible');
    if (p4Row) p4Row.style.display = 'table-row';
    if (p1Count) p1Count.textContent = '12 câu (3.0đ)';
    if (p2Count) p2Count.textContent = '2 câu (2.0đ)';
    if (p3Count) p3Count.textContent = '4 câu (2.0đ)';
    if (descEl) {
      descEl.textContent = 'Mẫu QM 12-02-04: 12 câu TN (3.0đ) + 2 câu Đúng/Sai (2.0đ) + 4 câu Trả lời ngắn (2.0đ) + Phần IV Tự luận (3.0đ).';
    }
  } else if (tmplKey === 'QM_12_04_06') {
    if (essaySection) essaySection.classList.remove('visible');
    if (p4Row) p4Row.style.display = 'none';
    if (p1Count) p1Count.textContent = '12 câu (3.0đ)';
    if (p2Count) p2Count.textContent = '4 câu (4.0đ)';
    if (p3Count) p3Count.textContent = '6 câu (3.0đ)';
    if (descEl) {
      descEl.textContent = 'Mẫu QM 12-04-06: 12 câu TN (3.0đ) + 4 câu Đúng/Sai (4.0đ) + 6 câu Trả lời ngắn (3.0đ). Thang điểm 10.0.';
    }
  } else {
    if (essaySection) essaySection.classList.remove('visible');
    if (p4Row) p4Row.style.display = 'none';
    if (p1Count) p1Count.textContent = '40 câu (10.0đ)';
    if (p2Count) p2Count.textContent = '8 câu (8.0đ)';
    if (p3Count) p3Count.textContent = '6 câu (3.0đ)';
    if (descEl) {
      descEl.textContent = 'Mẫu BGD 40-08-06: 40 câu TN nhiều lựa chọn + 8 câu Đúng/Sai + 6 câu Trả lời ngắn chuẩn thi Tốt nghiệp THPT.';
    }
  }

  recalculateTotalScore();
}

let showDebugMode = false;

function loadDefaultTemplatePreview() {
  const canvas = document.getElementById('previewCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let imgName = '';
  if (STATE.activeTemplate === 'QM_12_04_06') {
    imgName = showDebugMode ? 'debug_12_04_06.png' : 'template_12_04_06.png';
  } else if (STATE.activeTemplate === 'QM_12_02_04') {
    imgName = showDebugMode ? 'debug_12_02_04.png' : 'template_12_02_04.png';
  } else {
    imgName = 'template_12_04_06.png';
  }

  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    // Chấm thử trên ảnh mẫu và vẽ trực quan
    processStaticImageWithOpenCV();
  };
  img.src = './' + imgName;
}

function toggleDebugOverlay() {
  showDebugMode = !showDebugMode;
  const btn = document.getElementById('btnToggleDebug');
  if (btn) {
    btn.textContent = showDebugMode ? 'Ẩn Lưới Tọa Độ' : 'Hiện Lưới Tọa Độ (Debug)';
  }
  loadDefaultTemplatePreview();
}

function handleFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const canvas = document.getElementById('previewCanvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      processStaticImageWithOpenCV();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Xử lý nạp ảnh tĩnh & chấm điểm OMR thực tế + Vẽ trực quan QM2025
function processStaticImageWithOpenCV() {
  const canvas = document.getElementById('previewCanvas');
  const ctx = canvas.getContext('2d');

  const tmplCfg = STATE.templatesConfig ? STATE.templatesConfig[STATE.activeTemplate] : null;
  if (!tmplCfg) return;

  let transformPointFn = (x, y) => ({ x, y });

  // Nắn phẳng và căn chỉnh cục bộ nếu có OpenCV
  if (STATE.scannerEngine && typeof cv !== 'undefined' && cv.imread) {
    try {
      const srcMat = cv.imread(canvas);
      const warpResult = STATE.scannerEngine.detectAndWarpOuterCorners(srcMat);

      if (warpResult.success && warpResult.warpedMat) {
        cv.imshow(canvas, warpResult.warpedMat);
        
        if (tmplCfg.sub_markers?.PHAN_I) {
          const subAlign = STATE.scannerEngine.alignSubRegion(warpResult.warpedMat, tmplCfg.sub_markers.PHAN_I);
          if (subAlign.success) {
            transformPointFn = subAlign.transformPointFn;
          }
        }
        warpResult.warpedMat.delete();
      }
      srcMat.delete();
    } catch (err) {
      console.warn('[OpenCV]:', err);
    }
  }

  // Đọc dữ liệu điểm ảnh
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  if (STATE.grader) {
    // Tìm đáp án mã đề (mặc định lấy 101 nếu chưa tô)
    const gradeResult = STATE.grader.gradeSheet(tmplCfg, STATE.answerKeys['101'] || {}, imageData, {
      essayScore: STATE.essayScore,
      transformPointFn
    });

    STATE.currentGradeResult = gradeResult;
    renderGradingResult(gradeResult);

    // Vẽ lớp phủ trực quan chuẩn QM2025: Xanh đúng, Đỏ sai, Vàng cam đáp án đúng, Điểm đỏ giáo viên
    if (STATE.overlayManager) {
      STATE.overlayManager.drawGradingOverlay(canvas, gradeResult, tmplCfg, transformPointFn);
    }
  }
}

function renderGradingResult(gradeResult) {
  document.getElementById('resSBD').textContent = gradeResult.sbd || '---';
  document.getElementById('resMade').textContent = gradeResult.made || '101';

  const p1Text = `${gradeResult.scores.part1.toFixed(2)} / ${gradeResult.maxScores.part1.toFixed(1)}`;
  const p2Text = `${gradeResult.scores.part2.toFixed(2)} / ${gradeResult.maxScores.part2.toFixed(1)}`;
  const p3Text = `${gradeResult.scores.part3.toFixed(2)} / ${gradeResult.maxScores.part3.toFixed(1)}`;
  
  document.getElementById('resP1').textContent = p1Text;
  document.getElementById('resP2').textContent = p2Text;
  document.getElementById('resP3').textContent = p3Text;

  if (STATE.activeTemplate === 'QM_12_02_04') {
    const p4Text = `${gradeResult.scores.part4.toFixed(2)} / ${gradeResult.maxScores.part4.toFixed(1)}`;
    document.getElementById('resP4').textContent = p4Text;
  }

  document.getElementById('totalScoreDisplay').textContent = gradeResult.scores.total.toFixed(2);
}

// Camera stream & Auto-trigger
async function toggleCamera() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('previewCanvas');
  const btn = document.getElementById('btnCameraScan');
  const viewport = document.getElementById('scannerViewport');

  if (STATE.isCameraRunning) {
    if (STATE.animFrameId) cancelAnimationFrame(STATE.animFrameId);
    if (STATE.stream) {
      STATE.stream.getTracks().forEach((track) => track.stop());
    }
    STATE.isCameraRunning = false;
    video.style.display = 'none';
    canvas.style.display = 'block';
    viewport.classList.remove('scanning');
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Bật Camera`;
  } else {
    try {
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      STATE.stream = stream;
      video.srcObject = stream;
      video.style.display = 'block';
      canvas.style.display = 'none';
      viewport.classList.add('scanning');
      STATE.isCameraRunning = true;
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> Dừng Camera`;

      video.onloadedmetadata = () => {
        video.play();
        processRealtimeCameraFeed();
      };
    } catch (err) {
      alert('Không thể mở camera iOS Safari: ' + err.message);
    }
  }
}

function processRealtimeCameraFeed() {
  if (!STATE.isCameraRunning) return;

  const video = document.getElementById('cameraVideo');
  if (video.readyState === video.HAVE_ENOUGH_DATA && !STATE.isProcessingFrame && STATE.scannerEngine && typeof cv !== 'undefined') {
    STATE.isProcessingFrame = true;

    try {
      const offCanvas = document.createElement('canvas');
      offCanvas.width = video.videoWidth || 640;
      offCanvas.height = video.videoHeight || 480;
      const offCtx = offCanvas.getContext('2d');
      offCtx.drawImage(video, 0, 0, offCanvas.width, offCanvas.height);

      const srcMat = cv.imread(offCanvas);
      const res = STATE.scannerEngine.detectAndWarpOuterCorners(srcMat);

      if (res.success) {
        updateCornerReticleUI(res.isStable, res.stableFrames, res.maxDelta);
      } else {
        updateCornerReticleUI(false, 0, Infinity);
      }

      srcMat.delete();
      if (res.warpedMat) res.warpedMat.delete();

    } catch (e) {
      // Ignored
    } finally {
      STATE.isProcessingFrame = false;
    }
  }

  STATE.animFrameId = requestAnimationFrame(processRealtimeCameraFeed);
}

function updateCornerReticleUI(isStable, stableFrames, maxDelta) {
  const brackets = document.querySelectorAll('.corner-bracket');
  brackets.forEach(b => {
    if (isStable) {
      b.style.borderColor = '#34C759';
      b.style.boxShadow = '0 0 10px #34C759';
    } else if (stableFrames > 1) {
      b.style.borderColor = '#FF9500';
      b.style.boxShadow = 'none';
    } else {
      b.style.borderColor = 'rgba(255, 255, 255, 0.4)';
      b.style.boxShadow = 'none';
    }
  });
}

function handleAutoTriggerCapture(corners) {
  console.log('[Auto-Trigger] Khóa ổn định thành công -> Chụp & Chấm bài.');
  
  if (navigator.vibrate) {
    navigator.vibrate([40, 60, 40]);
  }

  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('previewCanvas');
  const ctx = canvas.getContext('2d');
  
  canvas.width = 1200;
  canvas.height = 1700;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  toggleCamera();
  processStaticImageWithOpenCV();
}

function recalculateTotalScore() {
  if (STATE.currentGradeResult) {
    processStaticImageWithOpenCV();
    return;
  }

  const p1El = document.getElementById('resP1');
  const p2El = document.getElementById('resP2');
  const p3El = document.getElementById('resP3');
  
  const p1 = p1El ? parseFloat(p1El.textContent) || 0.0 : 0.0;
  const p2 = p2El ? parseFloat(p2El.textContent) || 0.0 : 0.0;
  const p3 = p3El ? parseFloat(p3El.textContent) || 0.0 : 0.0;
  const p4 = (STATE.activeTemplate === 'QM_12_02_04') ? (STATE.essayScore || 0.0) : 0.0;

  let total = p1 + p2 + p3 + p4;
  total = Math.round(total * 100) / 100;
  total = Math.min(10.0, total);

  const totalEl = document.getElementById('totalScoreDisplay');
  if (totalEl) totalEl.textContent = total.toFixed(2);

  const p4Display = document.getElementById('resP4');
  if (p4Display) p4Display.textContent = `${p4.toFixed(2)} / 3.0`;
}
