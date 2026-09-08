/*
 * KWGT용 위젯 API가 공유하는 계산 로직.
 *
 * LEAVES 리터럴은 말년휴가_대장.html의 plans.confirmed.leaves를
 * (손으로 옮겨 적지 않고) 그 파일에서 그대로 잘라 붙인 것이다.
 * 확정 일정(계획.md "확정된 사실")이 바뀌면 반드시 두 파일을 함께 고치고,
 * 이 파일을 고칠 때도 같은 방식(추출 스크립트)으로 복사해서 손 타이핑을 피할 것 (CLAUDE.md L1).
 *
 * 요약 수치(D-Day·게이지·회차 진행)는 전부 이 LEAVES에서 요청 시점에 계산한다.
 * 절대 숫자를 따로 하드코딩하지 않는다.
 */

const YEAR = 2026;
const MS_DAY = 86400000;
const ENLIST = new Date(2025, 5, 17);      // 입대 2025-06-17
const DISCHARGE = new Date(2026, 11, 16);  // 전역 2026-12-16
const FIRST_ANCHOR = new Date(2026, 7, 31); // 1회차 게이지 기준 시작점 (8/31) — 말년휴가_대장.html과 동일
const COMBAT_TOTAL = 13;

// 대장 기본값 합계 — 말년휴가_대장.html의 DEFAULT_GROUPS 수량과 동일해야 한다.
// 서버는 사용자가 앱에서 직접 고친 대장 값(localStorage 전용)을 알 수 없으므로
// 항상 이 기본 합계를 기준으로 "잔여 휴가"를 계산한다. 이 사실을 leave_left_note로 같이 내려준다.
const DEFAULT_LEDGER_QTYS = [23, 4, 2, 3, 1, 1, 3, 3, 3, 1, 2]; // 연가/운전/뜀걸음/야근/사격특급/중대장/모범용사/드림/종교/시설방문/구직
const DEFAULT_LEDGER_TOTAL = DEFAULT_LEDGER_QTYS.reduce((a, b) => a + b, 0);

const LEAVES = {
        '10-19':1,'10-20':1,'10-21':1,'10-22':1,'10-23':1,'10-24':1,'10-25':1,'10-26':1,'10-27':1,'10-28':1,'10-29':1,
        '11-2':2,'11-3':2,'11-4':2,'11-5':2,'11-6':2,'11-7':2,'11-8':2,'11-9':2,'11-10':2,'11-11':2,'11-12':2,
        '11-15':3,'11-16':3,'11-17':3,'11-18':3,'11-19':3,'11-20':3,'11-21':3,'11-22':3,'11-23':3,'11-24':3,'11-25':3,'11-26':3,
        '11-30':4,'12-1':4,'12-2':4,'12-3':4,'12-4':4,'12-5':4,'12-6':4,'12-7':4,'12-8':4,'12-9':4,'12-10':4,'12-11':4,
};

function zero(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function keyToDate(k) { const p = k.split('-').map(Number); return new Date(YEAR, p[0] - 1, p[1]); }
function dayDiff(from, to) { return Math.round((zero(to) - zero(from)) / MS_DAY); }
const DOW = '일월화수목금토';
function fmt(d) { return (d.getMonth() + 1) + '/' + d.getDate() + '(' + DOW[d.getDay()] + ')'; }
function ddayText(n) { return n > 0 ? 'D-' + n : (n === 0 ? 'D-DAY' : 'D+' + (-n)); }

// 서버는 사용자의 로컬 시간대를 모른다. 이 앱은 한국군 말년휴가용이라 사용자가
// 전부 한국(KST, UTC+9)에 있다고 가정하고, Cloudflare Workers 런타임이 항상 UTC로
// 동작한다는 점(타임존 변경 불가)에 기대어 명시적으로 9시간을 더해 "오늘"을 계산한다.
// Date.now()는 타임존과 무관한 절대 epoch이므로 런타임 타임존 설정에 흔들리지 않는다.
export function nowKST() {
  return new Date(Date.now() + 9 * 3600 * 1000);
}

function deriveRounds() {
  const byRound = new Map();
  Object.keys(LEAVES).forEach((k) => {
    const r = LEAVES[k];
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(keyToDate(k));
  });
  return Array.from(byRound.entries())
    .map(([round, dates]) => {
      dates.sort((a, b) => a - b);
      const start = dates[0];
      const end = dates[dates.length - 1];
      return { round, start, end, back: new Date(end.getTime() + MS_DAY), days: dates.length };
    })
    .sort((a, b) => a.start - b.start);
}

function leaveProgress(now) {
  let used = 0, upcoming = 0;
  Object.keys(LEAVES).forEach((k) => { if (keyToDate(k) <= now) used++; else upcoming++; });
  return { used, upcoming, planned: used + upcoming };
}

function ddayState(rounds, now) {
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    if (now < r.start) {
      const from = i === 0 ? FIRST_ANCHOR : rounds[i - 1].back;
      return { kind: 'before', label: r.round + '회차 휴가까지', target: r.start, from, round: r };
    }
    if (now <= r.end) {
      return { kind: 'during', label: r.round + '회차 복귀까지', target: r.back, from: r.start, round: r };
    }
  }
  const from = rounds.length ? rounds[rounds.length - 1].back : FIRST_ANCHOR;
  return { kind: 'after', label: '전역까지', target: DISCHARGE, from, round: null };
}

