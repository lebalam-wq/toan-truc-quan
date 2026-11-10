/**
 * sw.js - Service Worker cho ứng dụng QM2025 OMR Grader
 * -----------------------------------------------------
 * Cơ chế Cache-First đảm bảo ứng dụng hoạt động ngoại tuyến (Offline 100%)
 * trên iPhone ngay cả khi giáo viên vào phòng thi không có sóng Wi-Fi hoặc 4G.
 */

const CACHE_NAME = 'qm2025-omr-v2.0';

// Danh mục tài nguyên tĩnh cần tải và lưu vào bộ nhớ đệm (Precache)
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/ios_style.css',
  './js/scanner_engine.js',
  './js/omr_grader.js',
  './js/ui_overlay_and_data.js',
  './js/app.js',
  './config/templates_coords.json',
  './template_12_04_06.png',
  './template_12_02_04.png',
  './debug_12_04_06.png',
  './debug_12_02_04.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  // Thư viện ngoại tuyến quan trọng
  'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js',
  'https://docs.opencv.org/4.8.0/opencv.js'
];

// 1. Sự kiện INSTALL: Tải toàn bộ tài nguyên vào Cache
self.addEventListener('install', (event) => {
  console.log('[SW] Đang cài đặt Service Worker và nạp cache...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Dùng nạp tuần tự resilient để không bị dừng nếu có một file tải chậm
      const cachePromises = PRECACHE_ASSETS.map(async (url) => {
        try {
          const response = await fetch(url, { mode: 'cors' });
          if (response.ok || response.type === 'opaque') {
            await cache.put(url, response);
            console.log(`[SW Cache] Đã lưu cache: ${url}`);
          }
        } catch (err) {
          console.warn(`[SW Cache] Không thể precache: ${url}`, err);
        }
      });
      await Promise.all(cachePromises);
      console.log('[SW] Quá trình precache hoàn tất 100%.');
    }).then(() => self.skipWaiting())
  );
});

// 2. Sự kiện ACTIVATE: Xóa bỏ các phiên bản cache cũ & chiếm quyền điều khiển
self.addEventListener('activate', (event) => {
  console.log('[SW] Kích hoạt phiên bản mới, dọn dẹp cache cũ...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log(`[SW] Xóa cache cũ: ${key}`);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Sự kiện FETCH: Chiến lược Cache-First (Ngoại tuyến tuyệt đối)
self.addEventListener('fetch', (event) => {
  // Chỉ xử lý các request GET (bỏ qua POST / PUT / analytics)
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        // Tài nguyên đã có trong bộ nhớ điện thoại -> trả về tức thì
        return cachedResponse;
      }

      // Chưa có trong cache -> tải từ mạng và tự động lưu vào cache cho các lần sau
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || (networkResponse.status !== 200 && networkResponse.type !== 'opaque')) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // Nếu ngoại tuyến hoàn toàn và truy cập điều hướng trang -> trả về index.html
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
