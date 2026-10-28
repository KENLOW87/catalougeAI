# Audit kesediaan SaaS — GEOMETRA Catalogue AI

Tarikh: 27 Oktober 2026. Skop: kod semasa dalam repositori ini, termasuk perubahan sedia ada yang belum dikomit. Audit ini tidak mengubah kod aplikasi.

## Kesimpulan

Projek sudah mempunyai asas produk pengurusan katalog: import, semakan hasil bacaan, sunting produk, susunan automatik, semakan kualiti dan eksport PDF. Ia belum menjadi SaaS berbilang syarikat. Penyimpanan utama menggunakan IndexedDB dalam pelayar, dan API tidak mempunyai lapisan login atau pemeriksaan akses syarikat.

“Sudah ada” bermaksud terdapat pelaksanaan yang boleh dikenal pasti dalam kod, bukan semua aliran telah diuji secara langsung. “Separuh siap” bermaksud sebahagian skop asal ada, tetapi skop SaaS yang lebih luas belum lengkap. “Belum ada” bermaksud tiada pelaksanaan ditemui dalam repositori yang disemak; perkhidmatan luaran yang tidak disertakan tidak dapat disahkan.

## Status 10 fungsi asal

| Fungsi | Status | Bukti dan jurang |
| --- | --- | --- |
| Login & User Management | Belum ada | Tiada halaman daftar/login, reset password, sesi pengguna, jemputan staff atau role. `app/src/App.jsx` membuka dashboard/editor terus; `app/server/index.js` tiada middleware autentikasi. |
| Dashboard | Separuh siap | `app/src/components/Dashboard.jsx` memaparkan jumlah katalog, produk, halaman, error/warning kualiti serta tindakan upload/eksport. Tiada aktiviti pengguna, hasil jualan, statistik langganan atau prestasi perniagaan. Dashboard katalog sendiri sudah ada. |
| Product / Catalogue Management | Separuh siap | CRUD, kategori, foto, drawing, varian, susun semula, reflow dan PDF ada. Rujuk `App.jsx`, `ProductDialog.jsx`, `src/lib/categories/`. Tiada medan harga berstruktur atau fungsi harga dalam borang/model kategori yang disemak. Teras pengurusan katalog sudah ada. |
| Customer / Lead Management | Belum ada | Tiada model pelanggan/lead, inquiry, pipeline atau follow-up. Istilah “customer” dalam dokumentasi bukan modul CRM. |
| Quotation / Order Management | Belum ada | Tiada sebut harga, item pesanan, status transaksi atau pengiraan jumlah. Eksport katalog PDF bukan quotation atau invoice. |
| AI Content & Marketing | Belum ada | AI sedia ada membaca katalog dan membantu arahan/soalan katalog (`ingest.mjs`, `BotPanel.jsx`, `ask.js`, `commands.js`, `/api/interpret`). Tiada penjana kandungan pemasaran, kempen atau penerbitan sosial. AI katalog tidak dikira sebagai modul marketing yang separuh siap. |
| Multi-Tenant System | Belum ada | `src/lib/store.js` menyimpan dalam DB `geometra`, store `catalogues`, dengan kunci kategori; tiada user/company/tenant ownership. Kategori produk bukan workspace syarikat. |
| Subscription & Billing | Belum ada | Tiada pelan langganan, trial, gateway, webhook, renewal, invoice langganan atau had mengikut pakej. |
| Super Admin Panel | Belum ada | Dashboard mengurus katalog dalam pelayar, bukan akaun syarikat, langganan dan pelanggan SaaS. |
| Automation & Notification | Belum ada | Tiada penjadual, reminder, email/WhatsApp atau workflow pelanggan. Progress dan heartbeat import ialah mekanisme proses teknikal, bukan notifikasi perniagaan. |

Dalam senarai luas asal: 2 separuh siap, 8 belum ada. Ini bukan peratus siap produk: banyak fungsi katalog yang sudah wujud tidak disenaraikan sebagai modul berasingan dalam brief asal.

## Fungsi yang sudah ada dalam kod