function gaugePct(from, target, now) {
  const span = dayDiff(from, target);
  const done = Math.min(span, Math.max(0, dayDiff(from, now)));
  return span > 0 ? Math.min(100, Math.max(0, (done / span) * 100)) : 100;
}

export function computeStatus(now) {
  now = zero(now);
  const rounds = deriveRounds();
  const s = ddayState(rounds, now);
  const diff = dayDiff(now, s.target);
  const pct = gaugePct(s.from, s.target, now);
  const progress = leaveProgress(now);
  const leftDays = DEFAULT_LEDGER_TOTAL - progress.used;

  let caption;
  if (s.kind === 'during') {
    const spent = dayDiff(s.round.start, now) + 1;
    caption = fmt(s.round.start) + '~' + fmt(s.round.end) + ' · ' + spent + '/' + s.round.days + '일째 · ' + fmt(s.round.back) + ' 복귀';
  } else if (s.kind === 'before') {
    caption = fmt(s.from) + '부터 ' + dayDiff(s.from, now) + '일 경과 · ' + Math.round(pct) + '% · ' + fmt(s.target) + ' 시작';
  } else {
    caption = '휴가 일정 종료 · ' + fmt(DISCHARGE) + ' 전역';
  }

  const idx = s.round ? rounds.findIndex((r) => r.round === s.round.round) : -1;
  let nextLine = '';
  if (s.kind === 'during') {
    const nx = rounds[idx + 1];
    nextLine = nx ? '다음 ' + nx.round + '회차 ' + fmt(nx.start) + '~' + fmt(nx.end) + ' · ' + nx.days + '일' : '전역 ' + fmt(DISCHARGE);
  } else if (s.kind === 'before') {
    nextLine = '다음 ' + s.round.round + '회차 ' + fmt(s.round.start) + '~' + fmt(s.round.end) + ' · ' + s.round.days + '일';
  }

  const svcTotal = dayDiff(ENLIST, DISCHARGE);
  const svcDone = Math.min(svcTotal, Math.max(0, dayDiff(ENLIST, now)));
  const svcPct = svcTotal > 0 ? (svcDone / svcTotal) * 100 : 100;
  const svcDiff = dayDiff(now, DISCHARGE);
  const svcCaption = '복무 ' + (svcDone + 1) + '일차 / 총 ' + (svcTotal + 1) + '일 · ' + svcPct.toFixed(1) + '%';

  const doneRounds = rounds.filter((r) => now > r.end).length;

  let stateTag = '';
  if (s.kind === 'during') stateTag = '휴가 중';
  else if (svcDiff <= 7) stateTag = '전역 임박';

  return {
    today: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'),
    state: s.kind,
    state_tag: stateTag,
    leave: {
      label: s.label,
      dday: ddayText(diff),
      dday_days: diff,
      gauge_pct: Math.round(pct * 10) / 10,
      caption,
      next_line: nextLine,
    },
    service: {
      label: '전역까지',
      dday: ddayText(svcDiff),
      dday_days: svcDiff,
      gauge_pct: Math.round(svcPct * 10) / 10,
      caption: svcCaption,
      enlist: '2025-06-17',
      discharge: '2026-12-16',
    },
    rounds: rounds.map((r) => {
      const spentDays = Math.min(r.days, Math.max(0, dayDiff(r.start, now) + 1));
      return {
        round: r.round,
        start: fmt(r.start),
        end: fmt(r.end),
        days: r.days,
        spent_days: spentDays,
        progress_pct: Math.round((spentDays / r.days) * 1000) / 10,
        current: !!(s.round && s.round.round === r.round),
        done: now > r.end,
      };
    }),
    rounds_done: doneRounds,
    rounds_total: rounds.length,
    leave_left_days: leftDays,
    leave_left_note: '기본 대장 합계(' + DEFAULT_LEDGER_TOTAL + '일) 기준 — 앱에서 직접 수정한 값은 반영되지 않습니다',
    combat_total: COMBAT_TOTAL,
  };
}

// KWGT의 wg()로 바로 쓰기 쉬운 평평한 텍스트 필드 — 값 하나당 URL 하나
export function flatFields(now) {
  const s = computeStatus(now);
  return {
    'dday': s.leave.dday,
    'label': s.leave.label,
    'gauge': String(Math.round(s.leave.gauge_pct)),
    'caption': s.leave.caption,
    'next': s.leave.next_line,
    'tag': s.state_tag,
    'service-dday': s.service.dday,
    'service-gauge': String(Math.round(s.service.gauge_pct)),
    'service-caption': s.service.caption,
    'rounds-done': s.rounds_done + '/' + s.rounds_total,
    'left-days': String(s.leave_left_days),
    'today': s.today,
  };
}
