import { fetchAvatars } from './fetchAvatars';

async function main(): Promise<void> {
  await fetchAvatars();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
