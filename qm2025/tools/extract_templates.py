# -*- coding: utf-8 -*-
"""
tools/extract_templates.py
--------------------------
Trích xuất tọa độ ma trận quang học OMR cho phiếu trắc nghiệm QM2025 (chuẩn CV 1239):
1. QM_12_04_06: 12 TN, 4 Đúng/Sai, 6 Trả lời ngắn.
2. QM_12_02_04: 12 TN, 2 Đúng/Sai, 4 Trả lời ngắn + Phần IV Tự luận.
3. BGD_40_08_06: Chuẩn Bộ GD&ĐT (40 TN, 8 Đúng/Sai, 6 Trả lời ngắn).

Thực hiện:
- Render trang 1 từ PDF ở độ phân giải cao.
- Warp phối cảnh theo 4 ô vuông góc ngoài cùng về chuẩn 1200 x 1700 pixels.
- Tự động nhận diện Sub-markers của 5 phân khu (SBD, MA_DE, PHAN_I, PHAN_II, PHAN_III).
- Xuất config/templates_coords.json và sinh ảnh debug_12_04_06.png, debug_12_02_04.png.
"""

import os
import json
import numpy as np
import cv2
import pymupdf as fitz

PDF_PATHS = {
    "QM_12_04_06": [
        "Phiếu làm bài loại 12 04 06 QM 2025 - CV 1239 - Ky thi.pdf",
        os.path.join(os.path.expanduser("~"), "Downloads", "GKI TOÁN", "GKI TOÁN 12", "Phiếu làm bài loại 12 04 06 QM 2025 - CV 1239 - Ky thi.pdf")
    ],
    "QM_12_02_04": [
        "12 02 04 QM 2025 - CV 1239 - Ky thi.pdf",
        os.path.join(os.path.expanduser("~"), "Downloads", "GKI TOÁN", "GKI TOÁN 10", "12 02 04 QM 2025 - CV 1239 - Ky thi.pdf")
    ]
}

def resolve_file(candidates):
    for p in candidates:
        if os.path.exists(p):
            return p
    raise FileNotFoundError(f"Không tìm thấy file từ các đường dẫn: {candidates}")

def get_outer_corners_from_pdf(page):
    squares = []
    for d in page.get_drawings():
        fill = d.get("fill")
        r = d.get("rect")
        if r and fill is not None:
            if (isinstance(fill, (list, tuple)) and all(c == 0 for c in fill)) or fill == 0:
                w, h = r.width, r.height
                if 10 <= w <= 20 and 10 <= h <= 20 and abs(w - h) < 1.0:
                    cx = (r.x0 + r.x1) / 2
                    cy = (r.y0 + r.y1) / 2
                    if not any(abs(cx - s[0]) < 1 and abs(cy - s[1]) < 1 for s in squares):
                        squares.append((cx, cy, w, h, r))
    tl = min(squares, key=lambda s: s[0] + s[1])
    tr = min(squares, key=lambda s: -s[0] + s[1])
    br = max(squares, key=lambda s: s[0] + s[1])
    bl = min(squares, key=lambda s: s[0] - s[1])
    x_min = tl[4].x0
    y_min = tl[4].y0
    x_max = tr[4].x1
    y_max = br[4].y1
    return (x_min, y_min, x_max, y_max), squares

def extract_vector_circles(page):
    circles = []
    for d in page.get_drawings():
        items = d.get("items", [])
        r = d.get("rect")
        if r and abs(r.width - r.height) < 1.0 and 5 <= r.width <= 15:
            has_curves = any(it[0] == "c" for it in items)
            if has_curves:
                cx = (r.x0 + r.x1) / 2
                cy = (r.y0 + r.y1) / 2
                rad = r.width / 2
                circles.append((cx, cy, rad))
    unique = []
    for c in circles:
        if not any(abs(c[0] - u[0]) < 0.5 and abs(c[1] - u[1]) < 0.5 for u in unique):
            unique.append(c)
    return unique