| Fungsi | Lokasi bukti | Had pengesahan |
| --- | --- | --- |
| Dashboard katalog dan ringkasan QC | `app/src/components/Dashboard.jsx` | Statistik katalog sahaja. |
| Tambah, edit, padam dan susun produk | `app/src/App.jsx:240`, `app/src/components/ProductDialog.jsx` | Data disimpan dalam pelayar. |
| Kategori terbina dan kategori baharu semasa import | `app/src/lib/categories/parents.js`, `app/src/lib/categories/index.js`, `app/src/lib/store.js` | Bukan pengasingan syarikat. |
| Foto, drawing, finishes dan validasi medan wajib | `app/src/components/ProductDialog.jsx`, `app/src/lib/categories/index.js` | Drawing diwajibkan mengikut kategori; kategori default membenarkan drawing pilihan. |
| Reflow, nombor posisi dan template LED/PVC/default | `app/src/lib/paginate.js`, `app/src/lib/categories/pvc.js`, `app/src/lib/categories/default.js`, `app/src/components/Catalogue.jsx` | Template default tidak menjamin replika tepat setiap reka bentuk asal. |
| Import PDF dan imej | `app/server/index.js:239`, `app/server/index.js:314`, `app/server/ingest.mjs`, `app/server/readers/` | Pembacaan bergantung pada layout; AI memerlukan konfigurasi/kredensial. Hasil perlu disemak manusia. |
| Semak dan gabung import sebelum Apply | `app/src/components/IngestDialog.jsx`, `app/src/lib/reconcile.js` | Ujian merge sedia ada lulus dalam audit ini. |
| Kekalkan halaman bukan produk dan close-up | `app/server/ingest.mjs`, `app/src/lib/categories/default.js` | Halaman yang disimpan sebagai imej penuh bukan produk editable secara automatik. |
| Eksport satu atau semua katalog sebagai PDF | `app/server/index.js:63`, `app/src/App.jsx:390` | Menggunakan Chrome/Edge dan paparan React; tidak diuji eksport langsung dalam audit ini. |
| QC dan ingatan keputusan semakan | `app/src/lib/qc.js`, `app/src/lib/store.js` | Peraturan kualiti katalog; bukan audit log pengguna. |
| Pembantu katalog dan arahan dengan pengesahan perubahan | `app/src/components/BotPanel.jsx`, `app/src/lib/commands.js`, `app/src/lib/ask.js` | Parser/soalan tempatan; bahasa bebas melalui AI apabila diaktifkan. |
| Buang latar foto | `app/src/lib/bgremove.js`, `app/src/components/ProductDialog.jsx` | Tidak dijalankan dalam audit ini. |
| Simpan dan muat semula data tempatan | `app/src/lib/store.js`, `app/src/App.jsx:157` | IndexedDB, migrasi localStorage dan laporan kegagalan simpan ada; tiada sync cloud. |

## Jurang kritikal untuk SaaS

1. **Identiti dan akses:** perlu pengguna, syarikat, keahlian, role dan pemeriksaan akses pada setiap operasi pelayan. API sekarang menyediakan export/import/interpret tanpa autentikasi. CORS localhost bukan kawalan akses pengguna.
2. **Storan berpusat dan ownership:** perlu pangkalan data serta storan aset berasaskan syarikat, dan migrasi data tempatan. IndexedDB terikat pada origin/profil pelayar; tiada akses data yang sama dari peranti lain atau kolaborasi staff.
3. **Backup dan pemulihan:** tiada backup data berstruktur atau restore versi katalog ditemui. PDF eksport tidak boleh menggantikan backup semua data, aset dan metadata.
4. **Kawalan penggunaan dan kos:** had JSON 300 MB wujud dalam server, tetapi tiada rate limit, kuota setiap syarikat/pakej, meter kos AI atau barisan kerja SaaS yang tahan restart ditemui. Had badan permintaan bukan kuota pelanggan.
5. **Billing dan entitlement:** perlu pelan, trial, pembayaran disahkan di pelayan, webhook idempotent, renewal serta peraturan akses selepas langganan tamat/gagal bayar.
6. **Onboarding dan support:** upload membantu mula guna katalog, tetapi tiada pendaftaran syarikat, setup staff, pemilihan pelan atau saluran support terbina. Reset semua katalog untuk demo bukan onboarding multi-tenant.
7. **Operasi:** tiada audit log perubahan mengikut pengguna, pemantauan berpusat atau bukti deployment production ditemui. Console log dan mesej ralat asas ada. `app.listen(PORT)` tidak menetapkan host secara eksplisit; Vite pula menetapkan loopback. Akses rangkaian sebenar bergantung pada host/firewall dan tidak diuji di sini.

## Keutamaan yang dicadangkan untuk semakan pengguna

| Fasa | Hasil yang perlu dicapai |
| --- | --- |
| 1 — Skop produk | Tetapkan SaaS katalog sebagai produk utama; sahkan sama ada harga produk, branding setiap syarikat dan perkongsian katalog diperlukan. CRM/quotation/marketing ialah pilihan tambahan, bukan syarat automatik. |
| 2 — Asas SaaS | Akaun, syarikat, role, storan cloud, pengasingan data yang diuji, backup/restore dan audit log. |
| 3 — Komersial | Onboarding, trial, pakej/had penggunaan, billing, renewal dan super admin. |
| 4 — Pilot | Uji dengan beberapa syarikat, peranti dan staff; ukur ketepatan import, eksport, masa proses, kos AI dan pemulihan data. |
| 5 — Pengembangan | Tambah CRM, quotation atau pemasaran hanya selepas keperluan pelanggan disahkan. |

## Pengesahan yang dibuat

- Membaca struktur sumber, konfigurasi, model, borang, storan, dashboard, API, import, template, assistant, QC dan dokumentasi berkaitan.
- Menjalankan `node server/test-reconcile.mjs`: semua 19 pemeriksaan lulus, meliputi padanan nama pendua, urutan import, kekalkan/padam produk yang tiada dalam PDF, pilihan perubahan dan skip produk baharu.
- Menjalankan `node --check server/index.js` dan `node --check server/ingest.mjs`: lulus semakan sintaks.
- Tidak menjalankan aplikasi, ujian browser penuh, eksport PDF, import PDF/imej sebenar, panggilan AI berbayar, ujian beban atau audit keselamatan dinamik. Tiada dakwaan bahawa aliran tersebut sudah lulus dalam sesi ini.
- Perubahan kod/dokumentasi lama yang belum dikomit telah wujud sebelum audit. Audit hanya menambah `SAAS_PROJECT_BRIEF.md` dan laporan ini; tidak membaiki atau menimpa perubahan lama.
