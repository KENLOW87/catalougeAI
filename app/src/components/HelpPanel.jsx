import React, { useEffect } from 'react'
import './help.css'

// A short, two-step "how do I actually use this" guide for the admin —
// import a catalogue, then publish it — next to Aktiviti & Kos on the
// dashboard. Not a full manual: just the two actions an admin new to a
// deployed copy of this app needs first.
export default function HelpPanel({ onClose }) {
  useEffect(() => {
    const key = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const publicUrl = `${location.origin}/public.html`

  return (
    <div className="help-overlay">
      <section className="help-panel" role="dialog" aria-modal="true" aria-label="Bantuan">
        <div className="help-toolbar">
          <h2>Bantuan</h2>
          <button onClick={onClose} autoFocus>Tutup</button>
        </div>
        <p>Dua perkara asas untuk mula guna sistem ni.</p>

        <div className="help-step">
          <h3><span className="help-step-num">1</span> Masukkan katalog</h3>
          <p><b>Cara A — upload PDF baru:</b></p>
          <ol>
            <li>Pada card katalog yang berkenaan (atau butang "Upload file" di atas untuk destinasi automatik), klik <b>Upload file</b>.</li>
            <li>Pilih fail PDF katalog.</li>
            <li>Semak hasil yang di-extract, betulkan kalau perlu.</li>
            <li>Klik <b>Apply</b> untuk simpan.</li>
          </ol>
          <p style={{ marginTop: 14 }}><b>Cara B — bawa katalog yang dah siap dari tempat lain</b> (contoh: dari PC/browser lain ke sini):</p>
          <ol>
            <li>Di tempat asal, pada card katalog tu, klik <b>Export</b> — satu fail <code>.json</code> akan turun.</li>
            <li>Kat sini, scroll ke bawah Dashboard, cari "Move data to another browser/site".</li>
            <li>Klik <b>Import data</b> dan pilih fail tu, atau terus <b>drag fail tu</b> ke dalam kotak itu.</li>
          </ol>
          <div className="help-note">Data katalog (gambar, produk) tersimpan dalam browser ni je — bukan pada fail. Sebab tu perlu Export/Import untuk pindah antara PC/site yang berlainan.</div>
        </div>

        <div className="help-step">
          <h3><span className="help-step-num">2</span> Publish (jadikan ia live untuk orang awam)</h3>
          <ol>
            <li>Klik <b>Open catalogue</b> pada katalog yang dah siap.</li>
            <li>Dalam paparan katalog, klik butang <b>Publish</b> di bahagian atas.</li>
            <li>Orang awam kini boleh terus tengok di: <a href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a> — tanpa perlu login.</li>
            <li>Nak tarik balik (sembunyikan dari orang awam), klik <b>Unpublish</b>.</li>
          </ol>
          <div className="help-note">Publish hanya hantar snapshot semasa — edit lepas ni TIDAK automatik muncul kat laman awam sampai anda tekan Publish semula.</div>
        </div>
      </section>
    </div>
  )
}
