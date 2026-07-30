const express = require('express');

const app = express();
app.use(express.json({ limit: '256kb' }));

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://wang-dongming-intro.zeabur.app';
const REPO_OWNER = 'twoheart520-source';
const REPO_NAME = 'wang-dongming-intro';
const CATEGORY_ID = 'DIC_kwDOTn0K2M4DCSJ2'; // Announcements category (giscus)

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

async function fetchGuestbookComments() {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) throw new Error('GITHUB_TOKEN not configured');

  const query = `
    query($owner: String!, $name: String!, $categoryId: ID!) {
      repository(owner: $owner, name: $name) {
        discussions(first: 5, categoryId: $categoryId, orderBy: {field: CREATED_AT, direction: DESC}) {
          nodes {
            title
            comments(first: 50) {
              nodes {
                bodyText
                author { login }
                replies(first: 20) {
                  nodes { bodyText author { login } }
                }
              }
            }
          }
        }
      }
    }
  `;

  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { owner: REPO_OWNER, name: REPO_NAME, categoryId: CATEGORY_ID },
    }),
  });

  if (!r.ok) throw new Error(`GitHub API error: ${r.status}`);
  const data = await r.json();
  if (data.errors) throw new Error(`GitHub GraphQL error: ${JSON.stringify(data.errors)}`);

  const discussions = data?.data?.repository?.discussions?.nodes || [];
  const lines = [];
  for (const d of discussions) {
    for (const c of d.comments?.nodes || []) {
      if (c.bodyText) lines.push(`${c.author?.login || '匿名'}：${c.bodyText}`);
      for (const rep of c.replies?.nodes || []) {
        if (rep.bodyText) lines.push(`${rep.author?.login || '匿名'}：${rep.bodyText}`);
      }
    }
  }
  return lines;
}

async function summarizeWithClaude(commentLines) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const text = commentLines.join('\n').slice(0, 8000);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `以下是網站留言板上的留言，請用繁體中文，以「一句話」（不超過 50 字）總結整體重點與氛圍，不要加任何前綴或說明文字：\n\n${text}`,
        },
      ],
    }),
  });

  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Anthropic API error: ${r.status} ${errText}`);
  }
  const data = await r.json();
  return data?.content?.[0]?.text?.trim() || '目前無法產生摘要，請稍後再試。';
}

app.post('/api/summarize', async (req, res) => {
  try {
    const comments = await fetchGuestbookComments();
    if (comments.length === 0) {
      return res.json({ summary: '目前還沒有留言，歡迎成為第一個留言的人！' });
    }
    const summary = await summarizeWithClaude(comments);
    res.json({ summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`api listening on ${port}`));
