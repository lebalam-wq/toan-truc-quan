/**
 * js/scanner_engine.js
 * ---------------------
 * Bộ xử lý thị giác máy tính OMR thời gian thực cho phiếu trắc nghiệm QM2025 (chuẩn CV 1239).
 * Sử dụng OpenCV.js chạy tối ưu trên iOS Safari PWA (iPhone).
 * 
 * Chức năng cốt lõi:
 * 1. Bắt 4 góc tổng (Outer Fiducial Markers) & Warp Perspective 1200x1700.
 * 2. Căn chỉnh cục bộ từng Phần (Sub-block Local Alignment).
 * 3. Cơ chế Chống rung (Auto-Trigger Stability: di chuyển < 8px trong 4 frames liên tiếp).
 */

class QM2025ScannerEngine {
  constructor(options = {}) {
    this.targetWidth = options.targetWidth || 1200;
    this.targetHeight = options.targetHeight || 1700;
    this.stabilityThreshold = options.stabilityThreshold || 8.0; // pixels
    this.requiredStableFrames = options.requiredStableFrames || 4;
    
    // Trạng thái chống rung
    this.cornerHistory = [];
    this.stableFrames = 0;
    this.isStable = false;
    this.lastDetectedCorners = null;

    // Callbacks
    this.onStatusChange = options.onStatusChange || null;
    this.onStableLock = options.onStableLock || null;
    this.onError = options.onError || null;

    this.isOpenCvReady = typeof cv !== 'undefined' && cv.Mat !== undefined;
    if (!this.isOpenCvReady && typeof window !== 'undefined') {
      window.addEventListener('opencv-ready', () => {
        this.isOpenCvReady = true;
        console.log('[ScannerEngine] OpenCV.js đã sẵn sàng.');
      });
    }
  }

  /**
   * Kiểm tra khoảng cách Euclidean giữa 2 điểm
   */
  distance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Sắp xếp 4 góc theo thứ tự chuẩn: [Top-Left, Top-Right, Bottom-Right, Bottom-Left]
   */
  orderCorners(pts) {
    if (!pts || pts.length !== 4) return null;

    // Sắp xếp theo tổng x + y và hiệu y - x
    // Top-Left: x + y nhỏ nhất
    // Bottom-Right: x + y lớn nhất
    // Top-Right: x - y lớn nhất (hoặc y - x nhỏ nhất)
    // Bottom-Left: x - y nhỏ nhất (hoặc y - x lớn nhất)
    const ptsCopy = [...pts];

    ptsCopy.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    const tl = ptsCopy[0];
    const br = ptsCopy[3];

    const remaining = [ptsCopy[1], ptsCopy[2]];
    remaining.sort((a, b) => (a.x - a.y) - (b.x - b.y));
    const bl = remaining[0];
    const tr = remaining[1];

    return [tl, tr, br, bl];
  }

