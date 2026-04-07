/**
 * Gemini APIを使って記事をフィルタリング・スコアリングする
 * 品質優先モード: リトライ・2パスフィルタリング対応
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

const VALID_CATEGORIES = new Set([
  'コスト・原材料', '補助金・支援策', '人材・採用', 'DX・技術',
  '市場・経済', '法規制・政策', '業界動向', '水耕栽培・植物工場', 'マテハン',
]);

function loadConfig() {
  return yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

/**
 * プロンプトテンプレートに変数を埋め込む
 */
function buildPrompt(config, articles, overrideMaxArticles = null) {
  const template = fs.readFileSync(PROMPT_PATH, 'utf8');
  const { user_profile, filter } = config;

  const articlesForAI = articles.map((a, i) => ({
    index: i,
    source: a.source,
    title: a.title,
    summary: a.summary.slice(0, 200),
    url: a.url,
  }));

  return template
    .replace('{{role}}', user_profile.role)
    .replace('{{industry}}', user_profile.industry)
    .replace('{{interests}}', user_profile.interests.join('\n- '))
    .replace('{{additional_instructions}}', filter.additional_instructions || 'なし')
    .replace('{{min_score}}', filter.min_score)
    .replace('{{max_articles}}', overrideMaxArticles ?? filter.max_articles)
    .replace('{{articles_json}}', JSON.stringify(articlesForAI, null, 2));
}

/**
 * 指数バックオフ付きスリープ
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * リトライ付き Gemini API 呼び出し
 */
async function callGeminiWithRetry(model, prompt, retryConfig) {
  const { max_attempts, delay_seconds } = retryConfig;

  for (let attempt = 1; attempt <= max_attempts; attempt++) {
    try {
      console.log(`[filter] Gemini 呼び出し (試行 ${attempt}/${max_attempts})...`);

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });

      return response.text.trim();
    } catch (err) {
      const isRetryable = err.message?.includes('429') ||
                          err.message?.includes('503') ||
                          err.message?.includes('500');

      if (attempt < max_attempts && isRetryable) {
        const waitMs = delay_seconds * attempt * 1000;
        console.warn(`[filter] 一時エラー、${delay_seconds * attempt}秒後にリトライ: ${err.message}`);
        await sleep(waitMs);
      } else {
        throw err;
      }
    }
  }
}

/**
 * JSON テキストをパースする（```json ブロック対応）
 */
function parseJson(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/```json\s*([\s\S]*?)\s*```/) ||
                  rawText.match(/(\[[\s\S]*\])/);
    if (!match) throw new Error(`JSONパース失敗:\n${rawText.slice(0, 300)}`);
    return JSON.parse(match[1]);
  }
}

/**
 * AI応答を検証して記事と紐付ける
 */
function mergeWithArticles(scored, articles, maxArticles) {
  return scored
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
        console.warn(`[filter] 必須フィールド不足をスキップ (index=${s.index})`);
        return false;
      }
      return true;
    })
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, maxArticles)
    .map((s) => ({
      ...articles[Number(s.index)],
      score: Number(s.score),
      category: VALID_CATEGORIES.has(s.category) ? s.category : '業界動向',
      reason: String(s.reason).slice(0, 100),
      one_line_summary: String(s.one_line_summary).slice(0, 120),
    }));
}

/**
 * メインフィルタリング処理（2パス対応）
 */
export async function filterNews(articles) {
  if (articles.length === 0) {
    console.log('[filter] 記事が0件のためスキップします');
    return [];
  }

  const config = loadConfig();
  const { filter } = config;
  const model = filter.model || 'gemini-2.0-flash';
  const retryConfig = filter.retry || { max_attempts: 3, delay_seconds: 10 };
  const twoPass = filter.two_pass || { enabled: false };

  console.log(`[filter] モデル: ${model}`);
  console.log(`[filter] 2パスフィルタリング: ${twoPass.enabled ? '有効' : '無効'}`);

  let targetArticles = articles;

  // ── 第1パス：大量記事を絞り込む ──────────────────────
  if (twoPass.enabled && articles.length > (twoPass.first_pass_limit || 20)) {
    const firstPassLimit = twoPass.first_pass_limit || 20;
    console.log(`\n[filter] 第1パス: ${articles.length}件 → 上位${firstPassLimit}件に絞り込み中...`);

    const prompt1 = buildPrompt(config, articles, firstPassLimit);
    const rawText1 = await callGeminiWithRetry(model, prompt1, retryConfig);
    const scored1 = parseJson(rawText1);
    targetArticles = mergeWithArticles(scored1, articles, firstPassLimit);

    console.log(`[filter] 第1パス完了: ${targetArticles.length}件が残りました`);
  }

  // ── 第2パス（または1パスのみ）：最終選定 ──────────────
  console.log(`\n[filter] ${twoPass.enabled ? '第2パス' : '評価'}: ${targetArticles.length}件から最終${filter.max_articles}件を選定中...`);

  const prompt2 = buildPrompt(config, targetArticles, filter.max_articles);
  const rawText2 = await callGeminiWithRetry(model, prompt2, retryConfig);
  const scored2 = parseJson(rawText2);
  const result = mergeWithArticles(scored2, targetArticles, filter.max_articles);

  console.log(`\n[filter] 最終選定: ${result.length}件`);
  result.forEach((a, i) => {
    console.log(`  ${i + 1}. [${a.score}点] ${a.category}`);
    console.log(`     ${a.one_line_summary}`);
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
