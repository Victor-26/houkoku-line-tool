/**
 * GitHub Models APIを使って記事をフィルタリング・スコアリングする
 * GitHub Actions の GITHUB_TOKEN で動作（外部APIキー不要・無料）
 */

import OpenAI from 'openai';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config.yml');
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'filter.md');

// GitHub Models エンドポイント（GITHUB_TOKEN で認証）
const client = new OpenAI({
  baseURL: 'https://models.inference.ai.azure.com',
  apiKey: process.env.GITHUB_TOKEN,
});

const VALID_CATEGORIES = new Set([
  'コスト・原材料', '補助金・支援策', '人材・採用', 'DX・技術',
  '市場・経済', '法規制・政策', '業界動向', '水耕栽培・植物工場', 'マテハン',
  '世界の政治経済', '最新建築情報',
]);

// AIに送る前のキーワード事前絞り込み
// 関連性の高い記事だけを選別してトークン消費を抑える
const PREFILTER_KEYWORDS = [
  // 製造業・コスト
  '製造', '工場', '鉄鋼', '金属', '鉄', 'アルミ', '銅', '鉄スクラップ',
  '原材料', 'コスト', '物価', '値上げ', '価格', '原油', 'エネルギー',
  // 中小企業・経営
  '中小企業', '補助金', '助成金', '支援', '融資', '経営', '倒産',
  // 製造業技術
  'DX', 'IoT', 'AI', 'ロボット', '自動化', 'デジタル', 'スマート工場',
  'マテハン', '搬送', '物流', 'AGV', '自動搬送',
  // 農業・植物工場
  '水耕', '植物工場', 'アグリ', '農業',
  // 市場・経済
  '円安', '円高', '為替', '金利', '株価', '景気', '賃金', '賃上げ',
  // 法規制
  '規制', '法改正', '補助', '税制', '関税', '通商',
  // 建築・建設
  '建築', '建設', '工事', '住宅', 'ゼネコン', '建材', 'コンクリート',
  '鉄筋', '土木', '都市', '再開発',
  // 世界・政治経済
  'トランプ', '関税', '貿易', 'サプライチェーン', '中国', '米国',
  '欧州', '地政学', '戦争', '紛争', 'ウクライナ', '中東', '原油',
  '人手不足', '採用', '労働',
];

/**
 * AIに送る前にキーワードで事前絞り込みする
 * @param {Array} articles - 全記事
 * @param {number} limit - 最大件数
 */
function prefilterArticles(articles, limit = 50) {
  const keywords = PREFILTER_KEYWORDS;

  // 各記事のキーワードマッチ数でスコアリング
  const scored = articles.map((article) => {
    const text = `${article.title} ${article.summary}`;
    const matchCount = keywords.filter((kw) => text.includes(kw)).length;
    return { article, matchCount };
  });

  // マッチ数が多い順に並べ、上位 limit 件を返す
  // マッチ0件でも件数が足りない場合は含める
  const sorted = scored.sort((a, b) => b.matchCount - a.matchCount);
  const result = sorted.slice(0, limit).map((s) => s.article);

  const matched = scored.filter((s) => s.matchCount > 0).length;
  console.log(`[prefilter] ${articles.length}件 → ${result.length}件に絞り込み（キーワードマッチ: ${matched}件）`);

  return result;
}

function loadConfig() {
  return yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

/**
 * プロンプトテンプレートに変数を埋め込む
 */
function buildPrompt(config, articles, overrideMaxArticles = null) {
  const template = fs.readFileSync(PROMPT_PATH, 'utf8');
  const { user_profile, filter } = config;

  // トークン節約: タイトルと短い要約のみ送る（URLは省略）
  const articlesForAI = articles.map((a, i) => ({
    index: i,
    source: a.source,
    title: a.title,
    summary: a.summary.slice(0, 80),
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
 * リトライ付き GitHub Models API 呼び出し
 */
async function callWithRetry(model, prompt, retryConfig) {
  const { max_attempts, delay_seconds } = retryConfig;

  for (let attempt = 1; attempt <= max_attempts; attempt++) {
    try {
      console.log(`[filter] GitHub Models 呼び出し (試行 ${attempt}/${max_attempts}, モデル: ${model})...`);

      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      });

      return response.choices[0].message.content.trim();
    } catch (err) {
      const isRetryable = err.status === 429 || err.status === 503 || err.status === 500;

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
 * JSON テキストをパースする
 */
function parseJson(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    // { articles: [...] } 形式にも対応
    return Array.isArray(parsed) ? parsed : (parsed.articles || parsed.results || Object.values(parsed)[0]);
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
  const model = filter.model || 'gpt-4o-mini';
  const retryConfig = filter.retry || { max_attempts: 3, delay_seconds: 10 };
  const twoPass = filter.two_pass || { enabled: false };

  console.log(`[filter] モデル: ${model}`);
  console.log(`[filter] 2パスフィルタリング: ${twoPass.enabled ? '有効' : '無効'}`);

  // ── キーワード事前絞り込み（トークン上限対策）──────────
  // gpt-4o-mini の上限は8,000トークン。133件をそのまま送ると超過するため
  // 関連キーワードでスコアリングして上位50件のみAIに渡す
  const prefilterLimit = twoPass.enabled
    ? (twoPass.first_pass_limit || 20) * 3  // 2パス時は余裕を持って
    : 50;
  const prescreened = prefilterArticles(articles, prefilterLimit);

  let targetArticles = prescreened;

  // ── 第1パス：大量記事を絞り込む ──────────────────────
  if (twoPass.enabled && prescreened.length > (twoPass.first_pass_limit || 20)) {
    const firstPassLimit = twoPass.first_pass_limit || 20;
    console.log(`\n[filter] 第1パス: ${articles.length}件 → 上位${firstPassLimit}件に絞り込み中...`);

    const prompt1 = buildPrompt(config, articles, firstPassLimit);
    const rawText1 = await callWithRetry(model, prompt1, retryConfig);
    const scored1 = parseJson(rawText1);
    targetArticles = mergeWithArticles(scored1, articles, firstPassLimit);

    console.log(`[filter] 第1パス完了: ${targetArticles.length}件が残りました`);
  }

  // ── 第2パス（または1パスのみ）：最終選定 ──────────────
  console.log(`\n[filter] ${twoPass.enabled ? '第2パス' : '評価'}: ${targetArticles.length}件から最終${filter.max_articles}件を選定中...`);

  const prompt2 = buildPrompt(config, targetArticles, filter.max_articles);
  const rawText2 = await callWithRetry(model, prompt2, retryConfig);
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
