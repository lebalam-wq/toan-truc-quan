/**
 * js/ui_overlay_and_data.js
 * -------------------------
 * Module vẽ trực quan kết quả OMR lên phiếu thi (Overlay)
 * & Quản trị dữ liệu IndexedDB, Nhập/Xuất Excel (SheetJS)
 * & Giao diện Tinh chỉnh lưới tọa độ trực tiếp trên iPhone (Live Calibration UI).
 */

class QM2025UIOverlayAndData {
  constructor(options = {}) {
    this.dbName = 'QM2025_OMR_DB';
    this.dbVersion = 1;
    this.db = null;

    // Tọa độ Khung Điểm in sẵn trên phiếu (trên ảnh chuẩn 1200x1700)
    // Tương ứng các dòng: Phần I, Phần II, Phần III, Phần IV, Tổng
    this.scoreBoxCoords = {
      p1: { x: 1040, y: 642 },
      p2: { x: 1040, y: 696 },
      p3: { x: 1040, y: 750 },
      p4: { x: 1040, y: 804 },
      total: { x: 1040, y: 860 }
    };

    // Độ lệch cân chỉnh (Calibration Offsets) cho 5 khối
    this.calibrationOffsets = this.loadOffsetsFromStorage();

    this.initDatabase();
  }

  // =========================================================================
  // 1. VẼ KẾT QUẢ TRỰC QUAN LÊN PHIẾU VỪA QUÉT (GIỐNG HỆT QM2025)
  // =========================================================================

