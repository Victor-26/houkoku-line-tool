/**
 * ニュースを複数ソースから取得する
 * - RSSフィード: 日経、NHK、Yahoo!ニュース、経産省、中小企業庁
 * - スクレイピング: 日刊鉄鋼新聞（RSS非対応）
 */

import RSSParser from 'rss-parser';
import axios from 'axios';
import cheerio from 'cheerio';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config.yml');

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ja,en;q=0.9',
};

const rssParser = new RSSParser({
  timeout: 10000,
  headers: HTTP_HEADERS,
});

function loadConfig() {
  return yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// ── RSS 取得 ────────────────────────────────────────

async function fetchRssFeed(feedConfig) {
  try {
    const feed = await rssParser.parseURL(feedConfig.url);
    return feed.items.map((item) => ({
      source: feedConfig.name,
      title: (item.title || '').trim(),
      summary: (item.contentSnippet || item.content || '').slice(0, 300).trim(),
      url: item.link || item.guid || '',
      publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(),
    }));
  } catch (err) {
    console.warn(`[fetch] RSS失敗 (${feedConfig.name}): ${err.message}`);
    return [];
  }
}

// ── スクレイピング 取得 ────────────────────────────────

async function fetchScrapeSite(siteConfig) {
  try {
    const res = await axios.get(siteConfig.url, {
      headers: HTTP_HEADERS,
      timeout: 15000,
    });

    const $ = cheerio.load(res.data);
    const articles = [];
    const seen = new Set();

    $(siteConfig.article_selector).each((_, el) => {
      const $el = $(el);
      const title = $el.text().trim();
      let href = $el.attr('href') || '';

      // 相対URLを絶対URLに変換
      if (href && !href.startsWith('http')) {
        href = href.startsWith('/')
          ? `${siteConfig.base_url}${href}`
          : `${siteConfig.base_url}/${href}`;
      }

      // タイトルが短すぎる・重複・URLなしはスキップ
      if (!title || title.length < 10 || !href || seen.has(href)) return;
      seen.add(href);

      // 日時を隣接要素から取得（設定されている場合）
      let publishedAt = new Date();
      if (siteConfig.datetime_selector) {
        const $parent = $el.parent();
        const datetimeAttr =
          $parent.find(siteConfig.datetime_selector).attr('datetime') ||
          $el.closest('li, div, article').find(siteConfig.datetime_selector).attr('datetime');
        if (datetimeAttr) {
          const parsed = new Date(datetimeAttr);
          if (!isNaN(parsed)) publishedAt = parsed;
        }
      }

      articles.push({
        source: siteConfig.name,
        title,
        summary: '',
        url: href,
        publishedAt,
      });
    });

    console.log(`[fetch] スクレイピング成功 (${siteConfig.name}): ${articles.length}件`);
    return articles;
  } catch (err) {
    console.warn(`[fetch] スクレイピング失敗 (${siteConfig.name}): ${err.message}`);
    return [];
  }
}

// ── メイン ────────────────────────────────────────────

export async function fetchNews() {
  const config = loadConfig();
  const { rss_feeds, scrape_sites, hours_back } = config.news;
  const cutoff = new Date(Date.now() - hours_back * 60 * 60 * 1000);

  console.log(`[fetch] RSSフィード ${rss_feeds.length}件 + スクレイピング ${(scrape_sites || []).length}件 を取得中...`);

  // RSS と スクレイピングを並列実行
  const [rssResults, scrapeResults] = await Promise.all([
    Promise.allSettled(rss_feeds.map((f) => fetchRssFeed(f))),
    Promise.allSettled((scrape_sites || []).map((s) => fetchScrapeSite(s))),
  ]);

  const allArticles = [
    ...rssResults.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value),
    ...scrapeResults.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value),
  ];

  // 時刻フィルタ
  const filtered = allArticles.filter((a) => a.publishedAt >= cutoff);

  // URLで重複除去
  const seen = new Set();
  const unique = filtered.filter((a) => {
    if (!a.url || seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  // タイトルが空の記事を除去
  const valid = unique.filter((a) => a.title.length > 0);

  console.log(`[fetch] 合計 ${valid.length}件 取得完了`);

  // ソース別の内訳を表示
  const bySource = valid.reduce((acc, a) => {
    acc[a.source] = (acc[a.source] || 0) + 1;
    return acc;
  }, {});
  Object.entries(bySource).forEach(([src, count]) => {
    console.log(`  ${src}: ${count}件`);
  });

  return valid;
}

// 直接実行時の動作確認
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const articles = await fetchNews();
  console.log('\n--- サンプル（最初の5件）---');
  articles.slice(0, 5).forEach((a) => {
    console.log(`[${a.source}] ${a.title}`);
    console.log(`  ${a.url}`);
  });
}