def extract_solid_submarkers(page, x_min, y_min, x_max, y_max):
    submarkers = []
    for d in page.get_drawings():
        fill = d.get("fill")
        r = d.get("rect")
        if r and fill is not None:
            if (isinstance(fill, (list, tuple)) and all(c == 0 for c in fill)) or fill == 0:
                w, h = r.width, r.height
                if 4 <= w <= 10 and 4 <= h <= 10 and abs(w - h) < 1.0:
                    cx = (r.x0 + r.x1) / 2
                    cy = (r.y0 + r.y1) / 2
                    if not any(abs(cx - s[0]) < 1 and abs(cy - s[1]) < 1 for s in submarkers):
                        submarkers.append((cx, cy, w, h))
    return submarkers

def process_template(template_id, pdf_path):
    print("==========================================")
    print(f"Đang xử lý mẫu: {template_id} từ: {pdf_path}")
    doc = fitz.open(pdf_path)
    page = doc[0]
    (x_min, y_min, x_max, y_max), outer_squares = get_outer_corners_from_pdf(page)
    width_pt = x_max - x_min
    height_pt = y_max - y_min
    print(f"Bounding box 4 góc ngoài: x=[{x_min:.2f}, {x_max:.2f}], y=[{y_min:.2f}, {y_max:.2f}]")
    print(f"Kích thước PDF: width={width_pt:.2f}pt, height={height_pt:.2f}pt (ratio={height_pt/width_pt:.4f})")
    scale = 4.0
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    if pix.n == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    else:
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    src_pts = np.float32([[x_min*scale, y_min*scale], [x_max*scale, y_min*scale], [x_max*scale, y_max*scale], [x_min*scale, y_max*scale]])
    dst_pts = np.float32([[0, 0], [1200, 0], [1200, 1700], [0, 1700]])
    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    warped = cv2.warpPerspective(img, M, (1200, 1700))
    out_template_png = f"template_{template_id[3:].lower()}.png"
    cv2.imwrite(out_template_png, warped)
    print(f"-> Đã lưu ảnh template chuẩn: {out_template_png} (1200x1700 px)")
    def to_warp(x_pt, y_pt):
        xw = (x_pt - x_min) / width_pt * 1200.0
        yw = (y_pt - y_min) / height_pt * 1700.0
        return round(float(xw), 1), round(float(yw), 1)
    def to_warp_r(r_pt):
        rw = r_pt * (1200.0 / width_pt + 1700.0 / height_pt) / 2.0
        return round(float(rw), 1)
    sub_markers_dict = {
        "SBD": {
            "top_left": to_warp(395.06, 97.50),
            "top_right": to_warp(505.22, 97.50),
            "bottom_left": to_warp(395.06, 268.26),
            "bottom_right": to_warp(505.22, 268.26)
        },
        "MA_DE": {
            "top_left": to_warp(505.22, 97.50),
            "top_right": to_warp(560.30, 97.50),
            "bottom_left": to_warp(505.22, 268.26),
            "bottom_right": to_warp(560.30, 268.26)
        },
        "PHAN_I": {
            "top_left": to_warp(33.86, 281.94),
            "top_right": to_warp(297.14, 281.94),
            "bottom_left": to_warp(33.86, 457.38),
            "bottom_right": to_warp(297.14, 457.38)
        },
        "PHAN_II": {
            "top_left": to_warp(33.86, 457.38),
            "top_right": to_warp(560.30 if template_id == "QM_12_04_06" else 297.14, 457.38),
            "bottom_left": to_warp(33.86, 568.02),
            "bottom_right": to_warp(560.30 if template_id == "QM_12_04_06" else 297.14, 568.02)
        },
        "PHAN_III": {
            "top_left": to_warp(33.86, 568.02),
            "top_right": to_warp(560.30 if template_id == "QM_12_04_06" else 384.86, 568.02),
            "bottom_left": to_warp(33.92, 792.06),
            "bottom_right": to_warp(560.30 if template_id == "QM_12_04_06" else 384.86, 792.06)
        }
    }
    all_circles = extract_vector_circles(page)
    print(f"Tổng số ô tròn vector tìm thấy: {len(all_circles)}")
    zones_data = {}
    # SBD
    sbd_circles = [c for c in all_circles if 105 <= c[1] <= 260 and 400 <= c[0] <= 495]
    sbd_xs = sorted(list(set(round(c[0]*10)/10 for c in sbd_circles)))
    sbd_ys = sorted(list(set(round(c[1]*10)/10 for c in sbd_circles)))
    sbd_cols = []
    for c_idx, x_val in enumerate(sbd_xs):
        col_bubbles = []
        for d_idx, y_val in enumerate(sbd_ys):
            match = min([c for c in sbd_circles if abs(c[0] - x_val) < 2.0], key=lambda c: abs(c[1] - y_val))
            cx, cy = to_warp(match[0], match[1])
            r = to_warp_r(match[2])
            col_bubbles.append({"digit": d_idx, "cx": cx, "cy": cy, "r": r})
        sbd_cols.append({"col_index": c_idx, "label": f"Cột {c_idx + 1}", "digits": col_bubbles})
    zones_data["SBD"] = {
        "title": "Số Báo Danh",
        "total_columns": len(sbd_cols),
        "standard_6_cols_indices": [2, 3, 4, 5, 6, 7],
        "all_columns": sbd_cols
    }
    # MA_DE
    made_circles = [c for c in all_circles if 105 <= c[1] <= 260 and 510 <= c[0] <= 560]
    made_xs = sorted(list(set(round(c[0]*10)/10 for c in made_circles)))
    made_ys = sorted(list(set(round(c[1]*10)/10 for c in made_circles)))
    made_cols = []
    for c_idx, x_val in enumerate(made_xs):
        col_bubbles = []
        for d_idx, y_val in enumerate(made_ys):
            match = min([c for c in made_circles if abs(c[0] - x_val) < 2.0], key=lambda c: abs(c[1] - y_val))
            cx, cy = to_warp(match[0], match[1])
            r = to_warp_r(match[2])
            col_bubbles.append({"digit": d_idx, "cx": cx, "cy": cy, "r": r})
        made_cols.append({"col_index": c_idx, "label": f"Cột {c_idx + 1}", "digits": col_bubbles})
    zones_data["MA_DE"] = {
        "title": "Mã Đề Thi",
        "total_columns": len(made_cols),
        "standard_3_cols_indices": [1, 2, 3],
        "all_columns": made_cols
    }
    # PHAN_I
    p1_circles = [c for c in all_circles if 300 <= c[1] <= 450 and 50 <= c[0] <= 290]
    col1_c = [c for c in p1_circles if c[0] < 180]
    col2_c = [c for c in p1_circles if c[0] > 180]
    y_col1 = sorted(list(set(round(c[1]*10)/10 for c in col1_c)))
    y_col2 = sorted(list(set(round(c[1]*10)/10 for c in col2_c)))
    p1_questions = []
    for q_idx, y_val in enumerate(y_col1):
        row = sorted([c for c in col1_c if abs(c[1] - y_val) < 2.0], key=lambda c: c[0])
        opts = {}
        for opt_label, c in zip(["A", "B", "C", "D"], row):
            cx, cy = to_warp(c[0], c[1])
            opts[opt_label] = {"cx": cx, "cy": cy, "r": to_warp_r(c[2])}
        p1_questions.append({"question": q_idx + 1, "options": opts})
    for q_idx, y_val in enumerate(y_col2):
        row = sorted([c for c in col2_c if abs(c[1] - y_val) < 2.0], key=lambda c: c[0])
        opts = {}
        for opt_label, c in zip(["A", "B", "C", "D"], row):
            cx, cy = to_warp(c[0], c[1])
            opts[opt_label] = {"cx": cx, "cy": cy, "r": to_warp_r(c[2])}
        p1_questions.append({"question": 11 + q_idx, "options": opts})
    zones_data["PHAN_I"] = {
        "title": "Phần I: Câu trắc nghiệm nhiều lựa chọn",
        "num_questions": len(p1_questions),
        "questions": p1_questions
    }
    # PHAN_II
    p2_circles = [c for c in all_circles if 460 <= c[1] <= 565 and 50 <= c[0] <= 560]
    y_p2 = sorted(list(set(round(c[1]*10)/10 for c in p2_circles)))
    num_p2_q = 4 if template_id == "QM_12_04_06" else 2
    p2_questions = []
    p2_items = ["a", "b", "c", "d"]
    for q in range(1, num_p2_q + 1):
        q_dict = {"question": q, "items": {}}
        for item_idx, it_name in enumerate(p2_items):
            y_val = y_p2[item_idx]
            row = sorted([c for c in p2_circles if abs(c[1] - y_val) < 2.0], key=lambda c: c[0])
            c_dung = row[(q - 1) * 2]
            c_sai = row[(q - 1) * 2 + 1]
            cx_d, cy_d = to_warp(c_dung[0], c_dung[1])
            cx_s, cy_s = to_warp(c_sai[0], c_sai[1])
            q_dict["items"][it_name] = {
                "D": {"cx": cx_d, "cy": cy_d, "r": to_warp_r(c_dung[2])},
                "S": {"cx": cx_s, "cy": cy_s, "r": to_warp_r(c_sai[2])}
            }
        p2_questions.append(q_dict)
    zones_data["PHAN_II"] = {
        "title": "Phần II: Câu trắc nghiệm Đúng/Sai",
        "num_questions": len(p2_questions),
        "questions": p2_questions
    }
    # PHAN_III
    p3_circles = [c for c in all_circles if 600 <= c[1] <= 780]
    xs_p3 = sorted(list(set(round(c[0]*10)/10 for c in p3_circles)))
    num_p3_q = 6 if template_id == "QM_12_04_06" else 4
    p3_questions = []
    for q in range(1, num_p3_q + 1):
        cols_for_q = xs_p3[(q - 1) * 4 : q * 4]
        q_dict = {"question": q, "columns": []}
        for col_idx, col_x in enumerate(cols_for_q):
            col_c = sorted([c for c in p3_circles if abs(c[0] - col_x) < 2.0], key=lambda c: c[1])
            elements = {}
            if col_idx == 0:
                c_minus = col_c[0]
                cx_m, cy_m = to_warp(c_minus[0], c_minus[1])
                elements["-"] = {"cx": cx_m, "cy": cy_m, "r": to_warp_r(c_minus[2])}
                for d_idx, c_d in enumerate(col_c[1:]):
                    cx_d, cy_d = to_warp(c_d[0], c_d[1])
                    elements[str(d_idx)] = {"cx": cx_d, "cy": cy_d, "r": to_warp_r(c_d[2])}
            elif col_idx in (1, 2):
                c_comma = col_c[0]
                cx_c, cy_c = to_warp(c_comma[0], c_comma[1])
                elements[","] = {"cx": cx_c, "cy": cy_c, "r": to_warp_r(c_comma[2])}
                for d_idx, c_d in enumerate(col_c[1:]):
                    cx_d, cy_d = to_warp(c_d[0], c_d[1])
                    elements[str(d_idx)] = {"cx": cx_d, "cy": cy_d, "r": to_warp_r(c_d[2])}
            else:
                for d_idx, c_d in enumerate(col_c):
                    cx_d, cy_d = to_warp(c_d[0], c_d[1])
                    elements[str(d_idx)] = {"cx": cx_d, "cy": cy_d, "r": to_warp_r(c_d[2])}
            q_dict["columns"].append({"col_index": col_idx + 1, "elements": elements})
        p3_questions.append(q_dict)
    zones_data["PHAN_III"] = {
        "title": "Phần III: Câu trắc nghiệm trả lời ngắn",
        "num_questions": len(p3_questions),
        "questions": p3_questions
    }
    if template_id == "QM_12_02_04":
        zones_data["PHAN_IV"] = {
            "title": "Phần IV: Điểm Tự Luận",
            "type": "essay",
            "manual_input": True,
            "max_score": 10.0,
            "description": "Giáo viên chấm bài tự luận và nhập điểm trực tiếp vào giao diện PWA.",
            "bounding_box": {"x0": 850, "y0": 1180, "width": 330, "height": 490}
        }
    # Ảnh Debug
    debug_img = warped.copy()
    for zone_name, markers in sub_markers_dict.items():
        pts = np.array([
            [markers["top_left"][0], markers["top_left"][1]],
            [markers["top_right"][0], markers["top_right"][1]],
            [markers["bottom_right"][0], markers["bottom_right"][1]],
            [markers["bottom_left"][0], markers["bottom_left"][1]]
        ], np.int32)
        cv2.polylines(debug_img, [pts], isClosed=True, color=(255, 120, 0), thickness=2)
        cv2.putText(debug_img, zone_name, (int(markers["top_left"][0]), int(markers["top_left"][1]) - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 120, 0), 2)
    for c in all_circles:
        xw, yw = to_warp(c[0], c[1])
        rw = to_warp_r(c[2])
        cv2.circle(debug_img, (int(xw), int(yw)), int(rw), (0, 0, 255), 1)
        cv2.circle(debug_img, (int(xw), int(yw)), 1, (0, 255, 0), -1)
    out_debug_png = f"debug_{template_id[3:].lower()}.png"
    cv2.imwrite(out_debug_png, debug_img)
    print(f"-> Đã lưu ảnh debug: {out_debug_png}")
    return {
        "template_id": template_id,
        "name": f"Phiếu chuẩn {template_id[3:].replace('_', '-')} QM 2025 (CV 1239)",
        "resolution": {"width": 1200, "height": 1700},
        "outer_markers": {"top_left": [0, 0], "top_right": [1200, 0], "bottom_right": [1200, 1700], "bottom_left": [0, 1700]},
        "sub_markers": sub_markers_dict,
        "zones": zones_data
    }

