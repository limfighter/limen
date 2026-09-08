// GET /widget/<field> 또는 /widget/<field>.txt
// KWGT의 wg()로 필드 하나씩 순수 텍스트로 가져올 때 쓴다.
// /widget/all 은 사용 가능한 전체 필드를 "키: 값" 줄로 보여준다 (브라우저 확인·디버그용).
import { flatFields, nowKST } from '../_data.js';

export async function onRequestGet(context) {
  const raw = context.params.field || '';
  const key = raw.replace(/\.txt$/i, '');
  const fields = flatFields(nowKST());

  const headers = {
    'content-type': 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  };

  if (key === 'all') {
    const body = Object.keys(fields).map((k) => k + ': ' + fields[k]).join('\n');
    return new Response(body, { headers });
  }

  if (!Object.prototype.hasOwnProperty.call(fields, key)) {
    const body = '알 수 없는 필드: ' + key + '\n\n사용 가능: ' + Object.keys(fields).concat('all').join(', ');
    return new Response(body, { status: 404, headers });
  }

  return new Response(fields[key], { headers });
}
