/**
 * 日経電子版のRSSフィードからニュースを取得する
 */

import RSSParser from 'rss-parser';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config.yml');

const parser = new RSSParser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; NikkeiLineTool/1.0)',
  },
});

/**
 * 設定ファイルを読み込む
 */
function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return yaml.load(raw);
}

/**
 * RSSフィードを1件取得してパースする
 */
async function fetchFeed(feedConfig) {
  try {
    const feed = await parser.parseURL(feedConfig.url);
    return feed.items.map((item) => ({
      source: feedConfig.name,
      title: item.title || '',
      summary: item.contentSnippet || item.content || '',
      url: item.link || item.guid || '',
      publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(),
    }));
  } catch (err) {
    console.warn(`[fetch] ${feedConfig.name} の取得に失敗しました: ${err.message}`);
    return [];
  }
}

/**
 * 全RSSフィードからニュースを取得し、指定時間内の記事だけ返す
 */
export async function fetchNews() {
  const config = loadConfig();
  const { rss_feeds, hours_back } = config.news;

  const cutoff = new Date(Date.now() - hours_back * 60 * 60 * 1000);

  console.log(`[fetch] ${rss_feeds.length}件のRSSフィードを取得中...`);

  const results = await Promise.allSettled(rss_feeds.map((feed) => fetchFeed(feed)));

  const allArticles = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .filter((article) => article.publishedAt >= cutoff)
    .sort((a, b) => b.publishedAt - a.publishedAt);

  // URLで重複除去
  const seen = new Set();
  const unique = allArticles.filter((article) => {
    if (seen.has(article.url)) return false;
    seen.add(article.url);
    return true;
  });

  console.log(`[fetch] ${unique.length}件の記事を取得しました（過去${hours_back}時間）`);
  return unique;
}

// 直接実行時の動作確認
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const articles = await fetchNews();
  console.log(JSON.stringify(articles.slice(0, 3), null, 2));
}
