/**
 * LINE Messaging API を使って選別済みニュースを縦スクロール Flex Message で通知する
 */

import axios from 'axios';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config.yml');
const LINE_API_URL = 'https://api.line.me/v2/bot/message/push';

const CATEGORY_STYLES = {
  'コスト・原材料':     { color: '#E74C3C', bg: '#FDEDEC', icon: '📦' },
  '補助金・支援策':     { color: '#27AE60', bg: '#EAFAF1', icon: '💰' },
  '人材・採用':         { color: '#2980B9', bg: '#EBF5FB', icon: '👥' },
  'DX・技術':           { color: '#8E44AD', bg: '#F5EEF8', icon: '⚙️' },
  '市場・経済':         { color: '#D35400', bg: '#FEF9E7', icon: '📈' },
  '法規制・政策':       { color: '#7F8C8D', bg: '#F2F3F4', icon: '📋' },
  '業界動向':           { color: '#1A5276', bg: '#EBF5FB', icon: '🏭' },
  '水耕栽培・植物工場': { color: '#16A085', bg: '#E8F8F5', icon: '🌱' },
  'マテハン':           { color: '#B7770D', bg: '#FEF5E7', icon: '🏗️' },
};

function loadConfig() {
  return yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function scoreToStars(score) {
  const stars = Math.round(score / 2);
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

/**
 * 記事1件分の縦レイアウト用 box コンポーネントを生成する
 */
function buildArticleBox(article, index, total) {
  const style = CATEGORY_STYLES[article.category] || CATEGORY_STYLES['業界動向'];
  const stars = scoreToStars(article.score);

  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      // 左ボーダー（色覚多様性対応）
      {
        type: 'box',
        layout: 'vertical',
        contents: [],
        width: '4px',
        backgroundColor: style.color,
      },
      // 記事本体
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        paddingAll: '12px',
        spacing: 'sm',
        backgroundColor: style.bg,
        contents: [
          // カテゴリ行
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: `${style.icon} ${article.category}`,
                size: 'xs',
                weight: 'bold',
                color: style.color,
                flex: 1,
              },
              {
                type: 'text',
                text: `${index + 1}/${total} ${stars}`,
                size: 'xs',
                color: '#E8A000',
                align: 'end',
              },
            ],
          },
          // 見出し
          {
            type: 'text',
            text: article.one_line_summary,
            weight: 'bold',
            size: 'sm',
            wrap: true,
            color: '#1A1A1A',
            margin: 'sm',
            scaling: true,
          },
          // 理由
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              { type: 'text', text: '📌', size: 'xs', flex: 0 },
              {
                type: 'text',
                text: article.reason,
                size: 'xs',
                color: '#444444',
                wrap: true,
                flex: 1,
                margin: 'sm',
                scaling: true,
              },
            ],
          },
          // 媒体名 + ボタン行
          {
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            contents: [
              {
                type: 'text',
                text: article.source,
                size: 'xxs',
                color: '#888888',
                flex: 1,
                gravity: 'center',
              },
              {
                type: 'button',
                action: {
                  type: 'uri',
                  label: '開く',
                  uri: article.url,
                },
                style: 'primary',
                color: style.color,
                height: 'sm',
                flex: 0,
                adjustMode: 'shrink-to-fit',
              },
            ],
          },
        ],
      },
    ],
    margin: index === 0 ? 'none' : 'md',
  };
}

/**
 * 縦スクロール用の単一 Flex Bubble を生成する
 */
function buildVerticalBubble(articles, today) {
  const categoryCount = articles.reduce((acc, a) => {
    acc[a.category] = (acc[a.category] || 0) + 1;
    return acc;
  }, {});

  const categoryLines = Object.entries(categoryCount).map(([cat, count]) => {
    const style = CATEGORY_STYLES[cat] || CATEGORY_STYLES['業界動向'];
    return {
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'text',
          text: `${style.icon} ${cat}`,
          size: 'xs',
          color: style.color,
          flex: 1,
        },
        {
          type: 'text',
          text: `${count}件`,
          size: 'xs',
          color: '#888888',
          align: 'end',
        },
      ],
      margin: 'sm',
    };
  });

  return {
    type: 'bubble',
    size: 'mega',
    // ヘッダー：日付・件数・カテゴリ一覧
    header: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '16px',
      backgroundColor: '#FFFFFF',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: '📰 今日の注目ニュース',
              weight: 'bold',
              size: 'md',
              color: '#1A1A1A',
              flex: 1,
            },
          ],
        },
        {
          type: 'text',
          text: today,
          size: 'xs',
          color: '#888888',
          margin: 'xs',
        },
        {
          type: 'separator',
          margin: 'md',
          color: '#EEEEEE',
        },
        {
          type: 'text',
          text: `厳選 ${articles.length} 記事`,
          size: 'sm',
          color: '#333333',
          weight: 'bold',
          margin: 'md',
          scaling: true,
        },
        ...categoryLines,
      ],
    },
    // ボディ：記事を縦に積み上げ
    body: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '12px',
      spacing: 'none',
      contents: articles.map((article, i) =>
        buildArticleBox(article, i, articles.length)
      ),
    },
    // フッター
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '10px',
      backgroundColor: '#F8F8F8',
      contents: [
        {
          type: 'text',
          text: 'Powered by GitHub Models × LINE',
          size: 'xxs',
          color: '#BBBBBB',
          align: 'center',
        },
      ],
    },
  };
}

/**
 * LINE に縦スクロール Flex Message を送信する
 */
export async function postToLine(articles) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;

  if (!token || !userId) {
    throw new Error(
      'LINE_CHANNEL_ACCESS_TOKEN または LINE_USER_ID が設定されていません。'
    );
  }

  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'Asia/Tokyo',
  });

  let messages;

  if (articles.length === 0) {
    messages = [
      {
        type: 'text',
        text: `📰 今日の注目ニュース\n${today}\n\n本日は該当する重要ニュースがありませんでした。`,
      },
    ];
  } else {
    messages = [
      {
        type: 'flex',
        altText: `📰 ${today} 厳選${articles.length}記事 — 製造業・中小企業向け最新情報`,
        contents: buildVerticalBubble(articles, today),
      },
    ];
  }

  console.log('[post] LINE に縦スクロール Flex Message を送信中...');

  await axios.post(
    LINE_API_URL,
    { to: userId, messages },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    }
  );

  console.log('[post] 送信完了');
}

// 直接実行時のプレビュー確認
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dummyArticles = [
    {
      source: '日刊鉄鋼新聞',
      url: 'https://www.japanmetaldaily.com/articles/-/257707',
      score: 9,
      category: 'コスト・原材料',
      reason: '原材料費直撃のため即時対応が必要',
      one_line_summary: '鉄鋼・金属材料が大幅値上がり、製造コスト見直しが急務',
    },
    {
      source: 'NHK 経済',
      url: 'https://www.nhk.or.jp/',
      score: 8,
      category: '補助金・支援策',
      reason: '設備投資補助が拡充、申請期間を要確認',
      one_line_summary: '中小企業の設備投資補助金が拡充、新制度の詳細を確認',
    },
    {
      source: 'ITmedia ものづくり',
      url: 'https://www.itmedia.co.jp/',
      score: 7,
      category: 'DX・技術',
      reason: 'IoT・自動化導入費用の補助、今期申請チャンス',
      one_line_summary: '製造業DX補助金の申請受付開始、IoT化費用を最大50%補助',
    },
  ];

  await postToLine(dummyArticles);
}
