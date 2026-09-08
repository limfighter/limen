// GET /status.json — KWGT의 wgj()로 한 번에 모든 필드를 가져올 때 쓴다.
import { computeStatus, nowKST } from './_data.js';

export async function onRequestGet() {
  const data = computeStatus(nowKST());
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}
