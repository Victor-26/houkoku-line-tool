/**
 * Claude APIを使って記事をフィルタリング・スコアリングする
 */

import Anthropic from '@anthropic-ai/sdk';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config.yml');
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'filter.md');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function loadConfig() {
  return yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

/**
 * プロンプトテンプレートに変数を埋め込む
 */
function buildPrompt(config, articles) {
  const template = fs.readFileSync(PROMPT_PATH, 'utf8');
  const { user_profile, filter } = config;

  const articlesForAI = articles.map((a, i) => ({
    index: i,
    source: a.source,
    title: a.title,
    summary: a.summary.slice(0, 200),
    url: a.url,
    publishedAt: a.publishedAt,
  }));

  return template
    .replace('{{role}}', user_profile.role)
    .replace('{{industry}}', user_profile.industry)
    .replace('{{interests}}', user_profile.interests.join('\n- '))
    .replace('{{additional_instructions}}', filter.additional_instructions || 'なし')
    .replace('{{min_score}}', filter.min_score)
    .replace('{{max_articles}}', filter.max_articles)
    .replace('{{articles_json}}', JSON.stringify(articlesForAI, null, 2));
}

/**
 * Claudeに記事を評価させ、スコア付き結果を返す
 */
export async function filterNews(articles) {
  if (articles.length === 0) {
    console.log('[filter] 記事が0件のためスキップします');
    return [];
  }

  const config = loadConfig();
  const prompt = buildPrompt(config, articles);

  console.log(`[filter] ${articles.length}件の記事をClaudeで評価中...`);

  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = response.content[0].text.trim();

  // JSONブロックを抽出（```json ... ``` 形式に対応）
  const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/) || rawText.match(/(\[[\s\S]*\])/);
  if (!jsonMatch) {
    throw new Error(`Claudeの出力をJSONとしてパースできません:\n${rawText}`);
  }

  const scored = JSON.parse(jsonMatch[1]);

  // インデックスを元の記事と紐付けて返す
  const result = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, config.filter.max_articles)
    .map((s) => ({
      ...articles[s.index],
      score: s.score,
      category: s.category || '業界動向',
      reason: s.reason,
      one_line_summary: s.one_line_summary,
    }));

  console.log(`[filter] ${result.length}件の記事が選ばれました`);
  result.forEach((a) => {
    console.log(`  [${a.score}点] ${a.one_line_summary}`);
  });

  return result;
}

// 直接実行時のテスト
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { fetchNews } = await import('./fetch-news.js');
  const articles = await fetchNews();
  const filtered = await filterNews(articles);
  console.log(JSON.stringify(filtered, null, 2));
}
