/**
 * Gemini APIを使って記事をフィルタリング・スコアリングする
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config.yml');
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'filter.md');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
 * Gemini に記事を評価させ、スコア付き結果を返す
 */
export async function filterNews(articles) {
  if (articles.length === 0) {
    console.log('[filter] 記事が0件のためスキップします');
    return [];
  }

  const config = loadConfig();
  const prompt = buildPrompt(config, articles);

  console.log(`[filter] ${articles.length}件の記事をGeminiで評価中...`);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  const result = await model.generateContent(prompt);
  const rawText = result.response.text().trim();

  let scored;
  try {
    scored = JSON.parse(rawText);
  } catch {
    // JSONブロックを抽出（```json ... ``` 形式に対応）
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/) || rawText.match(/(\[[\s\S]*\])/);
    if (!jsonMatch) {
      throw new Error(`Geminiの出力をJSONとしてパースできません:\n${rawText}`);
    }
    scored = JSON.parse(jsonMatch[1]);
  }

  // インデックスを元の記事と紐付けて返す
  const result2 = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, config.filter.max_articles)
    .map((s) => ({
      ...articles[s.index],
      score: s.score,
      category: s.category || '業界動向',
      reason: s.reason,
      one_line_summary: s.one_line_summary,
    }));

  console.log(`[filter] ${result2.length}件の記事が選ばれました`);
  result2.forEach((a) => {
    console.log(`  [${a.score}点] ${a.category} | ${a.one_line_summary}`);
  });

  return result2;
}

// 直接実行時のテスト
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { fetchNews } = await import('./fetch-news.js');
  const articles = await fetchNews();
  const filtered = await filterNews(articles);
  console.log(JSON.stringify(filtered, null, 2));
}
