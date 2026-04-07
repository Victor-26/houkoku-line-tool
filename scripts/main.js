/**
 * メイン処理: 取得 → フィルタ → LINE送信
 */

import { fetchNews } from './fetch-news.js';
import { filterNews } from './filter-news.js';
import { postToLine } from './post-line.js';

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
      return;
    }

    // Step 2: AIフィルタリング
    const filtered = await filterNews(articles);

    // Step 3: LINE送信
    await postToLine(filtered);

    console.log('=== 完了 ===');
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
}

main();