  /**
   * 1. BẮT 4 GÓC TỔNG (Outer Fiducial Markers) VÀ WARP PHỐI CẢNH 1200 x 1700
   * @param {cv.Mat} srcMat - Ảnh đầu vào RGBA từ Camera
   * @returns {Object} { success, warpedMat, corners, isStable, debugThresh }
   */
  detectAndWarpOuterCorners(srcMat) {
    if (!this.isOpenCvReady || !srcMat) {
      return { success: false, error: 'OpenCV chưa sẵn sàng hoặc ảnh rỗng.' };
    }

    const width = srcMat.cols;
    const height = srcMat.rows;

    let gray = new cv.Mat();
    let blurred = new cv.Mat();
    let thresh = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    try {
      // B1: Chuyển sang Grayscale
      cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY);

      // B2: Làm mờ Gaussian (5x5) để triệt tiêu nhiễu hạt cảm biến
      const ksize = new cv.Size(5, 5);
      cv.GaussianBlur(gray, blurred, ksize, 0, 0, cv.BORDER_DEFAULT);

      // B3: Phân ngưỡng thích nghi cv.adaptiveThreshold khử bóng râm khi giáo viên đứng che đèn
      // THRESH_BINARY_INV biến ô vuông đen thành màu trắng nổi trên nền đen
      cv.adaptiveThreshold(
        blurred,
        thresh,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY_INV,
        21,
        7
      );

      // B4: Tìm contours
      cv.findContours(thresh, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      const candidateSquares = [];
      const totalArea = width * height;
      const minMarkerArea = totalArea * 0.0003; // Ô góc vuông chiếm tối thiểu ~0.03%
      const maxMarkerArea = totalArea * 0.05;   // Tối đa ~5%

      for (let i = 0; i < contours.size(); ++i) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);

        if (area >= minMarkerArea && area <= maxMarkerArea) {
          const peri = cv.arcLength(cnt, true);
          let approx = new cv.Mat();
          cv.approxPolyDP(cnt, approx, 0.04 * peri, true);

          // Marker vuông có 4 đỉnh hoặc xấp xỉ 4 đỉnh
          if (approx.rows >= 4 && approx.rows <= 6) {
            const rect = cv.boundingRect(cnt);
            const aspect = rect.width / rect.height;

            if (aspect >= 0.75 && aspect <= 1.35) {
              const extent = area / (rect.width * rect.height);
              // Ô vuông đặc có extent cao (> 0.65)
              if (extent >= 0.65) {
                const M = cv.moments(cnt);
                if (M.m00 !== 0) {
                  const cx = M.m10 / M.m00;
                  const cy = M.m01 / M.m00;
                  candidateSquares.push({
                    cx,
                    cy,
                    width: rect.width,
                    height: rect.height,
                    area,
                    rect,
                    approx
                  });
                }
              }
            }
          }
          approx.delete();
        }
        cnt.delete();
      }

      // B5: Xác định 4 ô vuông ngoài cùng ở 4 góc
      if (candidateSquares.length < 4) {
        return {
          success: false,
          error: `Chỉ tìm thấy ${candidateSquares.length}/4 ô marker góc.`,
          detectedCount: candidateSquares.length
        };
      }

      // Lọc lấy 4 ô gần 4 góc nhất của khung hình
      let bestTL = null, bestTR = null, bestBR = null, bestBL = null;
      let minTL = Infinity, minTR = Infinity, minBR = -Infinity, minBL = Infinity;

      for (const sq of candidateSquares) {
        const sumXY = sq.cx + sq.cy;
        const diffYX = sq.cy - sq.cx;
        const diffXY = sq.cx - sq.cy;

        if (sumXY < minTL) { minTL = sumXY; bestTL = sq; }
        if (sumXY > minBR) { minBR = sumXY; bestBR = sq; }
        if (diffYX > minBL) { minBL = diffYX; bestBL = sq; }
        if (diffXY > minTR) { minTR = diffXY; bestTR = sq; }
      }

      // Đảm bảo 4 ô riêng biệt
      const uniqueSelected = new Set([bestTL, bestTR, bestBR, bestBL]);
      if (uniqueSelected.size !== 4) {
        // Fallback chọn 4 ô xa tâm nhất theo 4 góc phần tư
        const halfW = width / 2;
        const halfH = height / 2;
        const q1 = candidateSquares.filter(s => s.cx < halfW && s.cy < halfH);
        const q2 = candidateSquares.filter(s => s.cx >= halfW && s.cy < halfH);
        const q3 = candidateSquares.filter(s => s.cx >= halfW && s.cy >= halfH);
        const q4 = candidateSquares.filter(s => s.cx < halfW && s.cy >= halfH);

        if (q1.length && q2.length && q3.length && q4.length) {
          bestTL = q1.reduce((p, c) => (c.cx + c.cy < p.cx + p.cy ? c : p));
          bestTR = q2.reduce((p, c) => (c.cx - c.cy > p.cx - p.cy ? c : p));
          bestBR = q3.reduce((p, c) => (c.cx + c.cy > p.cx + p.cy ? c : p));
          bestBL = q4.reduce((p, c) => (c.cy - c.cx > p.cy - p.cx ? c : p));
        } else {
          return { success: false, error: 'Không thể phân bố 4 ô góc vào 4 góc phần tư.' };
        }
      }

