/**
 * メイン処理: 取得 → フィルタ → LINE送信 → Web用JSON保存
 */

import { fetchNews } from './fetch-news.js';
import { filterNews } from './filter-news.js';
import { postToLine } from './post-line.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LATEST_JSON_PATH = path.join(__dirname, '..', 'docs', 'latest.json');

function saveLatestJson(articles) {
  const data = {
    updatedAt: new Date().toISOString(),
    articles,
  };
  fs.writeFileSync(LATEST_JSON_PATH, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[main] docs/latest.json を保存しました (${articles.length}件)`);
}

async function main() {
  console.log('=== Nikkei LINE Tool 開始 ===');
  const startAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  console.log(`実行時刻: ${startAt}`);

  try {
    // Step 1: ニュース取得
    const articles = await fetchNews();

    if (articles.length === 0) {
      console.log('取得できた記事が0件でした。LINEへは「本日の該当記事なし」を送信します。');
      await postToLine([]);
      saveLatestJson([]);
      return;
    }

    // Step 2: AIフィルタリング
    const filtered = await filterNews(articles);

    // Step 3: LINE送信
    await postToLine(filtered);

    // Step 4: Web用JSONに保存
    saveLatestJson(filtered);

    console.log('=== 完了 ===');
  } catch (err) {
    console.error('[ERROR]', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
