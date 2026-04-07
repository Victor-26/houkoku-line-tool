/**
 * Gemini APIを使って記事をフィルタリング・スコアリングする
 */

import { GoogleGenAI } from '@google/genai';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config.yml');
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'filter.md');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    },
  });

  const rawText = response.text.trim();

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

  // AI応答の各フィールドを検証してから元記事と紐付ける
  const VALID_CATEGORIES = new Set([
    'コスト・原材料', '補助金・支援策', '人材・採用', 'DX・技術',
    '市場・経済', '法規制・政策', '業界動向', '水耕栽培・植物工場', 'マテハン',
  ]);

  const result2 = scored
    .filter((s) => {
      const idx = Number(s.index);
      const score = Number(s.score);
      if (!Number.isInteger(idx) || idx < 0 || idx >= articles.length) {
        console.warn(`[filter] 無効なindex (${s.index}) をスキップ`);
        return false;
      }
      if (!Number.isFinite(score) || score < 0 || score > 10) {
        console.warn(`[filter] 無効なscore (${s.score}) をスキップ`);
        return false;
      }
      if (!s.one_line_summary || !s.reason) {
        console.warn(`[filter] 必須フィールド不足のためスキップ (index=${s.index})`);
        return false;
      }
      return true;
    })
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, config.filter.max_articles)
    .map((s) => ({
      ...articles[Number(s.index)],
      score: Number(s.score),
      category: VALID_CATEGORIES.has(s.category) ? s.category : '業界動向',
      reason: String(s.reason).slice(0, 100),
      one_line_summary: String(s.one_line_summary).slice(0, 120),
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
