# RouteMaximist

Intelligent Sales Territory & Route Optimization Platform (web app, tanpa backend — data tersimpan di IndexedDB browser).

## Cara Menjalankan

Modul ES6 tidak bisa dibuka lewat `file://`, jalankan lewat server lokal:

- **Windows**: klik dua kali `jalankan.bat`
- **Mac/Linux**: `./jalankan.sh`
- atau manual: `python3 -m http.server 8080` lalu buka http://localhost:8080

Butuh internet untuk: library (Leaflet, SheetJS, PapaParse, jsPDF dari CDN), tile peta OpenStreetMap, dan server routing OSRM.

## Alur Pakai
1. **Universal Import** — unggah CSV/XLSX/JSON/GeoJSON, cek mapping kolom, impor (salesman/rayon dibuat otomatis dari nama).
2. **GPS Validation** — perbaiki koordinat bermasalah (kosong, 0,0, duplikat, outlier).
3. **Salesman → Rute** — atur titik awal/akhir (ketik atau klik peta) dan mode (Round Trip / Open Route / Different End Point).
4. **Route Optimization** — pilih salesman → jalankan. Hasil: urutan, jarak/durasi jalan, hemat vs baseline, peta bernomor. Simpan urutan ke outlet, ekspor PDF/CSV.
5. **Export Center** — XLSX, CSV, JSON, GeoJSON, Backup & Restore.

## Catatan Produksi
- OSRM publik (`router.project-osrm.org`) hanya untuk uji coba & hanya profil `driving`. Untuk pemakaian rutin pasang OSRM sendiri lalu ubah endpoint di **Settings**.
- Bila OSRM tidak terhubung, optimasi tetap jalan memakai **estimasi garis lurus** (ditandai jelas di hasil & PDF).
- Data hanya ada di browser ini → rutin **Backup Full JSON**.

## Tes
`npm test` (Node 18+) menguji solver rute terhadap brute-force.
