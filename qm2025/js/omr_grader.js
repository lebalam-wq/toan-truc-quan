/**
 * js/omr_grader.js
 * ----------------
 * Bộ giải mã quang học OMR và chấm điểm tự động chuẩn GDPT 2018 (CV 1239).
 * Hỗ trợ các mẫu:
 * - QM_12_04_06 (12 TN + 4 Đúng/Sai + 6 TLN = 10.0đ)
 * - QM_12_02_04 (12 TN + 2 Đúng/Sai + 4 TLN = 7.0đ + 3.0đ Tự luận Phần IV)
 * - BGD_40_08_06 (Chuẩn tốt nghiệp THPT Bộ GD&ĐT)
 */

class QM2025Grader {
  constructor(options = {}) {
    // Ngưỡng đọc ô tô tương đối (Relative Density OMR)
    this.minFillRatio = options.minFillRatio || 0.38;
    this.relativeRatioThreshold = options.relativeRatioThreshold || 1.6;
    this.innerRadiusRatio = options.innerRadiusRatio || 0.75; // Bỏ viền in sẵn

    // Thang điểm mặc định
    this.scoreConfigs = {
      QM_12_04_06: {
        part1: { pointPerQuestion: 0.25, maxScore: 3.0 },
        part2: { ladder: [0, 0.1, 0.25, 0.5, 1.0], maxScore: 4.0 },
        part3: { pointPerQuestion: 0.5, maxScore: 3.0 },
        part4: { maxScore: 0.0 }
      },
      QM_12_02_04: {
        part1: { pointPerQuestion: 0.25, maxScore: 3.0 },
        part2: { ladder: [0, 0.1, 0.25, 0.5, 1.0], maxScore: 2.0 },
        part3: { pointPerQuestion: 0.5, maxScore: 2.0 },
        part4: { maxScore: 3.0, manualInput: true }
      },
      BGD_40_08_06: {
        part1: { pointPerQuestion: 0.25, maxScore: 10.0 },
        part2: { ladder: [0, 0.1, 0.25, 0.5, 1.0], maxScore: 8.0 },
        part3: { pointPerQuestion: 0.5, maxScore: 3.0 },
        part4: { maxScore: 0.0 }
      }
    };
  }

