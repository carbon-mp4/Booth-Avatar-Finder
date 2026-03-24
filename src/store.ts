import fs from 'fs';
import path from 'path';

const DATA_DIR = process.cwd();
export const AVATARS_FILE = path.join(DATA_DIR, 'avatars.json');
export const SEEN_FILE = path.join(DATA_DIR, 'seen_ids.json');

export interface AvatarRecord {
  id: number;
  name: string;
  price: string;
  shop_name: string;
  liked: number;
  is_adult: boolean;
  url: string;
  image_url: string;
  tags: string[];
  first_seen: string;
  updated_at: string;
}

export function toImageUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  return rawUrl.replace('https://booth.pximg.net/', 'https://booth.pximg.net/c/300x300_a2_g5/');
}

export function loadAvatars(): AvatarRecord[] {
  if (!fs.existsSync(AVATARS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(AVATARS_FILE, 'utf-8'));
  } catch {
    console.error('Failed to parse avatars.json, returning empty list');
    return [];
  }
}

export function saveAvatars(avatars: AvatarRecord[]): void {
  fs.writeFileSync(AVATARS_FILE, JSON.stringify(avatars, null, 2), 'utf-8');
}

export function loadSeenIds(): Set<number> {
  if (!fs.existsSync(SEEN_FILE)) return new Set();
  try {
    const arr: number[] = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf-8'));
    return new Set(arr);
  } catch {
    console.error('Failed to parse seen_ids.json, returning empty set');
    return new Set();
  }
}

export function saveSeenIds(ids: Set<number>): void {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...ids], null, 2), 'utf-8');
}