  /**
   * Vẽ lớp phủ kết quả chấm OMR lên canvas
   * @param {HTMLCanvasElement} canvas - Canvas chứa ảnh phiếu 1200x1700
   * @param {Object} gradeResult - Kết quả từ QM2025Grader
   * @param {Object} templateConfig - Cấu hình mẫu từ templates_coords.json
   * @param {Function} transformPointFn - Hàm ánh xạ tọa độ cục bộ
   */
  drawGradingOverlay(canvas, gradeResult, templateConfig, transformPointFn = null) {
    if (!canvas || !gradeResult || !templateConfig) return;
    const ctx = canvas.getContext('2d');
    const tf = transformPointFn || ((x, y) => ({ x, y }));

    ctx.save();

    // 1.1. Vẽ Phần I (Nhiều lựa chọn)
    const p1Questions = templateConfig.zones?.PHAN_I?.questions || [];
    const p1Results = gradeResult.details?.part1 || [];
    const p1Map = new Map(p1Results.map(r => [r.question, r]));

    for (const q of p1Questions) {
      const res = p1Map.get(q.question);
      if (!res) continue;

      const opts = q.options; // { A: {cx, cy, r}, B: ..., C: ..., D: ... }
      const studentAns = res.studentAnswer;
      const expectedAns = res.expectedAnswer;

      if (res.isCorrect) {
        // ĐÚNG: Khoanh tròn màu Xanh lá cây đậm (#00C853)
        const optCoord = opts[studentAns];
        if (optCoord) {
          const pt = tf(optCoord.cx, optCoord.cy);
          this.drawCircleMarker(ctx, pt.x, pt.y, optCoord.r || 11, '#00C853', 3.0);
          this.drawCheckmark(ctx, pt.x + (optCoord.r || 11) + 4, pt.y, '#00C853');
        }
      } else {
        // SAI: Khoanh tròn màu Đỏ (#FF1744) ô học sinh tô
        if (studentAns && opts[studentAns]) {
          const optCoord = opts[studentAns];
          const pt = tf(optCoord.cx, optCoord.cy);
          this.drawCircleMarker(ctx, pt.x, pt.y, optCoord.r || 11, '#FF1744', 3.0);
          this.drawCrossMark(ctx, pt.x, pt.y, (optCoord.r || 11) * 0.7, '#FF1744');
        }

        // Vẽ chấm tròn / vòng viền màu Vàng cam (#FF9100) vào ĐÁP ÁN ĐÚNG
        if (expectedAns && opts[expectedAns]) {
          const optCoord = opts[expectedAns];
          const pt = tf(optCoord.cx, optCoord.cy);
          this.drawTargetIndicator(ctx, pt.x, pt.y, optCoord.r || 11, '#FF9100');
        }
      }
    }

    // 1.2. Vẽ Phần II (Đúng / Sai)
    const p2Questions = templateConfig.zones?.PHAN_II?.questions || [];
    const p2Results = gradeResult.details?.part2 || [];
    const p2Map = new Map(p2Results.map(r => [r.question, r]));

    for (const q of p2Questions) {
      const res = p2Map.get(q.question);
      if (!res) continue;

      for (const [subKey, optObj] of Object.entries(q.items)) {
        const subRes = res.subResults?.[subKey];
        if (!subRes) continue;

        const stChoice = subRes.studentChoice;
        const expChoice = subRes.expectedChoice;

        if (subRes.isCorrect) {
          // Đúng: Khoanh xanh lá
          const optCoord = optObj[stChoice];
          if (optCoord) {
            const pt = tf(optCoord.cx, optCoord.cy);
            this.drawCircleMarker(ctx, pt.x, pt.y, optCoord.r || 11, '#00C853', 2.8);
          }
        } else {
          // Sai: Khoanh đỏ ô học sinh tô
          if (stChoice && optObj[stChoice]) {
            const optCoord = optObj[stChoice];
            const pt = tf(optCoord.cx, optCoord.cy);
            this.drawCircleMarker(ctx, pt.x, pt.y, optCoord.r || 11, '#FF1744', 2.8);
          }
          // Chỉ điểm đáp án đúng bằng màu vàng cam
          if (expChoice && optObj[expChoice]) {
            const optCoord = optObj[expChoice];
            const pt = tf(optCoord.cx, optCoord.cy);
            this.drawTargetIndicator(ctx, pt.x, pt.y, optCoord.r || 11, '#FF9100');
          }
        }
      }
    }

    // 1.3. Vẽ Phần III (Trả lời ngắn)
    const p3Questions = templateConfig.zones?.PHAN_III?.questions || [];
    const p3Results = gradeResult.details?.part3 || [];
    const p3Map = new Map(p3Results.map(r => [r.question, r]));

    for (const q of p3Questions) {
      const res = p3Map.get(q.question);
      if (!res) continue;

      // Đánh dấu trạng thái câu hỏi ở đầu hoặc cuối cột
      const firstCol = q.columns?.[0];
      if (firstCol) {
        const sampleCoord = Object.values(firstCol.elements)[0];
        if (sampleCoord) {
          const pt = tf(sampleCoord.cx, sampleCoord.cy - 20);
          ctx.font = 'bold 13px -apple-system, sans-serif';
          ctx.textAlign = 'center';
          if (res.isCorrect) {
            ctx.fillStyle = '#00C853';
            ctx.fillText(`+${res.score.toFixed(1)}đ`, pt.x + 35, pt.y);
          } else {
            ctx.fillStyle = '#FF1744';
            const expText = res.expectedAnswer ? `(Đ/A: ${res.expectedAnswer})` : 'Sai';
            ctx.fillText(expText, pt.x + 35, pt.y);
          }
        }
      }
    }

    // 1.4. In trực tiếp điểm số màu đỏ (nét đậm bút đỏ giáo viên) vào KHUNG ĐIỂM
    this.drawTeacherScoreBox(ctx, gradeResult);

    ctx.restore();
  }

  /**
   * Vẽ khoanh tròn màu (dày, nổi bật)
   */
  drawCircleMarker(ctx, cx, cy, r, color, lineWidth = 2.5) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /**
   * Vẽ dấu tick checkmark
   */
  drawCheckmark(ctx, x, y, color) {
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x, y + 3);
    ctx.lineTo(x + 6, y - 4);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  /**
   * Vẽ dấu gạch chéo đỏ
   */
  drawCrossMark(ctx, cx, cy, size, color) {
    ctx.beginPath();
    ctx.moveTo(cx - size, cy - size);
    ctx.lineTo(cx + size, cy + size);
    ctx.moveTo(cx + size, cy - size);
    ctx.lineTo(cx - size, cy + size);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.0;
    ctx.stroke();
  }

