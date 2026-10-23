# Nuvio Perfect Catalog

Ini adalah kod Addon khas (katalog dari scratch) yang telah dikonfigurasikan mengikut permintaan anda:
1. **Pengasingan Mutlak:** Carian/Katalog *Movies* dan *TV Series* akan **menolak sebarang Anime**. Tiada lagi anime muncul dalam senarai filem biasa.
2. **Sokongan Ani.pm:** Bahagian *Anime* menggunakan API AniList secara terus. Struktur musim/part (seperti Bleach TYBW) tidak akan bercantum, menjadikannya serasi 100% dengan pautan strim Ani.pm.
3. **Metadata Lengkap:** Disertakan dengan huraian (description), poster cantik, background, dan pautan terus ke Trailer YouTube.

## Cara Pemasangan & Hosting (Vercel)

1. Extract (unzip) fail ini.
2. Log masuk ke [GitHub](https://github.com/) dan buat repositori baru bernama `nuvio-catalog`.
3. Muat naik 2 fail ini (`index.js` dan `package.json`) ke dalam repositori tersebut.
4. Pergi ke [Vercel](https://vercel.com/) dan log masuk menggunakan akaun GitHub anda.
5. Klik **"Add New Project"**, dan pilih repositori `nuvio-catalog` tadi.
6. Biarkan tetapan lalai (default settings) dan klik **"Deploy"**.
7. Selepas siap, Vercel akan berikan anda URL (contoh: `https://nuvio-catalog.vercel.app`).
8. Tambahkan `/manifest.json` di hujung URL tersebut (contoh: `https://nuvio-catalog.vercel.app/manifest.json`).
9. Buka Nuvio > Addons > Tampal (Paste) URL tersebut.

Siap! Katalog impian anda sudah aktif.