      // Lấy 4 điểm góc ngoài cùng của 4 ô vuông góc
      const rawCorners = [
        { x: bestTL.rect.x, y: bestTL.rect.y },                                      // TL outer
        { x: bestTR.rect.x + bestTR.rect.width, y: bestTR.rect.y },                  // TR outer
        { x: bestBR.rect.x + bestBR.rect.width, y: bestBR.rect.y + bestBR.rect.height }, // BR outer
        { x: bestBL.rect.x, y: bestBL.rect.y + bestBL.rect.height }                  // BL outer
      ];

      const orderedCorners = this.orderCorners(rawCorners);

      // B6: Kiểm tra tính ổn định chống rung (Auto-Trigger Stability)
      const stabilityResult = this.checkStability(orderedCorners);

      // B7: Thực hiện Warp Perspective đưa toàn bộ phiếu về chuẩn 1200 x 1700
      const warpedMat = new cv.Mat();
      const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        orderedCorners[0].x, orderedCorners[0].y,
        orderedCorners[1].x, orderedCorners[1].y,
        orderedCorners[2].x, orderedCorners[2].y,
        orderedCorners[3].x, orderedCorners[3].y
      ]);

      const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0,
        this.targetWidth, 0,
        this.targetWidth, this.targetHeight,
        0, this.targetHeight
      ]);

      const M = cv.getPerspectiveTransform(srcTri, dstTri);
      const dsize = new cv.Size(this.targetWidth, this.targetHeight);
      cv.warpPerspective(srcMat, warpedMat, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

      srcTri.delete();
      dstTri.delete();
      M.delete();

      return {
        success: true,
        warpedMat,
        corners: orderedCorners,
        isStable: stabilityResult.isStable,
        stableFrames: stabilityResult.stableFrames,
        maxDelta: stabilityResult.maxDelta
      };

    } catch (err) {
      console.error('[ScannerEngine] Lỗi trong detectAndWarpOuterCorners:', err);
      return { success: false, error: err.message || String(err) };
    } finally {
      gray.delete();
      blurred.delete();
      thresh.delete();
      contours.delete();
      hierarchy.delete();
    }
  }

  /**
   * 2. CĂN CHỈNH CỤC BỘ TỪNG PHÂN KHU (Sub-block Local Alignment)
   * Tự động tìm 4 điểm neo đen (Sub-markers) quanh từng vùng để nắn phẳng lần 2.
   * 
   * @param {cv.Mat} warpedMat - Ảnh đã warp 1200x1700
   * @param {Object} subMarkerConfig - { top_left: [x,y], top_right: [x,y], bottom_left: [x,y], bottom_right: [x,y] }
   * @param {number} searchRadius - Bán kính tìm kiếm quanh tọa độ lý thuyết (mặc định 28px)
   * @returns {Object} { success, localTransformMatrix, detectedMarkers, transformPointFn }
   */
  alignSubRegion(warpedMat, subMarkerConfig, searchRadius = 28) {
    if (!warpedMat || !subMarkerConfig) {
      return { success: false, error: 'Thiếu warpedMat hoặc subMarkerConfig' };
    }

    const theoreticalPoints = {
      TL: { x: subMarkerConfig.top_left[0], y: subMarkerConfig.top_left[1] },
      TR: { x: subMarkerConfig.top_right[0], y: subMarkerConfig.top_right[1] },
      BR: { x: subMarkerConfig.bottom_right[0], y: subMarkerConfig.bottom_right[1] },
      BL: { x: subMarkerConfig.bottom_left[0], y: subMarkerConfig.bottom_left[1] }
    };

    const detectedPoints = {};
    const keys = ['TL', 'TR', 'BR', 'BL'];

    for (const key of keys) {
      const thPt = theoreticalPoints[key];
      const roiX = Math.max(0, Math.round(thPt.x - searchRadius));
      const roiY = Math.max(0, Math.round(thPt.y - searchRadius));
      const roiW = Math.min(warpedMat.cols - roiX, searchRadius * 2);
      const roiH = Math.min(warpedMat.rows - roiY, searchRadius * 2);

      if (roiW <= 5 || roiH <= 5) {
        detectedPoints[key] = thPt;
        continue;
      }

      const rect = new cv.Rect(roiX, roiY, roiW, roiH);
      const roiMat = warpedMat.roi(rect);

      let roiGray = new cv.Mat();
      let roiThresh = new cv.Mat();
      let roiContours = new cv.MatVector();
      let roiHierarchy = new cv.Mat();

      try {
        cv.cvtColor(roiMat, roiGray, cv.COLOR_RGBA2GRAY);
        cv.adaptiveThreshold(
          roiGray,
          roiThresh,
          255,
          cv.ADAPTIVE_THRESH_GAUSSIAN_C,
          cv.THRESH_BINARY_INV,
          15,
          5
        );

        cv.findContours(roiThresh, roiContours, roiHierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

        let bestMarker = null;
        let minCenterDist = Infinity;

        // Sub-marker đen trên ảnh 1200x1700 có diện tích khoảng 30 - 250 px²
        for (let j = 0; j < roiContours.size(); ++j) {
          const cnt = roiContours.get(j);
          const area = cv.contourArea(cnt);

          if (area >= 20 && area <= 400) {
            const bRect = cv.boundingRect(cnt);
            const aspect = bRect.width / bRect.height;

            if (aspect >= 0.7 && aspect <= 1.4) {
              const M = cv.moments(cnt);
              if (M.m00 !== 0) {
                const localCx = M.m10 / M.m00;
                const localCy = M.m01 / M.m00;
                const globalX = roiX + localCx;
                const globalY = roiY + localCy;

                const distToTh = Math.hypot(globalX - thPt.x, globalY - thPt.y);
                if (distToTh < minCenterDist) {
                  minCenterDist = distToTh;
                  bestMarker = { x: globalX, y: globalY, area };
                }
              }
            }
          }
          cnt.delete();
        }

        detectedPoints[key] = bestMarker ? { x: bestMarker.x, y: bestMarker.y } : thPt;

      } catch (e) {
        detectedPoints[key] = thPt;
      } finally {
        roiMat.delete();
        roiGray.delete();
        roiThresh.delete();
        roiContours.delete();
        roiHierarchy.delete();
      }
    }

    // Xây dựng ma trận chuyển vị cục bộ (Local Perspective Transform)
    // Ánh xạ từ tọa độ thực tế phát hiện được về tọa độ chuẩn lý thuyết
    try {
      const srcSub = cv.matFromArray(4, 1, cv.CV_32FC2, [
        detectedPoints.TL.x, detectedPoints.TL.y,
        detectedPoints.TR.x, detectedPoints.TR.y,
        detectedPoints.BR.x, detectedPoints.BR.y,
        detectedPoints.BL.x, detectedPoints.BL.y
      ]);

      const dstSub = cv.matFromArray(4, 1, cv.CV_32FC2, [
        theoreticalPoints.TL.x, theoreticalPoints.TL.y,
        theoreticalPoints.TR.x, theoreticalPoints.TR.y,
        theoreticalPoints.BR.x, theoreticalPoints.BR.y,
        theoreticalPoints.BL.x, theoreticalPoints.BL.y
      ]);

      const localM = cv.getPerspectiveTransform(srcSub, dstSub);

      srcSub.delete();
      dstSub.delete();

      // Hàm ánh xạ điểm lý thuyết (cx, cy) sang tọa độ thực tế trên warpedMat
      // để đọc chính xác tuyệt đối giá trị tô đậm
      const transformPointFn = (cx, cy) => {
        // Ánh xạ ngược (Inverse) hoặc dùng phép nội suy bilinear
        const u = (cx - theoreticalPoints.TL.x) / (theoreticalPoints.TR.x - theoreticalPoints.TL.x || 1);
        const v = (cy - theoreticalPoints.TL.y) / (theoreticalPoints.BL.y - theoreticalPoints.TL.y || 1);

        const topX = detectedPoints.TL.x + u * (detectedPoints.TR.x - detectedPoints.TL.x);
        const topY = detectedPoints.TL.y + u * (detectedPoints.TR.y - detectedPoints.TL.y);
        const botX = detectedPoints.BL.x + u * (detectedPoints.BR.x - detectedPoints.BL.x);
        const botY = detectedPoints.BL.y + u * (detectedPoints.BR.y - detectedPoints.BL.y);

        return {
          x: topX + v * (botX - topX),
          y: topY + v * (botY - topY)
        };
      };

      return {
        success: true,
        detectedPoints,
        theoreticalPoints,
        localM,
        transformPointFn
      };

    } catch (err) {
      console.warn('[ScannerEngine] alignSubRegion transform error:', err);
      return {
        success: false,
        error: err.message,
        transformPointFn: (cx, cy) => ({ x: cx, y: cy })
      };
    }
  }

  /**
   * 3. CƠ CHẾ CHỐNG RUNG (Auto-Trigger Stability)
   * Kiểm tra độ dịch chuyển của 4 góc qua các khung hình liên tiếp.
   * Nếu di chuyển dưới 8 pixels trong 4 khung hình liên tiếp -> Kích hoạt chụp và chấm tự động.
   * 
   * @param {Array} currentCorners - Mảng 4 góc [TL, TR, BR, BL]
   * @returns {Object} { isStable, stableFrames, maxDelta }
   */
  checkStability(currentCorners) {
    if (!currentCorners || currentCorners.length !== 4) {
      this.resetStability();
      return { isStable: false, stableFrames: 0, maxDelta: Infinity };
    }

    if (this.cornerHistory.length === 0) {
      this.cornerHistory.push(currentCorners);
      this.stableFrames = 1;
      return { isStable: false, stableFrames: 1, maxDelta: 0 };
    }

    const prevCorners = this.cornerHistory[this.cornerHistory.length - 1];
    let maxDelta = 0;

    for (let i = 0; i < 4; i++) {
      const d = this.distance(currentCorners[i], prevCorners[i]);
      if (d > maxDelta) maxDelta = d;
    }

    if (maxDelta <= this.stabilityThreshold) {
      this.stableFrames += 1;
      this.cornerHistory.push(currentCorners);
      if (this.cornerHistory.length > this.requiredStableFrames) {
        this.cornerHistory.shift();
      }

      if (this.stableFrames >= this.requiredStableFrames) {
        this.isStable = true;
        if (typeof this.onStableLock === 'function') {
          this.onStableLock(currentCorners);
        }
      }
    } else {
      // Bị rung quá 8 pixels -> Reset bộ đếm ổn định
      this.stableFrames = 1;
      this.cornerHistory = [currentCorners];
      this.isStable = false;
    }

    return {
      isStable: this.isStable,
      stableFrames: this.stableFrames,
      maxDelta: Math.round(maxDelta * 10) / 10
    };
  }

  /**
   * Reset bộ đếm chống rung khi mất dấu phiếu
   */
  resetStability() {
    this.cornerHistory = [];
    this.stableFrames = 0;
    this.isStable = false;
  }
}

// Xuất module cho môi trường Browser / ES Module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QM2025ScannerEngine;
} else if (typeof window !== 'undefined') {
  window.QM2025ScannerEngine = QM2025ScannerEngine;
}