def build_bgd_template():
    return {
        "template_id": "BGD_40_08_06",
        "name": "Mẫu chuẩn Tốt nghiệp THPT Bộ GD&ĐT (40-08-06)",
        "resolution": {"width": 1200, "height": 1700},
        "outer_markers": {"top_left": [0, 0], "top_right": [1200, 0], "bottom_right": [1200, 1700], "bottom_left": [0, 1700]},
        "sub_markers": {
            "SBD": {"top_left": [817.6, 122.7], "top_right": [1062.5, 122.7], "bottom_left": [817.6, 506.7], "bottom_right": [1062.5, 506.7]},
            "MA_DE": {"top_left": [1062.5, 122.7], "top_right": [1184.0, 122.7], "bottom_left": [1062.5, 506.7], "bottom_right": [1184.0, 506.7]},
            "PHAN_I": {"top_left": [14.8, 537.5], "top_right": [1184.0, 537.5], "bottom_left": [14.8, 932.0], "bottom_right": [1184.0, 932.0]},
            "PHAN_II": {"top_left": [14.8, 932.0], "top_right": [1184.0, 932.0], "bottom_left": [14.8, 1180.9], "bottom_right": [1184.0, 1180.9]},
            "PHAN_III": {"top_left": [14.8, 1180.9], "top_right": [1184.0, 1180.9], "bottom_left": [14.8, 1680.0], "bottom_right": [1184.0, 1680.0]}
        },
        "zones": {
            "SBD": {"title": "Số Báo Danh", "total_columns": 6, "standard_6_cols_indices": [0, 1, 2, 3, 4, 5]},
            "MA_DE": {"title": "Mã Đề Thi", "total_columns": 3, "standard_3_cols_indices": [0, 1, 2]},
            "PHAN_I": {"title": "Phần I: 40 câu trắc nghiệm nhiều lựa chọn", "num_questions": 40},
            "PHAN_II": {"title": "Phần II: 8 câu trắc nghiệm Đúng/Sai", "num_questions": 8},
            "PHAN_III": {"title": "Phần III: 6 câu trắc nghiệm trả lời ngắn", "num_questions": 6}
        }
    }

def main():
    os.makedirs("config", exist_ok=True)
    coords_dict = {}
    for tmpl_id in ["QM_12_04_06", "QM_12_02_04"]:
        path = resolve_file(PDF_PATHS[tmpl_id])
        coords_dict[tmpl_id] = process_template(tmpl_id, path)
    coords_dict["BGD_40_08_06"] = build_bgd_template()
    out_json = os.path.join("config", "templates_coords.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(coords_dict, f, ensure_ascii=False, indent=2)
    print("==========================================")
    print(f"XUẤT THÀNH CÔNG: {out_json}")
    print(f"Dung lượng file config: {os.path.getsize(out_json) / 1024:.1f} KB")

if __name__ == "__main__":
    main()
