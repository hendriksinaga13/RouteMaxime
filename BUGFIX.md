# Laporan Bug & Perbaikan — RouteMaximist

## A. Aplikasi tidak bisa jalan sama sekali (kritis)
| # | Bug | Perbaikan |
|---|-----|-----------|
| 1 | Nama folder/file memiliki spasi nyasar: `routeMaximist /`, `style .css`, `importer .js`, `optimization /` → CSS & modul 404 | Struktur dinormalkan |
| 2 | `utils.js` tidak mengekspor `haversineMeters` tetapi di-import `app.js` → SyntaxError, layar kosong | Ditambahkan (+ `parseCoord`, `safeCell`) |
| 3 | `Imp.validateRow` tidak ada → impor selalu error | Ditulis: parse koma desimal, deteksi lat/lon tertukar, tolak 0,0 & di luar rentang |
| 4 | `M.createOutlet`, `M.deleteOutlet`, `M.deleteArea` tidak ada | Ditambahkan (+ rayon/salesman/proyek delete, lock rayon, restore) |
| 5 | `mapview.drawEnd` tidak ada; `drawStart` mengabaikan label | Ditambahkan; pin Start/End/nomor stop |
| 6 | `getRoute` mengembalikan format OSRM mentah, app membaca `distance_meters/duration_seconds/geometry` → NaN & garis rute kosong | Provider menormalkan; 1 request multi-waypoint (bukan 1 request per leg) |

## B. Bug fungsional
7. `navigate()` ke hash yang sama tidak memicu render → data baru (area, outlet, proyek) tidak tampil. Diperbaiki di router.
8. Optimasi kedua → `Map container is already initialized`. Peta kini dikelola & dibersihkan per halaman.
9. Solver: titik terakhir "dibekukan" pada round trip/open route, dan leg kembali ke start tidak dihitung saat 2-opt. Ditulis ulang (NN + 2-opt delta O(1) benar untuk matriks asimetris + Or-opt); diuji vs brute-force.
10. "Savings vs baseline" membandingkan sumber berbeda (matriks vs rute, baseline termasuk leg kembali, hasil tidak). Kini keduanya memakai matriks & aturan sama.
11. Jarak `null` OSRM (tak terjangkau) dianggap 0 oleh solver → kini `UNREACHABLE` + peringatan.
12. Mode *Different End Point* tanpa titik akhir diam-diam jadi open route → kini ditolak dengan pesan.
13. Impor mengabaikan kolom salesman/rayon/provinsi/kabupaten/kecamatan/desa; tidak ada skip kode duplikat; impor satu-per-satu (lambat). Kini satu transaksi + ringkasan hasil + daftar baris gagal.
14. Latitude `0` (khatulistiwa) disimpan sebagai `null` (`parseFloat(..) || null`).
15. ID acak hanya 32-bit → ±1% peluang tabrakan di 10.000 outlet (menimpa data diam-diam). Kini 64-bit/`crypto.randomUUID`.
16. `todayISO()` pakai UTC → nama file/tanggal mundur sehari sebelum jam 07.00 WIB.
17. `confirmDialog` tak pernah selesai bila ditutup lewat ×/overlay/Esc.
18. Input tanpa atribut `type` tidak terkena style (selector `input[type=text]`).
19. XSS: nama outlet/rayon/salesman dari file impor tidak di-escape (popup peta, tabel, judul modal).
20. Status OSRM di-poll tiap 30 detik (membebani server publik) → hanya saat load, klik pill, simpan setting, tiap 5 menit. Opsi provider "NOT IMPLEMENTED" dihapus.
21. Matriks > 100 titik gagal di OSRM publik → dipecah per blok.
22. Peta menimpa topbar (z-index); sidebar mobile tidak menutup; layar kecil.
23. Rute hilang saat reload; Backup tanpa Restore; ekspor hanya berisi ID (bukan nama), tanpa BOM UTF-8, rentan formula injection Excel; PDF memotong nama panjang.
24. Rayon "LOCKED" tidak berpengaruh → kini memblokir perubahan penugasan.
25. Deteksi outlier memakai mean/SD (tertarik outlier itu sendiri) → median/MAD.
26. Tabel outlet/GPS merender semua baris → paginasi + pencarian + filter.

## C. Tambahan agar siap pakai
Pilih titik Start/End dengan klik peta, tombol centroid, peta bernomor, simpan urutan kunjungan ke outlet, CSV rute, fallback estimasi saat OSRM mati, edit/hapus salesman & rayon, hapus proyek, restore backup, peringatan outlet GPS tidak valid.

## D. Keterbatasan yang jujur
- Uji otomatis (31 skenario di Chromium headless) memakai *stub* untuk Leaflet/PapaParse/SheetJS/jsPDF dan server OSRM tiruan, karena lingkungan uji tanpa internet. Logika aplikasi teruji; render nyata library CDN & OSRM publik perlu Anda coba sekali.
- Solver heuristik (bukan optimal pasti): pada uji kecil rata-rata mendekati optimal, terburuk ±10% di atas optimal.
- Tidak ada multi-user/login; data lokal per browser.
