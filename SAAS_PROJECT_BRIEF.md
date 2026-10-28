# SaaS Project Brief — GEOMETRA Catalogue AI

Tarikh import konteks: 27 Oktober 2026.
Sumber: https://chatgpt.com/share/6ae003c2-ed2c-83ec-bb05-bb0426b28c4f

## Tujuan dan arahan pengguna

Pengguna mahu menjual sistem kepada pelanggan lain sebagai SaaS. Semak apa yang sudah ada, separuh siap dan belum ada sebelum memilih pembangunan seterusnya. Cadangan dalam perbualan asal ialah perancangan awal, bukan bukti fungsi sudah wujud. Arahan semasa: simpan konteks dan audit kod sahaja; jangan ubah kod aplikasi.

## Identiti projek

Perbualan asal belum memastikan sama ada projek ialah REVA website/backend, AI Digital Marketing atau sistem lain. Pemeriksaan repositori semasa mengenal pasti GEOMETRA Catalogue AI: PDF/imej masuk → data produk untuk disemak → sunting dan susun katalog → eksport PDF. Jangan anggap repositori ini sudah mengandungi CRM atau sistem pemasaran.

## Senarai audit asal

1. Login dan pengurusan pengguna: daftar, login, reset password, peranan pengguna.
2. Dashboard: aktiviti, statistik dan prestasi.
3. Pengurusan produk/katalog: tambah produk, gambar, harga dan kategori.
4. Pengurusan pelanggan/lead: simpan pelanggan, inquiry dan follow-up.
5. Quotation/order: sebut harga, pesanan dan status transaksi.
6. AI content dan marketing: jana kandungan dan urus kempen.
7. Multi-tenant: setiap syarikat mempunyai workspace dan data sendiri.
8. Subscription dan billing: pelan bulanan, pembayaran, renewal dan invoice.
9. Super admin: pemilik SaaS mengurus semua pelanggan.
10. Automation dan notifikasi: reminder, WhatsApp, email dan workflow.

## Keperluan sebelum menjual

Pengasingan syarikat ialah keutamaan: Company A tidak boleh melihat atau mengubah pelanggan, produk, quotation atau data Company B. Perlu pengesahan pengguna, kawalan akses, pengurusan langganan, had mengikut pakej, payment gateway, backup, audit log dan onboarding yang mudah. Workspace mesti dikuatkuasakan di pelayan; menapis paparan sahaja tidak memadai.

## Proses pelanggan yang dicadangkan

1. Daftar nama syarikat, email dan password.
2. Pilih pakej Starter, Pro atau Business.
3. Mulakan trial atau bayar melalui payment gateway; dapatkan invoice.
4. Setup logo, staff, produk dan pelanggan mengikut fungsi yang benar-benar ditawarkan.
5. Guna fungsi utama sistem. CRM, quotation dan automation kekal cadangan sehingga dipilih dan dibina.
6. Renew, upgrade dan dapatkan support.

## Hipotesis pakej

| Pakej | Harga contoh | Sasaran asal |
| --- | --- | --- |
| Starter | RM99/bulan | Perniagaan kecil |
| Pro | RM299/bulan | SME dengan beberapa staff |
| Business | RM599/bulan | Syarikat yang memerlukan automation |
| Enterprise | Harga khusus | Multi-branch dan integrasi khas |

Harga ini belum disahkan dengan pasaran atau kos operasi. Had staff, produk, storan dan penggunaan AI belum diputuskan. Jangan anggap harga atau skop pakej diluluskan untuk pelaksanaan.

## Keutamaan perancangan

Utamakan fungsi utama yang pelanggan sanggup bayar, login, keselamatan dan pengasingan syarikat, kemudian subscription dan billing. Jangan bina semua modul serentak. CRM, quotation dan marketing perlu dinilai kesesuaiannya dengan produk katalog ini dahulu.

## Nota pemindahan konteks

Perbualan asal mencadangkan fail ini sebagai konteks untuk Codex dan audit tanpa perubahan kod. Teks asal turut menyatakan konteks disimpan dalam Memory dan tugasan audit dibuka dalam Work; perkara itu tidak disahkan oleh audit ini dan tidak dianggap bukti bahawa konteks atau tugasan lain tersedia. Fail ini menjadi rujukan tempatan yang nyata.

Hasil audit repositori: lihat SAAS_AUDIT_REPORT.md.
