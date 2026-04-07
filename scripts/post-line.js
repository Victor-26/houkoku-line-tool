/**
 * LINE Messaging APIを使って選別済みニュースを通知する
 */

import axios from 'axios';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config.yml');

const LINE_API_URL = 'https://api.line.me/v2/bot/message/push';

function loadConfig() {
  return yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

/**
 * 記事リストをLINEメッセージ用テキストにフォーマットする
 */
function formatMessage(articles, config) {
  const { header, footer } = config.line;
  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });

  if (articles.length === 0) {
    return `${header}\n${today}\n\n本日は該当する重要ニュースがありませんでした。\n\n${footer}`;
  }

  const articleTexts = articles.map((article, i) => {
    const scoreBar = '★'.repeat(Math.round(article.score / 2)) + '☆'.repeat(5 - Math.round(article.score / 2));
    return [
      `【${i + 1}】${scoreBar}`,
      article.one_line_summary,
      `📌 ${article.reason}`,
      `🔗 ${article.url}`,
    ].join('\n');
  });

  return [
    `${header}`,
    `${today}`,
    '',
    articleTexts.join('\n\n'),
    '',
    `─────────────`,
    footer,
  ].join('\n');
}

/**
 * LINEにメッセージを送信する（プッシュメッセージ）
 */
export async function postToLine(articles) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;

  if (!token || !userId) {
    throw new Error(
      'LINE_CHANNEL_ACCESS_TOKEN または LINE_USER_ID が設定されていません。' +
      '.env ファイルまたは GitHub Secrets を確認してください。'
    );
  }

  const config = loadConfig();
  const messageText = formatMessage(articles, config);

  console.log('[post] LINEに送信中...');
  console.log('--- メッセージプレビュー ---');
  console.log(messageText);
  console.log('---------------------------');

  await axios.post(
    LINE_API_URL,
    {
      to: userId,
      messages: [
        {
          type: 'text',
          text: messageText,
        },
      ],
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }
  );

  console.log('[post] LINEへの送信が完了しました');
}

// 直接実行時のテスト（ダミーデータで送信確認）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dummyArticles = [
    {
      source: '日経 産業',
      title: '鉄鋼価格が5%上昇、製造業コスト圧迫',
      url: 'https://www.nikkei.com/article/xxxx',
      score: 9,
      reason: '原材料費直撃のため即時対応が必要',
      one_line_summary: '鉄鋼・金属材料が大幅値上がり、製造コスト見直しが急務',
    },
    {
      source: '日経 中小企業',
      title: '中小企業向け補助金、新年度から拡充',
      url: 'https://www.nikkei.com/article/yyyy',
      score: 8,
      reason: '設備投資補助が拡充、申請期間を要確認',
      one_line_summary: '中小企業の設備投資補助金が拡充、新制度の詳細を確認',
    },
  ];

  await postToLine(dummyArticles);
}
