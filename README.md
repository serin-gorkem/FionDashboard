# Fion Video Planner

Fion Medya için aylık içerik planlayıcı + deadline radar uygulaması.

Bu sürüm Vercel'e uygun şekilde dosyalara ayrıldı:

```text
fion-video-planner-vercel/
├─ index.html
├─ css/
│  └─ style.css
├─ js/
│  └─ app.js
├─ package.json
├─ vercel.json
└─ .gitignore
```

## Vercel'e yayınlama

1. Bu klasörü GitHub reposuna yükle.
2. Vercel'de **New Project** seç.
3. Repoyu bağla.
4. Vercel ayarları:
   - Framework Preset: **Other**
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. Deploy.

## Lokal test

```bash
npm run dev
```

Sonra tarayıcıdan aç:

```text
http://localhost:3000
```

## Build testi

```bash
npm run build
npm run start
```

Sonra aç:

```text
http://localhost:3000
```

## Notlar

- Veriler tarayıcı `localStorage` içinde tutulur. Domain değişirse veriler ayrı görünür.
- Bildirim izni HTTPS veya localhost üzerinde çalışır. Vercel HTTPS verdiği için bildirim izni açılabilir.
- 09:00 / 12:00 / 15:00 browser bildirimleri için sayfanın açık olması gerekir. Site kapalıyken en güvenilir yol `.ics` takvim export'udur.