  /**
   * Vẽ chấm tròn / vòng viền chỉ báo đáp án đúng (Màu Vàng cam)
   */
  drawTargetIndicator(ctx, cx, cy, r, color) {
    // Vòng tròn nét đứt ngoài
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2.0, 0, Math.PI * 2);
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.0;
    ctx.stroke();
    ctx.setLineDash([]);

    // Chấm đặc tâm
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /**
   * In trực tiếp điểm số màu đỏ (chữ to, nét đậm kiểu bút đỏ giáo viên) vào đúng Khung Điểm
   */
  drawTeacherScoreBox(ctx, gradeResult) {
    const scores = gradeResult.scores;
    const box = this.scoreBoxCoords;

    ctx.fillStyle = '#D50000'; // Đỏ tươi chuẩn mực chấm bài của giáo viên
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';

    // Font chữ mô phỏng nét bút đỏ viết tay giáo viên
    const fontScore = 'bold 22px "Comic Sans MS", "SF Pro Text", -apple-system, sans-serif';
    const fontTotal = 'bold 34px "Comic Sans MS", "SF Pro Display", -apple-system, sans-serif';

    // Dòng 1: Phần I
    ctx.font = fontScore;
    ctx.fillText(`${scores.part1.toFixed(2)}`, box.p1.x, box.p1.y);

    // Dòng 2: Phần II
    ctx.fillText(`${scores.part2.toFixed(2)}`, box.p2.x, box.p2.y);

    // Dòng 3: Phần III
    ctx.fillText(`${scores.part3.toFixed(2)}`, box.p3.x, box.p3.y);

    // Dòng 4: Phần IV (Nếu có tự luận)
    if (gradeResult.templateId === 'QM_12_02_04' || scores.part4 > 0) {
      ctx.fillText(`${scores.part4.toFixed(2)}`, box.p4.x, box.p4.y);
    } else {
      ctx.fillText('—', box.p4.x, box.p4.y);
    }

    // Dòng 5: TỔNG ĐIỂM (Chữ to, đậm nhất)
    ctx.font = fontTotal;
    const totalX = box.total.x;
    const totalY = box.total.y;
    const totalStr = `${scores.total.toFixed(2)}`;
    ctx.fillText(totalStr, totalX, totalY);

    // Vẽ gạch chân đôi bút đỏ dưới tổng điểm
    const textWidth = ctx.measureText(totalStr).width;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#D50000';
    ctx.beginPath();
    ctx.moveTo(totalX - textWidth - 4, totalY + 18);
    ctx.lineTo(totalX + 4, totalY + 18);
    ctx.moveTo(totalX - textWidth - 4, totalY + 22);
    ctx.lineTo(totalX + 4, totalY + 22);
    ctx.stroke();
  }


  // =========================================================================
  // 2. NHẬP ĐÁP ÁN SIÊU TỐC & LƯU TRỮ INDEXEDDB (SHEETJS + BLOB COMPRESSION)
  // =========================================================================