  /**
   * 1. THUẬT TOÁN ĐỌC Ô TÔ TƯƠNG ĐỐI (Relative Density OMR)
   * Tính tỷ lệ pixel đen của 1 ô trong bán kính r * 0.75 (loại bỏ viền in)
   * 
   * @param {ImageData} imageData - Dữ liệu điểm ảnh RGBA của canvas
   * @param {number} cx - Tọa độ X tâm ô tròn
   * @param {number} cy - Tọa độ Y tâm ô tròn
   * @param {number} r - Bán kính ô tròn
   * @returns {Object} { fillRatio, darkPixels, totalPixels, meanIntensity }
   */
  readBubbleFillRatio(imageData, cx, cy, r) {
    const effR = r * this.innerRadiusRatio;
    const r2 = effR * effR;
    const minX = Math.max(0, Math.floor(cx - effR));
    const maxX = Math.min(imageData.width - 1, Math.ceil(cx + effR));
    const minY = Math.max(0, Math.floor(cy - effR));
    const maxY = Math.min(imageData.height - 1, Math.ceil(cy + effR));

    let totalPixels = 0;
    let darkPixels = 0;
    let sumIntensity = 0;

    const data = imageData.data;
    const imgW = imageData.width;

    // Ngưỡng nhận diện pixel bút chì đen/xám (grayscale < 135)
    const DARK_LUMA_THRESHOLD = 135;

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      const dy2 = dy * dy;
      const rowOffset = y * imgW;

      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        if (dx * dx + dy2 <= r2) {
          totalPixels++;
          const idx = (rowOffset + x) * 4;
          const red = data[idx];
          const green = data[idx + 1];
          const blue = data[idx + 2];

          // Độ sáng luma chuẩn ITU-R BT.601
          const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
          sumIntensity += luma;

          if (luma < DARK_LUMA_THRESHOLD) {
            darkPixels++;
          }
        }
      }
    }

    if (totalPixels === 0) {
      return { fillRatio: 0, darkPixels: 0, totalPixels: 0, meanIntensity: 255 };
    }

    const fillRatio = darkPixels / totalPixels;
    const meanIntensity = sumIntensity / totalPixels;

    return {
      fillRatio: Math.round(fillRatio * 1000) / 1000,
      darkPixels,
      totalPixels,
      meanIntensity: Math.round(meanIntensity * 10) / 10
    };
  }

  /**
   * Đánh giá 1 nhóm lựa chọn theo phương pháp tỷ trọng tương đối
   * @param {Array} items - Mảng [{ key: 'A', cx, cy, r }, ...]
   * @param {ImageData} imageData 
   * @param {Function} transformPointFn - Hàm ánh xạ tọa độ cục bộ
   * @returns {Object} { status: 'OK'|'BLANK'|'DOUBLE_MARK', selectedKey, maxRatio, details }
   */
  evaluateChoiceGroup(items, imageData, transformPointFn = null) {
    if (!items || items.length === 0) {
      return { status: 'BLANK', selectedKey: null, details: [] };
    }

    // Đọc fillRatio cho từng item trong nhóm
    const details = items.map((it) => {
      let pt = { x: it.cx, y: it.cy };
      if (typeof transformPointFn === 'function') {
        pt = transformPointFn(it.cx, it.cy);
      }
      const metrics = this.readBubbleFillRatio(imageData, pt.x, pt.y, it.r || 11);
      return {
        key: it.key,
        fillRatio: metrics.fillRatio,
        meanIntensity: metrics.meanIntensity,
        cx: pt.x,
        cy: pt.y
      };
    });

    // Tìm các ô vượt ngưỡng fillRatio > minFillRatio (0.38)
    // VÀ fillRatio > 1.6 * mean(các ô còn lại)
    const passedItems = [];

    for (let i = 0; i < details.length; i++) {
      const cur = details[i];
      if (cur.fillRatio >= this.minFillRatio) {
        const others = details.filter((_, idx) => idx !== i);
        const meanOthers = others.length > 0 
          ? others.reduce((acc, o) => acc + o.fillRatio, 0) / others.length 
          : 0;

        // Tỷ lệ so với các ô còn lại trong nhóm
        const isDominant = meanOthers === 0 
          ? true 
          : (cur.fillRatio >= this.relativeRatioThreshold * meanOthers);

        if (isDominant) {
          passedItems.push({ ...cur, meanOthers });
        }
      }
    }

    // Kết luận trạng thái
    if (passedItems.length === 0) {
      return {
        status: 'BLANK',
        selectedKey: null,
        passedCount: 0,
        details
      };
    } else if (passedItems.length === 1) {
      return {
        status: 'OK',
        selectedKey: passedItems[0].key,
        confidence: passedItems[0].fillRatio,
        passedCount: 1,
        details
      };
    } else {
      // Tô từ 2 ô trở lên trong 1 nhóm
      return {
        status: 'DOUBLE_MARK',
        selectedKey: null,
        passedCount: passedItems.length,
        candidateKeys: passedItems.map(p => p.key),
        details
      };
    }
  }

  /**
   * 2. CHẤM PHẦN I (Nhiều lựa chọn A, B, C, D)
   */
  gradePart1(questionsConfig, answerKey = {}, imageData, transformPointFn, pointPerQuestion = 0.25) {
    if (!questionsConfig || !Array.isArray(questionsConfig)) return { totalScore: 0, results: [] };

    let totalScore = 0;
    const results = [];

    for (const q of questionsConfig) {
      const qNum = q.question;
      const expected = answerKey[qNum] || answerKey[String(qNum)] || null;

      const items = Object.entries(q.options).map(([opt, coord]) => ({
        key: opt,
        cx: coord.cx,
        cy: coord.cy,
        r: coord.r
      }));

      const evalRes = this.evaluateChoiceGroup(items, imageData, transformPointFn);
      const studentAnswer = evalRes.selectedKey;
      let isCorrect = false;
      let score = 0;

      if (evalRes.status === 'OK' && expected && studentAnswer.toUpperCase() === expected.toUpperCase()) {
        isCorrect = true;
        score = pointPerQuestion;
        totalScore += score;
      }

      results.push({
        question: qNum,
        studentAnswer: studentAnswer || (evalRes.status === 'DOUBLE_MARK' ? 'ĐÚP' : 'TRỐNG'),
        expectedAnswer: expected,
        status: evalRes.status,
        isCorrect,
        score,
        details: evalRes.details
      });
    }

    return {
      totalScore: Math.round(totalScore * 100) / 100,
      results
    };
  }

  /**
   * 3. CHẤM PHẦN II (Trắc nghiệm Đúng / Sai: a, b, c, d)
   * Thang điểm lũy tiến GDPT 2018: 1 ý đúng = 0.1đ, 2 ý = 0.25đ, 3 ý = 0.5đ, 4 ý = 1.0đ
   */
  gradePart2(questionsConfig, answerKey = {}, imageData, transformPointFn, ladder = [0, 0.1, 0.25, 0.5, 1.0]) {
    if (!questionsConfig || !Array.isArray(questionsConfig)) return { totalScore: 0, results: [] };

    let totalScore = 0;
    const results = [];

    for (const q of questionsConfig) {
      const qNum = q.question;
      const expectedItems = answerKey[qNum] || answerKey[String(qNum)] || {};
      const subResults = {};
      let correctSubCount = 0;

      for (const [subKey, optObj] of Object.entries(q.items)) {
        // optObj = { D: { cx, cy, r }, S: { cx, cy, r } }
        const items = [
          { key: 'D', cx: optObj.D.cx, cy: optObj.D.cy, r: optObj.D.r },
          { key: 'S', cx: optObj.S.cx, cy: optObj.S.cy, r: optObj.S.r }
        ];

        const evalRes = this.evaluateChoiceGroup(items, imageData, transformPointFn);
        const studentChoice = evalRes.selectedKey;
        const expectedChoice = expectedItems[subKey] || null;

        const isSubCorrect = (evalRes.status === 'OK' && expectedChoice && studentChoice.toUpperCase() === expectedChoice.toUpperCase());
        if (isSubCorrect) correctSubCount++;

        subResults[subKey] = {
          studentChoice: studentChoice || (evalRes.status === 'DOUBLE_MARK' ? 'ĐÚP' : 'TRỐNG'),
          expectedChoice,
          isCorrect: isSubCorrect,
          status: evalRes.status
        };
      }

      // Điểm lũy tiến cho câu hỏi này
      const qScore = ladder[Math.min(correctSubCount, ladder.length - 1)] || 0;
      totalScore += qScore;

      results.push({
        question: qNum,
        correctSubCount,
        subResults,
        score: qScore,
        maxScore: ladder[ladder.length - 1]
      });
    }

    return {
      totalScore: Math.round(totalScore * 100) / 100,
      results
    };
  }

  /**
   * 4. QUY TẮC GIẢI MÃ PHẦN III (Trả lời ngắn - 4 cột x 12 hàng)
   * 
   * Cột 1: Dấu '-' và các số 0-9
   * Cột 2, 3: Dấu ',' và các số 0-9
   * Cột 4: Các số 0-9
   * Ghép lại, cắt khoảng trắng, đổi ',' thành '.', so sánh chuỗi chuẩn hóa & parseFloat
   */
  gradePart3(questionsConfig, answerKey = {}, imageData, transformPointFn, pointPerQuestion = 0.5) {
    if (!questionsConfig || !Array.isArray(questionsConfig)) return { totalScore: 0, results: [] };

    let totalScore = 0;
    const results = [];

    for (const q of questionsConfig) {
      const qNum = q.question;
      const expected = answerKey[qNum] || answerKey[String(qNum)] || null;

      let decodedChars = [];
      const columnDetails = [];

      for (const col of q.columns) {
        const items = Object.entries(col.elements).map(([elemKey, coord]) => ({
          key: elemKey,
          cx: coord.cx,
          cy: coord.cy,
          r: coord.r
        }));

        const evalRes = this.evaluateChoiceGroup(items, imageData, transformPointFn);
        if (evalRes.status === 'OK' && evalRes.selectedKey) {
          decodedChars.push(evalRes.selectedKey);
        } else if (evalRes.status === 'DOUBLE_MARK') {
          decodedChars.push('?');
        } else {
          // Trống
          decodedChars.push('');
        }
        columnDetails.push(evalRes);
      }

      // Ghép 4 cột lại thành chuỗi trả lời của học sinh
      const rawString = decodedChars.join('').trim();
      const studentNormalized = this.normalizeShortAnswer(rawString);
      const isCorrect = this.compareShortAnswer(studentNormalized, expected);

      let score = 0;
      if (isCorrect) {
        score = pointPerQuestion;
        totalScore += score;
      }

      results.push({
        question: qNum,
        rawString: rawString || 'TRỐNG',
        normalizedAnswer: studentNormalized,
        expectedAnswer: expected,
        isCorrect,
        score,
        columnDetails
      });
    }

    return {
      totalScore: Math.round(totalScore * 100) / 100,
      results
    };
  }

  /**
   * Chuẩn hóa đáp án trả lời ngắn
   */
  normalizeShortAnswer(ansStr) {
    if (!ansStr) return '';
    let s = String(ansStr).trim().replace(/\s+/g, '');
    s = s.replace(/,/g, '.'); // Đổi phẩy sang chấm
    return s;
  }

  /**
   * So sánh đáp án ngắn của học sinh với đáp án chuẩn
   * Hỗ trợ so sánh chuỗi chuẩn hóa và giá trị số thực (ví dụ: '1.5' khớp '1.50' hay '01.5')
   */
  compareShortAnswer(studentAns, expectedAns) {
    if (!studentAns || !expectedAns) return false;

    const sNorm = this.normalizeShortAnswer(studentAns);
    const eNorm = this.normalizeShortAnswer(expectedAns);

    // 1. Khớp chuỗi chính xác
    if (sNorm === eNorm) return true;

    // 2. Khớp giá trị số học parseFloat
    const sNum = parseFloat(sNorm);
    const eNum = parseFloat(eNorm);

    if (!isNaN(sNum) && !isNaN(eNum)) {
      if (Math.abs(sNum - eNum) < 1e-4) {
        return true;
      }
    }

    return false;
  }

  /**
   * 5. ĐỌC SỐ BÁO DANH (SBD)
   */
  readSBD(sbdConfig, imageData, transformPointFn) {
    if (!sbdConfig || !sbdConfig.all_columns) return '---';

    const cols = sbdConfig.all_columns;
    const digits = [];

    // Thường lấy 6 cột chuẩn từ phải sang trái hoặc theo standard_6_cols_indices
    const activeCols = sbdConfig.standard_6_cols_indices 
      ? sbdConfig.standard_6_cols_indices.map(idx => cols[idx]).filter(Boolean)
      : cols.slice(-6);

    for (const col of activeCols) {
      const items = col.digits.map(d => ({
        key: String(d.digit),
        cx: d.cx,
        cy: d.cy,
        r: d.r
      }));

      const evalRes = this.evaluateChoiceGroup(items, imageData, transformPointFn);
      if (evalRes.status === 'OK' && evalRes.selectedKey) {
        digits.push(evalRes.selectedKey);
      } else {
        digits.push('-');
      }
    }

    return digits.join('');
  }

  /**
   * 6. ĐỌC MÃ ĐỀ THI
   */
  readMade(madeConfig, imageData, transformPointFn) {
    if (!madeConfig || !madeConfig.all_columns) return '---';

    const cols = madeConfig.all_columns;
    const digits = [];

    const activeCols = madeConfig.standard_3_cols_indices
      ? madeConfig.standard_3_cols_indices.map(idx => cols[idx]).filter(Boolean)
      : cols.slice(-3);

    for (const col of activeCols) {
      const items = col.digits.map(d => ({
        key: String(d.digit),
        cx: d.cx,
        cy: d.cy,
        r: d.r
      }));

      const evalRes = this.evaluateChoiceGroup(items, imageData, transformPointFn);
      if (evalRes.status === 'OK' && evalRes.selectedKey) {
        digits.push(evalRes.selectedKey);
      } else {
        digits.push('-');
      }
    }

    return digits.join('');
  }

  /**
   * 7. CHẤM TOÀN BỘ BÀI THI (Full Sheet Grader)
   * 
   * @param {Object} templateConfig - Cấu hình mẫu phiếu từ templates_coords.json
   * @param {Object} answerKey - { part1: {}, part2: {}, part3: {} }
   * @param {ImageData} imageData - Dữ liệu ảnh 1200x1700
   * @param {Object} options - { essayScore, customScoreConfig, transformPointFn }
   * @returns {Object} Kết quả chấm điểm chi tiết
   */
  gradeSheet(templateConfig, answerKey = {}, imageData, options = {}) {
    const tmplId = templateConfig.template_id || 'QM_12_04_06';
    const cfg = options.customScoreConfig || this.scoreConfigs[tmplId] || this.scoreConfigs['QM_12_04_06'];
    const transformPointFn = options.transformPointFn || ((x, y) => ({ x, y }));
    const essayScore = parseFloat(options.essayScore) || 0.0;

    // Đọc SBD & Mã đề
    const sbd = this.readSBD(templateConfig.zones.SBD, imageData, transformPointFn);
    const made = this.readMade(templateConfig.zones.MA_DE, imageData, transformPointFn);

    // Chấm từng phần
    const p1 = this.gradePart1(
      templateConfig.zones.PHAN_I?.questions,
      answerKey.part1,
      imageData,
      transformPointFn,
      cfg.part1.pointPerQuestion
    );

    const p2 = this.gradePart2(
      templateConfig.zones.PHAN_II?.questions,
      answerKey.part2,
      imageData,
      transformPointFn,
      cfg.part2.ladder
    );

    const p3 = this.gradePart3(
      templateConfig.zones.PHAN_III?.questions,
      answerKey.part3,
      imageData,
      transformPointFn,
      cfg.part3.pointPerQuestion
    );

    // Điểm Phần IV (Tự luận - Mẫu 12-02-04)
    const p4Score = tmplId === 'QM_12_02_04' ? Math.min(cfg.part4.maxScore || 3.0, essayScore) : 0.0;

    // Tổng điểm
    const totalRaw = p1.totalScore + p2.totalScore + p3.totalScore + p4Score;
    const finalScore = Math.min(10.0, Math.round(totalRaw * 100) / 100);

    return {
      templateId: tmplId,
      templateName: templateConfig.name,
      sbd,
      made,
      scores: {
        part1: p1.totalScore,
        part2: p2.totalScore,
        part3: p3.totalScore,
        part4: p4Score,
        total: finalScore
      },
      maxScores: {
        part1: cfg.part1.maxScore,
        part2: cfg.part2.maxScore,
        part3: cfg.part3.maxScore,
        part4: cfg.part4?.maxScore || 0,
        total: 10.0
      },
      details: {
        part1: p1.results,
        part2: p2.results,
        part3: p3.results
      }
    };
  }
}

// Xuất module cho môi trường Browser / Node
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QM2025Grader;
} else if (typeof window !== 'undefined') {
  window.QM2025Grader = QM2025Grader;
}
