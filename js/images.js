// Bilder för listposter: förminska i klienten, ladda upp, signerade URL:er och helskärmsvisning.
import { sb } from './supabase.js';
import { h, iconButton } from './ui.js';

const BUCKET = 'item-images';
const MAX_SIDE = 1200;
const SIGN_SECONDS = 60 * 60;
const signed = new Map(); // sökväg → { url, expires }

/** Förminska bilden till max 1200 px på längsta sidan och gör om till JPEG. */
export async function resizeImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Filen är inte en bild. Välj en JPG-, PNG- eller HEIC-bild.');
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await loadImageElement(file);
  }
  const w = source.width, hgt = source.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, hgt));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(hgt * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // genomskinliga PNG:er får vit bakgrund i JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Bilden kunde inte läsas. Prova en annan bild.');
  return blob;
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bilden kunde inte läsas. Prova en annan bild eller ta en skärmdump i stället.')); };
    img.src = url;
  });
}

/** Ladda upp en förminskad bild. Returnerar sökvägen <household_id>/<uuid>.jpg */
export async function uploadImage(householdId, blob) {
  const path = `${householdId}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

export async function removeImages(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  list.forEach((p) => signed.delete(p));
  const { error } = await sb.storage.from(BUCKET).remove(list);
  if (error) console.warn('Kunde inte ta bort bild', error);
}

/** Hämta signerade URL:er för flera sökvägar (cachas tills strax innan de går ut). */
export async function signedUrls(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter(Boolean))].filter((p) => !(signed.get(p)?.expires > now + 60_000));
  if (need.length) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need, SIGN_SECONDS);
    if (!error) {
      for (const d of data || []) {
        if (d.signedUrl) signed.set(d.path, { url: d.signedUrl, expires: now + SIGN_SECONDS * 1000 });
      }
    }
  }
  const out = {};
  for (const p of paths) if (signed.has(p)) out[p] = signed.get(p).url;
  return out;
}

/** Visa en bild i helskärm. */
export function lightbox(url, alt) {
  const prev = document.activeElement;
  const img = h('img', { src: url, alt: alt || '' });
  const closeBtn = iconButton('close', 'Stäng bild', () => close());
  const box = h('div', { class: 'lightbox', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': alt || 'Bild' } }, img, closeBtn);
  function close() {
    box.remove();
    document.body.style.overflow = '';
    prev?.focus?.({ preventScroll: true });
  }
  box.addEventListener('click', (e) => { if (e.target !== img) close(); });
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); if (e.key === 'Escape') close(); } });
  document.body.style.overflow = 'hidden';
  document.body.append(box);
  closeBtn.focus();
}