  /**
   * Khởi tạo cơ sở dữ liệu IndexedDB
   */
  async initDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        
        // Bảng 1: Lịch sử kết quả bài chấm
        if (!db.objectStoreNames.contains('exam_records')) {
          const store = db.createObjectStore('exam_records', { keyPath: 'id', autoIncrement: true });
          store.createIndex('classId', 'classId', { unique: false });
          store.createIndex('sbd', 'sbd', { unique: false });
          store.createIndex('examCode', 'examCode', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Bảng 2: Bảng đáp án các mã đề
        if (!db.objectStoreNames.contains('answer_keys')) {
          db.createObjectStore('answer_keys', { keyPath: 'examCode' });
        }

        // Bảng 3: Cấu hình cân chỉnh tọa độ lệch
        if (!db.objectStoreNames.contains('calibration_offsets')) {
          db.createObjectStore('calibration_offsets', { keyPath: 'templateId' });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        console.log('[IndexedDB] Khởi tạo cơ sở dữ liệu OMR thành công.');
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error('[IndexedDB] Lỗi mở database:', e);
        reject(e);
      };
    });
  }

  /**
   * Nhập bảng đáp án từ file Excel (SheetJS)
   * Hỗ trợ nhiều mã đề: Cột A là câu, các cột sau là mã đề (101, 102, 103...)
   * Hoặc file có từng Sheet mang tên mã đề.
   * 
   * @param {File|ArrayBuffer} fileOrBuffer 
   * @returns {Object} Mảng các mã đề đã import thành công
   */
  async importAnswerKeysFromExcel(fileOrBuffer) {
    if (typeof XLSX === 'undefined') {
      throw new Error('Thư viện SheetJS (XLSX) chưa được nạp.');
    }

    let data = fileOrBuffer;
    if (fileOrBuffer instanceof File || fileOrBuffer instanceof Blob) {
      data = await fileOrBuffer.arrayBuffer();
    }

    const workbook = XLSX.read(data, { type: 'array' });
    const importedKeys = {};

    // Định dạng 1: Mỗi Sheet là 1 mã đề (ví dụ Sheet "101", Sheet "102")
    // Định dạng 2: Sheet 1 chứa ma trận (Cột 0: Câu hỏi, Cột 1..N: Mã đề)
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = workbook.Sheets[firstSheetName];
    const sheetData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

    if (sheetData.length > 1) {
      const headerRow = sheetData[0]; // [ 'Câu', '101', '102', '103', ... ]
      const hasMultipleCodesInHeader = headerRow.some((h, idx) => idx > 0 && /^\d{3,4}$/.test(String(h).trim()));

      if (hasMultipleCodesInHeader) {
        // Duyệt từng cột mã đề
        for (let colIdx = 1; colIdx < headerRow.length; colIdx++) {
          const rawCode = String(headerRow[colIdx] || '').trim();
          if (!rawCode) continue;

          const examCode = rawCode.padStart(3, '0');
          importedKeys[examCode] = { part1: {}, part2: {}, part3: {} };

          for (let rIdx = 1; rIdx < sheetData.length; rIdx++) {
            const row = sheetData[rIdx];
            if (!row || row[0] === undefined) continue;

            const qLabel = String(row[0]).trim();
            const ansVal = String(row[colIdx] !== undefined ? row[colIdx] : '').trim();
            if (!ansVal) continue;

            this.assignAnswerToPart(importedKeys[examCode], qLabel, ansVal);
          }
        }
      }
    }

    // Nếu không khớp định dạng ma trận, duyệt từng Sheet như một mã đề riêng biệt
    if (Object.keys(importedKeys).length === 0) {
      for (const sheetName of workbook.SheetNames) {
        const cleanCode = sheetName.trim();
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        importedKeys[cleanCode] = { part1: {}, part2: {}, part3: {} };
        for (const row of rows) {
          if (!row || row.length < 2) continue;
          const qLabel = String(row[0]).trim();
          const ansVal = String(row[1]).trim();
          this.assignAnswerToPart(importedKeys[cleanCode], qLabel, ansVal);
        }
      }
    }

    // Lưu vào IndexedDB
    for (const [code, keyData] of Object.entries(importedKeys)) {
      await this.saveAnswerKeyToDB(code, keyData);
    }

    console.log(`[SheetJS] Đã nạp thành công đáp án của ${Object.keys(importedKeys).length} mã đề:`, Object.keys(importedKeys));
    return importedKeys;
  }

  /**
   * Phân tách câu hỏi và gán vào Phần I, II hoặc III
   */
  assignAnswerToPart(keyContainer, qLabel, ansVal) {
    // Kiểm tra câu Đúng/Sai (ví dụ "1a", "1b" hoặc "Câu 1.a")
    const p2Match = qLabel.match(/(\d+)\s*[\.\_\-]?\s*([a-dA-D])/);
    if (p2Match) {
      const qNum = p2Match[1];
      const subItem = p2Match[2].toLowerCase();
      if (!keyContainer.part2[qNum]) keyContainer.part2[qNum] = {};
      keyContainer.part2[qNum][subItem] = ansVal.toUpperCase();
      return;
    }

    // Kiểm tra số thứ tự câu
    const numMatch = qLabel.match(/\d+/);
    if (!numMatch) return;
    const qNum = numMatch[0];

    // Nếu đáp án là số (có thể có dấu âm, phẩy) -> Phần III
    if (/^[\-\+]?[\d\,\.]+$/.test(ansVal)) {
      keyContainer.part3[qNum] = ansVal;
    } else {
      // Phần I (A, B, C, D)
      keyContainer.part1[qNum] = ansVal.toUpperCase();
    }
  }

  /**
   * Lưu đáp án 1 mã đề vào IndexedDB
   */
  async saveAnswerKeyToDB(examCode, keyData) {
    if (!this.db) await this.initDatabase();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('answer_keys', 'readwrite');
      const store = tx.objectStore('answer_keys');
      store.put({
        examCode: String(examCode),
        ...keyData,
        lastUpdated: new Date().toISOString()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e);
    });
  }

  /**
   * Lấy toàn bộ bảng đáp án từ IndexedDB
   */
  async getAllAnswerKeysFromDB() {
    if (!this.db) await this.initDatabase();
    return new Promise((resolve) => {
      const tx = this.db.transaction('answer_keys', 'readonly');
      const store = tx.objectStore('answer_keys');
      const req = store.getAll();
      req.onsuccess = () => {
        const result = {};
        for (const item of (req.result || [])) {
          result[item.examCode] = {
            part1: item.part1 || {},
            part2: item.part2 || {},
            part3: item.part3 || {}
          };
        }
        resolve(result);
      };
      req.onerror = () => resolve({});
    });
  }

  /**
   * Lưu bài thi chấm xong vào IndexedDB (Kèm nén ảnh JPEG chất lượng 0.7)
   */
  async saveExamResult(recordData, canvas) {
    if (!this.db) await this.initDatabase();

    // Nén ảnh sang Blob JPEG 0.7
    const imageBlob = await new Promise((resolve) => {
      if (canvas && canvas.toBlob) {
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.7);
      } else {
        resolve(null);
      }
    });

    // Thống kê chi tiết các câu sai
    const wrongDetails = [];
    if (recordData.details?.part1) {
      for (const r of recordData.details.part1) {
        if (!r.isCorrect) wrongDetails.push(`P1-C${r.question}(Đ/A:${r.expectedAnswer}-Tô:${r.studentAnswer})`);
      }
    }
    if (recordData.details?.part2) {
      for (const r of recordData.details.part2) {
        for (const [subKey, sRes] of Object.entries(r.subResults || {})) {
          if (!sRes.isCorrect) wrongDetails.push(`P2-C${r.question}${subKey}(${sRes.expectedChoice || '?'})`);
        }
      }
    }
    if (recordData.details?.part3) {
      for (const r of recordData.details.part3) {
        if (!r.isCorrect) wrongDetails.push(`P3-C${r.question}(Đ/A:${r.expectedAnswer}-Tô:${r.rawString})`);
      }
    }

    const payload = {
      classId: recordData.classId || '12B2',
      sbd: recordData.sbd || '---',
      studentName: recordData.studentName || 'Học sinh',
      examCode: recordData.made || '101',
      templateId: recordData.templateId || 'QM_12_04_06',
      scores: recordData.scores,
      wrongAnswersSummary: wrongDetails.join('; '),
      details: recordData.details,
      imageBlob,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('exam_records', 'readwrite');
      const store = tx.objectStore('exam_records');
      const req = store.add(payload);
      tx.oncomplete = () => {
        console.log(`[Storage] Đã lưu bài chấm SBD ${payload.sbd} lớp ${payload.classId} vào IndexedDB.`);
        resolve(req.result);
      };
      tx.onerror = (e) => reject(e);
    });
  }

  /**
   * Lấy danh sách kết quả bài chấm theo lớp
   */
  async getResultsByClass(classId) {
    if (!this.db) await this.initDatabase();
    return new Promise((resolve) => {
      const tx = this.db.transaction('exam_records', 'readonly');
      const store = tx.objectStore('exam_records');
      const idx = store.index('classId');
      const req = idx.getAll(classId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  /**
   * Xuất bảng điểm lớp ra file Excel .xlsx chuẩn qua SheetJS
   */
  async exportClassResultsToExcel(classId = '12B2') {
    if (typeof XLSX === 'undefined') {
      alert('Thư viện SheetJS chưa sẵn sàng.');
      return;
    }

    const records = await this.getResultsByClass(classId);
    if (!records || records.length === 0) {
      alert(`Chưa có dữ liệu bài chấm cho lớp ${classId}`);
      return;
    }

    // Xây dựng mảng dữ liệu xuất Excel
    const rows = [
      [
        'STT',
        'SBD',
        'Họ và tên',
        'Lớp',
        'Mã đề',
        'Điểm Phần I',
        'Điểm Phần II',
        'Điểm Phần III',
        'Điểm Phần IV (Tự luận)',
        'Tổng điểm',
        'Chi tiết câu sai'
      ]
    ];

    records.forEach((rec, idx) => {
      rows.push([
        idx + 1,
        rec.sbd || '',
        rec.studentName || '',
        rec.classId || '',
        rec.examCode || '',
        rec.scores?.part1 !== undefined ? rec.scores.part1 : 0,
        rec.scores?.part2 !== undefined ? rec.scores.part2 : 0,
        rec.scores?.part3 !== undefined ? rec.scores.part3 : 0,
        rec.scores?.part4 !== undefined ? rec.scores.part4 : 0,
        rec.scores?.total !== undefined ? rec.scores.total : 0,
        rec.wrongAnswersSummary || ''
      ]);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    // Định dạng độ rộng cột (Column widths)
    worksheet['!cols'] = [
      { wch: 6 },  // STT
      { wch: 10 }, // SBD
      { wch: 22 }, // Họ tên
      { wch: 8 },  // Lớp
      { wch: 8 },  // Mã đề
      { wch: 12 }, // P1
      { wch: 12 }, // P2
      { wch: 12 }, // P3
      { wch: 18 }, // P4
      { wch: 12 }, // Tổng
      { wch: 45 }  // Câu sai
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `Diem_${classId}`);

    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `BangDiem_QM2025_${classId}_${dateStr}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    console.log(`[SheetJS] Đã xuất thành công bảng điểm: ${fileName}`);
  }


  // =========================================================================
  // 3. CHẾ ĐỘ CÂN CHỈNH TRỰC TIẾP TRÊN IPHONE (LIVE CALIBRATION UI)
  // =========================================================================

  loadOffsetsFromStorage() {
    try {
      const data = localStorage.getItem('QM2025_CALIBRATION_OFFSETS');
      return data ? JSON.parse(data) : this.getDefaultOffsets();
    } catch (e) {
      return this.getDefaultOffsets();
    }
  }

  saveOffsetsToStorage(offsets) {
    this.calibrationOffsets = offsets;
    try {
      localStorage.setItem('QM2025_CALIBRATION_OFFSETS', JSON.stringify(offsets));
    } catch (e) {}
  }

  getDefaultOffsets() {
    return {
      SBD: { dx: 0, dy: 0, scaleX: 1.0, scaleY: 1.0 },
      MA_DE: { dx: 0, dy: 0, scaleX: 1.0, scaleY: 1.0 },
      PHAN_I: { dx: 0, dy: 0, scaleX: 1.0, scaleY: 1.0 },
      PHAN_II: { dx: 0, dy: 0, scaleX: 1.0, scaleY: 1.0 },
      PHAN_III: { dx: 0, dy: 0, scaleX: 1.0, scaleY: 1.0 }
    };
  }

  /**
   * Tạo giao diện nắn chỉnh tọa độ tương tác trực quan (Live Calibration Panel)
   */
  createCalibrationModal(onApplyCallback) {
    let existingModal = document.getElementById('calibrationModal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'calibrationModal';
    modal.className = 'calibration-modal-overlay';
    modal.innerHTML = `
      <div class="calibration-card">
        <div class="calib-header">
          <h3>📐 Tinh Chỉnh Lưới Tọa Độ (Lề In)</h3>
          <button id="btnCloseCalib" class="btn-close-calib">✕</button>
        </div>

        <p class="calib-hint">Chọn phân khu và dùng phím D-pad để bù trừ độ co giãn lề in của máy photocopy.</p>

        <div class="calib-segment">
          <button class="calib-tab active" data-zone="PHAN_I">Phần I</button>
          <button class="calib-tab" data-zone="PHAN_II">Phần II</button>
          <button class="calib-tab" data-zone="PHAN_III">Phần III</button>
          <button class="calib-tab" data-zone="SBD">SBD</button>
          <button class="calib-tab" data-zone="MA_DE">Mã Đề</button>
        </div>

        <div class="calib-readout">
          Phân khu: <strong id="calibActiveZoneText">Phần I</strong> | 
          Dịch: <span id="calibOffsetReadout">dX: 0px, dY: 0px</span>
        </div>

        <!-- Bàn phím điều hướng D-pad 4 hướng + Co Giãn -->
        <div class="dpad-container">
          <div class="dpad-row">
            <button class="dpad-btn" id="dpadUp" aria-label="Lên">▲</button>
          </div>
          <div class="dpad-row dpad-mid">
            <button class="dpad-btn" id="dpadLeft" aria-label="Trái">◀</button>
            <div class="dpad-center" id="dpadResetZone">0</div>
            <button class="dpad-btn" id="dpadRight" aria-label="Phải">▶</button>
          </div>
          <div class="dpad-row">
            <button class="dpad-btn" id="dpadDown" aria-label="Xuống">▼</button>
          </div>
        </div>

        <div class="calib-actions">
          <button class="calib-btn-secondary" id="btnResetAllCalib">Đặt Lại</button>
          <button class="calib-btn-primary" id="btnSaveCalib">Lưu Cố Định</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    let activeZone = 'PHAN_I';
    const offsets = JSON.parse(JSON.stringify(this.calibrationOffsets));

    const updateReadout = () => {
      const zOff = offsets[activeZone];
      document.getElementById('calibActiveZoneText').textContent = activeZone;
      document.getElementById('calibOffsetReadout').textContent = `dX: ${zOff.dx > 0 ? '+' : ''}${zOff.dx}px, dY: ${zOff.dy > 0 ? '+' : ''}${zOff.dy}px`;
      if (typeof onApplyCallback === 'function') onApplyCallback(offsets);
    };

    // Chuyển tab phân khu
    modal.querySelectorAll('.calib-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        modal.querySelectorAll('.calib-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeZone = tab.getAttribute('data-zone');
        updateReadout();
      });
    });

    // D-Pad điều hướng
    modal.getElementById('dpadUp').addEventListener('click', () => { offsets[activeZone].dy -= 1; updateReadout(); });
    modal.getElementById('dpadDown').addEventListener('click', () => { offsets[activeZone].dy += 1; updateReadout(); });
    modal.getElementById('dpadLeft').addEventListener('click', () => { offsets[activeZone].dx -= 1; updateReadout(); });
    modal.getElementById('dpadRight').addEventListener('click', () => { offsets[activeZone].dx += 1; updateReadout(); });
    modal.getElementById('dpadResetZone').addEventListener('click', () => {
      offsets[activeZone].dx = 0;
      offsets[activeZone].dy = 0;
      updateReadout();
    });

    // Đặt lại toàn bộ
    modal.getElementById('btnResetAllCalib').addEventListener('click', () => {
      const def = this.getDefaultOffsets();
      for (const k of Object.keys(offsets)) offsets[k] = { ...def[k] };
      updateReadout();
    });

    // Lưu cố định
    modal.getElementById('btnSaveCalib').addEventListener('click', () => {
      this.saveOffsetsToStorage(offsets);
      modal.remove();
      alert('Đã lưu thành công cấu hình căn chỉnh tọa độ vào bộ nhớ iPhone.');
    });

    modal.getElementById('btnCloseCalib').addEventListener('click', () => modal.remove());
  }
}

// Xuất module cho Browser / CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QM2025UIOverlayAndData;
} else if (typeof window !== 'undefined') {
  window.QM2025UIOverlayAndData = QM2025UIOverlayAndData;
}
