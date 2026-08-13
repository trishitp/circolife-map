const GREEN = '#6BB35A';
const CREAM = '#FFFCFA';

function pinSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="30" fill="${GREEN}" stroke="${CREAM}" stroke-width="3"/>
    <rect x="15" y="24" width="34" height="22" rx="4" fill="${CREAM}"/>
    <path d="M19 29h26M19 33.5h26M19 38h18" stroke="${GREEN}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M32 14v6M27.5 16.2l3.2 3.2M36.5 16.2l-3.2 3.2" stroke="${CREAM}" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`;
}

function glyphSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    <rect x="12" y="22" width="40" height="26" rx="5" fill="${CREAM}"/>
    <path d="M18 29h28M18 35h28M18 41h20" stroke="${GREEN}" stroke-width="3" stroke-linecap="round"/>
    <path d="M32 12v8M26 15.2 32 21M38 15.2 32 21" stroke="${CREAM}" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}

function svgToImageData(svg, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      resolve(ctx.getImageData(0, 0, size, size));
      img.src = '';
    };
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export async function loadAcIcons(map) {
  if (!map) return;
  const size = 128;
  const jobs = [];
  if (!map.hasImage('ac-pin')) {
    jobs.push(svgToImageData(pinSvg(size), size).then((data) => {
      if (!map.hasImage('ac-pin')) map.addImage('ac-pin', data, { pixelRatio: 2 });
    }));
  }
  if (!map.hasImage('ac-glyph')) {
    jobs.push(svgToImageData(glyphSvg(size), size).then((data) => {
      if (!map.hasImage('ac-glyph')) map.addImage('ac-glyph', data, { pixelRatio: 2 });
    }));
  }
  await Promise.all(jobs);
}
