@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ================================================================
echo      QM2025 OMR GRADER - TỰ ĐỘNG TRIỂN KHAI GITHUB PAGES
echo      Dành cho iPhone iOS Safari Progressive Web App (PWA)
echo ================================================================
echo.

:: 1. Kiểm tra môi trường Git
where git >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [LỖI] Không tìm thấy lệnh Git trên máy tính!
    echo Vui lòng cài đặt Git tại: https://git-scm.com/
    pause
    exit /b 1
)

echo [1/5] Kiểm tra thư mục Git repository...
if not exist ".git" (
    echo [*] Khởi tạo git repository mới...
    git init
)

:: 2. Kiểm tra Remote Origin
echo [2/5] Kiểm tra cấu hình GitHub Remote...
git remote get-url origin >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo [THÔNG BÁO] Chưa cấu hình Remote Origin cho GitHub!
    echo Nhập URL kho lưu trữ GitHub của Thầy/Cô (ví dụ: https://github.com/username/qm2025-omr.git):
    set /p REPO_URL="URL Repo: "
    if "!REPO_URL!"=="" (
        echo [LỖI] URL không được để trống!
        pause
        exit /b 1
    )
    git remote add origin !REPO_URL!
)

:: 3. Chuyển sang nhánh gh-pages
echo [3/5] Chuẩn bị nhánh gh-pages...
git checkout -B gh-pages

:: 4. Thêm tệp và tạo Commit
echo [4/5] Đóng gói toàn bộ mã nguồn PWA & Mô hình tọa độ...
git add index.html manifest.json sw.js
git add css/
git add js/
git add config/
git add icons/
git add tools/
git add *.png

git status --short

set COMMIT_MSG=deploy: QM2025 OMR iOS Safari PWA ready for GitHub Pages (%date% %time%)
git commit -m "%COMMIT_MSG%"

:: 5. Đẩy lên GitHub
echo.
echo [5/5] Đang đẩy mã nguồn lên nhánh gh-pages trên GitHub...
git push -u origin gh-pages --force

if %ERRORLEVEL% equ 0 (
    echo.
    echo ================================================================
    echo        🎉 TRIỂN KHAI GITHUB PAGES THÀNH CÔNG RỰC RỠ!
    echo ================================================================
    echo.
    echo HƯỚNG DẪN KÍCH HOẠT VÀ SỬ DỤNG TRÊN IPHONE:
    echo 1. Vào GitHub Repo -> Settings -> Pages.
    echo 2. Mục 'Build and deployment':
    echo    - Source: 'Deploy from a branch'
    echo    - Branch: chọn 'gh-pages' và thư mục '/ (root)' -> Bấm 'Save'.
    echo 3. Sau 1 phút, trang web sẽ kích hoạt tại:
    echo    https://<Tên-Tài-Khoản>.github.io/<Tên-Repo>/
    echo.
    echo 4. TRÊN IPHONE (SAFARI):
    echo    - Mở Safari và truy cập đường link trên.
    echo    - Nhấn nút 'Chia sẻ' (biểu tượng hình vuông có mũi tên trỏ lên).
    echo    - Chọn 'Thêm vào MH chính' (Add to Home Screen).
    echo    - Biểu tượng QM2025 OMR xuất hiện trên màn hình iPhone,
    echo      chạy toàn màn hình (Standalone) và OFFLINE 100% không cần Wi-Fi/4G!
    echo ================================================================
) else (
    echo.
    echo [!] Quá trình push gặp sự cố. Vui lòng kiểm tra quyền truy cập GitHub token/SSH.
)

echo.
pause
